/**
 * The prefilter's verdict, written down.
 *
 * WHAT THIS IS FOR. `prefilter()` has always known why each thread was dropped and always threw
 * it away, so the console could only say "71 never assessed" — a number nobody can act on. The
 * interesting behaviour is not the insert; it is the RECONCILIATION. The age rule is measured
 * against the current time, so eligibility genuinely changes between runs: a thread eligible
 * yesterday is legitimately dropped today, and one dropped for its subreddit becomes eligible
 * the day that subreddit joins the pilot set. A table that only accumulated would describe the
 * filter as it once was, and the breakdown would add up to more threads than were collected.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool } from '../db.js';
import { savePrefilterOutcome, prefilterBreakdown } from '../db/prefilter.js';
import { prefilter } from '../commands/opportunity.js';
import type { Thread } from '../types.js';

const TAG = 'preftest';
const id = (n: number) => `dddd${String(n).padStart(8, '0')}`.slice(0, 12);

/** A collected thread, with the knobs each prefilter rule reads. */
function thread(n: number, over: Partial<Thread> = {}): Thread {
  return {
    id: id(n),
    permalink: `/r/wordpress/${TAG}/${n}`,
    title: `${TAG} how do I fix this?`,
    subreddit: 'wordpress',
    author: 'someone',
    upvotes: 1,
    commentCount: 2,
    ageText: '1 h ago',
    ageMinutes: 60,
    body: 'something is broken, what should I check?',
    collectedAt: new Date().toISOString(),
    source: 'read',
    comments: [],
    ...over
  } as Thread;
}

/** Exactly the ids this file owns. */
const MINE = Array.from({ length: 6 }, (_, n) => id(n));

before(async () => {
  const db = getPool();
  await cleanup();
  for (let n = 0; n < 6; n++) {
    await db.query(
      `INSERT INTO threads (id, permalink, title, subreddit, comment_count, age_text, collected_at, source)
       VALUES ($1,$2,$3,'wordpress',2,'1 h ago', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'read')`,
      [id(n), `/r/wordpress/${TAG}/${n}`, `${TAG} thread ${n}`]
    );
  }
});

after(async () => { await cleanup(); await closePool(); });


/**
 * Delete BY PRIMARY KEY, never by `title LIKE`.
 *
 * Test files share one database within a run (db/reset-test-db.mjs truncates once, up front,
 * so the suite can stay parallel). A `LIKE` delete is a sequential scan that takes locks across
 * the whole table, and with `thread_prefilter` cascading off `threads` two such scans running
 * in different files deadlocked — measured, as `deadlock detected` in pages.test.js. Naming the
 * six rows makes the lock set small and its order deterministic.
 */
async function cleanup(): Promise<void> {
  const db = getPool();
  await db.query('DELETE FROM thread_prefilter WHERE thread_id IN (SELECT j.value FROM json_each($1) j)', [JSON.stringify(MINE)]);
  await db.query('DELETE FROM threads WHERE id IN (SELECT j.value FROM json_each($1) j)', [JSON.stringify(MINE)]);
}

/**
 * Empty the drop table before each test that asserts a TOTAL.
 *
 * These share one table, and `prefilterBreakdown` counts all of it — so without this each test
 * measures the rows its predecessors left behind, and the failure appears in whichever test
 * happens to run second rather than in the one that is wrong.
 */
async function reset(): Promise<void> {
  await getPool().query('DELETE FROM thread_prefilter WHERE thread_id IN (SELECT j.value FROM json_each($1) j)', [JSON.stringify(MINE)]);
}


/**
 * The breakdown restricted to THIS file's threads.
 *
 * `prefilterBreakdown` counts the whole table, which is right for the console and wrong here.
 * `server.test.mjs` exercises the `score` action, and that action really is `redbot
 * opportunity` — so it really does record a drop for every thread any other file seeded. A
 * global assertion would be asserting whatever the rest of the suite happened to do, which is
 * the flakiness db/reset-test-db.mjs warns about: files share one database within a run, so a
 * test that counts globally sees its neighbours.
 */
