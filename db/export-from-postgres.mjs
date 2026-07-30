#!/usr/bin/env node
/**
 * One-shot migration: the live Postgres corpus into the SQLite database.
 *
 * ---------------------------------------------------------------------------
 * THIS READS POSTGRES AND WRITES SQLITE. IT NEVER WRITES TO POSTGRES.
 *
 * The evidence corpus is the thing this project exists to produce, and it currently lives in one
 * Docker volume on one machine. So the rules here are conservative by design:
 *
 *   - Postgres is opened READ ONLY in intent: the only statements sent to it are SELECTs.
 *   - The SQLite side must be EMPTY unless --force is given. Importing into a database that already
 *     has rows would produce a silent union of two corpora, and no count would tell you.
 *   - Every table is verified after the fact by ROW COUNT and by a CONTENT CHECKSUM computed the
 *     same way on both sides. A count alone proves nothing about the values.
 *   - Nothing is deleted from Postgres. Decommissioning is a separate, human decision.
 *
 * WHY A HAND-WRITTEN COLUMN MAP RATHER THAN `SELECT *`.
 *
 * The two schemas are not byte-identical and must not pretend to be: Postgres `text[]` became TEXT
 * holding JSON, `jsonb` became TEXT, `bytea` became BLOB, `boolean` became 0/1 and `timestamptz`
 * became an ISO-8601 string. Each of those is a conversion with a direction, and a `SELECT *` would
 * hide which columns got which treatment. The map below is the conversion, stated.
 *
 *   node db/export-from-postgres.mjs            # dry run: counts only, writes nothing
 *   node db/export-from-postgres.mjs --write    # do it
 *   node db/export-from-postgres.mjs --write --force   # allow a non-empty target
 * ---------------------------------------------------------------------------
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const WRITE = process.argv.includes('--write');
const FORCE = process.argv.includes('--force');

function die(msg) { console.error(`\n  ${msg}\n`); process.exit(1); }

/* ------------------------------------------------------------------ *
 * The conversion map.
 *
 * `json` — a Postgres text[] or jsonb column. pg hands back a JS array/object; SQLite stores the
 *          JSON text. `JSON.stringify` is the conversion, and null stays null (0007's
 *          refutation_ran depends on NULL and '[]' being different facts).
 * `bool` — boolean -> 0/1.
 * `ts`   — timestamptz -> ISO-8601 UTC string, exactly what Date#toISOString produces.
 * `blob` — bytea -> BLOB. pg gives a Buffer, which node:sqlite binds directly.
 * `num`  — numeric -> REAL. pg hands numeric back as a STRING, so it needs Number().
 * absent — copied verbatim (text, integer).
 * ------------------------------------------------------------------ */
