/**
 * What boot does while an account is opening, and what it does when it stops waiting.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SUITE EXISTS AT ALL.
 *
 * `openBoundBrowsers` had a 30 second budget written into it when `/api/account/open` spawned
 * Chrome and returned. It does not do that any more — it waits for the debug port, DETECTS where
 * the browser actually is, aligns it and only then answers — and the budget was never moved to
 * match. The result was not a slow boot, it was a WRONG one: `fetch` aborted on a launch that was
 * still succeeding, the handle never reached `bootOpened`, boot logged a failure for a browser
 * that opened perfectly well, and because nothing had recorded it, nothing closed it at quit.
 *
 * Two things therefore need pinning, and they fail differently:
 *
 *   1. THE NUMBER. A budget smaller than the launch it waits for is the defect, so the assertion
 *      is against the launch's own declared cost rather than against "30 seconds felt short".
 *   2. THE ABORT PATH. That one is only true once it has RUN, so it is driven end to end: a real
 *      HTTP console that never answers, the real `fetch`, the real `AbortSignal`, and the real
 *      reconciliation afterwards.
 *
 * WHY THERE IS A LOADER HOOK BELOW. electron/main.mjs is the app entry and imports `electron` for
 * its named exports. Under plain Node that module resolves to a CommonJS file whose only export is
 * a path string, so `import { app } from 'electron'` does not link and the file cannot be imported
 * at all — which is the reason main.mjs has never had a unit suite while updater.mjs, vault-key.mjs
 * and console-port.mjs all do. A resolve hook points `electron` at an inert stub, and the stub
 * returns FALSE from `requestSingleInstanceLock` so main.mjs takes its "another copy is already
 * running" branch and never calls `boot()`. Importing it therefore starts no server, opens no
 * window and touches no database — it just hands over the functions.
 * ---------------------------------------------------------------------------
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { register } from 'node:module';

/**
 * Enough of Electron for main.mjs to LOAD. Not enough for it to do anything, on purpose: every
 * member here is either inert or answers in the way that makes main.mjs stop early.
 */
const ELECTRON_STUB = `
  export const app = {
    isPackaged: true,
    setName() {},
    getPath: () => '/tmp',
    on() {},
    quit() {},
    /* FALSE is load-bearing: it sends main.mjs down the "second instance, quit" branch, which is
       the one path through the module that never reaches boot(). */
    requestSingleInstanceLock: () => false,
    whenReady: () => new Promise(() => {})
  };
  export class BrowserWindow {}
  export const shell = { openExternal() {} };
  export const dialog = { showErrorBox() {} };
  export const safeStorage = { isEncryptionAvailable: () => false };
  export const Menu = { setApplicationMenu() {}, buildFromTemplate: (t) => t };
  export const ipcMain = { handle() {}, on() {}, removeHandler() {} };
  export default { app };
`;

const RESOLVE_HOOK = `
  const STUB = ${JSON.stringify('data:text/javascript,' + encodeURIComponent(ELECTRON_STUB))};
  export async function resolve(specifier, context, next) {
    if (specifier === 'electron') return { url: STUB, shortCircuit: true };
    return next(specifier, context);
  }
`;
register('data:text/javascript,' + encodeURIComponent(RESOLVE_HOOK), import.meta.url);

/**
 * Destructured off the namespace rather than named-imported, and that is deliberate: a named
 * import of something main.mjs does not export is a LINK error that takes the whole file down
 * before a single test runs, which would report "cannot find export" instead of the assertion that
 * actually explains what is wrong. Off the namespace, a missing export arrives as `undefined` and
 * the assertion gets to speak.
 */
const main = await import('./main.mjs');
const {
  openBoundBrowsers, bootOpened, BOOT_OPEN_TIMEOUT_MS,
  PORT_WAIT_MS, DETECT_GOTO_MS, DETECT_FETCH_MS, ALIGN_CONNECT_MS, BOOT_OPEN_HEADROOM_MS
} = main;

/**
 * The three budgets a single launch is allowed to spend before it answers, read from the code that
 * spends them rather than from this file's opinion:
 *
 *   waitForDebugPort   tools/product/server.mjs   `ms = 30_000`, and browser-start.mjs calls it
 *                                                 with no argument, so the default IS the budget.
 *   page.goto          src/proxy/detect.ts        `DEFAULT_TIMEOUT_MS = 20_000`.
 *   the geo fetch      src/proxy/detect.ts        the same 20_000 again, spent independently.
 *
 * If any of those three moves, this number is what should fail first.
 */
