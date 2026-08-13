/**
 * redbot, as a desktop application.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT.
 *
 * It is a WINDOW AROUND THE EXISTING CONSOLE. `tools/product/server.mjs` already serves
 * `tools/product/index.html` — one HTML file, no framework, no build step — so this process starts
 * that server on a loopback port and points a BrowserWindow at it. The server and the UI are not
 * rewritten, and that is the design rather than a shortcut:
 *
 *   - `hostIsLocal` / `originIsLocal` in the server keep passing UNCHANGED. Measured: a
 *     BrowserWindow loading a loopback URL sends `Host: 127.0.0.1:<port>` and, on a POST from the
 *     page, `Origin: http://127.0.0.1:<port>`. Both guards accept both. Those two checks plus the
 *     127.0.0.1 bind ARE the security model — there is no authentication behind them — so a
 *     conversion that had to weaken them would be the wrong conversion.
 *   - `tools/product/server.test.mjs` and `ui.test.mjs` keep working, because the thing they drive
 *     over HTTP is still an HTTP server.
 *
 * It is NOT an IPC rewrite. Replacing 34 endpoints and every `fetch()` in a 3,510-line UI with
 * `contextBridge` handlers would delete the guards above and strand both suites, to gain nothing
 * a person can see.
 *
 * THE THREE THINGS THAT ACTUALLY NEEDED SOLVING
 *
 * 1. `process.execPath` is this app, not `node`. The console spawns `dist/cli.js` for every
 *    action; spawning `process.execPath` inside Electron would launch a SECOND COPY OF THE APP
 *    rather than run the CLI. `ELECTRON_RUN_AS_NODE=1` in the child environment makes the Electron
 *    binary behave as plain Node, which also means no separate Node runtime has to be shipped.
 *    Set once here, inherited by the server child and by every CLI grandchild it spawns.
 *
 * 2. Working state cannot live in the install directory. It is read-only under Program Files and
 *    is REPLACED by an update. `REDBOT_DATA` is set to the OS per-user directory before anything
 *    loads, which relocates `data/`, the database and `reports/` together — src/config.ts and
 *    src/db.ts both already honour it, and src/test/db-path.test.ts pins the precedence.
 *
 * 3. The vault master key has nowhere to live. See electron/vault-key.mjs.
 * ---------------------------------------------------------------------------
 */
import { app, BrowserWindow, shell, dialog, safeStorage, Menu, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ensureVaultKey } from './vault-key.mjs';
import { createUpdater } from './updater.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/**
 * `electron-updater` is CommonJS and has to be loaded SYNCHRONOUSLY, because the updater calls for
 * it on first use rather than at import time (see electron/updater.mjs — touching it outside
 * Electron throws). `await import()` would make that call site async for no gain.
 */
const require = createRequire(import.meta.url);

/**
 * A working directory that EXISTS ON DISK.
 *
 * In a packaged build `ROOT` resolves inside `resources/app.asar`, which is an archive, not a
 * directory. `spawn()` with such a cwd fails — and it fails misleadingly: the error names the
 * executable (`spawn …\redbot.exe ENOENT`) while the thing that does not exist is the cwd. That
 * cost a debugging cycle: the app provisioned correctly, applied all 14 migrations, allocated a
 * port, and then died with an error pointing at the wrong file.
 *
 * `existsSync(ROOT)` cannot be used to detect this, because Electron's patched fs reports an asar
 * path as a directory. The archive has to be recognised by name.
 *
 * Reading FROM the archive is fine — that is what asar is for — so only the cwd needs a real path.
 */
const PACKAGED = /[\\/]app\.asar([\\/]|$)/.test(ROOT);

/**
 * Boot goes to a FILE, not just to stdout.
 *
 * Measured: launching this app from a terminal on Windows produced no output at all — Electron
 * does not attach stdout to the parent console, so every `process.stdout.write` below is invisible
 * exactly when it matters. The first time boot failed, the only symptom was a window that never
 * appeared and a test that timed out with an empty log.
 *
 * So everything is appended to `<userData>/boot.log` as well. It is the only account of what
 * happened before the console exists to report through, and it is what a person can be asked to
 * send. No secret is ever written here — the vault key is reported by SOURCE, never by value.
 */
