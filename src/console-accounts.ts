/**
 * Setting up an account, from the console — the one thing the console writes directly.
 *
 * **Why it is not a CLI shell-out like every other console mutation.** The other buttons queue
 * a job or spawn `dist/cli.js`, because those actions pass gates. Creating an account passes no
 * gate: it allocates a free port and a profile folder and writes a row. What it MUST do is
 * allocate without collisions, and that is a read-then-write which two clicks could interleave.
 * Doing it here, in one place, is what keeps the product console and the operator console from
 * each growing their own version of the allocator.
 *
 * `accounts` is the system of record. `data/accounts.json` is written too, and stays a
 * seed and a fallback — `src/config.ts` resolves `config.browser` synchronously at module load
 * and cannot await a query, so a machine whose database is down must still be able to work out
 * which Chrome to attach to. Writing both is what makes that fallback true rather than stale.
 *
 * No credentials here. An account record is a handle, a role, a port and a folder; the Reddit
 * session lives in the Chrome profile on disk and never in a column. Secrets go to the vault.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { DATA, accountsPath, loadAccountsFile, forgetAccounts } from './config.js';
import type { AccountRecord } from './config.js';
import { getPool, dbUnavailableReason } from './db.js';
import {
  upsertAccounts, loadAccountsFromDb, deleteAccount, countAccountDependents,
  bindAccountToMachine, boundHandles
} from './db/accounts.js';
import type { AccountDependents } from './db/accounts.js';
import {
  portIsFree, statusForAccounts, firstFreePortInRange, DEBUG_PORT_FIRST, DEBUG_PORT_LAST
} from './ports.js';
import { machineId } from './machine.js';
import { allocateProfileDir, profileState, resolveProfileDir } from './profiles.js';
import { isAbsolute, dirname, basename, join } from 'node:path';

/* Re-exported: the allocator here and the status screen must ask "is this port free" in exactly
   one way. Two definitions is how a console hands out a port it has just called occupied. */
export { portIsFree };

/** Reddit usernames are 3–20 of these. Same rule the console's form states to the person. */
const HANDLE_RE = /^[A-Za-z0-9_-]{3,20}$/;

/**
 * Where debug ports start. 9222 is Chrome's conventional default and is often already taken.
 *
 * The bounds moved to src/ports.ts when relay allocation needed the same scan over a different
 * range; they are re-exported under the old names so nothing that read them here has to change.
 */
const FIRST_DEBUG_PORT = DEBUG_PORT_FIRST;
const LAST_DEBUG_PORT = DEBUG_PORT_LAST;

/**
 * The first debugging port that is both unclaimed by redbot and actually bindable.
 *
 * The scan itself now lives in src/ports.ts beside `portIsFree`, so the relay allocator and this
 * one cannot drift apart on what "free" means. The behaviour is unchanged.
 */
async function firstFreePort(taken: number[]): Promise<number> {
  return firstFreePortInRange(taken, FIRST_DEBUG_PORT, LAST_DEBUG_PORT, 'debugging port');
}

export interface CreateResult {
  ok: boolean;
  error?: string;
  account?: AccountRecord;
  /** Where the new row landed, so the console can say so rather than imply both. */
  storedIn?: 'database' | 'seed-file';
  /**
   * True when this account took back the Chrome folder a previous removal kept for the same
   * username. Reported because a reused folder may already be SIGNED IN, and "your browser is
   * ready" is a different fact from "here is an empty folder to sign into".
   */
  adoptedProfileDir?: boolean;
}

/* ------------------------------------------------------------------ *
 * Folders kept after a removal
 * ------------------------------------------------------------------ */

/**
 * WHY THIS FILE EXISTS.
 *
 * Removing an account deletes the record and deliberately KEEPS its Chrome folder: that folder
 * holds the only copy of the Reddit session, no password is stored anywhere, and the trade the
 * console states to the operator is that the removal can be undone by re-adding.
 *
 * It could not. Measured 2026-08-13: create → remove → add the same username allocated the NEXT
 * folder, because allocation only knows which folders are TAKEN and which EXIST, and a kept one
 * is neither. The session was kept and unreachable, and every removal left another signed-in
 * folder on disk that nothing would ever open again.
 *
 * So a removal writes down which folder belonged to which username, and creating that username
 * again adopts it. This is the only path that reuses a folder: a caller-supplied path is still
 * refused, which is what stops a request pointing redbot at a profile it does not own.
 */
interface KeptFolder { handle: string; profileDir: string; removedAt: string }

function keptPath(): string {
  return join(DATA, 'removed-accounts.json');
}

function loadKept(): KeptFolder[] {
  if (!existsSync(keptPath())) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(keptPath(), 'utf8'));
    const list = (parsed as { kept?: unknown })?.kept;
    if (!Array.isArray(list)) return [];
    return list.filter((k): k is KeptFolder =>
      !!k && typeof (k as KeptFolder).handle === 'string' && typeof (k as KeptFolder).profileDir === 'string');
  } catch {
    /* Unreadable is treated as empty HERE, unlike the seed file: nothing is being written on the
       strength of it, and the cost of ignoring it is one extra folder rather than a lost record. */
    return [];
  }
}

