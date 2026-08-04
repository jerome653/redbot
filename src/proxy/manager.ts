/**
 * One live relay per account, for as long as this process runs.
 *
 * ---------------------------------------------------------------------------
 * WHERE THIS SITS, AND WHY THE LIFETIME IS THE DESIGN
 *
 * `relay.ts` knows how to be a relay. This knows WHICH relay an account should have, whether it
 * is up, and whether the address behind it is still the one that was vetted. It is the module
 * `launchChrome` calls, and the only one that writes `account_machines.relay_port`.
 *
 * The relays live in the CONSOLE process, which is deliberate and has a cost worth stating: Chrome
 * is spawned detached and outlives the console, so quitting redbot leaves a browser whose proxy
 * has gone — every page then fails with `ERR_PROXY_CONNECTION_FAILED`. That is the SAFE failure
 * and it is chosen over the alternative. A detached relay daemon would keep those windows working
 * by keeping a process holding live provider credentials alive with nobody watching it, and it
 * would let a browser go on using an exit long after the thing that vetted it stopped running.
 *
 * ---------------------------------------------------------------------------
 * FAIL CLOSED, AND WHAT THAT MEANS HERE
 *
 * Reddit ties an account to the address it first appears from and there is no undo. So every
 * refusal below is preferred to a browser that opens and looks fine:
 *
 *   - no credential in the vault      -> refuse. Forwarding blank auth earns a 407 on everything,
 *                                        which reads to a person as "the internet is broken".
 *   - never vetted (no pin)           -> refuse. "Not proven" is not "fine".
 *   - the relay cannot reach the exit -> refuse. Chrome would fail closed by itself (measured),
 *                                        but a window that opens and loads nothing is a support
 *                                        ticket, and `launchChrome` already refuses a foreign
 *                                        debug port on exactly this reasoning.
 *   - the exit is not the pinned one  -> refuse, naming both addresses.
 *
 * An account with no exit configured is NOT a failure — it is the ordinary state of every account
 * today, and it launches exactly as it always did.
 */
import type { Db } from '../db.js';
import { machineId } from '../machine.js';
import {
  loadAccountProxy, recordExitObservation, relayPortsOnMachine, setRelayPort, type AccountProxy
} from '../db/proxies.js';
import { startRelay, type Relay } from './relay.js';
import { checkThroughRelay } from './health.js';
import { loadProxyCredential, upstreamFrom } from './credential.js';
import { firstFreePortInRange, portIsFree, RELAY_PORT_FIRST, RELAY_PORT_LAST } from '../ports.js';

/** What a relay looked like the last time anything asked. For the Accounts card. */
export interface RelayState {
  handle: string;
  port: number;
  running: boolean;
  /** CONNECT/forward attempts since it started — a relay doing nothing is visible. */
  requests: number;
  /** The relay's own most recent failure, or null when the last attempt was fine. */
  lastError: string | null;
  /** The address the world saw at the last check through this relay. */
  exitIp: string | null;
  /** Whether that address WAS the pinned one. Null when no check has run yet. */
  matchedPin: boolean | null;
  checkedAt: string | null;
  startedAt: string;
}

interface Entry {
  relay: Relay;
  handle: string;
  startedAt: string;
  exitIp: string | null;
  matchedPin: boolean | null;
  checkedAt: string | null;
}

/** Keyed by lower-cased handle — the same canonical key the vault scope and the row lookups use. */
const relays = new Map<string, Entry>();

/**
 * One `ensure` at a time per account.
 *
 * Two clicks on "Start browser" would otherwise both find no relay, both allocate, and the second
 * would collide on `one_account_per_relay_per_machine` — or worse, win the bind race and leave the
 * first holding a listener nothing knows about. Same shape as `inspectPorts` in src/ports.ts, and
 * for the same reason.
 */
const inFlight = new Map<string, Promise<EnsureResult>>();

export type EnsureResult =
  /** No exit configured, or it is switched off. The caller launches exactly as it always did. */
  | { proxied: false; proxy: AccountProxy | null }
  | { proxied: true; ok: true; relayPort: number; exitIp: string; proxy: AccountProxy }
  | { proxied: true; ok: false; error: string; relayPort: number | null; proxy: AccountProxy };

/** The relay serving this account in this process, if any. */
export function relayFor(handle: string): RelayState | null {
  const e = relays.get(handle.toLowerCase());
  return e ? toState(e) : null;
}

/** Every relay this process is running. */
export function relayStates(): RelayState[] {
  return [...relays.values()].map(toState);
}

function toState(e: Entry): RelayState {
  return {
    handle: e.handle,
    port: e.relay.port,
    running: true,
    requests: e.relay.requests,
    lastError: e.relay.lastError,
    exitIp: e.exitIp,
    matchedPin: e.matchedPin,
    checkedAt: e.checkedAt,
    startedAt: e.startedAt
  };
}

/** Stop one account's relay. True when there was one to stop. */
export async function stopRelay(handle: string): Promise<boolean> {
  const key = handle.toLowerCase();
  const e = relays.get(key);
  if (!e) return false;
  relays.delete(key);
  await e.relay.close();
  return true;
}

/**
 * Stop every relay. Called when the console shuts down.
 *
 * The relay's own `close()` destroys its tracked sockets first — an upgraded CONNECT socket is
 * invisible to `server.closeAllConnections()`, and waiting on one made a previous version of this
 * take two minutes to exit.
 */
export async function stopAllRelays(): Promise<void> {
  const all = [...relays.values()];
  relays.clear();
  await Promise.all(all.map((e) => e.relay.close().catch(() => {})));
}

