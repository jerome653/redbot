/**
 * The dependency checks, driven without a machine that has (or lacks) any of them.
 *
 * Everything `checkDependencies` touches is injected, so every branch is reachable here: Chrome
 * missing, Node too old, the Claude CLI absent, Playwright unresolvable. None of that can be
 * arranged on a real developer machine, which is exactly why it is worth testing.
 *
 * The Windows paths below are SYNTHETIC FIXTURES — user "x" does not exist on any machine. They are
 * inputs to an injected `exists()`, never touched on disk, and they have to look like real Windows
 * paths because what is under test is the matching of those shapes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkDependencies, missingDependencies, chromeCandidates, nodeVersionOk, parseNodeVersion,
  MIN_NODE, type Dependency
} from '../dependencies.js';

const PROGRAM_FILES = 'C:\\Program Files';
const PROGRAM_FILES_X86 = 'C:\\Program Files (x86)';
const LOCAL_APPDATA = 'C:\\Users\\x\\AppData\\Local';                                   // portable-exempt: synthetic fixture
const CHROME_MACHINE = `${PROGRAM_FILES}\\Google\\Chrome\\Application\\chrome.exe`;
const CHROME_PER_USER = `${LOCAL_APPDATA}\\Google\\Chrome\\Application\\chrome.exe`;
const CLAUDE_ON_PATH = 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd';               // portable-exempt: synthetic fixture

/** Everything present, Windows, CLI provider — the shape a healthy install answers with. */
const healthy = {
  platform: 'win32' as NodeJS.Platform,
  env: {
    ProgramFiles: PROGRAM_FILES,
    'ProgramFiles(x86)': PROGRAM_FILES_X86,
    LOCALAPPDATA: LOCAL_APPDATA
  } as NodeJS.ProcessEnv,
  nodeVersion: '24.18.0',
  provider: 'cli' as const,
  exists: (p: string) => p === CHROME_MACHINE,
  resolveModule: (m: string) => `/node_modules/${m}/index.js`,
  moduleVersion: () => '1.60.0',
  lookPath: async () => CLAUDE_ON_PATH
};

const byId = (ds: Dependency[], id: string) => ds.find((d) => d.id === id)!;

/* ---------------------------------------------------------------- version maths */

test('parseNodeVersion reads the two numbers that matter', () => {
  assert.deepEqual(parseNodeVersion('22.13.1'), { major: 22, minor: 13 });
  assert.deepEqual(parseNodeVersion('v24.0.0'), { major: 24, minor: 0 });
  assert.equal(parseNodeVersion('not a version'), null);
});

test('nodeVersionOk holds the floor, and a newer major clears it', () => {
  assert.equal(nodeVersionOk('24.0.0'), true, 'exactly the floor is enough');
  assert.equal(nodeVersionOk('24.18.0'), true, 'the runtime Electron 43 actually ships');
  assert.equal(nodeVersionOk('25.1.0'), true, 'a newer major clears it');
  /* 22 was the floor until 2026-08-26 and is now below it — src/proxy/align.ts needs an API 22
     does not have, and on 22 its timezone refusal fails open rather than loudly. */
  assert.equal(nodeVersionOk('22.13.0'), false, 'the old floor no longer passes');
  assert.equal(nodeVersionOk('20.19.0'), false, 'an older major fails');
});

/**
 * The floor here and `engines.node` in package.json must not drift.
 *
 * MIN_NODE is a literal because this has to answer inside a packaged asar, so nothing enforces the
 * two agree except this assertion.
 */
test('MIN_NODE matches engines.node in package.json', () => {
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8')
  ) as { engines?: { node?: string } };
  const declared = pkg.engines?.node ?? '';
  const m = /(\d+)\.(\d+)/.exec(declared);
  assert.ok(m, `engines.node ("${declared}") should carry a major.minor`);
  assert.equal(Number(m![1]), MIN_NODE.major, 'major drifted from package.json');
  assert.equal(Number(m![2]), MIN_NODE.minor, 'minor drifted from package.json');
});

