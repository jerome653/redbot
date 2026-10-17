/**
 * The database is copied once a day by the unattended loop, and a copy only counts once sqlite
 * has checked it.
 *
 * WHY. Measured on cardinal 2026-10-17: every file in BACKED_UP is gone from data/, the newest
 * evidence snapshot held only its manifest.json, and redbot.db had no routine copy. These tests
 * drive a real sqlite file through a real `VACUUM INTO`, so the integrity check is sqlite's own.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dailyDatabaseBackup, newestDailyDatabaseCopy, DAILY_DB_DIR } from '../backup.js';
import { backupBeforeCycle } from '../commands/auto.js';

/** A real sqlite file with one row, behind the `query()` shape backupDatabase takes. */
function realDb(dir: string) {
  const d = new DatabaseSync(join(dir, 'live.db'));
  d.exec('CREATE TABLE history (id INTEGER PRIMARY KEY, kind TEXT); INSERT INTO history (kind) VALUES (\'auto.cycle\');');
  return { d, db: { query: async (sql: string) => { d.exec(sql); return { rows: [], rowCount: 0 }; } } };
}

describe('dailyDatabaseBackup', () => {
  test('writes a verified copy that reads back with its rows, and leaves no .partial', async () => {
    const root = mkdtempSync(join(tmpdir(), 'redbot-daily-'));
    const { d, db } = realDb(root);
    try {
      const r = await dailyDatabaseBackup(db, new Date(), root);
      assert.equal(r.ok, true, r.detail);
      assert.equal(r.skipped, undefined);
      assert.match(r.file!, /redbot-.+\.db$/);
      assert.match(r.detail, /integrity ok/);
      const back = new DatabaseSync(r.file!, { readOnly: true });
      assert.deepEqual({ ...back.prepare('SELECT kind FROM history').get() }, { kind: 'auto.cycle' });
      back.close();
      assert.deepEqual(readdirSync(join(root, DAILY_DB_DIR)).filter((n) => n.endsWith('.partial')), []);
    } finally { d.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test('a copy younger than a day is enough: nothing new is written', async () => {
    const root = mkdtempSync(join(tmpdir(), 'redbot-daily-'));
    const { d, db } = realDb(root);
    try {
      const first = await dailyDatabaseBackup(db, new Date(), root);
      const second = await dailyDatabaseBackup(db, new Date(Date.now() + 60_000), root);
      assert.equal(second.ok, true);
      assert.equal(second.skipped, true);
      assert.equal(second.file, first.file);
      assert.equal(readdirSync(join(root, DAILY_DB_DIR)).length, 1);
    } finally { d.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test('a copy older than 20h does not count: a new one is written and the old one is kept', async () => {
    const root = mkdtempSync(join(tmpdir(), 'redbot-daily-'));
    const { d, db } = realDb(root);
    try {
      const old = await dailyDatabaseBackup(db, new Date('2026-01-01T00:00:00Z'), root);
      const dayAgo = (Date.now() - 21 * 3_600_000) / 1000;
      utimesSync(old.file!, dayAgo, dayAgo);
      const r = await dailyDatabaseBackup(db, new Date(), root);
      assert.equal(r.ok, true, r.detail);
      assert.equal(r.skipped, undefined);
      assert.notEqual(r.file, old.file);
      assert.ok(existsSync(old.file!), 'nothing here deletes an older copy');
    } finally { d.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test('a copy that is not a sound database stays .partial, fails, and does not become the newest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'redbot-daily-'));
    try {
      const junk = { query: async (sql: string) => {
        const m = /VACUUM INTO '(.+)'/.exec(sql);
        if (m?.[1]) writeFileSync(m[1], 'x'.repeat(4096));
        return { rows: [], rowCount: 0 };
      } };
      const r = await dailyDatabaseBackup(junk, new Date(), root);
      assert.equal(r.ok, false);
      assert.match(r.detail, /integrity_check/);
      assert.match(r.file!, /\.partial$/);
      assert.ok(existsSync(r.file!), 'the bad copy is left for whoever looks');
      assert.equal(newestDailyDatabaseCopy(join(root, DAILY_DB_DIR)), null, 'a .partial never counts');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('no database configured is a failure with a reason, never a success', async () => {
    const root = mkdtempSync(join(tmpdir(), 'redbot-daily-'));
    try {
      const r = await dailyDatabaseBackup(null, new Date(), root);
      assert.equal(r.ok, false);
      assert.match(r.detail, /no database/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('newestDailyDatabaseCopy ignores files that are not daily copies', () => {
    const root = mkdtempSync(join(tmpdir(), 'redbot-daily-'));
    try {
      const dir = join(root, DAILY_DB_DIR);
      mkdirSync(dir);
      writeFileSync(join(dir, 'notes.txt'), 'x');
      writeFileSync(join(dir, 'redbot-a.db.partial'), 'x');
      assert.equal(newestDailyDatabaseCopy(dir), null);
      writeFileSync(join(dir, 'redbot-b.db'), 'x');
      assert.equal(newestDailyDatabaseCopy(dir)?.file, join(dir, 'redbot-b.db'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('backupBeforeCycle', () => {
  const recorder = () => {
    const rows: Array<{ kind: string; summary: string }> = [];
    const rec = (async (kind: string, summary: string) => { rows.push({ kind, summary }); }) as never;
    return { rows, rec };
  };

  test('a fresh copy writes no history row: the verified file and the run log are its record', async () => {
    const { rows, rec } = recorder();
    const r = await backupBeforeCycle(async () => ({ ok: true, file: '/b/redbot-x.db', bytes: 1, detail: 'd' }), rec);
    assert.equal(r?.ok, true);
    assert.deepEqual(rows, []);
  });

  test('a skip writes no row, so the history is not one line per cycle', async () => {
    const { rows, rec } = recorder();
    await backupBeforeCycle(async () => ({ ok: true, skipped: true, detail: 'recent' }), rec);
    assert.deepEqual(rows, []);
  });

  test('a failure is recorded as error', async () => {
    const { rows, rec } = recorder();
    await backupBeforeCycle(async () => ({ ok: false, detail: 'disk full' }), rec);
    assert.deepEqual(rows.map((r) => r.kind), ['error']);
    assert.match(rows[0]!.summary, /disk full/);
  });

  test('a backup that throws, or a history write that throws, never stops the loop', async () => {
    const { rows, rec } = recorder();
    const r = await backupBeforeCycle(async () => { throw new Error('EACCES'); }, rec);
    assert.equal(r?.ok, false);
    assert.deepEqual(rows.map((x) => x.kind), ['error']);
    const boom = (async () => { throw new Error('db locked'); }) as never;
    await backupBeforeCycle(async () => ({ ok: true, detail: 'd' }), boom);
  });
});

test('the unattended loop backs up before every cycle, not only when someone calls it', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'src', 'commands', 'auto.ts'), 'utf8');
  const loop = src.slice(src.indexOf('for (;;) {'));
  assert.ok(loop.length < src.length, 'the loop is where auto.ts says it is');
  const b = loop.indexOf('await backupBeforeCycle();');
  const c = loop.indexOf('await cycle();');
  assert.ok(b >= 0 && c > b, 'backupBeforeCycle() runs inside the loop, ahead of cycle()');
});
