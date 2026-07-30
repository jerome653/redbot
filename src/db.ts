/**
 * SQLite connection.
 *
 * ---------------------------------------------------------------------------
 * THE DATABASE IS THE STORE.
 *
 * `src/store.ts` reads and writes threads, gap analyses, opportunity assessments,
 * drafts and history here. The domain is no longer kept in data/*.json.
 *
 * Secrets live here too, but SEALED — the `credentials` table holds AES-256-GCM ciphertext
 * under a key kept outside the database (src/vault.ts). The old rule was "never in a
 * database — a database gets dumped, and a session cookie in a dump is in every copy of
 * it forever"; the objection is to plaintext, and plaintext never reaches the table. That
 * objection gets SHARPER on a single file, which a person can copy by accident, so the master
 * key moved from a gitignored env file to the OS credential store.
 *
 * What is still a file, and cannot sensibly be anything else: the Chrome profiles under
 * data/chrome-profile-*\/ (Chrome reads its own format from a real directory).
 * ---------------------------------------------------------------------------
 *
 * WHY THIS FILE IS A pg-SHAPED FAÇADE
 *
 * `import pg from 'pg'` appeared in exactly ONE place in this repository: this file. Every
 * other module took the exported `Db` type and called `.query(sql, params)`. That made the
 * whole Postgres dependency a single seam, so the port keeps the seam and replaces what is
 * behind it: `.query()` still takes pg-style `$1` placeholders and a positional array, and
 * still resolves to `{ rows, rowCount }`. The 237 call sites did not have to learn a new shape.
 *
 * Three translations do the work, and each one is here rather than smeared across the 13 row
 * mappers in src/db/:
 *
 *   1. PLACEHOLDERS. SQLite reads `$1` as a NAMED parameter called "1", so a positional
 *      array `[a, b]` is bound as `{ '1': a, '2': b }`. Measured, not assumed. This is why
 *      no SQL string needed its placeholders rewritten.
 *
 *   2. TYPES OUT. Postgres handed back `Date` for timestamptz, a JS array for text[], a
 *      parsed object for jsonb, `Buffer` for bytea and `true`/`false` for boolean. SQLite hands
 *      back strings, integers and Uint8Array. Rather than edit 27 `: Date` fields and 28
 *      `.toISOString()` calls, `rehydrate()` restores the Postgres-shaped value using
 *      `StatementSync.columns()`, which reports each result column's ORIGIN table and column —
 *      through joins and through aliases. Which columns need which treatment is DERIVED from
 *      the schema, not hand-listed: see `columnKinds()`.
 *
 *   3. TYPES IN. A `Date` parameter becomes an ISO string and a boolean becomes 0/1, because
 *      node:sqlite refuses both outright. A raw JS ARRAY is deliberately NOT converted — see
 *      `bind()` for why that one has to stay an error.
 *
 * No secrets in this file, ever — the same rule as src/config.ts. Nothing here logs, echoes,
 * or puts a stored value in an error message.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolved here rather than imported from config.ts, deliberately.
 *
 * config.ts resolves DATA — and with it operatorsPath and the account paths — ONCE at
 * module load, from REDBOT_DATA. Several test files set REDBOT_DATA and then import
 * the module under test, relying on that ordering. Importing config here would load
 * and freeze it earlier than those files expect, which is exactly what happened when
 * the test bootstrap started preloading this module: `operatorsPath` pointed at the
 * real data/ and four operator tests failed looking for a fixture that was written
 * into a temp directory.
 *
 * This module needs one thing from config — where the repository root is — and it can
 * work that out for itself without dragging the seam along.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Anything that can run a query — the shared handles, or a client inside a transaction.
 *
 * Repositories take this rather than a concrete connection so the same function serves a
 * plain read (pass the pool) and a step inside a transaction (pass the client), without a
 * second copy of the SQL.
 */
export interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<R>>;
}

export interface QueryResult<R = Record<string, unknown>> {
  rows: R[];
  /**
   * pg's semantics, preserved: rows RETURNED for a read, rows AFFECTED for a write. Both are
   * relied on — src/db/sources.ts:71 tests it for "did the delete find anything", and
   * src/test/sources.test.ts:159 tests it for "a refused add wrote no row".
   */
  rowCount: number;
}

