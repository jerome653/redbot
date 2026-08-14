/**
 * What is ACTUALLY listening on an account's debugging port.
 *
 * **Why this is not `fetch('/json/version').ok`.** That was the old check, and on a real
 * machine it reported green for a browser that was not ours: 9222 on the development machine
 * is held by Lenovo Vantage's Edge WebView2 (`msedgewebview2.exe`, measured — its command line
 * carries `--remote-debugging-port=9222` and a `--user-data-dir` under `Lenovo\Vantage`). It
 * answers CDP perfectly. So "something answered" meant "healthy", redbot attached to THAT
 * browser, asked who was signed in, and reported a signed-out account whose real Chrome was
 * signed in fine. Nothing failed; it drove the wrong browser and believed it.
 *
 * A debugging port is a rendezvous with whatever got there first. The only honest question is
 * therefore not "is anything listening" but "is the thing listening MINE", and the answer comes
 * from the owning process's `--user-data-dir`, not from the fact that it speaks the protocol.
 *
 * That is also why stopping a browser needs this module: to kill a process you must first prove
 * it is yours. A "stop" that trusted the port number would terminate Lenovo Vantage — or the
 * operator's own browser — on the strength of a number in a config file.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, openSync, closeSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { DATA } from './config.js';
import { resolveProfileDir } from './profiles.js';
import type { AccountRecord } from './config.js';

/**
 * - `free`    nothing is listening. The account's browser is not running.
 * - `running` listening, speaks CDP, and its user-data-dir is this account's folder.
 * - `foreign` listening, but it is not this account's browser. Driving it is the silent-wrong
 *             case above, so this is a refusal state, never a warning to click past.
 * - `unknown` something is listening and ownership could not be established. Treated as unsafe
 *             (fail closed): "I could not prove it is yours" is not "it is yours".
 */
export type PortState = 'free' | 'running' | 'foreign' | 'unknown';

export interface PortOwner {
  port: number;
  pid: number;
  process: string | null;
  commandLine: string | null;
  /** Parsed out of the command line — the thing that identifies WHICH browser this is. */
  userDataDir: string | null;
}

export interface PortStatus {
  handle: string;
  port: number | null;
  state: PortState;
  /** One sentence, written for a person rather than for a log. */
  detail: string;
  pid?: number;
  process?: string;
  userDataDir?: string;
  /** The CDP `Browser` string, when something answered — e.g. "Chrome/140.0.0.0". */
  browser?: string;
  /** Whether this account's sign-in folder exists at all. A missing one cannot be started. */
  profileOnDisk: boolean;
  /** True only for `running`: the one state in which redbot may drive, or stop, this browser. */
  ours: boolean;
  /**
   * HOW ownership was established, when it was.
   *
   * `process-table` is the strong proof: the owning process's own `--user-data-dir`.
   * `profile-lock` is the fallback — see `profileInUse`. Recorded rather than hidden so the
   * screen can say which one answered, and so `stopBrowser` can refuse to kill on the weaker one.
   */
  evidence?: 'process-table' | 'profile-lock';
}

/** What the OS lookup found, and — when it found nothing — why. */
export interface PortLookup {
  owners: Map<number, PortOwner>;
  /**
   * Null when the lookup ran and simply found no listener. A sentence when it could not run.
   *
   * These two were indistinguishable before, and that is the defect this field exists for: a
   * machine where PowerShell is blocked, WMI is disabled or the query times out produced exactly
   * the same silent empty map as an idle machine with no browsers open. Both surfaced as
   * "redbot could not confirm it is this account's browser", with nothing to act on.
   */
  reason: string | null;
}

/**
 * Is this port free to LISTEN on?
 *
 * A bind test, not a connect test. Connecting only proves something is answering right now;
 * binding proves Chrome will be able to take the port when it starts. The difference matters
 * because a port can be held by a process that answers nothing.
 *
 * Moved here from console-accounts so the allocator and the status screen ask the same
 * question in the same way — two definitions of "free" is how a console ends up handing out a
 * port it has just described as occupied.
 */
export function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve_) => {
    const probe = createServer();
    probe.once('error', () => resolve_(false));
    probe.once('listening', () => probe.close(() => resolve_(true)));
    probe.listen(port, '127.0.0.1');
  });
}