let logFile = null;
function boot_log(line) {
  const stamped = `${new Date().toISOString()}  ${line}`;
  process.stdout.write(stamped + '\n');
  try {
    if (logFile) appendFileSync(logFile, stamped + '\n');
  } catch { /* logging must never be the thing that stops the app */ }
}

/**
 * Set the application name BEFORE reading `app.getPath('userData')`.
 *
 * Measured during the spikes: unnamed, `userData` is `%APPDATA%\Electron` — a directory shared
 * with every other unnamed Electron app on the machine. Provisioning the whole tree there would
 * put redbot's database and Chrome profile bindings in a communal folder. `productName` in
 * package.json covers the packaged build; this covers `npm start` too.
 */
/**
 * DO NOT hardcode this when packaged — `userData` is derived from it.
 *
 * A build published as `redbot dev` (a separate `appId`, its own install directory and shortcut)
 * would have its name overwritten here and land on `%APPDATA%edbot` — the LIVE app's data.
 * Two apps, one database, and the only symptom would be dev work appearing in the live console.
 * That is the failure this whole side-by-side split exists to prevent, so the packaged name wins.
 *
 * Unpackaged still needs the fallback: `npm start` without a name gets `%APPDATA%\Electron`, a
 * directory shared with every other unnamed Electron app on the machine.
 */
if (!app.isPackaged) app.setName('redbot');

let serverChild = null;
let win = null;
let bootError = null;
let updater = null;

/**
 * Applying an update, from the console's Setup screen.
 *
 * WHY THIS IS IN THE MAIN PROCESS AND NOT BEHIND AN /api ROUTE. The console server is a child
 * running as plain Node (ELECTRON_RUN_AS_NODE=1) — it cannot quit and relaunch this app, and
 * `electron-updater` does not work outside the Electron main process at all. See preload.cjs for
 * the full argument, and updater.mjs for what the updater does and does not do on its own.
 *
 * NOTHING HERE RUNS BY ITSELF. There is no check on launch, no timer, and no install-on-quit;
 * `createUpdater` turns electron-updater's automatic download and install off explicitly, and
 * electron/updater.test.mjs pins that. The only way an update installs is a click that reaches
 * `redbot:update-apply`.
 */
