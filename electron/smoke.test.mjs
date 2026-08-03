#!/usr/bin/env node
/**
 * Does the desktop app actually open, and is it the console?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A BROWSER TEST AND NOT A UNIT TEST.
 *
 * Everything the Electron shell does is only true once it has RUN: that the server child starts
 * and binds, that the window loads it rather than showing a connection error, that the loopback
 * guards accept a request from the renderer, and that a spawned CLI child is the CLI rather than a
 * second copy of the app. None of that is observable from the source — the first attempt to check
 * it by launching `electron .` and reading stdout produced nothing at all, because Electron on
 * Windows does not attach stdout to the parent console.
 *
 * So the app is driven through Playwright's Electron launcher, and the window is screenshotted.
 * The capture is the evidence; the assertions below are what make a regression fail loudly.
 *
 *   node --test --test-timeout=120000 electron/smoke.test.mjs
 * ---------------------------------------------------------------------------
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SHOTS = join(HERE, '.shots');

let app;
let page;
let userDir;
const consoleErrors = [];

before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  /* A throwaway userData so the test never touches the operator's real install, and so the
     "fresh install provisions itself" claim is actually being tested rather than assumed. */
  userDir = mkdtempSync(join(tmpdir(), 'redbot-electron-'));

  app = await electron.launch({
    args: ['.', `--user-data-dir=${userDir}`],
    cwd: ROOT,
    env: {
      ...process.env,
      REDBOT_DATA: join(userDir, 'data'),
      REDBOT_DB: join(userDir, 'data', 'redbot.db'),
      /* A key so the vault is usable without touching the real credential store. This is the
         documented override path (electron/vault-key.mjs step 1), so it also exercises it. */
      REDBOT_VAULT_KEY: Buffer.alloc(32, 7).toString('base64'),
      /* No modal dialogs in an automated run: dialog.showErrorBox is synchronous and blocks
         forever with nobody to click OK, which turned a 30s failure into a 3-minute hang. */
      REDBOT_NO_DIALOGS: '1',
      /* A throwaway userData has no accounts, so boot would find nothing to open anyway — this is
         belt and braces. An automated run must never spawn a real Chrome on the tester's desktop
         if that ever stops being true. */
      REDBOT_NO_AUTO_BROWSER: '1'
    }
  });

  page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await page.waitForLoadState('domcontentloaded');
});

after(async () => {
  await app?.close();
  try { rmSync(userDir, { recursive: true, force: true }); } catch { /* windows lock */ }
});

