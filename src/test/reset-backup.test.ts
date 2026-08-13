import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupDatabase } from '../backup.js';

/**
 * THE LOSS THIS PINS, from a colleague's machine on 2026-08-13:
 *
 *     OK  Snapshot written: C:\Users\…\redbot-evidence-backups\2026-08-13T03-22-23-679Z (0 file(s))
 *     OK  Removed 5 file(s), 9 folder(s), 442 row(s) across 15 table(s).
 *
 * The snapshot copied an allowlist of JSON files. That install kept everything in sqlite — as
 * every current install does, because drafts, history, observations and assessments moved into
 * the database and the JSON files stopped being written. So the backup was EMPTY, said OK, and
 * 442 rows went with nothing to restore from.
 *
 * A backup that reports success while copying none of the data is worse than no backup: the
 * operator reads it and proceeds. Two things follow, and both are tested here — the database is
 * copied, and a copy that did not happen is a REFUSAL rather than a line of output.
 */
describe('a snapshot covers the database, or the reset does not happen', () => {
  test('the database is copied, consistently, through sqlite itself', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'redbot-dbsnap-'));
    try {
      const calls: string[] = [];
      const db = {
        query: async (sql: string) => {
          calls.push(sql);
          /* VACUUM INTO writes the file; the fake makes one so the size check is real. */
          const m = /VACUUM INTO '(.+)'/.exec(sql);
          if (m?.[1]) writeFileSync(m[1], 'x'.repeat(4096));
          return { rows: [], rowCount: 0 };
        }
      };
      const r = await backupDatabase(dir, db);
      assert.equal(r.ok, true, r.reason);
      assert.match(calls[0] ?? '', /^VACUUM INTO /, 'a consistent copy, not a file copy over a live WAL');
      assert.ok(existsSync(r.file!), 'the copy is on disk');
      assert.equal(statSync(r.file!).size, 4096);
      assert.equal(r.bytes, 4096);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('no database configured is reported as a reason, never as success', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'redbot-dbsnap-'));
    try {
      const r = await backupDatabase(dir, null);
      assert.equal(r.ok, false);
      assert.match(r.reason!, /no database/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a copy that comes out empty is a failure — this is the 0-file snapshot, one layer down', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'redbot-dbsnap-'));
    try {
      const db = { query: async () => ({ rows: [], rowCount: 0 }) };  // writes nothing
      const r = await backupDatabase(dir, db);
      assert.equal(r.ok, false);
      assert.match(r.reason!, /empty/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a refusal from sqlite is passed through, not swallowed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'redbot-dbsnap-'));
    try {
      const db = { query: async () => { throw new Error('database is locked'); } };
      const r = await backupDatabase(dir, db);
      assert.equal(r.ok, false);
      assert.match(r.reason!, /locked/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('an existing copy is never overwritten — a snapshot is not a place to lose a snapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'redbot-dbsnap-'));
    try {
      writeFileSync(join(dir, 'redbot.db'), 'already here');
      const r = await backupDatabase(dir, { query: async () => ({ rows: [], rowCount: 0 }) });
      assert.equal(r.ok, false);
      assert.match(r.reason!, /already exists/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a path containing a quote cannot break out of the sqlite string literal', async () => {
    const dir = mkdtempSync(join(tmpdir(), "redbot-db'snap-"));
    try {
      let sql = '';
      const db = {
        query: async (s: string) => {
          sql = s;
          const m = /VACUUM INTO '(.+)'$/.exec(s);
          if (m?.[1]) writeFileSync(m[1].replace(/''/g, "'"), 'x');
          return { rows: [], rowCount: 0 };
        }
      };
      const r = await backupDatabase(dir, db);
      assert.ok(sql.includes("''"), 'the quote must be doubled, which is how sqlite escapes it');
      assert.equal(r.ok, true, r.reason);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
