/**
 * The update check: version ordering, which release gets offered, and what happens when the
 * network does not cooperate.
 *
 * No network is touched. `checkForUpdate` takes an injected `fetch`, so every branch an operator
 * could hit — a newer release, the one they are already running, a rate limit, a socket that
 * never answers, a repository that returns junk — is driven here deterministically.
 *
 * THE TRAP THIS FILE EXISTS FOR. GitHub's `/releases/latest` silently EXCLUDES prereleases.
 * Measured against the real repository while writing this: it answered **404**, because the only
 * published release is flagged prerelease. An update check built on that endpoint would report
 * "up to date" forever. So `pickLatest` reads the full list, and the fixture below is shaped like
 * the real payload — prerelease flag and all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-update-'));
const TMP = process.env.REDBOT_DATA;
delete process.env.REDBOT_ACCOUNT;

const { parseVersion, isNewer, pickLatest, checkForUpdate, currentVersion } =
  await import('../update.js');

/** A response object shaped like the part of `fetch`'s that checkForUpdate actually uses. */
const respond = (status: number, body: unknown): typeof fetch =>
  (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  name: `redbot ${tag}`,
  html_url: `https://github.com/jerome653/redbot/releases/tag/${tag}`,
  published_at: '2026-07-30T12:59:02Z',
  draft: false,
  prerelease: false,
  assets: [{
    name: 'redbot-Setup-0.1.0.exe',
    browser_download_url: `https://github.com/jerome653/redbot/releases/download/${tag}/redbot-Setup-0.1.0.exe`,
    size: 102657779
  }],
  ...extra
});

test('a version parses whether or not it is dressed as a tag', () => {
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3, suffix: '' });
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, suffix: '' });
  assert.deepEqual(parseVersion('v0.1.0-desktop'), { major: 0, minor: 1, patch: 0, suffix: '-desktop' });
  assert.equal(parseVersion('not-a-version'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(null), null);
  assert.equal(parseVersion(undefined), null);
});

test('ordering is the three numbers, and a suffix never demotes a release', () => {
  const v = (s: string) => parseVersion(s)!;
  assert.equal(isNewer(v('0.2.0'), v('0.1.0')), true);
  assert.equal(isNewer(v('1.0.0'), v('0.9.9')), true);
  assert.equal(isNewer(v('0.1.1'), v('0.1.0')), true);
  assert.equal(isNewer(v('0.1.0'), v('0.1.0')), false, 'the same version is not an update');
  assert.equal(isNewer(v('0.1.0'), v('0.2.0')), false, 'older is never offered');
  /* Strict semver ranks 0.1.0-desktop BELOW 0.1.0, which would hide the release this very app
     ships from. The suffix is display only — this is the assertion that pins that decision. */
  assert.equal(isNewer(v('v0.2.0-desktop'), v('0.1.0')), true);
  assert.equal(isNewer(v('v0.1.0-desktop'), v('0.1.0')), false);
  /* Two-digit components must not be compared as strings: "10" < "9" lexically. */
  assert.equal(isNewer(v('0.10.0'), v('0.9.0')), true);
});

test('the newest release is chosen by version, not by publish date', () => {
  const picked = pickLatest([
    release('v0.1.0'),
    release('v0.3.0', { published_at: '2026-01-01T00:00:00Z' }),   // older DATE, newer version
    release('v0.2.0', { published_at: '2026-09-09T00:00:00Z' })
  ]);
  assert.equal(picked?.tag, 'v0.3.0', 'a hotfix published later must not offer a downgrade');
});

test('a prerelease is still offered — /releases/latest would have hidden it', () => {
  const picked = pickLatest([release('v0.2.0', { prerelease: true })]);
  assert.equal(picked?.tag, 'v0.2.0');
  assert.equal(picked?.prerelease, true, 'flagged, so the notice can say so');
});