function writeKept(list: KeptFolder[]): void {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(keptPath(), JSON.stringify({ kept: list }, null, 2), 'utf8');
}

function rememberKeptFolder(handle: string, profileDir: string): void {
  const rest = loadKept().filter((k) => k.handle.toLowerCase() !== handle.toLowerCase());
  rest.push({ handle, profileDir, removedAt: new Date().toISOString() });
  try { writeKept(rest); } catch { /* the removal itself succeeded; this is a convenience record */ }
}

/**
 * The folder kept for this username, if it is still there and nobody else holds it.
 *
 * Three conditions, and all three are load-bearing: the record must name this username (a session
 * is never handed to a different account), the folder must still exist (deleting it by hand is
 * how an operator says "start clean", and a name is not a session), and no live account may
 * already be using it.
 */
function keptFolderFor(handle: string, taken: ReadonlySet<string | undefined>): KeptFolder | null {
  const k = loadKept().find((x) => x.handle.toLowerCase() === handle.toLowerCase());
  if (!k) return null;
  if ([...taken].some((t) => (t ?? '').toLowerCase() === k.profileDir.toLowerCase())) return null;
  if (!existsSync(resolveProfileDir(DATA, k.profileDir))) return null;
  return k;
}

function forgetKeptFolder(handle: string): void {
  const rest = loadKept().filter((k) => k.handle.toLowerCase() !== handle.toLowerCase());
  try { writeKept(rest); } catch { /* leaving a stale line costs nothing — adoption re-checks disk */ }
}

/**
 * Every account we already know about, from both sources.
 *
 * The UNION matters, not the precedence: this feeds port and folder allocation, and an account
 * that exists only in the stale seed file still owns the port its Chrome is listening on.
 * Allocating around only the database would hand out a port that is already in use.
 *
 * Exported for `src/provision.ts`, which repairs missing Chrome profile folders on launch and
 * needs the same union for the same reason — a folder named only in the seed file is still a
 * folder that has to exist.
 */
export async function knownAccounts(): Promise<AccountRecord[]> {
  const fromFile = loadAccountsFile();
  let fromDb: AccountRecord[] = [];
  if (!dbUnavailableReason()) {
    try { fromDb = await loadAccountsFromDb(getPool()); } catch { /* seed file alone, then */ }
  }
  const byHandle = new Map<string, AccountRecord>();
  for (const a of [...fromFile, ...fromDb]) {
    if (a && typeof a.handle === 'string') byHandle.set(a.handle.toLowerCase(), a);
  }
  return [...byHandle.values()];
}

/**
 * Add an account.
 *
 * Writes the database first, then the seed file. In that order deliberately: if the second
 * write fails, the system of record is still correct and `redbot accounts export` repairs the
 * file. The other order would leave a file naming an account the database has never heard of.
 */
