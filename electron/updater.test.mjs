/**
 * The updater's state machine, driven without Electron.
 *
 * Everything electron/updater.mjs touches is injected, so a fake `autoUpdater` exercises every
 * branch here — including the ones that are expensive or destructive in real life (a 100 MB
 * download, and quitting the app to install). That is the point of the injection.
 *
 * THE TEST THAT MATTERS MOST is "nothing happens without apply()". electron-updater ships with
 * `autoDownload` and `autoInstallOnAppQuit` set to TRUE, so a version of this module that simply
 * forgot two lines would download in the background on every check and install on the next quit.
 * That is a silent behaviour change nobody would see in a screenshot, so it is pinned by assertion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdater, explainError, isNewerVersion } from './updater.mjs';

/**
 * A stand-in for electron-updater's autoUpdater.
 *
 * An EventEmitter, because the real one is: the module attaches an 'error' listener specifically
 * because an EventEmitter with no 'error' handler throws on emit, and that behaviour only shows up
 * against a real emitter.
 */
class FakeUpdater extends EventEmitter {
  constructor({ version = '2.0.0', onDownload = null, onCheck = null } = {}) {
    super();
    this.version = version;
    this.onDownload = onDownload;
    this.onCheck = onCheck;
    this.calls = { check: 0, download: 0, install: [] };
    /* The real defaults, so a module that fails to override them fails these tests. */
    this.autoDownload = true;
    this.autoInstallOnAppQuit = true;
    /* electron-updater derives this from the running version: `1.0.2` has no prerelease component,
       so the real default here is false. See the allowPrerelease test for why that breaks. */
    this.allowPrerelease = false;
    this.allowDowngrade = true;
  }
  async checkForUpdates() {
    this.calls.check++;
    if (this.onCheck) return this.onCheck(this);
    return { updateInfo: { version: this.version, releaseDate: '2026-07-31T00:00:00Z' } };
  }
  async downloadUpdate() {
    this.calls.download++;
    if (this.onDownload) return this.onDownload(this);
    this.emit('download-progress', { percent: 50, transferred: 50, total: 100, bytesPerSecond: 10 });
    this.emit('update-downloaded', { version: this.version });
    return ['C:\\temp\\redbot-Setup.exe'];
  }
  quitAndInstall(isSilent, isForceRunAfter) {
    this.calls.install.push({ isSilent, isForceRunAfter });
  }
}

/** An installed build, by default — the only configuration where updates are offered. */
function make(opts = {}) {
  const fake = opts.fake ?? new FakeUpdater(opts.fakeOpts);
  const seen = [];
  const updater = createUpdater({
    loadAutoUpdater: () => fake,
    isPackaged: opts.isPackaged ?? true,
    currentVersion: opts.currentVersion ?? '1.0.2',
    allowDev: opts.allowDev ?? false,
    /* Absent by default, so every existing test keeps exercising the unguarded path. */
    ...(opts.isBusy ? { isBusy: opts.isBusy } : {}),
    /* Same rule: only passed when a test is about the platform, so nothing else changes. */
    ...(opts.platform ? { platform: opts.platform } : {}),
    ...(opts.env ? { env: opts.env } : {}),
    broadcast: (s) => seen.push(s.phase)
  });
  return { updater, fake, seen };
}

/* ---------------------------------------------------------------- version ordering */

test('isNewerVersion compares the three numbers and ignores a tag suffix', () => {
  assert.equal(isNewerVersion('1.0.3', '1.0.2'), true);
  assert.equal(isNewerVersion('1.1.0', '1.0.9'), true);
  assert.equal(isNewerVersion('2.0.0', '1.9.9'), true);
  assert.equal(isNewerVersion('1.0.2', '1.0.2'), false, 'the same version is not newer');
  assert.equal(isNewerVersion('1.0.1', '1.0.2'), false, 'older is not newer');
  /* The suffix rule src/update.ts settled: `-desktop` must not sort BEFORE the plain version. */
  assert.equal(isNewerVersion('1.0.3-desktop', '1.0.2'), true);
  assert.equal(isNewerVersion('v1.0.3', '1.0.2'), true, 'a leading v is tolerated');
  assert.equal(isNewerVersion('nonsense', '1.0.2'), false, 'an unparseable version is never newer');
});

