/**
 * Capture the operator workstation screenshot gallery.
 *
 * Reproducible rather than hand-collected: this drives the real workstation
 * against real data and writes tools/operator/screenshots/.
 *
 * Playwright launches its own bundled Chromium against 127.0.0.1 — it does NOT
 * attach to the operator's Chrome and has nothing to do with Reddit, where the
 * attach-never-launch rule applies.
 *
 *   node tools/operator/server.mjs --port 7901
 *   node tools/operator/capture-screenshots.mjs --port 7901
 */
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'screenshots');
const portArg = process.argv.indexOf('--port');
const PORT = portArg > -1 ? process.argv[portArg + 1] : '7890';

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.png')) unlinkSync(join(OUT, f));

const browser = await chromium.launch();
const page = await (await browser.newContext({
  viewport: { width: 1600, height: 1000 }, colorScheme: 'dark', deviceScaleFactor: 1
})).newPage();

const shot = async (n, full = false) => { await page.screenshot({ path: join(OUT, n + '.png'), fullPage: full }); console.log('  captured', n); };
const nav = async (label) => { await page.click(`#nav button:has-text("${label}")`); await page.waitForTimeout(1500); };
// <main> is the scroll container, not the window — window.scrollTo() is a no-op here.
const scrollTo = async (sel) => {
  await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'start' }), sel);
  await page.waitForTimeout(600);
};

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4500);
await shot('01-dashboard');
await shot('02-dashboard-full', true);
await scrollTo('#pg-dashboard .tl');
await shot('03-dashboard-activity');

/* command palette */
await nav('Dashboard');
await page.keyboard.press('Control+k');
await page.waitForTimeout(600);
await shot('04-command-palette');
await page.fill('#palInput', 'bench');
await page.waitForTimeout(400);
await shot('05-command-palette-filtered');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

/* live terminal */
await page.keyboard.press('Control+k');
await page.fill('#palInput', 'doctor');
await page.waitForTimeout(350);
await page.keyboard.press('Enter');
await page.waitForTimeout(4500);
await shot('06-live-terminal');

/* global search */
await page.keyboard.press('/');
await page.waitForTimeout(400);
await page.fill('#srchInput', 'max_allowed_packet');
await page.waitForTimeout(2600);
await shot('07-global-search');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

/* timeline + queue */
await nav('Timeline');
await page.waitForTimeout(1600);
await shot('08-timeline');
await nav('Queue');
await page.waitForTimeout(1500);
await shot('09-queue', true);

/* certifications */
await nav('Certifications');
await page.waitForTimeout(2600);
await shot('10-certifications');
await page.evaluate(() => {
  const d = [...document.querySelectorAll('#cert-detail details.col')]
    .find((x) => /Dependency graph/.test(x.querySelector('summary')?.textContent || ''));
  if (d) d.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(700);
await shot('11-dependency-graph');
await page.fill('#pg-certifications input.search', 'provenance');
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelector('main').scrollTo({ top: 0 }));
await page.waitForTimeout(400);
await shot('12-certification-search');
await page.fill('#pg-certifications input.search', '');

/* ground truth + reports + files */
await nav('Ground Truth');
await page.waitForTimeout(1800);
await shot('13-ground-truth');
await nav('Reports');
await page.waitForTimeout(2200);
await shot('14-reports-toc');
await nav('Files');
await page.waitForTimeout(2000);
await shot('15-file-explorer');
await page.click('#pg-files button:has-text("logs")');
await page.waitForTimeout(2000);
await shot('16-file-explorer-jsonl');

/* gates */
await nav('Validation');
await page.waitForTimeout(1400);
await page.click('#pg-validation button:has-text("Run all six gates")');
await page.waitForTimeout(30000);
await shot('17-validation');
await nav('Benchmark');
await page.waitForTimeout(1800);
await shot('18-benchmark', true);
await nav('Run History');
await page.waitForTimeout(1800);
await shot('19-run-history', true);

/* logs + settings + about */
await nav('Logs');
await page.waitForTimeout(1800);
await page.click('#pg-logs .idx button:has-text("trace.jsonl")');
await page.waitForTimeout(1800);
await shot('20-log-stream');
await page.click('#pg-logs .idx button:has-text("reviews.jsonl")');
await page.waitForTimeout(1400);
await shot('21-log-empty-state');
await nav('Settings');
await page.waitForTimeout(3000);
await shot('22-settings', true);
await nav('About');
await page.waitForTimeout(1200);
await shot('23-about', true);

/* light theme */
await nav('Dashboard');
await page.waitForTimeout(2600);
await page.click('#theme');
await page.waitForTimeout(700);
await shot('24-dashboard-light');
await page.click('#theme');
await page.waitForTimeout(500);

for (const [name, width, height] of [['25-viewport-tablet-900', 900, 1100], ['26-viewport-phone-420', 420, 900]]) {
  const p = await (await browser.newContext({ viewport: { width, height }, colorScheme: 'dark' })).newPage();
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(4200);
  await p.screenshot({ path: join(OUT, name + '.png'), fullPage: true });
  console.log('  captured', name, `(${width}x${height})`);
  await p.close();
}

await browser.close();
console.log('gallery written to tools/operator/screenshots');
