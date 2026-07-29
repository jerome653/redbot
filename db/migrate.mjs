#!/usr/bin/env node
/**
 * redbot migration runner.
 *
 * ---------------------------------------------------------------------------
 * ZERO DEPENDENCIES, BY DESIGN.
 *
 * redbot's only runtime dependency is playwright. Adding a migration framework —
 * and with it a driver, a config format and a lockfile — to run nine SQL files
 * would cost more than it carries. Migrations are plain SQL, applied by piping
 * them into the `psql` that already exists inside the container.
 *
 * Nothing here is clever. It applies files in order, inside a transaction, and
 * records what it applied.
 * ---------------------------------------------------------------------------
 *
 *   node db/migrate.mjs status          what is applied, what is pending
 *   node db/migrate.mjs up              apply every pending migration
 *   node db/migrate.mjs down [n]        roll back the last n (default 1)
 *   node db/migrate.mjs new <name>      scaffold the next up/down pair
 *   node db/migrate.mjs verify          assert the schema matches the migrations
 *   node db/migrate.mjs psql "SELECT 1" run one statement
 *
 * FAIL-CLOSED BEHAVIOURS — each of these exits non-zero rather than guessing:
 *   - the container is not running, or is not yet healthy
 *   - an already-applied migration's file has changed since it was applied
 *     (checksum drift — the database and the repository disagree about history)
 *   - a rollback is asked for and the .down.sql does not exist
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, 'migrations');
const COMPOSE_FILE = join(HERE, 'docker-compose.yml');
const ENV_FILE = join(HERE, '.env');
const SERVICE = 'db';

/** Only these names are ever executed, and version/name reach SQL from here. */
const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.(up|down)\.sql$/;

/* ------------------------------------------------------------------ *
 * Environment
 * ------------------------------------------------------------------ */

/** Minimal KEY=VALUE reader. No interpolation, no export, no multiline. */
function loadEnv() {
  const env = { POSTGRES_DB: 'redbot', POSTGRES_USER: 'redbot' };
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const eq = s.indexOf('=');
      if (eq < 1) continue;
      let v = s.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      env[s.slice(0, eq).trim()] = v;
    }
  }
  // A real environment variable wins over the file.
  for (const k of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_PORT']) {
    if (process.env[k]) env[k] = process.env[k];
  }
  return env;
}

/* ------------------------------------------------------------------ *
 * psql
 * ------------------------------------------------------------------ */

/**
 * Run SQL inside the container.
 *
 * `-X` skips ~/.psqlrc, `ON_ERROR_STOP=1` makes a failed statement a non-zero exit
 * rather than a warning psql prints and carries on from — without it a broken
 * migration would be recorded as applied.
 */