const TABLES = [
  ['accounts', ['handle', 'role', 'speaks', ['knows', 'json'], ['subreddits', 'json'], 'timezone',
    'quiet_start', 'quiet_end', 'daily_ceiling', 'profile_dir', 'debug_port', 'note',
    ['created_at', 'ts'], ['updated_at', 'ts']], 'handle'],

  ['threads', ['id', 'permalink', 'title', 'subreddit', 'author', 'upvotes', 'comment_count',
    'age_text', 'age_minutes', 'body', ['collected_at', 'ts'], 'source', 'query',
    ['created_at', 'ts'], ['updated_at', 'ts']], 'id'],

  ['thread_comments', ['thread_id', 'position', 'author', 'body', 'depth'], 'thread_id, position'],

  ['gap_analyses', ['thread_id', 'permalink', 'title', 'question', ['covered', 'json'],
    ['already_answered', 'bool'], 'headroom', ['analyzed_at', 'ts'], 'model',
    ['created_at', 'ts'], ['updated_at', 'ts']], 'thread_id'],

  ['gaps', ['thread_id', 'position', 'kind', 'what', ['fillable', 'bool']], 'thread_id, position'],

  ['opportunity_assessments', ['thread_id', 'permalink', 'title', 'verdict', 'score',
    'thesis_why_thread', 'thesis_what_new', 'thesis_why_not_silent', ['reasons', 'json'],
    ['assessed_at', 'ts'], ['created_at', 'ts'], ['updated_at', 'ts']], 'thread_id'],

  ['drafts', ['id', 'thread_id', 'permalink', 'title', 'body', 'contribution_why_thread',
    'contribution_what_new', 'contribution_why_not_silent', ['novelty_issues', 'json'],
    ['has_disclosure', 'bool'], ['lint_issues', 'json'], ['created_at', 'ts'], 'model', 'account',
    'status', 'cert_verdict', ['cert_at', 'ts'], 'cert_claims', 'cert_fatal_contradictions',
    'published_url', 'comment_permalink', 'comment_id', ['decided_at', 'ts'],
    ['updated_at', 'ts']], 'id'],

  /* Certifications keep their identity: the children reference cert_id, so the surrogate key has
     to survive the copy rather than being regenerated. */
  ['certifications', ['id', 'draft_id', 'thread_id', 'verdict', ['certified_at', 'ts'], 'model',
    'model_analyze', 'model_draft', ['resolution_resolved', 'bool'], 'resolution_detail',
    ['refutation_ran', 'json'], ['citations', 'json'], ['created_at', 'ts']], 'id'],

  ['certification_claims', ['cert_id', 'claim_id', 'text', 'type', 'evidence_class',
    'evidence_detail', 'confidence', ['depends_on', 'json'], 'source_quote'], 'cert_id, claim_id'],

  ['certification_contradictions', ['id', 'cert_id', 'claim_id', 'kind', 'statement',
    'evidence_class', 'evidence_detail', ['fatal', 'bool']], 'id'],

  ['certification_epistemic_issues', ['id', 'cert_id', 'claim_id', 'language_certainty',
    'supported_certainty', 'quote', 'detail'], 'id'],

  ['certification_reasons', ['id', 'cert_id', 'rule', 'claim_id', 'detail'], 'id'],

  ['certification_invalidations', ['cert_id', 'claim_id', 'because_of'],
    'cert_id, claim_id, because_of'],

  ['certification_resolution_signals', ['id', 'cert_id', 'where_found', 'matched', 'context',
    ['by_original_poster', 'bool']], 'id'],

  ['jobs', ['id', 'account', 'kind', 'state', ['args', 'json'], ['run_at', 'ts'], 'after_id',
    'max_attempts', 'every_minutes', 'note', 'attempts', ['created_at', 'ts'], ['updated_at', 'ts'],
    ['started_at', 'ts'], ['finished_at', 'ts'], 'detail', 'code'], 'id'],

  ['history', ['id', ['ts', 'ts'], 'kind', 'account', 'subreddit', 'thread_url', 'permalink',
    'status', 'summary', ['data', 'json']], 'id'],

  ['observations', ['id', ['ts', 'ts'], 'account', 'kind', 'vector', 'permalink', 'checkpoint',
    ['value', 'json'], 'note'], 'id'],

  ['reviews', ['id', ['ts', 'ts'], 'draft_id', 'thread_id', 'permalink', 'decision', 'reason_code',
    'note', 'operator', 'review_seconds', 'total_seconds', 'edit_chars_before', 'edit_chars_after',
    ['edit_retained', 'num'], 'edit_before', 'edit_after', ['quality', 'json'], ['gates', 'json'],
    ['novelty', 'json'], ['contribution', 'json']], 'id'],

  ['regret', ['id', ['ts', 'ts'], 'draft_id', 'thread_id', 'permalink', 'kind', 'answer',
    'category', 'lessons', ['hours_after_publish', 'num'], 'operator'], 'id'],

  ['interactions', ['id', 'schema_version', ['ts', 'ts'], 'kind', 'draft_id', 'thread_id',
    'permalink', 'comment_permalink', 'comment_id', 'account', 'checkpoint',
    ['elapsed_minutes', 'num'], 'vector', ['thread', 'json'], ['self', 'json'],
    ['replies', 'json'], 'note'], 'id'],

  ['trace', ['id', ['ts', 'ts'], 'run_id', 'stage', 'event', 'level', 'thread_id', 'draft_id',
    'ms', ['data', 'json']], 'id'],

  ['confirmations', ['id', ['ts', 'ts'], 'action', 'account', 'job_id', ['confirmed', 'bool'],
    'source', 'observed', 'permalink', 'visibility', 'ms', 'error'], 'id'],

  ['credentials', ['scope', 'name', 'algo', 'key_id', ['iv', 'blob'], ['auth_tag', 'blob'],
    ['ciphertext', 'blob'], 'hint', ['created_at', 'ts'], ['updated_at', 'ts'],
    ['last_used_at', 'ts']], 'scope, name'],

  ['sources', ['kind', 'value', 'why', ['enabled', 'bool'], ['created_at', 'ts'],
    ['updated_at', 'ts']], 'kind, value'],

  ['account_machines', ['machine', 'handle', 'profile_dir', 'debug_port', ['created_at', 'ts'],
    ['updated_at', 'ts']], 'machine, handle'],

  ['thread_prefilter', ['thread_id', 'kind', 'detail', ['checked_at', 'ts'], ['created_at', 'ts'],
    ['updated_at', 'ts']], 'thread_id']
];

