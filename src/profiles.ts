/**
 * Chrome profile folders: naming them, creating them, and reporting what is in them.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS.
 *
 * A folder name was allocated in TWO places (`createConsoleAccount` and `setUpAccountHere`) with
 * the same six lines copied between them, and NEITHER created the directory. Chrome makes it on
 * first launch, so nothing appeared broken — until an account arrived from the dashboard. Pulling
 * one calls `createConsoleAccount`, which named `chrome-profile-c` and wrote it to the database;
 * the Accounts screen then read the name back, asked the disk, and reported
 * `Sign-in folder chrome-profile-c  missing` on an account that had just been created successfully.
 *
 * Creating the folder AT ALLOCATION also closes a race the old code could not: the guard against
 * collisions was `existsSync`, but the folder only appeared once somebody started Chrome, so
 * between allocation and first launch the name was invisible to the next allocation. Two accounts
 * created before either browser was opened could be handed the SAME folder, and two Reddit accounts
 * sharing one Chrome profile is one signed-in session pretending to be two.
 *
 * ---------------------------------------------------------------------------
 * AN EMPTY FOLDER IS NOT A SIGNED-IN ONE, AND THE UI MUST NOT SAY IT IS.
 *
 * `applyAccounts` warns that setting an account up automatically "would produce an account that
 * looks ready and cannot post". Creating the directory reintroduces exactly that risk if the only
 * question asked is "does it exist?" — a freshly made empty folder would answer yes.
 *
 * So `profileState` distinguishes three things instead of two: the folder is absent, the folder is
 * there but Chrome has never written to it, or Chrome has a real profile in it. Only the third is
 * a session anybody could post from.
 * ---------------------------------------------------------------------------
 */
import { existsSync as fsExists, mkdirSync as fsMkdir, readdirSync as fsReaddir } from 'node:fs';
import { join } from 'node:path';

export const PROFILE_PREFIX = 'chrome-profile-';

/**
 * Files Chrome writes into a user-data directory the first time it runs against one.
 *
 * `Local State` is written at the browser level and `Default` is the first profile inside it.
 * Either being present means a browser has adopted this folder; neither means redbot made the
 * directory and nothing has used it yet.
 */
const CHROME_MARKERS = ['Local State', 'Default'];

/**
 * The nth folder name: a…z, then aa, ab, … — bijective base-26.
 *
 * The old expression was `String.fromCharCode(97 + i)`, which is correct for the first 26 and then
 * silently walks out of the alphabet: the 27th account would have been handed `chrome-profile-{`.
 * Nobody has 27 accounts, which is exactly why it would have been found the hard way.
 */
export function profileName(i: number): string {
  if (!Number.isInteger(i) || i < 0) throw new RangeError(`profile index must be a non-negative integer, got ${i}`);
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return PROFILE_PREFIX + s;
}

/** `missing` — no folder. `empty` — folder made, never used. `used` — Chrome has a profile here. */
export type ProfileState = 'missing' | 'empty' | 'used';

export interface ProfileIo {
  exists?: (p: string) => boolean;
  mkdir?: (p: string) => void;
  readdir?: (p: string) => string[];
}

/**
 * What is actually in an account's profile folder.
 *
 * Never throws: an unreadable directory is reported as `empty` rather than taking down whatever
 * was rendering an account list.
 */
export function profileState(
  dataRoot: string, dir: string | null | undefined, io: ProfileIo = {}
): ProfileState {
  const exists = io.exists ?? fsExists;
  const readdir = io.readdir ?? fsReaddir;
  if (!dir) return 'missing';
  const full = join(dataRoot, dir);
  if (!exists(full)) return 'missing';
  try {
    const entries = readdir(full);
    return entries.some((e) => CHROME_MARKERS.includes(e)) ? 'used' : 'empty';
  } catch {
    /* Present but unreadable. It exists, so it is not `missing`; nothing proves a session, so it
       is not `used`. */
    return 'empty';
  }
}

export interface AllocateOptions {
  dataRoot: string;
  /** Folders already spoken for by other accounts on this machine. */
  taken: Iterable<string | null | undefined>;
  io?: ProfileIo;
  /** Create the directory as well as naming it. Off only for callers that just want the name. */
  create?: boolean;
}

/**
 * A folder name nothing else is using, created on disk.
 *
 * Two independent guards, and both are load-bearing:
 *   - `taken` — recorded against another account on this machine. A name can be reserved in the
 *     database while its directory does not exist yet.
 *   - on disk — a folder that is there but belongs to nobody we know. Adopting it would point a
 *     new account at a stranger's browser session, so it is skipped rather than reused. That
 *     includes folders left behind by a deleted account, whose session `deleteConsoleAccount`
 *     deliberately preserves.
 *
 * Comparison is CASE-INSENSITIVE: Windows filesystems are, so treating `Chrome-Profile-A` and
 * `chrome-profile-a` as different names would hand out one directory twice.
 */
export function allocateProfileDir(opts: AllocateOptions): string {
  const io = opts.io ?? {};
  const exists = io.exists ?? fsExists;
  const mkdir = io.mkdir ?? ((p: string) => { fsMkdir(p, { recursive: true }); });

  const taken = new Set<string>();
  for (const t of opts.taken) {
    if (typeof t === 'string' && t) taken.add(t.toLowerCase());
  }

  for (let i = 0; ; i++) {
    const name = profileName(i);
    if (taken.has(name.toLowerCase())) continue;
    const full = join(opts.dataRoot, name);
    if (exists(full)) continue;
    if (opts.create !== false) mkdir(full);
    return name;
  }
}

/**
 * Make sure every account that already has a folder NAME has the folder.
 *
 * The repair half. Allocation covers accounts made from now on; this covers the ones already in
 * the database with a name and nothing on disk — which is the state a dashboard pull left behind
 * before this existed, and which the operator would otherwise have to fix by deleting and
 * re-pulling the account.
 *
 * Only ever CREATES, and only for names already recorded. It never renames, never reassigns and
 * never touches a folder that exists, so running it on every launch is safe and idempotent.
 */
export function ensureProfileDirs(
  dataRoot: string,
  accounts: Array<{ handle?: string; profileDir?: string | null }>,
  io: ProfileIo = {}
): { created: string[]; failed: Array<{ dir: string; reason: string }> } {
  const exists = io.exists ?? fsExists;
  const mkdir = io.mkdir ?? ((p: string) => { fsMkdir(p, { recursive: true }); });
  const created: string[] = [];
  const failed: Array<{ dir: string; reason: string }> = [];

  const seen = new Set<string>();
  for (const a of accounts) {
    const dir = a?.profileDir;
    if (typeof dir !== 'string' || !dir) continue;
    /* Two accounts naming the same folder is a defect this function must not paper over by
       creating it twice — it is created once and the duplicate is left for the caller to see. */
    if (seen.has(dir.toLowerCase())) continue;
    seen.add(dir.toLowerCase());

    const full = join(dataRoot, dir);
    if (exists(full)) continue;
    try {
      mkdir(full);
      created.push(dir);
    } catch (e) {
      failed.push({ dir, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { created, failed };
}