export async function createConsoleAccount(body: {
  handle?: unknown; role?: unknown; speaks?: unknown; knows?: unknown;
  subreddits?: unknown; timezone?: unknown; note?: unknown;
}): Promise<CreateResult> {
  const handle = String(body.handle ?? '').trim();
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: 'A Reddit username is 3–20 characters: letters, numbers, underscore or dash.' };
  }

  /**
   * The seed file is read and validated BEFORE anything is written anywhere.
   *
   * A fresh install has no file — that is the empty state, and the reason this button exists.
   * But a file that EXISTS and will not parse stops the whole operation: writing the database
   * row anyway would create an account the fallback cannot see, so the day the database is
   * down that account becomes invisible and nothing knows which Chrome port it owns. Refusing
   * now keeps the two stores in lockstep and costs the person one fixable error message.
   */
  let seed: Record<string, unknown> = { accounts: [] };
  if (existsSync(accountsPath())) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(accountsPath(), 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { accounts?: unknown }).accounts)) {
        throw new Error('no accounts list');
      }
      seed = parsed as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        error: 'data/accounts.json is not readable JSON with an "accounts" list. Fix or delete it, then try again.'
      };
    }
  }

  const known = await knownAccounts();
  if (known.some((a) => a.handle.toLowerCase() === handle.toLowerCase())) {
    return { ok: false, error: `${handle} is already set up.` };
  }

  const ports = known.map((a) => a.debugPort).filter((p): p is number => typeof p === 'number');
  const dirs = new Set(known.map((a) => a.profileDir).filter(Boolean));

  /**
   * The port must be free ON THIS MACHINE, not merely unused by redbot.
   *
   * This used to be `(max known port, else 9221) + 1`, which made the first account 9222 —
   * matching the historical `config.browser` default. On a real machine 9222 was already held
   * by Lenovo Vantage's Edge WebView2. redbot then attached to THAT browser, asked who was
   * signed in, and reported "not signed in on this profile" for an account whose Chrome was
   * signed in perfectly well. Nothing failed; it read the wrong browser and believed it.
   *
   * A debug port is a rendezvous with a specific browser, so an unverified one is a rendezvous
   * with whatever answers.
   */
  const port = await firstFreePort(ports);

  /**
   * The folder is CREATED here, not merely named.
   *
   * It used to be named and left for Chrome to create on first launch, which produced the defect
   * an account arriving from the dashboard exposed: `applyAccounts` calls this function, so a
   * pulled account was written to the database with `chrome-profile-c` recorded and no such
   * directory, and the Accounts screen reported "Sign-in folder chrome-profile-c missing" on an
   * account that had just been created successfully.
   *
   * It also closes a collision the old `existsSync` guard could not see: between allocation and
   * the first Chrome launch the name existed only in the database, so two accounts created before
   * either browser was opened — every account in one dashboard pull — could be handed the same
   * folder. See src/profiles.ts.
   *
   * ADOPTION FIRST. The folder a previous removal kept for THIS username comes back before a new
   * one is allocated — otherwise "a removal you can undo by re-adding" is a promise the allocator
   * cannot keep, and the kept session is stranded on disk for good. See keptFolderFor().
   */
  const kept = keptFolderFor(handle, dirs);
  const dir = kept ? kept.profileDir : allocateProfileDir({ dataRoot: DATA, taken: dirs });

  const account: AccountRecord = {
    handle,
    role: String(body.role ?? 'Support'),
    speaks: String(body.speaks ?? ''),
    knows: Array.isArray(body.knows) ? body.knows.map(String) : [],
    /**
     * NO DEFAULT. This used to store `['WordPress']` when the field was left empty, which is the
     * build deciding where somebody else's account speaks — and the add form arrived pre-filled
     * with the same name, so an operator adding an account for another room had to notice a
     * default and delete it.
     *
     * An empty list is now a real state and means "wherever the enabled sources point": see
     * allowedSubreddits() in select.ts, which reads the operator's own source list before it
     * falls back to anything. It still never means everywhere.
     */
    subreddits: Array.isArray(body.subreddits) ? body.subreddits.map(String).filter(Boolean) : [],
    timezone: String(body.timezone ?? 'Asia/Manila'),
    quietHours: [0, 8],
    dailyCeiling: 1,
    profileDir: dir,
    debugPort: port,
    note: String(body.note ?? 'Added from the console.')
  };

  let storedIn: 'database' | 'seed-file' = 'seed-file';
  const reason = dbUnavailableReason();
  if (!reason) {
    try {
      await upsertAccounts(getPool(), [account]);
      storedIn = 'database';
    } catch (e) {
      // Fail closed on the record, not on the person: report it rather than pretending the
      // row exists. The seed-file write below still leaves them able to sign in.
      return { ok: false, error: `The account could not be saved to the database: ${
        e instanceof Error ? e.message : String(e)}` };
    }
  }

  // The seed file mirrors the record so the synchronous CLI path (config.browser) and the
  // database-is-down fallback both keep working. `_rules` and any other keys a person put in
  // this file are preserved — it is theirs, and this only appends to `accounts`.
  const list = seed.accounts as AccountRecord[];
  list.push(account);

  mkdirSync(DATA, { recursive: true });
  writeFileSync(accountsPath(), JSON.stringify(seed, null, 2), 'utf8');

  /* Cleared only once the account is on record in both stores: the folder has a live owner
     again, and a kept-folder line that outlived its removal would offer one session twice. */
  if (kept) forgetKeptFolder(handle);

  forgetAccounts();
  return { ok: true, account, storedIn, ...(kept ? { adoptedProfileDir: true } : {}) };
}

/**
 * The fields a person may change after an account exists.
 *
 * `handle` is absent because it is the primary key of `accounts` — "changing" it is an
 * INSERT of a second account, not an edit, and the profile folder and its signed-in session
 * would stay behind with the old name.
 *
 * `profileDir` and `debugPort` are absent for a sharper reason: they decide WHICH Chrome the
 * account drives. Repointing a signed-in account at another port does not fail loudly — it
 * attaches to whatever is there, or to nothing, and reads Reddit signed out while every screen
 * still shows a configured account. That is the same silent class as the 9222 default this
 * codebase already had to remove. They stay changeable by editing data/accounts.json and
 * running `redbot accounts import`, which is a deliberate speed bump rather than a button.
 */
const EDITABLE = ['role', 'speaks', 'knows', 'subreddits', 'timezone', 'quietHours', 'dailyCeiling', 'note'] as const;

export interface UpdateBody {
  handle?: unknown; role?: unknown; speaks?: unknown; knows?: unknown;
  subreddits?: unknown; timezone?: unknown; note?: unknown;
  quietHours?: unknown; dailyCeiling?: unknown;
}

/** Which keys were REFUSED, so the console can say so instead of silently ignoring them. */
export interface UpdateResult extends CreateResult {
  ignored?: string[];
}