describe('the desktop shell', () => {
  test('a window opens and it is the redbot console, not an error page', async () => {
    const title = await page.title();
    assert.equal(title, 'redbot — operations', `window title was "${title}"`);

    /* Electron shows its own error page when loadURL fails; that page has no #banner. Asserting a
       real element rules out "the window opened" being mistaken for "the console loaded". */
    await page.waitForSelector('#banner', { timeout: 30_000 });
    const url = page.url();
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\//, `loaded ${url}`);
  });

  test('the page is served over loopback, and the server accepted it', async () => {
    // If hostIsLocal or originIsLocal had rejected the renderer, /api/state would 403 and the
    // console would render its "Could not load" banner instead of a figure.
    const state = await page.evaluate(async () => {
      const r = await fetch('/api/state');
      return { status: r.status, ok: r.ok };
    });
    assert.equal(state.status, 200, 'the renderer could not read /api/state');
  });

  test('a mutating POST from the renderer passes the cross-origin guard', async () => {
    /* The guard that matters most: `originIsLocal` on POST. The renderer's Origin is
       http://127.0.0.1:<port>, which must be accepted — and a 4xx here would mean every action
       button in the app is dead. /api/status is chosen because it changes nothing. */
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      return r.status;
    });
    assert.notEqual(res, 403, 'the server refused the renderer as cross-origin');
    assert.notEqual(res, 415, 'the server refused the renderer content-type');
  });

  test('the preload exposes one read-only fact and the update bridge, and no command surface', async () => {
    /**
     * This assertion used to read `deepEqual(keys, ['isDesktop'])` and had been failing since the
     * update bridge landed — invisibly, because this file is not in `npm test`.
     *
     * The bridge is deliberate and `electron/preload.cjs` argues for it at length: the updater can
     * only run in the Electron MAIN process, while the console server is a plain-Node CHILD, so
     * `/api/run` physically cannot carry it. The old assertion predates that and was simply stale.
     *
     * So it is re-pinned rather than relaxed. What actually protects this app is that there is no
     * PARAMETERISED verb — nothing here takes a command, path, URL or version — and the exact
     * member list is spelled out below so adding a `runCommand` bridge, or giving any existing
     * verb an argument, still fails here.
     */
    const shape = await page.evaluate(() => ({
      isDesktop: window.redbotDesktop?.isDesktop,
      keys: Object.keys(window.redbotDesktop ?? {}).sort(),
      updateKeys: Object.keys(window.redbotDesktop?.updates ?? {}).sort(),
      updateTypes: Object.entries(window.redbotDesktop?.updates ?? {})
        .map(([k, v]) => `${k}:${typeof v}`).sort(),
      hasRequire: typeof window.require,
      hasProcess: typeof window.process
    }));
    assert.equal(shape.isDesktop, true);
    assert.deepEqual(shape.keys, ['isDesktop', 'updates'],
      'the preload must not grow a second command path');
    assert.deepEqual(shape.updateKeys, ['apply', 'check', 'onStatus', 'snapshot'],
      'the update bridge grew a verb — every addition here is a new privileged path');
    assert.deepEqual(shape.updateTypes,
      ['apply:function', 'check:function', 'onStatus:function', 'snapshot:function'],
      'the update bridge exposed something that is not one of its four verbs');
    /**
     * ARITY IS DELIBERATELY NOT ASSERTED, and the reason is worth recording so nobody adds it back.
     *
     * "no verb takes an argument" is the property that matters — a parameterised verb could choose
     * what gets installed — but `contextBridge` rebuilds every function it passes, and the copies
     * arrive with `length === 0` whatever the original signature was. Measured here: `onStatus`
     * takes a callback and still reports 0. So arity through the bridge is not evidence of
     * anything, and an assertion on it would pass identically before and after the change it
     * claims to catch. The member list above is what this side of the boundary can actually see;
     * the signatures are pinned where they are readable, in `electron/preload.cjs`.
     */
    // nodeIntegration must be off: a renderer with require() could bypass PUBLIC_ACTIONS entirely.
    assert.equal(shape.hasRequire, 'undefined', 'nodeIntegration is enabled — it must not be');
    assert.equal(shape.hasProcess, 'undefined');
  });

  test('the app provisioned its own data root under the throwaway userData', async () => {
    const dataRoot = join(userDir, 'data');
    assert.ok(existsSync(dataRoot), `${dataRoot} was not created`);
    for (const d of ['operators', 'approvals', 'run-logs', 'reports']) {
      assert.ok(existsSync(join(dataRoot, d)), `${d}/ was not provisioned`);
    }
    assert.ok(existsSync(join(dataRoot, 'redbot.db')), 'the database was not created');
  });

  test('the window renders — captured, not inferred', async () => {
    const shot = join(SHOTS, 'desktop-1440x960.png');
    await page.screenshot({ path: shot });
    assert.ok(existsSync(shot));
    // A blank or all-black canvas is the failure mode a screenshot exists to catch, and an
    // essentially empty PNG compresses very small.
    const { size } = await import('node:fs').then((fs) => fs.statSync(shot));
    assert.ok(size > 20_000, `the capture is only ${size} bytes — the window may be blank`);
  });

  test('no console errors while loading the console', () => {
    /* Filtered: a fresh install genuinely has no accounts and no Chrome, so the console's own
       "not configured" fetches can log expected failures. Anything else is a real error. */
    const unexpected = consoleErrors.filter((e) => !/Failed to load resource|net::ERR|404/.test(e));
    assert.deepEqual(unexpected, [], `renderer errors:\n${unexpected.join('\n')}`);
  });
});

