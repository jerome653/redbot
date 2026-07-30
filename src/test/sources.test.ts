/**
 * Where redbot looks for threads.
 *
 * Two defects are pinned here, and they are the same defect wearing different clothes:
 * `data/sources.json` being ABSENT and being CORRUPT used to produce the same answer.
 *
 *   1. Absent was treated as fatal by the console — "sources.json is missing." — so the button
 *      that creates the file refused until the file existed. Nobody could add a first source.
 *   2. Corrupt was treated as EMPTY by `auto`, which then reported "Nothing switched on" and
 *      collected nothing, every cycle, indefinitely. A typo bought you a bot that looked
 *      configured and did nothing.
 *
 * So: absence is the empty state and adding works; corruption fails closed, loudly, and never
 * overwrites the file. The load-bearing test is the second one — a silent no-op is worse than
 * an error, because nobody goes looking for it.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'redbot-sources-'));
process.env.REDBOT_DATA = DATA;

const {
  addSource, removeSource, loadSources, enabledSources, loadSourcesFile,
  readSourcesFile, importSources, exportSources, sourcesPath, SourcesError
} = await import('../sources.js');
const { getPool, closePool } = await import('../db.js');

/** This file's own rows, so it can run beside the rest of the suite. */
const MINE = ['SourcesTestSub', 'SourcesTestTwo', 'SourcesTestThree'];

/**
 * Reset BOTH stores.
 *
 * Clearing only the table is not a clean slate: `addSource` deliberately refuses a value that
 * is in the stale seed file even when the table has no row for it, because a source in the
 * fallback still counts as "already on the list". Leaving the file behind therefore made the
 * next add refuse — correct behaviour, wrong fixture.
 */
async function clear(): Promise<void> {
  await getPool().query(
    `DELETE FROM sources WHERE value IN (SELECT j.value FROM json_each($1) j) OR value LIKE 'sources-test%'`, [JSON.stringify(MINE)]
  );
  rmSync(sourcesPath(), { force: true });
}

before(clear);
after(async () => {
  await clear();
  await closePool();
  try { rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ }
});

/* ------------------------------------------------------------------ *
 * Absent — the empty state, and the thing the console could not get past
 * ------------------------------------------------------------------ */

test('the first source can be added when sources.json does not exist yet', async () => {
  assert.equal(existsSync(sourcesPath()), false, 'precondition: a fresh install has no sources.json');

  const r = await addSource('subreddit', 'SourcesTestSub', 'support desk');
  assert.equal(r.ok, true, `adding was refused: ${r.error}`);
  assert.equal(r.storedIn, 'database');

  // The record, not the file, is the system of truth.
  const { sources, from } = await loadSources();
  assert.equal(from, 'database');
  assert.ok(sources.some((s) => s.kind === 'subreddit' && s.value === 'SourcesTestSub'));

  // And the seed file now exists as the offline fallback.
  assert.equal(existsSync(sourcesPath()), true, 'the seed file must be written as a fallback');
  assert.ok(loadSourcesFile().some((s) => s.value === 'SourcesTestSub'));
});

test('an absent sources.json reads as no sources, not as an error', () => {
  const saved = readFileSync(sourcesPath(), 'utf8');
  rmSync(sourcesPath());
  try {
    assert.equal(readSourcesFile(), null, 'absent must be null, the empty state');
    assert.deepEqual(loadSourcesFile(), []);
  } finally {
    writeFileSync(sourcesPath(), saved, 'utf8');
  }
});

test('r/ is accepted and stripped, so what a person pastes works', async () => {
  const r = await addSource('subreddit', 'r/SourcesTestTwo');
  assert.equal(r.ok, true, `refused: ${r.error}`);
  assert.equal(r.value, 'SourcesTestTwo');
});

test('a source already on the list is not added twice', async () => {
  const r = await addSource('subreddit', 'sourcestestsub');   // same name, different case
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /already on the list/);
});

test('a subreddit name that could not be a subreddit is refused', async () => {
  const r = await addSource('subreddit', 'not a subreddit!');
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /2–21 characters/);
});

test('a search is a different source from a subreddit of the same name', async () => {
  const a = await addSource('search', 'SourcesTestSub');
  assert.equal(a.ok, true, `refused: ${a.error}`);
  const { sources } = await loadSources();
  assert.ok(sources.some((s) => s.kind === 'search' && s.value === 'SourcesTestSub'));
  assert.ok(sources.some((s) => s.kind === 'subreddit' && s.value === 'SourcesTestSub'));
});

test('a source can be removed, and removing nothing says so', async () => {
  assert.equal((await addSource('subreddit', 'SourcesTestThree')).ok, true);
  assert.equal((await removeSource('subreddit', 'SourcesTestThree')).ok, true);
  const again = await removeSource('subreddit', 'SourcesTestThree');
  assert.equal(again.ok, false);
  assert.match(again.error ?? '', /Not on the list/);
});

/* ------------------------------------------------------------------ *
 * Corrupt — fails closed. THE load-bearing case.
 * ------------------------------------------------------------------ */

