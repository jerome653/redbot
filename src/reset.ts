/**
 * Reset — putting an install back to a known state, on purpose.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT A FEW UNLINK CALLS.
 *
 * Every other destructive path in redbot removes ONE thing a person named. This removes a
 * category, and the operator cannot inspect it first — so what it takes has to be decided in a
 * pure function that can be read, tested and printed BEFORE anything is deleted. The plan is the
 * feature; the deleting is the easy part.
 *
 * TWO THINGS ARE NEVER TAKEN WITHOUT BEING ASKED FOR BY NAME.
 *
 *   - `chrome-profile-*`. Those folders hold the only copy of each Reddit session. No password is
 *     stored anywhere in redbot, so a wipe cannot be undone by "signing in again" from a file —
 *     somebody has to type a password into a browser. This is the same reason removing an account
 *     keeps them, and the reason `--sign-ins` exists as a separate word.
 *   - `schema_migrations`. Not user data: the record of what shape the database is in. Empty it
 *     and the next boot either re-applies every migration over live tables or refuses to start.
 *     That failure cost this project the 2.0.0 → 2.0.1 cycle and it is not being re-invented here.
 *
 * AND ONE THING IS ALWAYS DONE FIRST: a snapshot. `backupEvidence()` copies the irreplaceable
 * half — the append-only logs — before a byte is removed, and a refused backup stops the reset.
 * A reset you cannot walk back from is a different feature from the one being asked for.
 */
import { existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from './config.js';
import { PROFILE_PREFIX } from './profiles.js';

export const RESET_SCOPES = ['work', 'all'] as const;
export type ResetScope = (typeof RESET_SCOPES)[number];

/** Emptied by neither scope. `schema_migrations` is the database's own shape, not your data. */
export const PROTECTED_TABLES = ['schema_migrations'] as const;

/** Never removed by any scope, whatever is asked for. Named so the plan can say so. */
export const KEPT_ALWAYS = [
  'chrome-profile-*',      // unless --sign-ins; the only copy of each Reddit session
  'the secrets vault',     // OS credential store — cleared from the vault screen, not here
  'schema_migrations'
] as const;

/**
 * The corpus and everything derived from it. Re-collectable: nothing here is a record of what
 * redbot DID, only of what it read and worked out.
 */
const WORK_FILES = [
  'threads.json',
  'analysis.json',
  'gaps.json',
  'assessments.json',
  'drafts.json',
  'search-candidates.json',
  'trace.jsonl',
  'ui-status.json'
] as const;

const WORK_DIRS = ['run-logs', 'reports'] as const;

/**
 * The rest of what an operator has accumulated: the logs of what redbot did, who it did it as,
 * and where it was told to look. Order within the array is display order, not delete order.
 */
const ALL_EXTRA_FILES = [
  'history.jsonl',
  'observations.jsonl',
  'certifications.jsonl',
  'decisions.jsonl',
  'confirmations.jsonl',
  'reviews.jsonl',
  'regret.jsonl',
  'interactions.jsonl',
  'accounts.json',
  'sources.json',
  'removed-accounts.json',
  'session.json',
  'install-id'
] as const;

const ALL_EXTRA_DIRS = ['approvals', 'proxy-vet', 'accounts', 'operators'] as const;

/** Emptied for `work`. Every one of these is rebuilt by collecting and scoring again. */
const WORK_TABLES = [
  'thread_prefilter',
  'gap_items',
  'gap_analyses',
  'opportunity_assessments',
  'drafts',
  'threads'
] as const;

/**
 * Emptied for `all`, on top of the above. Listed rather than discovered from `sqlite_master` so
 * that a table added later is NOT silently swept up by an old reset — a new table's contents are
 * a decision, not a default.
 */
const ALL_EXTRA_TABLES = [
  'certification_claim_checks',
  'certification_claim_sources',
  'certification_claims',
  'certifications',
  'jobs',
  'history',
  'observations',
  'account_exit_ips',
  'account_proxies',
  'account_machines',
  'selected_account',
  'accounts',
  'sources'
] as const;

export interface ResetPlan {
  scope: ResetScope;
  /** Names under the data directory. Relative, because the data root can move. */
  files: string[];
  dirs: string[];
  /** Tables emptied, in an order that respects the foreign keys. */
  tables: string[];
  /** True only when the caller asked for the sign-in folders by name. */
  profileDirs: boolean;
  /** What survives, said out loud rather than left to inference. */
  kept: string[];
  warnings: string[];
  summary: string;
}

export function resetPlan(scope: ResetScope, opts: { signIns?: boolean } = {}): ResetPlan {
  if (!(RESET_SCOPES as readonly string[]).includes(scope)) {
    throw new Error(`"${scope}" is not a reset scope. Use one of: ${RESET_SCOPES.join(', ')}.`);
  }
  const wide = scope === 'all';
  const signIns = opts.signIns === true;

  const files = wide ? [...WORK_FILES, ...ALL_EXTRA_FILES] : [...WORK_FILES];
  const dirs = wide ? [...WORK_DIRS, ...ALL_EXTRA_DIRS] : [...WORK_DIRS];
  const tables = wide ? [...WORK_TABLES, ...ALL_EXTRA_TABLES] : [...WORK_TABLES];

  const kept: string[] = [];
  kept.push(signIns
    ? 'chrome-profile-* — being REMOVED, because sign-ins were asked for by name'
    : 'chrome-profile-* — the signed-in Chrome folders, and the only copy of each Reddit session');
  kept.push('the secrets vault — cleared from the vault screen, never as a side effect of this');
  kept.push('schema_migrations — the database\'s own shape, not your data');
  if (!wide) {
    kept.push('accounts.json — who redbot acts as');
    kept.push('sources.json — where it looks');
    kept.push('history.jsonl — what it did, which the health gate counts');
    kept.push('observations.jsonl — what was seen afterwards');
    kept.push('machine-id — this computer\'s identity to the fleet');
  } else {
    kept.push('machine-id — this computer\'s identity, so a reset install is still this machine');
  }

  const warnings: string[] = [];
  if (wide) {
    warnings.push(
      'Clearing history.jsonl resets the health counters: recorded 429s, login failures and ' +
      'removals go with it, so the gate that would have held this account back starts from zero.'
    );
    warnings.push('Accounts and sources are removed — the console will ask you to set up again.');
    warnings.push(
      'install-id goes too, so this install is a NEW one to the dashboard: any ingest or share ' +
      'token minted against the old id stops matching and has to be re-minted.'
    );
  }
  if (signIns) {
    warnings.push(
      'The sign-in folders are being deleted. No password is stored anywhere, so every account ' +
      'has to be signed in by hand in a real browser afterwards. This cannot be undone.'
    );
  }

  const summary =
    `${files.length} file(s), ${dirs.length} folder(s) and ${tables.length} table(s)` +
    (signIns ? ', plus every signed-in Chrome folder' : '');

  return { scope, files, dirs, tables, profileDirs: signIns, kept, warnings, summary };
}

/** The Chrome profile folders present under the data root right now. */
export function profileDirsOnDisk(dataRoot: string = DATA): string[] {
  if (!existsSync(dataRoot)) return [];
  return readdirSync(dataRoot).filter((n) => {
    if (!n.toLowerCase().startsWith(PROFILE_PREFIX)) return false;
    try { return statSync(join(dataRoot, n)).isDirectory(); } catch { return false; }
  });
}

export interface ResetOutcome {
  removedFiles: string[];
  removedDirs: string[];
  clearedTables: Array<{ table: string; rows: number }>;
  missing: string[];
  failed: Array<{ what: string; reason: string }>;
}

/**
 * Carry out a plan. The caller owns the confirmation and the backup — this only deletes, so that
 * "was it confirmed" and "was it backed up" are decided where a person can see them.
 *
 * A failure on one item does not stop the rest: a half-reset that stops at the first locked file
 * leaves an install in a state neither the operator nor redbot can describe. Everything that
 * could not be removed is REPORTED instead.
 */
export async function applyReset(
  plan: ResetPlan,
  db: { query(sql: string, params?: unknown[]): Promise<{ rowCount: number }> } | null,
  dataRoot: string = DATA
): Promise<ResetOutcome> {
  const out: ResetOutcome = {
    removedFiles: [], removedDirs: [], clearedTables: [], missing: [], failed: []
  };

  /* Tables first. If the database refuses, the files are still on disk and the install still
     describes itself — the other order would leave rows pointing at files that are gone. */
  if (db) {
    for (const table of plan.tables) {
      if ((PROTECTED_TABLES as readonly string[]).includes(table)) continue;
      try {
        const r = await db.query(`DELETE FROM ${table}`);
        out.clearedTables.push({ table, rows: r.rowCount ?? 0 });
      } catch (e) {
        /* A table that does not exist on this schema version is not a failure to report at the
           operator — it is a table this install never had. Anything else is. */
        const msg = e instanceof Error ? e.message : String(e);
        if (/no such table/i.test(msg)) out.missing.push(`table ${table}`);
        else out.failed.push({ what: `table ${table}`, reason: msg });
      }
    }
  }

  for (const name of plan.files) {
    const full = join(dataRoot, name);
    if (!existsSync(full)) { out.missing.push(name); continue; }
    try { rmSync(full, { force: true }); out.removedFiles.push(name); }
    catch (e) { out.failed.push({ what: name, reason: e instanceof Error ? e.message : String(e) }); }
  }

  for (const name of plan.dirs) {
    const full = join(dataRoot, name);
    if (!existsSync(full)) { out.missing.push(name + '/'); continue; }
    try { rmSync(full, { recursive: true, force: true }); out.removedDirs.push(name + '/'); }
    catch (e) { out.failed.push({ what: name + '/', reason: e instanceof Error ? e.message : String(e) }); }
  }

  if (plan.profileDirs) {
    for (const name of profileDirsOnDisk(dataRoot)) {
      try { rmSync(join(dataRoot, name), { recursive: true, force: true }); out.removedDirs.push(name + '/'); }
      catch (e) { out.failed.push({ what: name + '/', reason: e instanceof Error ? e.message : String(e) }); }
    }
  }

  return out;
}