async function mine(): Promise<{ kind: string; n: number }[]> {
  const r = await getPool().query<{ kind: string; n: string }>(
    `SELECT kind AS kind, count(*) AS n
       FROM thread_prefilter
      WHERE thread_id IN (SELECT j.value FROM json_each($1) j)
      GROUP BY kind ORDER BY count(*) DESC, kind`,
    [JSON.stringify(MINE)]
  );
  return r.rows.map((x) => ({ kind: x.kind, n: Number(x.n) }));
}

const mineTotal = async (): Promise<number> => (await mine()).reduce((s, k) => s + k.n, 0);

test('every prefilter branch reports which rule caught it', () => {
  /* The kinds are what the breakdown groups on, so each branch must yield its own — the
     regex-over-prose this replaces could not tell two of them apart once reworded. */
  const { keep, dropped } = prefilter([
    thread(0),                                                            // passes
    /* "thoughts on MY x" — SHOWCASE matches before the question-mark test, which is the point:
       a showcase is still a showcase when it ends in a question mark. */
    thread(1, { title: `${TAG} thoughts on my new plugin?` }),            // showcase
    thread(2, { ageMinutes: null as never, ageText: '' }),                // age unknown
    thread(3, { ageMinutes: 60 * 500 }),                                  // far past 72h
    thread(4, { subreddit: 'woocommerce' })                               // outside the pilot set
  ]);

  assert.equal(keep.length, 1, 'exactly one of these is eligible');
  const kinds = dropped.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ['age-unknown', 'not-a-question', 'outside-pilot', 'too-old'].sort());
  for (const d of dropped) {
    assert.ok(d.why && d.why.length > 5, 'and each keeps the sentence written for a person');
  }
});

test('drops are recorded and grouped by the rule that fired', async () => {
  await reset();
  const db = getPool();
  await savePrefilterOutcome(db, [
    { threadId: id(0), kind: 'outside-pilot', detail: 'r/woocommerce is outside the pilot set' },
    { threadId: id(1), kind: 'outside-pilot', detail: 'r/crm is outside the pilot set' },
    { threadId: id(2), kind: 'too-old', detail: '103h old, past the 72h ceiling' }
  ], []);

  assert.equal(await mineTotal(), 3);
  assert.deepEqual(await mine(), [
    { kind: 'outside-pilot', n: 2 },
    { kind: 'too-old', n: 1 }
  ], 'biggest first — the one to act on is the one at the top');
});

test('a thread the filter later KEEPS stops being counted as dropped', async () => {
  await reset();
  const db = getPool();
  /* The case that makes this a reconciliation rather than a log: the subreddit joins the pilot
     set, or the operator fixes a source. Leaving the old row would report a thread as filtered
     out while it sits in the assessed list, and the breakdown would exceed the collected count. */
  await savePrefilterOutcome(db, [
    { threadId: id(0), kind: 'outside-pilot', detail: 'was outside' }
  ], []);
  assert.equal(await mineTotal(), 1, 'precondition: it is recorded as dropped');

  await savePrefilterOutcome(db, [], [id(0)]);
  assert.equal(await mineTotal(), 0, 'keeping it must clear the drop');
});

test('a re-run replaces a thread’s reason instead of adding a second', async () => {
  await reset();
  const db = getPool();
  /* Eligibility is time-dependent: the same thread is dropped for a different rule as it ages.
     One row per thread, or the totals double every run. */
  await savePrefilterOutcome(db, [{ threadId: id(1), kind: 'outside-pilot', detail: 'first' }], []);
  await savePrefilterOutcome(db, [{ threadId: id(1), kind: 'too-old', detail: '103h old' }], []);

  assert.equal(await mineTotal(), 1, 'still one thread, not two');
  assert.deepEqual(await mine(), [{ kind: 'too-old', n: 1 }], 'and the newest reason wins');

  const row = await db.query<{ detail: string }>(
    'SELECT detail FROM thread_prefilter WHERE thread_id = $1', [id(1)]);
  assert.equal(row.rows[0]?.detail, '103h old', 'the sentence is refreshed too');
});