/* ---------------------------------------------------------------- the no-auto guarantee */

test('the updater turns electron-updater\'s automatic download and install OFF', async () => {
  const { updater, fake } = make();
  assert.equal(fake.autoDownload, true, 'precondition: the real default is on');
  assert.equal(fake.autoInstallOnAppQuit, true, 'precondition: the real default is on');

  await updater.check();

  assert.equal(fake.autoDownload, false, 'a check must never trigger a download');
  assert.equal(fake.autoInstallOnAppQuit, false, 'a download must never install itself on quit');
});

/**
 * The one that would have shipped a feature that never finds anything.
 *
 * electron-updater sets `allowPrerelease` from the RUNNING version, so a stable `1.0.2` gets false.
 * With it false, GitHubProvider asks `/releases/latest`, and that endpoint silently omits
 * prereleases — which is exactly what src/update.ts measured returning 404 against this repository.
 * Leaving the default would mean a release published as a prerelease is invisible forever.
 */
test('the updater looks at all releases, not just the ones GitHub calls latest', async () => {
  const { updater, fake } = make();
  assert.equal(fake.allowPrerelease, false, 'precondition: the real default for a stable version');

  await updater.check();

  assert.equal(fake.allowPrerelease, true,
    'a prerelease on the feed must still be found — /releases/latest hides them');
  assert.equal(fake.allowDowngrade, false,
    'reading the whole feed is only safe if the feed cannot walk the app backwards');
});

test('checking does not download and does not install', async () => {
  const { updater, fake } = make();
  const r = await updater.check();

  assert.equal(r.ok, true);
  assert.equal(r.newer, true);
  assert.equal(r.latest, '2.0.0');
  assert.equal(r.phase, 'available');
  assert.equal(fake.calls.download, 0, 'check() downloaded something');
  assert.equal(fake.calls.install.length, 0, 'check() installed something');
});

test('an up-to-date build reports none, not an update', async () => {
  const { updater, fake } = make({ currentVersion: '2.0.0', fakeOpts: { version: '2.0.0' } });
  const r = await updater.check();

  assert.equal(r.ok, true);
  assert.equal(r.newer, false);
  assert.equal(r.phase, 'none');
  assert.equal(fake.calls.download, 0);
  assert.equal(fake.calls.install.length, 0);
});

/* A feed that has rolled backwards must not be treated as an update. */
test('an older release on the feed is not offered', async () => {
  const { updater } = make({ currentVersion: '2.0.0', fakeOpts: { version: '1.0.0' } });
  const r = await updater.check();
  assert.equal(r.newer, false);
  assert.equal(r.phase, 'none');
});

/* ---------------------------------------------------------------- apply */

test('apply downloads once and installs silently with a relaunch', async () => {
  const { updater, fake, seen } = make();
  await updater.check();
  const r = await updater.apply();

  assert.equal(r.ok, true);
  assert.equal(r.installed, true);
  assert.equal(fake.calls.download, 1, 'the installer should be fetched exactly once');
  assert.deepEqual(fake.calls.install, [{ isSilent: true, isForceRunAfter: true }],
    'silent install and relaunch are both required for this to be invisible');
  assert.ok(seen.includes('downloading'), 'progress should reach the UI');
  assert.ok(seen.includes('installing'), 'the last painted state should be installing');
});

test('apply works without a prior check, by checking first', async () => {
  const { updater, fake } = make();
  const r = await updater.apply();

  assert.equal(r.installed, true);
  assert.equal(fake.calls.check, 1, 'apply should check when nothing is known yet');
  assert.equal(fake.calls.install.length, 1);
});

test('apply installs nothing when there is nothing newer', async () => {
  const { updater, fake } = make({ currentVersion: '2.0.0', fakeOpts: { version: '2.0.0' } });
  const r = await updater.apply();

  assert.equal(r.ok, true);
  assert.equal(r.installed, false);
  assert.equal(fake.calls.download, 0, 'nothing newer must not be downloaded');
  assert.equal(fake.calls.install.length, 0, 'nothing newer must not be installed');
});

