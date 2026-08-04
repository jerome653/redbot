/**
 * The ledger heals a line-ending difference, and still refuses a real edit.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * This bug has now shipped twice under two different explanations — "build from the same machine"
 * (2026-07-31) and "the packed asar differs" (2026-08-04) — and both were the same thing: the
 * migration checksum was a hash over file BYTES, so a checkout that produced CRLF and a build that
 * produced LF disagreed about migrations whose SQL was identical. `migrate up` refused, the proxy
 * tables were never created, and the console reported the database healthy throughout.
 *
 * The fix canonicalises line endings before hashing and re-stamps ledger rows that hold the same
 * SQL under different bytes. That heal is the dangerous half: too permissive and it silently
 * disables the only guard against an edited applied migration. So the case that MUST keep failing
 * is tested here as carefully as the cases that must now pass.
 *
 * Both directions are covered on purpose. A CRLF ledger under an LF build is how this was first
 * seen; an LF ledger under a CRLF checkout is what this repository produces today, because its
 * blobs are LF and `core.autocrlf=true` re-expands them on checkout.
 * ---------------------------------------------------------------------------
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, 'migrate.mjs');
const MIGRATIONS = join(HERE, 'migrations');

const hash16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const toLf = (s) => s.replace(/\r\n/g, '\n');
const toCrlf = (s) => toLf(s).replace(/\n/g, '\r\n');

/** Run the real runner against a throwaway database. Never the developer's own. */
function migrate(dbPath, ...args) {
  return spawnSync(process.execPath, [RUNNER, ...args], {
    encoding: 'utf8',
    env: { ...process.env, REDBOT_DB: dbPath }
  });
}

function ledger(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
  db.close();
  return new Map(rows.map((r) => [r.version, r.checksum]));
}

/** Rewrite every ledger checksum as though an earlier run had seen the files in `form`. */
function restampAs(dbPath, form) {
  const db = new DatabaseSync(dbPath);
  const stamp = db.prepare('UPDATE schema_migrations SET checksum = $2 WHERE version = $1');
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.up.sql')).sort()) {
    const version = f.slice(0, 4);
    const body = readFileSync(join(MIGRATIONS, f), 'utf8');
    stamp.run({ 1: version, 2: hash16(form === 'crlf' ? toCrlf(body) : toLf(body)) });
  }
  db.close();
}

/** A migrated database in its own temp directory, plus the cleanup that removes it. */
function freshDb(t) {
  const dir = mkdtempSync(join(tmpdir(), 'redbot-heal-'));
  const dbPath = join(dir, 'redbot.db');
  const r = migrate(dbPath, 'up');
  assert.equal(r.status, 0, `fixture setup failed:\n${r.stderr || r.stdout}`);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dbPath;
}

/* ------------------------------------------------------------------ *
 * The two healable directions
 * ------------------------------------------------------------------ */

/**
 * Which form the working tree is actually in RIGHT NOW.
 *
 * This is not a constant of the repository — it is a property of how the tree was checked out.
 * A `core.autocrlf=true` checkout yields CRLF; the blobs themselves are LF. The test must
 * therefore discover it rather than assume it, because the direction that constitutes real drift
 * flips with it, and a test that assumed one form would quietly become a no-op under the other.
 */
const TREE_FORM = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.up.sql'))
  .some((f) => /\r\n/.test(readFileSync(join(MIGRATIONS, f), 'utf8'))) ? 'crlf' : 'lf';