/**
 * Change an existing account's descriptive fields, in both stores.
 *
 * Writes the database first and the seed file second, in that order and with the same
 * failure rule as `createConsoleAccount`: if the row cannot be written the operation reports
 * it rather than leaving a seed file that disagrees with the record.
 */
export async function updateConsoleAccount(body: UpdateBody): Promise<UpdateResult> {
  const handle = String(body.handle ?? '').trim();
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: 'A Reddit username is 3–20 characters: letters, numbers, underscore or dash.' };
  }

  // Same read-and-validate-before-writing-anything rule as create: a seed file that exists but
  // will not parse must stop the edit, or the two stores drift apart.
  let seed: Record<string, unknown> = { accounts: [] };
  if (existsSync(accountsPath())) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(accountsPath(), 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { accounts?: unknown }).accounts)) {
        throw new Error('no accounts list');
      }
      seed = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, error: 'data/accounts.json is not readable JSON with an "accounts" list. Fix or delete it, then try again.' };
    }
  }

  const known = await knownAccounts();
  const current = known.find((a) => a.handle.toLowerCase() === handle.toLowerCase());
  if (!current) return { ok: false, error: `${handle} is not set up.` };

  /* Named back to the caller rather than dropped on the floor: a form that posts debugPort and
     gets a cheerful 200 has taught the person something false about what was saved. */
  const ignored = ['profileDir', 'debugPort'].filter((k) => body[k as keyof UpdateBody] !== undefined);

  const strings = (v: unknown, fallback: string[]): string[] =>
    Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : fallback;

  const quiet = Array.isArray(body.quietHours) && body.quietHours.length === 2
    ? [Number(body.quietHours[0]), Number(body.quietHours[1])] as [number, number]
    : current.quietHours;
  if (quiet && (!Number.isInteger(quiet[0]) || !Number.isInteger(quiet[1])
                || quiet[0] < 0 || quiet[0] > 23 || quiet[1] < 0 || quiet[1] > 23)) {
    return { ok: false, error: 'Quiet hours are two whole hours between 0 and 23.' };
  }

  const ceiling = body.dailyCeiling === undefined ? current.dailyCeiling : Number(body.dailyCeiling);
  if (ceiling !== undefined && (!Number.isInteger(ceiling) || ceiling < 0 || ceiling > 50)) {
    return { ok: false, error: 'A daily ceiling is a whole number between 0 and 50.' };
  }

  const account: AccountRecord = {
    ...current,
    // The identity and the browser it drives are carried over verbatim, never from the request.
    handle: current.handle,
    profileDir: current.profileDir,
    debugPort: current.debugPort,
    role: body.role === undefined ? current.role : String(body.role),
    speaks: body.speaks === undefined ? current.speaks : String(body.speaks),
    knows: body.knows === undefined ? current.knows : strings(body.knows, current.knows ?? []),
    subreddits: body.subreddits === undefined ? current.subreddits : strings(body.subreddits, current.subreddits ?? []),
    timezone: body.timezone === undefined ? current.timezone : String(body.timezone),
    quietHours: quiet,
    dailyCeiling: ceiling,
    note: body.note === undefined ? current.note : String(body.note)
  };

  let storedIn: 'database' | 'seed-file' = 'seed-file';
  if (!dbUnavailableReason()) {
    try {
      await upsertAccounts(getPool(), [account]);
      storedIn = 'database';
    } catch (e) {
      return { ok: false, error: `The change could not be saved to the database: ${
        e instanceof Error ? e.message : String(e)}` };
    }
  }

  /* Replace in place when the seed already lists it, append when it does not — an account that
     was created while the file was absent must not be silently missing from the mirror. */
  const list = seed.accounts as AccountRecord[];
  const at = list.findIndex((a) => a && typeof a.handle === 'string'
                                && a.handle.toLowerCase() === handle.toLowerCase());
  if (at >= 0) list[at] = account; else list.push(account);

  mkdirSync(DATA, { recursive: true });
  writeFileSync(accountsPath(), JSON.stringify(seed, null, 2), 'utf8');

  forgetAccounts();
  return { ok: true, account, storedIn, ignored: ignored.length ? ignored : undefined };
}

export interface DeleteResult {
  ok: boolean;
  error?: string;
  handle?: string;
  /**
   * The caller asked to remove an account that history hangs off, and did not say `confirm`.
   * Nothing was written. Resending with `confirm: true` goes through.
   */
  needsConfirm?: boolean;
  dependents?: AccountDependents;
  /** Which stores the account actually left, so the console can say so rather than imply both. */
  removedFrom?: ('database' | 'seed-file')[];
  /** The signed-in Chrome folder, LEFT ON DISK. Named so the person knows it is still there. */
  profileDirKept?: string;
}

