/**
 * Talking to the dashboard service.
 *
 * Every status below is from the receiving side's handover, and the deployed service was probed
 * directly on 2026-07-31 to confirm the two that matter most before any of this was written:
 *
 *   GET  /v2/health        -> 200 {"status":"ok","db":true,"streams":12}
 *   POST /v2/events/thread -> 503 {"error":"not_configured", …}
 *
 * The `503` is the current state of the deployed environment — its secrets are pending approval.
 * It is NOT an error to design around: it behaves as any other `5xx`, so the sender retries and
 * KEEPS ITS CURSOR, and starts working the moment the secrets land with no change here.
 */

/** What the caller should do next. The names are the decision, not the HTTP code. */
export type Outcome =
  | { kind: 'accepted' }
  /** The batch is malformed. Retrying sends the same bad bytes — log it and move on. */
  | { kind: 'rejected'; status: number; detail: string }
  /** Credentials or entitlement. Pushing is off until a person fixes configuration. */
  | { kind: 'unauthorised'; status: number; detail: string }
  /** Too big. Halve the batch and try again. */
  | { kind: 'tooLarge'; detail: string }
  /** Slow down. `retryAfterMs` is the server's own instruction where it gave one. */
  | { kind: 'throttled'; retryAfterMs: number; detail: string }
  /** Their problem, or not configured yet. Retry with backoff, keep the cursor. */
  | { kind: 'unavailable'; status: number; detail: string }
  /** Never reached the service. Same handling as `unavailable`. */
  | { kind: 'offline'; detail: string };

export interface ClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** The service refuses a body over this. Batches are sized against it before sending. */
export const MAX_BODY_BYTES = 262_144;

const trim = (s: string, n = 300): string => (s.length > n ? s.slice(0, n) + '…' : s);

export class PushClient {
  private readonly base: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(opts: ClientOptions) {
    // A trailing slash would produce `//v2/events`, which some proxies redirect and others 404.
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  /** Liveness. Unauthenticated by design, so this works before any token exists. */
  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await this.doFetch(`${this.base}/v2/health`, {
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      const body = await res.text();
      return { ok: res.ok, detail: `${res.status} ${trim(body, 200)}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async postEvents(stream: string, envelope: unknown): Promise<Outcome> {
    return this.post(`/v2/events/${encodeURIComponent(stream)}`, envelope);
  }

  async postAccounts(envelope: unknown): Promise<Outcome> {
    return this.post('/v2/accounts', envelope);
  }

  /**
   * Read the shared account list.
   *
   * Uses the SHARE token, not the ingest token — the receiving side confirms an ingest token is
   * refused here, which is the point of issuing two. `If-None-Match` earns a `304`; the payload
   * is under a kilobyte so that is politeness rather than necessity, but it also means a polling
   * machine can run often without re-reading the same list.
   */
  async getAccounts(etag: string | null): Promise<
    | { kind: 'ok'; body: any; etag: string | null }
    | { kind: 'notModified' }
    | { kind: 'failed'; detail: string }
  > {
    let res: Response;
    try {
      res = await this.doFetch(`${this.base}/v2/accounts`, {
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(etag ? { 'if-none-match': etag } : {})
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (e) {
      return { kind: 'failed', detail: e instanceof Error ? e.message : String(e) };
    }

    if (res.status === 304) return { kind: 'notModified' };
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { kind: 'failed', detail: `${res.status} ${trim(text)}` };
    }
    try {
      const body = await res.json();
      return { kind: 'ok', body, etag: res.headers.get('etag') };
    } catch (e) {
      return { kind: 'failed', detail: `unreadable body: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  private async post(path: string, envelope: unknown): Promise<Outcome> {
    const body = JSON.stringify(envelope);
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      return {
        kind: 'tooLarge',
        detail: `${Buffer.byteLength(body)} bytes exceeds the ${MAX_BODY_BYTES} cap before sending`
      };
    }

    let res: Response;
    try {
      res = await this.doFetch(`${this.base}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Never a query parameter: it would land in access logs and browser history.
          authorization: `Bearer ${this.token}`
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { kind: 'offline', detail: msg };
    }

    return this.classify(res);
  }

  private async classify(res: Response): Promise<Outcome> {
    // 204 has no body; reading text() on it is harmless and keeps one code path.
    const text = await res.text().catch(() => '');
    const detail = `${res.status} ${trim(text)}`;

    if (res.status === 204 || res.status === 200) return { kind: 'accepted' };
    if (res.status === 400) return { kind: 'rejected', status: 400, detail };
    if (res.status === 401 || res.status === 403) {
      return { kind: 'unauthorised', status: res.status, detail };
    }
    if (res.status === 413) return { kind: 'tooLarge', detail };
    if (res.status === 429) {
      /* The service sends Retry-After in seconds; measured on their side as `32` for the 121st
         request in a 60s window. Honour it rather than guessing. */
      const raw = res.headers.get('retry-after');
      const secs = raw && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : 60;
      return { kind: 'throttled', retryAfterMs: secs * 1000, detail };
    }
    if (res.status >= 500) return { kind: 'unavailable', status: res.status, detail };

    /* Anything else is unexpected. Treated as rejected rather than retried, because retrying an
       unknown response is how a sender ends up in a loop nobody predicted. */
    return { kind: 'rejected', status: res.status, detail };
  }
}
