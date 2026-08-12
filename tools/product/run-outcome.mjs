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
 * @param {{code: number|null, stopped: boolean, out?: string, err?: string}} run
 * @returns {string|null} the sentence to show, or null when there is nothing to report
 */
export function runError({ code, stopped, out = '', err = '' }) {
  /* Asked to stop is not failed — the screen should say Stopped, not show red. */
  if (stopped) return 'Stopped.';
  if (code === 0) return null;

  /* A killed child reports null. That is the 20-minute timer, and "exited with code null" would
     be a worse lie than silence. The timeout fix owns that message; this one does not guess. */
  if (code === null || code === undefined) return null;

  /* stderr last: when a command complains and then carries on printing, the complaint is the
     point. Within each stream the natural order already puts the final word last. */
  const lines = [...String(out).split('\n'), ...String(err).split('\n')]
    .map((l) => l.replace(/\r$/, ''))
    .filter(usable);

  const flagged = lines.filter(isFlagged);
  const chosen = flagged.length ? flagged[flagged.length - 1] : lines[lines.length - 1];

  if (chosen === undefined) return `redbot exited with code ${code}.`;
  return cap(undecorate(chosen));
}