/** Raised when another process holds the write lock. Distinguishable from a broken database. */
export class DbBusyError extends Error {
  constructor(detail: string) {
    super(
      'The database is held by another redbot process (SQLITE_BUSY). ' +
      'Only one writer at a time: wait for the other command to finish, then retry. ' +
      `(${detail})`
    );
    this.name = 'DbBusyError';
  }
}

const ENV_FILE = join(ROOT, 'db', '.env');

/**
 * Minimal KEY=VALUE reader for db/.env. No interpolation, no `export`, no
 * multiline — a parser that accepts more than the format allows is a parser that will one
 * day accept something wrong.
 *
 * The file no longer holds a database password; SQLite has none. It survives as an override
 * channel for REDBOT_VAULT_KEY, which the test suite sets and which an operator restoring a
 * key by hand needs. src/vault.ts reads its master key through THIS parser rather than growing
 * a second one — two readers of the same file is two chances to disagree about what the file
 * says, and the one holding a decryption key is the worst place to find a disagreement.
 */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 1) continue;
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[s.slice(0, eq).trim()] = v;
  }
  return out;
}

/** A real environment variable beats db/.env. */
export function envValue(key: string): string | undefined {
  return process.env[key] ?? readEnvFile(ENV_FILE)[key];
}

/**
 * Where the database file is.
 *
 * `REDBOT_DB` names it outright, and WINS over REDBOT_DATA. That precedence is load-bearing for
 * the console's own tests: they hand a child a throwaway REDBOT_DATA to get a fresh `data/`
 * directory, while still expecting it to talk to the shared test DATABASE. If REDBOT_DATA won,
 * each of those children would silently open an empty file with no schema in it.
 *
 * Otherwise the database sits beside the rest of the working state, so REDBOT_DATA relocates it
 * along with everything else it already relocates — which is what lets the packaged app put
 * everything under the OS's per-user application directory.
 *
 * A RELATIVE path is resolved against the repository root, not the current directory. `resolve()`
 * against cwd was the obvious first choice and is wrong here: tools/product/server.mjs spawns
 * `dist/cli.js`, src/llm.ts runs the Claude CLI in a scratch directory, and the test harness
 * spawns servers of its own — a relative path would have each of them open a DIFFERENT file,
 * and the symptom is "the schema is missing" on a database that was just migrated.
 *
 * db/sqlite/migrate.mjs carries a copy of this function, because it must be runnable before
 * dist/ exists. src/test/db-path.test.ts asserts the two agree, including on this.
 */
export function dbFile(): string {
  const named = process.env.REDBOT_DB;
  if (named) return isAbsolute(named) ? named : resolve(ROOT, named);
  const raw = process.env.REDBOT_DATA;
  const data = raw ? (isAbsolute(raw) ? raw : resolve(ROOT, raw)) : join(ROOT, 'data');
  return join(data, 'redbot.db');
}