/* ---------------------------------------------------------------- chrome discovery */

test('chromeCandidates covers machine-wide and per-user installs', () => {
  /* Platform named explicitly. Without it this reads `process.platform`, which makes it a
     Windows-only claim that merely happens to pass on a Windows runner — and it would fail on
     Linux for a reason that has nothing to do with what it tests. */
  const paths = chromeCandidates(healthy.env!, 'win32');
  assert.equal(paths.length, 3);
  assert.ok(paths.some((p) => p.includes('Program Files\\Google')), '64-bit install');
  assert.ok(paths.some((p) => p.includes('Program Files (x86)')), '32-bit install');
  /* The one that gets missed: an operator without admin rights installs Chrome per-user. */
  assert.ok(paths.some((p) => p.includes('AppData\\Local')), 'per-user install');
});

test('REDBOT_CHROME overrides and is looked at first', () => {
  const paths = chromeCandidates({ ...healthy.env, REDBOT_CHROME: 'D:\\portable\\chrome.exe' }, 'win32');
  assert.equal(paths[0], 'D:\\portable\\chrome.exe');
  assert.equal(paths.length, 4);
});

test('a Chrome installed only for this user is found, not reported missing', async () => {
  const ds = await checkDependencies({ ...healthy, exists: (p: string) => p === CHROME_PER_USER });
  const chrome = byId(ds, 'chrome');
  assert.equal(chrome.ok, true);
  assert.match(chrome.found!, /AppData\\Local/);
});

/* ---------------------------------------------------------------- the healthy case */

test('a fully equipped machine reports everything met and nothing missing', async () => {
  const ds = await checkDependencies(healthy);
  assert.deepEqual(ds.map((d) => d.id), ['node', 'playwright', 'chrome', 'claude-cli']);
  assert.equal(ds.every((d) => d.ok), true, ds.filter((d) => !d.ok).map((d) => d.detail).join(' | '));
  assert.deepEqual(missingDependencies(ds), []);
  assert.match(byId(ds, 'playwright').detail, /1\.60\.0/);
});

/* ---------------------------------------------------------------- each thing missing */

test('no Chrome is reported as not installed, with somewhere to get it', async () => {
  const ds = await checkDependencies({ ...healthy, exists: () => false });
  const chrome = byId(ds, 'chrome');
  assert.equal(chrome.ok, false);
  assert.equal(chrome.required, true);
  assert.match(chrome.detail, /no chrome\.exe was found/);
  assert.equal(chrome.fix.url, 'https://www.google.com/chrome/');
  assert.equal(missingDependencies(ds).length, 1);
});

test('an unresolvable Playwright is fatal and says so plainly', async () => {
  const ds = await checkDependencies({
    ...healthy,
    resolveModule: () => { throw new Error('Cannot find module'); },
    moduleVersion: () => null
  });
  const pw = byId(ds, 'playwright');
  assert.equal(pw.ok, false);
  assert.match(pw.detail, /cannot attach to a browser/);
});

test('playwright-core alone satisfies the check — the full package is not required', async () => {
  const ds = await checkDependencies({
    ...healthy,
    resolveModule: (m: string) => {
      if (m === 'playwright') throw new Error('Cannot find module');
      return `/node_modules/${m}/index.js`;
    },
    moduleVersion: (m: string) => (m === 'playwright' ? null : '1.60.0')
  });
  assert.equal(byId(ds, 'playwright').ok, true, 'connectOverCDP only needs playwright-core');
});

test('a missing Claude CLI is reported against the name actually looked for', async () => {
  const ds = await checkDependencies({ ...healthy, lookPath: async () => null });
  const cli = byId(ds, 'claude-cli');
  assert.equal(cli.ok, false);
  assert.match(cli.detail, /"claude" is not on PATH/);
});

