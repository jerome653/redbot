#!/usr/bin/env node
/**
 * Empty the test database once, before the suite runs.
 *
 * Why here and not from a per-test-process `--import` hook: that version worked, but it
 * forced `--test-concurrency=1`, because one file's TRUNCATE would otherwise land in the
 * middle of another file's assertions. Serialising 20+ files took the suite from ~18s to
 * ~350s. Resetting once, up front, keeps the clean-slate guarantee that matters — state
 * must not accumulate across RUNS — while letting the files run in parallel again.
 *
 * What this does NOT give you is isolation BETWEEN files within one run. Files share the
 * database, so a test that counts rows globally (rather than filtering by its own account
 * or id) can see another file's writes. No test does that today; one that did would be
 * flaky, and the fix is to scope it, not to serialise the suite.
 *
 * FAILS CLOSED: refuses to run against the real database.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE = join(HERE, 'docker-compose.yml');

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

function envValue(file, key) {
  if (!existsSync(file)) return undefined;
  const m = new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm').exec(readFileSync(file, 'utf8'));
  return m?.[1]?.trim();
}

const DB = process.env.POSTGRES_DB ?? envValue(join(HERE, '.env.test'), 'POSTGRES_DB');
const USER = process.env.POSTGRES_USER ?? envValue(join(HERE, '.env'), 'POSTGRES_USER') ?? 'redbot';

if (!DB) die('db/.env.test does not set POSTGRES_DB — it names the test database.');
if (DB === 'redbot') {
  die('Refusing to truncate "redbot" — that is the real database. db/.env.test must name a test database.');
}

const psql = (sql) => spawnSync('docker', [
  'compose', '-f', COMPOSE, 'exec', '-T', 'db',
  'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', USER, '-d', DB
], { input: sql, encoding: 'utf8' });

const up = psql('SELECT 1;');
if (up.status !== 0) {
  die(
    'The test suite needs Postgres.\n\n' +
    `  ${(up.stderr ?? '').trim().split('\n')[0] ?? ''}\n\n` +
    '  docker compose -f db/docker-compose.yml up -d\n' +
    '  node db/setup-test-db.mjs'
  );
}

/**
 * Tables are discovered, not listed. A hardcoded list goes stale the moment a migration
 * adds one, and the failure is silent — the new table simply never gets cleaned.
 * RESTART IDENTITY matters because the append-only logs are read back in `id` order.
 */
const r = psql(`
  DO $$
  DECLARE t text;
  BEGIN
    SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
      INTO t FROM pg_tables WHERE schemaname = 'redbot';
    IF t IS NOT NULL THEN
      EXECUTE 'TRUNCATE TABLE ' || t || ' RESTART IDENTITY CASCADE';
    END IF;
  END $$;
`);
if (r.status !== 0) die(`Could not reset ${DB}.\n${r.stderr}`);
console.log(`  ${DB} reset`);