const A_LAUNCH_MAY_TAKE = 30_000 + 20_000 + 20_000;

/**
 * A console that answers the two endpoints boot uses, and can be told to stop answering one of
 * them. `pulse` is a function rather than a value because the whole question here is what pulse
 * says AFTER the open request — a fixed body could not express a browser that came up late.
 */
async function fakeConsole({ pulse, open }) {
  const seen = { open: 0, pulse: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/pulse') {
      seen.pulse++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ browsers: pulse() }));
      return;
    }
    if (url.pathname === '/api/account/open' && req.method === 'POST') {
      seen.open++;
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => open(JSON.parse(raw || '{}'), res, req));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    seen,
    async stop() {
      /* A test that leaves a never-answered request open would hold the socket and the run. */
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
  };
}

/** boot_log writes to stdout, so that is where the evidence for "it said so out loud" comes from. */
async function capturingLog(fn) {
  const said = [];
  const real = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => { said.push(String(chunk)); return real(chunk, ...rest); };
  try { await fn(); } finally { process.stdout.write = real; }
  return said.join('');
}

/** `bootOpened` is module state shared by every test in here, so each one starts from empty. */
function freshBoot() { bootOpened.length = 0; }

/* ------------------------------------------------------------------ *
 * 1. The number.
 * ------------------------------------------------------------------ */

test('boot waits at least as long as a launch is allowed to take', () => {
  assert.equal(typeof BOOT_OPEN_TIMEOUT_MS, 'number',
    'the per-account budget has to be a value something can be asserted about');
  assert.ok(BOOT_OPEN_TIMEOUT_MS > A_LAUNCH_MAY_TAKE,
    `boot gives one account ${BOOT_OPEN_TIMEOUT_MS}ms, but a single launch is allowed `
    + `${A_LAUNCH_MAY_TAKE}ms before it has done anything wrong (30s for the debug port, then two `
    + `independent 20s budgets inside detection). A budget below that aborts launches that are `
    + `still succeeding, which is the whole defect.`);
});

test('the budget is a sum of the parts, so it cannot drift from what it waits for', () => {
  const parts = {
    PORT_WAIT_MS, DETECT_GOTO_MS, DETECT_FETCH_MS, ALIGN_CONNECT_MS, BOOT_OPEN_HEADROOM_MS
  };
  for (const [name, value] of Object.entries(parts)) {
    assert.equal(typeof value, 'number',
      `${name} must be a named part, not folded into a literal — the reason 30_000 was wrong is `
      + 'that it was a constant divorced from what it was waiting for');
  }
  assert.equal(BOOT_OPEN_TIMEOUT_MS, Object.values(parts).reduce((a, b) => a + b, 0),
    'the budget must BE the sum, or the parts are decoration and the number is magic again');

  /* Pinned against the real budgets. These fail on purpose the day detection's timeout moves. */
  assert.equal(PORT_WAIT_MS, 30_000, 'mirrors waitForDebugPort in tools/product/server.mjs');
  assert.equal(DETECT_GOTO_MS, 20_000, "mirrors detect.ts DEFAULT_TIMEOUT_MS, spent by page.goto");
  assert.equal(DETECT_FETCH_MS, 20_000, 'the same budget again, spent by the renderer geo fetch');
  assert.ok(BOOT_OPEN_HEADROOM_MS > 0,
    'the parts are the floor; a launch also spawns Chrome and may reallocate a port');
});

/* ------------------------------------------------------------------ *
 * 2. The abort path.
 * ------------------------------------------------------------------ */

