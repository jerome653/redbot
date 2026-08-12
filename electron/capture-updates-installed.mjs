#!/usr/bin/env node
/**
 * The update check, run by the PACKAGED app against the REAL feed.
 *
 * This is the only step that exercises the parts a dev run cannot reach: `app.isPackaged` is true,
 * so the updater is enabled rather than refusing; `resources/app-update.yml` exists, so
 * electron-updater has a feed to read; and the request actually goes to GitHub.
 *
 * WHAT IT STILL DOES NOT PROVE. It does not install anything, and it cannot until a release NEWER
 * than this build exists on the feed. If the newest published release is this same version, a
 * correct run reports "up to date" — that is a pass, not a failure, and the log below says which
 * answer came back rather than asserting one.
 *
 * Nothing here downloads: `autoDownload` is off and Apply is never clicked.
 *
 *   npx electron-builder --win nsis --publish never
 *   node electron/capture-updates-packaged.mjs
 */
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const exe = join(process.env.LOCALAPPDATA, "Programs", "redbot", "redbot.exe");

if (!existsSync(exe)) {
  console.error(`\n  No packaged build at ${exe}\n  Build one first:  npx electron-builder --win nsis --publish never\n`);
  process.exit(1);
}

const userDir = mkdtempSync(join(tmpdir(), 'redbot-updpkg-'));
const out = join(HERE, '.shots');
mkdirSync(out, { recursive: true });

const app = await electron.launch({
  executablePath: exe,
  args: [`--user-data-dir=${userDir}`],
  env: {
    ...process.env,
    REDBOT_DATA: join(userDir, 'data'),
    REDBOT_DB: join(userDir, 'data', 'redbot.db'),
    REDBOT_NO_DIALOGS: '1'
  }
});

const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.waitForSelector('#banner', { timeout: 60_000 });
await page.setViewportSize({ width: 1440, height: 960 });

const snap = await page.evaluate(() => window.redbotDesktop.updates.snapshot());
console.log(`\n  packaged   ${exe}`);
console.log(`  snapshot   phase=${snap.phase} current=${snap.current} supported=${snap.supported}`);
if (!snap.supported) {
  console.error('  FAIL       a packaged build must support updates');
  await app.close();
  process.exit(1);
}

/* The real network call. Read-only: it asks the feed what the newest release is. */
const started = Date.now();
const checked = await page.evaluate(() => window.redbotDesktop.updates.check());
console.log(`  check      ok=${checked.ok} phase=${checked.phase} latest=${checked.latest ?? '—'} newer=${checked.newer} in ${Date.now() - started}ms`);
if (checked.reason) console.log(`  reason     ${checked.reason}`);

await page.click('.steps .step[data-v="setup"]').catch(() => {});
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const h = [...document.querySelectorAll('#v-setup .collect-h h3')].find((x) => x.textContent === 'This build');
  if (h) h.closest('.collect').scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, 'updates-packaged.png') });

const card = await page.evaluate(() => {
  const h = [...document.querySelectorAll('#v-setup .collect-h h3')].find((x) => x.textContent === 'This build');
  const box = h && h.closest('.collect');
  return box
    ? { buttons: [...box.querySelectorAll('button')].map((b) => b.textContent.trim()),
      text: box.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) }
    : null;
});
console.log(`  card       ${JSON.stringify(card?.buttons)}`);
console.log(`  card text  ${card?.text}`);

/* The boot log is where an updater failure would be recorded even if the UI stayed quiet. */
const log = await page.evaluate(async () => {
  try { return (await fetch('/api/logs?name=boot').then((r) => r.json()))?.text ?? null; } catch { return null; }
});
if (log) {
  const lines = String(log).split('\n').filter((l) => /updater/.test(l));
  if (lines.length) console.log('  boot.log   ' + lines.slice(-4).join('\n             '));
}

const real = errors.filter((e) => !/Failed to load resource|net::ERR|404|favicon/.test(e));
console.log(`\n  shot       ${join(out, 'updates-packaged.png')}`);
console.log(`  console    ${real.length ? real.join(' | ') : 'clean — no errors'}\n`);

await app.close();
try { rmSync(userDir, { recursive: true, force: true }); } catch { /* windows lock */ }
process.exit(real.length ? 1 : 0);