function psql(sql, { tuplesOnly = false } = {}) {
  const env = loadEnv();
  const args = [
    'compose', '-f', COMPOSE_FILE, 'exec', '-T',
    ...(env.POSTGRES_PASSWORD ? ['-e', `PGPASSWORD=${env.POSTGRES_PASSWORD}`] : []),
    SERVICE, 'psql',
    '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB,
    ...(tuplesOnly ? ['-t', '-A'] : [])
  ];
  return spawnSync('docker', args, { input: sql, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function requireContainer() {
  const r = psql('SELECT 1;', { tuplesOnly: true });
  if (r.status === 0) return;
  const detail = `${r.stderr ?? ''}${r.stdout ?? ''}`.trim();
  die(
    'Cannot reach the database.\n\n' +
    `  ${detail.split('\n').slice(0, 4).join('\n  ') || 'docker exited ' + r.status}\n\n` +
    '  Start it with:  docker compose -f db/docker-compose.yml up -d\n' +
    '  Then check:     docker compose -f db/docker-compose.yml ps'
  );
}

/** The ledger lives in `public`, not `redbot` — 0001_init.down drops the redbot schema. */
function ensureLedger() {
  const r = psql(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version      text PRIMARY KEY,
      name         text NOT NULL,
      checksum     text NOT NULL,
      applied_at   timestamptz NOT NULL DEFAULT now(),
      execution_ms integer NOT NULL
    );
    COMMENT ON TABLE public.schema_migrations IS
      'Applied migrations. Written only by db/migrate.mjs. Lives in public so rolling back 0001 does not destroy the ledger.';
  `);
  if (r.status !== 0) die(`Could not create the migration ledger.\n${r.stderr}`);
}

/* ------------------------------------------------------------------ *
 * Migration files
 * ------------------------------------------------------------------ */

function onDisk() {
  if (!existsSync(MIGRATIONS_DIR)) die(`No migrations directory at ${MIGRATIONS_DIR}`);
  const ups = new Map();
  for (const f of readdirSync(MIGRATIONS_DIR).sort()) {
    const m = FILE_RE.exec(f);
    if (!m) {
      if (f.endsWith('.sql')) {
        die(`"${f}" is not a usable migration name. Expected NNNN_lower_snake.(up|down).sql`);
      }
      continue;
    }
    const [, version, name, direction] = m;
    if (direction !== 'up') continue;
    const body = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    ups.set(version, {
      version,
      name,
      upFile: f,
      downFile: `${version}_${name}.down.sql`,
      body,
      checksum: createHash('sha256').update(body).digest('hex').slice(0, 16)
    });
  }
  if (!ups.size) die('No migrations found.');
  return [...ups.values()].sort((a, b) => a.version.localeCompare(b.version));
}

function applied() {
  const r = psql(
    "SELECT version || '\t' || checksum || '\t' || name FROM public.schema_migrations ORDER BY version;",
    { tuplesOnly: true }
  );
  if (r.status !== 0) die(`Could not read the migration ledger.\n${r.stderr}`);
  const out = new Map();
  for (const line of (r.stdout ?? '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const [version, checksum, name] = s.split('\t');
    out.set(version, { version, checksum, name });
  }
  return out;
}

/**
 * A file that changed after it was applied means the database and the repository
 * disagree about what the schema IS. Editing an applied migration is the mistake;
 * the fix is a new migration, so this refuses rather than silently continuing.
 */
function assertNoDrift(files, done) {
  const drifted = files.filter((f) => done.has(f.version) && done.get(f.version).checksum !== f.checksum);
  if (!drifted.length) return;
  die(
    'Applied migrations have changed on disk:\n\n' +
    drifted.map((f) => `  ${f.version}_${f.name}  ledger ${done.get(f.version).checksum} != file ${f.checksum}`).join('\n') +
    '\n\n  An applied migration is history and cannot be edited. Write a new migration instead.\n' +
    '  (If this database is disposable: docker compose -f db/docker-compose.yml down -v)'
  );
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

function cmdStatus() {
  requireContainer();
  ensureLedger();
  const files = onDisk();
  const done = applied();
  assertNoDrift(files, done);

  console.log('\n  version  state      name');
  console.log('  -------  ---------  ----------------------------------');
  for (const f of files) {
    console.log(`  ${f.version}     ${done.has(f.version) ? 'applied  ' : 'PENDING  '}  ${f.name}`);
  }
  const pending = files.filter((f) => !done.has(f.version)).length;

  // A ledger row with no file is the opposite drift: someone deleted a migration.
  const orphans = [...done.keys()].filter((v) => !files.some((f) => f.version === v));
  if (orphans.length) {
    console.log(`\n  WARNING  applied but missing from disk: ${orphans.join(', ')}`);
  }
  console.log(`\n  ${files.length - pending} applied · ${pending} pending\n`);
  return pending;
}

function cmdUp() {
  requireContainer();
  ensureLedger();
  const files = onDisk();
  const done = applied();
  assertNoDrift(files, done);

  const pending = files.filter((f) => !done.has(f.version));
  if (!pending.length) {
    console.log('\n  Nothing to apply — the schema is up to date.\n');
    return;
  }

  console.log('');
  for (const f of pending) {
    // `-- +no-transaction` opts a migration out of the wrapper. Needed for the rare
    // statement Postgres refuses to run inside a transaction block.
    const wrap = !/^\s*--\s*\+no-transaction/m.test(f.body);
    const started = Date.now();

    // The INSERT rides in the SAME transaction as the migration, so a failure cannot
    // leave a half-applied schema recorded as done.
    const ledger =
      `INSERT INTO public.schema_migrations (version, name, checksum, execution_ms) ` +
      `VALUES ($v$${f.version}$v$, $v$${f.name}$v$, $v$${f.checksum}$v$, %MS%);`;

    const run = (ms) => psql(
      wrap ? `BEGIN;\n${f.body}\n${ledger.replace('%MS%', ms)}\nCOMMIT;`
           : `${f.body}\n${ledger.replace('%MS%', ms)}`
    );

    // Two passes would run the SQL twice; instead time a single pass and accept that
    // the recorded ms is measured around the psql call, not inside it.
    const r = run(0);
    const ms = Date.now() - started;
    if (r.status !== 0) {
      die(`  ${f.version}_${f.name}  FAILED after ${ms} ms\n\n${(r.stderr || r.stdout || '').trim()}\n`);
    }
    psql(`UPDATE public.schema_migrations SET execution_ms = ${ms} WHERE version = $v$${f.version}$v$;`);
    console.log(`  applied  ${f.version}_${f.name}  (${ms} ms)`);
  }
  console.log(`\n  ${pending.length} migration(s) applied.\n`);
}

function cmdDown(nRaw) {
  const n = Number(nRaw ?? 1);
  if (!Number.isInteger(n) || n < 1) die('down takes a positive whole number of migrations.');
  requireContainer();
  ensureLedger();
  const files = onDisk();
  const done = applied();

  const toRollBack = files.filter((f) => done.has(f.version)).sort((a, b) => b.version.localeCompare(a.version)).slice(0, n);
  if (!toRollBack.length) {
    console.log('\n  Nothing to roll back.\n');
    return;
  }

  // Check every down file exists BEFORE running any of them — a rollback that stops
  // halfway is worse than one that never starts.
  for (const f of toRollBack) {
    if (!existsSync(join(MIGRATIONS_DIR, f.downFile))) {
      die(`${f.version}_${f.name} has no ${f.downFile}. Refusing to roll back a migration that cannot be reversed.`);
    }
  }

  console.log('');
  for (const f of toRollBack) {
    const body = readFileSync(join(MIGRATIONS_DIR, f.downFile), 'utf8');
    const started = Date.now();
    const r = psql(
      `BEGIN;\n${body}\nDELETE FROM public.schema_migrations WHERE version = $v$${f.version}$v$;\nCOMMIT;`
    );
    if (r.status !== 0) {
      die(`  ${f.version}_${f.name}  ROLLBACK FAILED\n\n${(r.stderr || r.stdout || '').trim()}\n`);
    }
    console.log(`  rolled back  ${f.version}_${f.name}  (${Date.now() - started} ms)`);
  }
  console.log('');
}

function cmdNew(name) {
  if (!name) die('new needs a name:  node db/migrate.mjs new add_karma_readings');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!slug) die(`"${name}" does not reduce to a usable name.`);
  const next = String(onDisk().length ? Number(onDisk().at(-1).version) + 1 : 1).padStart(4, '0');

  const up = join(MIGRATIONS_DIR, `${next}_${slug}.up.sql`);
  const down = join(MIGRATIONS_DIR, `${next}_${slug}.down.sql`);
  if (existsSync(up) || existsSync(down)) die(`${next}_${slug} already exists.`);

  writeFileSync(up, `-- ${next}_${slug} — WHAT this changes and WHY.\n\n`, 'utf8');
  writeFileSync(down, `-- Reverses ${next}_${slug}.\n\n`, 'utf8');
  console.log(`\n  created  db/migrations/${next}_${slug}.up.sql`);
  console.log(`  created  db/migrations/${next}_${slug}.down.sql\n`);
}

/** Assert the live schema actually contains what the migrations claim to build. */
function cmdVerify() {
  requireContainer();
  const q = (sql) => (psql(sql, { tuplesOnly: true }).stdout ?? '').trim();

  const tables = q(`SELECT count(*) FROM information_schema.tables WHERE table_schema='redbot' AND table_type='BASE TABLE';`);
  const enums = q(`SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='redbot' AND t.typtype='e';`);
  const fks = q(`SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='redbot' AND c.contype='f';`);
  const checks = q(`SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='redbot' AND c.contype='c';`);
  const indexes = q(`SELECT count(*) FROM pg_indexes WHERE schemaname='redbot';`);
  const applied = q(`SELECT count(*) FROM public.schema_migrations;`);
  const version = q(`SHOW server_version;`);

  console.log(`\n  server            postgres ${version}`);
  console.log(`  migrations applied ${applied}`);
  console.log(`  tables             ${tables}`);
  console.log(`  enum types         ${enums}`);
  console.log(`  foreign keys       ${fks}`);
  console.log(`  check constraints  ${checks}`);
  console.log(`  indexes            ${indexes}\n`);

  const missing = q(`
    SELECT string_agg(t, ', ') FROM unnest(ARRAY[
      'accounts','threads','thread_comments','gap_analyses','gaps',
      'opportunity_assessments','drafts','certifications','certification_claims',
      'certification_contradictions','certification_epistemic_issues',
      'certification_reasons','certification_invalidations',
      'certification_resolution_signals','jobs','history','observations',
      'reviews','regret','interactions','trace','confirmations'
    ]) AS t
    WHERE to_regclass('redbot.' || t) IS NULL;
  `);
  if (missing) die(`Expected tables are missing: ${missing}\n  Run: node db/migrate.mjs up`);
  console.log('  every expected table is present.\n');
}

function cmdPsql(sql) {
  if (!sql) die('psql needs a statement:  node db/migrate.mjs psql "SELECT 1"');
  requireContainer();
  const r = psql(sql);
  process.stdout.write(r.stdout ?? '');
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status ?? 1);
}

/* ------------------------------------------------------------------ */

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'status':  cmdStatus(); break;
  case 'up':      cmdUp(); break;
  case 'down':    cmdDown(rest[0]); break;
  case 'new':     cmdNew(rest[0]); break;
  case 'verify':  cmdVerify(); break;
  case 'psql':    cmdPsql(rest.join(' ')); break;
  default:
    console.log(`
  redbot migrations

    node db/migrate.mjs status            what is applied, what is pending
    node db/migrate.mjs up                apply every pending migration
    node db/migrate.mjs down [n]          roll back the last n (default 1)
    node db/migrate.mjs new <name>        scaffold the next up/down pair
    node db/migrate.mjs verify            assert the live schema matches
    node db/migrate.mjs psql "SELECT 1"   run one statement
`);
    process.exit(cmd ? 1 : 0);
}
