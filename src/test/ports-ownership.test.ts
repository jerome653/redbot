/**
 * Who owns a debugging port — and what happens when the machine will not say.
 *
 * THE REPORTED DEFECT. On a second machine both accounts rendered
 *
 *   Port 9222  cannot be identified
 *   Something is answering on 9222 (Chrome/150.0.7871.187), but redbot could not confirm it is
 *   this account's browser.
 *
 * while the browsers were genuinely those accounts' own and everything else worked. The process
 * table lookup was coming back empty, CDP answering was correctly not accepted as proof, and the
 * screen fell through to the fail-closed `unknown` state.
 *
 * Two things were wrong, and they are tested separately below:
 *
 *   1. EVERY way the lookup can fail produced the same silent empty map — a blocked PowerShell, a
 *      timeout, a non-zero exit, unparseable output and an idle machine with nothing listening were
 *      indistinguishable. So the message could not say why, and there was nothing to act on.
 *   2. There was only ONE way to prove ownership. When that way is unavailable, a correct install
 *      is reported as unproven forever.
 *
 * `profileInUse` is the second proof. Chrome holds `<user-data-dir>\lockfile` open while it runs —
 * measured on Chrome 150: opening it `r+` gives EBUSY while up, and succeeds after it exits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { profileInUse, sameDir, userDataDirFrom } from '../ports.js';

const PROFILE = join('X:', 'data', 'chrome-profile-c');            // portable-exempt: synthetic fixture

/** An `open` that fails the way Windows does for the situation named. */
const failsWith = (code: string) => () => {
  const e = new Error(code) as NodeJS.ErrnoException;
  e.code = code;
  throw e;
};

/* ---------------------------------------------------------------- the profile lock */

test('a folder held open by a running Chrome reads as in use', () => {
  /* EBUSY is what Windows actually returns for Chrome's lockfile while the browser is up. */
  assert.equal(profileInUse(PROFILE, { open: failsWith('EBUSY') }), true);
});

test('a folder nothing is holding reads as free', () => {
  assert.equal(profileInUse(PROFILE, { open: () => { /* opened fine */ } }), false);
});

test('no lockfile at all is not "in use" — Chrome deletes it on a clean exit', () => {
  assert.equal(profileInUse(PROFILE, { open: failsWith('ENOENT') }), false);
});

/**
 * Fail closed on anything that is not the measured signal.
 *
 * A permission error is not evidence of a browser; treating it as one would claim ownership on a
 * machine that simply would not let redbot read the file. Unproven is not owned.
 */
test('a permission error proves nothing and must not claim ownership', () => {
  assert.equal(profileInUse(PROFILE, { open: failsWith('EACCES') }), false);
  assert.equal(profileInUse(PROFILE, { open: failsWith('EPERM') }), false);
});

test('the lockfile is looked for inside the profile folder, by name', () => {
  let asked = '';
  profileInUse(PROFILE, { open: (p) => { asked = p; } });
  assert.equal(asked, join(PROFILE, 'lockfile'));
});

/* ---------------------------------------------------------------- the primary proof, unchanged */

test('the command-line parse still finds a user-data-dir, quoted or not', () => {
  assert.equal(
    userDataDirFrom('chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\\data\\chrome-profile-c'),
    'C:\\data\\chrome-profile-c');
  assert.equal(
    userDataDirFrom('chrome.exe --user-data-dir="C:\\my data\\profile a" --foo'),
    'C:\\my data\\profile a');
  assert.equal(userDataDirFrom(null), null);
  assert.equal(userDataDirFrom('chrome.exe --no-user-data-dir-here'), null);
});

/**
 * The Lenovo Vantage case this whole module exists for.
 *
 * It must keep failing BOTH proofs: its command line names its own folder, and it does not hold
 * redbot's. A fallback that accepted it would reintroduce the exact defect the header describes.
 */
test('a foreign browser matches neither the folder nor the lock', () => {
  const foreign = 'msedgewebview2.exe --remote-debugging-port=9222 '
    + '--user-data-dir=C:\\Program Files\\Lenovo\\Vantage\\EBWebView';
  assert.equal(sameDir(userDataDirFrom(foreign), PROFILE), false,
    'a vendor WebView on our port is not our browser');
  /* And redbot's own folder is not locked, because that WebView never opened it. */
  assert.equal(profileInUse(PROFILE, { open: () => { /* opens fine — nothing holds it */ } }), false);
});

test('sameDir still normalises case and separators, and refuses nulls', () => {
  assert.equal(sameDir('C:\\data\\chrome-profile-c', 'c:/DATA/Chrome-Profile-C'), true);
  assert.equal(sameDir('C:\\data\\chrome-profile-c\\', 'C:\\data\\chrome-profile-c'), true);
  assert.equal(sameDir('C:\\data\\chrome-profile-c', 'C:\\data\\chrome-profile-d'), false);
  assert.equal(sameDir(null, 'C:\\x'), false);
  assert.equal(sameDir('C:\\x', null), false);
});
