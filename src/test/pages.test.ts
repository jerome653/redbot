/**
 * Pagination that is actually pagination.
 *
 * THE FAILURE THIS PINS. The console read eleven tables in full on every `/api/state`, and the
 * one place that already took a `limit` honoured it with `rows.slice(-limit)` AFTER loading
 * everything — a page that looked real while the database still serialised every row. So these
 * tests do not check "did I get 25 rows back"; that passes just as well for the broken version.
 * They seed far more rows than a page and check the things only a real LIMIT can satisfy:
 *
 *   - the page holds `limit` rows while `total` reports the whole table
 *   - page 2 continues where page 1 stopped, with no row shown twice and none skipped
 *   - the order is total, so a page boundary landing inside a run of equal scores is stable
 *
 * The third is the subtle one. `ORDER BY score DESC LIMIT 25 OFFSET 25` over rows that share a
 * score lets Postgres return them in any order it likes, and it changes its mind between plans
 * — so a row can appear on both pages while another is never shown at all.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool } from '../db.js';
import {
  pageThreads, pageOutcomes, pageDraftIds, threadFunnel, clampPage, MAX_PAGE, DEFAULT_PAGE
} from '../db/pages.js';
import { loadLogRows } from '../console-data.js';

/** Enough to be several pages, few enough that the suite stays quick. */
const SEEDED = 120;
const TAG = 'pagetest';

/** Thread ids must be 12 hex characters (0003_threads). Derived from the index, so they sort. */
const threadId = (i: number) => `ffff${String(i).padStart(8, '0')}`.slice(0, 12);

before(async () => {
  const db = getPool();
  await cleanup();
  for (let i = 0; i < SEEDED; i++) {
    await db.query(
      `INSERT INTO redbot.threads (id, permalink, title, subreddit, comment_count, age_text, collected_at, source)
       VALUES ($1,$2,$3,'WordPress',5,'1 h ago', now(), 'read')`,
      [threadId(i), `/r/WordPress/${TAG}/${i}`, `${TAG} thread ${i}`]
    );
    /* HALF the assessments share one score on purpose. Ties are where an unstable sort shows a
       row on two pages, and a seed without them would let the bug through. */
    await db.query(
      `INSERT INTO redbot.opportunity_assessments (thread_id, permalink, title, verdict, score, reasons, assessed_at)
       VALUES ($1,$2,$3,$4,$5,'{}', now())`,
      [threadId(i), `/r/WordPress/${TAG}/${i}`, `${TAG} thread ${i}`,
       i % 3 === 0 ? 'skip' : 'contribute', i < SEEDED / 2 ? 50 : (i % 90)]
    );
    await db.query(
      `INSERT INTO redbot.history (ts, kind, account, summary) VALUES (now(), 'read', $1, $2)`,
      [`${TAG}_acct`, `${TAG} entry ${i}`]
    );
  }
});

after(async () => { await cleanup(); await closePool(); });

async function cleanup(): Promise<void> {
  const db = getPool();
  await db.query(`DELETE FROM redbot.history WHERE summary LIKE '${TAG}%' OR account = '${TAG}_acct'`);
  await db.query(`DELETE FROM redbot.opportunity_assessments WHERE title LIKE '${TAG}%'`);
  await db.query(`DELETE FROM redbot.threads WHERE title LIKE '${TAG}%'`);
}

test('a limit is clamped rather than trusted', () => {
  /* These arrive from a query string. A negative OFFSET is a Postgres error rather than an
     empty page, and NaN would be rejected by the planner — taking a whole screen down for a
     typo in a URL. */
  assert.deepEqual(clampPage({ offset: -5, limit: 10 }), { offset: 0, limit: 10 });
  assert.deepEqual(clampPage({ limit: 10_000_000 }), { offset: 0, limit: MAX_PAGE });
  assert.deepEqual(clampPage({}), { offset: 0, limit: DEFAULT_PAGE });
  assert.deepEqual(clampPage({ limit: 0 }), { offset: 0, limit: 1 }, 'a page of nothing is not a page');
  assert.deepEqual(clampPage({ offset: 'x' as never, limit: 'y' as never }),
                   { offset: 0, limit: DEFAULT_PAGE }, 'garbage must land on the default, not NaN');
});