test('a corrupt sources.json THROWS instead of reading as an empty list', () => {
  const saved = readFileSync(sourcesPath(), 'utf8');
  writeFileSync(sourcesPath(), '{ "subreddits": [ this is not json', 'utf8');
  try {
    // This is the bug: `catch { return { subs: [], queries: [] } }` in auto.ts turned a typo
    // into "Nothing switched on — nothing to collect", forever, with no error anywhere.
    assert.throws(() => loadSourcesFile(), (e: Error) => {
      assert.ok(e instanceof SourcesError);
      assert.match(e.message, /not readable JSON/);
      assert.match(e.message, /refusing to treat an unreadable source list as an empty one/i);
      return true;
    });
  } finally {
    writeFileSync(sourcesPath(), saved, 'utf8');
  }
});

test('a corrupt sources.json is refused by add, and left exactly as written', async () => {
  const saved = readFileSync(sourcesPath(), 'utf8');
  const corrupt = '{ "subreddits": [ broken';
  writeFileSync(sourcesPath(), corrupt, 'utf8');
  try {
    const r = await addSource('subreddit', 'SourcesTestNever');
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /not readable JSON/);
    // Never clobbered: the file is a person's configuration, and overwriting it would lose
    // every source already on the list.
    assert.equal(readFileSync(sourcesPath(), 'utf8'), corrupt);
    // And nothing reached the database either — the two stores stay in lockstep.
    const r2 = await getPool().query(
      'SELECT 1 FROM sources WHERE value = $1', ['SourcesTestNever']
    );
    assert.equal(r2.rowCount, 0, 'a refused add must not write a row');
  } finally {
    writeFileSync(sourcesPath(), saved, 'utf8');
  }
});

test('a sources.json that is valid JSON but the wrong shape is refused too', () => {
  const saved = readFileSync(sourcesPath(), 'utf8');
  writeFileSync(sourcesPath(), '["not", "an", "object"]', 'utf8');
  try {
    assert.throws(() => loadSourcesFile(), SourcesError);
  } finally {
    writeFileSync(sourcesPath(), saved, 'utf8');
  }
});

/* ------------------------------------------------------------------ *
 * What the collector actually visits
 * ------------------------------------------------------------------ */

test('only switched-on sources are collected, and off ones keep their reason', async () => {
  await clear();
  assert.equal((await addSource('subreddit', 'SourcesTestSub', 'kept on')).ok, true);
  assert.equal((await addSource('subreddit', 'SourcesTestTwo', 'turned off later')).ok, true);
  const { setSourceEnabled } = await import('../db/sources.js');
  await setSourceEnabled(getPool(), 'subreddit', 'SourcesTestTwo', false);

  const { subs, from } = await enabledSources();
  assert.equal(from, 'database');
  assert.ok(subs.includes('SourcesTestSub'));
  assert.ok(!subs.includes('SourcesTestTwo'), 'a source switched off must not be collected');

  // Off, not deleted — the reason it was added survives, which is what you want when
  // deciding whether to switch it back on.
  const { sources } = await loadSources();
  const off = sources.find((s) => s.value === 'SourcesTestTwo');
  assert.equal(off?.enabled, false);
  assert.equal(off?.why, 'turned off later');
});

test('enabledSources propagates a corrupt file rather than collecting nothing quietly', async () => {
  await clear();                                   // database empty -> the seed file answers
  const saved = existsSync(sourcesPath()) ? readFileSync(sourcesPath(), 'utf8') : null;
  writeFileSync(sourcesPath(), 'nonsense{', 'utf8');
  try {
    await assert.rejects(() => enabledSources(), SourcesError,
      'auto must be told the list is broken, not handed an empty one');
  } finally {
    if (saved === null) rmSync(sourcesPath(), { force: true });
    else writeFileSync(sourcesPath(), saved, 'utf8');
  }
});

/* ------------------------------------------------------------------ *
 * Moving between the two stores
 * ------------------------------------------------------------------ */

test('the seed file can be imported, and the database exported back to it', async () => {
  await clear();
  writeFileSync(sourcesPath(), JSON.stringify({
    _limits: { maxThreadsPerRun: 15, note: 'prose that has no table' },
    subreddits: [{ name: 'SourcesTestSub', why: 'from the file', enabled: true }],
    searches: [{ query: 'sources-test-query', why: 'also from the file', enabled: false }]
  }, null, 2), 'utf8');

  assert.equal(await importSources(), 2);
  const { sources, from } = await loadSources();
  assert.equal(from, 'database');
  assert.equal(sources.find((s) => s.value === 'SourcesTestSub')?.why, 'from the file');
  // `enabled: false` in the file must survive the import, or a source someone switched off
  // comes back on the moment anybody runs import.
  assert.equal(sources.find((s) => s.value === 'sources-test-query')?.enabled, false);

  assert.equal(await exportSources(), 2);
  const back = JSON.parse(readFileSync(sourcesPath(), 'utf8'));
  // `_limits` is prose with no table. Export must not drop what a person wrote.
  assert.equal(back._limits.maxThreadsPerRun, 15);
  assert.equal(back._limits.note, 'prose that has no table');
  assert.equal(back.subreddits.length, 1);
  assert.equal(back.searches[0].enabled, false);
});
