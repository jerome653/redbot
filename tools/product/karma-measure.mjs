/**
 * MEASURE KARMA WITHOUT DEPENDING ON A BROWSER SOMEBODY ELSE LEFT OPEN.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS.
 *
 * `probe-karma --open` measured "every account whose browser is running" (removed once nothing
 * called it), and under the
 * single-account loop that was always at least one: boot opened the loop account's Chrome and
 * it stayed open. Under the rotation nothing stays open - `rotationTick` calls `openBrowser(h)`
 * for a turn and `closeBrowser(h)` after it - so between turns there is nothing to measure.
 *
 * MEASURED on cardinal:
 *   21 Oct 04:00 PDT  measured Big_Variation_8580 on 9223, recorded karma 1
 *   22 Oct 04:00 PDT  "no account's browser is running (13 with a debug port)", exit 1, FAILED
 *   23 Oct            `ss -ltn` shows no 92xx port listening at all
 *
 * Same probe, same fleet. The difference is whether a rotation turn happened to be holding a
 * browser at that second, which makes a daily measurement a race.
 *
 * AND THE RACE IS WON BY THE DANGEROUS SIDE. redbot-karma.timer picks 11:00 UTC because "the
 * browser is provably free then" - the loop account's quiet hours, 0-8 America/Los_Angeles.
 * Under the 2026-10-23 `DEFAULT_AUTO_WINDOWS = '18-24,01-05@Asia/Manila'` (rotation.mjs) 11:00 UTC is 19:00
 * Manila, INSIDE an active window. So the run that "succeeded" on 21 Oct measured a browser the
 * rotation owned - two processes on one CDP port, which on 2026-09-28 had to be killed to
 * protect a publish in flight. The run that FAILED was the safe one.
 *
 * ---------------------------------------------------------------------------
 * SO THE MEASUREMENT OPENS ITS OWN BROWSER, AND ONLY WHERE IT IS ALLOWED TO.
 *
 * It runs in the console process and nowhere else. `rotationHolds` is a closure in server.mjs
 * (`holdRegistry()` in rotation.mjs) - in-process state with no wire format. A CLI asking "is
 * the rotation using this account?" over HTTP could only be told about a moment that has
 * already passed, and would then open Chrome on a port a turn is about to take.
 *
 * A CHECK AND THE ACTION IT GUARDS MUST HAPPEN IN THE SAME PROCESS, OR THE CHECK IS A
 * DESCRIPTION OF THE PAST.
 *
 * WHAT IT CLOSES: only what it opened. An account whose Chrome was already up is measured and
 * LEFT UP - an operator opened that window, and a probe that tidies away someone's signed-in
 * browser once a day is a probe people switch off.
 */

/** A port held by something that is not our Chrome, or that we cannot identify, is not ours to drive. */
const UNTOUCHABLE = new Set(['foreign', 'unknown']);

const msg = (e) => (e instanceof Error ? e.message : String(e));

/**
 * @param {object} deps
 * @param {() => Array<{handle: string, debugPort?: number}>} deps.accounts
 * @param {(h: string) => Promise<'free'|'running'|'foreign'|'unknown'>} deps.browserState
 * @param {(h: string) => Promise<{ok: boolean, error?: string}>} deps.openBrowser
 * @param {(h: string) => Promise<void>} deps.closeBrowser
 * @param {(endpoint: string, handle: string) => Promise<number>} deps.probe  0 measured, non-0 not.
 *        Both are given: the endpoint is what probeKarma() takes, the handle is what the CLI
 *        resolves a port from via REDBOT_ACCOUNT. A caller uses whichever it actually runs.
 * @param {(h: string) => boolean} deps.busy                   a console button is driving it
 * @param {() => boolean} deps.rotationLive                    a rotation tick is in flight
 * @param {(h: string) => object} deps.hold                    take the turn-hold, returns a token
 * @param {(h: string, token: object) => void} deps.release
 * @param {(line: string) => void} [deps.log]
 * @param {string} [only]  measure just this handle; omitted means every configured account
 */
export async function measureKarma(deps, only) {
  const log = deps.log ?? (() => {});

  /* A TICK IN FLIGHT IS A WHOLE-FLEET REFUSAL, not a per-account one. rotationTick chooses its
     account AFTER it starts, so there is no handle to compare against yet, and the only safe
     answer while it is choosing is "not now". It runs for minutes; this runs once a day. A
     skipped day costs one data point. A guess costs a publish. */
  if (deps.rotationLive()) {
    log('a rotation tick is in flight - not measuring this run');
    return { ok: false, measured: [], skipped: [], failed: [], code: 1 };
  }

  const configured = deps.accounts().filter((a) => typeof a.debugPort === 'number' && a.debugPort > 0);
  const wanted = only ? configured.filter((a) => a.handle === only) : configured;
  if (!wanted.length) {
    log(only ? `${only} is not a configured account with a debug port` : 'no account has a debug port');
    return { ok: false, measured: [], skipped: [], failed: [], code: 1 };
  }

  const measured = [];
  const skipped = [];
  const failed = [];

  for (const a of wanted) {
    const h = a.handle;

    if (deps.busy(h)) { skipped.push({ handle: h, why: 'a console action is driving it' }); continue; }

    /* Re-read per account rather than once up front: state changes under a loop that opens and
       closes browsers, and a stale answer is what puts two processes on one port. */
    let state;
    try { state = await deps.browserState(h); }
    catch (e) { failed.push(h); log(`${h}: could not be checked - ${msg(e)}`); continue; }

    if (UNTOUCHABLE.has(state)) { skipped.push({ handle: h, why: `port is ${state}` }); continue; }

    const token = deps.hold(h);
    let weOpened = false;
    try {
      if (state !== 'running') {
        const r = await deps.openBrowser(h);
        if (!r || !r.ok) {
          failed.push(h);
          log(`${h}: could not be opened - ${(r && r.error) || 'no reason given'}`);
          continue;
        }
        weOpened = true;
        log(`${h}: opened for the measurement`);
      }
      const code = await deps.probe(`http://127.0.0.1:${a.debugPort}`, h);
      if (code === 0) measured.push(h); else failed.push(h);
    } catch (e) {
      failed.push(h);
      log(`${h}: ${msg(e)}`);
    } finally {
      /* CLOSE BEFORE RELEASE, both in `finally`. Releasing first would let the next turn open
         that account while this one is still closing it - the collision `autoStart` already
         refuses with "the rotation is still finishing its last turn". */
      if (weOpened) {
        try { await deps.closeBrowser(h); log(`${h}: closed again`); }
        catch (e) { log(`${h}: opened for the measurement and could not be closed - ${msg(e)}`); }
      }
      deps.release(h, token);
    }
  }

  /* Exit 1 when nothing was measured, or when an account we actually tried failed: either way a
     data point the operator expects is missing. An account SKIPPED for being busy is not a
     failure - declining to drive a browser somebody else is using is this module working. */
  const code = failed.length || !measured.length ? 1 : 0;
  if (measured.length) log(`measured: ${measured.join(', ')}`);
  if (skipped.length) log(`skipped: ${skipped.map((s) => `${s.handle} (${s.why})`).join(', ')}`);
  if (failed.length) log(`not measured: ${failed.join(', ')}`);
  if (!measured.length && !failed.length && skipped.length) log('every account was busy - nothing measured');
  return { ok: code === 0, measured, skipped, failed, code };
}