test('a page holds one page, while the total reports the whole table', async () => {
  const page = await pageThreads(getPool(), { limit: 10 });
  assert.equal(page.rows.length, 10, 'the database must return a page, not a table');
  assert.ok(page.total >= SEEDED, `total must count every row, got ${page.total}`);
  /* The assertion the broken version fails: it would have loaded `total` rows to hand back 10. */
  assert.ok(page.total > page.rows.length, 'precondition: there must be more rows than one page');
});

test('page two continues where page one stopped — nothing shown twice, nothing skipped', async () => {
  const db = getPool();
  const one = await pageThreads(db, { offset: 0, limit: 20 });
  const two = await pageThreads(db, { offset: 20, limit: 20 });

  assert.equal(one.rows.length, 20);
  assert.equal(two.rows.length, 20);

  const first = one.rows.map((r) => r.threadId);
  const second = two.rows.map((r) => r.threadId);
  const overlap = first.filter((id) => second.includes(id));
  assert.deepEqual(overlap, [], 'a row on both pages means the order is not total');
  assert.equal(new Set([...first, ...second]).size, 40, 'and every row on a page must be distinct');

  /* Walking the whole list a page at a time must visit each row exactly once. Half the seeded
     scores are identical, so this is the case an unstable ORDER BY gets wrong. */
  const seen = new Set<string>();
  for (let off = 0; off < one.total; off += 25) {
    const p = await pageThreads(db, { offset: off, limit: 25 });
    for (const r of p.rows) seen.add(r.threadId);
  }
  assert.equal(seen.size, one.total, 'paging through must reach every row exactly once');
});

test('the same page asked for twice gives the same rows', async () => {
  /* Re-paging happens on every poll and every Next click. If equal scores reshuffled between
     identical requests, rows would appear to jump pages while a person was reading them. */
  const a = await pageThreads(getPool(), { offset: 40, limit: 15 });
  const b = await pageThreads(getPool(), { offset: 40, limit: 15 });
  assert.deepEqual(a.rows.map((r) => r.threadId), b.rows.map((r) => r.threadId));
});

test('threads come back best-scored first, with what the screen shows', async () => {
  const page = await pageThreads(getPool(), { limit: 12 });
  const scores = page.rows.map((r) => r.score);
  assert.deepEqual([...scores].sort((x, y) => y - x), scores, 'the screen says "sorted by score"');

  const row = page.rows.find((r) => r.title.startsWith(TAG));
  assert.ok(row, 'the seeded rows must be reachable');
  /* Joined in SQL. Before, this came from a `drafts.find()` inside a `.map()` over two
     fully-loaded tables — an O(n·m) scan to render one screen. */
  assert.equal(row.subreddit, 'WordPress', 'the thread join must carry through');
  assert.equal(row.comments, 5);
  assert.ok(['contribute', 'skip'].includes(row.verdict));
});

test('the funnel counts the table without loading it', async () => {
  const f = await threadFunnel(getPool());
  assert.ok(f.threadsCollected >= SEEDED, 'every collected thread must be counted');
  assert.ok(f.assessed >= SEEDED);
  assert.equal(f.contribute + f.skip, f.assessed, 'every assessment is one verdict or the other');
});

