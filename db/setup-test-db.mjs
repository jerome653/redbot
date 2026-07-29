#!/usr/bin/env node
/**
 * Create and migrate the test database.
 *
 * `npm test` runs with `--env-file=db/.env.test`, which points POSTGRES_DB at
 * `redbot_test`. Without this, the suite would read and write the real `redbot`
 * database — the operator's evidence — which is exactly the failure mode
 * REDBOT_DATA was introduced to prevent for the file store (src/config.ts:15).
 *
 *   node db/setup-test-db.mjs          create (if absent) and migrate
 *   node db/setup-test-db.mjs --reset  drop and rebuild from empty
 *
 * Safe to re-run. It refuses to touch anything but the test database.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE = join(HERE, 'docker-compose.yml');

/** Read POSTGRES_DB out of db/.env.test rather than hardcoding the name in two places. */
function testDbName() {
  const f = join(HERE, '.env.test');
  if (!existsSync(f)) die('db/.env.test is missing — it names the test database.');
  const m = /^POSTGRES_DB\s*=\s*(.+)$/m.exec(readFileSync(f, 'utf8'));
  const name = m?.[1]?.trim();
  if (!name) die('db/.env.test does not set POSTGRES_DB.');
  // The whole point of this script is that it cannot reach the real database.
  if (name === 'redbot') die('db/.env.test points at "redbot" — the real database. Refusing.');
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) die(`"${name}" is not a usable database name.`);
  return name;
}

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

function psql(db, sql) {
  return spawnSync('docker', [
    'compose', '-f', COMPOSE, 'exec', '-T', 'db',
    'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', process.env.POSTGRES_USER ?? 'redbot', '-d', db
  ], { input: sql, encoding: 'utf8' });
}

const NAME = testDbName();
const reset = process.argv.includes('--reset');

const up = psql('postgres', 'SELECT 1;');
if (up.status !== 0) {
  die('Cannot reach Postgres.\n  Start it with:  docker compose -f db/docker-compose.yml up -d');
}

if (reset) {
  const r = psql('postgres', `DROP DATABASE IF EXISTS ${NAME} WITH (FORCE);`);
  if (r.status !== 0) die(`Could not drop ${NAME}.\n${r.stderr}`);
  console.log(`  dropped  ${NAME}`);
}

const exists = psql('postgres', `SELECT 1 FROM pg_database WHERE datname = '${NAME}';`);
if (!/1 row/.test(exists.stdout ?? '') && !/^\s*1\s*$/m.test(exists.stdout ?? '')) {
  const r = psql('postgres', `CREATE DATABASE ${NAME};`);
  if (r.status !== 0 && !/already exists/.test(r.stderr ?? '')) {
    die(`Could not create ${NAME}.\n${r.stderr}`);
  }
  console.log(`  created  ${NAME}`);
} else {
  console.log(`  exists   ${NAME}`);
}

const mig = spawnSync(process.execPath, [join(HERE, 'migrate.mjs'), 'up'], {
  encoding: 'utf8',
  env: { ...process.env, POSTGRES_DB: NAME }
});
process.stdout.write(mig.stdout ?? '');
if (mig.status !== 0) {
  process.stderr.write(mig.stderr ?? '');
  die(`Migrations failed against ${NAME}.`);
}
console.log(`  ${NAME} is ready.\n`);
