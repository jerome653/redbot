/**
 * Reading and writing an account's exit — the rows migration 0016 added.
 *
 * ---------------------------------------------------------------------------
 * WHAT LIVES WHERE, AND WHY IT IS SPLIT THAT WAY
 *
 * `account_proxies` is PORTABLE: which address this account owns travels with the account to any
 * machine, so it is keyed by handle alone. The relay PORT is machine-local and lives on
 * `account_machines` beside `debug_port`, for the reason 0013 states — a port free on one
 * computer is not free on another.
 *
 * NO CREDENTIALS HERE. The username and password are sealed in the vault under
 * scope = lower(handle), name = 'proxy_auth'. The scope MUST be lower-cased: 0011_credentials
 * CHECKs `scope NOT GLOB '*[^a-z0-9._-]*'` and src/credentials.ts refuses anything else, so a
 * handle like "Striking_Mousse6841" is rejected outright. `proxyScope()` below is the one place
 * that conversion happens, so no caller has to remember it.
 */
import type { Db } from '../db.js';
import { machineId } from '../machine.js';

/** What an account's exit looks like to everything outside this module. */
export interface AccountProxy {
  handle: string;
  enabled: boolean;
  host: string;
  port: number;
  label: string | null;
  /** The vetted address. Null until `proxy vet` has passed — and un-vetted must not be launched. */
  pinnedExitIp: string | null;
  country: string | null;
  region: string | null;
  asn: string | null;
  rdns: string | null;
  vettedAt: string | null;
  /** Machine-local: where this account's relay listens here. Null when not set up on this box. */
  relayPort: number | null;
}

interface ProxyRow {
  handle: string;
  enabled: boolean | number;
  proxy_host: string;
  proxy_port: number;
  proxy_label: string | null;
  pinned_exit_ip: string | null;
  exit_country: string | null;
  exit_region: string | null;
  exit_asn: string | null;
  exit_rdns: string | null;
  vetted_at: string | null;
  relay_port: number | null;
}

/**
 * The vault scope for an account's proxy credential.
 *
 * Lower-cased, and that is not cosmetic — see the header. Exported so the vet command, the relay
 * starter and any future caller all derive it the same way instead of each lower-casing (or
 * forgetting to) at the call site.
 */
export function proxyScope(handle: string): string {
  return handle.toLowerCase();
}

/** The credential name inside that scope. One constant so a typo cannot split the store. */
export const PROXY_CREDENTIAL = 'proxy_auth';

function toProxy(r: ProxyRow): AccountProxy {
  return {
    handle: r.handle,
    enabled: r.enabled === true || r.enabled === 1,
    host: r.proxy_host,
    port: r.proxy_port,
    label: r.proxy_label,
    pinnedExitIp: r.pinned_exit_ip,
    country: r.exit_country,
    region: r.exit_region,
    asn: r.exit_asn,
    rdns: r.exit_rdns,
    vettedAt: r.vetted_at,
    relayPort: r.relay_port ?? null
  };
}

/**
 * Every configured exit, with this machine's relay port joined on.
 *
 * LEFT JOIN on `account_machines` rather than an inner one: an account can own an address
 * without having a relay here yet, and that state — "configured but not set up on this
 * computer" — is exactly what the Accounts card has to be able to say.
 */
export async function loadAccountProxies(
  db: Db, machine: string = machineId()
): Promise<AccountProxy[]> {
  const r = await db.query<ProxyRow>(
    `SELECT p.handle, p.enabled, p.proxy_host, p.proxy_port, p.proxy_label,
            p.pinned_exit_ip, p.exit_country, p.exit_region, p.exit_asn, p.exit_rdns,
            p.vetted_at, m.relay_port
       FROM account_proxies p
       LEFT JOIN account_machines m
         ON m.handle = p.handle AND m.machine = $1
      ORDER BY p.handle`,
    [machine]
  );
  return r.rows.map(toProxy);
}

/** One account's exit, or null when it has none configured. */
export async function loadAccountProxy(
  db: Db, handle: string, machine: string = machineId()
): Promise<AccountProxy | null> {
  const all = await loadAccountProxies(db, machine);
  return all.find((p) => p.handle.toLowerCase() === handle.toLowerCase()) ?? null;
}

/**
 * Record an observation of the exit address.
 *
 * Append-only on purpose: a "last seen" column would overwrite the evidence of the one event
 * this table exists to make visible — an exit that changed underneath a live session.
 */
export async function recordExitObservation(
  db: Db,
  handle: string,
  exitIp: string,
  via: 'vet' | 'launch' | 'run' | 'doctor',
  matchedPin: boolean
): Promise<void> {
  await db.query(
    `INSERT INTO account_exit_ips (handle, exit_ip, via, matched_pin) VALUES ($1,$2,$3,$4)`,
    [handle, exitIp, via, matchedPin ? 1 : 0]
  );
}

export interface ExitObservation {
  handle: string;
  observedAt: string;
  exitIp: string;
  via: string;
  matchedPin: boolean;
}

/**
 * Which relay ports this machine has already handed out.
 *
 * Keyed by lower-cased handle so a caller can both exclude the numbers and say WHOSE a clash
 * belongs to. Only this machine's rows: a relay port is machine-local, exactly like `debug_port`,
 * so another computer's 9400 is none of our business.
 */
export async function relayPortsOnMachine(
  db: Db, machine: string = machineId()
): Promise<Map<string, number>> {
  const r = await db.query<{ handle: string; relay_port: number | null }>(
    'SELECT handle, relay_port FROM account_machines WHERE machine = $1 AND relay_port IS NOT NULL',
    [machine]
  );
  const out = new Map<string, number>();
  for (const row of r.rows) {
    if (typeof row.relay_port === 'number') out.set(row.handle.toLowerCase(), row.relay_port);
  }
  return out;
}

