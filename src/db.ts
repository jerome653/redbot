/**
 * Postgres connection.
 *
 * ---------------------------------------------------------------------------
 * THE DATABASE IS THE STORE.
 *
 * `src/store.ts` reads and writes threads, gap analyses, opportunity assessments,
 * drafts and history here. The domain is no longer kept in data/*.json.
 *
 * Secrets live here too, but SEALED — redbot.credentials holds AES-256-GCM ciphertext
 * under a key kept outside the database (src/vault.ts). The old rule was "never in a
 * database — a database gets dumped, and a session cookie in a dump is in every copy of
 * it forever"; the objection is to plaintext, and plaintext never reaches the table.
 *
 * What is still a file, and cannot sensibly be anything else: the Chrome profiles under
 * data/chrome-profile-*\/ (Chrome reads its own format from a real directory), and the
 * Postgres password, which unlocks the database the vault lives in.
 * ---------------------------------------------------------------------------
 *
 * No secrets in this file, ever — the same rule as src/config.ts. The password is
 * read from db/.env (gitignored) or the environment, and is never logged, never
 * echoed, and never included in an error message.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

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

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Anything that can run a query — the pool itself, or a client inside a transaction.
 *
 * Repositories take this rather than a PoolClient so the same function serves a
 * plain read (pass the pool) and a step inside a transaction (pass the client),
 * without a second copy of the SQL.
 */
export type Db = pg.Pool | pg.PoolClient;

const ENV_FILE = join(ROOT, 'db', '.env');

/**
 * Minimal KEY=VALUE reader for db/.env. No interpolation, no `export`, no
 * multiline — the file is four lines and a parser that accepts more than the format
 * allows is a parser that will one day accept something wrong.
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

/**
 * Resolve connection settings. A real environment variable beats the file, so CI or
 * a one-off shell can point at a different database without editing anything.
 *
 * Returns null when no password is available. Absence is reported, never guessed at:
 * an empty password would otherwise become a connection attempt that fails somewhere
 * less obvious, with a message about the wrong thing.
 */
export function dbConfig(): DbConfig | null {
  const file = readEnvFile(ENV_FILE);
  const pick = (k: string): string | undefined => process.env[k] ?? file[k];

  const password = pick('POSTGRES_PASSWORD');
  if (!password) return null;

  return {
    host: pick('POSTGRES_HOST') ?? '127.0.0.1',
    port: Number(pick('POSTGRES_PORT') ?? 5432),
    database: pick('POSTGRES_DB') ?? 'redbot',
    user: pick('POSTGRES_USER') ?? 'redbot',
    password
  };
}

/**
 * One setting, resolved the same way the connection settings are: a real environment
 * variable beats db/.env.
 *
 * Exported so the vault (src/vault.ts) reads its master key through THIS parser rather
 * than growing a second one. Two readers of the same file is two chances to disagree
 * about what the file says, and the one holding a decryption key is the worst place to
 * discover a disagreement.
 */
export function envValue(key: string): string | undefined {
  return process.env[key] ?? readEnvFile(ENV_FILE)[key];
}

/** Why the database cannot be used, in words an operator can act on. */
export function dbUnavailableReason(): string | null {
  if (dbConfig()) return null;
  return existsSync(ENV_FILE)
    ? `${ENV_FILE} has no POSTGRES_PASSWORD. Set one, then: docker compose -f db/docker-compose.yml up -d`
    : 'db/.env does not exist. Copy db/.env.example to db/.env and set POSTGRES_PASSWORD.';
}

let pool: pg.Pool | null = null;

/**
 * The process-wide pool, created on first use.
 *
 * `search_path` is set per connection rather than relied on from the database
 * default, so a connection made by anything that did not run 0001_init still
 * resolves `threads` to `redbot.threads`.
 */
export function getPool(): pg.Pool {
  if (pool) return pool;
  const cfg = dbConfig();
  if (!cfg) throw new Error(dbUnavailableReason() ?? 'database is not configured');

  pool = new pg.Pool({
    ...cfg,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    options: '-c search_path=redbot,public'
  });

  // Without this an idle-client error (the container stopping under us) is an
  // unhandled 'error' event, which terminates the process rather than failing the
  // command that was running.
  pool.on('error', () => { /* surfaced at the next query instead */ });

  return pool;
}

/** Close the pool so a CLI command or a test can exit rather than hang on an open socket. */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}

export interface DbPing {
  ok: boolean;
  detail: string;
  serverVersion?: string;
  migrationsApplied?: number;
}

/**
 * Is the database reachable AND migrated?
 *
 * Both halves matter. A reachable database with no schema is not usable, and
 * reporting it as "connected" is the kind of green light this project has been
 * burned by before — see the doctor check that passed on a headless browser.
 */
export async function ping(): Promise<DbPing> {
  const cfg = dbConfig();
  if (!cfg) return { ok: false, detail: dbUnavailableReason() ?? 'not configured' };

  try {
    const r = await getPool().query<{ version: string }>('SHOW server_version');
    const serverVersion = r.rows[0]?.version ?? 'unknown';

    const m = await getPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.schema_migrations`
    );
    const migrationsApplied = Number(m.rows[0]?.n ?? 0);

    if (migrationsApplied === 0) {
      return {
        ok: false, serverVersion, migrationsApplied,
        detail: 'connected, but no migrations are applied. Run: node db/migrate.mjs up'
      };
    }
    return {
      ok: true, serverVersion, migrationsApplied,
      detail: `postgres ${serverVersion}, ${migrationsApplied} migration(s) applied`
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // relation "public.schema_migrations" does not exist
    if (/schema_migrations/.test(msg)) {
      return { ok: false, detail: 'connected, but the schema is missing. Run: node db/migrate.mjs up' };
    }
    return {
      ok: false,
      detail: `${msg}. Is it running? docker compose -f db/docker-compose.yml ps`
    };
  }
}

/**
 * Run `fn` inside a transaction, rolling back on any throw.
 *
 * Every write in src/db/ goes through this. A sync that fails halfway and leaves
 * some tables updated and others not would be a database that disagrees with itself
 * and with `data/`, which is worse than one that never ran.
 */
export async function withTransaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
}