test('drafts and unparseable tags are ignored', () => {
  assert.equal(pickLatest([release('v9.9.9', { draft: true })]), null);
  assert.equal(pickLatest([release('nightly')]), null);
  assert.equal(pickLatest([]), null);
  assert.equal(pickLatest(null), null, 'a non-array payload is not a crash');
  assert.equal(pickLatest({ message: 'Not Found' }), null);
  // A draft alongside a real release must not win.
  assert.equal(pickLatest([release('v9.9.9', { draft: true }), release('v0.2.0')])?.tag, 'v0.2.0');
});

/**
 * PLATFORM IS PASSED EXPLICITLY FROM HERE DOWN.
 *
 * These assertions are about the Windows installer, and they used to rely on `process.platform`
 * being win32 — true on this machine and on the windows-latest runner, and false the moment
 * anybody runs the suite on Linux, where they would fail for a reason that has nothing to do with
 * what they test. A test whose result depends on an ambient value is not testing what its name
 * says. The platform is now an argument, so each one states which platform it is about.
 */
test('the installer asset is found, and only https urls survive', () => {
  const ok = pickLatest([release('v0.2.0')], 'win32');
  assert.equal(ok?.download?.name, 'redbot-Setup-0.1.0.exe');
  assert.equal(ok?.download?.size, 102657779);
  assert.match(ok!.download!.url, /^https:\/\/github\.com\//);

  /* These end up as an href the operator clicks. A javascript: url would run in the renderer. */
  const evil = pickLatest([release('v0.2.0', {
    html_url: 'javascript:alert(1)',
    assets: [{ name: 'x.exe', browser_download_url: 'javascript:alert(2)', size: 1 }]
  })], 'win32');
  assert.equal(evil?.download, null, 'a non-https asset is dropped, not offered');
  assert.equal(evil?.url, 'https://github.com/jerome653/redbot/releases',
    'a non-https release link falls back to the releases page');

  const insecure = pickLatest([release('v0.2.0', {
    assets: [{ name: 'x.exe', browser_download_url: 'http://example.com/x.exe', size: 1 }]
  })], 'win32');
  assert.equal(insecure?.download, null, 'plain http is not good enough for an executable');
});

test('a release with no .exe is still reported, just without a download', () => {
  const picked = pickLatest(
    [release('v0.2.0', { assets: [{ name: 'notes.txt', browser_download_url: 'https://x/y', size: 1 }] })], 'win32');
  assert.equal(picked?.tag, 'v0.2.0');
  assert.equal(picked?.download, null);
});

/* ---------------------------------------------------------------- which asset, on which machine */

/**
 * THE DEFECT THESE PIN. The asset filter was `/\.exe$/i`, unconditionally, justified by a comment
 * saying Windows is the only platform this app packages for. That is a fact about the BUILD. The
 * platform the CHECK RUNS ON is a different fact, and merging the two meant a Linux console
 * offered `redbot-Setup-3.5.1.exe` beneath a button reading "Download the installer" — handing
 * somebody a file their machine cannot execute, with nothing on screen saying so.
 */
const multi = (tag: string) => release(tag, {
  assets: [
    { name: 'redbot-Setup-0.2.0.exe', browser_download_url: 'https://github.com/j/r/redbot-Setup-0.2.0.exe', size: 103 },
    { name: 'redbot-0.2.0-x64.AppImage', browser_download_url: 'https://github.com/j/r/redbot-0.2.0-x64.AppImage', size: 120 },
    { name: 'latest-linux.yml', browser_download_url: 'https://github.com/j/r/latest-linux.yml', size: 1 }
  ]
});

test('each platform is offered the asset it can actually run', () => {
  assert.equal(pickLatest([multi('v0.2.0')], 'win32')?.download?.name, 'redbot-Setup-0.2.0.exe');
  assert.equal(pickLatest([multi('v0.2.0')], 'linux')?.download?.name, 'redbot-0.2.0-x64.AppImage');
});

test('Linux is never handed the Windows installer', () => {
  /* The whole release, with only a .exe in it — every release published before the linux target
     existed. The honest answer is no download, not the wrong one. */
  const picked = pickLatest([release('v0.2.0')], 'linux');
  assert.equal(picked?.tag, 'v0.2.0', 'the release is still reported');
  assert.equal(picked?.download, null, 'but nothing runnable is offered');
  assert.equal(picked?.url, 'https://github.com/jerome653/redbot/releases/tag/v0.2.0',
    'and the release page is still reachable');
});

test('an unknown platform matches nothing rather than falling back to Windows', () => {
  assert.equal(pickLatest([multi('v0.2.0')], 'freebsd')?.download, null);
  assert.equal(pickLatest([multi('v0.2.0')], 'darwin')?.download, null,
    'no .dmg in this release, so macOS gets no download either');
});

test('checkForUpdate carries the platform through to the asset choice', async () => {
  const payload = [multi('v9.9.9')];
  const onLinux = await checkForUpdate({
    fetchImpl: respond(200, payload), current: '0.1.0', platform: 'linux'
  });
  assert.equal(onLinux.ok, true);
  assert.equal((onLinux as { release: { download: { name: string } } }).release.download.name,
    'redbot-0.2.0-x64.AppImage');

  const onWindows = await checkForUpdate({
    fetchImpl: respond(200, payload), current: '0.1.0', platform: 'win32'
  });
  assert.equal((onWindows as { release: { download: { name: string } } }).release.download.name,
    'redbot-Setup-0.2.0.exe');
});

test('a newer release is reported as newer', async () => {
  /**
   * `platform` IS NAMED HERE, and the omission was caught by running this suite on Linux.
   *
   * The fixture release carries one asset, a .exe. Without the argument this fell through to
   * `process.platform` — win32 on the development machine and on the windows-latest runner, so
   * green in both — and on an actual Linux box `download` is correctly undefined, because there
   * is no Linux asset in that release. The CODE was right; the assertion was making a
   * Windows-only claim without saying so. Measured on cardinal: 18 passed, this one failed.
   *
   * The rest of the assertions are platform-independent and are what this test is named for.
   */
  const r = await checkForUpdate({
    current: '0.1.0', fetchImpl: respond(200, [release('v0.2.0')]), platform: 'win32'
  });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.newer, true);
  assert.equal(r.ok && r.latest, 'v0.2.0');
  assert.equal(r.ok && r.release?.download?.name, 'redbot-Setup-0.1.0.exe');
});

