/**
 * ALREADY OPEN IS NOT ALREADY DONE — the branch in `launchChrome`, driven.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * `launchChrome` used to answer an account whose Chrome was already up and ours by returning
 * `{ ok: true, alreadyRunning: true }` from above every step that follows — the exit, the
 * detection, the persistence, both country checks, the cover and the WebRTC fence. This release's
 * headline fix turned that return into a FLAG. Migration 0018 is what made the gap a trap: it
 * sets every `accounts.timezone` NULL, and the only production code that writes one back is the
 * detect-then-persist path, so an account whose browser happened to be open could never become
 * schedulable again and the remedy was written down nowhere a person would find it.
 *
 * Measured on d381154: `launchChrome` ran ONCE in the whole 1202-test suite and died at its
 * "is not set up" refusal, three lines in, so the branch executed zero times. Restoring the exact
 * early return left the suite green — the fix was held by nothing.
 *
 * browser-start-open.test.mjs covers what `startAlignedBrowser` does once it is TOLD
 * `weSpawnedIt: false`. Nothing covered `launchChrome` deciding to tell it that, which is the
 * line the mutation reverts, and it is only reachable through the server.
 *
 * ---------------------------------------------------------------------------
 * HOW AN "ALREADY RUNNING, AND OURS" BROWSER IS PRODUCED WITHOUT A BROWSER
 *
 * Ownership is not "something answers CDP on the port" — that is exactly what the Lenovo Vantage
 * WebView does, and src/ports.ts refuses to treat it as evidence. Ownership is the process table:
 * a process listening on the account's port whose command line names that account's own profile
 * folder (`ss -lntpH` -> /proc/<pid>/cmdline -> userDataDirFrom -> sameDir).
 *
 * So the stand-in below is a real process, listening on the real port, with the real
 * `--user-data-dir=` in its argv, answering `/json/version` — every fact `statusForAccounts`
 * consults, and no more. That is what makes `live.ours` true, which is the only precondition the
 * branch under test has.
 *
 * WHY THE STAND-IN ANNOUNCES A HEADLESS USER-AGENT. The launch then runs the whole measurement
 * order and stops at step 2, because `attach()` refuses a headless browser — Reddit answers one
 * with a block page served as HTTP 200. That refusal is DETERMINISTIC (a regex over the UA the
 * stand-in serves), costs two HTTP round-trips, needs no network and no real Chrome, and is a
 * genuine production path rather than a fault invented for the test.
 *
 * AND A REFUSAL IS THE RIGHT EVIDENCE HERE, not a weaker one. What has to be proven is that the
 * already-open browser REACHED the measurement, and the refusal says so in two independent ways
 * that the early return cannot produce:
 *
 *   1. its text is step 2's, so the order ran rather than being returned from above;
 *   2. it ends with the `weSpawnedIt: false` sentence — "redbot did not open this browser, so it
 *      has been left open and unchanged" — which is reached only when `alreadyRunning` was true
 *      AND the function carried on past it.
 *
 * The third instrument is the Chrome that was never started: CHROME_PATH points at a recorder, so
 * "the spawn was skipped" is a file that does not exist rather than an inference.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/** REDBOT_DB reaches the child through process.env, set by `--env-file=db/sqlite/.env.test`. */
const CHILD_ENV = { ...process.env };

/** The one handle this file creates. Removed before and after, so a re-run starts clean. */
const HANDLE = 'Already_Open_Acct';

/**
 * A Chrome stand-in that holds the port and names the profile — nothing else.
 *
 * Written to a throwaway directory rather than committed beside this file, because what makes it
 * work is its ARGV and its listening socket, and both of those are set up here where they can be
 * read next to the assertions they serve.
 */
const STAND_IN = `
import { createServer } from 'node:http';
const arg = (n) => (process.argv.find((a) => a.startsWith(n + '=')) || '').slice(n.length + 1);
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  if ((req.url || '').startsWith('/json/version')) {
    return res.end(JSON.stringify({
      Browser: 'Chrome/153.0.8010.52',
      'Protocol-Version': '1.3',
      'User-Agent': arg('--announce-ua')
    }));
  }
  res.end('[]');
}).listen(Number(arg('--remote-debugging-port')), '127.0.0.1', () => console.log('STAND-IN-UP'));
`;

/** What the stand-in says it is. `isHeadlessUA` in src/browser.ts matches /headless/i. */
const HEADLESS_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
                  + 'HeadlessChrome/153.0.0.0 Safari/537.36';

let child = null;
let standIn = null;
let PORT = 0;
let DATA = '';
let BIN = '';
let chromeLog = '';
let pool = null;
let childErr = '';

/** Ask the OS for a port, then hand it to the console — the console has no --port 0 story. */
const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

async function clearTestAccount() {
  const { getPool } = await import('../../dist/db.js');
  pool = getPool();
  await pool.query('DELETE FROM accounts WHERE lower(handle) = $1', [HANDLE.toLowerCase()]);
}

const post = async (path, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
};

