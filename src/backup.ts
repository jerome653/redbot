/**
 * Evidence backup — EB-28 / D-04.
 *
 * The project's defining property is that its design is traceable to observed failures. Those
 * observations live in `data/`, which is gitignored by necessity (DEFECT-01: 4.6 GB of Chrome
 * profile including live session cookies was one `git add -A` from being committed) and exists
 * on exactly one machine with no copy. Losing the directory would not cost code. It would cost
 * the entire justification for the architecture.
 *
 * ## The constraint that shapes everything here
 *
 * The same directory holds the evidence AND the credentials. A backup that is careless about
 * the difference re-creates DEFECT-01 somewhere else, which is strictly worse than no backup.
 *
 * So this is an **ALLOWLIST**, not a denylist. A file is copied only if it is named below.
 * A denylist fails open — the first new file anyone adds is included by default, and the first
 * one that happens to hold a token is a leak. An allowlist fails closed: a new evidence file is
 * simply missed until someone adds it, and `doctor` reports the mismatch.
 *
 * On top of the allowlist every file is **scanned before it is written**, and a hit aborts the
 * whole run rather than skipping the file. A backup that silently omits one file is a backup
 * nobody can reason about.
 *
 * ## Properties
 *
 * - **Automatic** — runs after `certify` and after a successful publish, the two commands that
 *   produce irreplaceable evidence. Never blocks or fails them.
 * - **Versioned** — every run writes a new timestamped snapshot. Nothing is ever overwritten.
 * - **Append-only** — old snapshots are never pruned or modified by this code.
 * - **Outside the working tree** — defaults to the home directory, so deleting the checkout
 *   does not delete the backups. A sibling directory would also be inside the SGEN repo, where
 *   it would show up in `git status`.
 * - **No credentials, no cloud, no external service, no new dependency.** Node built-ins only.
 */
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { DATA } from './config.js';

/**
 * Exactly what gets copied. Nothing else, ever.
 *
 * Deliberately NOT here, and the reason each is dangerous:
 *   - the chrome-profile directories: live Reddit session cookies for two accounts (DEFECT-01)
 *   - the operators directory: per-operator Claude credential paths
 *   - session.json: a session, if one is ever written
 *   - any .png: screenshots of a signed-in browser
 */
export const BACKED_UP = [
  // append-only evidence — the irreplaceable half
  'history.jsonl',
  'trace.jsonl',
  'observations.jsonl',
  'certifications.jsonl',
  'reviews.jsonl',
  'regret.jsonl',
  'interactions.jsonl',
  // working state — reconstructible in principle, expensive in practice
  'threads.json',
  'analysis.json',
  'gaps.json',
  'assessments.json',
  'drafts.json'
] as const;

/**
 * Patterns that must never reach a backup.
 *
 * This runs on the CONTENT of allowlisted files, as a second line of defence: the allowlist
 * says which files, this says the file must also not contain a secret. Both have to pass.
 */
/**
 * Each pattern requires an actual secret-shaped VALUE, not just a field name. The point is to
 * catch a leaked credential without a benign mention permanently bricking backups: the append-
 * only evidence logs record scraped Reddit prose, and a thread that merely discusses
 * "access_token" or "reddit_session" would, under a name-only match, trip the scan on every
 * future run and silently stop all backups from that point on (evaluation, backup token-DoS).
 * A field name followed by a long token value is a real leak; the bare word is not.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_-]{16,}/, 'Anthropic API key'],
  [/\breddit_session\b\s*[=:]\s*["']?[A-Za-z0-9._%+/-]{16,}/i, 'Reddit session cookie'],
  [/"?(?:access_token|refresh_token|id_token)"?\s*[:=]\s*["']?[A-Za-z0-9._-]{20,}/i, 'OAuth token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bBearer\s+[A-Za-z0-9._-]{20,}/, 'bearer token']
];

export interface BackupFile {
  name: string;
  bytes: number;
  sha256: string;
}

export interface BackupResult {
  ok: boolean;
  /** Absolute path of the snapshot directory. */
  dir: string;
  files: BackupFile[];
  /** Allowlisted names that were not present on disk. Normal early on, not an error. */
  missing: string[];
  /** Set when the run aborted. */
  refusedBecause?: string;
}

export function backupRoot(): string {
  return process.env.REDBOT_BACKUP_DIR ?? join(homedir(), 'redbot-evidence-backups');
}

/** A filesystem-safe, sortable stamp. */
function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
}

/** Returns what secret the text looks like it contains, or null. Exported for testing. */
export function scanForSecret(text: string): string | null {
  for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) return what;
  return null;
}

/**
 * Take a snapshot.
 *
 * Refuses as a whole if any allowlisted file trips the secret scan — the caller is told which
 * file and what matched, and nothing is written.
 */
