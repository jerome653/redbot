/**
 * `redbot reset [--scope work|all] [--sign-ins] [--yes] [--skip-backup]`
 *
 * Put this install back to a known state.
 *
 * WITH NO `--yes` IT DELETES NOTHING. It prints the plan — every file, folder and table it would
 * touch, everything it would keep, and the warnings that apply — and stops. That is the default
 * because the operator cannot inspect this operation afterwards: once the corpus and the logs are
 * gone, "what did that take?" has no answer left on the machine.
 *
 * A SNAPSHOT IS TAKEN FIRST, ALWAYS. `backupEvidence()` copies the append-only logs — the half
 * that cannot be re-collected — and a refused backup ABORTS the reset. `--skip-backup` exists for
 * the case where the backup itself is what is broken, and it says so loudly rather than being the
 * quiet default.
 */
import { say, record } from '../log.js';
import { resetPlan, applyReset, profileDirsOnDisk, RESET_SCOPES } from '../reset.js';
import type { ResetScope } from '../reset.js';
import { backupEvidence } from '../backup.js';
import { getPool, dbUnavailableReason, closePool } from '../db.js';
import { forgetAccounts } from '../config.js';

export async function reset(opts: {
  scope?: string; signIns?: boolean; yes?: boolean; skipBackup?: boolean;
} = {}): Promise<number> {
  const scope = (opts.scope ?? 'work') as ResetScope;
  if (!(RESET_SCOPES as readonly string[]).includes(scope)) {
    say.fail(`"${scope}" is not a reset scope. Use one of: ${RESET_SCOPES.join(', ')}.`);
    return 1;
  }

  const plan = resetPlan(scope, { signIns: opts.signIns === true });
  say.head(`redbot reset — ${scope}`);
  say.step(`Would clear ${plan.summary}.`);

  say.info('');
  say.step('Removed:');
  for (const f of plan.files) say.step(`    ${f}`);
  for (const d of plan.dirs) say.step(`    ${d}/`);
  for (const t of plan.tables) say.step(`    table ${t}`);
  if (plan.profileDirs) {
    const dirs = profileDirsOnDisk();
    for (const d of dirs) say.step(`    ${d}/   (a signed-in Chrome)`);
    if (!dirs.length) say.step('    (no Chrome folders on disk)');
  }

  say.info('');
  say.step('Kept:');
  for (const k of plan.kept) say.step(`    ${k}`);

  if (plan.warnings.length) {
    say.info('');
    for (const w of plan.warnings) say.warn(w);
  }

  if (!opts.yes) {
    say.info('');
    say.ok('Nothing has been removed. Add --yes to carry this out.');
    return 0;
  }

  /* The snapshot is part of the operation, not a suggestion beside it. */
  if (opts.skipBackup) {
    say.warn('Skipping the snapshot because --skip-backup was given. Nothing will be recoverable.');
  } else {
    const snap = backupEvidence();
    if (!snap.ok) {
      say.fail(`The snapshot was refused, so nothing was removed: ${snap.refusedBecause}`);
      say.step('Fix that, or pass --skip-backup if you accept losing the evidence.');
      return 1;
    }
    say.ok(`Snapshot written: ${snap.dir} (${snap.files.length} file(s))`);
  }

  const dbOff = dbUnavailableReason();
  if (dbOff) say.warn(`The database is not configured (${dbOff}), so only files are being cleared.`);

  const out = await applyReset(plan, dbOff ? null : getPool());

  say.info('');
  const rows = out.clearedTables.reduce((s, t) => s + t.rows, 0);
  say.ok(`Removed ${out.removedFiles.length} file(s), ${out.removedDirs.length} folder(s), ` +
         `${rows} row(s) across ${out.clearedTables.length} table(s).`);
  if (out.missing.length) say.step(`${out.missing.length} item(s) were already absent.`);

  if (out.failed.length) {
    for (const f of out.failed) say.fail(`${f.what} — ${f.reason}`);
    say.warn('Some items could not be removed. The reset is PARTIAL; the list above is what is left.');
  }

  /* The cached account list is read at module load, so a stale one would have the console
     reporting accounts whose rows were just deleted. */
  forgetAccounts();

  await record('reset', `reset ${scope}${plan.profileDirs ? ' with sign-ins' : ''}`, {
    scope,
    signIns: plan.profileDirs,
    files: out.removedFiles.length,
    dirs: out.removedDirs.length,
    rows,
    failed: out.failed.length
  });

  await closePool();
  return out.failed.length ? 1 : 0;
}
