/**
 * END TO END, against a REAL already-running Chrome.
 *
 * A throwaway profile on the Xvfb display, started BEFORE redbot is asked to open it, with three
 * tabs of its own so the multi-tab question is answered by measurement rather than by reading
 * alignBrowser and reasoning about it.
 *
 * Never an account profile, never the live database: the profile is an mktemp dir, the data root
 * is an mktemp dir, and the rows are read back from a COPY of the test database taken with all
 * three SQLite files together.
 *
 * Run:  node --env-file=db/sqlite/.env.test tools/product/e2e-open-browser.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { mkdtempSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
/**
 * SPAWNED=1 runs the CONTROL: redbot opens the browser itself, exactly as it always did.
 *
 * It is here because the 13 tests in browser-start.test.mjs inject `cover`, so not one of them
 * drives the real alignBrowser — and alignBrowser is a file this change touched. Asserting "the
 * spawned path is unchanged" against a suite that never runs the changed code would be the sort
 * of green that means nothing. This runs it.
 */
const SPAWNED = process.env.SPAWNED === '1';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const DISPLAY = process.env.DISPLAY || ':99';

const log = (...a) => console.log(...a);
const ok = (cond, msg) => {
  log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) process.exitCode = 1;
  return cond;
};

const freePort = () => new Promise((res, rej) => {
  const s = netServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

const waitFor = async (fn, ms, what) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch { /* keep trying */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${what}`);
};

const DATA = mkdtempSync(join(tmpdir(), 'rb-e2e-data-'));
const COPY = mkdtempSync(join(tmpdir(), 'rb-e2e-dbcopy-'));
/* Filled in once the account exists: its OWN profile folder, under the throwaway data root.
   Ownership is the user-data-dir and nothing else (src/ports.ts), so this is the one value that
   has to agree for the already-running browser to be judged ours. */
let PROFILE_DIR = null;
process.env.REDBOT_DATA = DATA;

let chrome = null;
let console_ = null;
let pages = null;

try {
  /* ---- 1. three real pages for the browser to already be sitting on ---- */
  const tabPort = await freePort();
  pages = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>tab ${req.url}</title><body>tab ${req.url}`);
  });
  await new Promise((r) => pages.listen(tabPort, '127.0.0.1', r));

  /* ---- 2. the account claims the port BEFORE anything binds it.
        changeAccountPort refuses a port already in use — correctly, since its job is to hand out
        one Chrome can actually take — so the record is written first and Chrome takes it after. ---- */
  const chromePort = await freePort();
  const accounts = await import(join(ROOT, 'dist/console-accounts.js'));
  const db = await import(join(ROOT, 'dist/db.js'));
  if (db.dbUnavailableReason()) throw new Error(`no database: ${db.dbUnavailableReason()}`);

  const handle = 'e2e_open_probe';
  await db.getPool().query('DELETE FROM accounts WHERE lower(handle) = lower($1)', [handle]);
  const made = await accounts.createConsoleAccount({ handle, role: 'Support', speaks: '', subreddits: [] });
  if (!made.ok) throw new Error(`createConsoleAccount: ${made.error}`);
  const moved = await accounts.changeAccountPort({ handle, port: chromePort });
  if (!moved.ok) throw new Error(`changeAccountPort: ${moved.error}`);

  /* The account's OWN profile folder, resolved the way ports.ts resolves it when it decides
     whether a running browser is ours. Ownership is the user-data-dir and nothing else, so this
     is the one value that has to agree. It sits under the throwaway REDBOT_DATA. */
  const known = await accounts.knownAccounts();
  const rec = known.find((x) => x.handle.toLowerCase() === handle.toLowerCase());
  if (!rec || !rec.profileDir) throw new Error(`no profileDir on the new account: ${JSON.stringify(rec)}`);
  const profiles = await import(join(ROOT, 'dist/profiles.js'));
  PROFILE_DIR = profiles.resolveProfileDir(DATA, rec.profileDir);
  log(`account ${handle}: port ${chromePort}, profile ${PROFILE_DIR}`);

  /* ---- 3. START CHROME, unless this is the spawned control, in which case redbot opens it. ---- */
  if (SPAWNED) {
    log('\nSPAWNED CONTROL: not starting Chrome — redbot opens it itself, as it always did.');
  } else {
  chrome = spawn(CHROME, [
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run', '--no-default-browser-check',
    `http://127.0.0.1:${tabPort}/one`,
    `http://127.0.0.1:${tabPort}/two`,
    `http://127.0.0.1:${tabPort}/three`
    /**
     * THE BROWSER IS STARTED IN A DIFFERENT ZONE FROM THE ONE IT WILL MEASURE, ON PURPOSE.
     *
     * This machine's own zone is America/Los_Angeles and it egresses from San Jose, so the
     * detection returns America/Los_Angeles too. Reading a tab back and finding that zone would
     * therefore prove NOTHING — an un-overridden tab reports exactly the same string, and the
     * probe cannot tell the two apart. It is a dead instrument that always reads "covered".
     *
     * TZ=Asia/Manila makes the two differ: a tab that got Emulation.setTimezoneOverride says
     * America/Los_Angeles, and a tab that did not says Asia/Manila. Now the reading discriminates.
     */
  ], { env: { ...process.env, DISPLAY, TZ: 'Asia/Manila' }, detached: true, stdio: 'ignore' });
  chrome.unref();

  await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).ok,
    30_000, 'the throwaway Chrome to answer CDP');
  const targets = await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json();
  const tabs = targets.filter((t) => t.type === 'page');
  log(`\nchrome up on ${chromePort}, profile ${PROFILE_DIR}`);
  log(`tabs open BEFORE redbot is asked: ${tabs.length}`);
  for (const t of tabs) log(`   - ${t.url}`);
  ok(tabs.length >= 3, `the browser really has ${tabs.length} tabs of the operator's own`);
  }

  /* The zone starts NULL, exactly as 0018 leaves every account. */
  const before = await db.getPool().query(
    'SELECT timezone FROM accounts WHERE lower(handle) = lower($1)', [handle]);
  log(`\naccounts.timezone BEFORE: ${JSON.stringify(before.rows[0].timezone)}`);
  ok(before.rows[0].timezone === null, 'the account starts with the NULL zone 0018 left it');

  /* ---- 4. the real console, and the real HTTP handler ---- */
  const consolePort = await freePort();
  console_ = spawn(process.execPath, [join(ROOT, 'tools/product/server.mjs'), '--port', String(consolePort)],
    { cwd: ROOT, env: { ...process.env, REDBOT_DATA: DATA, CHROME_PATH: CHROME, DISPLAY,
                        REDBOT_UPDATE_REPO: 'redbot-tests/does-not-exist-9f3a' },
      stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  console_.stderr.setEncoding('utf8');
  console_.stderr.on('data', (d) => { err += d; });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${consolePort}/api/state`)).ok,
    20_000, 'the console to start');

  /* THE CALL. Same endpoint the Accounts screen's button uses. */
  log('\nPOST /api/account/open   (the browser is ALREADY running)');
  const res = await fetch(`http://127.0.0.1:${consolePort}/api/account/open`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle }), signal: AbortSignal.timeout(120_000)
  });
  const out = await res.json();
  log(`HTTP ${res.status}`);
  log(JSON.stringify(out, null, 2));
  if (err.trim()) log(`\n[console stderr]\n${err.trim()}`);

  /* ---- 5. what the response must carry ---- */
  log('');
  ok(out.ok === true, 'the open succeeded');
  ok(out.alreadyRunning === (SPAWNED ? undefined : true),
    SPAWNED ? 'a browser redbot opened is NOT reported as already running'
            : 'and it still reports that the browser was already up');
  ok(out.verified === true, 'VERIFIED — the browser was measured, not waved through');
  ok(typeof out.timezone === 'string' && out.timezone.length > 2,
    `a MEASURED timezone came back: ${JSON.stringify(out.timezone)}`);
  ok(!!out.location && typeof out.location.locationId === 'number',
    `the measurement was persisted as row ${out.location && out.location.locationId}`);
  ok(typeof out.pagesAligned === 'number', `pagesAligned reported: ${out.pagesAligned}`);

  /* ---- 6. read the row back from a COPY of the database, all three files together ---- */
  const dbPath = resolve(ROOT, process.env.REDBOT_DB);
  await db.getPool().query('PRAGMA wal_checkpoint(TRUNCATE)');
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, join(COPY, 'redbot-test.db' + suffix));
  }
  log(`\ncopied the test database (db + wal + shm) to ${COPY}`);

  process.env.REDBOT_DB = join(COPY, 'redbot-test.db');
  const { default: Database } = await import('node:sqlite').then((m) => ({ default: m.DatabaseSync }));
  const copy = new Database(join(COPY, 'redbot-test.db'), { readOnly: true });
  const zone = copy.prepare('SELECT timezone FROM accounts WHERE lower(handle) = lower(?)').get(handle);
  const row = copy.prepare(
    'SELECT timezone, ip, country_code, city, via, transport FROM account_locations '
    + 'WHERE lower(handle) = lower(?) ORDER BY id DESC LIMIT 1').get(handle);
  log(`\nFROM THE COPY — accounts.timezone: ${JSON.stringify(zone && zone.timezone)}`);
  log(`FROM THE COPY — account_locations: ${JSON.stringify(row)}`);
  ok(!!zone && zone.timezone !== null, 'the zone column moved off NULL — the account is schedulable again');
  ok(!!row, 'an account_locations row exists — the measurement is on record');
  ok(!!row && row.via === 'launch', 'and it is filed under the launch occasion');
  copy.close();

  /* ---- 7. DID EVERY TAB GET COVERED. The multi-tab question, measured. ---- */
  const { chromium } = await import('playwright');
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${chromePort}`, { timeout: 20_000 });
  const ctx = b.contexts()[0];
  /* Captured ONCE, before the browser is closed — ctx.pages() reads 0 after close, which silently
     turned "3 of 3" into "3 of 0" and made the assertion unreadable. */
  const open = ctx.pages();
  log(`\nreading each tab back (${open.length} pages). `
    + `browser default zone Asia/Manila, measured zone ${out.timezone} — they differ, so this reads:`);
  let covered = 0;
  let fenced = 0;
  for (const p of open) {
    const seen = await p.evaluate(() => ({
      url: location.href,
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      rtc: (() => { try { new RTCPeerConnection(); return 'ALLOWED'; } catch { return 'blocked'; } })()
    })).catch((e) => ({ url: p.url(), zone: `err ${e.message}`, rtc: 'err' }));
    const hit = seen.zone === out.timezone;
    if (hit) covered++;
    if (seen.rtc === 'blocked') fenced++;
    log(`   ${hit ? 'covered' : 'NOT covered'} | rtc ${seen.rtc} | ${seen.zone} | ${seen.url}`);
  }
  const urlsNow = open.map((p) => p.url());
  await b.close();
  ok(covered === open.length,
    `every tab announces the MEASURED zone, not the browser's own (${covered}/${open.length})`);
  ok(fenced === open.length,
    `every tab has the WebRTC fence (${fenced}/${open.length})`);
  ok(out.pagesAligned === open.length,
    `and pagesAligned agrees with what the tabs actually report (${out.pagesAligned}/${open.length})`);
  ok(out.pagesAligned >= 1,
    `the real alignBrowser covered at least one page (${out.pagesAligned}) — the spawned path still works`);

  /* WHERE IT ENDED UP. The spawned path navigates to Reddit last; the already-running path leaves
     the operator's tabs exactly where they were. Read off the live browser, not off the intent. */
  const urls = urlsNow;
  const wentToReddit = urls.some((u) => u.includes('reddit.com'));
  if (SPAWNED) {
    ok(wentToReddit, `the spawned browser was sent to Reddit last: ${urls.join(', ')}`);
  } else {
    ok(!wentToReddit, `the operator's tabs were left where they were: ${urls.join(', ')}`);
  }

} catch (e) {
  console.error(`\nE2E ERROR: ${e && e.stack || e}`);
  process.exitCode = 1;
} finally {
  try { if (chrome) process.kill(-chrome.pid, 'SIGTERM'); } catch { /* already gone */ }
  try { if (console_) console_.kill(); } catch { /* already gone */ }
  try { if (pages) pages.close(); } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 800));
  for (const d of [DATA, COPY]) rmSync(d, { recursive: true, force: true });
  log(`\ncleaned up ${DATA} (profile included), ${COPY}`);
}