/**
 * The guard that matters most on this whole surface.
 *
 * Installing calls quitAndInstall, which kills this process and every child of it — the console
 * server, and whatever CLI the console spawned. `ACTIONS.__reply` in tools/product/server.mjs is
 * marked `stoppable: false` because dying between "submit the comment" and "confirm it landed"
 * leaves a live comment on Reddit that redbot does not know it made. An update must never be the
 * thing that causes that.
 */
test('apply refuses to install while redbot is publishing, and keeps the download', async () => {
  const { updater, fake } = make({ isBusy: async () => '"send the reply" is running' });
  const r = await updater.apply();

  assert.equal(r.ok, false);
  assert.equal(r.installed, false);
  assert.equal(fake.calls.install.length, 0, 'the app must not restart mid-publish');
  assert.match(r.reason, /send the reply/, 'the refusal must name what it is waiting for');
  assert.equal(fake.calls.download, 1, 'the installer is fetched — only the restart is refused');
  assert.equal(r.phase, 'ready', 'a fetched installer leaves it ready, not back at available');
});

test('a second apply installs once the run has finished', async () => {
  let busy = 'a run is going';
  const { updater, fake } = make({ isBusy: async () => busy });

  const refused = await updater.apply();
  assert.equal(refused.ok, false);

  busy = null;
  const r = await updater.apply();
  assert.equal(r.installed, true);
  assert.equal(fake.calls.download, 1, 'the already-downloaded installer must not be fetched twice');
  assert.equal(fake.calls.install.length, 1);
});

test('a busy check that throws is treated as idle, not as a refusal', async () => {
  /* Fails open deliberately: everything that could be mid-flight is a child of the console
     server, so a console that cannot answer is a console running nothing — and a health probe
     must not be able to block the one button that fixes a broken install. */
  const { updater, fake } = make({ isBusy: async () => { throw new Error('console unreachable'); } });
  const r = await updater.apply();

  assert.equal(r.installed, true);
  assert.equal(fake.calls.install.length, 1);
});

test('progress is reported as a percentage while downloading', async () => {
  const states = [];
  const fake = new FakeUpdater();
  fake.onDownload = (f) => {
    f.emit('download-progress', { percent: 42.6, transferred: 426, total: 1000, bytesPerSecond: 100 });
    f.emit('update-downloaded', { version: f.version });
    return ['x'];
  };
  const updater = createUpdater({
    loadAutoUpdater: () => fake,
    isPackaged: true,
    currentVersion: '1.0.2',
    broadcast: (s) => states.push({ ...s })
  });

  await updater.apply();
  const progress = states.find((s) => s.phase === 'downloading' && s.percent > 0);
  assert.ok(progress, 'a downloading state should have been broadcast');
  assert.equal(progress.percent, 43, 'the percentage is rounded for display');
  assert.equal(progress.total, 1000);
});

/* ---------------------------------------------------------------- failure */

test('a failed download reports the reason and installs nothing', async () => {
  const fake = new FakeUpdater();
  fake.onDownload = () => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); };
  const { updater } = make({ fake });

  const r = await updater.apply();

  assert.equal(r.ok, false);
  assert.equal(r.phase, 'error');
  assert.equal(r.reason, 'could not reach the update server');
  assert.equal(fake.calls.install.length, 0, 'a failed download must never reach the installer');
});

test('a checksum mismatch is reported as such and nothing is installed', async () => {
  const fake = new FakeUpdater();
  fake.onDownload = () => { throw new Error('sha512 checksum mismatch, expected abc, got def'); };
  const { updater } = make({ fake });

  const r = await updater.apply();

  assert.equal(r.ok, false);
  assert.match(r.reason, /did not match the published checksum/);
  assert.equal(fake.calls.install.length, 0);
});

test('a retry after a failed download fetches again rather than installing a discarded file', async () => {
  let attempt = 0;
  const fake = new FakeUpdater();
  fake.onDownload = (f) => {
    attempt++;
    if (attempt === 1) throw new Error('ETIMEDOUT');
    f.emit('update-downloaded', { version: f.version });
    return ['x'];
  };
  const { updater } = make({ fake });

  const first = await updater.apply();
  assert.equal(first.ok, false);

  const second = await updater.apply();
  assert.equal(second.ok, true);
  assert.equal(fake.calls.download, 2, 'the second attempt must re-download');
  assert.equal(fake.calls.install.length, 1);
});

