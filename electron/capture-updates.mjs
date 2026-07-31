#!/usr/bin/env node
/**
 * Capture the update controls, in the real desktop shell.
 *
 * WHAT THIS PROVES AND WHAT IT CANNOT.
 *
 * It proves the CONTROLS: that `window.redbotDesktop.updates` reaches the main process, that the
 * Setup card renders, that "Check for updates" performs a real IPC round trip and reports a real
 * answer, and that the available / downloading / installing states paint the way they are meant to.
 * Each of those is a browser render, captured after the change.
 *
 * It CANNOT prove that a silent install works end to end. That needs a newer release actually
 * published to the configured GitHub feed, which is a publishing action, not a local one. The
 * download-and-install path is covered by electron/updater.test.mjs against a fake updater, and by
 * nothing else until a real release exists to install.
 *
 * The later states are painted by setting the page's own state and calling its own paint function —
 * the real rendering code, with state it would have received from the main process. Nothing about
 * the screenshot is fabricated; only the state that produced it is supplied.
 *
 *   node electron/capture-updates.mjs
 */
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* A scratch data root: this capture must never touch the operator's real database. */
const userDir = mkdtempSync(join(tmpdir(), 'redbot-upd-user-'));
const dataDir = mkdtempSync(join(tmpdir(), 'redbot-upd-data-'));
const out = join(HERE, '.shots');
mkdirSync(out, { recursive: true });

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userDir}`],
  cwd: ROOT,
  env: { ...process.env, REDBOT_DATA: dataDir, REDBOT_NO_DIALOGS: '1' }
});

const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.waitForSelector('#banner', { timeout: 45_000 });
await page.setViewportSize({ width: 1440, height: 960 });

/* 1. The bridge is actually there, and is only the four things preload.cjs exposes. */
const bridge = await page.evaluate(() => {
  const u = window.redbotDesktop && window.redbotDesktop.updates;
  return {
    isDesktop: !!(window.redbotDesktop && window.redbotDesktop.isDesktop),
    verbs: u ? Object.keys(u).sort() : null,
    types: u ? Object.keys(u).map((k) => `${k}:${typeof u[k]}`).sort() : null
  };
});
console.log(`\n  bridge     isDesktop=${bridge.isDesktop} verbs=${JSON.stringify(bridge.verbs)}`);

/* 2. A real IPC round trip. In a dev run this must REFUSE rather than throw. */
const snap = await page.evaluate(() => window.redbotDesktop.updates.snapshot());
const checked = await page.evaluate(() => window.redbotDesktop.updates.check());
console.log(`  snapshot   phase=${snap.phase} current=${snap.current} supported=${snap.supported}`);
console.log(`  check      ok=${checked.ok} reason=${checked.reason ?? '—'}`);

/* 3. The Setup screen, as it really is right now. */
await page.click('.steps .step[data-v="setup"]').catch(() => {});
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const h = [...document.querySelectorAll('#v-setup .collect-h h3')].find((x) => x.textContent === 'This build');
  if (h) h.closest('.collect').scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'updates-setup-real.png') });

const card = await page.evaluate(() => {
  const h = [...document.querySelectorAll('#v-setup .collect-h h3')].find((x) => x.textContent === 'This build');
  const box = h && h.closest('.collect');
  return box
    ? {
      found: true,
      text: box.textContent.replace(/\s+/g, ' ').trim().slice(0, 260),
      buttons: [...box.querySelectorAll('button')].map((b) => b.textContent.trim())
    }
    : { found: false };
});
console.log(`  card       found=${card.found} buttons=${JSON.stringify(card.buttons)}`);
console.log(`  card text  ${card.text}`);

/* 4. Click the real button and see what the card says afterwards. */
await page.evaluate(() => {
  const h = [...document.querySelectorAll('#v-setup .collect-h h3')].find((x) => x.textContent === 'This build');
  const btn = [...h.closest('.collect').querySelectorAll('button')]
    .find((b) => /Check for updates/.test(b.textContent));
  btn.click();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, 'updates-setup-checked.png') });
const afterClick = await page.evaluate(() => {
  const h = [...document.querySelectorAll('#v-setup .collect-h h3')].find((x) => x.textContent === 'This build');
  return h.closest('.collect').textContent.replace(/\s+/g, ' ').trim().slice(0, 240);
});
console.log(`  after tap  ${afterClick}`);

/**
 * 5. The states a dev run cannot reach on its own.
 *
 * The console's script is an IIFE under "use strict" — nothing it defines is reachable from
 * outside, which is right for production and means the states cannot be poked in directly. So they
 * are driven through the ONE seam the page actually reads: `window.redbotDesktop.updates`.
 *
 * A second Chromium page is pointed at the SAME running server, with that object defined before
 * any page script runs. The console cannot tell the difference — it calls `snapshot()`, subscribes
 * via `onStatus()` and renders whatever arrives, exactly as it does against the real main process.
 * The rendering code under test is unmodified; only the state feeding it is supplied.
 *
 * It has to be a separate page because Electron's contextBridge object cannot be replaced in the
 * app's own window.
 */
const url = page.url();
console.log(`\n  driving states through the bridge interface, at ${url}`);

const { chromium } = await import('playwright');
const cbrowser = await chromium.launch();
const ctx = await cbrowser.newContext({ viewport: { width: 1440, height: 960 } });
const p2 = await ctx.newPage();
const errors2 = [];
p2.on('pageerror', (e) => errors2.push('pageerror: ' + e.message));
p2.on('console', (m) => { if (m.type() === 'error') errors2.push('console: ' + m.text()); });

await p2.addInitScript(() => {
  let cb = null;
  const idle = { phase: 'idle', current: '1.0.2', latest: null, newer: false, supported: true, percent: 0, reason: null };
  window.redbotDesktop = {
    isDesktop: true,
    updates: {
      snapshot: async () => idle,
      check: async () => idle,
      apply: async () => ({ ok: false, reason: 'not driven in this capture' }),
      onStatus: (fn) => { cb = fn; return () => { cb = null; }; }
    }
  };
  /* The handle this capture pushes states through — the same callback the main process uses. */
  window.__pushUpdate = (s) => { if (cb) cb(s); };
});

await p2.goto(url, { waitUntil: 'domcontentloaded' });
await p2.waitForSelector('#banner', { timeout: 30_000 });
await p2.click('.steps .step[data-v="setup"]').catch(() => {});
await p2.waitForTimeout(1200);

const states = [
  ['available', { phase: 'available', current: '1.0.2', latest: '1.1.0', newer: true, supported: true, percent: 0, reason: null }],
  ['downloading', { phase: 'downloading', current: '1.0.2', latest: '1.1.0', newer: true, supported: true, percent: 43, transferred: 44_040_192, total: 102_694_128, reason: null }],
  ['ready', { phase: 'ready', current: '1.0.2', latest: '1.1.0', newer: true, supported: true, percent: 100, reason: null }],
  ['installing', { phase: 'installing', current: '1.0.2', latest: '1.1.0', newer: true, supported: true, percent: 100, reason: null }],
  ['error', { phase: 'error', current: '1.0.2', latest: null, newer: false, supported: true, percent: 0, reason: 'could not reach the update server' }]
];

for (const [name, state] of states) {
  const shot = await p2.evaluate((s) => {
    window.__pushUpdate(s);
    const h = [...document.querySelectorAll('#v-setup .collect-h h3')].find((x) => x.textContent === 'This build');
    if (!h) return { buttons: ['CARD NOT FOUND'], text: '' };
    const box = h.closest('.collect');
    box.scrollIntoView({ block: 'center' });
    return {
      buttons: [...box.querySelectorAll('button')].map((b) => `${b.textContent.trim()}${b.disabled ? ' (disabled)' : ''}`),
      text: box.textContent.replace(/\s+/g, ' ').trim().slice(0, 190)
    };
  }, state);
  await p2.waitForTimeout(250);
  await p2.screenshot({ path: join(out, `updates-${name}.png`) });
  console.log(`  ${name.padEnd(12)}${JSON.stringify(shot.buttons)}`);
  console.log(`  ${''.padEnd(12)}${shot.text}`);
}

await cbrowser.close();

const real = [...errors, ...errors2].filter((e) => !/Failed to load resource|net::ERR|404|favicon/.test(e));
console.log(`\n  shots      ${out}`);
console.log(`  console    ${real.length ? real.join(' | ') : 'clean — no errors'}\n`);

await app.close();
for (const d of [userDir, dataDir]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* windows lock */ } }
process.exit(real.length ? 1 : 0);
