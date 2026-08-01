/**
 * One page of a list, and how many there are in total — computed by the DATABASE.
 *
 * WHY THIS EXISTS. `loadConsoleDomain` read eleven tables in full on every `/api/state`, and
 * every figure on every screen was `array.length` over the result. That is fine at 16 threads
 * and ruinous at 16,000: the console cannot paint until Postgres has serialised every row it
 * will never show, and the browser then builds a DOM node for each one.
 *
 * The trap this avoids is the pagination that isn't. `readConsoleLog` already took a `limit`
 * and honoured it with `rows.slice(-limit)` AFTER loading the whole table — the page was real,
 * the saving was not. Every query here therefore carries LIMIT and OFFSET into the SQL, and
 * every total is a COUNT the database answers without returning rows. If a function in this
 * file ever slices in JavaScript, it has stopped doing its job.
 *
 * Ordering is always explicit and always unique-tie-broken. `LIMIT` without a total order is
 * how a row appears on page 1 and page 2 while another is never shown at all — Postgres is
 * free to return equal-ranked rows in any order it likes, and it does change its mind between
 * plans.
 */
import type { Db } from '../db.js';

/** Sane bounds. A caller asking for a million rows is asking for the thing this file prevents. */
export const DEFAULT_PAGE = 25;
export const MAX_PAGE = 200;

export interface PageQuery { offset?: number; limit?: number }

export interface Page<T> {
  rows: T[];
  /** How many rows exist ALTOGETHER — from COUNT(*), not from `rows.length`. */
  total: number;
  offset: number;
  limit: number;
}

/**
 * Clamp what arrived from a query string.
 *
 * A negative OFFSET is a Postgres error rather than an empty page, and an absent or unparseable
 * limit must land on the default instead of NaN — which SQL would reject and which would take
 * the whole screen down for a typo in a URL.
 */
export function clampPage(q: PageQuery): { offset: number; limit: number } {
  /**
   * `Number.isFinite`, not `||`. A falsy check cannot tell "absent" from "zero", so `limit=0`
   * was silently becoming 25 — an explicit instruction replaced by a default without a word,
   * which is the same class of quiet dishonesty as the `slice(-limit)` this file replaced.
   * Absent or unparseable takes the default; a number that was actually given is clamped into
   * range so the caller gets something as close to what it asked for as the bounds allow.
   */
  const rawOffset = Number(q.offset);
  const rawLimit = Number(q.limit);
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  const asked = Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_PAGE;
  return { offset, limit: Math.min(MAX_PAGE, Math.max(1, asked)) };
}

export interface ThreadPageRow {
  threadId: string;
  title: string;
  permalink: string;
  verdict: string;
  score: number;
  thesis: { whyThread: string | null; whatNew: string | null; whyNotSilent: string | null };
  reasons: string[];
  subreddit: string | null;
  comments: number | null;
  ageText: string | null;
  draftId: string | null;
  draftStatus: string | null;
}


/**
 * The Threads screen, second list: COLLECTED BUT NEVER ASSESSED.
 *
 * WHY THIS EXISTS. `pageThreads` above selects `FROM opportunity_assessments`, so a thread the
 * mechanical prefilter dropped is in `threads`, counted in the funnel, and invisible everywhere
 * else. Measured on this machine: 20 collected, 0 rows sent to the console, and the only account
 * of what those twenty were lived in a run log that scrolls away.
 *
 * "20 collected · 0 looked at" is honest and useless. An operator whose sources are pointed at the
 * wrong place sees a screen reporting nothing and has no way to find out what came back or why it
 * was refused — which is exactly the state that produced two minutes of browser work for nothing.
 *
 * The join is LEFT: a thread can be collected and not yet run through the prefilter at all, and
 * that is a different fact from being dropped. It is reported as such rather than being given a
 * reason it was never assigned.
 */
export interface DroppedThreadRow {
  threadId: string;
  title: string;
  permalink: string;
  subreddit: string | null;
  commentCount: number | null;
  ageText: string | null;
  /** The rule that dropped it, or null when it has not been through the prefilter yet. */
  kind: string | null;
  /** The sentence the filter wrote for a person, verbatim. */
  detail: string | null;
}

