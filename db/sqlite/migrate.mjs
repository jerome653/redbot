#!/usr/bin/env node
/**
 * redbot migration runner — SQLite.
 *
 * ---------------------------------------------------------------------------
 * ZERO DEPENDENCIES, BY DESIGN — and now genuinely zero.
 *
 * db/migrate.mjs (Postgres) said: "redbot's only runtime dependency is playwright. Adding a
 * migration framework — and with it a driver, a config format and a lockfile — to run nine SQL
 * files would cost more than it carries." It then reached that goal by shelling out to the
 * `psql` inside a Docker container, which is a dependency on Docker.
 *
 * This one needs neither. `node:sqlite` is a builtin (Node 22.5+, unflagged since 23.4/22.13),
 * and it is present in Electron's main process too — measured on Electron 43.2.0 / Node 24.18.0,
 * which is the runtime the packaged app uses. So the same runner works from a terminal and from
 * inside the app.
 *
 * Nothing here is clever. It applies files in order, inside a transaction, and records what it
 * applied. The command surface is deliberately identical to the Postgres runner's, so muscle
 * memory and the docs both survive the port.
 * ---------------------------------------------------------------------------
 *
 *   node db/sqlite/migrate.mjs status          what is applied, what is pending
 *   node db/sqlite/migrate.mjs up              apply every pending migration
 *   node db/sqlite/migrate.mjs down [n]        roll back the last n (default 1)
 *   node db/sqlite/migrate.mjs new <name>      scaffold the next up/down pair
 *   node db/sqlite/migrate.mjs verify          assert the schema matches the migrations
 *   node db/sqlite/migrate.mjs sql "SELECT 1"  run one statement
 *   node db/sqlite/migrate.mjs where           print the database path and exit
 *
 * FAIL-CLOSED BEHAVIOURS — each of these exits non-zero rather than guessing:
 *   - an already-applied migration's file has changed since it was applied (checksum drift —
 *     the database and the repository disagree about what the schema IS)
 *   - a rollback is asked for and the .down.sql does not exist
 *   - `verify` finds an expected table missing
 *   - the database file's directory does not exist and cannot be created
 *
 * One deliberate NON-behaviour: this never creates the file for a read-only command. `status`
 * on a machine with no database says "0 applied", it does not quietly bring a database into
 * existence as a side effect of being asked a question.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, 'migrations');
const ROOT = resolve(HERE, '..', '..');

/** Only these names are ever executed, and version/name reach SQL from here. */
const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.(up|down)\.sql$/;

/* ------------------------------------------------------------------ *
 * Where the database is
 *
 * DUPLICATED FROM src/db.ts ON PURPOSE, and pinned by a test.
 *
 * src/db.ts is the source of truth for this resolution. This file cannot import it: dist/ may
 * not be built yet, and "you must compile before you can create your schema" is a worse
 * dependency than a copied function. db/reset-test-db.mjs already carries its own `envValue` for
 * the same reason.
 *
 * Two readers of one rule is two chances to disagree, which src/db.ts warns about in as many
 * words. The answer is not to remove the copy but to make a disagreement fail loudly:
 * src/test/db-path.test.ts asserts that this function and src/db.ts's `dbFile()` return the
 * same path for the same environment.
 * ------------------------------------------------------------------ */
export function dbFile() {
  const named = process.env.REDBOT_DB;
  if (named) return isAbsolute(named) ? named : resolve(ROOT, named);
  const raw = process.env.REDBOT_DATA;
  const data = raw ? (isAbsolute(raw) ? raw : resolve(ROOT, raw)) : join(ROOT, 'data');
  return join(data, 'redbot.db');
}

/**
 * Open the database.
 *
 * `create` is explicit rather than defaulted so a read-only command cannot bring a database into
 * being. `timeout` is the busy timeout: unlike Postgres row locks, a SQLite write lock does not
 * queue forever — it waits this long and then throws SQLITE_BUSY. Five seconds is far longer
 * than any migration's write, and a migration racing another writer should fail rather than sit.
 */
