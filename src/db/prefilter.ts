/**
 * Why a collected thread never reached a model call.
 *
 * `prefilter()` (src/commands/opportunity.ts) has always known this per thread and always threw
 * it away — printed to the terminal and gone. So the console could report "71 never assessed"
 * and nothing more, which is a number an operator cannot act on. Persisting the verdict turns
 * it into "58 outside the pilot set", which says plainly that a source is collecting threads
 * nothing will ever reply in.
 *
 * DERIVED, NOT EVIDENCE. Every row here is recomputed by the next run from threads still on
 * record. That is what makes 0014's down-migration safe, and it is why the write below is a
 * full reconciliation rather than an append: the age rule is measured against the current time,
 * so a thread that was eligible yesterday is legitimately dropped today, and one that was
 * dropped for a subreddit that has since joined the pilot set is legitimately kept.
 */
import type { Db } from '../db.js';
import type { DropKind } from '../commands/opportunity.js';

export interface DropRow { threadId: string; kind: DropKind; detail: string }

/**
 * Record this run's drops and clear the threads it kept.
 *
 * Both halves in ONE transaction. Without it a crash between them leaves the table describing
 * two different runs at once — a thread counted as dropped that this run actually kept — and
 * the breakdown then adds up to more than were collected, which is the kind of arithmetic that
 * makes a person stop trusting the screen.
 */
export async function savePrefilterOutcome(
  db: Db, dropped: DropRow[], keptThreadIds: string[]
): Promise<void> {
  /**
   * Sorted, because lock ORDER is what avoids deadlocks.
   *
   * This transaction touches one row per dropped thread and, through the foreign key, the
   * `redbot.threads` rows behind them. Anything else working on those threads at the same time
   * — another run, a collect, a delete — takes overlapping locks, and two transactions that
   * acquire the same locks in DIFFERENT orders deadlock. Measured: a run over 122 threads
   * against a concurrent thread delete produced `deadlock detected`. Ascending thread_id gives
   * every writer here the same order, so the worst case becomes waiting rather than aborting.
   */
  const inOrder = [...dropped].sort((a, b) => (a.threadId < b.threadId ? -1 : a.threadId > b.threadId ? 1 : 0));
  const keptInOrder = [...keptThreadIds].sort();

  await db.query('BEGIN');
  try {
    /* Threads this run KEPT must lose any drop row they had. A thread whose subreddit was
       added to the pilot set is no longer dropped, and leaving the stale row would report it
       as filtered out while it sits in the assessed list. */
    if (keptInOrder.length) {
      await db.query(
        `DELETE FROM redbot.thread_prefilter
          WHERE thread_id IN (SELECT unnest($1::text[]) ORDER BY 1)`, [keptInOrder]);
    }
    for (const d of inOrder) {
      await db.query(
        `INSERT INTO redbot.thread_prefilter (thread_id, kind, detail, checked_at)
         VALUES ($1,$2,$3, now())
         ON CONFLICT (thread_id) DO UPDATE SET
           kind = EXCLUDED.kind, detail = EXCLUDED.detail, checked_at = EXCLUDED.checked_at`,
        [d.threadId, d.kind, d.detail]
      );
    }
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => { /* the original error is the one worth raising */ });
    throw e;
  }
}

export interface PrefilterBreakdown {
  /** Per rule, newest-first by count. Empty when the filter has never been run. */
  byKind: { kind: DropKind; n: number }[];
  /** Every dropped thread, all rules together. */
  total: number;
}

/**
 * How many threads each rule caught, among those that were NEVER ASSESSED.
 *
 * The exclusion is the whole subtlety. `dropped` is not a subset of `never assessed`: the
 * prefilter re-runs over every thread, including ones assessed long ago, and the age rule is
 * measured against the current time — so a thread analysed while it was fresh is legitimately
 * dropped once it passes the 72h ceiling. Measured on live data: 116 collected, 30 assessed,
 * 87 dropped. 30 + 87 = 117, one more than exist, because "Inside my wp2shell infected
 * website" was both. The console subtracts this total from `collected − assessed` to show what
 * is merely waiting, and that arithmetic went NEGATIVE.
 *
 * So the question this answers is the one the panel actually asks — why did the threads that
 * never got assessed never get assessed — and a thread that WAS assessed is not part of it,
 * whatever the filter thinks of it today.
 */
export async function prefilterBreakdown(db: Db): Promise<PrefilterBreakdown> {
  const r = await db.query<{ kind: DropKind; n: string }>(
    `SELECT kind::text AS kind, count(*)::text AS n
       FROM redbot.thread_prefilter p
      WHERE NOT EXISTS (
        SELECT 1 FROM redbot.opportunity_assessments a WHERE a.thread_id = p.thread_id
      )
      GROUP BY kind ORDER BY count(*) DESC, kind`
  );
  const byKind = r.rows.map((x) => ({ kind: x.kind, n: Number(x.n) }));
  return { byKind, total: byKind.reduce((s, k) => s + k.n, 0) };
}