export async function pageDroppedThreads(db: Db, q: PageQuery = {}): Promise<Page<DroppedThreadRow>> {
  const { offset, limit } = clampPage(q);

  const t = await db.query<{ n: number }>(
    `SELECT count(*) AS n FROM threads t
      WHERE NOT EXISTS (SELECT 1 FROM opportunity_assessments a WHERE a.thread_id = t.id)`
  );
  const total = Number(t.rows[0]?.n ?? 0);

  const r = await db.query<{
    id: string; title: string; permalink: string; subreddit: string | null;
    comment_count: number | null; age_text: string | null;
    kind: string | null; detail: string | null;
  }>(
    /* Newest first: a thread that has just been collected and refused is the one somebody is
       asking about, and `id` breaks ties so a page boundary cannot repeat or skip a row. */
    `SELECT t.id, t.title, t.permalink, t.subreddit, t.comment_count, t.age_text,
            p.kind, p.detail
       FROM threads t
       LEFT JOIN thread_prefilter p ON p.thread_id = t.id
      WHERE NOT EXISTS (SELECT 1 FROM opportunity_assessments a WHERE a.thread_id = t.id)
      ORDER BY t.collected_at DESC, t.id
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return {
    total, offset, limit,
    rows: r.rows.map((x) => ({
      threadId: x.id,
      title: x.title,
      permalink: x.permalink,
      subreddit: x.subreddit,
      commentCount: x.comment_count == null ? null : Number(x.comment_count),
      ageText: x.age_text,
      kind: x.kind,
      detail: x.detail
    }))
  };
}

/**
 * The Threads screen: assessed threads, best score first.
 *
 * Joined in SQL rather than stitched in JavaScript, which is what makes the page a page. The
 * previous version loaded every assessment, every thread and every draft, then did
 * `assessments.sort().map()` with a `drafts.find()` inside the map — an O(n·m) scan over two
 * fully-materialised tables to render twenty-five rows.
 *
 * `thread_id` breaks score ties so the order is total: without it a page boundary falling
 * inside a run of equal scores can show one row twice and another never.
 */
export async function pageThreads(db: Db, q: PageQuery = {}): Promise<Page<ThreadPageRow>> {
  const { offset, limit } = clampPage(q);
  const total = await countRows(db, 'opportunity_assessments');

  const r = await db.query<{
    thread_id: string; title: string; permalink: string; verdict: string; score: number;
    thesis_why_thread: string | null; thesis_what_new: string | null; thesis_why_not_silent: string | null;
    reasons: string[]; subreddit: string | null; comment_count: number | null; age_text: string | null;
    draft_id: string | null; draft_status: string | null;
  }>(
    /* One draft per thread in practice; picking exactly one keeps that true for the join even
       if a second is ever written, rather than duplicating the thread's row on this screen.

       This was `LEFT JOIN LATERAL (… ORDER BY created_at DESC LIMIT 1) d ON true`. SQLite has
       no LATERAL, so the newest draft is fetched by two correlated scalar subqueries instead.
       They agree with each other because both order by the same total key: `created_at DESC,
       id DESC`. Ordering by created_at alone — which the LATERAL did, since it selected both
       columns in one pass — would let two drafts written in the same millisecond return the id
       of one and the status of the other. The LATERAL could not produce that mismatch; two
       subqueries can, so the tie-break is what makes the translation safe. */
    `SELECT a.thread_id, a.title, a.permalink, a.verdict AS verdict, a.score,
            a.thesis_why_thread, a.thesis_what_new, a.thesis_why_not_silent, a.reasons,
            t.subreddit, t.comment_count, t.age_text,
            (SELECT d.id     FROM drafts d WHERE d.thread_id = a.thread_id
              ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS draft_id,
            (SELECT d.status FROM drafts d WHERE d.thread_id = a.thread_id
              ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS draft_status
       FROM opportunity_assessments a
       LEFT JOIN threads t ON t.id = a.thread_id
      ORDER BY a.score DESC, a.thread_id
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return {
    total, offset, limit,
    rows: r.rows.map((x) => ({
      threadId: x.thread_id,
      title: x.title,
      permalink: x.permalink,
      verdict: x.verdict,
      score: x.score,
      thesis: {
        whyThread: x.thesis_why_thread,
        whatNew: x.thesis_what_new,
        whyNotSilent: x.thesis_why_not_silent
      },
      reasons: x.reasons ?? [],
      subreddit: x.subreddit,
      comments: x.comment_count,
      ageText: x.age_text,
      draftId: x.draft_id,
      draftStatus: x.draft_status
    }))
  };
}

/**
 * The Threads screen's funnel, as five COUNTs instead of five array lengths.
 *
 * One round trip, because five separate counts on a growing database is four more waits than
 * the screen needs.
 */
export async function threadFunnel(db: Db): Promise<{
  threadsCollected: number; assessed: number; contribute: number; skip: number;
  gapsAnalysed: number; drafted: number;
}> {
  const r = await db.query<Record<string, string>>(
    `SELECT (SELECT count(*) FROM threads)                                        AS threads,
            (SELECT count(*) FROM opportunity_assessments)                        AS assessed,
            (SELECT count(*) FROM opportunity_assessments WHERE verdict='contribute') AS contribute,
            (SELECT count(*) FROM opportunity_assessments WHERE verdict='skip')   AS skip,
            (SELECT count(*) FROM gap_analyses)                                   AS gaps,
            (SELECT count(*) FROM drafts)                                         AS drafted`
  );
  const row = r.rows[0] ?? {};
  const n = (k: string) => Number(row[k] ?? 0);
  return {
    threadsCollected: n('threads'), assessed: n('assessed'),
    contribute: n('contribute'), skip: n('skip'),
    gapsAnalysed: n('gaps'), drafted: n('drafted')
  };
}

/**
 * Draft ids for the Review screen, newest first, one page at a time.
 *
 * IDS ONLY, deliberately. A draft carries its body, its certification and its thread, and the
 * console needs all of that — but assembling it for rows nobody is looking at is the cost this
 * file exists to remove. The caller takes these ids and hydrates just them.
 *
 * `status` filters in SQL because the screen's default view is the pending queue: filtering
 * after the LIMIT would return a page of mostly-decided drafts and call it "25 waiting".
 */
export async function pageDraftIds(
  db: Db, q: PageQuery & { status?: string } = {}
): Promise<Page<string>> {
  const { offset, limit } = clampPage(q);
  const wantStatus = typeof q.status === 'string' && q.status ? q.status : null;

  const totalRes = await db.query<{ n: number }>(
    wantStatus
      ? 'SELECT count(*) AS n FROM drafts WHERE status = $1'
      : 'SELECT count(*) AS n FROM drafts',
    wantStatus ? [wantStatus] : []
  );

  const rows = await db.query<{ id: string }>(
    `SELECT id FROM drafts
      ${wantStatus ? 'WHERE status = $3' : ''}
      ORDER BY created_at DESC, id
      LIMIT $1 OFFSET $2`,
    wantStatus ? [limit, offset, wantStatus] : [limit, offset]
  );

  return {
    rows: rows.rows.map((x) => x.id),
    total: Number(totalRes.rows[0]?.n ?? 0),
    offset, limit
  };
}

/**
 * Shaped exactly like `HistoryEntry` (src/types.ts), plus the row id the pager orders by.
 *
 * Matching the existing shape rather than inventing a tidier one: every screen that reads
 * history already speaks it, so a page drops straight in where the full array used to go.
 */
export interface OutcomePageRow {
  id: number;
  ts: string;
  kind: string;
  account: string | null;
  summary: string;
  subreddit?: string;
  threadUrl?: string;
  permalink?: string;
  status?: string;
  data?: unknown;
}

/**
 * The Results screen: what redbot actually did, newest first.
 *
 * `id DESC` and not `ts DESC`: the timestamp is written by the caller and two entries in the
 * same run routinely share one, so ordering by it alone leaves the page boundary free to
 * reshuffle between requests. The identity column is monotonic and unique, which is what a
 * stable page needs.
 */
export async function pageOutcomes(db: Db, q: PageQuery = {}): Promise<Page<OutcomePageRow>> {
  const { offset, limit } = clampPage(q);
  const total = await countRows(db, 'history');

  const r = await db.query<{
    id: string; ts: Date; kind: string; account: string | null; subreddit: string | null;
    thread_url: string | null; permalink: string | null; status: string | null;
    summary: string; data: unknown;
  }>(
    `SELECT id, ts, kind AS kind, account, subreddit, thread_url, permalink,
            status AS status, summary, data
       FROM history
      ORDER BY id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return {
    total, offset, limit,
    rows: r.rows.map((x) => {
      const e: OutcomePageRow = {
        id: Number(x.id),
        ts: x.ts instanceof Date ? x.ts.toISOString() : String(x.ts),
        kind: x.kind,
        account: x.account,
        summary: x.summary
      };
      // Same "absent stays absent" rule as loadHistoryFromDb: a null column is a key the
      // record never had, not a key whose value is null.
      if (x.subreddit !== null) e.subreddit = x.subreddit;
      if (x.thread_url !== null) e.threadUrl = x.thread_url;
      if (x.permalink !== null) e.permalink = x.permalink;
      if (x.status !== null) e.status = x.status;
      if (x.data !== null) e.data = x.data;
      return e;
    })
  };
}

export interface ObservationPageRow {
  ts: string;
  account: string | null;
  kind: string;
  vector: string;
  value: unknown;
  note: string | null;
  checkpoint: string | null;
  permalink: string | null;
}

/**
 * The Results screen: what has actually been measured, newest first.
 *
 * This is the list that screen renders a row per — not history, which feeds the counts. It
 * grows with every karma probe and every checkpoint reading, so it is a slow but genuinely
 * unbounded table: one that looks harmless for months and then is not.
 *
 * `id DESC` for the same reason as outcomes: a checkpoint reading is written now but carries a
 * BACK-DATED `ts` (src/db/logs.ts says so at the top), so ordering by timestamp would let a row
 * move between pages after it was written. The append order cannot.
 */
export async function pageObservations(db: Db, q: PageQuery = {}): Promise<Page<ObservationPageRow>> {
  const { offset, limit } = clampPage(q);
  const total = await countRows(db, 'observations');

  const r = await db.query<{
    ts: Date; account: string | null; kind: string; vector: string; value: unknown;
    note: string | null; checkpoint: string | null; permalink: string | null;
  }>(
    `SELECT ts, account, kind AS kind, vector AS vector, value, note,
            checkpoint AS checkpoint, permalink
       FROM observations
      ORDER BY id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return {
    total, offset, limit,
    rows: r.rows.map((x) => ({
      ts: x.ts instanceof Date ? x.ts.toISOString() : String(x.ts),
      account: x.account,
      kind: x.kind,
      vector: x.vector,
      value: x.value,
      note: x.note,
      checkpoint: x.checkpoint,
      permalink: x.permalink
    }))
  };
}

/**
 * How many drafts there are, and how many are still waiting on a person.
 *
 * The Review screen's header counts the QUEUE, not the page. Deriving "3 waiting" from a page
 * of twenty-five would report three when there are three hundred — and this is the one number
 * on that screen a person acts on.
 */
export async function draftCounts(db: Db): Promise<{ total: number; pending: number }> {
  const r = await db.query<{ total: string; pending: string }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE status = 'pending') AS pending
       FROM drafts`
  );
  return { total: Number(r.rows[0]?.total ?? 0), pending: Number(r.rows[0]?.pending ?? 0) };
}

export interface CheckpointTally { checkpoint: string; taken: number; latestTs: string | null }

/**
 * How many readings exist at each checkpoint, and the most recent one.
 *
 * Aggregated in SQL because the Results screen derives this from the observation list, and the
 * list is now one page. Deriving "has the 24h check run?" from twenty-five rows would answer
 * "not run" for a checkpoint that ran a thousand readings ago — a screen confidently reporting
 * the opposite of the record, which is worse than a slow screen.
 */
export async function checkpointSummary(db: Db): Promise<CheckpointTally[]> {
  const r = await db.query<{ checkpoint: string; n: string; latest: Date | null }>(
    `SELECT checkpoint AS checkpoint, count(*) AS n, max(ts) AS latest
       FROM observations
      WHERE checkpoint IS NOT NULL
      GROUP BY checkpoint`
  );
  return r.rows.map((x) => ({
    checkpoint: x.checkpoint,
    taken: Number(x.n),
    latestTs: x.latest instanceof Date ? x.latest.toISOString() : (x.latest ? String(x.latest) : null)
  }));
}

/**
 * The only tables this module may count. An ALLOW-LIST, not a pattern.
 *
 * The guard used to be `/^redbot\.[a-z_]+$/`, and dropping the schema prefix would have left
 * `/^[a-z_]+$/` — which accepts any identifier and so guards almost nothing. Since there are
 * exactly three call sites and all three pass a literal, naming them is both stricter than the
 * original and impossible to get wrong later.
 */
const COUNTABLE = new Set(['opportunity_assessments', 'history', 'observations']);

/**
 * COUNT(*) on a table named by this module, never by a caller.
 *
 * The table name cannot be a bound parameter, so it is interpolated — which is exactly the
 * shape of an injection if the value ever comes from a request. It never does: every call site
 * passes a literal from this file, and the guard below makes an accidental future one fail
 * loudly instead of reaching the planner.
 */
async function countRows(db: Db, table: string): Promise<number> {
  if (!COUNTABLE.has(table)) throw new Error(`refusing to count "${table}"`);
  const r = await db.query<{ n: number }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(r.rows[0]?.n ?? 0);
}
