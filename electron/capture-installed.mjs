#!/usr/bin/env node
/**
 * Drive the INSTALLED app — the one an NSIS installer put on disk.
 *
 * `capture-packaged.mjs` drives `release/win-unpacked/`, which is what electron-builder assembles
 * before it wraps it. This drives what a person actually ends up with after running the installer,
 * which is a different artefact and the only one that answers "is the desktop app built".
 *
 *   INSTALL_DIR=<dir> node electron/capture-installed.mjs
 */
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const installDir = process.env.INSTALL_DIR;
if (!installDir) { console.error('\n  set INSTALL_DIR\n'); process.exit(1); }
const exe = join(installDir, 'redbot.exe');
if (!existsSync(exe)) { console.error(`\n  no redbot.exe at ${exe}\n`); process.exit(1); }

const realData = join(ROOT, 'data');
const userDir = mkdtempSync(join(tmpdir(), 'redbot-installed-'));
const out = join(HERE, '.shots');
mkdirSync(out, { recursive: true });

const app = await electron.launch({
  executablePath: exe,
  args: [`--user-data-dir=${userDir}`],
  /* The REAL database, so the numbers on screen are the imported corpus — but a throwaway Electron
     userData, so window state from a previous run cannot flatter the result. */
  env: {
    ...process.env,
    REDBOT_DATA: realData,
    REDBOT_DB: join(realData, 'redbot.db'),
    REDBOT_NO_DIALOGS: '1'
  }
});

const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.waitForSelector('#banner', { timeout: 40_000 });

const s = await page.evaluate(() => fetch('/api/setup').then((r) => r.json()));
const acct = s.requirements.find((r) => r.id === 'account');
const bar = await page.evaluate(() => {
  const t = (q) => document.querySelector(q)?.textContent?.trim() ?? null;
  return { threads: t('#nDisc'), review: t('#nRev'), accounts: t('#nAcc'), setup: t('#nSet') };
});

console.log(`\n  installed  ${exe}`);
console.log(`  title      ${await page.title()}`);
console.log(`  url        ${page.url()}`);
console.log(`  bar        threads=${bar.threads} review=${bar.review} accounts=${bar.accounts} setup=${bar.setup}`);
console.log(`  account    ${acct.ok ? 'ok' : 'UNMET'} — ${acct.detail}`);
console.log(`  blocking   ${s.blocking.map((b) => b.id).join(', ') || 'none'}`);

/* The corpus screen, because that is where "the data came across" is visible. */
await page.click('.steps .step[data-v="discovery"]').catch(() => {});
await page.waitForTimeout(1200);
const rows = await page.evaluate(() =>
  document.querySelectorAll('#v-discovery table tbody tr').length);
console.log(`  threads    ${rows} row(s) rendered from the real database`);
await page.screenshot({ path: join(out, 'installed-app.png') });

const real = errors.filter((e) => !/Failed to load resource|net::ERR|404/.test(e));
console.log(`  captured   ${join(out, 'installed-app.png')}`);
console.log(`  errors     ${real.length ? real.join(' | ') : 'none'}\n`);

await app.close();
try { rmSync(userDir, { recursive: true, force: true }); } catch { /* windows lock */ }
process.exit(real.length ? 1 : 0);