const name = (c) => (Array.isArray(c) ? c[0] : c);
const kind = (c) => (Array.isArray(c) ? c[1] : null);

/* ------------------------------------------------------------------ *
 * Postgres, through the runner's psql (no `pg` dependency needed here).
 *
 * Rows come back as JSON so the driver's own type parsing is not in the way — this script decides
 * every conversion explicitly, which is the whole point of the map above.
 * ------------------------------------------------------------------ */
function pg(sql) {
  const r = spawnSync('node', [join(HERE, 'migrate.mjs'), 'psql', sql],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) die(`Postgres read failed.\n${(r.stderr || r.stdout || '').trim().slice(0, 600)}`);
  return r.stdout ?? '';
}

/** Every row of a table, as JSON, ordered deterministically so the checksum is stable. */
function pgRows(table, cols, order) {
  const list = cols.map((c) => {
    const n = name(c);
    // `to_jsonb` keeps arrays as arrays and jsonb as objects; bytea comes out base64 via encode().
    if (kind(c) === 'blob') return `encode("${n}", 'base64') AS "${n}"`;
    if (kind(c) === 'ts') return `to_char("${n}" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "${n}"`;
    return `to_jsonb("${n}") AS "${n}"`;
  }).join(', ');

  const out = pg(
    `\\t\\a\nSELECT json_agg(t)::text FROM (SELECT ${list} FROM redbot.${table} ORDER BY ${order}) t;`
  ).trim();

  const start = out.indexOf('[');
  if (start < 0) return [];
  try {
    return JSON.parse(out.slice(start)) ?? [];
  } catch (e) {
    die(`Could not parse ${table} from Postgres: ${e.message}`);
  }
}

/** The value SQLite should store, given the Postgres value and the column's conversion. */
function convert(v, k) {
  if (v === null || v === undefined) return null;
  switch (k) {
    case 'json': return typeof v === 'string' ? v : JSON.stringify(v);
    case 'bool': return v === true || v === 'true' || v === 1 ? 1 : 0;
    case 'num':  return Number(v);
    case 'blob': return Buffer.from(String(v), 'base64');
    case 'ts':   return String(v);
    default:     return typeof v === 'object' ? JSON.stringify(v) : v;
  }
}

/**
 * A checksum over the VALUES, computed identically on both sides.
 *
 * This is what makes "26 tables copied" mean something. A row count proves the number of rows; this
 * proves the contents. Buffers are compared as base64 and numbers as their JS string form, so the
 * two engines' formatting cannot make identical data look different.
 */
