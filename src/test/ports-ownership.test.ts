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
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { profileInUse, sameDir, userDataDirFrom, orphanBrowsers } from '../ports.js';
import type { PortOwner } from '../ports.js';

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
 * THE SHAPE WINDOWS ACTUALLY PRODUCES, and the bug it hid.
 *
 * Reported 2026-08-13 from a machine whose Windows user is `Clark Pesa`. Windows quotes the
 * WHOLE argument — `"--user-data-dir=C:\Users\Clark Pesa\…"` — with no quote after the equals
 * sign, so the old alternation fell through to `(\S+)` and stopped at the first space, yielding
 * `C:\Users\Clark`. That is not a path on any machine.
 *
 * Everything downstream then behaved correctly on false evidence: `sameDir` said no, the account's
 * OWN Chrome was classified `foreign`, `stopAccountBrowser` refused to kill a browser it could not
 * prove was its own, and the port stayed held. Each restart — and the auto-updater restarted three
 * times that day — leaked another orphaned Chrome onto another debugging port, until redbot could
 * not get a port at all.
 *
 * It was invisible on every machine whose username has no space, because there `(\S+)` happens to
 * capture the whole path. The old test only ever exercised the two shapes that already worked.
 */
test('a user-data-dir survives a space in the path, in every shape Windows writes it', () => {
  const real = 'C:\\Users\\Clark Pesa\\AppData\\Roaming\\redbot\\data\\chrome-profile-e';

  /* Verbatim from the reporting machine's Win32_Process record. */
  assert.equal(
    userDataDirFrom(
      '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 ' +
      `"--user-data-dir=${real}" --no-first-run --no-default-browser-check https://www.reddit.com/login`),
    real,
    'the whole argument is quoted — this is the form that truncated at "C:\\Users\\Clark"');

  /* The two shapes that already worked must keep working. */
  assert.equal(userDataDirFrom(`chrome.exe --user-data-dir="${real}" --foo`), real);
  assert.equal(
    userDataDirFrom('chrome.exe --user-data-dir=C:\\data\\chrome-profile-c --foo'),
    'C:\\data\\chrome-profile-c');

  /* And the Lenovo fixture, which returned the right VERDICT for the wrong reason: its path also
     contains a space, so it too was being truncated — to `C:\Program`. */
  assert.equal(
    userDataDirFrom(
      '"C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\msedgewebview2.exe" ' +
      '"--user-data-dir=C:\\Program Files\\Lenovo\\Vantage\\EBWebView" --remote-debugging-port=9222'),
    'C:\\Program Files\\Lenovo\\Vantage\\EBWebView',
    'a foreign browser must be identified by its REAL folder, not by a truncation of it');
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

/**
 * BUG C — a browser redbot launched, whose account row is gone, could never be reclaimed.
 *
 * Reported 2026-08-13. Ownership was resolved only THROUGH an account: `statusForAccounts` walks
 * the accounts table, so a Chrome holding `chrome-profile-e` after `Big_Variation_8580` was
 * removed was invisible to every screen and every stop button. It sat on port 9222 — the first
 * port the allocator hands out — until the machine was rebooted:
 *
 *     browsers  Big_Variation_8580 NOT closed — Big_Variation_8580 is not set up.
 *
 * The evidence that it is ours never depended on the account row. It is the profile folder: that
 * Chrome was told to open a directory inside redbot's own data root, and nothing else on the
 * machine does that. So ownership is asked of the FOLDER, and an account row is only how the
 * browser gets a name.
 */
describe('a browser of ours stays ours after its account is gone', () => {
  /* String.raw, not an escaped literal: `\r` in a normal string is a CARRIAGE RETURN, so
     'C:\Users\…\redbot\data' silently becomes a path containing a control character. */
  const ROOT_DIR = String.raw`C:\Users\Clark Pesa\AppData\Roaming\redbot\data`;
  const owner = (port: number, pid: number, dir: string | null): [number, PortOwner] =>
    [port, { port, pid, process: 'chrome.exe', commandLine: null, userDataDir: dir }];

  test('a profile under the data root with no account row is an orphan we may reclaim', () => {
    const owners = new Map([
      owner(9222, 18364, `${ROOT_DIR}\\chrome-profile-e`),
      owner(9223, 13532, `${ROOT_DIR}\\chrome-profile-a`)
    ]);
    const orphans = orphanBrowsers(owners, ROOT_DIR, ['chrome-profile-a']);
    assert.equal(orphans.length, 1, 'only the unclaimed profile is an orphan');
    assert.equal(orphans[0]?.port, 9222);
    assert.equal(orphans[0]?.pid, 18364);
    assert.match(orphans[0]?.profileDir ?? '', /chrome-profile-e$/);
  });

  test('a foreign browser is never an orphan of ours, however its path is quoted', () => {
    const owners = new Map([
      owner(9222, 4242, String.raw`C:\Program Files\Lenovo\Vantage\EBWebView`),
      owner(9224, 4243, String.raw`C:\Users\Someone Else\AppData\Roaming\redbot\data\chrome-profile-a`)
    ]);
    assert.deepEqual(orphanBrowsers(owners, ROOT_DIR, []), [],
      'another user’s redbot is not this install’s to kill');
  });

  test('an unreadable command line proves nothing and is left alone', () => {
    const owners = new Map([owner(9222, 1, null)]);
    assert.deepEqual(orphanBrowsers(owners, ROOT_DIR, []), []);
  });

  test('the data root itself is not a profile — a sibling folder never matches by prefix', () => {
    const owners = new Map([
      owner(9222, 7, ROOT_DIR),
      owner(9223, 8, `${ROOT_DIR}-old\\chrome-profile-a`)
    ]);
    assert.deepEqual(orphanBrowsers(owners, ROOT_DIR, []), [],
      'neither the root nor a look-alike sibling is a profile inside it');
  });

  test('claimed folders are matched the way sameDir matches — case and separator insensitively', () => {
    const owners = new Map([owner(9222, 9, `${ROOT_DIR}/CHROME-PROFILE-A`)]);
    assert.deepEqual(orphanBrowsers(owners, ROOT_DIR, ['chrome-profile-a']), [],
      'a claimed profile must not read as an orphan because Windows wrote it differently');
  });
});