function wireUpdater(consolePort) {
  updater = createUpdater({
    /**
     * What the updater asks before it restarts the app. See `isBusy` in electron/updater.mjs for
     * why publishing makes this more than a courtesy.
     *
     * FAILS OPEN, and the reason is not laziness. Everything that could be mid-flight is a child
     * of the console server — a console that cannot answer is a console that is not running
     * actions. Refusing to update because a health probe timed out would block the one button
     * that fixes a broken install. The probe is logged either way, so a silent always-idle answer
     * is visible in boot.log rather than invisible.
     */
    isBusy: async () => {
      if (!consolePort) return null;
      /**
       * ASKED TWICE, AND THE SECOND ASK IS NOT BELT-AND-BRACES.
       *
       * The console sets no `keepAliveTimeout`, so Node closes an idle connection after 5s while
       * undici may still hold it pooled. A request that lands in that window dies with
       * `ECONNRESET` before the server ever sees it — and this probe is exactly the shape that
       * hits it: it runs seconds-to-hours after whatever last spoke to the console.
       *
       * Fail-open then reads that reset as "idle" and lets `quitAndInstall` kill the console
       * server and every child under it. `ACTIONS.__reply` is `stoppable:false` precisely because
       * dying between submit and confirm leaves a live comment on Reddit that redbot does not know
       * it made — so the one probe guarding that is the one that must not confuse a recycled
       * socket with a quiet app. Measured as a deterministic ECONNRESET in
       * `tools/product/server.test.mjs` after an idle gap; same race, same cause.
       *
       * So a connection-level failure is RETRIED ONCE on a fresh socket. A console that is
       * genuinely gone fails the retry too and still fails open, which is the behaviour the
       * comment above describes and the reason it is safe to keep.
       */
      const ask = async () => {
        const res = await fetch(`http://127.0.0.1:${consolePort}/api/pulse`, {
          signal: AbortSignal.timeout(5_000)
        });
        if (!res.ok) return null;
        const p = await res.json();
        if (p && p.running) return `"${p.running}" is running`;
        if (p && p.auto && p.auto.running) return 'the unattended loop is running';
        return null;
      };
      try {
        return await ask();
      } catch (first) {
        /**
         * A TIMEOUT IS NOT AN IDLE CONSOLE — it is the one answer that means the opposite.
         *
         * A console that is GONE answers instantly: the connection is refused. A console that
         * takes longer than five seconds to answer `/api/pulse` is alive and under load, and the
         * thing most likely to be loading it is the work this probe exists to protect — a collect
         * driving Chrome, or `__reply`, which is `stoppable:false` because dying between submit
         * and confirm leaves a live comment on Reddit that redbot does not know it made.
         *
         * This used to return null, which reads as "nothing is running", and `quitAndInstall`
         * then killed the console and every child under it. Reported 2026-08-13 from a machine
         * that took three silent updates in one day. Retrying is still pointless — the same slow
         * console will be slow again — so it reports BUSY and the install waits for the next
         * check. A deferred update costs minutes; a killed publish cannot be undone.
         */
        if (first && first.name === 'TimeoutError') {
          boot_log(`updater    busy check timed out — treating as BUSY and deferring: ${first.message}`);
          return 'the console did not answer in time, so it may be mid-run';
        }
        boot_log(`updater    busy check failed (${first && first.message ? first.message : first}) — retrying once on a fresh connection`);
        try {
          return await ask();
        } catch (e) {
          boot_log(`updater    busy check failed twice, treating as idle — ${e && e.message ? e.message : e}`);
          return null;
        }
      }
    },
    loadAutoUpdater: () => require('electron-updater').autoUpdater,
    /**
     * ONLY THE LIVE BUILD IS AN UPDATE TARGET, expressed through the mechanism that already
     * exists rather than a new one.
     *
     * `createUpdater` treats a non-packaged build as unsupported: it answers `snapshot()` and
     * refuses to reach the feed, and electron/updater.test.mjs pins that. A side-by-side variant
     * needs exactly that behaviour for a different reason — the feed is baked in at build time and
     * names ONE repo, so `redbot dev` would find the live release and offer an "update" that
     * installs a DIFFERENT APPLICATION beside it: different appId, different userData, its own
     * database. The button would appear to work.
     *
     * Reported as not-an-update-target rather than skipping `wireUpdater`, because the renderer
     * calls `updates.snapshot()` the moment the Setup card renders. An unregistered IPC channel
     * rejects, and that lands as a console error on a screen whose whole job is saying what is
     * wrong. The bridge must always answer; it just answers "not for this build".
     *
     * A variant is updated by building it again, which is the point of having one.
     */
    isPackaged: app.isPackaged && app.getName() === 'redbot',
    currentVersion: app.getVersion(),
    log: boot_log,
    /* Dev runs refuse to update unless asked, because a dev build installing a release build over
       itself is not something to do by accident. */
    allowDev: process.env.REDBOT_DEV_UPDATES === '1',
    broadcast: (state) => {
      if (win && !win.isDestroyed()) win.webContents.send('redbot:update-status', state);
    }
  });

  /**
   * Only OUR window may drive the updater.
   *
   * `ipcMain.handle` answers any frame that has the preload attached, and while nothing else
   * should ever have it, "should" is not a check. This is the same instinct as the server's
   * `hostIsLocal` guard: cheap, and it removes the need to reason about whether some future
   * window could reach an installer.
   */
  const fromOurWindow = (event) =>
    win && !win.isDestroyed() && event.sender === win.webContents;

  const guard = (name, fn) => ipcMain.handle(name, (event) => {
    if (!fromOurWindow(event)) {
      boot_log(`updater W  refused ${name} from an unexpected frame`);
      return { ok: false, reason: 'refused' };
    }
    return fn();
  });

  guard('redbot:update-check', () => updater.check());
  guard('redbot:update-apply', () => updater.apply());
  guard('redbot:update-snapshot', () => updater.snapshot());
}

/** A port the OS says is free. Bind :0, read it back, release it — the same trick the tests use. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * Start the console server as a child, and resolve once it says it is listening.
 *
 * A child rather than an in-process import, for two reasons: the server is a top-level script
 * that binds a socket on load, and a crash in it should not take the window down with it.
 *
 * The banner is waited for rather than assumed — "started the process" is not "is listening", and
 * loading the window too early shows a connection error instead of the console.
 */
