/**
 * Retirement: a week of measurement decides, never the prose in `why`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS.
 *
 * MEASURED 2026-11-04 against the live database. TWO source rows carried prose saying they had
 * been switched off while `enabled` was still 1:
 *
 *   subreddit SEO                    "Disabled 2026-09-28: 0/62 threads in scope of the …"
 *   subreddit Wordpress_Development  "Disabled 2026-10-18: 0 post links in every cycle …"
 *
 * Nothing in src/ or tools/ writes that sentence, so a person typed it into the console's reason
 * field and the flag never moved. Read as a decision it is wrong in the most expensive direction:
 * in the 7 days to 2026-11-04 r/SEO produced 129 assessed threads — the most productive source on
 * the list — while r/Wordpress_Development produced 0 threads and 0 assessments and has logged
 * `selector.miss` on every cycle for a week.
 *
 * So the rule reads the engine's own yield and nothing else. The first two tests here are that
 * pair of live rows, as a fixture: the dead one retires, the one whose prose says it is dead does
 * not. If a future change ever lets the sentence influence the verdict, the SEO case fails.
 *
 * The thread half is the same discipline applied to the backlog. The opportunity stage logged
 * "collected 1836, prefiltered 99" on EVERY cycle — the whole corpus rescanned each pass — and
 * 1,415 of 1,913 threads were more than 7 days old. Retiring those stops the rescan, so the
 * exclusions are the load-bearing part: a thread we have replied on, or one still inside its
 * observation window, is evidence and must survive.
 * ---------------------------------------------------------------------------
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourcesToRetire, threadsToRetire, RETIREMENT_DAYS } from '../retire.js';
import type { SourceYield, ThreadFact } from '../retire.js';
import type { Thread } from '../types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(ROOT, 'db', 'sqlite', 'migrate.mjs');

/* The database has to exist before src/db.ts is first imported — it caches the resolved path. */
const dir = mkdtempSync(join(tmpdir(), 'redbot-retire-'));
process.env.REDBOT_DB = join(dir, 'redbot.db');
const migrated = spawnSync(process.execPath, [RUNNER, 'up'], { encoding: 'utf8' });
if (migrated.status !== 0) {
  throw new Error(`migrate up failed:\n${migrated.stdout}\n${migrated.stderr}`);
}
after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-04T01:00:00.000Z');
const ago = (days: number): string => new Date(NOW - days * DAY).toISOString();

const src = (over: Partial<SourceYield> = {}): SourceYield => ({
  kind: 'subreddit', value: 'x', enabled: true, createdAt: ago(60), assessedInWindow: 0, ...over
});

describe('a source is retired by its measured yield', () => {
  test('the dead live row retires — 0 assessed in 7 days, on the list since 2026-09-08', () => {
    const out = sourcesToRetire([src({
      value: 'Wordpress_Development', createdAt: '2026-09-08T03:45:21.442Z', assessedInWindow: 0
    })], NOW);
    assert.equal(out.length, 1, `expected one retirement, got ${JSON.stringify(out)}`);
    assert.equal(out[0]?.value, 'Wordpress_Development');
    assert.match(out[0]?.why ?? '', /0 assessed thread/, 'the reason must state the measurement');
    assert.match(out[0]?.why ?? '', /2026-11-04/, 'the reason must state the date it was measured');
  });

  test('the SEO-shaped row does NOT retire, whatever its prose says', () => {
    /* 129 assessed in the 7 days to 2026-11-04. Its `why` column says "Disabled 2026-09-28". */
    const out = sourcesToRetire([src({
      value: 'SEO', createdAt: '2026-09-08T03:46:39.427Z', assessedInWindow: 129
    })], NOW);
    assert.deepEqual(out, [], 'the most productive source on the list must never be retired');
  });

  test('one assessed thread is enough to keep a source', () => {
    assert.deepEqual(sourcesToRetire([src({ assessedInWindow: 1 })], NOW), []);
  });

  test('a source younger than the window is not judged yet', () => {
    const young = sourcesToRetire([src({ createdAt: ago(RETIREMENT_DAYS - 1), assessedInWindow: 0 })], NOW);
    assert.deepEqual(young, [], 'a source added yesterday has not had a week to produce anything');
  });

  test('a source with no recorded start date is left alone', () => {
    assert.deepEqual(sourcesToRetire([src({ createdAt: null })], NOW), [],
      'without a start date the week cannot be proved, and an unproved week is not a verdict');
  });

  test('an already-off source is not retired twice', () => {
    assert.deepEqual(sourcesToRetire([src({ enabled: false })], NOW), []);
  });
});

const th = (over: Partial<ThreadFact> = {}): ThreadFact => ({
  id: 't1', collectedAt: ago(30), hasDraft: false, hasPublishedReply: false, observationDue: false, ...over
});