test('REDBOT_CLAUDE_BIN is honoured, and named in the failure', async () => {
  const ds = await checkDependencies({
    ...healthy,
    env: { ...healthy.env, REDBOT_CLAUDE_BIN: 'claude-code' },
    lookPath: async () => null
  });
  assert.match(byId(ds, 'claude-cli').detail, /"claude-code" is not on PATH/);
});

test('a lookPath that throws is a missing CLI, not a crashed check', async () => {
  const ds = await checkDependencies({
    ...healthy,
    lookPath: async () => { throw new Error('spawn ENOENT'); }
  });
  assert.equal(byId(ds, 'claude-cli').ok, false);
});

test('an old Node fails the floor and points at the right fix', async () => {
  const ds = await checkDependencies({ ...healthy, nodeVersion: '20.11.0' });
  const node = byId(ds, 'node');
  assert.equal(node.ok, false);
  assert.match(node.detail, /older than the 24\.0/);
  assert.match(node.fix.hint, /installed desktop app carries its own Node/);
});

/* ---------------------------------------------------------------- the API-key path */

test('on the API-key path the Claude CLI is optional, not a blocker', async () => {
  const ds = await checkDependencies({ ...healthy, provider: 'api', lookPath: async () => null });
  const cli = byId(ds, 'claude-cli');
  assert.equal(cli.required, false, 'nothing calls the CLI when an API key is used');
  assert.equal(cli.ok, true);
  assert.match(cli.detail, /not needed/);
  assert.deepEqual(missingDependencies(ds), [], 'an API-key install must not be told to install a CLI');
});

/* ---------------------------------------------------------------- other platforms */

test('a non-Windows host now CHECKS Chrome instead of waving it through', async () => {
  /**
   * THIS TEST PINNED THE DEFECT, and had to move with the fix rather than be deleted.
   *
   * It asserted `ok: true` with "not checked on darwin" — a PASS for something nothing had
   * looked at, justified by "redbot packages for Windows only". What a build TARGETS says
   * nothing about the platform the code is RUNNING on, and a Linux install proved it on
   * 2026-09-03: a green dependency row, and an Open-Chrome button that could not find the
   * Chrome that was installed. Absence is reported as absence on every platform now.
   */
  const ds = await checkDependencies({ ...healthy, platform: 'darwin', env: {}, exists: () => false });
  const chrome = byId(ds, 'chrome');
  assert.equal(chrome.ok, false, 'no Chrome on the machine is a real answer, not an excused one');
  assert.doesNotMatch(chrome.detail, /not checked/);

  const present = await checkDependencies({
    ...healthy, platform: 'darwin', env: {},
    exists: (p: string) => p.includes('Google Chrome.app')
  });
  assert.equal(byId(present, 'chrome').ok, true);
});

/* ---------------------------------------------------------------- shape */

test('every dependency carries the fields the console renders', async () => {
  const ds = await checkDependencies({ ...healthy, exists: () => false, lookPath: async () => null });
  for (const d of ds) {
    assert.equal(typeof d.id, 'string');
    assert.equal(typeof d.label, 'string');
    assert.equal(typeof d.required, 'boolean');
    assert.equal(typeof d.ok, 'boolean');
    assert.equal(typeof d.detail, 'string');
    assert.ok(d.detail.length > 0, `${d.id} must say something`);
    assert.ok(d.fix && typeof d.fix.hint === 'string');
    /* A failing row has to tell somebody what to do about it. */
    if (!d.ok) assert.ok(d.fix.hint.length > 0, `${d.id} failed with no hint`);
  }
});

/* Python is not a redbot dependency; a row for it would be a permanently misleading one. */
test('nothing claims redbot needs Python', async () => {
  const ds = await checkDependencies(healthy);
  assert.equal(ds.some((d) => /python/i.test(d.id + d.label)), false);
});

/* ---------------------------------------------------------------- chrome, per platform */