/** Why the database cannot be used, in words an operator can act on. Null when it can. */
export function dbUnavailableReason(): string | null {
  const file = dbFile();
  if (!existsSync(file)) {
    return `There is no database at ${file}. Create it with: node db/sqlite/migrate.mjs up`;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Connections
 *
 * ONE WRITER, SEVERAL READERS — and this is not an optimisation, it is what keeps the
 * isolation Postgres was providing.
 *
 * `pg.Pool` handed every transaction its OWN client, so a read running concurrently with an
 * open transaction could not see that transaction's uncommitted rows. A single SQLite
 * connection has no such separation: statements on the connection that opened a transaction
 * are INSIDE it. Routing every query down one connection would therefore have let
 * `/api/state` render rows that a half-finished write had not committed and might roll back —
 * the "figures that disagree with the database" failure this project keeps guarding against.
 *
 * So: writes and transactions go to a single writer connection, serialised in-process by a
 * promise queue; reads go to a small pool of separate connections, which in WAL mode each see
 * a consistent snapshot and are never blocked by the writer.
 *
 * Classification is `starts with SELECT` and nothing cleverer. In SQLite a statement beginning
 * with SELECT cannot write — there are no writable CTEs and no side-effecting functions here —
 * so this can only ever err by sending a read to the writer, which costs a little concurrency
 * and no correctness. PRAGMA goes to the writer precisely because some pragmas DO write.
 * ------------------------------------------------------------------ */

const BUSY_TIMEOUT_MS = 5_000;
const MAX_READERS = 3;

let writer: DatabaseSync | null = null;
let readers: DatabaseSync[] = [];
let readerNext = 0;

function connect(file: string): DatabaseSync {
  const db = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
  // Per-connection and OFF by default, unlike Postgres. The schema's sixteen REFERENCES
  // clauses — including the ON DELETE RESTRICT that stops a thread with a draft being
  // deleted — are decoration without this.
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function ensureFile(): string {
  const file = dbFile();
  if (!existsSync(file)) {
    // Create the directory but NOT the database: an absent schema must be reported by
    // ping(), not papered over by handing back an empty database that every query then
    // fails against for a less obvious reason.
    mkdirSync(dirname(file), { recursive: true });
  }
  return file;
}

function writerConn(): DatabaseSync {
  if (!writer) writer = connect(ensureFile());
  return writer;
}

function readerConn(): DatabaseSync {
  const file = ensureFile();
  if (readers.length < MAX_READERS) {
    const db = connect(file);
    readers.push(db);
    return db;
  }
  const db = readers[readerNext % readers.length]!;
  readerNext++;
  return db;
}

/**
 * The process-wide handle, created on first use.
 *
 * Named `getPool` because 157 call sites say so. It is not a pool of interchangeable clients
 * any more; it is a router in front of the connections above.
 */
export function getPool(): Db {
  return ROUTER;
}

/** Close every connection so a CLI command or a test can exit rather than hold the file. */
export async function closePool(): Promise<void> {
  for (const r of readers) { try { r.close(); } catch { /* already closed */ } }
  readers = [];
  readerNext = 0;
  if (writer) {
    const w = writer;
    writer = null;
    try { w.close(); } catch { /* already closed */ }
  }
  // Async to keep the signature every caller already awaits.
  await Promise.resolve();
}

/* ------------------------------------------------------------------ *
 * Parameter binding
 * ------------------------------------------------------------------ */

type Bindable = null | number | bigint | string | Uint8Array;

/**
 * Turn pg's positional array into SQLite's named parameters, converting the two JS types
 * node:sqlite refuses but Postgres accepted.
 *
 * A raw JS ARRAY is REFUSED, with a message that says what to write instead. That refusal is
 * deliberate and load-bearing: in the Postgres code an array parameter meant two completely
 * different things —
 *
 *     'INSERT INTO accounts (knows) VALUES ($1)'                   -- store this array
 *     'SELECT id FROM threads WHERE id = ANY($1)'                  -- match against this list
 *
 * — and the façade cannot tell which from the value. Guessing would silently store the string
 * "a,b" in one case or match nothing in the other. So each call site says what it means:
 * `JSON.stringify(arr)` to store, and `IN (SELECT value FROM json_each($1))` with
 * `JSON.stringify(arr)` to match.
 */
function bind(params: unknown[] | undefined, sql: string): Record<string, Bindable> {
  const out: Record<string, Bindable> = {};
  if (!params) return out;
  for (let i = 0; i < params.length; i++) {
    const v = params[i];
    const key = String(i + 1);
    if (v === undefined || v === null) { out[key] = null; continue; }
    if (v instanceof Date) { out[key] = v.toISOString(); continue; }
    if (typeof v === 'boolean') { out[key] = v ? 1 : 0; continue; }
    if (v instanceof Uint8Array) { out[key] = v; continue; }
    if (Array.isArray(v)) {
      throw new TypeError(
        `$${i + 1} is a JavaScript array, which SQLite cannot bind.\n` +
        `  To STORE it:  pass JSON.stringify(value) — the column is TEXT holding JSON.\n` +
        `  To MATCH it:  write "IN (SELECT value FROM json_each($${i + 1}))" and pass ` +
        `JSON.stringify(value).\n` +
        `  SQL: ${sql.replace(/\s+/g, ' ').trim().slice(0, 160)}`
      );
    }
    if (typeof v === 'object') {
      throw new TypeError(
        `$${i + 1} is an object, which SQLite cannot bind. Pass JSON.stringify(value); the ` +
        `column is TEXT holding JSON.\n  SQL: ${sql.replace(/\s+/g, ' ').trim().slice(0, 160)}`
      );
    }
    if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string') {
      out[key] = v;
      continue;
    }
    throw new TypeError(`$${i + 1} has unsupported type ${typeof v}.`);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Result coercion
 * ------------------------------------------------------------------ */

type ColumnKind = 'date' | 'json' | 'boolean' | 'blob';

/**
 * Which columns need their Postgres-shaped type restored, DERIVED FROM THE LIVE SCHEMA.
 *
 * The alternative was a hand-written list of ~80 columns, which would be one edit away from
 * disagreeing with the migrations for as long as nobody noticed. Instead each kind is read off
 * a marker that the schema already carries for its own reasons:
 *
 *   date     the shape CHECK every timestamp column has:  `col LIKE '____-__-__T%Z'`
 *   json     the validity CHECK every JSON column has:    `json_valid(col)`
 *   boolean  the domain CHECK every boolean column has:    `col IN (0, 1)`
 *   blob     the column's declared type, straight from PRAGMA table_info
 *
 * Those markers are not incidental — they are how the port replaced timestamptz, jsonb/text[]
 * and boolean, so a column that lacks its marker is a column with a schema bug, and it shows
 * up here as a column that stops being coerced. src/test/db-facade.test.ts asserts the derived
 * map against an explicit expected list, so "the marker was written differently" fails loudly
 * instead of quietly turning a Date back into a string.
 */
let kinds: Map<string, ColumnKind> | null = null;

function columnKinds(db: DatabaseSync): Map<string, ColumnKind> {
  if (kinds) return kinds;
  const map = new Map<string, ColumnKind>();

  const tables = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL"
  ).all() as Array<{ name: string; sql: string }>;

  for (const t of tables) {
    const info = db.prepare(`PRAGMA table_info(${JSON.stringify(t.name)})`).all() as
      Array<{ name: string; type: string }>;
    // Collapse whitespace so a constraint split across lines still matches.
    const ddl = t.sql.replace(/\s+/g, ' ');

    for (const col of info) {
      const c = col.name;
      const q = `"${c}"`;
      const key = `${t.name}.${c}`;

      if ((col.type || '').toUpperCase() === 'BLOB') { map.set(key, 'blob'); continue; }

      // The markers, accepting the column either bare or double-quoted (interactions."self").
      const has = (re: RegExp): boolean => re.test(ddl);
      const name = `(?:${c}|${q.replace(/"/g, '"')})`;

      if (has(new RegExp(`${name}\\s+LIKE\\s+'____-__-__T%Z'`, 'i'))) { map.set(key, 'date'); continue; }
      if (has(new RegExp(`json_valid\\(\\s*${name}\\s*\\)`, 'i')))     { map.set(key, 'json'); continue; }
      if (has(new RegExp(`${name}\\s+IN\\s*\\(\\s*0\\s*,\\s*1\\s*\\)`, 'i'))) { map.set(key, 'boolean'); continue; }
    }
  }

  kinds = map;
  return kinds;
}

/** For tests, and after a migration changes the schema under a live process. */
export function forgetSchema(): void {
  kinds = null;
}

/**
 * Restore the value shapes the row mappers in src/db/ are written against.
 *
 * `columns()` gives the ORIGIN table and column for every result column — verified to survive
 * a LEFT JOIN and an alias — and null for anything computed. A computed column is therefore
 * never coerced, which is correct for `count(*)` and every other expression in the codebase;
 * REDBOT_DB_TRACE_UNMAPPED=1 lists them at runtime so that claim stays checkable rather than
 * assumed.
 *
 * IT ALSO RE-PROTOTYPES EVERY ROW, and that is not cosmetic. `node:sqlite` returns rows created
 * with a NULL prototype; `pg` returned ordinary objects. The difference is invisible until
 * something calls `row.hasOwnProperty(...)`, `row.toString()`, or compares a raw row with
 * `assert.deepStrictEqual` — which reports two identical-looking objects as unequal purely on
 * the prototype. It was caught by exactly that assertion in src/test/db-facade.test.ts. Since
 * every row is copied here anyway to apply the coercions, the copy is given a normal prototype
 * and the whole class of difference goes away.
 */
function rehydrate(
  rows: Array<Record<string, unknown>>,
  meta: Array<{ name: string; column: string | null; table: string | null }>,
  kindOf: Map<string, ColumnKind>
): Array<Record<string, unknown>> {
  const plan = new Map<string, ColumnKind>();
  for (const m of meta) {
    if (!m.table || !m.column) {
      if (process.env.REDBOT_DB_TRACE_UNMAPPED) {
        process.stderr.write(`[db] result column "${m.name}" is computed — not coerced\n`);
      }
      continue;
    }
    const kind = kindOf.get(`${m.table}.${m.column}`);
    if (kind) plan.set(m.name, kind);
  }

  const out: Array<Record<string, unknown>> = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    // A fresh object literal, so the result has Object.prototype like a pg row did.
    const copy: Record<string, unknown> = {};
    for (const name in row) {
      const v = row[name];
      const kind = plan.get(name);
      if (v === null || v === undefined || kind === undefined) { copy[name] = v; continue; }
      switch (kind) {
        case 'date':
          // Postgres handed back a Date. 27 row interfaces say `: Date` and 28 call sites do
          // `.toISOString()` on the result; both keep working because of this line.
          copy[name] = typeof v === 'string' ? new Date(v) : v;
          break;
        case 'json':
          if (typeof v === 'string') {
            // The json_valid CHECK should make this unreachable; if a row predates the CHECK,
            // the raw text is kept rather than the row being lost.
            try { copy[name] = JSON.parse(v); } catch { copy[name] = v; }
          } else copy[name] = v;
          break;
        case 'boolean':
          copy[name] = typeof v === 'number' ? v !== 0 : v;
          break;
        case 'blob':
          // src/vault.ts is typed for Buffer and `timingSafeEqual` needs one; SQLite returns a
          // plain Uint8Array. Buffer.from() over the same memory, not a copy of the bytes.
          copy[name] = (v instanceof Uint8Array && !Buffer.isBuffer(v))
            ? Buffer.from(v.buffer, v.byteOffset, v.byteLength)
            : v;
          break;
      }
    }
    out[i] = copy;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The query path
 * ------------------------------------------------------------------ */

const isRead = (sql: string): boolean => /^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*select\b/i.test(sql);

function runOn<R>(conn: DatabaseSync, sql: string, params?: unknown[]): QueryResult<R> {
  const bound = bind(params, sql);
  let stmt;
  try {
    stmt = conn.prepare(sql);
  } catch (e) {
    throw sqlError(e, sql);
  }
  try {
    if (isRead(sql)) {
      const rows = stmt.all(bound) as Array<Record<string, unknown>>;
      const out = rehydrate(rows, stmt.columns(), columnKinds(conn));
      return { rows: out as R[], rowCount: out.length };
    }
    // A write may still return rows — 4 sites use RETURNING. `all()` covers both: it returns
    // [] for a statement with no result columns, and runs the statement either way.
    const rows = stmt.all(bound) as Array<Record<string, unknown>>;
    const changed = conn.prepare('SELECT changes() AS n').get() as { n: number };
    const out = rows.length ? rehydrate(rows, stmt.columns(), columnKinds(conn)) : rows;
    return { rows: out as R[], rowCount: rows.length ? rows.length : Number(changed.n ?? 0) };
  } catch (e) {
    throw sqlError(e, sql);
  }
}

function sqlError(e: unknown, sql: string): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/SQLITE_BUSY|database is locked/i.test(msg)) return new DbBusyError(msg);
  if (e instanceof Error) {
    // Name the statement. A constraint failure that does not say which query caused it is a
    // half-hour of grep, and the SQL here contains no secrets — only placeholders.
    e.message = `${msg}\n  SQL: ${sql.replace(/\s+/g, ' ').trim().slice(0, 400)}`;
    return e;
  }
  return new Error(msg);
}

/** The router `getPool()` returns: reads fan out to the reader connections, writes serialise. */
const ROUTER: Db = {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<R>> {
    if (isRead(sql)) {
      try { return Promise.resolve(runOn<R>(readerConn(), sql, params)); }
      catch (e) { return Promise.reject(e); }
    }
    return enqueue(() => runOn<R>(writerConn(), sql, params));
  }
};

/* ------------------------------------------------------------------ *
 * Serialising the writer
 *
 * Two `withTransaction` calls in flight at once on ONE connection would interleave their
 * BEGIN/COMMIT and commit each other's work. pg avoided that by giving each transaction its
 * own client. Here the writer is a single connection, so the transactions queue instead —
 * which is what SQLite does to concurrent writers anyway, just without the corruption in
 * between.
 * ------------------------------------------------------------------ */

let tail: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  // The queue must not stop at the first rejection, and must not report an unhandled one.
  tail = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Run `fn` inside a transaction, rolling back on any throw.
 *
 * Every write in src/db/ goes through this. A sync that fails halfway and leaves
 * some tables updated and others not would be a database that disagrees with itself,
 * which is worse than one that never ran.
 *
 * BEGIN IMMEDIATE, not BEGIN. It takes the write lock up front, so a transaction that reads
 * and then writes cannot fail at the write with SQLITE_BUSY after having already decided
 * something from the read. This is also what replaces `SELECT … FOR UPDATE` in
 * src/db/jobs.ts: SQLite has no row locks, and a whole-database write lock is a coarser but
 * strictly stronger answer for a queue that one machine owns.
 */
export async function withTransaction<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  return enqueue(async () => {
    const conn = writerConn();
    const client: Db = {
      query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<R>> {
        // Everything in the transaction goes to the writer, reads included: a read inside the
        // transaction must see the transaction's own uncommitted writes.
        try { return Promise.resolve(runOn<R>(conn, sql, params)); }
        catch (e) { return Promise.reject(e); }
      }
    };

    try {
      conn.exec('BEGIN IMMEDIATE');
    } catch (e) {
      throw sqlError(e, 'BEGIN IMMEDIATE');
    }
    try {
      const out = await fn(client);
      conn.exec('COMMIT');
      return out;
    } catch (e) {
      try { conn.exec('ROLLBACK'); } catch { /* already rolled back, or the connection is gone */ }
      throw e;
    }
  });
}

/* ------------------------------------------------------------------ *
 * Health
 * ------------------------------------------------------------------ */

export interface DbPing {
  ok: boolean;
  detail: string;
  serverVersion?: string;
  migrationsApplied?: number;
}

/**
 * Is the database present AND migrated?
 *
 * Both halves matter. A file that exists with no schema in it is not usable, and reporting it
 * as "connected" is the kind of green light this project has been burned by before — see the
 * doctor check that passed on a headless browser (commit 1daa598).
 *
 * A file-backed database makes that trap EASIER to fall into, not harder: there is no
 * connection to fail, so "the database is there" is nearly free to say and means nearly
 * nothing. Hence four distinct outcomes — absent, unreadable, unmigrated, ok — and never a
 * bare boolean.
 */
export async function ping(): Promise<DbPing> {
  const file = dbFile();
  if (!existsSync(file)) {
    return { ok: false, detail: dbUnavailableReason() ?? 'there is no database file' };
  }

  try {
    const conn = readerConn();
    const v = conn.prepare('SELECT sqlite_version() AS v').get() as { v: string };
    const serverVersion = v?.v ?? 'unknown';

    const ledger = conn.prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    ).get() as { n: number };
    if (!ledger.n) {
      return {
        ok: false, serverVersion,
        detail: 'the file exists, but the schema is missing. Run: node db/sqlite/migrate.mjs up'
      };
    }

    const m = conn.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number };
    const migrationsApplied = Number(m?.n ?? 0);
    if (migrationsApplied === 0) {
      return {
        ok: false, serverVersion, migrationsApplied,
        detail: 'the file exists, but no migrations are applied. Run: node db/sqlite/migrate.mjs up'
      };
    }
    return {
      ok: true, serverVersion, migrationsApplied,
      detail: `sqlite ${serverVersion}, ${migrationsApplied} migration(s) applied`
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not a database|file is encrypted|malformed/i.test(msg)) {
      return { ok: false, detail: `${file} is not a readable SQLite database (${msg}).` };
    }
    return { ok: false, detail: msg };
  }
}
