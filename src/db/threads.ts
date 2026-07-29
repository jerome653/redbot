/**
 * threads — redbot.threads + redbot.thread_comments.
 *
 * Upsert by id, newest wins, which is the contract saveThreads has always had.
 * Comments are replaced rather than merged: they have no stable
 * Reddit id in the collected shape (src/types.ts:18), so their only identity is their
 * position in the list, and merging two lists by position would silently interleave
 * two different readings of the same thread.
 */
import type { Db } from '../db.js';
import type { Thread, Comment } from '../types.js';

interface ThreadRow {
  id: string;
  permalink: string;
  title: string;
  subreddit: string;
  author: string | null;
  upvotes: number | null;
  comment_count: number | null;
  age_text: string | null;
  age_minutes: number | null;
  body: string | null;
  collected_at: Date;
  source: 'read' | 'search';
  query: string | null;
}

interface CommentRow {
  thread_id: string;
  author: string | null;
  body: string;
  depth: number;
}

export async function upsertThreads(db: Db, threads: Thread[]): Promise<number> {
  for (const t of threads) {
    await db.query(
      `INSERT INTO redbot.threads
         (id, permalink, title, subreddit, author, upvotes, comment_count,
          age_text, age_minutes, body, collected_at, source, query)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         permalink     = EXCLUDED.permalink,
         title         = EXCLUDED.title,
         subreddit     = EXCLUDED.subreddit,
         author        = EXCLUDED.author,
         upvotes       = EXCLUDED.upvotes,
         comment_count = EXCLUDED.comment_count,
         age_text      = EXCLUDED.age_text,
         age_minutes   = EXCLUDED.age_minutes,
         body          = EXCLUDED.body,
         collected_at  = EXCLUDED.collected_at,
         source        = EXCLUDED.source,
         query         = EXCLUDED.query`,
      [
        t.id, t.permalink, t.title, t.subreddit, t.author, t.upvotes, t.commentCount,
        t.ageText, t.ageMinutes, t.body, t.collectedAt, t.source, t.query ?? null
      ]
    );

    await db.query('DELETE FROM redbot.thread_comments WHERE thread_id = $1', [t.id]);
    for (const [i, cm] of (t.comments ?? []).entries()) {
      await db.query(
        `INSERT INTO redbot.thread_comments (thread_id, position, author, body, depth)
         VALUES ($1,$2,$3,$4,$5)`,
        [t.id, i, cm.author, cm.body, cm.depth]
      );
    }
  }
  return threads.length;
}

/**
 * Threads, with their comments.
 *
 * `ids` narrows BOTH queries. Without it this is two full table scans, and the comments one is
 * the heavier of the pair — a collected thread carries every comment redbot read on it, so the
 * child table outgrows the parent by an order of magnitude. The console only ever needs the
 * threads behind the drafts on one page, and passing the ids is what keeps that true of the
 * work as well as of the answer.
 */
export async function loadThreadsFromDb(db: Db, ids?: string[]): Promise<Thread[]> {
  if (ids && !ids.length) return [];
  const where = ids ? 'WHERE id = ANY($1)' : '';
  const commentWhere = ids ? 'WHERE thread_id = ANY($1)' : '';
  const params = ids ? [ids] : [];

  const t = await db.query<ThreadRow>(
    `SELECT id, permalink, title, subreddit, author, upvotes, comment_count,
            age_text, age_minutes, body, collected_at, source, query
       FROM redbot.threads ${where} ORDER BY collected_at DESC, id`,
    params
  );
  const cm = await db.query<CommentRow>(
    `SELECT thread_id, author, body, depth
       FROM redbot.thread_comments ${commentWhere} ORDER BY thread_id, position`,
    params
  );

  const byThread = new Map<string, Comment[]>();
  for (const row of cm.rows) {
    const list = byThread.get(row.thread_id) ?? [];
    list.push({ author: row.author, body: row.body, depth: row.depth });
    byThread.set(row.thread_id, list);
  }

  return t.rows.map((r) => {
    const out: Thread = {
      id: r.id,
      permalink: r.permalink,
      title: r.title,
      subreddit: r.subreddit,
      author: r.author,
      upvotes: r.upvotes,
      commentCount: r.comment_count,
      ageText: r.age_text,
      ageMinutes: r.age_minutes,
      body: r.body,
      comments: byThread.get(r.id) ?? [],
      collectedAt: r.collected_at.toISOString(),
      source: r.source
    };
    if (r.query !== null) out.query = r.query;
    return out;
  });
}

export async function countThreads(db: Db): Promise<number> {
  const r = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM redbot.threads');
  return Number(r.rows[0]?.n ?? 0);
}

/** Which of these thread ids already exist — used to report drafts that would dangle. */
export async function existingThreadIds(db: Db, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const r = await db.query<{ id: string }>(
    'SELECT id FROM redbot.threads WHERE id = ANY($1::text[])', [ids]
  );
  return new Set(r.rows.map((x) => x.id));
}