function checksum(rows, cols) {
  const h = createHash('sha256');
  for (const row of rows) {
    for (const c of cols) {
      const v = row[name(c)];
      h.update(v === null || v === undefined ? ' '
        : Buffer.isBuffer(v) ? v.toString('base64')
        : typeof v === 'object' ? JSON.stringify(v)
        : String(v));
      h.update('');
    }
    h.update('');
  }
  return h.digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ */

function sqliteFile() {
  if (process.env.REDBOT_DB) {
    return isAbsolute(process.env.REDBOT_DB) ? process.env.REDBOT_DB : resolve(ROOT, process.env.REDBOT_DB);
  }
  const raw = process.env.REDBOT_DATA;
  const data = raw ? (isAbsolute(raw) ? raw : resolve(ROOT, raw)) : join(ROOT, 'data');
  return join(data, 'redbot.db');
}

const target = sqliteFile();
if (!existsSync(target)) {
  die(`No SQLite database at ${target}.\n  Create it first:  node db/sqlite/migrate.mjs up`);
}

const db = new DatabaseSync(target, { timeout: 10_000 });
db.exec('PRAGMA foreign_keys = ON');

console.log(`\n  from  postgres (redbot schema)`);
console.log(`  to    ${target}`);
console.log(`  mode  ${WRITE ? 'WRITE' : 'dry run — nothing will be written'}\n`);

/* Refuse a non-empty target. A union of two corpora is not something a count would reveal. */
if (WRITE && !FORCE) {
  const busy = [];
  for (const [table] of TABLES) {
    const n = db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
    if (n > 0) busy.push(`${table} (${n})`);
  }
  if (busy.length) {
    db.close();
    die(
      `The target already holds rows: ${busy.join(', ')}.\n` +
      '  Importing would merge two corpora with no way to tell them apart afterwards.\n' +
      '  Start from an empty database, or pass --force if you are certain.'
    );
  }
}

const results = [];
let failures = 0;

for (const [table, cols, order] of TABLES) {
  const rows = pgRows(table, cols, order);
  const srcSum = checksum(rows, cols);

  if (WRITE && rows.length) {
    const names = cols.map((c) => `"${name(c)}"`).join(', ');
    const holes = cols.map((_, i) => `$${i + 1}`).join(', ');
    const stmt = db.prepare(`INSERT INTO ${table} (${names}) VALUES (${holes})`);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const bound = {};
        cols.forEach((c, i) => { bound[String(i + 1)] = convert(row[name(c)], kind(c)); });
        stmt.run(bound);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      db.close();
      die(`${table}: import failed and was rolled back.\n  ${e.message}`);
    }
  }

  /* Read it back through the SAME checksum function. Reading back is the only way to know the
     values survived the conversion; trusting the insert would prove only that it did not throw. */
  let dstCount = 0;
  let dstSum = '(not written)';
  if (WRITE) {
    const back = db.prepare(
      `SELECT ${cols.map((c) => `"${name(c)}"`).join(', ')} FROM ${table} ORDER BY ${order}`
    ).all();
    dstCount = back.length;
    // Re-shape SQLite's values back into the source's shape so the checksums are comparable.
    const shaped = back.map((r) => {
      const o = {};
      for (const c of cols) {
        const n = name(c);
        const v = r[n];
        o[n] = kind(c) === 'json' && typeof v === 'string' ? JSON.parse(v)
          : kind(c) === 'bool' ? (v === 1)
          : kind(c) === 'blob' && v ? Buffer.from(v)
          : v;
      }
      return o;
    });
    const srcShaped = rows.map((r) => {
      const o = {};
      for (const c of cols) {
        const n = name(c);
        o[n] = kind(c) === 'blob' && r[n] ? Buffer.from(String(r[n]), 'base64')
          : kind(c) === 'num' && r[n] != null ? Number(r[n])
          : r[n];
      }
      return o;
    });
    dstSum = checksum(shaped, cols);
    const expect = checksum(srcShaped, cols);
    const ok = dstCount === rows.length && dstSum === expect;
    if (!ok) failures++;
    results.push({ table, src: rows.length, dst: dstCount, ok, srcSum: expect, dstSum });
  } else {
    results.push({ table, src: rows.length, dst: 0, ok: null, srcSum, dstSum });
  }
}

const pad = Math.max(...results.map((r) => r.table.length));
console.log(`  ${'table'.padEnd(pad)}  postgres   sqlite  checksum`);
console.log(`  ${'-'.repeat(pad)}  --------   ------  --------`);
for (const r of results) {
  const mark = r.ok === null ? ' ' : r.ok ? 'OK' : 'XX';
  console.log(
    `  ${r.table.padEnd(pad)}  ${String(r.src).padStart(8)}  ${String(r.dst).padStart(6)}  ` +
    `${mark} ${r.ok === null ? r.srcSum : `${r.srcSum}${r.ok ? '' : ` != ${r.dstSum}`}`}`
  );
}

const totalSrc = results.reduce((s, r) => s + r.src, 0);
console.log(`\n  ${TABLES.length} tables · ${totalSrc} source rows`);

if (!WRITE) {
  console.log('\n  Dry run. Nothing was written. Re-run with --write to import.\n');
  db.close();
  process.exit(0);
}

const integrity = db.prepare('PRAGMA integrity_check').get();
const fk = db.prepare('PRAGMA foreign_key_check').all();
console.log(`  integrity_check    ${Object.values(integrity)[0]}`);
console.log(`  foreign_key_check  ${fk.length ? `${fk.length} VIOLATION(S)` : 'no violations'}`);
db.close();

if (failures || fk.length || Object.values(integrity)[0] !== 'ok') {
  die(`${failures} table(s) did not verify. Postgres is untouched; delete the SQLite file and retry.`);
}
console.log('\n  Every table matched by row count and content checksum. Postgres is unchanged.\n');
