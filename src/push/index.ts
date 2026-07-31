/**
 * One push run: for every stream, send what the service has not acknowledged yet.
 *
 * ORDERING. Streams are pushed in the order declared in streams.ts, which is the order a thread
 * moves through the product. It is a courtesy, not a guarantee — the receiving side confirms that
 * cross-stream references are not foreign keys and a backfill in any order is fine, so a `draft`
 * arriving before its `thread` is expected rather than an error.
 *
 * WHAT STOPS A RUN. An auth failure stops everything, because it is a configuration problem and
 * the next stream will fail identically. A malformed batch stops only its own stream. Everything
 * else — offline, `5xx`, the current `503 not_configured` — leaves the cursor where it was so the
 * same events are retried next run.
 */
import { getPool } from '../db.js';
import { machineId } from '../machine.js';

import { STREAMS, type StreamSpec } from './streams.js';
import { nextBatch, envelopeFor, assertSendable, sizeOf, type PushEvent } from './build.js';
import { PushClient, MAX_BODY_BYTES, type Outcome } from './client.js';
import { installId, readPushState, writePushState, advance, type PushState } from './state.js';

export interface StreamResult {
  stream: string;
  sent: number;
  batches: number;
  /** Why the stream stopped, when it did not simply run out of rows. */
  stopped?: string;
}

export interface PushReport {
  installId: string;
  machine: string;
  baseUrl: string;
  streams: StreamResult[];
  sent: number;
  /** Set when the whole run was abandoned — auth, or no configuration. */
  fatal?: string;
  dryRun: boolean;
}

export interface PushOptions {
  /** Build and validate everything, transmit nothing, advance nothing. */
  dryRun?: boolean;
  /** Rows per request. Reduced automatically when a batch would exceed the body cap. */
  batchSize?: number;
  /** Only these streams. Defaults to all twelve. */
  only?: readonly string[];
  fetchImpl?: typeof fetch;
  now?: () => string;
}

const DEFAULT_BATCH = 100;

/** The secret name the push token is stored under, matching `anthropic_api_key`'s convention. */
export const SYNC_PUSH_TOKEN = 'sync_push_token';

/** The secret name a share token is stored under, for reading the shared account list. */
export const SYNC_SHARE_TOKEN = 'sync_share_token';

/**
 * Where the service is: the environment first, then whatever was set on the Setup screen.
 *
 * The same precedence as the token and as `config.llm.operator`, and for the same reason — a
 * desktop app has no shell, so a value that could only come from the environment could never be
 * set by somebody who never opens a terminal. Absent from BOTH means the feature is off, which is
 * the one switch and it fails closed.
 */
export function syncUrl(): string | null {
  const fromEnv = process.env.REDBOT_SYNC_URL?.trim();
  if (fromEnv) return fromEnv;
  return readPushState().syncUrl?.trim() || null;
}

export function pushConfig(): { baseUrl: string | null; token: string | null } {
  return {
    baseUrl: syncUrl(),
    token: process.env.REDBOT_SYNC_PUSH_TOKEN?.trim() || null
  };
}

