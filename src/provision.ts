/**
 * First-run provisioning — everything redbot needs that it can build for itself.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY IT RUNS EVERY LAUNCH.
 *
 * Before this, the responsibility was spread across 47 `mkdirSync` calls with no single place
 * that knew the whole tree. That works for as long as every path happens to be guarded by
 * whichever code reaches it first — and it failed exactly where it was not: six `qa/*.mjs` gates
 * crashed on a missing `qa/evidence/`, and there was no `db/.env` for the vault key to live in.
 *
 * The lazy `mkdirSync` calls all stay, as a backstop. Relying on them is the mistake, not having
 * them.
 *
 * IT RUNS ON EVERY LAUNCH, not just the first, and it is IDEMPOTENT. There is no reliable "is
 * this the first run?" signal, and inventing one — a marker file — means a deleted marker
 * silently re-provisions over live data. Running unconditionally is also self-healing when
 * somebody deletes a folder, which an install-time script can never be.
 *
 * IT SEEDS NOTHING. It creates empty structure and stops. No accounts.json, no sources.json, no
 * operator — an install that came with a pre-made account would act as somebody who was never
 * configured, which is the failure `src/cli.ts` already refuses at dispatch. Creating a place to
 * put an account and inventing an account are different acts.
 *
 * IT DOES NOT HANDLE THE VAULT KEY. That needs the OS credential store, which needs Electron;
 * see electron/vault-key.mjs. This module runs in plain Node too — `redbot doctor` from a
 * terminal must keep working — so it reports whether a key is reachable and never invents one.
 * ---------------------------------------------------------------------------
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DATA, paths } from './config.js';
import { dbFile, ping } from './db.js';
import { vaultUnavailableReason } from './vault.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface ProvisionReport {
  /** Where working state lives, resolved. */
  dataRoot: string;
  /** The database file, resolved — reported even when it does not exist yet. */
  databaseFile: string;
  /** Directories this run created. Empty on every launch after the first. */
  created: string[];
  /** Directories that were already there. */
  present: string[];
  /** Migration outcome, or null when the runner could not be reached at all. */
  schema: { applied: number; ok: boolean; detail: string } | null;
  /** Whether a vault master key is reachable. This module never creates one. */
  vaultKey: 'available' | 'missing';
  /**
   * A legacy data root found beside the program. Non-null means an older install's state is
   * sitting somewhere the app no longer reads, which a person must be asked about — never moved
   * automatically. See the note in `legacyDataRoot`.
   */
  legacy: { path: string; entries: number } | null;
  /** Anything a person should know, in the order it happened. */
  notes: string[];
}

/**
 * The directories redbot writes into. Every one of these had a `mkdirSync` somewhere already;
 * naming them here is what makes the tree knowable in one place.
 *
 * `data/accounts/<handle>/` is deliberately absent — it is per-account and created when an
 * account is created (src/jobs.ts). Provisioning a directory for an account nobody has made
 * would be seeding.
 */
function tree(): string[] {
  return [
    DATA,
    join(DATA, 'operators'),
    join(DATA, 'approvals'),
    join(DATA, 'run-logs'),
    paths.reports
  ];
}

/**
 * Is there a `data/` beside the program that is NOT the one we are using?
 *
 * This is the upgrade case: every install before the desktop build kept working state in
 * `<repo>/data`, and the packaged app keeps it under the OS's per-user directory. Pointing at the
 * new location silently repoints every Chrome profile lookup, because `profile_dir` holds a folder
 * NAME resolved against the data root (src/config.ts) — and a profile that is absent at the new
 * location does not error. It presents as an account that is *not set up on this machine*, which
 * reads as "sign in again" rather than "your data moved".
 *
 * So this only ever REPORTS. Nothing here copies or moves anything, and the Chrome profiles
 * genuinely cannot be moved by a script and still work: they are DPAPI-bound to one user on one
 * machine (db/sqlite/migrations/0013_account_machines.up.sql documents the measurement).
 */
function legacyDataRoot(): { path: string; entries: number } | null {
  const legacy = join(ROOT, 'data');
  if (legacy === DATA) return null;
  if (!existsSync(legacy)) return null;
  try {
    if (!statSync(legacy).isDirectory()) return null;
    // Count only what suggests real state, not an empty shell this very function created before.
    const entries = readdirSync(legacy).length;
    return entries ? { path: legacy, entries } : null;
  } catch {
    return null;
  }
}