describe('the spawned CLI is the CLI, not a second copy of the app', () => {
  test('ELECTRON_RUN_AS_NODE makes the Electron binary run dist/cli.js', () => {
    /**
     * The defect this pins: `tools/product/server.mjs` spawns `process.execPath` with
     * `dist/cli.js`. Inside Electron `process.execPath` is redbot.exe, so WITHOUT
     * ELECTRON_RUN_AS_NODE that spawn opens another window instead of running the command — and
     * the failure is silent, because a second app starting looks like nothing happening.
     *
     * Run directly against the Electron binary here rather than through the console, so the
     * assertion is about the mechanism rather than about one endpoint.
     */
    const electronBin = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
    assert.ok(existsSync(electronBin), `no electron binary at ${electronBin}`);

    const r = spawnSync(electronBin, [join(ROOT, 'dist', 'cli.js'), '--help'], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', REDBOT_DATA: join(userDir, 'data') },
      timeout: 60_000
    });

    assert.equal(r.status, 0, `exit ${r.status}. stderr: ${r.stderr}`);
    assert.match(r.stdout, /redbot — Reddit engagement assistant/,
      'the Electron binary did not run the CLI');
  });

  test('without the flag, the child never exits — which is what hung provisioning', () => {
    /**
     * The other half of the proof, and it took two wrong versions to get right. Both wrong
     * versions are recorded because each was a plausible-sounding claim that measurement killed:
     *
     *   1. "without the flag the CLI does not run" — FALSE. Electron runs a plain script as an
     *      "app", and `cli.js` calls `process.exit()` itself, so it printed usage and exited.
     *   2. "without the flag stdout does not reach the parent" — FALSE under spawnSync. That was
     *      an artefact of the shell probe redirecting with `>`; with piped stdio the output is
     *      captured either way.
     *
     * What IS true, and is the actual mechanism: without ELECTRON_RUN_AS_NODE the child is a full
     * Electron app process, so it keeps its event loop alive waiting for app-lifecycle events and
     * NEVER EXITS when the script finishes. That is precisely what hung `provision()` — the
     * migration runner had already applied the schema, and spawnSync sat waiting for a process
     * that was never going to leave. `process.versions.electron` is set in both cases, so it is
     * not the discriminator; exiting is.
     *
     * A script that does NOT call process.exit is therefore the only honest probe.
     */
    const electronBin = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
    const probe = join(userDir, 'probe-exit.mjs');
    writeFileSync(probe, "console.log('DONE');\n");

    const withoutFlag = { ...process.env };
    delete withoutFlag.ELECTRON_RUN_AS_NODE;
    const a = spawnSync(electronBin, [probe], { encoding: 'utf8', env: withoutFlag, timeout: 8_000 });
    // spawnSync reports a timeout as status null + signal SIGTERM; either proves it did not exit.
    assert.ok(a.status !== 0,
      `the child exited with ${a.status} without the flag, so this proves nothing about the flag`);

    const b = spawnSync(electronBin, [probe], {
      encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 8_000
    });
    assert.equal(b.status, 0, `with the flag the child must exit 0, got ${b.status}`);
    assert.match(b.stdout ?? '', /DONE/, 'with the flag the script must actually have run');
  });
});

/* ==================================================================== *
 * First boot opens on Setup when a requirement is blocking
 *
 * The previous first-run signal opened the WALKTHROUGH, was keyed on a flag that the ? button also
 * set, and remembered rather than re-derived. A screenshot taken before this change showed the
 * console opening on Today with the guide overlay up while the nav read "Setup 1" — an unmet
 * requirement, unmentioned. These assertions are what stop that returning.
 * ==================================================================== */
