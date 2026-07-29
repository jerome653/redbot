/**
 * history — append-only.
 *
 * There is no update and no delete here, and there is not meant to be. The table
 * carries no updated_at and no trigger for the same reason the JSONL file was only
 * ever appended to: it is the record of what happened, and the health state machine
 * and the reliability metrics both read it as one.
 */
import type { Db } from '../db.js';
import type { HistoryEntry } from '../types.js';

interface HistoryRow {
  ts: Date;
  kind: HistoryEntry['kind'];
  account: string | null;
  subreddit: string | null;
  thread_url: string | null;
  permalink: string | null;
  status: HistoryEntry['status'] | null;
  summary: string;
  data: Record<string, unknown> | null;
}

export async function appendHistoryRow(db: Db, e: HistoryEntry): Promise<void> {
  await db.query(
    `INSERT INTO redbot.history
       (ts, kind, account, subreddit, thread_url, permalink, status, summary, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      e.ts, e.kind, e.account ?? null, e.subreddit ?? null, e.threadUrl ?? null,
      e.permalink ?? null, e.status ?? null, e.summary,
      e.data === undefined ? null : JSON.stringify(e.data)
    ]
  );
}

/** Oldest first — loadHistory's callers slice from the end and expect that order. */
/**
 * History, oldest first. With a `limit` the DATABASE cuts the page — see the note on `tail`
 * in src/db/logs.ts for why the newest rows are taken with ORDER BY id DESC and reversed
 * afterwards rather than ordered ascending and sliced.
 */
export async function loadHistoryFromDb(
  db: Db, t?: { limit?: number; offset?: number }
): Promise<HistoryEntry[]> {
  const limit = Math.floor(Number(t?.limit) || 0);
  const offset = Math.max(0, Math.floor(Number(t?.offset) || 0));
  const bounded = limit > 0;
  const r = await db.query<HistoryRow>(
    `SELECT ts, kind, account, subreddit, thread_url, permalink, status, summary, data
       FROM redbot.history
      ${bounded ? 'ORDER BY id DESC LIMIT $1 OFFSET $2' : 'ORDER BY id'}`,
    bounded ? [limit, offset] : []
  );
  if (bounded) r.rows.reverse();
  return r.rows.map((x) => {
    const e: HistoryEntry = {
      ts: x.ts.toISOString(),
      kind: x.kind,
      account: x.account,
      summary: x.summary
    };
    if (x.subreddit !== null) e.subreddit = x.subreddit;
    if (x.thread_url !== null) e.threadUrl = x.thread_url;
    if (x.permalink !== null) e.permalink = x.permalink;
    if (x.status !== null) e.status = x.status;
    if (x.data !== null) e.data = x.data;
    return e;
  });
}

export async function countHistory(db: Db): Promise<number> {
  const r = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM redbot.history');
  return Number(r.rows[0]?.n ?? 0);
}
