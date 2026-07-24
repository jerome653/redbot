/**
 * `redbot backup [--list] [--verify]`
 *
 * EB-28 / D-04. Snapshot the evidence, list what exists, or re-hash a snapshot against its own
 * manifest.
 */
import {
  backupEvidence, listSnapshots, verifySnapshot, backupRoot, totalBackupBytes, BACKED_UP
} from '../backup.js';
import { say } from '../log.js';

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

export function backupCmd(opts?: { list?: boolean; verify?: boolean }): number {
  if (opts?.list) {
    const snaps = listSnapshots();
    say.head(`redbot backup — ${snaps.length} snapshot(s)`);
    say.step(`Root: ${backupRoot()}`);
    if (!snaps.length) {
      say.warn('No snapshots. The evidence exists on one machine with no copy — run `redbot backup`.');
      return 1;
    }
    for (const s of snaps.slice(0, 12)) {
      say.step(`  ${s.takenAt ?? '(no manifest)'}  ${String(s.files).padStart(2)} files  ${kb(s.bytes).padStart(10)}`);
    }
    if (snaps.length > 12) say.step(`  … and ${snaps.length - 12} older`);
    say.info('');
    say.step(`Total on disk: ${kb(totalBackupBytes())}`);
    return 0;
  }

  if (opts?.verify) {
    const snaps = listSnapshots();
    if (!snaps.length) { say.fail('Nothing to verify — no snapshots exist.'); return 1; }
    const target = snaps[0]!;
    say.head('redbot backup --verify');
    say.step(`Newest: ${target.dir}`);
    const r = verifySnapshot(target.dir);
    if (r.ok) {
      say.ok(`${r.checked} file(s) re-hashed, every sha256 matches the manifest.`);
      return 0;
    }
    say.fail(`${r.problems.length} problem(s):`);
    for (const p of r.problems) say.fail(`  ${p}`);
    return 1;
  }

  say.head('redbot backup');
  const r = backupEvidence();

  if (!r.ok) {
    say.fail(r.refusedBecause ?? 'refused');
    say.step('Nothing was written. Fix the file, or remove the secret from it, then retry.');
    return 1;
  }

  say.ok(`${r.files.length} of ${BACKED_UP.length} allowlisted file(s) copied.`);
  say.step(`Into: ${r.dir}`);
  for (const f of r.files) say.step(`  ${f.name.padEnd(24)} ${kb(f.bytes).padStart(10)}  ${f.sha256.slice(0, 12)}`);
  if (r.missing.length) {
    say.step('');
    say.step(`Not on disk yet (normal): ${r.missing.join(', ')}`);
  }
  say.info('');
  say.step('Chrome profiles, operator credentials and screenshots are never copied — allowlist only.');
  say.step('Verify with: redbot backup --verify');
  return 0;
}
