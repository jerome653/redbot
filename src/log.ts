import { appendHistory } from './store.js';
import type { HistoryKind, HistoryEntry } from './types.js';

/** The account the current run is acting as. Set once per run, stamped on every entry. */
let currentAccount: string | null = null;
export function setAccount(name: string | null): void { currentAccount = name; }
export function getAccount(): string | null { return currentAccount; }

const KNOWN = ['account', 'subreddit', 'threadUrl', 'permalink', 'status'] as const;

/**
 * The four values the `status` column will accept.
 *
 * Kept here as well as in the CHECK constraint (db/sqlite/migrations/0017) because this is where
 * the value is chosen: the column can only refuse a fifth value, and refusing is the failure this
 * module now exists to prevent. `HistoryEntry['status']` is the same list in the type system,
 * which is why a caller inside this codebase normally cannot get it wrong — but `record` takes
 * `extra` as an open bag of unknowns, so the type is not actually load-bearing at this boundary.
 */
export const HISTORY_STATUS = ['ok', 'failed', 'blocked', 'unknown'] as const;

/**
 * Anything not a known HistoryEntry field is tucked into `data`, so callers can pass
 * whatever context is useful without the log schema fighting them.
 *
 * WHY THIS FUNCTION SWALLOWS ITS OWN FAILURE.
 *
 * On 2026-08-19 a `read` of r/marketing collected its threads, saved them, and then died on this
 * write: `CHECK constraint failed: status IS NULL OR status IN ('ok','failed','blocked','unknown')`.
 * The command returned 1 and the console showed a failed run, on a run whose work had already
 * succeeded. Writing down what happened must not be able to undo what happened, so two things
 * changed:
 *
 *   1. A status outside the vocabulary is NORMALISED rather than sent — the column gets 'unknown'
 *      and the raw value is preserved in `data.status`, so the evidence survives and the insert
 *      cannot be refused for that reason.
 *   2. Any remaining write failure is reported on the run's own output and then dropped. It is
 *      loud (`say.warn`, so it reaches the terminal AND the console's run log) and it is not
 *      fatal. The alternative — the one that shipped — is a logger with the power to discard a
 *      completed run.
 */
export async function record(kind: HistoryKind, summary: string, extra: Record<string, unknown> = {}): Promise<void> {
  const entry: HistoryEntry = {
    ts: new Date().toISOString(),
    kind,
    account: (extra.account as string | null | undefined) ?? currentAccount,
    summary
  };
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'account') continue;
    if ((KNOWN as readonly string[]).includes(k)) (entry as unknown as Record<string, unknown>)[k] = v;
    else data[k] = v;
  }

  /* A status the column would refuse is kept as evidence and reported as 'unknown'. `null` and
     `undefined` are not statuses at all — the column is nullable and most rows carry none. */
  if (entry.status !== undefined && entry.status !== null
      && !(HISTORY_STATUS as readonly string[]).includes(entry.status)) {
    data.status = entry.status;
    entry.status = 'unknown';
  }

  if (Object.keys(data).length) entry.data = data;

  try {
    await appendHistory(entry);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    say.warn(`history not recorded (${kind}): ${why}`);
  }
}

export const say = {
  info: (m: string) => console.log(m),
  step: (m: string) => console.log(`  ${m}`),
  ok: (m: string) => console.log(`  OK  ${m}`),
  warn: (m: string) => console.warn(`  !   ${m}`),
  fail: (m: string) => console.error(`  X   ${m}`),
  head: (m: string) => console.log(`\n${m}\n${'-'.repeat(m.length)}`)
};