/**
 * Remove an account.
 *
 * **The folder stays.** `data/chrome-profile-x` holds the only copy of that Reddit session —
 * redbot stores no password and could not sign back in — so deleting it is unrecoverable in a
 * way removing a config row is not. Removing the record and keeping the folder means a mistake
 * costs you a re-add; the other order costs you the account. The folder is named in the result
 * so it can be deleted by hand, deliberately, by someone who means it.
 *
 * **History is counted first, and refused by default.** `jobs.account` is
 * `ON DELETE CASCADE` (0008_jobs.up.sql:27): deleting the row takes every job for that account
 * with it. Drafts are `ON DELETE SET NULL` (0006_drafts.up.sql:38) — kept, but they stop saying
 * who wrote them. A one-click button that silently destroys a run history is the kind of thing
 * you only notice a week later, so this returns `needsConfirm` with the counts and writes
 * nothing until the caller sends them back.
 */
export async function deleteConsoleAccount(body: {
  handle?: unknown; confirm?: unknown;
}): Promise<DeleteResult> {
  const handle = String(body.handle ?? '').trim();
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: 'A Reddit username is 3–20 characters: letters, numbers, underscore or dash.' };
  }

  // Same read-and-validate-before-writing-anything rule as create and update.
  let seed: Record<string, unknown> = { accounts: [] };
  if (existsSync(accountsPath())) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(accountsPath(), 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { accounts?: unknown }).accounts)) {
        throw new Error('no accounts list');
      }
      seed = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, error: 'data/accounts.json is not readable JSON with an "accounts" list. Fix or delete it, then try again.' };
    }
  }

  const known = await knownAccounts();
  const current = known.find((a) => a.handle.toLowerCase() === handle.toLowerCase());
  if (!current) return { ok: false, error: `${handle} is not set up.` };

  /**
   * A configured database is the only case where a seed-file-only delete would LIE.
   *
   * `dbUnavailableReason()` reports "not configured", never "unreachable" — so a reason here
   * means this machine keeps accounts in the seed file alone, and removing it from the file is
   * the whole removal. When the database IS configured it is the system of record and
   * `loadAccounts()` prefers it, so an account deleted only from the file comes straight back
   * on the next read. That case is handled below by writing the database FIRST and returning
   * on failure, exactly as create and update do.
   */
  const dbOff = dbUnavailableReason();
  const removedFrom: ('database' | 'seed-file')[] = [];

  if (!dbOff) {
    let dependents: AccountDependents;
    try {
      dependents = await countAccountDependents(getPool(), current.handle);
    } catch (e) {
      return { ok: false, error: `The account's history could not be read, so nothing was removed: ${
        e instanceof Error ? e.message : String(e)}` };
    }

    if ((dependents.jobs > 0 || dependents.drafts > 0) && body.confirm !== true) {
      const parts: string[] = [];
      if (dependents.jobs) parts.push(`${dependents.jobs} job record${dependents.jobs === 1 ? '' : 's'} would be deleted with it`);
      if (dependents.drafts) parts.push(`${dependents.drafts} draft${dependents.drafts === 1 ? '' : 's'} would stop saying who wrote ${dependents.drafts === 1 ? 'it' : 'them'}`);
      return {
        ok: false,
        needsConfirm: true,
        dependents,
        handle: current.handle,
        error: `${current.handle} has history: ${parts.join(', ')}. Nothing has been removed.`
      };
    }

    try {
      if (await deleteAccount(getPool(), current.handle)) removedFrom.push('database');
    } catch (e) {
      return { ok: false, error: `The account could not be removed from the database: ${
        e instanceof Error ? e.message : String(e)}` };
    }
  }

  /* Case-insensitive, and it rewrites the file even when the account was not in it: an account
     created while the file was absent must not leave a delete reporting a store it never left. */
  const list = seed.accounts as AccountRecord[];
  const keep = list.filter((a) => !(a && typeof a.handle === 'string'
                                    && a.handle.toLowerCase() === handle.toLowerCase()));
  if (keep.length !== list.length) {
    seed.accounts = keep;
    mkdirSync(DATA, { recursive: true });
    writeFileSync(accountsPath(), JSON.stringify(seed, null, 2), 'utf8');
    removedFrom.push('seed-file');
  }

  /* The kept folder gets an owner on record so re-adding this username can take it back. Written
     AFTER the stores, because a folder recorded as kept for an account that still exists would
     hand the same session to the next creation of that name. */
  if (current.profileDir) rememberKeptFolder(current.handle, current.profileDir);

  forgetAccounts();
  return {
    ok: true,
    handle: current.handle,
    removedFrom,
    ...(current.profileDir ? { profileDirKept: current.profileDir } : {})
  };
}

export interface PortChangeResult extends CreateResult {
  /** The port it now holds, so the caller can say the number rather than re-read it. */
  port?: number;
  /** What the console should offer instead when the requested one was refused. */
  suggestion?: number;
}

/**
 * Give an account a browser ON THIS MACHINE.
 *
 * The state this exists for: an account created on another computer arrives through the shared
 * database with a description and no browser here. It cannot be started, because no folder on
 * this disk holds its session and no port has been set aside for it. This allocates both and
 * writes the binding — after which the ordinary "Start browser" flow signs in once, by hand,
 * which is the one step that cannot be synced (the session is DPAPI-bound to one machine).
 *
 * Allocation is the same as `createConsoleAccount`'s and deliberately so: a port that binds,
 * and a folder no other account here has claimed.
 */
