/**
 * sources — where redbot looks for threads, in redbot.sources.
 *
 * Public identifiers only: subreddit names and search strings. Nothing collected FROM a
 * source lives here (that is redbot.threads), and no credential does.
 */
import type { Db } from '../db.js';

export type SourceKind = 'subreddit' | 'search';

export interface SourceRecord {
  kind: SourceKind;
  value: string;
  why: string | null;
  enabled: boolean;
}

interface SourceRow {
  kind: SourceKind;
  value: string;
  why: string | null;
  enabled: boolean;
}

/**
 * Add or update sources by (kind, value).
 *
 * `enabled` is overwritten on conflict, deliberately: import means "make the database match
 * this list", and a source switched off in the file must not come back on because the row
 * predates the import.
 */
export async function upsertSources(db: Db, sources: SourceRecord[]): Promise<number> {
  for (const s of sources) {
    await db.query(
      `INSERT INTO redbot.sources (kind, value, why, enabled)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (kind, value) DO UPDATE SET
         why     = EXCLUDED.why,
         enabled = EXCLUDED.enabled`,
      [s.kind, s.value, s.why ?? null, s.enabled]
    );
  }
  return sources.length;
}

/** Every source, on and off. Ordered so a list rendered twice reads the same way twice. */
export async function loadSourcesFromDb(db: Db): Promise<SourceRecord[]> {
  const r = await db.query<SourceRow>(
    `SELECT kind, value, why, enabled FROM redbot.sources ORDER BY kind, value`
  );
  return r.rows.map((row) => ({
    kind: row.kind, value: row.value, why: row.why, enabled: row.enabled
  }));
}

/** One source, or null. Used to tell "already on the list" from "not there to remove". */
export async function getSource(db: Db, kind: SourceKind, value: string): Promise<SourceRecord | null> {
  const r = await db.query<SourceRow>(
    `SELECT kind, value, why, enabled FROM redbot.sources WHERE kind = $1 AND lower(value) = lower($2)`,
    [kind, value]
  );
  const row = r.rows[0];
  return row ? { kind: row.kind, value: row.value, why: row.why, enabled: row.enabled } : null;
}

/** Remove a source. Reports whether there was one, so "gone" differs from "never there". */
export async function deleteSource(db: Db, kind: SourceKind, value: string): Promise<boolean> {
  const r = await db.query(
    'DELETE FROM redbot.sources WHERE kind = $1 AND lower(value) = lower($2)', [kind, value]
  );
  return (r.rowCount ?? 0) > 0;
}

/** Switch a source on or off without losing why it was added. */
export async function setSourceEnabled(
  db: Db, kind: SourceKind, value: string, enabled: boolean
): Promise<boolean> {
  const r = await db.query(
    'UPDATE redbot.sources SET enabled = $3 WHERE kind = $1 AND lower(value) = lower($2)',
    [kind, value, enabled]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function countSources(db: Db): Promise<number> {
  const r = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM redbot.sources');
  return Number(r.rows[0]?.n ?? 0);
}
