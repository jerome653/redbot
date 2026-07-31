/**
 * Account sync — the only two-way half of this feature.
 *
 * WHAT TRAVELS, AND WHAT CANNOT. Migration 0013 split `accounts` apart precisely so this would be
 * possible, and its header says why: `profile_dir` "names a folder under data/ on ONE computer"
 * and `debug_port` "names a TCP port that is free on ONE computer". Both columns still exist on
 * `accounts` as a legacy fallback, holding identical values to `account_machines` on a one-machine
 * install — so `SELECT *` looks perfectly correct and would ship machine-local values everywhere.
 * PORTABLE is an allow-list for that reason.
 *
 * THE SESSION CANNOT TRAVEL AT ALL. The same migration measured it: the cookies carry the `v10`
 * tag and Local State holds a DPAPI-wrapped `encrypted_key`, so "copying that folder to another
 * machine yields a signed-out profile". Sync therefore carries the DESCRIPTION; the receiving
 * machine runs "Set it up" itself and a person signs in once by hand.
 *
 * PULLING NEVER DESTROYS. An account missing from an incoming list is REPORTED, never removed.
 * `src/console-accounts.ts` already refuses to delete an account with jobs or drafts unless a
 * caller passes `confirm: true`; a sync that deleted would let a click on one machine destroy
 * work on another. There is also no `active` column to deactivate with, so inventing a soft
 * delete here would mean a schema change smuggled in behind a sync feature. Report, and let a
 * person run `redbot accounts remove` with its existing guard.
 */
import { createHash } from 'node:crypto';
import { getPool } from '../db.js';
import { machineId } from '../machine.js';
import { installId, readPushState, writePushState } from './state.js';
import { PushClient, type Outcome } from './client.js';
import { forbiddenKeysIn, JSON_TEXT_FIELDS, asJsonText } from './streams.js';

/**
 * The description of an account, and nothing about where it runs.
 *
 * Deliberately excludes `profile_dir` and `debug_port` even though `accounts` carries them.
 */
export const PORTABLE_FIELDS = [
  'handle', 'role', 'speaks', 'knows', 'subreddits', 'timezone',
  'quiet_start', 'quiet_end', 'daily_ceiling', 'note', 'created_at', 'updated_at'
] as const;

export interface PortableAccount {
  handle: string;
  [k: string]: unknown;
}

/** Read the portable projection of every account, ordered so the hash is stable. */
export async function portableAccounts(): Promise<PortableAccount[]> {
  const cols = PORTABLE_FIELDS.map((c) => `"${c}"`).join(', ');
  const res = await getPool().query<Record<string, unknown>>(
    `SELECT ${cols} FROM accounts ORDER BY handle`
  );
  const jsonText = JSON_TEXT_FIELDS['accounts'] ?? [];
  return res.rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const f of PORTABLE_FIELDS) {
      const v = row[f];
      if (v === undefined || v === null) continue;
      /* `subreddits` and `knows` come back from the façade as arrays; the wire wants the string. */
      out[f] = jsonText.includes(f) ? asJsonText(v) : v;
    }
    return out as PortableAccount;
  });
}

/**
 * A stable fingerprint of the list, so an unchanged list is not re-sent.
 *
 * Over the CONTENT, not the count: two accounts edited but not added must still register as a
 * change. `updated_at` is inside the projection, so any edit moves the hash.
 */
export const listFingerprint = (accounts: PortableAccount[]): string =>
  createHash('sha256').update(JSON.stringify(accounts)).digest('hex').slice(0, 16);

export interface AccountsEnvelope {
  v: 1;
  installId: string;
  machine?: string;
  kind: 'accounts.list';
  listVersion: number;
  sentAt: string;
  accounts: PortableAccount[];
}

export function accountsEnvelope(
  accounts: PortableAccount[], id: string, machine: string | null,
  listVersion: number, now: string
): AccountsEnvelope {
  return {
    v: 1,
    installId: id,
    ...(machine ? { machine } : {}),
    kind: 'accounts.list',
    listVersion,
    sentAt: now,
    accounts
  };
}