/**
 * THE DEFECT THESE PIN, reported from a running Linux install on 2026-09-03:
 *
 *   "Chrome could not be found in the usual place. Set CHROME_PATH and try again."
 *
 * with Chrome sitting at /opt/google/chrome/chrome. `chromeCandidates` listed only Windows
 * paths, and `checkDependencies` ran the check only under `platform === 'win32'` — the other
 * branch reported a GREEN "not checked on linux — redbot packages for Windows only". So the
 * dependency row passed for something nothing had looked at, while the console's own
 * Open-Chrome button failed to find it, on the same install at the same moment.
 */
test('the candidate list follows the platform it is asked about', () => {
  const win = chromeCandidates({ ProgramFiles: 'C:\PF', 'ProgramFiles(x86)': 'C:\PF86' }, 'win32');
  assert.ok(win.every((p) => p.endsWith('chrome.exe')), win.join(' | '));

  const linux = chromeCandidates({}, 'linux');
  assert.ok(linux.includes('/opt/google/chrome/chrome'),
    'the Debian package installs the real binary here — this is the path the report named');
  assert.ok(linux.includes('/usr/bin/google-chrome'));
  assert.ok(!linux.some((p) => p.includes('chrome.exe')),
    'a Windows path on Linux is noise that can never match');

  const mac = chromeCandidates({}, 'darwin');
  assert.ok((mac[0] ?? '').includes('Google Chrome.app'));
});

test('a Chromium is only reached after every Chrome', () => {
  const linux = chromeCandidates({}, 'linux');
  const chrome = linux.findIndex((p) => p.includes('google-chrome'));
  const chromium = linux.findIndex((p) => p.includes('chromium'));
  assert.ok(chrome >= 0 && chromium >= 0);
  assert.ok(chrome < chromium, 'a Chromium is not a Chrome; it must never be preferred over one');
});

test('an explicit override wins, and BOTH names are honoured', () => {
  /* CHROME_PATH is the name the console's own error message tells people to set, so an
     operator who followed that instruction must not find it ignored — which is what happened
     when server.mjs listed it LAST behind two paths that existed. */
  const viaRedbot = chromeCandidates({ REDBOT_CHROME: '/custom/a' }, 'linux');
  assert.equal(viaRedbot[0], '/custom/a');

  const viaChromePath = chromeCandidates({ CHROME_PATH: '/custom/b' }, 'linux');
  assert.equal(viaChromePath[0], '/custom/b');

  const both = chromeCandidates({ REDBOT_CHROME: '/custom/a', CHROME_PATH: '/custom/b' }, 'linux');
  assert.deepEqual(both.slice(0, 2), ['/custom/a', '/custom/b'],
    'REDBOT_CHROME wins, but CHROME_PATH is still tried before the guesses');

  const win = chromeCandidates({ ProgramFiles: 'C:\PF', CHROME_PATH: 'C:\portable\chrome.exe' }, 'win32');
  assert.equal(win[0], 'C:\portable\chrome.exe', 'an override that is not first is not an override');
});

test('Chrome is CHECKED on Linux, not waved through as "not checked"', async () => {
  const deps = await checkDependencies({
    ...healthy, platform: 'linux', env: {},
    exists: (p) => p === '/opt/google/chrome/chrome'
  });
  const chrome = byId(deps, 'chrome');
  assert.equal(chrome.ok, true);
  assert.equal(chrome.found, '/opt/google/chrome/chrome', 'it must name what it found');
  assert.doesNotMatch(chrome.detail, /not checked/,
    'REGRESSION: a pass for something nothing looked at is the one thing this module must not do');
});

test('and a Linux machine with no Chrome is reported as missing, in words that fit the platform', async () => {
  const deps = await checkDependencies({ ...healthy, platform: 'linux', env: {}, exists: () => false });
  const chrome = byId(deps, 'chrome');
  assert.equal(chrome.ok, false);
  assert.equal(chrome.required, true);
  assert.doesNotMatch(chrome.detail, /chrome\.exe/,
    'nobody on Linux is looking for a file called chrome.exe');
  assert.match(chrome.fix.hint, /CHROME_PATH/, 'the hint must name the variable that works');
});
