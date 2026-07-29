/**
 * accounts — mirror of data/accounts.json into redbot.accounts.
 *
 * Credentials are never written here. `AccountRecord` carries none, and the table has
 * no column that could hold one (db/migrations/0002_accounts.up.sql).
 *
 * TWO KINDS OF FACT, TWO TABLES. What an account IS — role, subreddits, ceiling, quiet hours —
 * is portable and belongs in `redbot.accounts`, shared by every machine pointed at this
 * database. Which Chrome it drives — the profile folder, the debugging port — is true of ONE
 * computer only, and lives in `redbot.account_machines` keyed by machine (0013). Every function
 * here therefore takes the machine it is answering for.
 *
 * The legacy `accounts.profile_dir` / `accounts.debug_port` columns are still read as a
 * fallback, and only when this machine has claimed no binding. That is what makes 0013 a no-op
 * for an install that has always run on one computer: the values it already had keep answering
 * until something writes a binding.
 */
import type { Db } from '../db.js';
import type { AccountRecord } from '../config.js';
import { machineId } from '../machine.js';

interface AccountRow {
  handle: string;
  role: string | null;
  speaks: string | null;
  knows: string[];
  subreddits: string[];
  timezone: string | null;
  quiet_start: number | null;
  quiet_end: number | null;
  daily_ceiling: number | null;
  profile_dir: string | null;
  debug_port: number | null;
  note: string | null;
}

function toRecord(r: AccountRow): AccountRecord {
  const out: AccountRecord = { handle: r.handle };
  if (r.role !== null) out.role = r.role;
  if (r.speaks !== null) out.speaks = r.speaks;
  if (r.knows.length) out.knows = r.knows;
  if (r.subreddits.length) out.subreddits = r.subreddits;
  if (r.timezone !== null) out.timezone = r.timezone;
  if (r.quiet_start !== null && r.quiet_end !== null) out.quietHours = [r.quiet_start, r.quiet_end];
  if (r.daily_ceiling !== null) out.dailyCeiling = r.daily_ceiling;
  if (r.profile_dir !== null) out.profileDir = r.profile_dir;
  if (r.debug_port !== null) out.debugPort = r.debug_port;
  if (r.note !== null) out.note = r.note;
  return out;
}

/**
 * Upsert by handle. The file is configuration a person wrote; it wins.
 *
 * Writes BOTH halves: the description to `redbot.accounts`, and — when the record carries a
 * folder or a port — this machine's binding to `redbot.account_machines`. The legacy columns
 * are still written so that rolling 0013 back, or reading the table with anything older,
 * still finds this machine's values where they have always been.
 */
export async function upsertAccounts(
  db: Db, accounts: AccountRecord[], machine: string = machineId()
): Promise<number> {
  for (const a of accounts) {
    await db.query(
      `INSERT INTO redbot.accounts
         (handle, role, speaks, knows, subreddits, timezone,
          quiet_start, quiet_end, daily_ceiling, profile_dir, debug_port, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (handle) DO UPDATE SET
         role          = EXCLUDED.role,
         speaks        = EXCLUDED.speaks,
         knows         = EXCLUDED.knows,
         subreddits    = EXCLUDED.subreddits,
         timezone      = EXCLUDED.timezone,
         quiet_start   = EXCLUDED.quiet_start,
         quiet_end     = EXCLUDED.quiet_end,
         daily_ceiling = EXCLUDED.daily_ceiling,
         profile_dir   = EXCLUDED.profile_dir,
         debug_port    = EXCLUDED.debug_port,
         note          = EXCLUDED.note`,
      [
        a.handle, a.role ?? null, a.speaks ?? null, a.knows ?? [], a.subreddits ?? [],
        a.timezone ?? null, a.quietHours?.[0] ?? null, a.quietHours?.[1] ?? null,
        a.dailyCeiling ?? null, a.profileDir ?? null, a.debugPort ?? null, a.note ?? null
      ]
    );

    /* Only when there is something to bind. An account synced FROM another machine arrives
       with no folder and no port of its own, and writing an empty binding would claim it here
       while leaving it unusable — "set up on this machine" has to mean a browser exists. */
    if (a.profileDir != null || a.debugPort != null) {
      await bindAccountToMachine(db, machine, a.handle, a.profileDir ?? null, a.debugPort ?? null);
    }
  }
  return accounts.length;
}

/**
 * Claim (or move) an account's browser on one machine.
 *
 * Separate from the description upsert because it is the half that must NOT travel: calling
 * this is what says "this computer runs that account out of this folder, on this port".
 */
export async function bindAccountToMachine(
  db: Db, machine: string, handle: string, profileDir: string | null, debugPort: number | null
): Promise<void> {
  await db.query(
    `INSERT INTO redbot.account_machines (machine, handle, profile_dir, debug_port)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (machine, handle) DO UPDATE SET
       profile_dir = EXCLUDED.profile_dir,
       debug_port  = EXCLUDED.debug_port`,
    [machine, handle, profileDir, debugPort]
  );
}

