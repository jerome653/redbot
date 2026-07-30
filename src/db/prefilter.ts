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
import { withTransaction } from '../db.js';
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
  _db: Db, dropped: DropRow[], keptThreadIds: string[]
): Promise<void> {
  /**
   * Sorted, because ORDER used to be what avoided deadlocks.
   *
   * On Postgres this transaction took a row lock per dropped thread and, through the foreign
   * key, on the `threads` rows behind them; two transactions taking overlapping locks in
   * DIFFERENT orders deadlock, and that was measured — a run over 122 threads against a
   * concurrent thread delete produced `deadlock detected`. Ascending thread_id gave every
   * writer the same order, so the worst case became waiting rather than aborting.
   *
   * SQLite cannot deadlock here at all: there is one write lock for the whole database and one
   * writer at a time, so there is no second lock to acquire out of order. The sort is KEPT
   * regardless, for a reason that outlives the deadlock: it makes the write order deterministic,
   * which is what lets two runs over the same input be compared. It is no longer load-bearing,
   * and this comment says so rather than leaving a future reader to infer a danger that is gone.
   */
  const inOrder = [...dropped].sort((a, b) => (a.threadId < b.threadId ? -1 : a.threadId > b.threadId ? 1 : 0));
  const keptInOrder = [...keptThreadIds].sort();

  /**
   * `withTransaction`, not a hand-rolled BEGIN/COMMIT/ROLLBACK through `db.query`.
   *
   * The hand-rolled version worked on a pg pool because the pool handed this function its own
   * client. It does NOT work through the SQLite façade: `db.query('BEGIN')` and each statement
   * after it are separate items on the writer queue, so another queued write could land between
   * them — inside this transaction — and a concurrent `withTransaction` would hit "cannot start
   * a transaction within a transaction". The transaction has to be owned by the thing that owns
   * the connection, which is why the parameter above is now unused.
   */
  await withTransaction(async (tx) => {
    /* Threads this run KEPT must lose any drop row they had. A thread whose subreddit was
       added to the pilot set is no longer dropped, and leaving the stale row would report it
       as filtered out while it sits in the assessed list. */
    if (keptInOrder.length) {
      await tx.query(
        `DELETE FROM thread_prefilter
          WHERE thread_id IN (SELECT j.value FROM json_each($1) j)`, [JSON.stringify(keptInOrder)]);
    }
    for (const d of inOrder) {
      await tx.query(
        `INSERT INTO thread_prefilter (thread_id, kind, detail, checked_at)
         VALUES ($1,$2,$3, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT (thread_id) DO UPDATE SET
           kind = EXCLUDED.kind, detail = EXCLUDED.detail, checked_at = EXCLUDED.checked_at`,
        [d.threadId, d.kind, d.detail]
      );
    }
  });
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
  const r = await db.query<{ kind: DropKind; n: number }>(
    `SELECT kind AS kind, count(*) AS n
       FROM thread_prefilter p
      WHERE NOT EXISTS (
        SELECT 1 FROM opportunity_assessments a WHERE a.thread_id = p.thread_id
      )
      GROUP BY kind ORDER BY count(*) DESC, kind`
  );
  const byKind = r.rows.map((x) => ({ kind: x.kind, n: Number(x.n) }));
  return { byKind, total: byKind.reduce((s, k) => s + k.n, 0) };
}
