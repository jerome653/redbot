/**
 * The three traps that have each already cost a release, as tests instead of comments.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST EXISTS.
 *
 * Clark's machine, boot log, 2026-08-12 — four times in thirty-five seconds:
 *
 *   ERROR updater  Cannot find latest.yml in the latest release artifacts
 *                  (.../releases/download/v2.0.2/latest.yml): HttpError: 404
 *
 * That install is still on 2.0.2. An app is the last place this can be found: by the time it says
 * so, the release is published and every machine on that version has silently stopped updating.
 *
 * electron-builder.yml documents each trap in prose written after it cost something. Prose cannot
 * fail a build, so each one is a case below, with the numbers from the release it actually cost.
 * ---------------------------------------------------------------------------
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRelease, readLatestYml } from './verify-release.mjs';

/** A real latest.yml, byte for byte, from release-upload/. */
const GOOD_YML = `version: 3.5.1
files:
  - url: redbot-Setup-3.5.1.exe
    sha512: AKPMlcLI6RA43+O87oWzE9zvfei1NIW+u2Mt/rzhx/0VQkySHKCHddNYwuo5IvFqTu3CvQBeDAMvnP1O/5g8KQ==
    size: 103018682
path: redbot-Setup-3.5.1.exe
sha512: AKPMlcLI6RA43+O87oWzE9zvfei1NIW+u2Mt/rzhx/0VQkySHKCHddNYwuo5IvFqTu3CvQBeDAMvnP1O/5g8KQ==
releaseDate: '2026-08-26T07:03:49.040Z'
`;

const GOOD_ASSETS = [
  { name: 'latest.yml', size: 402 },
  { name: 'redbot-Setup-3.5.1.exe', size: 103018682 },
  { name: 'redbot-Setup-3.5.1.exe.blockmap', size: 110234 }
];

const ok = (over = {}) => verifyRelease({ tag: 'v3.5.1', assets: GOOD_ASSETS, latestYml: GOOD_YML, ...over });

describe('the manifest reader', () => {
  test('reads the fields the updater depends on', () => {
    const y = readLatestYml(GOOD_YML);
    assert.equal(y.version, '3.5.1');
    assert.equal(y.path, 'redbot-Setup-3.5.1.exe');
    assert.ok(y.sha512?.startsWith('AKPMlcLI'));
    assert.deepEqual(y.files, [{ url: 'redbot-Setup-3.5.1.exe', size: 103018682 }]);
  });

  test('reports a missing field as missing rather than guessing at it', () => {
    const y = readLatestYml('version: 3.5.1\n');
    assert.equal(y.version, '3.5.1');
    assert.equal(y.path, null);
    assert.equal(y.sha512, null);
    assert.deepEqual(y.files, []);
  });
});

describe('a release an installed app can update from', () => {
  test('passes, and says which file it would fetch', () => {
    const v = ok();
    assert.equal(v.ok, true, `expected no problems, got: ${v.problems.join(' · ')}`);
    assert.deepEqual(v.warnings, []);
    assert.equal(v.installer.name, 'redbot-Setup-3.5.1.exe');
  });
});

describe('THE 404 — v2.0.2, and every install still on it', () => {
  test('a release without latest.yml is refused, in the updater\'s own words', () => {
    const v = ok({ assets: GOOD_ASSETS.filter((a) => a.name !== 'latest.yml') });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /latest\.yml is not attached/);
  });

  test('an unreadable latest.yml is not treated as an absent one', () => {
    const v = ok({ latestYml: null });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /could not be read/);
  });
});

describe('THE FILENAME TRAP — the disk name is not the manifest name', () => {
  test('an installer uploaded as "redbot Setup 3.5.1.exe" is caught, and both names are shown', () => {
    /* electron-builder writes the file with SPACES and sanitises the name in latest.yml to
       HYPHENS. Upload the disk name and the updater fetches a 404 forever, on a release that
       looks complete. This already cost one release before artifactName was pinned. */
    const v = ok({
      assets: [
        { name: 'latest.yml', size: 402 },
        { name: 'redbot Setup 3.5.1.exe', size: 103018682 },
        { name: 'redbot Setup 3.5.1.exe.blockmap', size: 110234 }
      ]
    });
    assert.equal(v.ok, false);
    const said = v.problems.join(' ');
    assert.match(said, /points at "redbot-Setup-3\.5\.1\.exe"/);
    assert.match(said, /"redbot Setup 3\.5\.1\.exe"/, 'the name that IS there has to be named too');
  });
});

describe('THE STUB TRAP — 726,824 bytes where 103 MB is expected', () => {
  test('the nsis-web downloader published under the installer\'s name is caught by size', () => {
    /* Caught by hand on 2026-08-13 before upload. Publishing it would leave every update
       installing a downloader instead of the app. */
    const v = ok({
      assets: [
        { name: 'latest.yml', size: 402 },
        { name: 'redbot-Setup-3.5.1.exe', size: 726824 },
        { name: 'redbot-Setup-3.5.1.exe.blockmap', size: 110234 }
      ]
    });
    assert.equal(v.ok, false);
    const said = v.problems.join(' ');
    assert.match(said, /726824 bytes on the release and 103018682 in latest\.yml/);
    assert.match(said, /web stub uploaded as the installer/, 'and it says what that size means');
  });

  test('a size that merely differs is reported without the stub diagnosis', () => {
    const v = ok({
      assets: [
        { name: 'latest.yml', size: 402 },
        { name: 'redbot-Setup-3.5.1.exe', size: 103018600 },
        { name: 'redbot-Setup-3.5.1.exe.blockmap', size: 110234 }
      ]
    });
    assert.equal(v.ok, false);
    assert.doesNotMatch(v.problems.join(' '), /web stub/, 'an 82-byte difference is not a stub');
  });
});

describe('THE DRAFT TRAP — published-looking and invisible', () => {
  test('a draft release is refused even when every asset is right', () => {
    const v = ok({ draft: true });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /DRAFT/);
  });
});

describe('the version and the tag must agree', () => {
  test('a manifest naming a different version is caught', () => {
    const v = ok({ tag: 'v3.5.2' });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /says version 3\.5\.1 but the tag is v3\.5\.2/);
  });

  test('the leading v is not the disagreement', () => {
    assert.equal(ok({ tag: '3.5.1' }).ok, true, 'v3.5.1 and 3.5.1 are the same version');
  });
});

describe('the blockmap', () => {
  test('is a warning, not a refusal — an update still works without it', () => {
    /* The boot log complained about this one alongside the 404, but electron-updater falls back
       to a full download, which is slow rather than broken. Two sha512 mismatches on 08-13 and
       08-14 did exactly that fallback and the updates landed. */
    const v = ok({ assets: GOOD_ASSETS.filter((a) => !a.name.endsWith('.blockmap')) });
    assert.equal(v.ok, true, 'a missing blockmap must not fail a release that can be installed');
    assert.match(v.warnings.join(' '), /fall back to a full download/);
  });
});