export async function setUpAccountHere(body: { handle?: unknown }): Promise<PortChangeResult> {
  const handle = String(body.handle ?? '').trim();
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: 'A Reddit username is 3–20 characters: letters, numbers, underscore or dash.' };
  }
  if (dbUnavailableReason()) {
    return { ok: false, error: 'Setting an account up on this machine needs the database — that is where the binding lives.' };
  }

  const known = await knownAccounts();
  const current = known.find((a) => a.handle.toLowerCase() === handle.toLowerCase());
  if (!current) return { ok: false, error: `${handle} is not set up.` };

  let already: Set<string>;
  try { already = await boundHandles(getPool()); }
  catch (e) { return { ok: false, error: `The database could not be read: ${e instanceof Error ? e.message : String(e)}` }; }
  if (already.has(handle.toLowerCase())) {
    return { ok: false, error: `${current.handle} already has a browser on this machine.` };
  }

  /* Ports and folders in use HERE. `knownAccounts` already resolves per-machine, so these are
     this computer's numbers — not another machine's, which is the whole point of the split. */
  const ports = known
    .filter((a) => a.handle.toLowerCase() !== handle.toLowerCase())
    .map((a) => a.debugPort).filter((p): p is number => typeof p === 'number');
  const dirs = new Set(known
    .filter((a) => a.handle.toLowerCase() !== handle.toLowerCase())
    .map((a) => a.profileDir).filter(Boolean));

  let port: number;
  try { port = await firstFreePort(ports); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }

  /* Created, not just named — the same reasoning as createConsoleAccount above. This is the path
     the "Set it up" button takes, and src/push/accounts.ts already described it as the one that
     "creates the Chrome profile folder"; now it does. */
  const dir = allocateProfileDir({ dataRoot: DATA, taken: dirs });

  try {
    await bindAccountToMachine(getPool(), machineId(), current.handle, dir, port);
  } catch (e) {
    return { ok: false, error: `The browser could not be recorded for this machine: ${
      e instanceof Error ? e.message : String(e)}` };
  }

  forgetAccounts();
  return { ok: true, account: { ...current, profileDir: dir, debugPort: port }, storedIn: 'database', port };
}

/** The next port nothing has claimed and nothing is listening on. For the "pick one" button. */
/**
 * Choose which account this machine acts as.
 *
 * THE CONTROL THAT MAKES THE DESKTOP APP USABLE. `selectedAccount()` (src/config.ts) resolved only
 * from `REDBOT_ACCOUNT`, and a window has no shell to export it in — so an install with more than
 * one account could never say which one it was: `config.browser.cdpEndpoint` raised NoAccountError,
 * `src/cli.ts` refused to dispatch, and `doctor` reported a blocking failure with no way to clear it
 * from inside the app.
 *
 * Validation lives HERE rather than in tools/product/server.mjs, next to the same `HANDLE_RE` that
 * create, update and delete use. A second copy of the rule in the HTTP layer is a second rule, and
 * the two would disagree the first time one of them was tightened.
 *
 * Changes ONE flag. It cannot create or rename an account: `setSelectedAccount` refuses a handle
 * that is not already a record, and the database enforces at most one selection per machine with a
 * partial unique index, so two clicks racing cannot produce two.
 */
