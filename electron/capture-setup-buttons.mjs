#!/usr/bin/env node
/**
 * Capture the Setup card's action buttons.
 *
 * Points at the operator's REAL data root, because the buttons only exist in the states the data
 * produces: "Remove" appears only when an ingest token is stored, "Check now" / "Push now" only
 * when a dashboard endpoint is configured. A throwaway data root renders half of them and would
 * prove nothing about the ones that were asked about.
 *
 * Read-only: it opens the window, reads the DOM and takes a picture. Nothing is clicked.
 *
 *   node electron/capture-setup-buttons.mjs
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

const userDir = mkdtempSync(join(tmpdir(), 'redbot-btn-'));
const out = join(HERE, '.shots');
mkdirSync(out, { recursive: true });

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userDir}`],
  cwd: ROOT,
  env: { ...process.env, REDBOT_DATA: realData, REDBOT_DB: realDb, REDBOT_NO_DIALOGS: '1' }
});

const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.waitForSelector('#banner', { timeout: 45_000 });
await page.setViewportSize({ width: 1440, height: 960 });

/* The first-run guide opens over everything on a fresh userData and SWALLOWS CLICKS — the first
   run of this capture navigated nowhere and reported zero buttons because of it. tools/product's
   own UI suite pre-sets the same flag for the same reason. */
await page.evaluate(() => { try { localStorage.setItem('redbot.seenGuide', '1'); } catch { /* private mode */ } });
await page.click('#guideX').catch(() => {});
await page.waitForTimeout(500);

await page.click('.steps .step[data-v="setup"]').catch(() => {});
await page.waitForTimeout(2500);

/**
 * The computed colour of every button on the screen, grouped by whether it is inside the card that
 * was meant to change. This is what proves the scoping: the `acts` buttons must be jade and every
 * other `.mini` on the screen must still be the default glass.
 */
const report = await page.evaluate(() => {
  const rgb = (el, prop) => getComputedStyle(el)[prop];
  const rows = [];
  for (const b of document.querySelectorAll('#v-setup button.mini')) {
    rows.push({
      label: b.textContent.trim().slice(0, 22),
      inActs: !!b.closest('.collect.acts'),
      bg: rgb(b, 'backgroundColor'),
      border: rgb(b, 'borderTopColor'),
      color: rgb(b, 'color')
    });
  }
  const acts = document.querySelector('#v-setup .collect.acts');
  return { rows, actsFound: !!acts };
});

console.log(`\n  .collect.acts found: ${report.actsFound}`);
console.log('\n  BUTTON                  IN CARD   BACKGROUND                BORDER                    TEXT');
for (const r of report.rows) {
  console.log(`  ${r.label.padEnd(23)} ${String(r.inActs).padEnd(9)} ${r.bg.padEnd(25)} ${r.border.padEnd(25)} ${r.color}`);
}

const acts = report.rows.filter((r) => r.inActs);
const others = report.rows.filter((r) => !r.inActs);

/**
 * Is this computed colour green-dominant?
 *
 * TWO FORMATS, and the first version of this only handled one. `color-mix()` resolves to
 * `color(srgb 0 0.529 0.353 / 0.14)` in Chromium, not to `rgb(...)` — so an rgb-only regex reported
 * every jade button as NOT jade and the check failed while the screen was visibly correct. A
 * measurement that cannot read its own units is worse than no measurement.
 */
const isJade = (c) => {
  let m = c.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (m) return Number(m[2]) > Number(m[1]) && Number(m[2]) > Number(m[3]);
  m = c.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (m) return Number(m[2]) > Number(m[1]) && Number(m[2]) > Number(m[3]);
  return false;
};

const actsOk = acts.length > 0 && acts.every((r) => isJade(r.bg) && isJade(r.border));
const othersOk = others.every((r) => !isJade(r.bg));
console.log(`\n  ${acts.length} button(s) in the card  -> all jade: ${actsOk}`);
console.log(`  ${others.length} button(s) elsewhere on Setup -> all unchanged: ${othersOk}`);

/**
 * BOTH THEMES. The console has a light and a dark palette and a toggle between them, and `--jade`
 * sits on a near-white surface in one and a near-black one in the other. A tint that reads well on
 * black can wash out on white, so one screenshot proves half the claim.
 */
for (const want of ['dark', 'light']) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), want);
  await page.waitForTimeout(350);
  /* Scroll to the token controls rather than to the card: the card is far taller than the viewport,
     and an element screenshot of it came back mostly empty space with the buttons below the fold.
     This row has Save endpoint / Store it / Remove / Check now / Push now within one screen. */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#v-setup .collect.acts button.mini')]
      .find((x) => /Push now/.test(x.textContent))
      || document.querySelector('#v-setup .collect.acts button.mini');
    if (b) b.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `setup-buttons-${want}.png`) });
  const sample = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#v-setup .collect.acts button.mini')]
      .find((x) => /Register operator/.test(x.textContent));
    if (!b) return null;
    const s = getComputedStyle(b);
    return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor };
  });
  console.log(`  ${want.padEnd(6)} Register operator -> bg ${sample?.bg} | text ${sample?.color}`);
}
await page.screenshot({ path: join(out, 'setup-buttons.png') });

const real = errors.filter((e) => !/Failed to load resource|net::ERR|404|favicon/.test(e));
console.log(`\n  shots      ${out}`);
console.log(`  console    ${real.length ? real.join(' | ') : 'clean — no errors'}\n`);

await app.close();
try { rmSync(userDir, { recursive: true, force: true }); } catch { /* windows lock */ }
process.exit(real.length || !actsOk || !othersOk ? 1 : 0);
