/**
 * ASK THE RUNNING CONSOLE TO MEASURE KARMA. The entry `redbot-karma.service` runs.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A REQUEST AND NOT A CLI RUN.
 *
 * The unit used to run `dist/cli.js probe-karma --open`, which measures "every account whose
 * browser is running". Under the single-account loop that was always at least one. Under the
 * rotation (`tools/product/rotation.mjs`) a turn opens a browser and closes it again, so
 * between turns there is nothing to measure:
 *
 *   21 Oct 04:00 PDT  measured Big_Variation_8580 on 9223
 *   22 Oct 04:00 PDT  "no account's browser is running (13 with a debug port)", exit 1, FAILED
 *
 * The fix is to open one - and the only process that may decide that is the console, because
 * the rotation's hold registry is a closure inside it. A CLI asking "is the rotation using this
 * account?" over HTTP would act on an answer that had already expired, and open Chrome on a port
 * a turn was about to take. So the decision stays in the console and this file only asks.
 *
 * WHICH console: the one whose port is on file. `electron/console-port.mjs` writes it, and
 * `console-endpoint.mjs` reads it back with Electron's own userData rule. There is exactly one
 * console per install - `main.mjs` takes an instance lock - so there is no ambiguity about which
 * of several this reaches.
 *
 * EXIT CODE IS THE UNIT'S VERDICT. No console, no answer, or a measurement that failed all exit
 * non-zero, because `redbot-karma.service` has no `SuccessExitStatus` override: a run that
 * measured nothing has to show FAILED rather than report a success nobody reads.
 */
import http from 'node:http';
import { userDataDir, consoleBase } from './console-endpoint.mjs';

/**
 * Must exceed a full-fleet karma pass (~5 min at 13 accounts, ~20-35 s per account) so the client
 * does not abort after the server has already written every row, AND stay at or below the unit's
 * TimeoutStartSec. If the account count grows, raise this and TimeoutStartSec together.
 */
const TIMEOUT_MS = 12 * 60 * 1000;

/**
 * POST over node:http, with `timeoutMs` as its ONLY time limit. Not the global fetch: Node's
 * fetch has a headers timeout of 300 s that an AbortSignal cannot extend, so #69's 12 minutes
 * never applied. Measured 25 Oct: started 04:00:00 PDT, "did not answer - fetch failed" at
 * 04:05:00. The route answers only when the whole fleet pass is over, so its headers can be the
 * last thing to arrive. Returns the slice of a fetch Response that requestKarma reads.
 */
export function postJson(url, { method, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ ok: res.statusCode < 400, status: res.statusCode, json: async () => JSON.parse(text) });
      });
    });
    const timer = setTimeout(() => req.destroy(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end(body);
  });
}

export async function requestKarma({
  base = consoleBase(userDataDir()),
  handle,
  fetchImpl = postJson,
  log = console.log,
  timeoutMs = TIMEOUT_MS
} = {}) {
  if (!base) {
    log('no console port on file - the app has not run on this install, or HOME is not its own');
    return 1;
  }

  let res;
  try {
    res = await fetchImpl(`${base}/api/karma/measure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      /* `JSON.stringify` drops an undefined value, so no handle sends `{}` - which the route
         reads as "every configured account". The ternary this replaced was an equivalent
         mutant: both forms produced the same two bytes, and no test could tell them apart. */
      body: JSON.stringify({ handle }),
      timeoutMs
    });
  } catch (e) {
    /* A stale port file reads fine and connects to nothing. Say which URL, so the next person
       does not go looking for a bug in the measurement. */
    log(`${base} did not answer - ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  let payload = null;
  try { payload = await res.json(); } catch { /* reported below as an unreadable answer */ }

  for (const line of payload?.output ?? []) log(line);

  if (!payload) {
    log(`the console answered ${res.status} with something that is not JSON`);
    return 1;
  }
  /* The route's own exit code, not the HTTP status: a 400 carrying `code: 1` and a readable
     reason is the measurement failing, which is what this unit exists to report. */
  if (Number.isInteger(payload.code)) return payload.code;

  /* NO `code` MEANS THIS WAS NOT THE ROUTE ANSWERING. Measured 23 Oct 00:31 UTC: a console
     started before this route existed returned `404 {"error":"not found"}`, and the unit failed
     with FOUR systemd lines and not one word about why - the operator's whole account of the
     failure was "status=1/FAILURE". An exit code with no sentence beside it is a dead end, so
     print what came back before returning it. */
  log(`the console answered ${res.status} and no measurement: ${JSON.stringify(payload).slice(0, 300)}`);
  return res.ok ? 0 : 1;
}

/* Run only as the unit's entry, never on import by the test beside it. */
if (import.meta.filename === process.argv[1]) {
  process.exitCode = await requestKarma({ handle: process.argv[2] });
}