test('an error event with no listener would crash the process — one is attached', async () => {
  const { updater, fake } = make();
  await updater.check();
  /* If updater.mjs did not attach an 'error' listener, this emit throws and the test fails. */
  fake.emit('error', new Error('ENOTFOUND api.example.com'));
  assert.equal(updater.snapshot().phase, 'error');
  assert.equal(updater.snapshot().reason, 'could not reach the update server');
});

/* ---------------------------------------------------------------- dev runs */

test('a dev run refuses both verbs instead of throwing', async () => {
  const { updater, fake } = make({ isPackaged: false });

  const c = await updater.check();
  const a = await updater.apply();

  assert.equal(c.ok, false);
  assert.equal(c.reason, 'updates are only available in the installed app');
  assert.equal(a.ok, false);
  assert.equal(fake.calls.check, 0, 'a dev run must not reach electron-updater at all');
  assert.equal(fake.calls.download, 0);
  assert.equal(fake.calls.install.length, 0);
});

test('a dev run with REDBOT_DEV_UPDATES set does reach the updater', async () => {
  const { updater, fake } = make({ isPackaged: false, allowDev: true });
  const r = await updater.check();
  assert.equal(r.ok, true);
  assert.equal(fake.calls.check, 1);
  assert.equal(fake.forceDevUpdateConfig, true, 'the dev feed has to be switched on explicitly');
});

/* ---------------------------------------------------------------- snapshot */

test('snapshot answers a freshly reloaded page with the current phase', async () => {
  const { updater } = make();
  assert.equal(updater.snapshot().phase, 'idle');
  await updater.check();
  const s = updater.snapshot();
  assert.equal(s.phase, 'available');
  assert.equal(s.latest, '2.0.0');
  assert.equal(s.current, '1.0.2');
});

/* ---------------------------------------------------------------- error messages */

test('explainError turns the errors people actually hit into plain sentences', () => {
  assert.equal(explainError(new Error('net::ERR_CONNECTION_REFUSED')), 'could not reach the update server');
  assert.equal(explainError(new Error('Cannot find app-update.yml')),
    'this build has no update feed configured (app-update.yml is missing)');
  assert.match(explainError(new Error('HttpError: 404 status code 404')), /not found \(404\)/);

  /* The real failure a packaged build hits against a release published with only the .exe. It is
     also a 404, so it has to be recognised BEFORE the generic 404 arm or the actionable message is
     lost. This assertion is what pins that ordering. */
  const noMeta = new Error(
    'Cannot find latest.yml in the latest release artifacts '
    + '(https://github.com/jerome653/redbot/releases/download/v1.0.2/latest.yml): HttpError: 404 '
    + 'Please double check that your authentication token is correct.');
  assert.match(explainError(noMeta), /published without latest\.yml/);
  assert.match(explainError(new Error('status code 403')), /refused the request/);

  const signature = new Error('New version 2.0.0 is not signed by the application owner: x');
  signature.code = 'ERR_UPDATER_INVALID_SIGNATURE';
  assert.match(explainError(signature), /not signed by the expected publisher/);

  const none = new Error('No published versions');
  none.code = 'ERR_UPDATER_NO_PUBLISHED_VERSIONS';
  assert.equal(explainError(none), 'no release has been published yet');

  /* Anything unrecognised keeps its own words rather than becoming "update failed". */
  assert.equal(explainError(new Error('something specific and searchable')), 'something specific and searchable');
});

/* ---------------------------------------------------------------- Linux, and the null answer */

/**
 * THE DEFECT THIS FILE'S NEWEST TESTS EXIST FOR.
 *
 * `AppUpdater.checkForUpdates()` RESOLVES WITH NULL when the updater is not active on this
 * installation — read from the installed electron-updater 6.8.9, `AppUpdater.js:253`:
 *
 *     if (!this.isUpdaterActive()) { return Promise.resolve(null); }
 *
 * It is not an error and it does not reject. The check used to read `result?.updateInfo?.version`
 * straight off that null, get null, compute `newer = false`, and settle in the `phase: 'none'`
 * arm — which the console renders as "You are on the latest." An installation that could not
 * update itself at all therefore gave the most reassuring answer available, WORD FOR WORD the
 * same answer a genuinely current machine gives. Nothing on the screen could tell them apart.
 *
 * On Linux this is the default rather than an edge: `main.js:50` builds an `AppImageUpdater` for
 * every non-Windows, non-macOS platform, and `AppImageUpdater.js:18` reports inactive whenever
 * `APPIMAGE` is unset — a .deb install, an unpacked directory, `npx electron .` from a clone.
 */