/**
 * Where each kind of port is allocated from.
 *
 * Debug ports keep 9222–9299 — 9222 is Chrome's conventional default and the range predates
 * this. Relay ports get their own band so the two allocators can never collide: an account whose
 * relay took the port its own browser wanted would be a self-inflicted `foreign` state, and the
 * failure would look like the Lenovo Vantage squatter this module was written for.
 *
 * 9400–9499 measured 100/100 bindable on the development machine, 2026-08-03.
 */
export const DEBUG_PORT_FIRST = 9222;
export const DEBUG_PORT_LAST = 9299;
export const RELAY_PORT_FIRST = 9400;
export const RELAY_PORT_LAST = 9499;

/**
 * The first port in a range that is both unclaimed by redbot and actually bindable.
 *
 * Generalised out of `src/console-accounts.ts`, which had this hardcoded to the debug range, so
 * relay allocation and debug allocation ask "is this port free" in exactly ONE way. Two
 * definitions of free is how a console hands out a port it has just described as occupied.
 *
 * Scans rather than increments: a machine with something on the first two ports should hand out
 * the third, not fail, and not silently hand out a port another program owns.
 */
export async function firstFreePortInRange(
  taken: readonly number[],
  first: number,
  last: number,
  what: string
): Promise<number> {
  const claimed = new Set(taken);
  for (let p = first; p <= last; p++) {
    if (claimed.has(p)) continue;
    if (await portIsFree(p)) return p;
  }
  throw new Error(
    `No free ${what} between ${first} and ${last}. Close some programs, or free a port in that range.`
  );
}

