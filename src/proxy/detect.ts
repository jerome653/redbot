/**
 * Where the browser ACTUALLY is, read from the browser itself.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE SAME THING AS VETTING THE EXIT
 *
 * `vet.ts` asks the question "is this address the one that was paid for", and it asks it from
 * Node, through the relay, before an account ever opens. This module asks a different question:
 * "what does the browser this account actually runs in report about itself, right now". The two
 * can disagree — a proxy configured at the relay and a browser that is not going through it look
 * identical from Node, and only the browser can say which happened.
 *
 * Everything below therefore turns on ONE property: the lookup must travel the browser's own
 * network path. A reading that does not is not a weaker answer, it is an answer to a different
 * question wearing this one's clothes. See `detectFromBrowser` for the two routes that look like
 * they satisfy that and do not.
 *
 * ---------------------------------------------------------------------------
 * FAIL CLOSED, FOR THE SAME REASON vet.ts DOES
 *
 * Everything here refuses rather than guesses. No answer, a non-`success` status, a body that is
 * not JSON, a record with no timezone — each raises `DetectionError`, and none of them produces a
 * BrowserLocation with a gap in it. There is no "assume US" and no "assume the configured zone",
 * because the one thing worse than not knowing where the browser is, is believing it is somewhere
 * it is not: a browser announcing one part of the world from an address in another is a stronger
 * signal than not proxying at all.
 *
 * A partially-filled record would travel as an answer. A thrown error cannot.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { attach } from '../browser.js';
import { GEO_URL, type GeoRecord } from './vet.js';

/** One reading of where the browser is, taken at a point in time. */
export interface BrowserLocation {
  /** ISO, when it was measured. */
  at: string;
  ip: string | null;
  /** Two letters, upper case, e.g. `US`. */
  countryCode: string | null;
  country: string | null;
  regionName: string | null;
  city: string | null;
  /** IANA zone, straight from the provider — never derived from the city, never defaulted. */
  timezone: string | null;
  offsetSeconds: number | null;
  proxy: boolean | null;
  hosting: boolean | null;
  /** How it was obtained, so a wrong answer is debuggable. Names the TRANSPORT, not just the provider. */
  via: string;
}

/**
 * A detection that did not happen.
 *
 * Its own type, and its message always names WHAT failed, because the caller's only alternative
 * reading of a generic error here is "something went wrong, carry on" — and carrying on means
 * opening an account from a location nobody established.
 */
export class DetectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DetectionError';
  }
}

/**
 * How long to let the lookup take before giving up.
 *
 * 20 seconds. `machinePublicIp` allows 10 for a direct fetch from Node, and this is strictly more
 * work than that: a browser, usually on the far side of a residential or ISP proxy, doing a page
 * load and then a cross-origin request. Too short and a healthy slow exit reads as a failure —
 * which, because this module fails closed, would stop a run that should have proceeded.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
/** `0` is a real offset (UTC), so this tests the TYPE, never the truthiness. */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Turn one provider record into a location, or refuse.
 *
 * PURE — no I/O, and no clock beyond the `at` you hand it. Split out for exactly the reason
 * `judgeGeo` is: these rules are the part most likely to be got wrong, and they must be testable
 * against fixed records rather than against the internet.
 *
 * Two fields are mandatory and everything else is optional, which is a judgement worth recording.
 * `timezone` is mandatory because it is the field this whole detection exists to obtain — a
 * record without it cannot answer the only question being asked. `countryCode` is mandatory
 * because `timezoneMatchesCountry` needs both sides: given one without the other it answers
 * `unknown`, and an `unknown` that arrived wearing the clothes of a successful detection is the
 * precise reading this refuses to produce.
 *
 * The nullable fields in `BrowserLocation` are nullable because OTHER producers of that shape may
 * legitimately have less. This parser never emits null for the two above; it returns null instead.
 */
export function parseGeoRecord(raw: unknown, at = new Date().toISOString()): BrowserLocation | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as GeoRecord;

  /* The provider says so itself. `fail` carries a `message`; anything else is not a record. */
  if (r.status !== 'success') return null;

  const timezone = str(r.timezone);
  if (!timezone) return null;

  const countryCode = str(r.countryCode);
  if (!countryCode || !/^[A-Za-z]{2}$/.test(countryCode)) return null;

  return {
    at,
    ip: str(r.query),
    countryCode: countryCode.toUpperCase(),
    country: str(r.country),
    regionName: str(r.regionName),
    city: str(r.city),
    timezone,
    offsetSeconds: num(r.offset),
    proxy: bool(r.proxy),
    hosting: bool(r.hosting),
    via: 'ip-api.com success record'
  };
}

/** Why a record was refused, in words that name the field rather than shrugging. */
function refusal(raw: unknown): string {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return `the body parsed as ${Array.isArray(raw) ? 'an array' : String(raw)}, which is not a location record`;
  }
  const r = raw as GeoRecord;
  if (r.status !== 'success') {
    return r.message
      ? `the provider refused the lookup: ${r.message}`
      : `the provider answered status "${r.status ?? '(none)'}" rather than success`;
  }
  if (!str(r.timezone)) return 'the record carried no timezone, which is the one field this detection exists to obtain';
  if (!str(r.countryCode)) return 'the record carried no countryCode, so its timezone could not be checked against it';
  return 'the record could not be read as a location';
}

/**
 * Turn the body the browser read into a location, or throw saying why.
 *
 * PURE, and exported, for the same reason `judgeGeo` and `parseGeoRecord` are: this is the step
 * that decides whether an answer exists, and it must be provable without a browser. It was split
 * out after a mutation survived — replacing the throw below with a returned
 * `{countryCode:'US', timezone:'America/Los_Angeles'}` passed the entire suite, because the only
 * tests that reached this decision needed a live Chrome to get here and so never did. The refusal
 * this module is built on was, in practice, untested.
 *
 * That is the whole hazard in one line: the "assume US" this header promises never to do was one
 * edit away, and nothing would have said so.
 */
