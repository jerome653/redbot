/**
 * The order every browser start follows: measure it, write that down, check it, cover it, send it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT A FUNCTION IN server.mjs
 *
 * It was a function in server.mjs — `coverProxiedBrowser` — and that placement is why the two
 * halves of this feature could both be green while nothing connected them. `detectFromBrowser`
 * and `recordAccountDetection` each shipped with ZERO production callers: every reference to
 * either, outside its own definition, was a comment or a test. Nothing failed, because the only
 * code that would have joined them lived inside a 4,000-line HTTP server that spawns Chrome, and
 * a decision reachable only by spawning Chrome is a decision nobody writes a test for.
 *
 * So the decisions live here, behind injected dependencies, and server.mjs supplies the real ones.
 * Same split as exit-posture.mjs, fleet-posture.mjs and run-outcome.mjs, and for the same reason
 * fleet-posture.mjs states: a rule that is only reachable through a live system is a rule that is
 * only ever checked by hand.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER, AND WHY IT IS THIS ORDER
 *
 *   1  wait for the debugging port to actually ANSWER
 *   2  DETECT — ask the browser where it is, over the browser's own network path
 *   3  RECORD — the measurement becomes evidence before anything acts on it
 *   4  CHECK  — against itself, and against the exit record
 *   5  COVER  — timezone, locale and the WebRTC fence, all from what was MEASURED
 *   6  OPEN   — and only now does the browser go to Reddit
 *
 * 2 BEFORE 5 IS LOAD-BEARING. `Emulation.setTimezoneOverride` changes what the renderer reports,
 * so a lookup taken after it reads back redbot's own assertion: a number that agrees with itself
 * every time and says nothing whatever about the exit. The browser is asked while it is still
 * telling the truth, and only then told what to say.
 *
 * 6 LAST IS THE SAME PROPERTY. Nothing can be measured, checked or refused about a browser that
 * has already arrived. Reddit fixes an account to the address and the fingerprint it first appears
 * from and there is no undo, so the one moment that must not be got wrong is the first page load.
 *
 * ---------------------------------------------------------------------------
 * FAIL CLOSED, AND CLOSE THE WINDOW
 *
 * Every refusal below returns `{ ok: false, error, closed: true }` and has already called
 * `close()`. There is no fallback zone and no "carry on without one": `accounts.timezone` is NULL
 * on every account since migration 0018, precisely so that nothing can quietly read one, and a
 * browser whose location could not be established must not be left sitting on about:blank waiting
 * for somebody to sign into it. We spawned it, so we own closing it.
 *
 * An account that does not reach Reddit is recoverable — run it again, or find out why the lookup
 * failed. An account that reaches Reddit announcing the wrong hemisphere is not.
 *
 * ---------------------------------------------------------------------------
 * A BROWSER THAT WAS ALREADY OPEN RUNS THIS SAME ORDER, MINUS THE SPAWN
 *
 * `launchChrome` used to answer an account whose Chrome was already up and ours by returning
 * `{ ok: true, alreadyRunning: true }` BEFORE any of the above existed in the flow. Nothing
 * measured it, nothing recorded it, nothing covered it, and the HTTP handler forwarded that as a
 * successful open. Migration 0018 is what turned the gap into a trap: it sets every
 * `accounts.timezone` to NULL, the only production code that writes one back is the detect-then-
 * persist path below, so an account whose browser happened to be open could never become
 * schedulable again — and "close Chrome and reopen it" appears nowhere in the product.
 *
 * `weSpawnedIt: false` runs the identical order and changes exactly two things, both of which are
 * about OWNERSHIP rather than about safety. They live here, next to the order, for the same reason
 * the refuse-and-close policy does: a rule with two copies is a rule that drifts.
 *
 *   NOT CLOSED ON A REFUSAL  — see `refuse` below.
 *   NOT NAVIGATED            — see the `openUrl` note at step 6.
 *
 * Nothing else moves. It still waits, still detects before it overrides, still refuses to act on
 * a measurement it could not record, and still runs both country checks.
 */

/** Everything a caller must supply. Named so a missing one is a sentence, not a TypeError. */
const REQUIRED = ['waitForDebugPort', 'detect', 'record', 'refusal', 'cover', 'close'];