/** The `--user-data-dir` out of a command line, in any of the three shapes below. */
export function userDataDirFrom(commandLine: string | null): string | null {
  if (!commandLine) return null;
  /**
   * THREE SHAPES, AND WINDOWS WRITES THE ONE THAT USED TO BREAK.
   *
   *   "--user-data-dir=C:\Users\Clark Pesa\…"   the WHOLE argument quoted  <- Windows' own form
   *   --user-data-dir="C:\my data\profile a"    the value quoted
   *   --user-data-dir=C:\data\chrome-profile-c  no quotes, no spaces
   *
   * Only the last two were anticipated. With no quote directly after the equals sign the old
   * alternation fell through to `(\S+)`, which stops at the first space — so a machine whose
   * Windows user is "Clark Pesa" parsed its own profile as `C:\Users\Clark`, a path that exists
   * nowhere. Ownership is decided by comparing this string, so redbot classified its OWN Chrome
   * as foreign, refused to stop it (correctly, on false evidence), and leaked one orphaned
   * browser onto a debugging port per restart until no port was left. Reported 2026-08-13.
   *
   * Invisible on a single-word username, where `(\S+)` happens to capture the whole path — which
   * is why every machine this was developed on looked fine.
   */
  const m = /"--user-data-dir=([^"]*)"|--user-data-dir="([^"]*)"|--user-data-dir=(\S+)/.exec(commandLine);
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

/**
 * Is a running Chrome holding this profile folder open?
 *
 * ---------------------------------------------------------------------------
 * THE SECOND OWNERSHIP PROOF, and why it is a real one rather than a guess.
 *
 * The header above is emphatic that ownership is the `--user-data-dir` and that speaking CDP on
 * the right port proves nothing. That still holds. This asks the same question from the other
 * end: instead of asking the process what folder it opened, it asks the folder whether a process
 * has it open.
 *
 * Chrome takes an exclusive lock on `<user-data-dir>\lockfile` for as long as it is running.
 * MEASURED on Chrome 150: opening that file `r+` gives **EBUSY** while the browser is up, and
 * succeeds once it exits. So EBUSY on THIS account's own folder means a Chrome is running on
 * THIS account's profile — which is user-data-dir evidence, obtained without WMI, without
 * PowerShell and without any privilege.
 *
 * The Lenovo Vantage case that this module exists for still fails it correctly: that WebView
 * holds its own folder under `Lenovo\Vantage`, not redbot's, so the lock on redbot's profile is
 * absent and no ownership is claimed.
 *
 * WHAT IT DOES NOT PROVE. It does not prove the locked Chrome is the process answering on the
 * port — only that the account's browser is running and something is answering where that
 * browser was told to listen. A machine where the account's Chrome was started WITHOUT the
 * debugging flag while a different CDP browser sat on the port would satisfy both halves and be
 * wrong. That is narrow, but it is why this is recorded as `profile-lock` evidence rather than
 * being presented as the same fact as a process-table match, and why it is only consulted when
 * the process table could not be read at all.
 *
 * Anything other than EBUSY is treated as "cannot prove", including a missing file (Chrome
 * deletes it on a clean exit) and a permission error. Fail closed: unproven is not owned.
 * ---------------------------------------------------------------------------
 */
export function profileInUse(
  profileDir: string,
  io: { open?: (p: string) => void } = {}
): boolean {
  const open = io.open ?? ((p: string) => { closeSync(openSync(p, 'r+')); });
  try {
    open(join(profileDir, 'lockfile'));
    return false;                       // opened it, so nothing is holding it
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === 'EBUSY';
  }
}

/**
 * Same folder? Compared case-insensitively with separators and trailing slashes normalised.
 *
 * Windows paths reach here from two directions — one built by `join()`, one echoed back by
 * Chrome's own command line — and they routinely differ in case and slash direction while
 * naming the identical directory. A strict compare would call every running browser foreign,
 * which is the failure that looks like the feature working ("it says it's not mine").
 */
export function sameDir(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
  try { return norm(a) === norm(b); } catch { return false; }
}

export interface OrphanBrowser {
  port: number;
  pid: number;
  process: string | null;
  /** The folder it opened — the proof that it is ours. */
  profileDir: string;
}

/**
 * Browsers that are OURS but belong to no account — and can therefore be reclaimed.
 *
 * ---------------------------------------------------------------------------
 * WHY OWNERSHIP CANNOT KEEP RUNNING THROUGH THE ACCOUNTS TABLE.
 *
 * `statusForAccounts` walks the accounts and asks about each one's port, so a browser whose
 * account row has gone is invisible to every screen and every stop button. Reported 2026-08-13:
 * a Chrome holding `chrome-profile-e` outlived the account `Big_Variation_8580`, sat on 9222 —
 * the first port the allocator hands out — and could not be reclaimed by any code path:
 *
 *     browsers  Big_Variation_8580 NOT closed — Big_Variation_8580 is not set up.
 *
 * The evidence never depended on the row. It is the FOLDER: that Chrome was told to open a
 * directory inside redbot's own data root, and nothing else on the machine does that. So the
 * question is asked of the folder, and an account is only how a browser gets a name.
 *
 * STILL FAIL CLOSED. A null user-data-dir proves nothing and is left alone; a path outside this
 * install's data root is somebody else's — including another Windows user's redbot, which is
 * emphatically not this install's to kill. The prefix test is done on normalised paths with a
 * separator appended, so `…\data-old\chrome-profile-a` cannot pass as being inside `…\data`.
 * ---------------------------------------------------------------------------
 */
export function orphanBrowsers(
  owners: ReadonlyMap<number, PortOwner>,
  dataRoot: string,
  claimedDirs: readonly string[]
): OrphanBrowser[] {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
  let root: string;
  try { root = norm(dataRoot); } catch { return []; }

  const claimed = new Set<string>();
  for (const d of claimedDirs) {
    if (!d) continue;
    /* A claimed folder may be a bare name under the data root or an absolute adopted path. */
    try { claimed.add(norm(isAbsolute(d) ? d : join(dataRoot, d))); } catch { /* unusable */ }
  }

  const out: OrphanBrowser[] = [];
  for (const o of owners.values()) {
    if (!o.userDataDir) continue;                       // unproven is not owned
    let dir: string;
    try { dir = norm(o.userDataDir); } catch { continue; }
    if (dir === root) continue;                         // the root is not a profile
    if (!dir.startsWith(root + '/')) continue;          // outside this install — not ours
    if (claimed.has(dir)) continue;                     // a live account already owns it
    out.push({ port: o.port, pid: o.pid, process: o.process, profileDir: o.userDataDir });
  }
  return out;
}

/**
 * Who owns each of these ports, from the operating system rather than from the protocol.
 *
 * Windows: one PowerShell invocation for ALL ports, not one per port. The accounts screen polls
 * this, and process startup is the expensive part — a per-port spawn would put several hundred
 * milliseconds of shell startup on every refresh for no extra information.
 *
 * Anywhere else this returns an empty map rather than guessing. An empty map does not mean
 * "the ports are free": it means ownership is unknown, and `statusFor` degrades to `unknown`
 * for anything that is listening, which is the fail-closed reading.
 */
/**
 * One inspection at a time per set of ports.
 *
 * The accounts screen polls every 6s and the inspection can take longer than that, so without
 * this a slow machine spawns a second shell before the first has answered — and the slower it
 * gets, the more shells it starts, which is the wrong direction for a machine already
 * struggling. Callers that arrive mid-flight get the answer already being fetched.
 */
const inFlight = new Map<string, Promise<PortLookup>>();

export function inspectPorts(ports: number[]): Promise<PortLookup> {
  const wanted = [...new Set(ports.filter((p) => Number.isInteger(p) && p > 0))].sort((a, b) => a - b);
  if (!wanted.length) return Promise.resolve({ owners: new Map(), reason: null });
  if (process.platform !== 'win32') {
    return Promise.resolve({
      owners: new Map(),
      reason: `the process table is only read on Windows, and this is ${process.platform}`
    });
  }

  const key = wanted.join(',');
  const running = inFlight.get(key);
  if (running) return running;
  const started = inspectPortsNow(wanted, key);
  inFlight.set(key, started);
  return started;
}

function inspectPortsNow(wanted: number[], key: string): Promise<PortLookup> {

  /* `procId`, not `pid`: `$PID` is an automatic variable in PowerShell and a property named
     after it is a trap for the next person to edit this. `ConvertTo-Json` in Windows
     PowerShell 5.1 has no -AsArray, so a single result would serialise as a bare object and
     the parse below would silently see no ports at all — hence the `items` wrapper. */
  /**
   * ONE CIM query for every port, not one per port.
   *
   * `Get-CimInstance Win32_Process` is the expensive call here — it opens a WMI session, and
   * doing that inside the per-port loop multiplied the cost by the number of accounts. Measured
   * on an idle machine the old shape took ~6.8s for three ports; the ports are cheap and the
   * process lookup was nearly all of it.
   *
   * Sockets are read first, the owning pids collected, and a single filtered query resolves
   * them all.
   */
  const script = `
$ports = @(${wanted.join(',')})
$conns = foreach ($p in $ports) {
  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { [pscustomobject]@{ port=$p; procId=[int]$c.OwningProcess } }
}
$procs = @{}
if ($conns) {
  $ids = @($conns | Select-Object -ExpandProperty procId -Unique)
  $filter = ($ids | ForEach-Object { "ProcessId=$_" }) -join ' OR '
  try {
    Get-CimInstance -ClassName Win32_Process -Filter $filter -ErrorAction Stop |
      ForEach-Object { $procs[[int]$_.ProcessId] = $_ }
  } catch {}
}
$items = foreach ($c in $conns) {
  $pr = $procs[[int]$c.procId]
  [pscustomobject]@{ port=$c.port; procId=$c.procId; name=$(if($pr){$pr.Name}else{$null}); cmd=$(if($pr){$pr.CommandLine}else{$null}) }
}
[pscustomobject]@{ items = @($items) } | ConvertTo-Json -Depth 4 -Compress`;

  return new Promise((done) => {
    const out: string[] = [];
    const err: string[] = [];
    let settled = false;
    const finish = (owners: Map<number, PortOwner>, reason: string | null) => {
      if (settled) return;
      settled = true;
      inFlight.delete(key);          // the next caller starts a fresh look, not this stale one
      done({ owners, reason });
    };

    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
                     { windowsHide: true });
    /**
     * A console refresh must not hang because a WMI query wedged — unknown beats stuck. But
     * this was 6s, and a WMI session costs most of that on an idle machine: measured at ~6.8s
     * for three ports before the query above was collapsed into one. So the bound was firing on
     * healthy machines, and every port silently became "cannot be identified" — the fail-closed
     * answer, given for the wrong reason. Generous enough to be a real ceiling now, with
     * `inFlight` below making sure a slow one cannot pile up behind the 6s poll.
     */
    const timer = setTimeout(() => {
      try { ps.kill(); } catch { /* gone */ }
      finish(new Map(), 'the lookup took longer than 20s and was stopped');
    }, 20_000);

    ps.stdout.on('data', (d: Buffer) => out.push(String(d)));
    ps.stderr.on('data', (d: Buffer) => err.push(String(d)));
    /* powershell.exe could not be started at all — blocked by policy, or not on PATH. */
    ps.on('error', (e) => {
      clearTimeout(timer);
      finish(new Map(), `PowerShell could not be started (${e.message})`);
    });
    ps.on('close', (code) => {
      clearTimeout(timer);
      const map = new Map<number, PortOwner>();
      const text = out.join('').trim();
      const stderr = err.join('').trim().split('\n')[0]?.trim() ?? '';

      if (code !== 0) {
        return finish(map, `PowerShell exited with code ${code}${stderr ? `: ${stderr}` : ''}`);
      }
      try {
        const parsed = JSON.parse(text || '{"items":[]}') as {
          items?: { port: number; procId: number; name: string | null; cmd: string | null }[];
        };
        for (const it of parsed.items ?? []) {
          map.set(Number(it.port), {
            port: Number(it.port),
            pid: Number(it.procId),
            process: it.name ?? null,
            commandLine: it.cmd ?? null,
            userDataDir: userDataDirFrom(it.cmd ?? null)
          });
        }
      } catch {
        /* Unparseable is unknown, not empty — and now it SAYS so. Constrained Language Mode and a
           profile that prints a banner both land here, and both used to look like an idle machine. */
        return finish(new Map(), `the lookup returned something that is not JSON${stderr ? `: ${stderr}` : ''}`);
      }
      finish(map, null);
    });
  });
}

/** Does a CDP browser answer here, and what does it call itself? */
async function probeCdp(port: number): Promise<{ up: boolean; browser?: string }> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return { up: false };
    const j = await res.json().catch(() => ({})) as { Browser?: string };
    return { up: true, ...(j.Browser ? { browser: j.Browser } : {}) };
  } catch {
    return { up: false };
  }
}