/**
 * Bring the install up to a state redbot can run in, and report what that took.
 *
 * `runMigrations: false` is for callers that only want the directory tree — the test harness,
 * which builds its own schema through the runner directly.
 */
export async function provision(
  opts: { runMigrations?: boolean } = {}
): Promise<ProvisionReport> {
  const created: string[] = [];
  const present: string[] = [];
  const notes: string[] = [];

  for (const dir of tree()) {
    if (existsSync(dir)) present.push(dir);
    else {
      try {
        mkdirSync(dir, { recursive: true });
        created.push(dir);
      } catch (e) {
        // Fail closed and SAY so, rather than letting the first write fail somewhere less obvious.
        notes.push(`could not create ${dir}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  let schema: ProvisionReport['schema'] = null;
  if (opts.runMigrations !== false) {
    schema = await ensureSchema(notes);
  }

  const vaultKey = vaultUnavailableReason() === null ? 'available' : 'missing';
  if (vaultKey === 'missing') {
    notes.push('no vault master key is reachable — stored secrets cannot be opened until one is set');
  }

  const legacy = legacyDataRoot();
  if (legacy) {
    notes.push(
      `an older data directory exists at ${legacy.path} (${legacy.entries} entries) and is NOT in use. ` +
      'Nothing has been moved. Chrome profiles are bound to one machine and user and cannot be ' +
      'copied, so this needs a person to decide.'
    );
  }

  return {
    dataRoot: DATA,
    databaseFile: dbFile(),
    created, present, schema, vaultKey, legacy, notes
  };
}

/**
 * Apply any pending migrations, creating the database if it does not exist.
 *
 * Runs the REAL runner as a child process rather than reimplementing it. The runner already owns
 * the ledger, the checksum-drift refusal and the transaction wrapper, and a second implementation
 * of "apply the schema" is the kind of duplicate that disagrees with the first one silently. It is
 * also idempotent by construction — `up` on an up-to-date database applies nothing.
 */
async function ensureSchema(notes: string[]): Promise<ProvisionReport['schema']> {
  const runner = join(ROOT, 'db', 'sqlite', 'migrate.mjs');
  if (!existsSync(runner)) {
    notes.push(`the migration runner is missing at ${runner}`);
    return { applied: 0, ok: false, detail: 'migration runner not found' };
  }

  const before = await ping();
  const r = spawnSync(process.execPath, [runner, 'up'], {
    encoding: 'utf8',
    /**
     * ELECTRON_RUN_AS_NODE, because `process.execPath` is not always `node`.
     *
     * Inside the desktop shell it is the Electron binary, and an Electron child WITHOUT this flag
     * keeps its event loop alive waiting for app-lifecycle events — so it NEVER EXITS when the
     * script finishes, and its stdout never reaches the parent. Measured: 124 (killed) vs 0.
     *
     * That is what hung boot, with no error anywhere: the runner had already applied the schema,
     * and spawnSync sat waiting for a process that was never going to leave. The app's own log
     * simply stopped at this line.
     *
     * The variable is meaningless to plain Node, so setting it unconditionally costs nothing and
     * means this function does not have to know which runtime it is in.
     */
    env: { ...process.env, REDBOT_DB: dbFile(), ELECTRON_RUN_AS_NODE: '1' },
    timeout: 60_000
  });

  if (r.status !== 0) {
    const detail = `${(r.stderr ?? '').trim() || (r.stdout ?? '').trim()}`.split('\n')[0] ?? 'unknown';
    notes.push(`migrations failed: ${detail}`);
    return { applied: 0, ok: false, detail };
  }

  const after = await ping();
  const applied = (after.migrationsApplied ?? 0) - (before.migrationsApplied ?? 0);
  if (applied > 0) notes.push(`applied ${applied} migration(s)`);
  return { applied, ok: after.ok, detail: after.detail };
}

/** One line per fact, for `redbot doctor` and the console's Setup screen. */
export function describeProvision(r: ProvisionReport): string[] {
  const out = [
    `data root      ${r.dataRoot}`,
    `database       ${r.databaseFile}`,
    `directories    ${r.created.length} created · ${r.present.length} already present`
  ];
  if (r.schema) out.push(`schema         ${r.schema.detail}`);
  out.push(`vault key      ${r.vaultKey}`);
  for (const n of r.notes) out.push(`note           ${n}`);
  return out;
}