function startServer(port, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(ROOT, 'tools', 'product', 'server.mjs'), '--port', String(port)],
      {
        // See PACKAGED above: ROOT is inside app.asar when packaged, and an archive is not a
        // valid cwd. The server resolves its own paths from import.meta.url, so the cwd only has
        // to exist.
        cwd: PACKAGED ? app.getPath('userData') : ROOT,
        /**
         * WHICH BUILD THIS IS, handed to the console so a person can tell two windows apart.
         *
         * There are three cases and they are genuinely different, so none is inferred from
         * another. `app.isPackaged` separates a checkout run from an install — that is the case a
         * productName cannot see, because running from source reports the same name as live.
         * Among installs, `app.getName()` IS the identity: electron-builder derives the install
         * directory, the shortcut and `userData` from productName, so a build called anything
         * other than "redbot" is a genuinely separate app with its own data, not a relabelled one.
         *
         * Named rather than flagged: `REDBOT_BUILD=staging` reports "staging" without anyone
         * teaching this code what staging is.
         */
        env: {
          ...env,
          ELECTRON_RUN_AS_NODE: '1',
          REDBOT_BUILD: !app.isPackaged ? 'source'
            : (app.getName() === 'redbot' ? 'live' : app.getName().replace(/^redbot[\s-]*/i, '') || app.getName())
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let out = '';
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    const timer = setTimeout(
      () => done(reject, new Error(`the console did not start within 30s. Output:\n${out}`)),
      30_000
    );

    child.stdout.on('data', (d) => {
      out += d;
      process.stdout.write(d);
      if (out.includes(`http://localhost:${port}`)) {
        clearTimeout(timer);
        done(resolve, child);
      }
    });
    child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
    child.on('error', (e) => { clearTimeout(timer); done(reject, e); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      done(reject, new Error(`the console exited with code ${code} before listening.\n${out}`));
    });
  });
}

/**
 * Open the Chrome belonging to every account bound to this machine, once, at boot.
 *
 * WHY THIS EXISTS. redbot cannot read or publish without a debuggable Chrome — the product IS a
 * browser. Before this, a launch produced an app that looked fine and refused every action, with
 * two "browser is not open" problems on the pulse and nothing having gone wrong: the operator
 * simply had not clicked Open Chrome twice yet. Requiring a person to perform the same two clicks
 * every morning is not a safety property, it is a chore, and it is why `src/requirements.ts` could
 * only report the browser as advisory. Opening them here is what lets that become blocking: the
 * condition is normally already met, so an unmet one is a real fault worth stopping for.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not sign anybody in — a Chrome opens on Reddit's login
 * page and stays there until a person uses it. It does not touch an account whose port is held by
 * something else: `launchChrome` refuses a `foreign` port, because Chrome handed an occupied
 * --remote-debugging-port starts anyway and silently yields the port, and redbot would then attach
 * to the squatter. And it does not retry — a boot-time convenience that fights a real fault in a
 * loop is worse than one that reports it.
 *
 * It goes through the console's own HTTP surface rather than importing the launcher, so there is
 * exactly one code path that opens a browser and one place that decides whether it is allowed.
 *
 * Opt out with REDBOT_NO_AUTO_BROWSER=1.
 */
/**
 * The handles whose browsers THIS process opened, and the port to reach the console on.
 *
 * Recorded so the quit handler can close exactly those and nothing else. A browser the operator
 * started themselves is not in here and is never touched.
 */
const bootOpened = [];
let consolePort = null;

/**
 * Close the browsers boot opened. Best effort, and bounded.
 *
 * A quit that hangs waiting on a browser is worse than a browser left running, so every request
 * carries its own timeout and a failure is logged rather than raised. The whole thing is also
 * capped by the caller: whatever has not finished when the deadline passes is abandoned and the
 * app exits.
 */