export interface PushAccountsResult {
  sent: boolean;
  accounts: number;
  listVersion: number;
  /** Why nothing was sent, when nothing was. */
  skipped?: string;
  stopped?: string;
}

/**
 * Send the whole list, if it has changed since the last accepted push.
 *
 * The WHOLE list every time, never a delta — the receiving side treats a handle that is no
 * longer present as deleted, which is exactly what makes a deletion detectable at all. A delta
 * cannot distinguish "removed" from "not yet synced".
 */
export async function pushAccounts(
  client: PushClient | null, opts: { dryRun?: boolean; now?: () => string; force?: boolean } = {}
): Promise<PushAccountsResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const accounts = await portableAccounts();
  const fingerprint = listFingerprint(accounts);
  const state = readPushState();

  /* listVersion must be a non-negative integer and must move when the content moves. Derived
     from the stored version plus a change in fingerprint, so it never goes backwards. */
  const unchanged = state.accountsFingerprint === fingerprint;
  const listVersion = unchanged
    ? (state.accountsListVersion ?? 0)
    : (state.accountsListVersion ?? 0) + 1;

  if (unchanged && !opts.force) {
    return { sent: false, accounts: accounts.length, listVersion, skipped: 'unchanged since the last accepted push' };
  }

  const envelope = accountsEnvelope(accounts, installId(), machineId(), listVersion, now());

  /* The five keys the service rejects a batch for. Checked before transmission, not after:
     for `profile_dir`, `debug_port`, `selected`, `cookies` and `session`, "the server would have
     refused it" is no consolation — the point is that they never leave. */
  const hits = forbiddenKeysIn(envelope.accounts);
  if (hits.length) {
    throw new Error(
      `refusing to send the account list: forbidden key(s) — ${hits.join(', ')}. ` +
      'PORTABLE_FIELDS in src/push/accounts.ts no longer matches the schema.'
    );
  }

  if (opts.dryRun || !client) {
    return { sent: false, accounts: accounts.length, listVersion, skipped: 'dry run — nothing sent' };
  }

  const outcome: Outcome = await client.postAccounts(envelope);
  if (outcome.kind !== 'accepted') {
    // Every non-accepted outcome carries `detail`; TypeScript proves the fallback unreachable.
    return { sent: false, accounts: accounts.length, listVersion, stopped: outcome.detail };
  }

  writePushState({ ...state, accountsListVersion: listVersion, accountsFingerprint: fingerprint });
  return { sent: true, accounts: accounts.length, listVersion };
}

/* ------------------------------------------------------------------ *
 * Pulling
 * ------------------------------------------------------------------ */

export interface PullPlanEntry {
  handle: string;
  action: 'create' | 'update' | 'unchanged' | 'missing-locally-absent-remotely';
  changed?: string[];
}

export interface PullResult {
  fetched: boolean;
  listVersion?: number;
  /** Unchanged since the last pull — the service answered 304. */
  notModified?: boolean;
  plan: PullPlanEntry[];
  applied: number;
  /** Handles held locally that the incoming list does not contain. NEVER removed automatically. */
  withdrawn: string[];
  /** The list as received, so `applyAccounts` works from what arrived rather than re-fetching. */
  incoming: PortableAccount[];
  /** For `If-None-Match` on the next pull. */
  etag?: string;
  stopped?: string;
}

/** Fields a person would notice changing, compared to decide create vs update vs no-op. */
const COMPARED = ['role', 'speaks', 'knows', 'subreddits', 'timezone',
  'quiet_start', 'quiet_end', 'daily_ceiling', 'note'] as const;

/**
 * Compare on the JSON-TEXT form of both sides.
 *
 * A straight `String(x)` comparison was wrong and produced a phantom `update` on every pull:
 * `String(["WordPress"])` is `WordPress` while `String('["WordPress"]')` is `["WordPress"]`, so an
 * identical account compared unequal forever. Normalising both ends also means a peer that sends
 * the parsed form rather than the string does not trigger a pointless rewrite.
 */
function diff(local: Record<string, unknown>, remote: Record<string, unknown>): string[] {
  const changed: string[] = [];
  for (const f of COMPARED) {
    if (remote[f] === undefined) continue;
    const l = String(asJsonText(local[f]) ?? '');
    const r = String(asJsonText(remote[f]) ?? '');
    if (l !== r) changed.push(f);
  }
  return changed;
}