describe('the first-boot setup gate', () => {
  test('/api/setup reports the shared tiered requirement set, browser included', async () => {
    const s = await page.evaluate(() => fetch('/api/setup').then((r) => r.json()));
    assert.ok(Array.isArray(s.requirements) && s.requirements.length >= 5,
      `expected the requirement set, got ${JSON.stringify(s.requirements)?.slice(0, 200)}`);
    const ids = s.requirements.map((r) => r.id);
    for (const id of ['database', 'vault', 'llm', 'account', 'browser', 'sources']) {
      assert.ok(ids.includes(id), `the set is missing "${id}"`);
    }
    // The measured gap this closes: setupStatus() previously mentioned Chrome zero times.
    assert.ok(JSON.stringify(s).toLowerCase().includes('browser'), 'the browser is still unreported');
    for (const r of s.requirements) {
      assert.ok(['blocking', 'advisory'].includes(r.tier), `bad tier ${r.tier}`);
    }
  });

  test('nothing opens itself on boot — not Settings, not the walkthrough', async () => {
    /**
     * 2026-08-03: Settings no longer opens on a durable blocker. The console opens on the console.
     *
     * The bar this has to clear is that nothing is HIDDEN by that, which is why the next test
     * matters as much as this one: the banner must still name what is blocking. A boot that
     * neither interrupts nor reports would not be an improvement, it would be a silent broken
     * install — the failure mode `redbot doctor` and `paintBanner` both exist to prevent.
     *
     * Exercised on the hardest case deliberately: a fresh throwaway install has no account and no
     * operator, so if anything were ever going to take the screen, it would be here.
     */
    const s = await page.evaluate(() => fetch('/api/setup').then((r) => r.json()));
    if (!s.blocking.length) {
      assert.fail('no blocking requirement on a fresh install — this cannot be exercised');
    }
    const durable = s.blocking.filter((b) => b.id !== 'browser');
    assert.ok(durable.length,
      `only transient blockers on a fresh install (${s.blocking.map((b) => b.id).join(', ')}) ` +
      '— the case that used to open Settings is not present, so this proves nothing');

    const shown = await page.evaluate(() => ({
      panel: !document.querySelector('#settings')?.hidden,
      scrim: !document.querySelector('#scrim')?.hidden,
      guideOpen: !document.querySelector('#guide')?.hidden,
      today: !document.querySelector('#v-today')?.hidden
    }));
    assert.equal(shown.panel, false,
      'Settings opened itself on boot — a durable blocker must be reported, not shown');
    assert.equal(shown.scrim, false, 'the scrim is up with no panel behind it');
    assert.equal(shown.guideOpen, false, 'the walkthrough opened itself');
    assert.equal(shown.today, true, 'the app did not open on the console');
  });

  test('the gear still carries its attention dot while something is unmet', async () => {
    /* The dot is now one of the two things standing between a blocked install and silence. If it
       stops rendering, nothing on this screen says the install cannot run. */
    const dot = await page.evaluate(() =>
      Boolean(document.querySelector('#settingsBtn .g'))
      || /\d/.test(document.querySelector('#settingsBtn')?.getAttribute('title') ?? ''));
    assert.equal(dot, true, 'the gear reports nothing — a blocked install would look healthy');
  });

  test('the banner names what is blocking, and Setup renders the checklist', async () => {
    /* The banner is read BEFORE opening anything: since Settings stopped opening itself, this is
       the only thing on a booted screen that says the install cannot run. */
    const banner = await page.evaluate(() => document.querySelector('#banner')?.textContent ?? '');
    assert.match(banner, /Setup is not finished/, `banner said: ${banner.slice(0, 120)}`);

    /* The checklist is rendered by `setup()`, which `settings(true)` calls — so it has to be
       opened now rather than found already open. */
    await page.click('#settingsBtn');
    await page.waitForSelector('#settings:not([hidden])', { timeout: 5000 });
    const setupText = await page.evaluate(() => document.querySelector('#v-setup')?.textContent ?? '');
    assert.match(setupText, /redbot cannot run yet/, 'the checklist heading is missing');
    // Each unmet blocking row must carry its fix hint, or the screen is a diagnosis not a setup.
    const s = await page.evaluate(() => fetch('/api/setup').then((r) => r.json()));
    for (const b of s.blocking) {
      assert.ok(setupText.includes(b.label), `Setup does not list "${b.label}"`);
    }
  });

  test('the gate is not a trap — Settings closes and every screen is still reachable', async () => {
    /**
     * Same guarantee as before, through the doors that now exist.
     *
     * This clicked `[data-v="logs"]` and then `[data-v="setup"]`, and both tabs are gone: Log moved
     * INTO Settings and Setup became the panel itself. So it timed out on a selector rather than on
     * a trapped operator — the failure looked like the thing it was meant to catch.
     *
     * A modal gate is a trap if it cannot be dismissed, so the escape route is what gets asserted:
     * Escape closes it, the console underneath is live, and the gear puts it back. The panel is
     * reopened at the end because the tests after this one read the open checklist.
     *
     * Opened here first: since 2026-08-03 nothing opens it on boot. The gear TOGGLES
     * (`settings($('#settings').hidden)`), so a blind click is not "open" — if the previous test
     * left the panel up, clicking closes it, which is how this test first failed on a 30s wait for
     * a panel it had just dismissed. Asked and only then clicked, so it does not depend on the
     * order the tests happen to run in. Being open is the precondition; the point is that it lets
     * go.
     */
    if (await page.evaluate(() => document.querySelector('#settings')?.hidden)) {
      await page.click('#settingsBtn');
    }
    await page.waitForSelector('#settings:not([hidden])', { timeout: 5000 });
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => ({
      panel: !document.querySelector('#settings')?.hidden,
      scrim: !document.querySelector('#scrim')?.hidden
    }));
    assert.equal(closed.panel, false, 'Escape did not close Settings — the gate is a trap');
    assert.equal(closed.scrim, false, 'the scrim outlived the panel, so the console stays unclickable');

    /* Every remaining tab must actually change the screen. Setup is not among them by design. */
    for (const v of ['discovery', 'review', 'outcomes', 'accounts', 'today']) {
      await page.click(`.steps .step[data-v="${v}"]`);
      const on = await page.evaluate(
        (name) => !document.querySelector(`#v-${name}`)?.hidden, v);
      assert.equal(on, true, `the gate blocked navigation to ${v}, which locks a person out of the fix`);
    }

    await page.click('#settingsBtn');
    const reopened = await page.evaluate(() => !document.querySelector('#settings')?.hidden);
    assert.equal(reopened, true, 'the gear did not reopen Settings');
  });

  test('the setup gate renders — captured, not inferred', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const shot = join(SHOTS, 'first-boot-setup-gate.png');
    await page.screenshot({ path: shot });
    const { statSync } = await import('node:fs');
    assert.ok(statSync(shot).size > 20_000, 'the capture looks blank');
  });
});

/* One more, because a capture caught what an assertion had not: the checklist built its hint as
   `esc(detail) + '<span class="hint">…</span>'` and setupRow escaped it AGAIN, so the markup
   appeared on screen as literal angle brackets. A screenshot showed it; nothing else would have. */
test('the checklist renders no literal markup', async () => {
  const text = await page.evaluate(() => document.querySelector('#v-setup')?.textContent ?? '');
  assert.doesNotMatch(text, /<span/, 'raw HTML is being shown to the operator as text');
  assert.doesNotMatch(text, /&lt;|&amp;/, 'double-escaped entities are being shown as text');
});