async function closeBootBrowsers() {
  /**
   * TIMED FOR WHAT A STOP ACTUALLY COSTS, and measured rather than guessed.
   *
   * The first version gave each stop 4s in sequence, and both timed out on a real quit —
   * "NOT closed — The operation was aborted due to timeout" for two browsers that were then
   * abandoned exactly as before. Stopping is not a cheap call: `stopAccountBrowser` proves the
   * process is redbot's own from its `--user-data-dir` before killing it, and src/ports.ts
   * measures that inspection at roughly 6.8s for three ports on an idle machine. A stop that
   * trusted the port number instead would be instant and would sometimes terminate Lenovo
   * Vantage, so the cost is the point, not an inefficiency to trim.
   *
   * IN PARALLEL for the same reason. Sequential stops pay that inspection once per account;
   * fired together they overlap, so the wall clock is one inspection rather than N — which is
   * what makes a real timeout affordable in a quit path.
   */
  const deadline = new Promise((r) => setTimeout(r, 20_000).unref?.());
  const work = Promise.allSettled(bootOpened.map(async (handle) => {
    try {
      const res = await fetch(`http://127.0.0.1:${consolePort}/api/account/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle }),
        signal: AbortSignal.timeout(15_000)
      });
      const out = await res.json().catch(() => ({}));
      boot_log(out && out.ok
        ? `browsers    ${handle} closed on the way out`
        : `browsers    ${handle} NOT closed — ${(out && out.error) || `HTTP ${res.status}`}`);
    } catch (e) {
      boot_log(`browsers    ${handle} NOT closed — ${e && e.message ? e.message : e}`);
    }
  }));
  await Promise.race([work, deadline]);
}

async function openBoundBrowsers(port) {
  consolePort = port;
  if (process.env.REDBOT_NO_AUTO_BROWSER === '1') {
    boot_log('browsers    skipped — REDBOT_NO_AUTO_BROWSER=1');
    return;
  }

  const base = `http://127.0.0.1:${port}`;
  let browsers;
  try {
    const res = await fetch(`${base}/api/pulse`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`pulse answered ${res.status}`);
    browsers = (await res.json()).browsers;
  } catch (e) {
    boot_log(`browsers    could not be checked — ${e && e.message ? e.message : e}`);
    return;
  }

  if (!Array.isArray(browsers) || !browsers.length) {
    boot_log('browsers    none bound to this machine');
    return;
  }

  for (const b of browsers) {
    /* 'ours' is the only state worth skipping — that Chrome is already open. Everything else is
       handed to /api/account/open, which re-checks authoritatively and, since 2026-08-01, MOVES an
       account off a port another program is holding rather than refusing. Deciding here which
       states are openable would be a second copy of that rule, and the two would disagree. */
    if (b.state === 'ours') { boot_log(`browsers    ${b.handle} already open on ${b.port}`); continue; }

    try {
      const res = await fetch(`${base}/api/account/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        /* Off-screen: boot opens a window per account, and two Chromes taking the screen on every
           launch is the interruption this whole feature was meant to remove. Headed, never
           headless — Reddit block-pages a headless browser with a 200. See launchChrome. */
        body: JSON.stringify({ handle: b.handle, background: true }),
        signal: AbortSignal.timeout(30_000)
      });
      const out = await res.json().catch(() => ({}));
      /* Recorded ONLY on a real open. `alreadyRunning` means the browser was already there when
         boot looked — this process did not start it, so this process must not close it. */
      if (out && out.ok && !out.alreadyRunning) {
        bootOpened.push(b.handle);
        /* Minimise it, once it is answering. Chrome has no start-minimised flag, so this is a CDP
           call and CDP is not up the instant the process starts — hence the wait-and-retry. Failure
           is logged and ignored: a window that stayed open is a nuisance, not a fault. */
        void (async () => {
          const endpoint = `http://127.0.0.1:${out.port ?? b.port}`;
          const { minimizeBrowserWindow } = await import('../dist/browser.js');
          for (let i = 0; i < 12; i++) {
            const r = await minimizeBrowserWindow(endpoint).catch(() => ({ ok: false, reason: 'threw' }));
            if (r.ok) { boot_log(`browsers    ${b.handle} minimised`); return; }
            await new Promise((res) => setTimeout(res, 1000));
          }
          boot_log(`browsers    ${b.handle} could not be minimised — left as it opened`);
        })();
      }
      boot_log(out && out.ok
        ? `browsers    ${b.handle} opened on ${out.port ?? b.port}${out.movedFrom ? ` (moved off ${out.movedFrom} — another program had it)` : ''}`
        : `browsers    ${b.handle} NOT opened — ${(out && out.error) || `HTTP ${res.status}`}`);
    } catch (e) {
      boot_log(`browsers    ${b.handle} NOT opened — ${e && e.message ? e.message : e}`);
    }
  }
}

async function boot() {
  /* Working state, before ANYTHING imports src/config.ts — which freezes DATA at module load. */
  const userData = app.getPath('userData');
  try { mkdirSync(userData, { recursive: true }); } catch { /* reported by the first real write */ }
  logFile = join(userData, 'boot.log');
  boot_log(`--- boot --- electron ${process.versions.electron} node ${process.versions.node}`);
  boot_log(`userData   ${userData}`);
  /**
   * A SOURCE RUN USES THE CHECKOUT'S DATA, not the installed app's.
   *
   * `userData/data` is right for an install — the install directory is read-only and replaced by
   * an update, so working state has to live per-user. It is wrong for `npm start`, and quietly so:
   * an unpackaged run is still named "redbot", so it resolved to `%APPDATA%\redbot\data` — the
   * LIVE app's store. Measured 2026-08-03: a source run booted onto the live store and reported
   * "browsers none bound to this machine", because the accounts, the 20 collected threads and the
   * pending draft were all in the checkout while the app was reading somewhere else. Nothing was
   * broken; it was looking in the wrong place and said so in a way that reads like a fault.
   *
   * It also meant source and live shared a single-instance lock, so the two could not run at once.
   *
   * This is the same trap `app.setName` had for the dev build — two builds silently sharing one
   * store — and it gets the same answer: the build that is running decides where its data lives.
   * An explicit REDBOT_DATA still wins, which is what the smoke suite relies on.
   */
  if (!process.env.REDBOT_DATA) {
    process.env.REDBOT_DATA = app.isPackaged ? join(userData, 'data') : join(ROOT, 'data');
  }
  boot_log(`REDBOT_DATA ${process.env.REDBOT_DATA}`);

  /* The master key, into this process's environment so the CLI children inherit it. Never fatal
     on its own: an app that will not open because a key is missing cannot be used to fix the key,
     and the console's Setup screen is the only place a person can. */
  let keySource = 'unavailable';
  try {
    keySource = ensureVaultKey({
      safeStorage,
      userData,
      envValue: (await import('../dist/db.js')).envValue
    }).source;
  } catch (e) {
    bootError = e instanceof Error ? e.message : String(e);
  }

  /* Directories, and the schema. The provisioner is idempotent and runs on every launch. */
  boot_log(`vault key   ${keySource}${bootError ? ` (${bootError})` : ''}`);

  const { provision } = await import('../dist/provision.js');
  const report = await provision();
  boot_log(`data root   ${report.dataRoot}`);
  boot_log(`database    ${report.databaseFile}`);
  boot_log(`schema      ${report.schema ? report.schema.detail : 'not checked'}`);
  boot_log(`dirs        ${report.created.length} created · ${report.present.length} present`);
  for (const n of report.notes) boot_log(`note        ${n}`);

  const port = await freePort();
  boot_log(`port        ${port}`);
  serverChild = await startServer(port, process.env);
  boot_log('console     listening');

  win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 380,
    backgroundColor: '#000000',   // matches the console's --bg, so there is no white flash
    title: 'redbot',
    show: false,
    webPreferences: {
      /* The page does not need Node and must not have it: it talks to its own server over fetch,
         exactly as it does in a browser. Turning any of these off would hand the renderer more
         authority than the design gives it. */
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(HERE, 'preload.cjs')
    }
  });

  /* The menu template stays registered for its accelerators; the bar itself never appears.
     See the Menu.setApplicationMenu block below for why both calls are needed. */
  win.setAutoHideMenuBar(true);
  win.setMenuBarVisibility(false);

  win.once('ready-to-show', () => win.show());

  /* Registered BEFORE the page loads: the Setup screen asks for a snapshot as soon as it renders,
     and a handler attached after loadURL would miss that first call and leave the card blank. */
  /**
   * ONLY THE LIVE BUILD UPDATES ITSELF.
   *
   * The feed is baked in at build time and names one repo, so a side-by-side variant like
   * `redbot dev` would check it, find the live release, and offer an "update" that installs a
   * DIFFERENT APPLICATION next to it — different appId, different userData, its own database.
   * The button would appear to work and would quietly produce the second install this split
   * exists to make legible.
   *
   * A variant is updated by building it again, which is the point of having one.
   */
  wireUpdater(port);

  await win.loadURL(`http://127.0.0.1:${port}/`);

  /* Deliberately AFTER loadURL and deliberately not awaited: opening two Chromes takes seconds,
     and the window must not wait on them. Whatever it achieves is reported through /api/setup on
     the next poll like any other state. */
  void openBoundBrowsers(port);

  if (bootError) {
    if (!process.env.REDBOT_NO_DIALOGS) dialog.showMessageBox(win, {
      type: 'warning',
      title: 'redbot — the secrets vault is not available',
      message: bootError,
      detail: 'The app has opened. Stored secrets cannot be read until this is resolved; the Setup screen explains what is missing.'
    });
  }

  /* A link to Reddit belongs in the operator's own browser, not in this window. Without this,
     clicking one navigates the console away and there is no address bar to get back. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on('closed', () => { win = null; });
}

/**
 * One instance. Two would each start a server and drive the same account's Chrome, and the
 * database would serialise their writes while they disagreed about what was running.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(boot).catch((e) => {
    /**
     * Fail closed and VISIBLY. A window that never appears is indistinguishable from a hung
     * machine, and this is the one moment there is no console to report through.
     *
     * `dialog.showErrorBox` is MODAL AND SYNCHRONOUS, and that bit me: with nobody to click OK it
     * blocks forever, so an automated run hung for three minutes instead of failing in thirty
     * seconds with a reason. The log is written FIRST, and the dialog is skipped entirely when
     * there is no human — which is what `ELECTRON_ENABLE_LOGGING`/CI-style runs and the smoke
     * test are. The exit code still carries the failure.
     */
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    boot_log(`FAILED TO START\n${msg}`);
    process.stderr.write(`redbot failed to start:\n${msg}\n`);
    if (!process.env.REDBOT_NO_DIALOGS) {
      dialog.showErrorBox('redbot could not start', msg.slice(0, 2000));
    }
    app.exit(1);
  });

  app.on('window-all-closed', () => app.quit());

  /**
   * On the way out: close the browsers WE opened, then the server child.
   *
   * THE LEAK THIS FIXES. Boot opens a Chrome per account, detached — deliberately, because a
   * browser must survive the console crashing. Nothing then closed them. Measured on the
   * development machine after a few restarts: FOUR browser instances, 39 processes, 3.6 GB, two
   * of them belonging to an app that was no longer running. They also keep holding their debug
   * ports, so the next launch finds them `foreign` and reallocates — the ports walk upward
   * (9223 → 9222 → 9225) one restart at a time, and the windows pile up in the taskbar.
   *
   * ONLY THE ONES BOOT OPENED. `bootOpened` is recorded by openBoundBrowsers, so a browser the
   * operator started themselves — from the Accounts screen, or by hand — is left alone. redbot
   * cleans up after itself and does not tidy away somebody else's window.
   *
   * It goes through /api/account/stop, which proves ownership from the process's own
   * --user-data-dir before killing anything (src/ports.ts). A "stop" that trusted the port number
   * would terminate whatever answered — which on this machine is sometimes Lenovo Vantage.
   *
   * ASYNC IN before-quit needs the dance below: preventDefault, do the work, quit again. The
   * `quitting` guard is what stops the second pass repeating it, and the server child is killed
   * only on that second pass — killing it first would take away the API this needs.
   */
  let quitting = false;
  app.on('before-quit', (e) => {
    if (!quitting && bootOpened.length && consolePort) {
      e.preventDefault();
      quitting = true;
      closeBootBrowsers().finally(() => app.quit());
      return;
    }
    if (serverChild && serverChild.exitCode === null) {
      try { serverChild.kill(); } catch { /* already gone */ }
    }
  });
}

/**
 * A menu that exists but is never shown.
 *
 * The bar itself was two words — "redbot  Edit" — sitting above a console that is its own
 * navigation, on every screen, for the life of the window. It said nothing the app does not say
 * better, and it made the window look like a document viewer.
 *
 * IT IS HIDDEN RATHER THAN DELETED, and that distinction is the whole reason this is not a
 * one-line removal. On Windows, `Menu.setApplicationMenu(null)` also unregisters the accelerators
 * the roles carry — Ctrl+C, Ctrl+V, Ctrl+A stop working in the console's own text fields, which
 * is where an operator pastes a profile path, a dashboard endpoint and a token. `Ctrl+R` for
 * reload goes with it. So the template stays and the BAR is hidden instead: `setMenuBarVisibility`
 * takes it off screen, and `setAutoHideMenuBar` stops Alt bringing it back.
 *
 * Both calls are needed. Visibility alone leaves Alt as a way to summon it, which is a surprise
 * rather than a feature on a window with no menu-driven actions.
 */
Menu.setApplicationMenu(Menu.buildFromTemplate([
  {
    label: 'redbot',
    submenu: [
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  },
  { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }
]));