export async function selectConsoleAccount(
  body: { handle?: unknown }
): Promise<{ ok: boolean; error?: string; selected?: string | null }> {
  const handle = String(body.handle ?? '').trim();
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: 'A Reddit username is 3–20 characters: letters, numbers, underscore or dash.' };
  }

  const reason = dbUnavailableReason();
  if (reason) {
    return { ok: false, error: `Choosing the account needs the database — that is where the choice lives. ${reason}` };
  }

  try {
    const { getPool } = await import('./db.js');
    const { setSelectedAccount, selectedHandleForMachine } = await import('./db/accounts.js');
    await setSelectedAccount(getPool(), handle);

    /* Refresh the synchronous cache in THIS process. `config.browser` resolves the endpoint through
       it, so without this the very next request in the same server would still resolve the previous
       account's port — the write would be correct and the behaviour stale. */
    const { primeAccounts } = await import('./config.js');
    await primeAccounts();

    /* Read it back rather than echoing the input: what a person is told should be what the database
       holds, not what they asked for. */
    return { ok: true, selected: await selectedHandleForMachine(getPool()) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function suggestFreePort(): Promise<number> {
  const known = await knownAccounts();
  return firstFreePort(known.map((a) => a.debugPort).filter((p): p is number => typeof p === 'number'));
}

/**
 * Move an account to a different debugging port.
 *
 * `updateConsoleAccount` still refuses `debugPort`, and this function is why that is not a
 * contradiction. The danger was never "the number changed" — it was changing it BLIND. A port
 * is a rendezvous with whatever got there first, so a silent field in an edit form could point
 * a signed-in account at Lenovo Vantage's WebView and every screen would go on showing a
 * configured account while reads came back signed out.
 *
 * So this is a separate, deliberate verb with the three checks that make the move safe:
 *
 *   1. The account's own browser must NOT be running. Moving the record while Chrome holds the
 *      old port leaves the two disagreeing: the browser is on 9223, the record says 9224, and
 *      the next command attaches to nothing. Stop it, move it, start it.
 *   2. No other account may claim the port. Two accounts on one port is two Reddit identities
 *      taking turns in one browser, which is the one thing the standing rules forbid.
 *   3. The port must be BINDABLE, not merely quiet — the same test the allocator uses. A
 *      connect test would call Lenovo Vantage's port free the moment it stopped answering.
 */
export async function changeAccountPort(body: {
  handle?: unknown; port?: unknown; auto?: unknown;
}): Promise<PortChangeResult> {
  const handle = String(body.handle ?? '').trim();
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: 'A Reddit username is 3–20 characters: letters, numbers, underscore or dash.' };
  }

  // Same read-and-validate-before-writing-anything rule as every other mutation here.
  let seed: Record<string, unknown> = { accounts: [] };
  if (existsSync(accountsPath())) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(accountsPath(), 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { accounts?: unknown }).accounts)) {
        throw new Error('no accounts list');
      }
      seed = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, error: 'data/accounts.json is not readable JSON with an "accounts" list. Fix or delete it, then try again.' };
    }
  }

  const known = await knownAccounts();
  const current = known.find((a) => a.handle.toLowerCase() === handle.toLowerCase());
  if (!current) return { ok: false, error: `${handle} is not set up.` };

  /* Check 1 — the browser must be stopped first. Deliberately checked before the port is even
     validated: "stop it first" is the instruction either way, and finding out AFTER being told
     the new port is fine would read as though the move had half happened. */
  const [live] = await statusForAccounts([current]);
  if (live?.ours) {
    return {
      ok: false,
      error: `${current.handle}'s browser is running on port ${current.debugPort}. Stop it first — `
           + 'moving the record while Chrome holds the old port leaves them pointing at different browsers.'
    };
  }

  const takenByOthers = known
    .filter((a) => a.handle.toLowerCase() !== handle.toLowerCase())
    .map((a) => a.debugPort)
    .filter((p): p is number => typeof p === 'number');

  let port: number;
  if (body.auto === true) {
    /* The account's CURRENT port is excluded, not just the other accounts'. Without this the
       scan starts at 9222, finds the port this account already holds unclaimed-by-others and
       bindable, and hands it straight back — so "pick a free port for me" answered with the
       same number and looked like a button that does nothing. */
    const exclude = [...takenByOthers];
    if (typeof current.debugPort === 'number') exclude.push(current.debugPort);
    try { port = await firstFreePort(exclude); }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  } else {
    port = Number(body.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      return { ok: false, error: 'A debugging port is a whole number between 1024 and 65535.' };
    }
    if (port === current.debugPort) {
      return { ok: false, error: `${current.handle} is already on port ${port}.` };
    }

    // Check 2 — another account's port. Named, because "that one is taken" is only useful
    // when it says by whom.
    const clash = known.find((a) => a.handle.toLowerCase() !== handle.toLowerCase() && a.debugPort === port);
    if (clash) {
      return {
        ok: false,
        error: `Port ${port} already belongs to ${clash.handle}. Two accounts on one port is two identities in one browser.`,
        suggestion: await firstFreePort([...takenByOthers, port]).catch(() => undefined) as number | undefined
      };
    }

    // Check 3 — actually bindable on this machine, not merely unclaimed by redbot.
    if (!(await portIsFree(port))) {
      let suggestion: number | undefined;
      try { suggestion = await firstFreePort(takenByOthers); } catch { /* none spare to offer */ }
      return {
        ok: false,
        error: `Port ${port} is already in use on this machine. Chrome would not be able to take it.`,
        ...(suggestion ? { suggestion } : {})
      };
    }
  }

  const account: AccountRecord = { ...current, debugPort: port };

  let storedIn: 'database' | 'seed-file' = 'seed-file';
  if (!dbUnavailableReason()) {
    try {
      await upsertAccounts(getPool(), [account]);
      storedIn = 'database';
    } catch (e) {
      return { ok: false, error: `The new port could not be saved to the database: ${
        e instanceof Error ? e.message : String(e)}` };
    }
  }

  const list = seed.accounts as AccountRecord[];
  const at = list.findIndex((a) => a && typeof a.handle === 'string'
                                && a.handle.toLowerCase() === handle.toLowerCase());
  if (at >= 0) list[at] = account; else list.push(account);

  mkdirSync(DATA, { recursive: true });
  writeFileSync(accountsPath(), JSON.stringify(seed, null, 2), 'utf8');

  forgetAccounts();
  return { ok: true, account, storedIn, port };
}

