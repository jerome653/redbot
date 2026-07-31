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
  nodeVersion: '22.13.0',
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
  assert.equal(nodeVersionOk('22.13.0'), true, 'exactly the floor is enough');
  assert.equal(nodeVersionOk('22.14.0'), true);
  assert.equal(nodeVersionOk('24.1.0'), true, 'a newer major clears it');
  assert.equal(nodeVersionOk('22.12.9'), false, 'one minor below the floor fails');
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
  const paths = chromeCandidates(healthy.env!);
  assert.equal(paths.length, 3);
  assert.ok(paths.some((p) => p.includes('Program Files\\Google')), '64-bit install');
  assert.ok(paths.some((p) => p.includes('Program Files (x86)')), '32-bit install');
  /* The one that gets missed: an operator without admin rights installs Chrome per-user. */
  assert.ok(paths.some((p) => p.includes('AppData\\Local')), 'per-user install');
});

test('REDBOT_CHROME overrides and is looked at first', () => {
  const paths = chromeCandidates({ ...healthy.env, REDBOT_CHROME: 'D:\\portable\\chrome.exe' });
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
  assert.match(node.detail, /older than the 22\.13/);
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

test('a non-Windows host says Chrome was not checked rather than claiming it is missing', async () => {
  const ds = await checkDependencies({ ...healthy, platform: 'darwin', exists: () => false });
  const chrome = byId(ds, 'chrome');
  assert.equal(chrome.ok, true);
  assert.match(chrome.detail, /not checked on darwin/);
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