/**
 * The status of every configured account's port, in one pass.
 *
 * The OS lookup happens ONCE for all ports; the CDP probes run concurrently. Ordering matters
 * for correctness as well as speed: ownership is decided by the process table, and the CDP
 * answer is only used to describe what is there.
 */
export async function statusForAccounts(accounts: AccountRecord[]): Promise<PortStatus[]> {
  const ports = accounts.map((a) => a.debugPort).filter((p): p is number => typeof p === 'number');
  const { owners, reason: lookupReason } = await inspectPorts(ports);

  return Promise.all(accounts.map(async (a): Promise<PortStatus> => {
    const profileOnDisk = !!a.profileDir && existsSync(resolveProfileDir(DATA, a.profileDir));

    if (typeof a.debugPort !== 'number') {
      return {
        handle: a.handle, port: null, state: 'unknown', ours: false, profileOnDisk,
        detail: 'No port on record, so redbot cannot tell which browser belongs to this account.'
      };
    }

    const owner = owners.get(a.debugPort);
    const cdp = await probeCdp(a.debugPort);
    const expected = a.profileDir ? resolveProfileDir(DATA, a.profileDir) : null;

    // Nothing holds the port and nothing answers: not running. The ordinary resting state.
    if (!owner && !cdp.up) {
      return {
        handle: a.handle, port: a.debugPort, state: 'free', ours: false, profileOnDisk,
        detail: `Nothing is listening on ${a.debugPort}. This account's browser is not running.`
      };
    }

    const base = {
      handle: a.handle, port: a.debugPort, profileOnDisk,
      ...(owner ? { pid: owner.pid } : {}),
      ...(owner?.process ? { process: owner.process } : {}),
      ...(owner?.userDataDir ? { userDataDir: owner.userDataDir } : {}),
      ...(cdp.browser ? { browser: cdp.browser } : {})
    };

    /* Ownership is the user-data-dir, full stop. A browser that speaks CDP on the right port
       is not evidence — that is exactly what the Lenovo Vantage WebView does. */
    if (owner && expected && sameDir(owner.userDataDir, expected)) {
      return {
        ...base, state: 'running', ours: true, evidence: 'process-table',
        detail: `${cdp.browser || 'A browser'} is running on ${a.debugPort} with this account's own sign-in folder.`
      };
    }

    if (owner && owner.userDataDir && expected) {
      return {
        ...base, state: 'foreign', ours: false,
        detail: `Port ${a.debugPort} is held by ${owner.process || 'another program'} (pid ${owner.pid}) `
              + `using ${owner.userDataDir} — not this account's browser. Driving it would read Reddit signed out.`
      };
    }

    if (owner) {
      return {
        ...base, state: 'foreign', ours: false,
        detail: `Port ${a.debugPort} is held by ${owner.process || 'another program'} (pid ${owner.pid}), `
              + 'which is not a browser redbot started.'
      };
    }

    /**
     * The process table gave nothing. Before failing closed, ask the FOLDER.
     *
     * This is the case reported from a second machine: both accounts showed "Something is
     * answering on 9222, but redbot could not confirm it is this account's browser" while the
     * browsers were genuinely theirs and working. The lookup was returning an empty map — every
     * way it can fail did so silently — and CDP answering was correctly not accepted as proof.
     *
     * `profileInUse` supplies the missing evidence without WMI: Chrome holds this account's own
     * sign-in folder locked while it runs. Only consulted when the process table could not be
     * read, so a lookup that RAN and found a foreign owner is never overridden by it.
     */
    if (!owner && cdp.up && expected && profileInUse(expected)) {
      return {
        ...base, state: 'running', ours: true, evidence: 'profile-lock',
        detail: `${cdp.browser || 'A browser'} is answering on ${a.debugPort}, and this account's own `
              + 'sign-in folder is open in a running Chrome. '
              + `(The process table could not be read${lookupReason ? `: ${lookupReason}` : ''}, `
              + 'so this was confirmed from the folder instead.)'
      };
    }

    /* Something answers CDP, the process table gave nothing, and the folder is not held either.
       Fail closed: unproven is not owned — but say WHY it could not be proven. */
    return {
      ...base, state: 'unknown', ours: false,
      detail: `Something is answering on ${a.debugPort}${cdp.browser ? ` (${cdp.browser})` : ''}, `
            + 'but redbot could not confirm it is this account\'s browser'
            + (lookupReason ? ` — ${lookupReason}.` : '.')
            + (profileOnDisk
              ? ' This account\'s sign-in folder is also not open in a running Chrome.'
              : ' This account has no sign-in folder on disk.')
    };
  }));
}