test('the database refuses a rule name the code cannot produce', async () => {
  /* Closed vocabulary, per 0001's convention. Renaming a kind in TypeScript without adding it
     to the schema fails at the write rather than landing a string the console must guess at.
     Postgres said "invalid input value for enum"; the SQLite translation enforces the same
     vocabulary with a CHECK, so the refusal names the column instead of a type. What is being
     asserted is unchanged: the DATABASE refuses it, not the application. */
  await assert.rejects(
    () => savePrefilterOutcome(getPool(), [
      { threadId: id(2), kind: 'made-up-rule' as never, detail: 'x' }
    ], []),
    /CHECK constraint failed: kind/
  );
});

test('a failed write leaves the table as it was, not half-updated', async () => {
  await reset();
  const db = getPool();
  await savePrefilterOutcome(db, [{ threadId: id(3), kind: 'too-old', detail: 'kept' }], []);

  /* One good row then one bad, in a batch that also clears a kept thread. Without the
     transaction the delete and the good insert would stand while the batch failed — the table
     would then describe two different runs at once. */
  await assert.rejects(() => savePrefilterOutcome(db, [
    { threadId: id(4), kind: 'outside-pilot', detail: 'fine' },
    { threadId: id(5), kind: 'nonsense' as never, detail: 'boom' }
  ], [id(3)]));

  assert.equal(await mineTotal(), 1, 'the batch must be all or nothing');
  assert.deepEqual(await mine(), [{ kind: 'too-old', n: 1 }], 'and the pre-existing row survives');
});

test('deleting a thread takes its drop reason with it', async () => {
  await reset();
  const db = getPool();
  await savePrefilterOutcome(db, [{ threadId: id(5), kind: 'too-old', detail: 'x' }], []);
  await db.query('DELETE FROM threads WHERE id = $1', [id(5)]);
  const left = await db.query('SELECT 1 FROM thread_prefilter WHERE thread_id = $1', [id(5)]);
  assert.equal(left.rowCount, 0, 'a reason for a thread nobody has is not a fact worth keeping');
});


test('a thread assessed before it aged out is not counted among the never-assessed', async () => {
  await reset();
  const db = getPool();
  /**
   * THE NEGATIVE-COUNT BUG, pinned.
   *
   * `dropped` is NOT a subset of `never assessed`. The prefilter re-runs over every thread and
   * the age rule is measured against the current time, so a thread analysed while it was fresh
   * is legitimately dropped once it passes the 72h ceiling — it is then both assessed AND
   * dropped. Measured on live data: 116 collected, 30 assessed, 87 dropped. 30 + 87 = 117,
   * one more than exist, and the console's "kept, not looked at yet"
   * (collected − assessed − dropped) rendered as **-1**.
   */
  await savePrefilterOutcome(db, [
    { threadId: id(0), kind: 'too-old', detail: 'aged out AFTER it was assessed' },
    { threadId: id(1), kind: 'outside-pilot', detail: 'never eligible, never assessed' }
  ], []);
  await db.query(
    `INSERT INTO opportunity_assessments (thread_id, permalink, title, verdict, score, reasons, assessed_at)
     VALUES ($1,'/p','t','skip',10,'[]', strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT (thread_id) DO NOTHING`, [id(0)]);

  try {
    const b = await prefilterBreakdown(db);
    const tooOld = b.byKind.find((k) => k.kind === 'too-old');
    const outside = b.byKind.find((k) => k.kind === 'outside-pilot');

    /* id(0) is dropped but WAS assessed, so it must not appear. id(1) was never assessed and
       must. Scoped by kind because other files' rows share the table. */
    assert.equal(tooOld, undefined, 'a dropped-but-assessed thread must not be counted');
    assert.ok(outside && outside.n >= 1, 'a dropped-and-never-assessed thread must be');

    /* The property the panel depends on: drops never exceed what is genuinely unassessed. */
    const totals = await db.query<{ collected: string; assessed: string }>(
      `SELECT (SELECT count(*) FROM threads) AS collected,
              (SELECT count(*) FROM opportunity_assessments) AS assessed`);
    const neverAssessed = Number(totals.rows[0]!.collected) - Number(totals.rows[0]!.assessed);
    assert.ok(b.total <= neverAssessed,
              `the breakdown (${b.total}) must never exceed the never-assessed count (${neverAssessed})`);
  } finally {
    await db.query('DELETE FROM opportunity_assessments WHERE thread_id IN (SELECT j.value FROM json_each($1) j)', [JSON.stringify(MINE)]);
  }
});