/**
 * Record where this account's relay listens on THIS machine.
 *
 * INSERTs the binding row when there is none, for the reason `setSelectedAccount` does the same:
 * an install that has always run on one computer has no `account_machines` rows at all — the
 * legacy columns on `accounts` answer for it — and the first thing to need a per-machine fact
 * must be able to write one. The COALESCE in `loadAccountsFromDb` means a row carrying only a
 * relay port leaves the folder and debug port resolving exactly as they did.
 *
 * `handle` is resolved to its stored spelling first. It is a foreign key with no `lower()` in it,
 * so "striking_mousse6841" would be refused where "Striking_Mousse6841" is the account — and the
 * error a person would see is a constraint name, not "no such account".
 *
 * The database enforces `one_account_per_relay_per_machine`; a clash surfaces from there rather
 * than from a check here, because a check here could not see a write racing it.
 */
export async function setRelayPort(
  db: Db, handle: string, port: number | null, machine: string = machineId()
): Promise<void> {
  const known = await db.query<{ handle: string }>(
    'SELECT handle FROM accounts WHERE lower(handle) = lower($1)', [handle]
  );
  const real = known.rows[0]?.handle;
  if (!real) throw new Error(`"${handle}" is not a configured account.`);

  await db.query(
    `INSERT INTO account_machines (machine, handle, relay_port) VALUES ($1,$2,$3)
     ON CONFLICT (machine, handle) DO UPDATE SET relay_port = EXCLUDED.relay_port`,
    [machine, real, port]
  );
}

/**
 * Forget an account's exit.
 *
 * The OBSERVATIONS are deliberately left behind. `account_exit_ips` is the record of what this
 * account's traffic actually looked like, and it is the only thing that could later answer "was
 * this account ever seen from that address" — a question that outlives the configuration. The row
 * in `account_proxies` is a setting; the ledger is history, and removing a setting must not
 * rewrite history. (A deleted ACCOUNT still takes both with it: the foreign keys cascade.)
 *
 * The credential is not touched here either — it lives in the vault, and src/proxy/credential.ts
 * owns removing it, so this module keeps its promise never to handle one.
 */
export async function deleteAccountProxy(db: Db, handle: string): Promise<boolean> {
  const r = await db.query(
    'DELETE FROM account_proxies WHERE lower(handle) = lower($1)', [handle]
  );
  return (r.rowCount ?? 0) > 0;
}

/** What `proxy vet` writes when every check passed. Nothing here is set by hand. */
export interface VettedExit {
  host: string;
  port: number;
  label?: string | null;
  pinnedExitIp: string;
  country?: string | null;
  region?: string | null;
  asn?: string | null;
  rdns?: string | null;
}

/**
 * Bind an account to an exit that has PASSED the gate.
 *
 * Written in one place, and only from the gate, because `pinned_exit_ip` is the fact every later
 * check compares against — a pin set by hand would make the drift halt agree with whatever it was
 * told rather than with what was proven. `vetted_at` is stamped here for the same reason: it says
 * when the evidence was taken, and evidence with no date is an assertion.
 *
 * `enabled` goes to 1 only now. A row can exist un-vetted (configured, not proven), and the launch
 * path refuses that state — so this is the single moment an account starts exiting through a proxy.
 */
export async function saveVettedProxy(
  db: Db, handle: string, exit: VettedExit
): Promise<void> {
  const known = await db.query<{ handle: string }>(
    'SELECT handle FROM accounts WHERE lower(handle) = lower($1)', [handle]
  );
  const real = known.rows[0]?.handle;
  if (!real) throw new Error(`"${handle}" is not a configured account.`);

  await db.query(
    `INSERT INTO account_proxies
       (handle, enabled, proxy_host, proxy_port, proxy_label,
        pinned_exit_ip, exit_country, exit_region, exit_asn, exit_rdns, vetted_at)
     VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT (handle) DO UPDATE SET
       enabled        = 1,
       proxy_host     = EXCLUDED.proxy_host,
       proxy_port     = EXCLUDED.proxy_port,
       proxy_label    = EXCLUDED.proxy_label,
       pinned_exit_ip = EXCLUDED.pinned_exit_ip,
       exit_country   = EXCLUDED.exit_country,
       exit_region    = EXCLUDED.exit_region,
       exit_asn       = EXCLUDED.exit_asn,
       exit_rdns      = EXCLUDED.exit_rdns,
       vetted_at      = EXCLUDED.vetted_at`,
    [real, exit.host, exit.port, exit.label ?? null, exit.pinnedExitIp,
     exit.country ?? null, exit.region ?? null, exit.asn ?? null, exit.rdns ?? null]
  );
}

/** The most recent observations for an account, newest first. */
export async function recentExitObservations(
  db: Db, handle: string, limit = 10
): Promise<ExitObservation[]> {
  const r = await db.query<{
    handle: string; observed_at: string; exit_ip: string; via: string; matched_pin: boolean | number;
  }>(
    `SELECT handle, observed_at, exit_ip, via, matched_pin
       FROM account_exit_ips
      WHERE handle = $1
      ORDER BY observed_at DESC, id DESC
      LIMIT $2`,
    [handle, limit]
  );
  return r.rows.map((x) => ({
    handle: x.handle,
    observedAt: x.observed_at,
    exitIp: x.exit_ip,
    via: x.via,
    matchedPin: x.matched_pin === true || x.matched_pin === 1
  }));
}