/** Forget one machine's binding, leaving the shared account description untouched. */
export async function unbindAccountFromMachine(db: Db, machine: string, handle: string): Promise<number> {
  const r = await db.query(
    'DELETE FROM redbot.account_machines WHERE machine = $1 AND lower(handle) = lower($2)',
    [machine, handle]
  );
  return r.rowCount ?? 0;
}

/**
 * Every account, with the folder and port THIS machine uses.
 *
 * The COALESCE is the upgrade path, and its order is the whole point: a binding for this
 * machine wins, and the legacy column answers only when there is none. An install that has
 * always run on one computer has no bindings and keeps behaving exactly as before; the moment
 * anything writes one, that machine's own answer takes over.
 *
 * Whether the answer CAME from this machine is asked separately, through `boundHandles()`, and
 * not returned on the record. The two cases must be tellable apart — an account showing a port
 * only because another machine wrote it into the legacy column is not set up here, and a
 * console that could not say so would offer to start a browser nobody has signed into — but
 * `AccountRecord` is also what `redbot accounts export` writes to data/accounts.json, so a
 * derived field on it would end up in a config file as though a person had put it there.
 */
export async function loadAccountsFromDb(
  db: Db, machine: string = machineId()
): Promise<AccountRecord[]> {
  const r = await db.query<AccountRow>(
    `SELECT a.handle, a.role, a.speaks, a.knows, a.subreddits, a.timezone,
            a.quiet_start, a.quiet_end, a.daily_ceiling, a.note,
            COALESCE(m.profile_dir, a.profile_dir) AS profile_dir,
            COALESCE(m.debug_port,  a.debug_port)  AS debug_port
       FROM redbot.accounts a
       LEFT JOIN redbot.account_machines m
         ON m.handle = a.handle AND m.machine = $1
      ORDER BY a.handle`,
    [machine]
  );
  return r.rows.map(toRecord);
}

/** Which handles have a browser set up on this machine. */
export async function boundHandles(db: Db, machine: string = machineId()): Promise<Set<string>> {
  const r = await db.query<{ handle: string }>(
    'SELECT handle FROM redbot.account_machines WHERE machine = $1', [machine]
  );
  return new Set(r.rows.map((x) => x.handle.toLowerCase()));
}

/** Every machine that has claimed this account, so a person can see where it already runs. */
export async function machinesForAccount(
  db: Db, handle: string
): Promise<{ machine: string; profileDir: string | null; debugPort: number | null }[]> {
  const r = await db.query<{ machine: string; profile_dir: string | null; debug_port: number | null }>(
    `SELECT machine, profile_dir, debug_port FROM redbot.account_machines
      WHERE lower(handle) = lower($1) ORDER BY machine`, [handle]
  );
  return r.rows.map((x) => ({ machine: x.machine, profileDir: x.profile_dir, debugPort: x.debug_port }));
}

/** What a DELETE would take with it. Counted BEFORE the delete, because after it they are gone. */
export interface AccountDependents {
  /** Deleted outright — redbot.jobs.account is ON DELETE CASCADE (0008_jobs.up.sql:27). */
  jobs: number;
  /** Kept, but orphaned — redbot.drafts.account is ON DELETE SET NULL (0006_drafts.up.sql:38). */
  drafts: number;
}

/**
 * How much history hangs off this account.
 *
 * The two numbers mean different things and are reported separately for that reason: the jobs
 * are DESTROYED by the foreign key, the drafts merely stop saying who wrote them. A single
 * "12 related records" would flatten a permanent loss and a cosmetic one into one number.
 */
export async function countAccountDependents(db: Db, handle: string): Promise<AccountDependents> {
  const r = await db.query<{ jobs: string; drafts: string }>(
    `SELECT (SELECT count(*) FROM redbot.jobs   WHERE lower(account) = lower($1))::text AS jobs,
            (SELECT count(*) FROM redbot.drafts WHERE lower(account) = lower($1))::text AS drafts`,
    [handle]
  );
  return { jobs: Number(r.rows[0]?.jobs ?? 0), drafts: Number(r.rows[0]?.drafts ?? 0) };
}

/**
 * Delete one account. Returns how many rows went — 0 means it was not in the database.
 *
 * Case-INSENSITIVE, matching how `createConsoleAccount` refuses a duplicate. The primary key
 * is case-sensitive text, so an exact-match DELETE walks straight past `wp_fixer` while the
 * console still refuses to re-add `WP_Fixer` as "already set up" — an account you can neither
 * remove nor recreate.
 */
export async function deleteAccount(db: Db, handle: string): Promise<number> {
  const r = await db.query('DELETE FROM redbot.accounts WHERE lower(handle) = lower($1)', [handle]);
  return r.rowCount ?? 0;
}

export async function countAccounts(db: Db): Promise<number> {
  const r = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM redbot.accounts');
  return Number(r.rows[0]?.n ?? 0);
}
