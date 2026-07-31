/**
 * Profile folder naming, creation and state — driven against a fake filesystem.
 *
 * A fake rather than a temp directory, because the cases that matter are the ones a real disk makes
 * awkward to arrange: a stranger's folder already sitting where the next name would land, a
 * mkdir that fails, twenty-seven accounts. The one thing a fake cannot prove — that `mkdirSync`
 * really creates a directory — is proven by `src/test/console-accounts.test.ts` and by the live
 * capture in electron/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  allocateProfileDir, ensureProfileDirs, profileName, profileState, PROFILE_PREFIX
} from '../profiles.js';

const ROOT = join('X:', 'data');                                    // portable-exempt: synthetic fixture

/** A filesystem that only remembers which paths exist and what is in them. */
function fakeFs(initial: Record<string, string[]> = {}) {
  const dirs = new Map<string, string[]>(Object.entries(initial));
  return {
    dirs,
    io: {
      exists: (p: string) => dirs.has(p),
      mkdir: (p: string) => { if (!dirs.has(p)) dirs.set(p, []); },
      readdir: (p: string) => {
        const e = dirs.get(p);
        if (!e) throw new Error('ENOENT');
        return e;
      }
    }
  };
}

/* ---------------------------------------------------------------- naming */

test('profileName walks a…z and then keeps going', () => {
  assert.equal(profileName(0), `${PROFILE_PREFIX}a`);
  assert.equal(profileName(2), `${PROFILE_PREFIX}c`);
  assert.equal(profileName(25), `${PROFILE_PREFIX}z`);
  /**
   * The 27th. The old `String.fromCharCode(97 + i)` produced `chrome-profile-{` here — a name
   * that is legal on disk, sorts nowhere sensible, and would only ever be found by the person
   * who had 27 accounts.
   */
  assert.equal(profileName(26), `${PROFILE_PREFIX}aa`);
  assert.equal(profileName(27), `${PROFILE_PREFIX}ab`);
  assert.equal(profileName(51), `${PROFILE_PREFIX}az`);
  assert.equal(profileName(52), `${PROFILE_PREFIX}ba`);
  for (let i = 0; i < 200; i++) assert.match(profileName(i), /^chrome-profile-[a-z]+$/);
});

test('profileName refuses an index that is not a whole number', () => {
  assert.throws(() => profileName(-1), RangeError);
  assert.throws(() => profileName(1.5), RangeError);
});

/* ---------------------------------------------------------------- allocation */

test('the first account gets a, and the folder is actually created', () => {
  const fs = fakeFs();
  const dir = allocateProfileDir({ dataRoot: ROOT, taken: [], io: fs.io });
  assert.equal(dir, `${PROFILE_PREFIX}a`);
  assert.equal(fs.dirs.has(join(ROOT, dir)), true, 'allocation must create the directory');
});

test('a folder recorded against another account is never handed out again', () => {
  const fs = fakeFs();
  const dir = allocateProfileDir({
    dataRoot: ROOT, taken: [`${PROFILE_PREFIX}a`, `${PROFILE_PREFIX}b`], io: fs.io
  });
  assert.equal(dir, `${PROFILE_PREFIX}c`);
});

test('a stranger\'s folder on disk is skipped rather than adopted', () => {
  /* `chrome-profile-a` exists but belongs to nobody we know — a deleted account's session, which
     deleteConsoleAccount deliberately leaves behind. Pointing a new account at it would silently
     reuse somebody else's signed-in Chrome. */
  const fs = fakeFs({ [join(ROOT, `${PROFILE_PREFIX}a`)]: ['Local State'] });
  const dir = allocateProfileDir({ dataRoot: ROOT, taken: [], io: fs.io });
  assert.equal(dir, `${PROFILE_PREFIX}b`);
});

test('gaps left by both guards are stepped over together', () => {
  const fs = fakeFs({
    [join(ROOT, `${PROFILE_PREFIX}b`)]: [],
    [join(ROOT, `${PROFILE_PREFIX}d`)]: []
  });
  const dir = allocateProfileDir({ dataRoot: ROOT, taken: [`${PROFILE_PREFIX}a`, `${PROFILE_PREFIX}c`], io: fs.io });
  assert.equal(dir, `${PROFILE_PREFIX}e`);
});

/**
 * THE BUG THIS MODULE EXISTS FOR.
 *
 * Two accounts created back to back, before either browser has ever been started. The old code
 * guarded with `existsSync` alone, and the folder did not appear until Chrome ran — so the second
 * allocation could not see the first and both got `chrome-profile-a`. Creating the directory at
 * allocation is what makes the guard true immediately.
 */
test('two accounts allocated in a row never collide, even with nothing recorded between them', () => {
  const fs = fakeFs();
  const first = allocateProfileDir({ dataRoot: ROOT, taken: [], io: fs.io });
  const second = allocateProfileDir({ dataRoot: ROOT, taken: [], io: fs.io });
  assert.notEqual(first, second, 'two accounts must never share one Chrome profile');
  assert.equal(first, `${PROFILE_PREFIX}a`);
  assert.equal(second, `${PROFILE_PREFIX}b`);
});