test('THE POINT: a launch that outruns the budget is adopted, not written off', async () => {
  freshBoot();
  let asked = false;
  const console_ = await fakeConsole({
    /* Not ours before boot asks — otherwise it is skipped and never opened. Ours afterwards,
       which is exactly the state a launch that finished after we stopped listening leaves. */
    pulse: () => [{ handle: 'alice', port: 9222, state: asked ? 'ours' : 'free' }],
    open: () => { asked = true; /* never answers: this is the launch still working */ }
  });
  try {
    const said = await capturingLog(() => openBoundBrowsers(console_.port, { openTimeoutMs: 250 }));
    assert.equal(console_.seen.open, 1, 'boot has to have actually asked for the open');
    assert.deepEqual([...bootOpened], ['alice'],
      'the browser is up and THIS boot caused it, so quit must know to close it — otherwise it is '
      + 'left running and unowned, and the next boot skips it as `ours` forever');
    assert.equal(console_.seen.pulse, 2,
      'the adoption must come from ASKING the console again after the abort — one pulse to read '
      + 'the fleet, one to reconcile. Anything else means the handle was assumed rather than checked');
    assert.match(said, /alice/, 'and the handle has to appear in the log at all');
  } finally { await console_.stop(); }
});

test('a timeout says so out loud, even when there is nothing to adopt', async () => {
  freshBoot();
  const console_ = await fakeConsole({
    pulse: () => [{ handle: 'bob', port: 9223, state: 'free' }],
    open: () => { /* never answers, and the browser never comes up either */ }
  });
  try {
    const said = await capturingLog(() => openBoundBrowsers(console_.port, { openTimeoutMs: 250 }));
    assert.deepEqual([...bootOpened], [],
      'nothing came up, so there is nothing to close and nothing to claim');
    assert.ok(console_.seen.pulse > 1,
      'it still has to LOOK before writing the account off — a timeout is not evidence that the '
      + 'browser failed to start, only that boot stopped listening');
    assert.match(said, /bob/, 'the handle that failed has to be named');
    assert.match(said, /NOT opened/,
      'a timeout must not be swallowed — a person reading the boot log has to see it happened');
  } finally { await console_.stop(); }
});

test('an error that is NOT a timeout is still reported the way it always was', async () => {
  freshBoot();
  const console_ = await fakeConsole({
    pulse: () => [{ handle: 'carol', port: 9224, state: 'free' }],
    /* The SOCKET is destroyed, not the request stream — `req.destroy()` was measured not to reach
       the client at all, so the fetch sat there until it aborted and this test quietly became a
       second copy of the timeout test. Killing the socket rejects `fetch` with a plain network
       error, which is the branch actually under test here. */
    open: (_body, res) => { res.socket.destroy(); }
  });
  try {
    const said = await capturingLog(() => openBoundBrowsers(console_.port, { openTimeoutMs: 5_000 }));
    assert.deepEqual([...bootOpened], [], 'a request that never landed did not cause a browser');
    assert.equal(console_.seen.pulse, 1,
      'nothing was abandoned by this side, so there is no launch to go looking for — a reconcile '
      + 'here would be boot inventing a browser out of a failed request');
    assert.match(said, /carol.*NOT opened/,
      'the existing failure report is not collateral damage of the timeout fix');
  } finally { await console_.stop(); }
});

/* ------------------------------------------------------------------ *
 * 3. The two states that must stay different.
 * ------------------------------------------------------------------ */

test('`alreadyRunning` is still NOT recorded — this process did not start it', async () => {
  freshBoot();
  const console_ = await fakeConsole({
    pulse: () => [{ handle: 'dave', port: 9225, state: 'free' }],
    open: (_body, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, alreadyRunning: true, port: 9225 }));
    }
  });
  try {
    const said = await capturingLog(() => openBoundBrowsers(console_.port, { openTimeoutMs: 5_000 }));
    assert.deepEqual([...bootOpened], [],
      'the browser was already there when boot looked, so closing it at quit would be tidying '
      + "away somebody else's window — the timeout fix must not blur these two states together");
    assert.match(said, /dave.*opened/, 'it still reports the account as open');
  } finally { await console_.stop(); }
});

test('a browser already `ours` is skipped without an open request', async () => {
  freshBoot();
  const console_ = await fakeConsole({
    pulse: () => [{ handle: 'erin', port: 9226, state: 'ours' }],
    open: () => { throw new Error('boot must not ask to open a browser that is already ours'); }
  });
  try {
    const said = await capturingLog(() => openBoundBrowsers(console_.port, { openTimeoutMs: 5_000 }));
    assert.equal(console_.seen.open, 0, 'the `ours` skip is another builder ground — leave it working');
    assert.deepEqual([...bootOpened], [], 'boot did not open it, so boot does not close it');
    assert.match(said, /erin.*already open/);
  } finally { await console_.stop(); }
});
