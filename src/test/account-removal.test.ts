import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * WHAT THIS PINS: "a removal you can undo by re-adding" was not true.
 *
 * Removing an account deletes the record from both stores and deliberately KEEPS its Chrome
 * folder, because that folder holds the only copy of the Reddit session — no password is stored
 * anywhere, so nothing could sign back in. The stated trade is that the removal is undoable.
 *
 * Measured 2026-08-13 before this change: create → delete → create the SAME handle allocated
 * `chrome-profile-b` and left `chrome-profile-a` on disk forever. The session was kept and could
 * never be reached again, so the reason for keeping it was false and every removal added a
 * signed-in folder nobody could use.
 *
 * Now a removal records which folder belonged to which handle, and re-adding that handle adopts
 * it. Only a folder redbot allocated and recorded is ever adopted — a caller-supplied path is
 * still refused, which is the rule that stops a request pointing redbot at a stranger's profile.
 */
describe('removing an account keeps its sign-in folder, and re-adding gets it back', () => {
  let DATA: string;
  let mod: typeof import('../console-accounts.js');

  before(async () => {
    DATA = mkdtempSync(join(tmpdir(), 'redbot-removal-'));
    process.env.REDBOT_DATA = DATA;
    /* Seed-file mode on purpose: the folder question is the same either way, and this keeps the
       test off the shared test database. */
    delete process.env.REDBOT_DB;
    mod = await import('../console-accounts.js');
  });

  after(() => { rmSync(DATA, { recursive: true, force: true }); });

  test('the folder is kept, reported, and handed back to the same username', async () => {
    const made = await mod.createConsoleAccount({ handle: 'probe-one', role: 'Support', speaks: '', subreddits: [] });
    assert.equal(made.ok, true, JSON.stringify(made));
    const dir = made.account!.profileDir!;
    assert.ok(existsSync(join(DATA, dir)), 'the folder is created at allocation, not at first launch');

    const gone = await mod.deleteConsoleAccount({ handle: 'probe-one', confirm: true });
    assert.equal(gone.ok, true, JSON.stringify(gone));
    assert.equal(gone.profileDirKept, dir, 'the removal must SAY which folder it kept');
    assert.ok(existsSync(join(DATA, dir)), 'the signed-in folder is deliberately not deleted');

    const again = await mod.createConsoleAccount({ handle: 'probe-one', role: 'Support', speaks: '', subreddits: [] });
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(again.account!.profileDir, dir,
      're-adding the same username must adopt the folder that was kept for it, or keeping it was pointless');
    assert.equal(again.adoptedProfileDir, true, 'and it must say so — a reused session is not a fresh one');

    const dirs = readdirSync(DATA).filter((f) => f.startsWith('chrome-profile-'));
    assert.deepEqual(dirs, [dir], 'no orphan folder may be left behind');
  });

  test('a different username gets its own folder — a session is never handed to a stranger', async () => {
    const a = await mod.createConsoleAccount({ handle: 'probe-two', role: 'Support', speaks: '', subreddits: [] });
    const dirA = a.account!.profileDir!;
    await mod.deleteConsoleAccount({ handle: 'probe-two', confirm: true });

    const b = await mod.createConsoleAccount({ handle: 'probe-three', role: 'Support', speaks: '', subreddits: [] });
    assert.notEqual(b.account!.profileDir, dirA,
      'probe-two’s signed-in Reddit session must not become probe-three’s browser');
    assert.ok(!b.adoptedProfileDir);
  });

  test('a kept folder deleted by hand is not resurrected — a name is not a session', async () => {
    const made = await mod.createConsoleAccount({ handle: 'probe-four', role: 'Support', speaks: '', subreddits: [] });
    const dir = made.account!.profileDir!;
    await mod.deleteConsoleAccount({ handle: 'probe-four', confirm: true });
    rmSync(join(DATA, dir), { recursive: true, force: true });

    const again = await mod.createConsoleAccount({ handle: 'probe-four', role: 'Support', speaks: '', subreddits: [] });
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.ok(existsSync(join(DATA, again.account!.profileDir!)), 'a fresh folder is allocated and created');
    assert.ok(!again.adoptedProfileDir, 'and it must not claim to have reused a session that is gone');
  });

  test('adoption is by username, not by position, and survives a second removal', async () => {
    const first = await mod.createConsoleAccount({ handle: 'probe-five', role: 'Support', speaks: '', subreddits: [] });
    const dir = first.account!.profileDir!;
    await mod.deleteConsoleAccount({ handle: 'probe-five', confirm: true });
    const back = await mod.createConsoleAccount({ handle: 'probe-five', role: 'Support', speaks: '', subreddits: [] });
    assert.equal(back.account!.profileDir, dir);
    await mod.deleteConsoleAccount({ handle: 'probe-five', confirm: true });
    const backAgain = await mod.createConsoleAccount({ handle: 'probe-five', role: 'Support', speaks: '', subreddits: [] });
    assert.equal(backAgain.account!.profileDir, dir, 'the second round must behave like the first');
  });
});