for (const form of ['crlf', 'lf']) {
  test(`up heals a ledger written from ${form.toUpperCase()} files`, (t) => {
    const dbPath = freshDb(t);
    const canonical = ledger(dbPath);

    restampAs(dbPath, form);
    const drifted = ledger(dbPath);
    const changed = [...canonical.keys()].filter((v) => drifted.get(v) !== canonical.get(v));

    /* Re-stamping in the tree's OWN form is a no-op — there is nothing to heal, and saying so
       is more honest than a test that silently proves nothing. In the opposite form every row
       must have moved, or the fixture is not exercising the bug at all. */
    if (form === TREE_FORM) assert.equal(changed.length, 0, 'same form should not drift');
    else assert.ok(changed.length > 0, `a ${form} ledger must differ from a ${TREE_FORM} tree`);

    const r = migrate(dbPath, 'up');
    assert.equal(r.status, 0, `up refused a ${form} ledger:\n${r.stderr || r.stdout}`);

    const after = ledger(dbPath);
    assert.deepEqual([...after.entries()], [...canonical.entries()],
      'every row should be back to the canonical checksum');
    assert.equal(after.size, canonical.size, 'healing must not add or drop ledger rows');

    for (const v of changed) {
      assert.match(r.stdout, new RegExp(`re-stamped\\s+${v}_`),
        `the re-stamp of ${v} should be reported, not silent`);
    }
  });
}

/* ------------------------------------------------------------------ *
 * The case that must still refuse — the reason the heal is safe
 * ------------------------------------------------------------------ */

test('up still refuses a migration whose SQL genuinely changed', (t) => {
  const dbPath = freshDb(t);

  const db = new DatabaseSync(dbPath);
  db.prepare('UPDATE schema_migrations SET checksum = $2 WHERE version = $1')
    .run({ 1: '0007', 2: 'deadbeefdeadbeef' });
  db.close();

  const r = migrate(dbPath, 'up');
  assert.equal(r.status, 1, 'a genuinely different checksum must refuse');
  const said = r.stderr + r.stdout;
  assert.match(said, /Applied migrations have changed on disk/);
  assert.match(said, /0007_certifications/, 'the refusal must name the migration');
  assert.match(said, /NOT a line-ending difference/,
    'the message must distinguish real drift from the healed case');

  assert.equal(ledger(dbPath).get('0007'), 'deadbeefdeadbeef',
    'a refused database must not be written to on the way to the refusal');
});

/* ------------------------------------------------------------------ *
 * status stays read-only — the header of migrate.mjs promises this
 * ------------------------------------------------------------------ */

test('status reports a healable ledger and changes nothing', (t) => {
  const dbPath = freshDb(t);
  restampAs(dbPath, 'crlf');
  const before = ledger(dbPath);

  const r = migrate(dbPath, 'status');
  assert.equal(r.status, 0, `status should not refuse a healable ledger:\n${r.stderr}`);
  /* Derived, not hard-coded: this must not need editing when 0017 lands. */
  assert.match(r.stdout, /\d+ applied · 0 pending/);

  const after = ledger(dbPath);
  assert.deepEqual([...after.entries()], [...before.entries()],
    'status must not re-stamp anything');

  if (TREE_FORM !== 'crlf') {
    assert.match(r.stdout, /line endings only/,
      'a healable ledger should be reported by status, not passed over in silence');
  }
});

/* ------------------------------------------------------------------ *
 * A clean database is untouched and says nothing about healing
 * ------------------------------------------------------------------ */

test('a clean ledger is not re-stamped and reports no heal', (t) => {
  const dbPath = freshDb(t);
  const before = ledger(dbPath);

  const r = migrate(dbPath, 'up');
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /re-stamped/, 'nothing to heal should print no heal line');
  assert.deepEqual([...ledger(dbPath).entries()], [...before.entries()]);
});

/* ------------------------------------------------------------------ *
 * The schema the blocker actually cost us
 * ------------------------------------------------------------------ */

test('verify fails when 0016 is missing, rather than reporting a healthy database', (t) => {
  const dbPath = freshDb(t);

  const db = new DatabaseSync(dbPath);
  db.exec('DROP TABLE IF EXISTS account_exit_ips');
  db.exec('DROP TABLE IF EXISTS account_proxies');
  db.prepare('DELETE FROM schema_migrations WHERE version = $1').run({ 1: '0016' });
  db.close();

  const r = migrate(dbPath, 'verify');
  assert.equal(r.status, 1, 'verify must not pass on a database with no proxy tables');
  assert.match(r.stderr + r.stdout, /account_proxies/);
});
