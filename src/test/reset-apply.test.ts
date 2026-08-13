import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetPlan, applyReset, profileDirsOnDisk } from '../reset.js';

/**
 * The deleting half, against a throwaway data directory.
 *
 * `applyReset` takes the data root and the database as ARGUMENTS rather than reading the module
 * globals, precisely so this can be proven on a directory nobody cares about. A test that had to
 * point at the real data root would never be written, and this is the one function where "it
 * probably works" is not a survivable answer.
 */
describe('applying a reset removes what the plan named, and only that', () => {
  const make = () => {
    const root = mkdtempSync(join(tmpdir(), 'redbot-reset-'));
    for (const f of ['threads.json', 'gaps.json', 'drafts.json', 'history.jsonl', 'accounts.json']) {
      writeFileSync(join(root, f), '{}', 'utf8');
    }
    mkdirSync(join(root, 'run-logs'), { recursive: true });
    writeFileSync(join(root, 'run-logs', 'one.log'), 'x', 'utf8');
    mkdirSync(join(root, 'chrome-profile-a'), { recursive: true });
    writeFileSync(join(root, 'chrome-profile-a', 'Local State'), '{}', 'utf8');
    return root;
  };

  const fakeDb = (log: string[]) => ({
    query: async (sql: string) => { log.push(sql); return { rowCount: 3 }; }
  });

  test('work clears the corpus and leaves the account, the log and the sign-in', async () => {
    const root = make();
    try {
      const sql: string[] = [];
      const out = await applyReset(resetPlan('work'), fakeDb(sql), root);

      assert.ok(!existsSync(join(root, 'threads.json')), 'the corpus goes');
      assert.ok(!existsSync(join(root, 'run-logs')), 'and its folders');
      assert.ok(existsSync(join(root, 'history.jsonl')), 'the record of what redbot DID stays');
      assert.ok(existsSync(join(root, 'accounts.json')), 'and so does who it acts as');
      assert.ok(existsSync(join(root, 'chrome-profile-a', 'Local State')), 'and the Reddit session');

      assert.ok(out.removedFiles.includes('threads.json'));
      assert.ok(sql.every((s) => !/schema_migrations/i.test(s)), 'the ledger is never touched');
      assert.equal(out.failed.length, 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('all clears the logs and the account too — still not the sign-in', async () => {
    const root = make();
    try {
      const out = await applyReset(resetPlan('all'), fakeDb([]), root);
      assert.ok(!existsSync(join(root, 'history.jsonl')));
      assert.ok(!existsSync(join(root, 'accounts.json')));
      assert.ok(existsSync(join(root, 'chrome-profile-a')), 'sign-ins survive a scope that did not name them');
      assert.equal(out.failed.length, 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('--sign-ins takes the Chrome folders, and only when asked', async () => {
    const root = make();
    try {
      assert.deepEqual(profileDirsOnDisk(root), ['chrome-profile-a']);
      await applyReset(resetPlan('all', { signIns: true }), fakeDb([]), root);
      assert.ok(!existsSync(join(root, 'chrome-profile-a')), 'asked for by name, so it goes');
      assert.deepEqual(profileDirsOnDisk(root), []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('what was already absent is reported as absent, not as removed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'redbot-reset-empty-'));
    try {
      const out = await applyReset(resetPlan('work'), null, root);
      assert.equal(out.removedFiles.length, 0);
      assert.ok(out.missing.length > 0);
      assert.equal(out.failed.length, 0, 'an empty install is not a failed reset');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a table this schema never had is absent, not a failure — anything else is reported', async () => {
    const root = make();
    try {
      const db = {
        query: async (sql: string) => {
          if (/thread_prefilter/.test(sql)) throw new Error('no such table: thread_prefilter');
          if (/drafts/.test(sql)) throw new Error('database is locked');
          return { rowCount: 1 };
        }
      };
      const out = await applyReset(resetPlan('work'), db, root);
      assert.ok(out.missing.includes('table thread_prefilter'));
      assert.ok(out.failed.some((f) => f.what === 'table drafts' && /locked/.test(f.reason)));
      /* And the rest still ran: one locked table must not leave the reset half-done and silent. */
      assert.ok(out.clearedTables.some((t) => t.table === 'threads'));
      assert.ok(out.removedFiles.includes('threads.json'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
