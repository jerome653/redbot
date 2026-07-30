#!/usr/bin/env node
/**
 * Empty the test database once, before the suite runs.
 *
 * Why here and not from a per-test-process `--import` hook: that version worked, but it
 * forced `--test-concurrency=1`, because one file's reset would otherwise land in the
 * middle of another file's assertions. Serialising 20+ files took the suite from ~18s to
 * ~350s. Resetting once, up front, keeps the clean-slate guarantee that matters — state
 * must not accumulate across RUNS — while letting the files run in parallel again.
 *
 * What this does NOT give you is isolation BETWEEN files within one run. Files share the
 * database, so a test that counts rows globally (rather than filtering by its own account
 * or id) can see another file's writes. No test does that today; one that did would be
 * flaky, and the fix is to scope it, not to serialise the suite.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED FROM THE POSTGRES VERSION
 *
 * That script discovered every table from pg_tables and TRUNCATE ... RESTART IDENTITY CASCADE'd
 * them, and explained why it discovered rather than listed: "a hardcoded list goes stale the
 * moment a migration adds one, and the failure is silent". Both concerns disappear here, because
 * a SQLite database is a FILE: deleting it cannot miss a table, cannot leave a sequence
 * un-restarted, and cannot go stale when a migration adds something. The schema is then rebuilt
 * by the real migration runner, so the suite also proves `migrate up` works from nothing on
 * every run.
 *
 * It no longer needs Docker, so the "start the container first" failure path is gone with it.
 * ---------------------------------------------------------------------------
 *
 * FAILS CLOSED: refuses to delete anything that is not clearly a test database. The Postgres
 * version refused when POSTGRES_DB was "redbot"; the equivalent here is stricter, because the
 * mistake is worse — this deletes a file rather than truncating tables inside a named database,
 * and the operator's real database holds the whole evidence corpus.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, 'migrate.mjs');
const ROOT = resolve(HERE, '..', '..');

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

const target = process.env.REDBOT_DB;
if (!target) {
  die(
    'REDBOT_DB is not set — it names the test database.\n\n' +
    '  npm test sets it from db/sqlite/.env.test. To run this by hand:\n' +
    '    REDBOT_DB=data/test/redbot-test.db node db/sqlite/reset-test-db.mjs'
  );
}

const file = resolve(target);
const name = basename(file);

/* Three independent guards. Any one of them failing is enough to stop, because the cost of a
   false negative here is the operator's entire evidence corpus. */
if (!/test/i.test(name)) {
  die(`Refusing to delete ${file} — a test database's FILENAME must contain "test".`);
}
if (file === resolve(join(ROOT, 'data', 'redbot.db'))) {
  die(`Refusing to delete ${file} — that is the real database.`);
}
if (!/[\\/](test|tmp)[\\/]/i.test(file) && !/test/i.test(basename(dirname(file)))) {
  die(
    `Refusing to delete ${file} — it is not inside a directory that says it is for tests.\n` +
    '  Expected something like data/test/redbot-test.db'
  );
}

/* -wal and -shm are separate files in WAL mode. Leaving them behind next to a deleted database
   is how you get "file is not a database": SQLite finds a WAL with no matching header. */
for (const suffix of ['', '-wal', '-shm']) {
  const f = `${file}${suffix}`;
  if (existsSync(f)) {
    try { rmSync(f, { force: true }); } catch (e) { die(`Could not delete ${f}: ${e.message}`); }
  }
}
mkdirSync(dirname(file), { recursive: true });

const r = spawnSync(process.execPath, [RUNNER, 'up'], {
  encoding: 'utf8',
  env: { ...process.env, REDBOT_DB: file }
});
if (r.status !== 0) {
  die(`Could not build the test schema.\n${(r.stdout ?? '') + (r.stderr ?? '')}`);
}

console.log(`  ${file} reset (${(r.stdout.match(/applied/g) ?? []).length} migrations)`);