test('a whole pulled batch gets distinct folders', () => {
  const fs = fakeFs();
  const got = Array.from({ length: 30 }, () => allocateProfileDir({ dataRoot: ROOT, taken: [], io: fs.io }));
  assert.equal(new Set(got).size, 30, 'every account in a pull needs its own profile');
  assert.equal(got[26], `${PROFILE_PREFIX}aa`, 'past z it keeps going');
});

test('case differences are treated as the same folder, because Windows does', () => {
  const fs = fakeFs();
  const dir = allocateProfileDir({ dataRoot: ROOT, taken: ['CHROME-PROFILE-A'], io: fs.io });
  assert.equal(dir, `${PROFILE_PREFIX}b`, 'a case-different name is still the same directory');
});

test('create:false names without touching the disk', () => {
  const fs = fakeFs();
  const dir = allocateProfileDir({ dataRoot: ROOT, taken: [], io: fs.io, create: false });
  assert.equal(dir, `${PROFILE_PREFIX}a`);
  assert.equal(fs.dirs.size, 0, 'nothing should have been created');
});

/* ---------------------------------------------------------------- state */

test('profileState separates absent, made-but-unused, and a real Chrome profile', () => {
  const fs = fakeFs({
    [join(ROOT, 'used-default')]: ['Default', 'Local State'],
    [join(ROOT, 'used-localstate')]: ['Local State'],
    [join(ROOT, 'made-not-used')]: [],
    [join(ROOT, 'junk-only')]: ['notes.txt']
  });
  assert.equal(profileState(ROOT, 'used-default', fs.io), 'used');
  assert.equal(profileState(ROOT, 'used-localstate', fs.io), 'used');
  assert.equal(profileState(ROOT, 'made-not-used', fs.io), 'empty');
  /* A stray file is not a browser session. Reporting `used` here would be the "looks ready and
     cannot post" failure that applyAccounts warns about. */
  assert.equal(profileState(ROOT, 'junk-only', fs.io), 'empty');
  assert.equal(profileState(ROOT, 'never-made', fs.io), 'missing');
  assert.equal(profileState(ROOT, null, fs.io), 'missing');
  assert.equal(profileState(ROOT, '', fs.io), 'missing');
});

test('an unreadable folder is empty, not missing, and never throws', () => {
  const io = {
    exists: () => true,
    readdir: () => { throw new Error('EPERM'); }
  };
  assert.equal(profileState(ROOT, 'locked', io), 'empty');
});

/* ---------------------------------------------------------------- repair */

test('ensureProfileDirs creates only the folders that are missing', () => {
  const fs = fakeFs({ [join(ROOT, `${PROFILE_PREFIX}a`)]: ['Local State'] });
  const r = ensureProfileDirs(ROOT, [
    { handle: 'A', profileDir: `${PROFILE_PREFIX}a` },
    { handle: 'B', profileDir: `${PROFILE_PREFIX}b` },
    { handle: 'C', profileDir: `${PROFILE_PREFIX}c` }
  ], fs.io);

  assert.deepEqual(r.created, [`${PROFILE_PREFIX}b`, `${PROFILE_PREFIX}c`]);
  assert.deepEqual(r.failed, []);
  /* The one that already had a session must be untouched — it is the only copy of that login. */
  assert.deepEqual(fs.dirs.get(join(ROOT, `${PROFILE_PREFIX}a`)), ['Local State']);
});

test('ensureProfileDirs ignores accounts with no folder name', () => {
  const fs = fakeFs();
  const r = ensureProfileDirs(ROOT, [
    { handle: 'A', profileDir: null },
    { handle: 'B' },
    { handle: 'C', profileDir: '' }
  ], fs.io);
  assert.deepEqual(r.created, []);
  assert.equal(fs.dirs.size, 0);
});

test('ensureProfileDirs reports a mkdir it could not do rather than throwing', () => {
  const io = {
    exists: () => false,
    mkdir: () => { throw new Error('EACCES: permission denied'); }
  };
  const r = ensureProfileDirs(ROOT, [{ handle: 'A', profileDir: `${PROFILE_PREFIX}a` }], io);
  assert.deepEqual(r.created, []);
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0]!.reason, /EACCES/);
});

test('two accounts naming one folder is not papered over by creating it twice', () => {
  const made: string[] = [];
  const io = { exists: () => false, mkdir: (p: string) => { made.push(p); } };
  const r = ensureProfileDirs(ROOT, [
    { handle: 'A', profileDir: `${PROFILE_PREFIX}a` },
    { handle: 'B', profileDir: `${PROFILE_PREFIX}a` }
  ], io);
  assert.equal(made.length, 1, 'the duplicate is left visible, not silently satisfied');
  assert.deepEqual(r.created, [`${PROFILE_PREFIX}a`]);
});