/** The share token: environment first, then the vault. Same rule as the push token. */
export async function resolveShareToken(): Promise<{ token: string | null; from: string; note?: string }> {
  const fromEnv = process.env.REDBOT_SYNC_SHARE_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, from: 'REDBOT_SYNC_SHARE_TOKEN' };
  try {
    const { getSecret, vaultUnavailableReason } = await import('../credentials.js');
    const reason = vaultUnavailableReason();
    if (reason) return { token: null, from: 'vault', note: `the vault cannot be opened: ${reason}` };
    const stored = await getSecret(SYNC_SHARE_TOKEN);
    if (stored) return { token: stored, from: `vault (${SYNC_SHARE_TOKEN})` };
    return { token: null, from: 'vault', note: `no ${SYNC_SHARE_TOKEN} stored` };
  } catch (e) {
    return { token: null, from: 'vault', note: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The push token: environment first, then the vault.
 *
 * The same precedence `anthropicKey()` uses, deliberately — one rule in this codebase rather than
 * two. The vault is the token's real home; the environment variable is an override for headless
 * and CI use, where an OS credential store may not exist.
 *
 * A vault that is present but unopenable is reported, never silently treated as "no token" — that
 * would send somebody to re-issue a token they already hold.
 */
export async function resolveToken(): Promise<{ token: string | null; from: string; note?: string }> {
  const fromEnv = process.env.REDBOT_SYNC_PUSH_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, from: 'REDBOT_SYNC_PUSH_TOKEN' };

  try {
    const { getSecret, vaultUnavailableReason } = await import('../credentials.js');
    const reason = vaultUnavailableReason();
    if (reason) return { token: null, from: 'vault', note: `the vault cannot be opened: ${reason}` };
    const stored = await getSecret(SYNC_PUSH_TOKEN);
    if (stored) return { token: stored, from: `vault (${SYNC_PUSH_TOKEN})` };
    return { token: null, from: 'vault', note: `no ${SYNC_PUSH_TOKEN} stored` };
  } catch (e) {
    return {
      token: null, from: 'vault',
      note: `the vault could not be read: ${e instanceof Error ? e.message : String(e)}`
    };
  }
}

/**
 * Send one stream until the server stops accepting or the rows run out.
 *
 * Returns the state to persist. The cursor advances ONLY on an accepted batch — every other
 * outcome leaves it untouched, so nothing is skipped by a failure.
 */
async function pushStream(
  spec: StreamSpec, client: PushClient | null, state: PushState, opts: Required<Pick<PushOptions, 'batchSize' | 'now'>> & { dryRun: boolean },
  identity: { installId: string; machine: string }
): Promise<{ state: PushState; result: StreamResult; fatal?: string }> {
  const db = getPool();
  let cursor = state.cursors[spec.name] ?? null;
  let sent = 0;
  let batches = 0;
  let limit = opts.batchSize;
  let out = state;

  for (;;) {
    const events: PushEvent[] = await nextBatch(db, spec, cursor, limit);
    if (!events.length) return { state: out, result: { stream: spec.name, sent, batches } };

    const envelope = envelopeFor(spec, identity.installId, identity.machine, events, opts.now());
    assertSendable(envelope);

    /* Size before sending. The service caps at 256 KB and answers 413; finding that out over the
       network costs a round trip and a rate-limit slot for something arithmetic can settle. */
    if (sizeOf(envelope) > MAX_BODY_BYTES) {
      if (events.length === 1) {
        return {
          state: out,
          result: { stream: spec.name, sent, batches, stopped: 'a single event exceeds the body cap' }
        };
      }
      limit = Math.max(1, Math.floor(events.length / 2));
      continue;
    }

    if (opts.dryRun) {
      /* Walk the whole stream, advancing an in-memory cursor only. Stopping after one batch
         would report 100 of 116 threads and understate the backfill — the number a person runs
         this to find out. Nothing is persisted, so the next real run still starts from zero. */
      sent += events.length;
      batches += 1;
      cursor = events[events.length - 1]!.cursor;
      if (events.length < limit) {
        return {
          state: out,
          result: { stream: spec.name, sent, batches, stopped: 'dry run — nothing sent' }
        };
      }
      continue;
    }

    const outcome: Outcome = await client!.postEvents(spec.name, envelope);

    if (outcome.kind === 'accepted') {
      const last = events[events.length - 1]!;
      cursor = last.cursor;
      out = advance(out, spec.name, last.cursor, opts.now());
      sent += events.length;
      batches += 1;
      /* Persist per batch, not per run: a crash mid-backfill then costs one batch of re-sends
         rather than all of them, and the server de-duplicates those anyway. */
      writePushState(out);
      if (events.length < limit) return { state: out, result: { stream: spec.name, sent, batches } };
      continue;
    }

    if (outcome.kind === 'tooLarge') {
      if (events.length === 1) {
        return { state: out, result: { stream: spec.name, sent, batches, stopped: outcome.detail } };
      }
      limit = Math.max(1, Math.floor(events.length / 2));
      continue;
    }

    if (outcome.kind === 'unauthorised') {
      return {
        state: out,
        result: { stream: spec.name, sent, batches, stopped: outcome.detail },
        fatal: `${outcome.detail} — pushing is stopped until the token is fixed`
      };
    }

    /* rejected · throttled · unavailable · offline: the cursor stays put. Throttling and outages
       are retried on the NEXT run rather than slept through here, because this runs inside a CLI
       command and a scheduler is a better place to wait than a process holding a database. */
    return { state: out, result: { stream: spec.name, sent, batches, stopped: outcome.detail } };
  }
}

export async function pushOnce(opts: PushOptions = {}): Promise<PushReport> {
  const { baseUrl } = pushConfig();
  const resolved = await resolveToken();
  const token = resolved.token;
  const dryRun = opts.dryRun === true;
  const now = opts.now ?? (() => new Date().toISOString());
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const machine = machineId();
  const id = installId();

  const report: PushReport = {
    installId: id, machine, baseUrl: baseUrl ?? '(unset)', streams: [], sent: 0, dryRun
  };

  if (!baseUrl && !dryRun) {
    report.fatal = 'REDBOT_SYNC_URL is not set — pushing is off';
    return report;
  }
  if (!token && !dryRun) {
    report.fatal =
      `no push token (${resolved.note ?? 'none found'}) — set REDBOT_SYNC_PUSH_TOKEN, or store ` +
      `one in the vault as ${SYNC_PUSH_TOKEN}`;
    return report;
  }

  const client = dryRun ? null : new PushClient({
    baseUrl: baseUrl!, token: token!, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {})
  });

  let state = readPushState();
  const wanted = opts.only?.length
    ? STREAMS.filter((s) => opts.only!.includes(s.name))
    : STREAMS;

  for (const spec of wanted) {
    const r = await pushStream(spec, client, state, { batchSize, now, dryRun }, { installId: id, machine });
    state = r.state;
    report.streams.push(r.result);
    report.sent += r.result.sent;
    if (r.fatal) { report.fatal = r.fatal; break; }
  }

  if (!dryRun) writePushState(state);
  return report;
}

/**
 * Config summary for `doctor` and the Setup screen.
 *
 * Reports whether a token EXISTS, never its value — the same rule `vault list` follows.
 */
export function pushStatus(): {
  configured: boolean; baseUrl: string | null; hasToken: boolean;
  installId: string | null; streams: number;
} {
  const { baseUrl, token } = pushConfig();
  let id: string | null = null;
  try { id = installId(); } catch { id = null; }
  return {
    configured: Boolean(baseUrl && token),
    baseUrl,
    hasToken: Boolean(token),
    installId: id,
    streams: STREAMS.length
  };
}

export { STREAMS };