/**
 * @param deps  waitForDebugPort, detect, record, refusal, cover, close, loginUrl
 * @param opts  endpoint, account, exit, proxied
 */
export async function startAlignedBrowser(deps, opts) {
  const { endpoint, account, exit, proxied, weSpawnedIt = true } = opts;
  const handle = account && account.handle;

  /* A build missing one of its compiled modules is reported as that, not as a crash. server.mjs
     leaves every api null when the dist import fails, and "cannot read properties of null" is not
     a sentence anybody can act on. */
  const missing = REQUIRED.filter((k) => typeof deps[k] !== 'function');
  if (missing.length) {
    return { ok: false, closed: false, error:
      `the compiled build is missing what redbot needs to open a browser safely (${missing.join(', ')})`
      + ' — run npm run build' };
  }

  /* One place, so every refusal below closes the window and none of them can forget to. A close
     that itself throws must not replace the reason the launch was refused. */
  const refuse = async (error) => {
    /**
     * A BROWSER REDBOT DID NOT OPEN IS NOT REDBOT'S TO CLOSE.
     *
     * "We spawned it, so we own closing it" is the whole justification above, and it is precisely
     * the sentence that stops applying to a window the operator opened, may be signed into, and
     * may have half-typed text in. electron/main.mjs already holds the rule in as many words:
     * "this process did not start it, so this process must not close it."
     *
     * FAIL-CLOSED SURVIVES, because it never rested on the window. `record` below is reached
     * only after a successful detection, so a browser that could not be measured writes no zone,
     * `accounts.timezone` stays NULL, and src/window.ts refuses the account under the rule
     * `bad-timezone`. The COLUMN is the fence; closing was only ever tidying up after ourselves.
     * Leaving a window open costs an operator a tab they must close. Closing one costs them a
     * session they cannot get back, and Reddit fixes an account to the identity it first appears
     * from.
     */
    if (!weSpawnedIt) {
      return { ok: false, closed: false, error:
        `${error} redbot did not open this browser, so it has been left open and unchanged — `
        + 'close it and open it from here if you want it measured.' };
    }
    let closed = true;
    try { await deps.close(); } catch { closed = false; }
    return { ok: false, closed, error };
  };

  /* -- 1. Did the port actually answer. Asking for a port is not getting one: Chrome handed an
        occupied --remote-debugging-port starts anyway, silently yields the port, and the window
        looks perfectly normal. -- */
  if (!await deps.waitForDebugPort(endpoint)) {
    return refuse(
      `${handle}'s browser did not open its debugging port on ${endpoint} within 30 seconds, `
      + 'so redbot could not measure where it is and did not send it to Reddit.');
  }

  /* -- 2. WHERE IS IT. Asked of the browser, before anything is overridden. -- */
  let location;
  try {
    location = await deps.detect({ endpoint, handle });
  } catch (e) {
    return refuse(
      `redbot could not establish where ${handle}'s browser is, so it did not send it to Reddit: `
      + `${String((e && e.message) || e)} Nothing was assumed in its place — acting on a stored or `
      + 'default zone is the defect this check exists to delete, and a browser announcing one part '
      + 'of the world from an address in another is read by a single line of JavaScript.');
  }
  if (!location || !location.timezone) {
    return refuse(
      `${handle}'s browser returned a location with no timezone, which is a failed detection and `
      + 'not a partial one. redbot did not send it to Reddit.');
  }

  /* -- 3. ON RECORD BEFORE IT IS ACTED ON.
        This is what makes 0018's cleared column recoverable: the same call writes the
        account_locations row AND moves accounts.timezone, in one transaction, so the zone the
        browser is about to announce always has evidence behind it. A measurement redbot cannot
        record is one it will not use — otherwise the launch would re-create exactly the
        un-provenanced zone 0018 abolished, only now with a browser already open on it. -- */
  let recorded;
  try {
    recorded = await deps.record(handle, {
      ip: location.ip ?? null,
      timezone: location.timezone,
      countryCode: location.countryCode ?? null,
      country: location.country ?? null,
      regionName: location.regionName ?? null,
      city: location.city ?? null,
      offsetSeconds: location.offsetSeconds ?? null,
      proxy: location.proxy ?? null,
      hosting: location.hosting ?? null,
      /* WHICH OCCASION produced the reading — the closed domain shared with account_exit_ips.via. */
      via: 'launch',
      /* BY WHAT ROUTE it travelled, which is what the detector's own `via` carries. Two different
         questions that were once answered by one column; see 0018 and src/db/locations.ts. */
      transport: location.via ?? null
    });
  } catch (e) {
    recorded = { ok: false, error: String((e && e.message) || e) };
  }
  if (!recorded || !recorded.ok) {
    return refuse(
      `${handle}'s browser reported ${location.timezone}, but redbot could not record that `
      + `measurement and will not act on a zone it cannot account for: ${
        (recorded && recorded.error) || 'the detection was not stored'}`);
  }

  /* -- 4a. DEFENCE IN DEPTH: the record has to agree with itself.
        Fed the DETECTED country, never the one on the exit record. Both sides of the comparison
        now come from the same reading, so this should be structurally satisfied every time — it
        fires only when a provider hands back a timezone and a country that do not belong
        together, which means the record is internally inconsistent and is not safe to announce.
        A check that is normally silent is exactly the one worth leaving in. -- */
  const inconsistent = deps.refusal(handle, location.timezone, location.countryCode, location.regionName);
  if (inconsistent) return refuse(inconsistent);

  /* -- 4b. AND AGAINST THE EXIT RECORD, which is the check that actually catches a browser going
        around its own proxy.
        4a cannot do this: with both inputs measured it can only test the provider's answer for
        self-consistency. This compares the MEASURED country against the one the exit was vetted
        onto. src/proxy/detect.ts names the failure in as many words — a proxy configured at the
        relay and a browser that is not going through it look identical from Node, and only the
        browser can say which happened. This is where it says so. -- */
  if (proxied && exit && exit.proxy && exit.proxy.country) {
    const vetted = String(exit.proxy.country).toUpperCase();
    const measured = String(location.countryCode || '').toUpperCase();
    if (vetted !== measured) {
      return refuse(
        `${handle}'s exit was vetted in ${vetted}, but its browser reports it is in ${
          measured || 'a country it did not name'}${location.city ? ` (${location.city})` : ''}. `
        + 'These are two measurements disagreeing, not a field filled in wrongly: the exit was '
        + 'proven by a check, and the country is what the browser itself just reported over its '
        + 'own network. The likeliest reading is that the browser is not going through the exit at '
        + `all, which would put ${handle} on this machine's address. redbot did not send it to `
        + 'Reddit. Find out which of the two is describing a different machine before launching.');
    }
  }

  /* -- 5 & 6. COVER IT FROM WHAT WAS MEASURED, then send it.
        Both values come from the detection: the zone verbatim, and the locale built from the
        DETECTED country rather than from the exit record, so the clock, the formatting and the
        address cannot drift apart. -- */
  const locale = location.countryCode ? `en-${location.countryCode}` : null;
  try {
    const covered = await deps.cover({
      endpoint,
      handle,
      timezone: location.timezone,
      locale,
      /**
       * NOT NAVIGATED IF IT WAS ALREADY OPEN.
       *
       * `openUrl` reaches alignBrowser, which calls `goto` on `context.pages()[0]` — on a browser
       * redbot spawned that is the about:blank tab it just made, and on one the operator opened it
       * is THEIR first tab, with whatever they were doing in it.
       *
       * The rule this would be imitating — "Reddit LAST, after it is covered" — exists so that
       * nothing ARRIVES anywhere before it has been measured. A browser that is already open has
       * already done its arriving; navigating it again cannot un-arrive it, buys no safety, and
       * costs the operator the tab. So it is covered where it stands and left there.
       */
      openUrl: weSpawnedIt ? deps.loginUrl : undefined
    });
    return {
      ok: true,
      closed: false,
      location,
      locale,
      pagesAligned: (covered && covered.pagesAligned) || 0,
      recorded: {
        timezone: recorded.timezone ?? location.timezone,
        locationId: recorded.locationId ?? null,
        storedIn: recorded.storedIn ?? []
      }
    };
  } catch (e) {
    /* An uncovered window on about:blank is the worst of both states: it looks like the feature
       worked, and the first thing a person does with it is sign in. */
    return refuse(String((e && e.message) || e));
  }
}
