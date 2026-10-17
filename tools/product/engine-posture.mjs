/**
 * Is the ENGINE working — as distinct from "are the browsers up".
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO CLOSE, which is the same shape as the one `fleet-posture.mjs` closed.
 *
 * `/api/pulse` computed `problems` from exactly two things: `fleetProblems(browsers)`, and whether
 * `dist/cli.js` exists. `healthy` is `problems.length === 0`. Both inputs can be perfectly green on
 * an install that has done nothing at all for a week and a half.
 *
 * MEASURED 2026-10-16 on this install, all three figures from the same minute:
 *   /api/pulse          ->  healthy: true, problems: []
 *   auto loop           ->  running: false, account: null
 *   newest history row  ->  2026-10-05T10:14:01Z  (eleven days earlier)
 *
 * Thirteen Chrome browsers were up and answering CDP, the build was present, so nothing the pulse
 * looked at was wrong. The console therefore reported health while the engine had collected,
 * drafted and published nothing since 2026-10-05 — and the watchdog that was supposed to notice
 * spent those eleven days restarting the service every 15 minutes instead (474 restarts; see
 * tools/ops/stall-watch.mjs).
 *
 * Green did not mean "it is working". It meant "the things I looked at are fine", and the engine
 * was not one of them.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS AND IS NOT A PROBLEM HERE
 *
 * Both findings below are STATEMENTS OF FACT about recorded state, not judgements about what the
 * operator ought to want:
 *
 *   * the loop is not running — the unattended cycle is what produces every row, so this names
 *     the condition rather than leaving it to be inferred from silence.
 *   * nothing has been recorded for longer than the staleness bound — true whatever the loop
 *     says about itself, which is what makes it the stronger of the two. A loop that reports
 *     `running: true` and writes nothing is the hang the watchdog is for, and it shows up here.
 *
 * A NULL `recordedAt` IS NOT STALENESS. A database with no history at all is a fresh install, not
 * a stalled one, and reporting "nothing recorded ever" as a fault would be the `ping()` defect
 * again in the other direction — a check that fires on a state nothing is wrong with.
 *
 * Pure, and separate from the route, for the reason the sibling file gives: the case that escaped
 * twice escaped because it lived inside a loop where "no iterations" is invisible.
 * ---------------------------------------------------------------------------
 */

/** Longer than this with no `history` row and the engine is not producing. */
export const DEFAULT_STALE_HOURS = 24;

/**
 * @param {object} s
 * @param {boolean} s.autoRunning        is an unattended loop running in this process right now
 * @param {string|null} [s.autoAccount]  which account it is running as, when it is
 * @param {string|null} s.recordedAt     newest `history.ts`, or null when nothing was ever recorded
 * @param {number} [s.staleHours]        the bound; DEFAULT_STALE_HOURS when absent
 * @param {number} [s.now]               epoch ms, injectable for tests
 * @returns {string[]} problems, most fundamental first
 */
export function engineProblems(s) {
  /* Not an object at all means the question could not be answered, and that is reported as such
     rather than as a pass — the distinction `fleetProblems` makes for a missing account list. */
  if (!s || typeof s !== 'object') return ['the engine state could not be read'];

  const problems = [];
  const now = Number.isFinite(s.now) ? s.now : Date.now();
  const staleHours = Number.isFinite(s.staleHours) && s.staleHours > 0 ? s.staleHours : DEFAULT_STALE_HOURS;

  if (s.autoRunning !== true) {
    problems.push(
      'the unattended loop is not running — nothing is being collected, scored, drafted or posted'
    );
  }

  /* `recordedAt` is the engine's own pulse. Parsed rather than trusted: an unparseable timestamp
     is a reading we do not have, and "I cannot tell" is reported, never silently treated as
     fresh. */
  if (typeof s.recordedAt === 'string' && s.recordedAt) {
    const ms = Date.parse(s.recordedAt);
    if (!Number.isFinite(ms)) {
      problems.push(`the newest recorded entry has an unreadable timestamp ("${s.recordedAt}")`);
    } else {
      const ageH = (now - ms) / 3_600_000;
      if (ageH > staleHours) {
        const age = ageH >= 48 ? `${Math.floor(ageH / 24)} days` : `${Math.floor(ageH)}h`;
        problems.push(
          `nothing has been recorded for ${age} — the app is up and the engine is producing nothing`
        );
      }
    }
  }

  return problems;
}