export function backupEvidence(now: Date = new Date()): BackupResult {
  const root = backupRoot();
  const dir = join(root, stamp(now));

  const present: string[] = [];
  const missing: string[] = [];
  for (const name of BACKED_UP) {
    (existsSync(join(DATA, name)) ? present : missing).push(name);
  }

  // Scan everything BEFORE creating the destination, so a refusal leaves no partial snapshot.
  for (const name of present) {
    const hit = scanForSecret(readFileSync(join(DATA, name), 'utf8'));
    if (hit) {
      return {
        ok: false, dir, files: [], missing,
        refusedBecause: `${name} contains what looks like a ${hit} — refusing to copy it. Nothing was written.`
      };
    }
  }

  mkdirSync(dir, { recursive: true });

  const files: BackupFile[] = [];
  for (const name of present) {
    const from = join(DATA, name);
    copyFileSync(from, join(dir, name));
    const buf = readFileSync(from);
    files.push({
      name,
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex')
    });
  }

  const manifest = {
    takenAt: now.toISOString(),
    source: DATA,
    schema: 1,
    files,
    missing,
    note:
      'Allowlisted evidence only. Chrome profiles, operator credentials and screenshots are ' +
      'deliberately absent — see src/backup.ts. Verify with: node dist/cli.js backup --verify'
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return { ok: true, dir, files, missing };
}

export interface SnapshotInfo {
  dir: string;
  takenAt: string | null;
  files: number;
  bytes: number;
}

/** Every snapshot, newest first. */
export function listSnapshots(): SnapshotInfo[] {
  const root = backupRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = join(root, d.name);
      const mf = join(dir, 'manifest.json');
      let takenAt: string | null = null;
      let files = 0;
      let bytes = 0;
      if (existsSync(mf)) {
        try {
          const m = JSON.parse(readFileSync(mf, 'utf8')) as { takenAt?: string; files?: BackupFile[] };
          takenAt = m.takenAt ?? null;
          files = m.files?.length ?? 0;
          bytes = (m.files ?? []).reduce((s, f) => s + f.bytes, 0);
        } catch { /* a corrupt manifest is what --verify is for */ }
      }
      return { dir, takenAt, files, bytes };
    })
    .sort((a, b) => (b.takenAt ?? '').localeCompare(a.takenAt ?? ''));
}

export interface VerifyResult {
  dir: string;
  ok: boolean;
  checked: number;
  problems: string[];
}

/**
 * Re-hash a snapshot against its own manifest.
 *
 * A backup nobody has verified is a belief, not a backup — the same rule this project applies
 * to every other claim.
 */
export function verifySnapshot(dir: string): VerifyResult {
  const problems: string[] = [];
  const mf = join(dir, 'manifest.json');
  if (!existsSync(mf)) return { dir, ok: false, checked: 0, problems: ['no manifest.json'] };

  let manifest: { files?: BackupFile[] };
  try { manifest = JSON.parse(readFileSync(mf, 'utf8')); }
  catch (e) { return { dir, ok: false, checked: 0, problems: [`unreadable manifest: ${String(e)}`] }; }

  const files = manifest.files ?? [];
  for (const f of files) {
    const path = join(dir, f.name);
    if (!existsSync(path)) { problems.push(`${f.name}: missing from the snapshot`); continue; }
    const buf = readFileSync(path);
    if (buf.length !== f.bytes) problems.push(`${f.name}: ${buf.length} bytes, manifest says ${f.bytes}`);
    const sha = createHash('sha256').update(buf).digest('hex');
    if (sha !== f.sha256) problems.push(`${f.name}: sha256 mismatch — the copy has changed since it was taken`);
  }

  // A file present in the snapshot but absent from the manifest means something wrote here.
  const onDisk = readdirSync(dir).filter((n) => n !== 'manifest.json');
  for (const n of onDisk) {
    if (!files.some((f) => f.name === basename(n))) problems.push(`${n}: present but not in the manifest`);
  }

  return { dir, ok: problems.length === 0, checked: files.length, problems };
}

/** Hours since the newest snapshot, or null when none exists. */
export function hoursSinceLastBackup(now: Date = new Date()): number | null {
  const [newest] = listSnapshots();
  if (!newest?.takenAt) return null;
  const t = Date.parse(newest.takenAt);
  return Number.isFinite(t) ? (now.getTime() - t) / 3_600_000 : null;
}

/**
 * Fire-and-forget backup for commands that have just produced irreplaceable evidence.
 *
 * Never throws. A backup failure must not turn a successful certification or a published reply
 * into a reported failure — it returns the reason so the caller can print a warning.
 */
export function autoBackup(): { ok: boolean; detail: string } {
  try {
    const r = backupEvidence();
    if (!r.ok) return { ok: false, detail: r.refusedBecause ?? 'refused' };
    const kb = Math.round(r.files.reduce((s, f) => s + f.bytes, 0) / 1024);
    return { ok: true, detail: `${r.files.length} file(s), ${kb} KB -> ${r.dir}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Bytes across every snapshot — printed by `backup --list` so growth stays visible. */
export function totalBackupBytes(): number {
  const root = backupRoot();
  if (!existsSync(root)) return 0;
  let total = 0;
  for (const s of listSnapshots()) {
    for (const n of existsSync(s.dir) ? readdirSync(s.dir) : []) {
      try { total += statSync(join(s.dir, n)).size; } catch { /* raced with a delete */ }
    }
  }
  return total;
}
