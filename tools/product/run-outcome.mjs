/**
 * What to tell the operator when a run exits non-zero.
 *
 * THE PROBLEM THIS SOLVES. `runAction` judged every run by its exit code alone and attached no
 * error text, so the front end fell back to a hardcoded string — `sc.error || 'scoring did not
 * work'`. On 2026-08-11 that sentence was shown six times for a run in which scoring never
 * started: the prefilter kept nothing, `opportunity()` returned early, and the CLI had already
 * printed the actual reason on stderr. The console threw the reason away and invented a worse one.
 *
 * The rule, stated once: A FAILURE'S REASON IS THE LAST THING IT EXPLICITLY FLAGGED AS A PROBLEM;
 * if it flagged nothing, it is the last thing it said. `say.fail` writes `  X   `, `say.warn`
 * writes `  !   ` (src/log.ts) — those marks are the CLI telling us which of its lines is the
 * point, and honouring them is why this beats "print the last line" on a command that reports
 * progress after the thing that went wrong.
 *
 * It is a pure function on purpose. The console and its tests read the same code, which is the
 * lesson of exit-posture.mjs and fleet-posture.mjs: two places deriving the same answer separately
 * is how they come to disagree.
 */

/** Longer than this is a stack trace or a dumped payload, not a sentence for a person. */
const CAP = 300;

/* `  X   msg` · `  !   msg` · `  OK  msg` — exact spacing from src/log.ts. */
const FLAGGED = [/^ {2}X {3}(.*)$/, /^ {2}! {3}(.*)$/];
const PLAIN = [/^ {2}OK {2}(.*)$/, /^ {2}(.*)$/];

/** `say.head` underlines itself. The rule is decoration and can never be the reason. */
const RULE = /^-{3,}$/;

function undecorate(line) {
  for (const re of [...FLAGGED, ...PLAIN]) {
    const m = re.exec(line);
    if (m) return m[1].trim();
  }
  return line.trim();
}

function isFlagged(line) {
  return FLAGGED.some((re) => re.test(line));
}

function usable(line) {
  const bare = undecorate(line);
  return bare.length > 0 && !RULE.test(bare);
}

function cap(text) {
  return text.length > CAP ? `${text.slice(0, CAP)}…` : text;
}

/**
 * `opportunity` exits with this when there was simply nothing to work on — no threads collected,
 * or nothing left after the prefilter. It is deliberately non-zero because nothing downstream
 * ran, and it is NOT a failure.
 *
 * The constant existed in src/commands/opportunity.ts from the day that exit was written, so a
 * caller could branch without parsing English. Nothing ever branched. `runAction` judged runs by
 * `ok: code === 0`, so an empty corpus came back as a failed run, and the collect chain's
 * `if(!sc.ok) throw` painted an entire successful collect red — over a message telling a desktop
 * operator to go and run a terminal command. Reported 2026-08-14.
 *
 * It is redeclared here rather than imported because this module is plain JS the console loads
 * directly, and dist/ may not be built when it does. The two are pinned together by a test.
 */
export const NOTHING_TO_DO = 2;

/** The line that is the point: the last one flagged as a problem, else the last one said. */
function chosenLine(out, err) {
  /* stderr last: when a command complains and then carries on printing, the complaint is the
     point. Within each stream the natural order already puts the final word last. */
  const lines = [...String(out).split('\n'), ...String(err).split('\n')]
    .map((l) => l.replace(/\r$/, ''))
    .filter(usable);
  const flagged = lines.filter(isFlagged);
  return flagged.length ? flagged[flagged.length - 1] : lines[lines.length - 1];
}

/**
 * What to tell the operator when a run did nothing, having failed at nothing.
 *
 * @param {{code: number|null, out?: string, err?: string}} run
 * @returns {string|null} the command's own sentence, or null when it said nothing usable
 */
export function runNote({ code, out = '', err = '' }) {
  if (code !== NOTHING_TO_DO) return null;
  const chosen = chosenLine(out, err);
  /* No invention. A caller knows it was a nothing-to-do run from the flag; a sentence made up
     here would be the console speaking in the CLI's voice about something it did not observe. */
  return chosen === undefined ? null : cap(undecorate(chosen));
}

/**
 * @param {{code: number|null, stopped: boolean, out?: string, err?: string}} run
 * @returns {string|null} the sentence to show, or null when there is nothing to report
 */
export function runError({ code, stopped, out = '', err = '' }) {
  /* Asked to stop is not failed — the screen should say Stopped, not show red. */
  if (stopped) return 'Stopped.';
  if (code === 0) return null;
  /* Nothing to do is not a failure. Its sentence is still worth showing, and runNote carries it. */
  if (code === NOTHING_TO_DO) return null;

  /* A killed child reports null. That is the 20-minute timer, and "exited with code null" would
     be a worse lie than silence. The timeout fix owns that message; this one does not guess. */
  if (code === null || code === undefined) return null;

  const chosen = chosenLine(out, err);
  if (chosen === undefined) return `redbot exited with code ${code}.`;
  return cap(undecorate(chosen));
}