/**
 * Fetch the shared list and work out what would change locally.
 *
 * Planning is separate from applying so `--dry-run` can show the plan without touching anything,
 * and so the withdrawn set is visible before any decision is made about it.
 */
export async function pullAccounts(
  client: PushClient, opts: { etag?: string | null } = {}
): Promise<PullResult> {
  const res = await client.getAccounts(opts.etag ?? null);
  if (res.kind === 'notModified') {
    return { fetched: false, notModified: true, plan: [], applied: 0, withdrawn: [], incoming: [] };
  }
  if (res.kind !== 'ok') {
    return { fetched: false, plan: [], applied: 0, withdrawn: [], incoming: [], stopped: res.detail };
  }

  const incoming = Array.isArray(res.body?.accounts) ? res.body.accounts as PortableAccount[] : [];
  const local = await portableAccounts();
  const byHandle = new Map(local.map((a) => [String(a.handle), a]));

  const plan: PullPlanEntry[] = [];
  for (const remote of incoming) {
    const handle = String(remote.handle ?? '').trim();
    if (!handle) continue;
    const here = byHandle.get(handle);
    if (!here) { plan.push({ handle, action: 'create' }); continue; }
    const changed = diff(here, remote);
    plan.push(changed.length
      ? { handle, action: 'update', changed }
      : { handle, action: 'unchanged' });
  }

  const remoteHandles = new Set(incoming.map((a) => String(a.handle)));
  const withdrawn = local.map((a) => String(a.handle)).filter((h) => !remoteHandles.has(h));

  return {
    fetched: true,
    ...(typeof res.body?.listVersion === 'number' ? { listVersion: res.body.listVersion } : {}),
    plan, applied: 0, withdrawn, incoming,
    ...(res.etag ? { etag: res.etag } : {})
  };
}

/**
 * Apply a plan produced by `pullAccounts`.
 *
 * Goes through `createConsoleAccount` / `updateConsoleAccount` rather than writing rows, so an
 * incoming account is validated by the same code a person's click uses and lands in BOTH stores
 * — the database and the seed file — which is what keeps them in lockstep.
 *
 * Creating an account here does NOT set it up on this machine. `setUpAccountHere` allocates a
 * free port and creates the Chrome profile folder, and the person still has to sign in to Reddit
 * inside it. Doing that automatically would produce an account that looks ready and cannot post.
 */
export async function applyAccounts(
  incoming: PortableAccount[], plan: PullPlanEntry[]
): Promise<{ applied: number; errors: string[] }> {
  const { createConsoleAccount, updateConsoleAccount } = await import('../console-accounts.js');
  const byHandle = new Map(incoming.map((a) => [String(a.handle), a]));
  const errors: string[] = [];
  let applied = 0;

  for (const entry of plan) {
    if (entry.action === 'unchanged') continue;
    const a = byHandle.get(entry.handle);
    if (!a) continue;

    const common = {
      handle: entry.handle,
      role: a.role, speaks: a.speaks,
      knows: a.knows, subreddits: a.subreddits,
      timezone: a.timezone, note: a.note
    };

    const r = entry.action === 'create'
      ? await createConsoleAccount(common)
      : await updateConsoleAccount({
        ...common,
        quietHours: [Number(a.quiet_start ?? 0), Number(a.quiet_end ?? 0)],
        dailyCeiling: a.daily_ceiling
      });

    if (!r.ok) { errors.push(`${entry.handle}: ${r.error ?? 'refused'}`); continue; }

    /* A created account still needs its quiet hours and ceiling, which `create` does not take. */
    if (entry.action === 'create') {
      const u = await updateConsoleAccount({
        ...common,
        quietHours: [Number(a.quiet_start ?? 0), Number(a.quiet_end ?? 0)],
        dailyCeiling: a.daily_ceiling
      });
      if (!u.ok) errors.push(`${entry.handle}: created, but quiet hours/ceiling failed — ${u.error}`);
    }
    applied += 1;
  }
  return { applied, errors };
}
