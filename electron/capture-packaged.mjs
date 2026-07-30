#!/usr/bin/env node
/**
 * Capture the PACKAGED app's window.
 *
 * `electron/smoke.test.mjs` drives the app from the working tree, which proves the code works. It
 * does not prove the SHIPPED ARTEFACT works, and the difference is not academic — the first packaged
 * build provisioned itself correctly and then died spawning its own console, because `cwd: ROOT`
 * resolves inside `resources/app.asar` and an archive is not a valid working directory. Dev mode
 * could never have caught that.
 *
 * So this exists as its own step, run against release/win-unpacked/ after a build:
 *
 *   npm run pack
 *   node electron/capture-packaged.mjs
 *
 * It is not part of `npm test`, because it needs a build that most runs will not have.
 */
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const exe = join(ROOT, 'release', 'win-unpacked', 'redbot.exe');

if (!existsSync(exe)) {
  console.error(`\n  No packaged build at ${exe}\n  Build one first:  npm run pack\n`);
  process.exit(1);
}

const userDir = mkdtempSync(join(tmpdir(), 'redbot-packaged-'));
const out = join(HERE, '.shots');
mkdirSync(out, { recursive: true });

/* A throwaway userData, so this measures a genuine FIRST RUN — no vault key, no database, no
   accounts — rather than whatever state the operator's real install happens to be in. */
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
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.waitForSelector('#banner', { timeout: 30_000 });

const seen = await page.evaluate(() => ({
  onSetup: !document.querySelector('#v-setup')?.hidden,
  heading: document.querySelector('#v-setup .collect-h h3')?.textContent ?? null,
  banner: (document.querySelector('#banner')?.textContent ?? '').slice(0, 130)
}));
const reqs = await page.evaluate(() => fetch('/api/setup').then((r) => r.json()));

console.log(`\n  packaged app: ${exe}`);
console.log(`  title        ${await page.title()}`);
console.log(`  url          ${page.url()}`);
console.log(`  opened on    ${seen.onSetup ? 'Setup (the gate fired)' : 'NOT Setup'}`);
console.log(`  heading      ${seen.heading}`);
console.log(`  banner       ${seen.banner}`);
console.log(`  requirements ${reqs.requirements.length} · blocking ${reqs.blocking.length} · advisory ${reqs.advisory.length}`);

const shot = join(out, 'packaged-app.png');
await page.screenshot({ path: shot });
console.log(`  captured     ${shot}`);

const real = errors.filter((e) => !/Failed to load resource|net::ERR|404/.test(e));
console.log(`  page errors  ${real.length ? real.join(' | ') : 'none'}\n`);

await app.close();
try { rmSync(userDir, { recursive: true, force: true }); } catch { /* windows lock */ }
process.exit(real.length ? 1 : 0);
