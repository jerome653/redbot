import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * WHAT THIS PINS: Delete, the second verb beside Remove.
 *
 * Remove keeps the Chrome folder so re-adding the username takes the session back
 * (account-removal.test.ts). Delete is the deliberate opposite: `deleteProfile: true` removes the
 * record AND the folder, and it also clears a folder an earlier Remove kept. It only ever deletes a
 * redbot-made `chrome-profile-*` under the data directory — an adopted folder elsewhere is refused
 * before anything is written. Own file: console-accounts binds DATA at import, once per process.
 */
describe('deleting an account with deleteProfile removes its sign-in folder too', () => {
  let DATA: string;
  let mod: typeof import('../console-accounts.js');

  before(async () => {
    DATA = mkdtempSync(join(tmpdir(), 'redbot-delete-'));
    process.env.REDBOT_DATA = DATA;
    delete process.env.REDBOT_DB;
    mod = await import('../console-accounts.js');
  });

  after(() => { rmSync(DATA, { recursive: true, force: true }); });

  test('the record and the folder both go, and nothing is kept for re-adoption', async () => {
    const made = await mod.createConsoleAccount({ handle: 'del-one', role: 'Support', speaks: '', subreddits: [] });
    assert.equal(made.ok, true, JSON.stringify(made));
    const dir = made.account!.profileDir!;
    writeFileSync(join(DATA, dir, 'Local State'), '{}');

    const gone = await mod.deleteConsoleAccount({ handle: 'del-one', confirm: true, deleteProfile: true });
    assert.equal(gone.ok, true, JSON.stringify(gone));
    assert.equal(gone.profileDirDeleted, dir);
    assert.equal(gone.profileDirKept, undefined);
    assert.ok(!existsSync(join(DATA, dir)), 'the sign-in folder must be gone');
    assert.ok(!(await mod.knownAccounts()).some((a) => a.handle === 'del-one'), 'the record must be gone');

    const again = await mod.createConsoleAccount({ handle: 'del-one', role: 'Support', speaks: '', subreddits: [] });
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.ok(!again.adoptedProfileDir, 'a deleted session must not be offered back');
  });

  test('a folder kept by an earlier Remove can be deleted afterwards', async () => {
    const made = await mod.createConsoleAccount({ handle: 'del-two', role: 'Support', speaks: '', subreddits: [] });
    const dir = made.account!.profileDir!;
    const removed = await mod.deleteConsoleAccount({ handle: 'del-two', confirm: true });
    assert.equal(removed.profileDirKept, dir);
    assert.ok(existsSync(join(DATA, dir)));

    const gone = await mod.deleteConsoleAccount({ handle: 'del-two', deleteProfile: true });
    assert.equal(gone.ok, true, JSON.stringify(gone));
    assert.equal(gone.profileDirDeleted, dir);
    assert.ok(!existsSync(join(DATA, dir)));
    const kept = JSON.parse(readFileSync(join(DATA, 'removed-accounts.json'), 'utf8')).kept;
    assert.ok(!kept.some((k: { handle: string }) => k.handle === 'del-two'), 'the kept line must go with the folder');
  });

  test('an adopted folder outside the data directory is refused, and nothing is removed', async () => {
    const made = await mod.createConsoleAccount({ handle: 'del-three', role: 'Support', speaks: '', subreddits: [] });
    const outside = mkdtempSync(join(tmpdir(), 'redbot-own-chrome-'));
    try {
      const seed = JSON.parse(readFileSync(join(DATA, 'accounts.json'), 'utf8'));
      for (const a of seed.accounts) if (a.handle === 'del-three') a.profileDir = outside;
      writeFileSync(join(DATA, 'accounts.json'), JSON.stringify(seed));

      const r = await mod.deleteConsoleAccount({ handle: 'del-three', confirm: true, deleteProfile: true });
      assert.equal(r.ok, false, JSON.stringify(r));
      assert.match(r.error!, /will not delete it/);
      assert.ok(existsSync(outside), 'somebody else’s Chrome folder must never be deleted');
      assert.ok((await mod.knownAccounts()).some((a) => a.handle === 'del-three'), 'the record stays when the delete is refused');
    } finally {
      rmSync(outside, { recursive: true, force: true });
      void made;
    }
  });

  test('without deleteProfile, Remove still keeps the folder', async () => {
    const made = await mod.createConsoleAccount({ handle: 'del-four', role: 'Support', speaks: '', subreddits: [] });
    const dir = made.account!.profileDir!;
    const r = await mod.deleteConsoleAccount({ handle: 'del-four', confirm: true });
    assert.equal(r.profileDirKept, dir);
    assert.ok(existsSync(join(DATA, dir)));
  });
});
