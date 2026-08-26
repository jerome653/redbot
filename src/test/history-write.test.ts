/**
 * Writing down what happened must not be able to undo what happened.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST EXISTS.
 *
 * 2026-08-19, Clark's machine: `redbot read marketing` ran for 79.2 seconds, collected its
 * threads, saved them, and then exited 1. The run log's only error was the LOG's:
 *
 *   CHECK constraint failed: status IS NULL OR status IN ('ok','failed','blocked','unknown')
 *   SQL: INSERT INTO history (ts, kind, account, subreddit, thread_url, permalink, status, ...)
 *
 * `record()` copies whatever a caller puts in `extra.status` straight into a column with a CHECK
 * on it, and the write is awaited on the command's SUCCESS path — so a value the column will not
 * take converts a finished read into a failed run, and the console, which judges a run by its
 * exit code, reports work that happened as work that did not.
 *
 * Two properties are asserted here, and both were false before 2026-08-26:
 *   1. a status outside the vocabulary is NORMALISED (kept as evidence, reported as 'unknown');
 *   2. a history write that still fails is reported and dropped, never raised into the caller.
 *
 * The negative controls matter as much: a valid status must survive unchanged, and every value
 * in the code's vocabulary must be one the DATABASE accepts — otherwise the two lists drift and
 * this test passes while the constraint fails in the field, which is exactly what happened.
 * ---------------------------------------------------------------------------
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(ROOT, 'db', 'sqlite', 'migrate.mjs');

/* The database has to exist before src/db.ts is first imported — it caches the resolved path. */
const dir = mkdtempSync(join(tmpdir(), 'redbot-history-write-'));
process.env.REDBOT_DB = join(dir, 'redbot.db');
const migrated = spawnSync(process.execPath, [RUNNER, 'up'], { encoding: 'utf8' });
if (migrated.status !== 0) {
  throw new Error(`migrate up failed:\n${migrated.stdout}\n${migrated.stderr}`);
}

const { record, HISTORY_STATUS } = await import('../log.js');
const { getPool } = await import('../db.js');
const { appendHistory } = await import('../store.js');
import type { HistoryKind, HistoryEntry } from '../types.js';

after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

interface Row { kind: string; status: string | null; summary: string; data: unknown }

async function rowFor(summary: string): Promise<Row | undefined> {
  const r = await getPool().query<Row>(
    'SELECT kind, status, summary, data FROM history WHERE summary = $1', [summary]
  );
  return r.rows[0];
}

/** Runs `fn` with console.warn captured, so a warning can be asserted rather than assumed. */
async function warnings(fn: () => Promise<void>): Promise<string[]> {
  const said: string[] = [];
  const real = console.warn;
  console.warn = (...a: unknown[]) => { said.push(a.map(String).join(' ')); };
  try { await fn(); } finally { console.warn = real; }
  return said;
}

describe('a status the column would refuse', () => {
  test('is kept as evidence and written as unknown, instead of failing the insert', async () => {
    await record('read', 'normalise-throttled', { subreddit: 'SEO', status: 'throttled' });

    const row = await rowFor('normalise-throttled');
    assert.ok(row, 'the row must exist — the whole point is that the write is not refused');
    assert.equal(row.status, 'unknown', 'an out-of-vocabulary status is reported as unknown');
    assert.deepEqual(
      (row.data as { status?: string } | null)?.status, 'throttled',
      'the value the caller meant is preserved in data, or the normalisation destroys evidence'
    );
  });

  test('does not reach the caller as an exception', async () => {
    /* The 2026-08-19 failure in one line: this call used to reject, inside a command that had
       already finished its work. */
    await assert.doesNotReject(
      () => record('read', 'no-throw-on-bad-status', { status: 'rate-limited' })
    );
  });
});

describe('a valid status is left alone', () => {
  for (const status of HISTORY_STATUS) {
    test(`'${status}' is written through unchanged, and the database accepts it`, async () => {
      await record('error', `valid-status-${status}`, { status });
      const row = await rowFor(`valid-status-${status}`);
      assert.ok(row, `the database refused a status the code is allowed to write: ${status}`);
      assert.equal(row.status, status, 'a legal status must not be flattened to unknown');
      assert.equal(
        (row.data as { status?: string } | null)?.status, undefined,
        'a legal status is not also copied into data — that would double-count it'
      );
    });
  }

  test('no status at all stays null, rather than becoming unknown', async () => {
    await record('read', 'no-status-at-all', { subreddit: 'SEO' });
    const row = await rowFor('no-status-at-all');
    assert.ok(row);
    assert.equal(row.status, null, 'most rows carry no status; that is not the same as unknown');
  });
});

describe('a history write that fails anyway', () => {
  /* `kind` is a code constant, not caller input, so it is deliberately NOT normalised — which
     makes it the honest way to produce a refusal `record` cannot repair. */
  const badKind = 'wipe' as HistoryKind;

  test('the database really does refuse it — the control is doing work', async () => {
    const entry: HistoryEntry = {
      ts: new Date().toISOString(), kind: badKind, account: null, summary: 'refusal-control'
    };
    await assert.rejects(() => appendHistory(entry), /CHECK constraint failed/);
  });

  test('is warned about on the run output and NOT raised into the command', async () => {
    const said = await warnings(async () => {
      await record(badKind, 'a run that must survive its own logger');
    });
    assert.ok(
      said.some((s) => /history not recorded/i.test(s)),
      `the failure must be visible to whoever is watching the run — saw: ${JSON.stringify(said)}`
    );
    assert.ok(
      said.some((s) => /CHECK constraint failed/i.test(s)),
      'the warning carries the database\'s own words, not a paraphrase'
    );
  });
});