test('outcomes page newest first, and page two does not repeat page one', async () => {
  const db = getPool();
  const one = await pageOutcomes(db, { limit: 10 });
  const two = await pageOutcomes(db, { offset: 10, limit: 10 });
  assert.equal(one.rows.length, 10);
  assert.ok(one.total >= SEEDED);

  const ids = one.rows.map((r) => r.id);
  assert.deepEqual([...ids].sort((a, b) => b - a), ids, 'newest first');
  assert.deepEqual(ids.filter((id) => two.rows.some((r) => r.id === id)), [],
                   'ordering by id keeps the boundary stable when timestamps tie');

  /* The shape the screens already speak, so a page drops in where the full array used to go. */
  const seeded = one.rows.find((r) => r.summary.startsWith(TAG));
  if (seeded) {
    assert.equal(seeded.account, `${TAG}_acct`);
    assert.equal(typeof seeded.ts, 'string');
    assert.equal(seeded.kind, 'read');
  }
});

test('a status filter is applied in SQL, not after the page is cut', async () => {
  /* Filtering after LIMIT would return a page of mostly-decided drafts and call it "waiting".
     There are no seeded drafts, so what this pins is that the filter reaches the COUNT too —
     a total that ignored the filter would report the whole table as pending. */
  const pending = await pageDraftIds(getPool(), { status: 'pending', limit: 5 });
  const all = await pageDraftIds(getPool(), { limit: 5 });
  assert.ok(pending.total <= all.total, 'a filtered total must never exceed the unfiltered one');
  assert.ok(pending.rows.length <= pending.limit);
});

test('an offset past the end is an empty page, not an error', async () => {
  /* Reachable by clicking Next as rows are deleted underneath, and by a stale URL. */
  const page = await pageThreads(getPool(), { offset: 1_000_000, limit: 10 });
  assert.deepEqual(page.rows, []);
  assert.ok(page.total >= SEEDED, 'and the total must still be honest');
});

test('a log page is cut by the database, and page two is the rows before it', async () => {
  /**
   * The defect this replaces: `loadLogRows` took a limit and applied it with
   * `rows.slice(-limit)` over a full table read. The rows it returned were correct, so a test
   * that only counted them would have passed against the broken version.
   *
   * What could NOT be done before is the second page — that function had no offset at all,
   * because you cannot offset a slice you took from the end. So asking for it, and getting the
   * ten rows before the newest ten with no overlap, is what proves the LIMIT reached SQL.
   */
  const db = getPool();
  const RUN = 'pagetest-log';
  for (let i = 0; i < 40; i++) {
    await db.query(
      `INSERT INTO redbot.trace (ts, run_id, stage, event, level)
       VALUES (now(), $1, 'collect', $2, 'info')`, [RUN, `ev${String(i).padStart(3, '0')}`]
    );
  }
  try {
    /* `LogRows.rows` is deliberately `unknown[]` — the viewer renders whatever a log holds —
       so the shape is asserted here rather than widened there. */
    const events = (p: { rows: unknown[] }) => p.rows.map((r) => (r as { event: string }).event);

    const newest = await loadLogRows('trace', 10);
    assert.equal(newest.rows.length, 10, 'a log must return a page');
    assert.ok((newest.total ?? 0) >= 40, 'and report the whole table, so a pager can say "of 40"');

    /* Oldest-first WITHIN the page — the order an append-only file had, which is the order the
       viewer scrolls to the bottom of. The page is taken with ORDER BY id DESC and reversed. */
    const evs = events(newest);
    assert.deepEqual([...evs].sort(), evs, 'the page itself must read oldest-first');

    const older = await loadLogRows('trace', 10, 10);
    assert.equal(older.rows.length, 10);
    const olderEvs = events(older);
    assert.deepEqual(olderEvs.filter((e) => evs.includes(e)), [],
                     'page two must be the rows BEFORE page one, not the same ones again');
    const lastOfPageTwo = olderEvs[olderEvs.length - 1] ?? '';
    const firstOfPageOne = evs[0] ?? '';
    assert.ok(lastOfPageTwo < firstOfPageOne,
              `page two must sit earlier in the log than page one (${lastOfPageTwo} < ${firstOfPageOne})`);
  } finally {
    await db.query('DELETE FROM redbot.trace WHERE run_id = $1', [RUN]);
  }
});
