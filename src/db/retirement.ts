/**
 * The facts the retirement rules decide from, and the record of what was retired.
 *
 * src/retire.ts holds the rules and touches no database, so this file is the only place the two
 * questions are asked of the record: what has each source actually produced, and which threads
 * are still live work. Both are counted in SQL rather than by loading the corpus — the whole
 * point of retirement is to stop reading 1,913 rows to answer a question about 1,274 of them.
 *
 * EVERY VALUE IS NORMALISED HERE, because an alias does not change what src/db.ts does to it.
 * MEASURED while building this: `s.created_at AS added_iso` still arrives as a `Date`. The
 * facade resolves a result column to its ORIGIN table and column — which it does deliberately,
 * and which its own comment says survives an alias and a LEFT JOIN — so renaming the output
 * buys nothing. A computed column (`count(*)`, `EXISTS …`) has no origin and so is never
 * coerced, and comes back as SQLite stored it: an integer. Both facts are handled below rather
 * than relied on, so a row mapper cannot be the place this breaks.
 */
import type { Db } from '../db.js';
import type { SourceKind } from './sources.js';
import type { SourceYield, ThreadFact, ThreadRetirement } from '../retire.js';

/** A timestamp as an ISO string, whichever of the two shapes the facade handed over. */
const iso = (v: string | Date | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : v;

/**
 * What each source has produced since `sinceIso`, measured in ASSESSED threads.
 *
 * Assessed, not collected: a source that returns rows the prefilter throws away has produced
 * nothing the engine could act on, and counting the collected rows would keep it alive on work
 * that never reached a decision. `opportunity_assessments` is one row per thread (0005), so the
 * count is the number of threads from that source the engine formed an opinion about.
 *
 * A subreddit source is matched by `threads.subreddit`, a search source by the query that
 * collected the thread — the two kinds have different evidence and the same meaning.
 */
export async function sourceYields(db: Db, sinceIso: string): Promise<SourceYield[]> {
  const r = await db.query<{
    kind: SourceKind; value: string; enabled: number;
    added_iso: string | Date | null; assessed: number;
  }>(
    `SELECT s.kind AS kind, s.value AS value, s.enabled AS enabled,
            s.created_at AS added_iso,
            (SELECT count(*) FROM opportunity_assessments a
               JOIN threads t ON t.id = a.thread_id
              WHERE a.assessed_at >= $1
                AND ((s.kind = 'subreddit' AND lower(t.subreddit) = lower(s.value))
                  OR (s.kind = 'search'    AND t.source = 'search' AND t.query = s.value))
            ) AS assessed
       FROM sources s
      ORDER BY s.kind, s.value`,
    [sinceIso]
  );
  return r.rows.map((row) => ({
    kind: row.kind,
    value: row.value,
    enabled: Boolean(row.enabled),
    createdAt: iso(row.added_iso),
    assessedInWindow: Number(row.assessed)
  }));
}

/**
 * Every thread not already retired, with the three facts that keep one alive.
 *
 * `observationWindowStartIso` is the edge of the observation window (OBSERVE_WINDOW_MS in
 * src/commands/observe.ts). A reply published inside it can still have a checkpoint fall due, so
 * the thread behind it is live work; the exact checkpoint arithmetic stays in observe.ts and is
 * deliberately NOT reimplemented here — this asks the conservative question, which keeps more
 * threads than the precise one would.
 */
export async function threadRetirementFacts(
  db: Db, observationWindowStartIso: string
): Promise<ThreadFact[]> {
  const r = await db.query<{
    id: string; collected_iso: string | Date | null;
    has_draft: number; has_published: number; obs_due: number;
  }>(
    `SELECT t.id AS id, t.collected_at AS collected_iso,
            EXISTS (SELECT 1 FROM drafts d WHERE d.thread_id = t.id) AS has_draft,
            EXISTS (SELECT 1 FROM drafts d
                     WHERE d.thread_id = t.id AND d.status = 'published') AS has_published,
            EXISTS (SELECT 1 FROM drafts d
                     WHERE d.thread_id = t.id AND d.status = 'published'
                       AND coalesce(d.decided_at, d.created_at) >= $1) AS obs_due
       FROM threads t
      WHERE NOT EXISTS (SELECT 1 FROM thread_retirement r WHERE r.thread_id = t.id)
      ORDER BY t.collected_at, t.id`,
    [observationWindowStartIso]
  );
  return r.rows.map((row) => ({
    id: row.id,
    collectedAt: iso(row.collected_iso),
    hasDraft: Boolean(row.has_draft),
    hasPublishedReply: Boolean(row.has_published),
    observationDue: Boolean(row.obs_due)
  }));
}

/**
 * Write the retirements down.
 *
 * DO NOTHING on conflict, not an update. A retirement is a decision taken at a moment with the
 * measurement that justified it; re-running the pass must not restate yesterday's reason in
 * today's words, because then nobody can tell when a thread was actually set aside. Returns how
 * many rows were new, so a caller can report what it did rather than what it attempted.
 */
export async function saveThreadRetirements(
  db: Db, rows: readonly ThreadRetirement[]
): Promise<number> {
  let written = 0;
  for (const t of rows) {
    const r = await db.query(
      `INSERT INTO thread_retirement (thread_id, why)
       VALUES ($1,$2) ON CONFLICT (thread_id) DO NOTHING`,
      [t.id, t.why]
    );
    written += r.rowCount ?? 0;
  }
  return written;
}

/** How many threads the scan is skipping. A COUNT, for the same reason countThreadsInDb is one. */
export async function retiredThreadCount(db: Db): Promise<number> {
  const r = await db.query<{ n: number }>('SELECT count(*) AS n FROM thread_retirement');
  return Number(r.rows[0]?.n ?? 0);
}