export function locationFromBody(body: string, where: string, at = new Date().toISOString()): BrowserLocation {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    const seen = body.trim().slice(0, 200) || '(empty)';
    throw new DetectionError(`${where}: the body was not JSON. It began: ${seen}`);
  }

  const loc = parseGeoRecord(raw, at);
  if (!loc) {
    throw new DetectionError(`${where}: ${refusal(raw)}. Nothing was assumed in its place.`);
  }
  return { ...loc, via: `renderer fetch of ip-api.com from a local http origin (${where})` };
}

/**
 * A blank page served from 127.0.0.1, alive only for the length of one detection.
 *
 * It exists solely to give the renderer an **http** origin to fetch from — see the note in
 * `detectFromBrowser`. Port 0 so the OS assigns one: a fixed port would make two concurrent
 * detections collide, and this runs once per account.
 */
async function startLocalOrigin(): Promise<{ server: Server; origin: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>redbot</title>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address() as AddressInfo | null;
  if (!addr || typeof addr === 'string') {
    server.close();
    throw new DetectionError('the local origin server started but reported no port, so the lookup had nowhere to run.');
  }
  return { server, origin: `http://127.0.0.1:${addr.port}/` };
}

/** Close the listener on every path, including the throwing ones. A leaked listener outlives the run. */
function stopLocalOrigin(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

/** What the renderer hands back. Its own shape so a network failure is data, not an exception. */
interface RendererResult {
  ok: boolean;
  status: number;
  body: string;
  error: string;
}

/**
 * Attach to a running browser, ask it where it is, and detach.
 *
 * Reuses `attach()` rather than re-implementing it. `attach()` takes the endpoint as a defaulted
 * parameter for this caller's sake — it already refuses a headless browser, already opens OUR OWN
 * tab rather than taking over one the operator is using, and already closes by detaching without
 * killing their Chrome (measured: `/json/version` still answers after `browser.close()` on a
 * `connectOverCDP` connection). Copying those properties into a second file is how one gets lost.
 */
export async function detectFromBrowser(
  opts: { endpoint: string; handle: string; timeoutMs?: number }
): Promise<BrowserLocation> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const where = `${opts.handle} @ ${opts.endpoint}`;

  const { server, origin } = await startLocalOrigin();
  try {
    const session = await attach(opts.endpoint);
    try {
      try {
        await session.page.goto(origin, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
      } catch (e) {
        throw new DetectionError(
          `${where}: the browser could not load the local origin ${origin} within ${timeoutMs}ms — `
          + `${(e as Error).message}. No location was established, so none is being reported.`
        );
      }

      /**
       * A `fetch` ISSUED BY THE RENDERER, from a local http page. Both of the obvious
       * alternatives were measured on Chrome 153.0.8010.52 and both are wrong:
       *
       *   A TOP-LEVEL NAVIGATION to the http GEO URL — dead. Chrome's HTTPS-Upgrades synthesises
       *   a 307 to https for http navigations, ip-api answers https with a perfectly valid 403
       *   ({"status":"fail","message":"SSL unavailable for this endpoint…"}), and because that
       *   403 is a real response Chrome's downgrade-fallback never fires. The tab ends on https
       *   having never reached the endpoint.
       *
       *   `context.request.get(GEO_URL)` — worse, because it SUCCEEDS. It returns 200 and a
       *   correct-looking record, and it is the wrong network path: the APIRequestContext issues
       *   from the Node process, so it does not inherit the `--proxy-server` of a browser we
       *   attached to over CDP. Measured with the browser's upstream pointed at a logging proxy:
       *   55 requests traversed it, none of them ip-api. On an unproxied box it is right by
       *   coincidence; on a proxied account it reports the HOST's location instead of the exit's
       *   — the exact defect this module exists to remove, except now with a measurement behind
       *   it. A confident wrong answer is the only outcome worse than no answer.
       *
       * The renderer fetch was confirmed to traverse the browser's configured upstream: the same
       * proxy log gained exactly one entry, `PLAIN http://ip-api.com/json/?fields=…`. The page
       * has to be an http origin or the request is mixed-content blocked (from an https page the
       * fetch throws "Failed to fetch"), which is the only reason the local server above exists.
       *
       * If you are here to simplify this back into one call: the two calls above ARE the simpler
       * versions, and they are the two that do not work.
       */
      const result = await session.page.evaluate<RendererResult, { url: string; ms: number }>(
        async ({ url, ms }) => {
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(ms), cache: 'no-store' });
            return { ok: res.ok, status: res.status, body: await res.text(), error: '' };
          } catch (e) {
            return { ok: false, status: 0, body: '', error: e instanceof Error ? e.message : String(e) };
          }
        },
        { url: GEO_URL, ms: timeoutMs }
      );

      if (result.error) {
        throw new DetectionError(
          `${where}: the browser could not reach ${GEO_URL} — ${result.error}. `
          + 'No location was established, so none is being reported.'
        );
      }
      if (!result.ok) {
        throw new DetectionError(`${where}: ${GEO_URL} answered HTTP ${result.status}, so no location was read.`);
      }

      /* Everything from here is a pure decision about the bytes, and lives in its own function
         so it can be proven against fixtures rather than against a live browser. */
      return locationFromBody(result.body, where);
    } finally {
      /* Detach, always. Never closes the operator's Chrome. */
      await session.close();
    }
  } finally {
    /* Every path, including each throw above. A listener left behind outlives the run. */
    await stopLocalOrigin(server);
  }
}