test('the version you are already running is not an update', async () => {
  const r = await checkForUpdate({ current: '0.1.0', fetchImpl: respond(200, [release('v0.1.0-desktop')]) });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.newer, false, 'this is the exact case the shipped build is in');
});

test('a rate limit says so, rather than blaming the network', async () => {
  const r = await checkForUpdate({ current: '0.1.0', fetchImpl: respond(403, {}) });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : '', /rate-limited/);
});

test('being offline is quiet, and never throws', async () => {
  const dead = (async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); }) as unknown as typeof fetch;
  const r = await checkForUpdate({ current: '0.1.0', fetchImpl: dead });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : '', /could not reach GitHub/);
});

test('a 404 — what /releases/latest actually returns here — is handled, not thrown', async () => {
  const r = await checkForUpdate({ current: '0.1.0', fetchImpl: respond(404, { message: 'Not Found' }) });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : '', /404/);
});

test('a junk payload reports no update rather than crashing a screen', async () => {
  const r = await checkForUpdate({ current: '0.1.0', fetchImpl: respond(200, { message: 'Not Found' }) });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.newer, false);
  assert.equal(r.ok && r.release, null);
});

test('an unreadable local version fails closed instead of offering everything', async () => {
  const r = await checkForUpdate({ current: 'unknown', fetchImpl: respond(200, [release('v9.9.9')]) });
  assert.equal(r.ok, false, 'if we do not know what we are running, we cannot say what is newer');
});

test('this build reports a real version', () => {
  assert.match(currentVersion(), /^\d+\.\d+\.\d+/);
});

process.on('exit', () => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});