before(async () => {
  await clearTestAccount();
  PORT = await freePort();
  DATA = mkdtempSync(join(tmpdir(), 'redbot-already-open-data-'));
  BIN = mkdtempSync(join(tmpdir(), 'redbot-already-open-bin-'));

  /**
   * CHROME, REPLACED BY SOMETHING THAT ONLY RECORDS BEING RUN.
   *
   * `chromeBinary()` takes REDBOT_CHROME first, so this is the binary `launchChrome` would spawn.
   * The account under test must not cause a spawn at all, and the difference between "no window
   * opened" and "a window opened somewhere nobody looked" is a file that does or does not exist.
   */
  chromeLog = join(BIN, 'chrome-was-run.log');
  const recorder = join(BIN, 'chrome-recorder.sh');
  writeFileSync(recorder, `#!/bin/sh\necho "$@" >> ${chromeLog}\nexit 0\n`, 'utf8');
  chmodSync(recorder, 0o755);

  child = spawn(process.execPath, [join(ROOT, 'tools', 'product', 'server.mjs'), '--port', String(PORT)], {
    cwd: ROOT,
    env: { ...CHILD_ENV,
           REDBOT_DATA: DATA,
           REDBOT_CHROME: recorder,
           /* The update check must not spend the real repository's unauthenticated rate limit. */
           REDBOT_UPDATE_REPO: 'redbot-tests/does-not-exist-9f3a' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => { childErr += d; });

  let banner = '';
  await new Promise((res, rej) => {
    const timer = setTimeout(
      () => rej(new Error(`console did not start in 20s. stdout: ${banner} stderr: ${childErr}`)), 20_000);
    child.stdout.on('data', (d) => {
      banner += String(d);
      if (banner.includes(`${PORT}`)) { clearTimeout(timer); res(); }
    });
    child.on('error', (e) => { clearTimeout(timer); rej(e); });
    child.on('exit', (code) => { clearTimeout(timer); rej(new Error(`console exited ${code}: ${childErr}`)); });
  });
}, { timeout: 60_000 });

after(async () => {
  try { standIn?.kill('SIGKILL'); } catch { /* already gone */ }
  try { child?.kill(); } catch { /* already gone */ }
  try { rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ }
  try { rmSync(BIN, { recursive: true, force: true }); } catch { /* best effort */ }
  try { await clearTestAccount(); } catch { /* best effort */ }
  try { const { closePool } = await import('../../dist/db.js'); await closePool(); } catch { /* ditto */ }
}, { timeout: 30_000 });

test('a browser that is already open and ours is MEASURED, not waved through', async () => {
  const made = await post('/api/account/create', {
    handle: HANDLE, role: 'support desk', speaks: 'error messages', subreddits: ['WordPress']
  });
  assert.equal(made.status, 200, `setup failed: ${JSON.stringify(made.body)}`);
  const account = made.body.account;

  /* The folder ownership is decided by. `resolveProfileDir` joins a relative one onto the data
     root, and this account's is relative because the console made it. */
  const profileAbs = join(DATA, account.profileDir);
  mkdirSync(profileAbs, { recursive: true });

  const standInPath = join(BIN, 'already-running-chrome.mjs');
  writeFileSync(standInPath, STAND_IN, 'utf8');
  standIn = spawn(process.execPath, [
    standInPath,
    `--remote-debugging-port=${account.debugPort}`,
    `--user-data-dir=${profileAbs}`,
    `--announce-ua=${HEADLESS_UA}`
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  standIn.stdout.setEncoding('utf8');
  let standInErr = '';
  standIn.stderr.setEncoding('utf8');
  standIn.stderr.on('data', (d) => { standInErr += d; });
  await new Promise((res, rej) => {
    const timer = setTimeout(
      () => rej(new Error(`the stand-in never took port ${account.debugPort}: ${standInErr}`)), 15_000);
    standIn.stdout.on('data', (d) => {
      if (String(d).includes('STAND-IN-UP')) { clearTimeout(timer); res(); }
    });
  });

  const opened = await post('/api/account/open', { handle: HANDLE });

  /**
   * THE ASSERTION THE EARLY RETURN CANNOT SATISFY.
   *
   * `{ ok: true, alreadyRunning: true }` was the defect, and it is what a reverted `launchChrome`
   * answers here — a successful open, of a browser nothing had measured, forwarded to the console
   * unchanged.
   */
  assert.equal(opened.body.ok, false,
    'an already-open browser was reported as successfully opened without being measured — this is '
    + `the alreadyRunning early return: ${JSON.stringify(opened.body)}`);
  assert.equal(opened.body.verified, undefined,
    'nothing was verified, so nothing may say it was');

  /* IT REACHED STEP 2. The text belongs to startAlignedBrowser's detection step, which sits
     below everything the early return skipped. */
  assert.match(opened.body.error, /could not establish where .* browser is/,
    `the launch never reached the detection step: ${opened.body.error}`);

  /**
   * AND IT GOT THERE ON THE ALREADY-OPEN PATH.
   *
   * This sentence is reached only through `weSpawnedIt: false`, which is `!alreadyRunning`. Its
   * presence is therefore proof that the flag was true AND that the function carried on past it
   * rather than returning — the two halves of the fix, in one string.
   */
  assert.match(opened.body.error, /did not open this browser, so it has been left open and unchanged/,
    'the refusal did not come from the already-open path, so `alreadyRunning` was not what drove '
    + `it: ${opened.body.error}`);

  /* AND NOTHING WAS SPAWNED. A second, independent reading of the same flag: `if (!alreadyRunning)`
     guards the spawn, so a Chrome that was never run is the file below never existing. */
  assert.equal(existsSync(chromeLog), false,
    `a browser was launched for an account whose browser was already open: ${
      existsSync(chromeLog) ? readFileSync(chromeLog, 'utf8') : ''}`);
});
