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
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DATA } from './config.js';
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

/** `--user-data-dir=C:\x` or `--user-data-dir="C:\x with spaces"`. Both shapes are real. */
export function userDataDirFrom(commandLine: string | null): string | null {
  if (!commandLine) return null;
  const m = /--user-data-dir=(?:"([^"]*)"|(\S+))/.exec(commandLine);
  return m ? (m[1] ?? m[2] ?? null) : null;
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
const inFlight = new Map<string, Promise<Map<number, PortOwner>>>();

export function inspectPorts(ports: number[]): Promise<Map<number, PortOwner>> {
  const wanted = [...new Set(ports.filter((p) => Number.isInteger(p) && p > 0))].sort((a, b) => a - b);
  if (!wanted.length || process.platform !== 'win32') return Promise.resolve(new Map());

  const key = wanted.join(',');
  const running = inFlight.get(key);
  if (running) return running;
  const started = inspectPortsNow(wanted, key);
  inFlight.set(key, started);
  return started;
}

function inspectPortsNow(wanted: number[], key: string): Promise<Map<number, PortOwner>> {

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
    let settled = false;
    const finish = (m: Map<number, PortOwner>) => {
      if (settled) return;
      settled = true;
      inFlight.delete(key);          // the next caller starts a fresh look, not this stale one
      done(m);
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
    const timer = setTimeout(() => { try { ps.kill(); } catch { /* gone */ } finish(new Map()); }, 20_000);

    ps.stdout.on('data', (d: Buffer) => out.push(String(d)));
    ps.on('error', () => { clearTimeout(timer); finish(new Map()); });
    ps.on('close', () => {
      clearTimeout(timer);
      const map = new Map<number, PortOwner>();
      try {
        const parsed = JSON.parse(out.join('').trim() || '{"items":[]}') as {
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
      } catch { /* unparseable is unknown, not empty */ }
      finish(map);
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
  const owners = await inspectPorts(ports);

  return Promise.all(accounts.map(async (a): Promise<PortStatus> => {
    const profileOnDisk = !!a.profileDir && existsSync(join(DATA, a.profileDir));

    if (typeof a.debugPort !== 'number') {
      return {
        handle: a.handle, port: null, state: 'unknown', ours: false, profileOnDisk,
        detail: 'No port on record, so redbot cannot tell which browser belongs to this account.'
      };
    }

    const owner = owners.get(a.debugPort);
    const cdp = await probeCdp(a.debugPort);
    const expected = a.profileDir ? join(DATA, a.profileDir) : null;

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
        ...base, state: 'running', ours: true,
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

    /* Something answers CDP but the process table gave nothing — not Windows, or the query was
       refused. Fail closed: unproven is not owned. */
    return {
      ...base, state: 'unknown', ours: false,
      detail: `Something is answering on ${a.debugPort}${cdp.browser ? ` (${cdp.browser})` : ''}, `
            + 'but redbot could not confirm it is this account\'s browser.'
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
