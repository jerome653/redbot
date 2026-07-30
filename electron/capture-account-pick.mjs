#!/usr/bin/env node
/**
 * Click "Act as this account" in the real app, and prove the blocking requirement clears.
 *
 * The endpoint was already tested with curl. This tests the thing a PERSON does: open the app with
 * nothing selected, go to Accounts, click, and see the gate release. A working endpoint behind a
 * button nobody can reach is not a fix.
 */
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const realData = join(ROOT, 'data');
const userDir = mkdtempSync(join(tmpdir(), 'redbot-pick-'));
const out = join(HERE, '.shots');
mkdirSync(out, { recursive: true });

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userDir}`],
  cwd: ROOT,
  env: { ...process.env, REDBOT_DATA: realData, REDBOT_DB: join(realData, 'redbot.db'),
         REDBOT_NO_DIALOGS: '1', REDBOT_ACCOUNT: '' }
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.waitForSelector('#banner', { timeout: 30_000 });

const before = await page.evaluate(() => fetch('/api/setup').then((r) => r.json()));
console.log(`\n  BEFORE  blocking: ${before.blocking.map((b) => b.id).join(', ') || 'none'}`);

await page.click('.steps .step[data-v="accounts"]');
await page.waitForTimeout(700);
await page.screenshot({ path: join(out, 'account-pick-before.png') });

const btn = page.locator('#v-accounts button:has-text("Act as this account")').first();
const n = await page.locator('#v-accounts button:has-text("Act as this account")').count();
console.log(`          "Act as this account" buttons: ${n}`);
await btn.click();
await page.waitForTimeout(2500);

const after = await page.evaluate(() => fetch('/api/setup').then((r) => r.json()));
const acct = after.requirements.find((r) => r.id === 'account');
console.log(`  AFTER   blocking: ${after.blocking.map((b) => b.id).join(', ') || 'none'}`);
console.log(`          account: ${acct.ok ? 'ok' : 'UNMET'} — ${acct.detail}`);
await page.screenshot({ path: join(out, 'account-pick-after.png') });

const real = errors.filter((e) => !/Failed to load resource|net::ERR|404/.test(e));
console.log(`  errors  ${real.length ? real.join(' | ') : 'none'}\n`);
await app.close();
try { rmSync(userDir, { recursive: true, force: true }); } catch {}
process.exit(real.length || !acct.ok ? 1 : 0);