describe('a stale thread is retired unless it is still live work', () => {
  test('an old thread nothing was ever written for retires', () => {
    const out = threadsToRetire([th()], NOW);
    assert.equal(out.length, 1, `expected one retirement, got ${JSON.stringify(out)}`);
    assert.match(out[0]?.why ?? '', /30 days old/);
  });

  test('a thread inside the window stays', () => {
    assert.deepEqual(threadsToRetire([th({ collectedAt: ago(RETIREMENT_DAYS - 1) })], NOW), []);
  });

  test('a thread with a draft stays', () => {
    assert.deepEqual(threadsToRetire([th({ hasDraft: true })], NOW), []);
  });

  test('a thread we have replied on stays — that is published evidence', () => {
    assert.deepEqual(threadsToRetire([th({ hasPublishedReply: true })], NOW), []);
  });

  test('a thread with an observation checkpoint still due stays', () => {
    assert.deepEqual(threadsToRetire([th({ observationDue: true })], NOW), []);
  });

  test('a thread with no collection date is left alone', () => {
    assert.deepEqual(threadsToRetire([th({ collectedAt: null })], NOW), []);
  });
});

/* ---- the scan actually skips what was retired ---------------------------------------- */

const { getPool } = await import('../db.js');
const { upsertThreads, loadThreadsFromDb } = await import('../db/threads.js');
const { saveThreadRetirements, retiredThreadCount } = await import('../db/retirement.js');

const thread = (id: string): Thread => ({
  id, permalink: `https://example.invalid/${id}`, title: 'Checkout 502s after a PHP upgrade?',
  subreddit: 'wordpress', author: 'a', upvotes: 1, commentCount: 1,
  ageText: '1 hr ago', ageMinutes: 60, body: 'admin-ajax returns 502.',
  comments: [{ author: 'b', body: 'Clear the cache first.', depth: 0 }],
  collectedAt: ago(30), source: 'read'
} as unknown as Thread);

describe('the opportunity scan does not see a retired thread', () => {
  test('a retired thread is excluded from the scan and still on record', async () => {
    await upsertThreads(getPool(), [thread('aaaaaaaaaaa1'), thread('bbbbbbbbbbb2')]);
    await saveThreadRetirements(getPool(), [{ id: 'aaaaaaaaaaa1', why: '30 days old, nothing drafted' }]);

    const scanned = await loadThreadsFromDb(getPool(), undefined, { excludeRetired: true });
    const ids = scanned.map((t) => t.id);
    assert.ok(!ids.includes('aaaaaaaaaaa1'), `the scan must skip a retired thread: ${ids.join(', ')}`);
    assert.ok(ids.includes('bbbbbbbbbbb2'), 'and must still see the live one');

    /* Archived, not deleted — the row and its comments are both still there. */
    const all = await loadThreadsFromDb(getPool());
    assert.ok(all.some((t) => t.id === 'aaaaaaaaaaa1'), 'retiring must not delete the thread');
    assert.equal(all.find((t) => t.id === 'aaaaaaaaaaa1')?.comments.length, 1,
      'retiring must not delete the comments either');
    assert.equal(await retiredThreadCount(getPool()), 1);
  });

  test('retiring twice keeps the first reason — it is a record, not a counter', async () => {
    await upsertThreads(getPool(), [thread('ccccccccccc3')]);
    await saveThreadRetirements(getPool(), [{ id: 'ccccccccccc3', why: 'first reason' }]);
    await saveThreadRetirements(getPool(), [{ id: 'ccccccccccc3', why: 'second reason' }]);
    const r = await getPool().query<{ why: string }>(
      'SELECT why FROM thread_retirement WHERE thread_id = $1', ['ccccccccccc3']);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0]?.why, 'first reason');
  });
});

/* ---- the flag and the reason land together ------------------------------------------- */

const { upsertSources, setSourceEnabled, getSource } = await import('../db/sources.js');

describe('retiring a source states the measurement on the same row', () => {
  test('the flag and the reason move in ONE statement', async () => {
    await upsertSources(getPool(), [{
      kind: 'subreddit', value: 'Wordpress_Development', why: 'Added from the console.', enabled: true
    }]);
    const changed = await setSourceEnabled(
      getPool(), 'subreddit', 'Wordpress_Development', false,
      'Retired 2026-11-04: 0 assessed threads in the 7 days to 2026-11-04.');
    assert.equal(changed, true);

    const row = await getSource(getPool(), 'subreddit', 'Wordpress_Development');
    /* Both halves, or the live defect is back: two rows carried a "Disabled …" sentence while
       `enabled` was still 1, because the reason was the only thing a person could write. */
    assert.equal(row?.enabled, false, 'the flag must actually move');
    assert.match(row?.why ?? '', /^Retired 2026-11-04: 0 assessed thread/, 'and carry the measurement');
  });

  test('switching off without a reason keeps the one the source was added with', async () => {
    await upsertSources(getPool(), [{
      kind: 'subreddit', value: 'bigseo', why: 'Added from the console.', enabled: true
    }]);
    await setSourceEnabled(getPool(), 'subreddit', 'bigseo', false);
    const row = await getSource(getPool(), 'subreddit', 'bigseo');
    assert.equal(row?.enabled, false);
    assert.equal(row?.why, 'Added from the console.',
      'the original contract: a switch must not silently erase why it was added');
  });
});