const nullCheck = () => ({ fakeOpts: { onCheck: () => null } });

test('a null from checkForUpdates is never reported as "you are on the latest"', async () => {
  const { updater } = make({ ...nullCheck(), platform: 'linux', env: {} });
  const r = await updater.check();

  assert.equal(r.ok, false, 'an installation that cannot update has not succeeded at checking');
  assert.equal(r.phase, 'unavailable');
  assert.notEqual(r.phase, 'none', 'phase "none" is the up-to-date answer and must not be reused here');
  assert.equal(r.newer, false);
  assert.match(r.reason, /AppImage/, 'the reason must name the actual cause, not a generic failure');
});

test('the reason distinguishes an AppImage-less run, a Snap, and everything else', async () => {
  const linux = await make({ ...nullCheck(), platform: 'linux', env: {} }).updater.check();
  assert.match(linux.reason, /APPIMAGE is unset/);

  const snap = await make({ ...nullCheck(), platform: 'linux', env: { SNAP: '/snap/redbot' } }).updater.check();
  assert.match(snap.reason, /snapd/, 'a Snap is updated by snapd and saying "download the AppImage" is wrong');

  const mac = await make({ ...nullCheck(), platform: 'darwin', env: {} }).updater.check();
  assert.match(mac.reason, /macOS/);
});

test('a running AppImage is NOT told it needs an AppImage', async () => {
  /* The env var is what electron-updater itself keys on, so it is what this keys on. With it set
     the updater is active, the fake answers normally, and the ordinary path must be untouched. */
  const { updater } = make({ platform: 'linux', env: { APPIMAGE: '/home/j/redbot-3.5.1-x64.AppImage' } });
  const r = await updater.check();
  assert.equal(r.phase, 'available', 'a live AppImage checks for updates like any other install');
  assert.equal(r.newer, true);
});

test('apply() refuses the same way rather than reporting a successful no-op', async () => {
  /**
   * The second half of the same defect, and the worse half: `apply()` reached its
   * `if (!newer) return { ok: true, installed: false }` arm and logged "nothing newer to
   * install" — an OK result, on a machine where installing was never possible.
   */
  const { updater, fake } = make({ ...nullCheck(), platform: 'linux', env: {} });
  const r = await updater.apply();

  assert.equal(r.ok, false, 'a refusal must not be reported as ok');
  assert.equal(r.phase, 'unavailable');
  assert.equal(fake.calls.download, 0, 'nothing may be downloaded');
  assert.deepEqual(fake.calls.install, [], 'and nothing may be installed');
});

test('the Windows path is unchanged by any of this', async () => {
  /* The null branch must not have moved the ordinary answer. A real check still resolves with an
     updateInfo, and that still means available/none as before. */
  const { updater } = make({ platform: 'win32', env: {} });
  const r = await updater.check();
  assert.equal(r.phase, 'available');
  assert.equal(r.latest, '2.0.0');

  const current = make({ platform: 'win32', env: {}, currentVersion: '2.0.0' });
  const same = await current.updater.check();
  assert.equal(same.phase, 'none', 'genuinely up to date is still "none"');
  assert.equal(same.reason, null, 'and carries no reason, because nothing is wrong');
});

test('explainError names the two AppImage failures', () => {
  const oldFile = new Error('APPIMAGE env is not defined');
  oldFile.code = 'ERR_UPDATER_OLD_FILE_NOT_FOUND';
  assert.match(explainError(oldFile), /did not start from one/,
    'the raw text reads like a variable to set; it is not');

  assert.match(explainError(new Error('Cannot find redbot-3.5.1-x64.AppImage')),
    /no Linux AppImage/);
});
