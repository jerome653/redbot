/**
 * Terminal prompts. Used by `redbot reply` for the approval step.
 *
 * DEFECT-08: `choose` used to fall back to `options[0]` on unrecognised input. The publish
 * gate calls it with ['a','e','r'], so a blank line, a typo, or a stray newline resolved to
 * "approve" and posted. An approval gate must fail closed, so:
 *
 *   - the safe answer is passed in explicitly, never inferred from position;
 *   - a non-interactive stdin refuses loudly instead of exiting silently;
 *   - unrecognised input re-asks rather than guessing.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export class NoTerminalError extends Error {
  constructor() {
    super(
      'This step needs an interactive terminal, and stdin is not one.\n' +
      '  Approving a reply is a decision a person makes, so redbot will not read it from a\n' +
      '  pipe, a file, or a non-interactive runner.\n' +
      '  Run this in a real terminal window:\n' +
      '    node dist/cli.js reply <draftId>'
    );
    this.name = 'NoTerminalError';
  }
}

/** True when stdin can actually carry a human keystroke. */
export function isInteractive(): boolean {
  return Boolean(stdin.isTTY);
}

/* ------------------------------------------------------------------ *
 * Console approvals
 *
 * DEFECT-08's lesson was that an approval must FAIL CLOSED and be attributable to a person.
 * Requiring a TTY was one way to get that, and it turned out to be the expensive way: it
 * pushed the operator into a terminal for the one action the tool exists to perform.
 *
 * A click in the console, plus the word SEND typed out, plus a reason, is a person deciding.
 * So it is accepted here — under conditions that keep the original guarantee intact:
 *
 *   - the token names ONE draft; it cannot approve a different reply
 *   - it expires in 5 minutes, so an old approval cannot authorise a later send
 *   - it is consumed on read, so one approval sends at most once
 *   - anything malformed, stale, or mismatched is a REFUSAL, never an approval
 *
 * The token is written by the local console into data/approvals/. It is not a credential
 * and grants nothing beyond publishing the single draft it names.
 * ------------------------------------------------------------------ */
import { readFileSync, unlinkSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export interface ConsoleApproval {
  draftId: string;
  decision: 'approved';
  reasonCode?: string;
  note?: string;
  at: string;
}

const APPROVAL_TTL_MS = 5 * 60 * 1000;

export function approvalsDir(dataDir: string): string {
  const d = join(dataDir, 'approvals');
  mkdirSync(d, { recursive: true });
  return d;
}

/**
 * Reads and consumes a console approval for `draftId`. Returns null for every failure —
 * absent, unreadable, wrong draft, expired. A null result means "nobody approved this",
 * which leaves the caller on the interactive path.
 */
export function takeConsoleApproval(dataDir: string, draftId: string): ConsoleApproval | null {
  const file = join(approvalsDir(dataDir), `${draftId}.json`);
  if (!existsSync(file)) return null;

  /**
   * CLAIM the token by renaming it before reading. `rename` is atomic on a local filesystem, so
   * if two readers race, exactly one wins the rename and the other gets ENOENT and returns null.
   * The previous read-then-unlink let both readers see the same token, so one approval could be
   * consumed twice (evaluation, non-atomic take).
   */
  const claimed = `${file}.claim-${process.pid}-${Date.now()}`;
  try {
    renameSync(file, claimed);
  } catch {
    return null;   // someone else claimed it first, or it vanished
  }

  let parsed: ConsoleApproval;
  try {
    parsed = JSON.parse(readFileSync(claimed, 'utf8')) as ConsoleApproval;
  } catch {
    try { unlinkSync(claimed); } catch { /* a token we cannot read is a token we do not keep */ }
    return null;
  }
  // consumed whatever happens next — an approval is single-use even when it is rejected
  try { unlinkSync(claimed); } catch { /* ignore */ }

  if (parsed.draftId !== draftId) return null;
  if (parsed.decision !== 'approved') return null;
  const age = Date.now() - new Date(parsed.at).getTime();
  if (!Number.isFinite(age) || age < 0 || age > APPROVAL_TTL_MS) return null;
  return parsed;
}

export async function ask(question: string): Promise<string> {
  if (!isInteractive()) throw new NoTerminalError();
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function confirm(question: string): Promise<boolean> {
  const a = (await ask(`${question} [y/N] `)).toLowerCase();
  return a === 'y' || a === 'yes';
}

/**
 * Ask until the answer is one of `options`.
 *
 * `safe` is the answer used if the operator gives up (three unrecognised replies). It is a
 * required argument precisely so no caller can inherit "the first option" by accident.
 */
export async function choose(
  question: string,
  options: string[],
  safe: string,
): Promise<string> {
  if (!options.includes(safe)) {
    throw new Error(`choose(): safe answer "${safe}" is not one of ${options.join('/')}`);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const a = (await ask(`${question} (${options.join('/')}) `)).toLowerCase();
    if (options.includes(a)) return a;
    stdout.write(`  Not one of ${options.join(', ')}. Try again.\n`);
  }

  stdout.write(`  No clear answer after three tries — taking the safe option "${safe}".\n`);
  return safe;
}
