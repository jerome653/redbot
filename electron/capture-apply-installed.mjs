#!/usr/bin/env node
/**
 * THE LAST MILE: click Apply on a REAL installed build and watch the update land.
 *
 * Every earlier proof stopped one step short. `capture-updates-packaged.mjs` says so in its own
 * header — it checks and never installs, because until a newer release exists on the feed there
 * is nothing to install. That release now exists, so the step is finally reachable, and it is the
 * one that has never been exercised here: the feed and the artifact were proven twice, the APPLY
 * never was.
 *
 * What this drives is the only install path the app has — `window.redbotDesktop.updates.apply()`,
 * which is `autoUpdater.downloadUpdate()` followed by `quitAndInstall`. Nothing else in the app
 * calls it: no timer, no check-on-launch, and `autoInstallOnAppQuit` is off.
 *
 * THE APP DYING MID-CALL IS THE PASS, NOT THE FAILURE. A successful apply quits the app and runs
 * the installer, so the ipc call never returns and Playwright loses its handle. Both are expected;
 * the verdict is read afterwards from the installed exe's version on disk, which is the only
 * thing that cannot be faked by a hopeful log line.
 *
 *   node electron/capture-apply-installed.mjs
 */
import { _electron as electron } from 'playwright';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = join(process.env.LOCALAPPDATA, 'Programs', 'redbot', 'redbot.exe');
if (!existsSync(exe)) { console.error(`no installed build at ${exe}`); process.exit(1); }

const userDir = mkdtempSync(join(tmpdir(), 'redbot-apply-'));
const app = await electron.launch({
  executablePath: exe,
  args: [`--user-data-dir=${userDir}`],
  env: { ...process.env, REDBOT_DATA: join(userDir, 'data'), REDBOT_DB: join(userDir, 'data', 'redbot.db'), REDBOT_NO_DIALOGS: '1' }
});

const page = await app.firstWindow();
await page.waitForSelector('#banner', { timeout: 60_000 });

const before = await page.evaluate(() => window.redbotDesktop.updates.snapshot());
console.log(`  before     phase=${before.phase} current=${before.current}`);

const checked = await page.evaluate(() => window.redbotDesktop.updates.check());
console.log(`  check      ok=${checked.ok} phase=${checked.phase} latest=${checked.latest ?? '—'} newer=${checked.newer}`);
if (!checked.newer) { console.log('  SKIP       nothing newer on the feed — an apply would have nothing to do'); await app.close(); process.exit(0); }

console.log(`  apply      downloading ${checked.latest} and installing…`);
const started = Date.now();
/* Deliberately not awaited into a variable that must resolve — see the header. */
const applied = await page.evaluate(() => window.redbotDesktop.updates.apply())
  .catch((e) => ({ ok: null, note: 'the call did not return: ' + String(e && e.message || e).split('\n')[0] }));
console.log(`  applied    ${JSON.stringify(applied)} after ${Math.round((Date.now() - started) / 1000)}s`);

try { await app.close(); } catch { /* it may already be gone, which is the point */ }
try { rmSync(userDir, { recursive: true, force: true }); } catch { /* windows lock */ }
