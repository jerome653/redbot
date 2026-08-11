/**
 * What is wrong with the fleet right now — including the case of there being no fleet.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO CLOSE
 *
 * `healthy` was `problems.length === 0`, and every problem came from a loop over the accounts. With
 * ZERO accounts that loop never runs, so there are no problems, so the console reported healthy and
 * painted "all connected" in green — directly above its own banner saying "Setup is not finished. 2
 * things must be settled before redbot can run: An account, A signed-in Chrome."
 *
 * Green did not mean "everything is right". It meant "I found nothing wrong", which is a different
 * claim and is trivially true when you have not looked at anything. Seen on 2026-08-11 on a fresh
 * 2.0.1 install whose store had never had an account in it.
 *
 * It is the same shape as the `ping()` defect 2.0.1 fixed one screen away: "it returned ok for any
 * ledger with a row in it, so a 15-of-16 database satisfied the blocking Database requirement". A
 * check that cannot fail is not a check.
 *
 * So the empty fleet is stated as a problem here rather than left to the absence of one. `/api/setup`
 * already calls it blocking; this only makes the pulse agree with the banner instead of contradicting
 * it a few centimetres above.
 *
 * It is a pure function so the empty case can be tested directly — the case that escaped twice did
 * so precisely because it lived inside a loop, where "no iterations" is invisible.
 */

/**
 * @param browsers array of per-account status entries, each `{handle, port, state, browserUp,
 *                 profileOnDisk, exit}`. An EMPTY array means no accounts are configured, which is
 *                 itself the finding.
 * @returns {string[]} problems, most fundamental first
 */
export function fleetProblems(browsers) {
  /* Not an array at all means the question could not be answered. Saying "no accounts" there would
     be as wrong as the bug above, in the other direction. */
  if (!Array.isArray(browsers)) return ['the account list could not be read'];

  if (browsers.length === 0) {
    return ['no account is configured — redbot does not act as anybody by default'];
  }

  const problems = [];
  for (const b of browsers) {
    /* Ownership is checked BEFORE the folder. A brand-new account has no sign-in folder until its
       Chrome has run once, so testing the folder first let "browser folder is missing" mask "port
       is held by something else" — hiding the one condition that makes redbot act on the wrong
       browser rather than simply not act. */
    if (b.state === 'foreign') problems.push(`${b.handle}: port ${b.port} is held by something else`);
    else if (b.state === 'unknown') problems.push(`${b.handle}: what is on port ${b.port} could not be identified`);
    else if (!b.profileOnDisk) problems.push(`${b.handle}: its browser folder is missing`);
    else if (!b.browserUp) problems.push(`${b.handle}: browser is not open`);

    /* An exit that moved, or died under a running browser, is a PROBLEM — not a detail on another
       screen. Left out, the console reports healthy while an account exits from an address nobody
       vetted. `unknown` is deliberately NOT a problem: it is the absence of an answer, not a fault. */
    if (b.exit && b.exit.state === 'changed') {
      problems.push(`${b.handle}: exit CHANGED — ${b.exit.detail}`);
    } else if (b.exit && b.exit.state === 'stranded') {
      problems.push(`${b.handle}: its exit is down, so the browser can load nothing`);
    }
  }
  return problems;
}