export interface StopResult { ok: boolean; error?: string; pid?: number; port?: number }

/**
 * Stop the browser on this account's port.
 *
 * REFUSES anything it cannot prove is ours. The whole danger of a stop button on a port number
 * is that ports get reused: the operator's own Chrome, or a vendor widget, can be sitting where
 * an account's browser used to be, and a kill-by-port would close it without a word.
 *
 * `taskkill /T` on Windows because Chrome is a process tree — terminating the parent alone
 * leaves the renderer children behind, and they keep the port's socket alive, so a "stop" that
 * did that would be followed by a "start" that failed with the port in use.
 */
export async function stopAccountBrowser(account: AccountRecord): Promise<StopResult> {
  const [status] = await statusForAccounts([account]);
  if (!status || status.port == null) return { ok: false, error: 'This account has no port on record.' };
  if (status.state === 'free') return { ok: false, error: `Nothing is running on ${status.port}.` };
  /**
   * Ours, but identified from the profile lock rather than the process table — so there is no pid,
   * and there is nothing to kill BY. Refusing here is not conservatism for its own sake: the only
   * thing available would be a kill-by-port, which is exactly the "close whatever is sitting on
   * this number" behaviour this module exists to prevent. Says which half is missing, because
   * "refusing to stop it: a browser is running with this account's folder" reads as a
   * contradiction otherwise.
   */
  if (status.ours && !status.pid) {
    return {
      ok: false,
      error: 'redbot can see this account\'s browser but not which process it is, so it will not '
           + 'guess what to close. Close the Chrome window yourself. '
           + `(${status.detail})`
    };
  }
  if (!status.ours || !status.pid) {
    return { ok: false, error: `Refusing to stop it: ${status.detail}` };
  }

  const pid = status.pid;
  const ok = await new Promise<boolean>((done) => {
    if (process.platform === 'win32') {
      const kill = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
      kill.on('error', () => done(false));
      kill.on('close', (code) => done(code === 0));
    } else {
      try { process.kill(pid, 'SIGTERM'); done(true); } catch { done(false); }
    }
  });

  return ok ? { ok: true, pid, port: status.port }
            : { ok: false, error: `Could not stop process ${pid} on port ${status.port}.` };
}
