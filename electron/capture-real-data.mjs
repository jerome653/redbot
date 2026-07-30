#!/usr/bin/env node
/**
 * Capture the desktop app reading the REAL corpus.
 *
 * The other captures use a throwaway data root, which proves a fresh install provisions itself and
 * proves nothing about whether the imported corpus renders. This one points at the operator's actual
 * database — so the numbers on screen are the ones `doctor` and `insights` report, or they disagree
 * and that is worth knowing.
 *
 * Electron's own userData is still a temp directory: this is about the DATABASE, and giving the app
 * a scratch userData keeps the capture from depending on window state left by a previous run.
 *
 *   node electron/capture-real-data.mjs
 */
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const realData = join(ROOT, 'data');
const realDb = join(realData, 'redbot.db');

if (!existsSync(realDb)) {
  console.error(`\n  No database at ${realDb}\n`);
  process.exit(1);
}

const userDir = mkdtempSync(join(tmpdir(), 'redbot-realdata-'));
const out = join(HERE, '.shots');
mkdirSync(out, { recursive: true });

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userDir}`],
  cwd: ROOT,
  env: { ...process.env, REDBOT_DATA: realData, REDBOT_DB: realDb, REDBOT_NO_DIALOGS: '1' }
});

const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.waitForSelector('#banner', { timeout: 30_000 });

/* What the chrome reports, straight off the rendered page — these are the figures a person sees. */
const bar = await page.evaluate(() => {
  const t = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
  return {
    threads: t('#nDisc'), accounts: t('#nAcc'), review: t('#nRev'),
    outcomes: t('#nOut'), setup: t('#nSet'),
    banner: (t('#banner') ?? '').slice(0, 110)
  };
});
console.log(`\n  database   ${realDb}`);
console.log(`  bar        threads=${bar.threads} accounts=${bar.accounts} review=${bar.review} results=${bar.outcomes} setup=${bar.setup}`);
console.log(`  banner     ${bar.banner}`);

/* Threads is the screen the corpus actually lands on. The gate opens on Setup, and navigating away
   from it must work — that it is not a trap is the point. */
await page.click('.steps .step[data-v="discovery"]').catch(() => {});
await page.waitForTimeout(900);
const threads = await page.evaluate(() => {
  const rows = document.querySelectorAll('#v-discovery table tbody tr');
  return { rows: rows.length, text: (document.querySelector('#v-discovery')?.textContent ?? '').slice(0, 220) };
});
console.log(`  threads    ${threads.rows} row(s) rendered`);
await page.screenshot({ path: join(out, 'real-data-threads.png') });

await page.click('.steps .step[data-v="review"]').catch(() => {});
await page.waitForTimeout(900);
await page.screenshot({ path: join(out, 'real-data-review.png') });
const review = await page.evaluate(() =>
  (document.querySelector('#v-review')?.textContent ?? '').slice(0, 160));
console.log(`  review     ${review.replace(/\s+/g, ' ').slice(0, 130)}`);

const real = errors.filter((e) => !/Failed to load resource|net::ERR|404/.test(e));
console.log(`  captured   ${join(out, 'real-data-threads.png')}`);
console.log(`  page errors ${real.length ? real.join(' | ') : 'none'}\n`);

await app.close();
try { rmSync(userDir, { recursive: true, force: true }); } catch { /* windows lock */ }
process.exit(real.length ? 1 : 0);