/**
 * Which port this account's relay should listen on.
 *
 * Prefers the port already on record so a relay keeps its number across restarts — the console
 * shows it, and a number that changes every launch is one nobody can use to diagnose anything.
 * The recorded port is only kept if it can still be BOUND: another program can take 9400 while
 * redbot is not running, and starting there would fail with `EADDRINUSE` at the worst moment.
 */
async function choosePort(db: Db, proxy: AccountProxy, machine: string): Promise<number> {
  if (typeof proxy.relayPort === 'number' && await portIsFree(proxy.relayPort)) {
    return proxy.relayPort;
  }
  const others = await relayPortsOnMachine(db, machine);
  others.delete(proxy.handle.toLowerCase());
  const taken = [...others.values(), ...[...relays.values()].map((e) => e.relay.port)];
  const port = await firstFreePortInRange(taken, RELAY_PORT_FIRST, RELAY_PORT_LAST, 'relay port');
  await setRelayPort(db, proxy.handle, port, machine);
  return port;
}

/**
 * Make sure this account has a healthy relay, and that the exit behind it is the vetted one.
 *
 * Returns rather than throws: every caller wants to REPORT the reason, and a thrown string in a
 * launch path becomes "something went wrong" in a console.
 *
 * On failure it closes a relay it started IN THIS CALL, but leaves one that was already running:
 * a browser may be using it, and yanking the network out from under a live session is not this
 * function's decision to make. Refusing the new window is.
 */
export async function ensureRelay(
  db: Db, handle: string, opts: { machine?: string; timeoutMs?: number } = {}
): Promise<EnsureResult> {
  const key = handle.toLowerCase();
  const running = inFlight.get(key);
  if (running) return running;
  const started = ensureNow(db, handle, opts).finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

async function ensureNow(
  db: Db, handle: string, opts: { machine?: string; timeoutMs?: number }
): Promise<EnsureResult> {
  const machine = opts.machine ?? machineId();

  const proxy = await loadAccountProxy(db, handle, machine);
  if (!proxy || !proxy.enabled) return { proxied: false, proxy: proxy ?? null };

  const refuse = (error: string, relayPort: number | null = null): EnsureResult =>
    ({ proxied: true, ok: false, error, relayPort, proxy });

  /* Never vetted. This is the check that protects the irreversible moment: the first sign-in
     fixes the account to whatever address it used, so an unproven exit must not carry one. */
  if (!proxy.pinnedExitIp) {
    return refuse(
      `${proxy.handle} has an exit configured (${proxy.host}:${proxy.port}) that has never been `
      + `checked, so redbot will not point a browser at it. Run \`redbot proxy vet ${proxy.handle}\` `
      + 'first — the first sign-in ties the account to whatever address it uses, and that cannot be undone.'
    );
  }

  let cred;
  try { cred = await loadProxyCredential(proxy.handle); }
  catch (e) { return refuse(e instanceof Error ? e.message : String(e)); }
  if (!cred) {
    return refuse(
      `No proxy credential is stored for ${proxy.handle}, so its relay will not start. Without one `
      + 'every request would be refused by the provider and look like a network fault. '
      + `Add it with \`redbot proxy vet ${proxy.handle}\`.`
    );
  }

  const existing = relays.get(proxy.handle.toLowerCase());
  let entry: Entry;
  let startedHere = false;

  if (existing) {
    entry = existing;
  } else {
    let port: number;
    try { port = await choosePort(db, proxy, machine); }
    catch (e) { return refuse(`No relay port could be set aside for ${proxy.handle}: ${e instanceof Error ? e.message : String(e)}`); }

    let relay: Relay;
    try {
      relay = await startRelay({ port, upstream: upstreamFrom(proxy, cred), label: proxy.handle });
    } catch (e) {
      return refuse(
        `${proxy.handle}'s relay could not start on 127.0.0.1:${port}: ${e instanceof Error ? e.message : String(e)}`,
        port
      );
    }
    entry = {
      relay, handle: proxy.handle, startedAt: new Date().toISOString(),
      exitIp: null, matchedPin: null, checkedAt: null
    };
    relays.set(proxy.handle.toLowerCase(), entry);
    startedHere = true;
  }

  const drop = async () => {
    if (!startedHere) return;
    relays.delete(proxy.handle.toLowerCase());
    await entry.relay.close().catch(() => {});
  };

  /* The whole chain: this process -> relay -> provider -> internet. The only check that proves
     what Chrome will actually get. */
  const health = await checkThroughRelay(entry.relay.port, { timeoutMs: opts.timeoutMs ?? 15_000 });
  entry.checkedAt = new Date().toISOString();

  if (!health.ok || !health.exitIp) {
    entry.exitIp = null;
    entry.matchedPin = null;
    await drop();
    return refuse(`${proxy.handle}'s exit could not be reached: ${health.detail}`, entry.relay.port);
  }

  const matched = health.exitIp === proxy.pinnedExitIp;
  entry.exitIp = health.exitIp;
  entry.matchedPin = matched;

  /* Written whether it matched or not — an exit that changed underneath us is exactly the event
     this ledger exists to make visible after the fact. */
  await recordExitObservation(db, proxy.handle, health.exitIp, 'launch', matched)
    .catch(() => { /* the observation is evidence, not a gate; never fail a launch on the write */ });

  if (!matched) {
    await drop();
    return refuse(
      `${proxy.handle} is pinned to ${proxy.pinnedExitIp} but its proxy is answering from `
      + `${health.exitIp}. The exit changed, so redbot will not launch: an account that appears `
      + 'from a new address is the signal this whole setup exists to avoid. Re-check it with '
      + `\`redbot proxy vet ${proxy.handle}\`.`,
      entry.relay.port
    );
  }

  return { proxied: true, ok: true, relayPort: entry.relay.port, exitIp: health.exitIp, proxy };
}