/**
 * Point an account at a Chrome profile that is ALREADY SIGNED IN, wherever it lives.
 *
 * THE PROBLEM THIS SOLVES. Every other path here allocates a fresh folder and creates it empty,
 * which is right for a new account and wrong for the commonest real situation: the operator has
 * already signed in to Reddit in a Chrome profile — an earlier install, a checkout, a folder they
 * made by hand — and redbot cheerfully opens a brand-new empty one beside it and reports the
 * account signed out. Signing in again is not the fix; the session already exists.
 *
 * The folder is USED WHERE IT IS. Nothing is copied: a Chrome profile's cookie and login stores
 * are DPAPI-bound to one Windows user, so copying is at best pointless and at worst produces a
 * profile that looks populated and cannot authenticate. `profileDir` simply holds an absolute
 * path, which `resolveProfileDir` understands everywhere a folder is resolved.
 *
 * WHAT IT REFUSES, and why each one is a real failure rather than a formality:
 *
 *  - a running browser — the same rule `changeAccountPort` follows. Repointing the record while
 *    Chrome holds the old folder leaves the two naming different profiles.
 *  - a folder with no Chrome markers — `Default`/`Local State`. Adopting an empty directory is
 *    exactly the outcome this function exists to prevent, so it must not be the thing it does.
 *  - a folder another account already uses — two accounts in one profile is two identities in one
 *    browser, which is the rule `data/accounts.json` opens with.
 */
export async function adoptProfileDir(body: {
  handle?: unknown; path?: unknown;
}): Promise<CreateResult> {
  const handle = String(body.handle ?? '').trim();
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: 'A Reddit username is 3–20 characters: letters, numbers, underscore or dash.' };
  }

  const raw = String(body.path ?? '').trim().replace(/^"|"$/g, '');
  if (!raw) return { ok: false, error: 'Give the folder that holds the signed-in Chrome profile.' };
  if (!isAbsolute(raw)) {
    return { ok: false, error: `"${raw}" is not a full path. Paste the whole folder, starting from the drive.` };
  }
  if (!existsSync(raw)) return { ok: false, error: `There is no folder at ${raw}.` };

  /* `used`, not merely `exists`: an empty folder is what the operator is trying to get away from.
     The dirname/basename split is because profileState resolves relative to a root. */
  if (profileState(dirname(raw), basename(raw)) !== 'used') {
    return {
      ok: false,
      error: `${raw} does not look like a Chrome profile that has been signed in to — `
           + 'it holds neither "Default" nor "Local State". Point at the --user-data-dir folder, '
           + 'not at the "Default" folder inside it.'
    };
  }

  const known = await knownAccounts();
  const current = known.find((a) => a.handle.toLowerCase() === handle.toLowerCase());
  if (!current) return { ok: false, error: `${handle} is not set up.` };

  const [live] = await statusForAccounts([current]);
  if (live?.ours) {
    return {
      ok: false,
      error: `${current.handle}'s browser is running on port ${current.debugPort}. Stop it first — `
           + 'moving the record while Chrome holds the old profile leaves them pointing at different browsers.'
    };
  }

  const clash = known.find((a) =>
    a.handle.toLowerCase() !== handle.toLowerCase() &&
    typeof a.profileDir === 'string' &&
    resolveProfileDir(DATA, a.profileDir).toLowerCase() === raw.toLowerCase());
  if (clash) {
    return { ok: false, error: `${clash.handle} already uses that profile. Two accounts in one profile is two identities in one browser.` };
  }

  const account: AccountRecord = { ...current, profileDir: raw };

  let storedIn: 'database' | 'seed-file' = 'seed-file';
  if (!dbUnavailableReason()) {
    try {
      await upsertAccounts(getPool(), [account]);
      storedIn = 'database';
    } catch (e) {
      return { ok: false, error: `The profile could not be saved to the database: ${
        e instanceof Error ? e.message : String(e)}` };
    }
  }

  /* The seed file is kept in lockstep, exactly as every other mutation here does — it is the
     fallback the day the database is down, and an account it cannot see is an account with no
     known profile. */
  let seed: Record<string, unknown> = { accounts: [] };
  if (existsSync(accountsPath())) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(accountsPath(), 'utf8'));
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { accounts?: unknown }).accounts)) {
        seed = parsed as Record<string, unknown>;
      }
    } catch { /* rewritten below from what is known */ }
  }
  const list = seed.accounts as AccountRecord[];
  const at = list.findIndex((a) => a && typeof a.handle === 'string'
                                && a.handle.toLowerCase() === handle.toLowerCase());
  if (at >= 0) list[at] = account; else list.push(account);
  mkdirSync(DATA, { recursive: true });
  writeFileSync(accountsPath(), JSON.stringify(seed, null, 2), 'utf8');

  forgetAccounts();
  return { ok: true, account, storedIn };
}

/** The fields the console may offer, exported so the UI and the tests cannot drift from it. */
export const EDITABLE_ACCOUNT_FIELDS: readonly string[] = EDITABLE;