function open({ create = false } = {}) {
  const file = dbFile();
  if (!existsSync(file)) {
    if (!create) {
      return null;
    }
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch (e) {
      die(`Cannot create ${dirname(file)} for the database.\n  ${e.message}`);
    }
  }
  const db = new DatabaseSync(file, { timeout: 5000 });
  // Per-connection, and OFF by default in SQLite — the eleven ON DELETE clauses in the schema
  // are decoration without it. Set before any migration runs so a CASCADE in a down-migration
  // behaves the way the file says it does.
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function openOrDie(opts) {
  const db = open(opts);
  if (!db) {
    die(
      `No database at ${dbFile()}.\n\n` +
      '  Create it with:  node db/sqlite/migrate.mjs up'
    );
  }
  return db;
}

/* ------------------------------------------------------------------ *
 * The ledger
 * ------------------------------------------------------------------ */

/**
 * Postgres kept this in `public` so that rolling back 0001 (which dropped the `redbot` schema)
 * did not destroy the ledger. SQLite has no schemas, so there is nowhere separate to put it —
 * which is fine here for a reason rather than by luck: 0001_init.down.sql drops nothing, so no
 * rollback in this directory can take the ledger with it.
 */
function ensureLedger(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version      TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      checksum     TEXT NOT NULL,
      applied_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      execution_ms INTEGER NOT NULL
    )
  `);
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

function applied(db) {
  const out = new Map();
  for (const r of db.prepare('SELECT version, checksum, name FROM schema_migrations ORDER BY version').all()) {
    out.set(r.version, { version: r.version, checksum: r.checksum, name: r.name });
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
    `  (If this database is disposable, delete it: ${dbFile()})`
  );
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

function cmdStatus() {
  const files = onDisk();
  const db = open();
  const done = db ? (ensureLedger(db), applied(db)) : new Map();
  if (db) assertNoDrift(files, done);

  console.log(`\n  database  ${dbFile()}${db ? '' : '   (does not exist yet)'}`);
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
  db?.close();
  return pending;
}

function cmdUp() {
  const db = openOrDie({ create: true });
  ensureLedger(db);
  const files = onDisk();
  const done = applied(db);
  assertNoDrift(files, done);

  const pending = files.filter((f) => !done.has(f.version));
  if (!pending.length) {
    console.log('\n  Nothing to apply — the schema is up to date.\n');
    db.close();
    return;
  }

  console.log('');
  for (const f of pending) {
    // `-- +no-transaction` opts a migration out of the wrapper — the same marker and the same
    // reason as the Postgres runner. Here it is needed by exactly one file: 0001 sets
    // journal_mode=WAL, which SQLite refuses inside a transaction.
    const wrap = !/^\s*--\s*\+no-transaction/m.test(f.body);
    const started = Date.now();

    try {
      if (wrap) db.exec('BEGIN');
      db.exec(f.body);
      // The ledger row rides in the SAME transaction as the migration, so a failure cannot
      // leave a half-applied schema recorded as done.
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, execution_ms) VALUES ($1,$2,$3,$4)'
      ).run({ 1: f.version, 2: f.name, 3: f.checksum, 4: Date.now() - started });
      if (wrap) db.exec('COMMIT');
    } catch (e) {
      if (wrap) { try { db.exec('ROLLBACK'); } catch { /* nothing open */ } }
      db.close();
      die(`  ${f.version}_${f.name}  FAILED after ${Date.now() - started} ms\n\n  ${e.message}\n`);
    }
    const ms = Date.now() - started;
    db.prepare('UPDATE schema_migrations SET execution_ms = $2 WHERE version = $1')
      .run({ 1: f.version, 2: ms });
    console.log(`  applied  ${f.version}_${f.name}  (${ms} ms)`);
  }
  console.log(`\n  ${pending.length} migration(s) applied.\n`);
  db.close();
}

function cmdDown(nRaw) {
  const n = Number(nRaw ?? 1);
  if (!Number.isInteger(n) || n < 1) die('down takes a positive whole number of migrations.');
  const db = openOrDie();
  ensureLedger(db);
  const files = onDisk();
  const done = applied(db);

  const toRollBack = files.filter((f) => done.has(f.version))
    .sort((a, b) => b.version.localeCompare(a.version)).slice(0, n);
  if (!toRollBack.length) {
    console.log('\n  Nothing to roll back.\n');
    db.close();
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
    try {
      db.exec('BEGIN');
      db.exec(body);
      db.prepare('DELETE FROM schema_migrations WHERE version = $1').run({ 1: f.version });
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
      db.close();
      die(`  ${f.version}_${f.name}  ROLLBACK FAILED\n\n  ${e.message}\n`);
    }
    console.log(`  rolled back  ${f.version}_${f.name}  (${Date.now() - started} ms)`);
  }
  console.log('');
  db.close();
}

function cmdNew(name) {
  if (!name) die('new needs a name:  node db/sqlite/migrate.mjs new add_karma_readings');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!slug) die(`"${name}" does not reduce to a usable name.`);
  const files = onDisk();
  const next = String(files.length ? Number(files.at(-1).version) + 1 : 1).padStart(4, '0');

  const up = join(MIGRATIONS_DIR, `${next}_${slug}.up.sql`);
  const down = join(MIGRATIONS_DIR, `${next}_${slug}.down.sql`);
  if (existsSync(up) || existsSync(down)) die(`${next}_${slug} already exists.`);

  writeFileSync(up, `-- ${next}_${slug} — WHAT this changes and WHY.\n\n`, 'utf8');
  writeFileSync(down, `-- Reverses ${next}_${slug}.\n\n`, 'utf8');
  console.log(`\n  created  db/sqlite/migrations/${next}_${slug}.up.sql`);
  console.log(`  created  db/sqlite/migrations/${next}_${slug}.down.sql\n`);
}

/**
 * Every table the 14 migrations claim to build. Hard-coded rather than derived from the SQL,
 * because a list derived from the migrations could only ever agree with them — the point is to
 * state independently what the schema is supposed to contain.
 */
const EXPECTED_TABLES = [
  'accounts', 'threads', 'thread_comments', 'gap_analyses', 'gaps',
  'opportunity_assessments', 'drafts', 'certifications', 'certification_claims',
  'certification_contradictions', 'certification_epistemic_issues',
  'certification_reasons', 'certification_invalidations',
  'certification_resolution_signals', 'jobs', 'history', 'observations',
  'reviews', 'regret', 'interactions', 'trace', 'confirmations',
  'credentials', 'sources', 'account_machines', 'thread_prefilter'
];

/** Assert the live schema actually contains what the migrations claim to build. */
function cmdVerify() {
  const db = openOrDie();
  const one = (sql) => Object.values(db.prepare(sql).get() ?? {})[0];

  const tables = one(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'"
  );
  const indexes = one(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
  );
  const triggers = one("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger'");
  const appliedN = one('SELECT count(*) AS n FROM schema_migrations');
  const version = one('SELECT sqlite_version() AS v');
  const journal = one('PRAGMA journal_mode');
  const fk = one('PRAGMA foreign_keys');

  // A CHECK constraint is not a row in any catalogue in SQLite — it lives in the stored CREATE
  // TABLE text. Counting occurrences of the keyword there is a coarse measure, and it is
  // labelled as such rather than dressed up as a constraint count.
  const checks = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL"
  ).all().reduce((n, r) => n + (r.sql.match(/\bCHECK\s*\(/gi) ?? []).length, 0);
  const fks = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL"
  ).all().reduce((n, r) => n + (r.sql.match(/\bREFERENCES\b/gi) ?? []).length, 0);

  console.log(`\n  database           ${dbFile()}`);
  console.log(`  engine             sqlite ${version}`);
  console.log(`  journal_mode       ${journal}`);
  console.log(`  foreign_keys       ${fk ? 'on' : 'OFF'}`);
  console.log(`  migrations applied ${appliedN}`);
  console.log(`  tables             ${tables}`);
  console.log(`  indexes            ${indexes}`);
  console.log(`  triggers           ${triggers}`);
  console.log(`  CHECK clauses      ${checks}   (counted in the stored DDL, not a catalogue)`);
  console.log(`  REFERENCES clauses ${fks}\n`);

  const have = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  );
  const missing = EXPECTED_TABLES.filter((t) => !have.has(t));
  if (missing.length) {
    db.close();
    die(`Expected tables are missing: ${missing.join(', ')}\n  Run: node db/sqlite/migrate.mjs up`);
  }

  // The integrity check the file format gives us for free. Postgres had no equivalent to offer.
  const integrity = one('PRAGMA integrity_check');
  const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
  console.log(`  every expected table is present (${EXPECTED_TABLES.length}).`);
  console.log(`  integrity_check    ${integrity}`);
  console.log(`  foreign_key_check  ${fkCheck.length === 0 ? 'no violations' : `${fkCheck.length} VIOLATION(S)`}\n`);
  db.close();
  if (integrity !== 'ok' || fkCheck.length) die('The database failed its own integrity checks.');
}

function cmdSql(sql) {
  if (!sql) die('sql needs a statement:  node db/sqlite/migrate.mjs sql "SELECT 1"');
  const db = openOrDie();
  try {
    // `prepare` works for anything that returns rows; a bare DDL/DML statement returns none.
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    if (rows.length) console.log(JSON.stringify(rows, null, 2));
    else console.log('  (no rows)');
  } catch (e) {
    db.close();
    die(e.message);
  }
  db.close();
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
  case 'sql':     cmdSql(rest.join(' ')); break;
  case 'where':   console.log(dbFile()); break;
  default:
    console.log(`
  redbot migrations — sqlite

    node db/sqlite/migrate.mjs status           what is applied, what is pending
    node db/sqlite/migrate.mjs up               apply every pending migration
    node db/sqlite/migrate.mjs down [n]         roll back the last n (default 1)
    node db/sqlite/migrate.mjs new <name>       scaffold the next up/down pair
    node db/sqlite/migrate.mjs verify           assert the live schema matches
    node db/sqlite/migrate.mjs sql "SELECT 1"   run one statement
    node db/sqlite/migrate.mjs where            print the database path

  The database file is REDBOT_DB, or <REDBOT_DATA|./data>/redbot.db.
`);
    process.exit(cmd ? 1 : 0);
}
