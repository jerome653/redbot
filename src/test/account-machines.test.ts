/**
 * What syncs between machines, and what must not.
 *
 * THE SPLIT THIS PINS. `redbot.accounts` describes an account — role, subreddits, ceiling,
 * quiet hours — and that description is worth sharing between computers. A Chrome profile
 * folder and a debugging port are not: the folder holds a session Windows DPAPI has bound to
 * one user on one machine (measured — the cookies carry the `v10` tag and Local State holds a
 * DPAPI-wrapped key), and a port free on one machine may be held by something else on another.
 * On the development machine 9222 is Lenovo Vantage's Edge WebView, which answers the debugging
 * protocol fluently and would be driven as though it were the account's own Chrome.
 *
 * So the binding lives in `redbot.account_machines`, keyed by machine, and these tests are two
 * machines sharing one database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool } from '../db.js';
import {
  upsertAccounts, loadAccountsFromDb, boundHandles, bindAccountToMachine,
  unbindAccountFromMachine, machinesForAccount, deleteAccount
} from '../db/accounts.js';
import { sanitiseMachineName } from '../machine.js';

const A = 'test-desktop';
const B = 'test-laptop';
const HANDLE = 'Sync_Test_Acct';

async function clean(): Promise<void> {
  await deleteAccount(getPool(), HANDLE);          // CASCADE takes the bindings with it
}

test('a machine name is made usable rather than rejected', () => {
  /* Real hostnames carry characters the column refuses: a Windows box can be "DESK TOP", a mac
     is routinely "Dan's MacBook Pro.local". Substituting keeps the readable part. */
  assert.equal(sanitiseMachineName('DESK TOP'), 'DESK-TOP');
  assert.equal(sanitiseMachineName("Dan's MacBook Pro.local"), 'Dan-s-MacBook-Pro.local');
  assert.equal(sanitiseMachineName('  padded  '), 'padded');
  assert.equal(sanitiseMachineName('!!!'), 'unknown-machine', 'a name with nothing usable left must not be written');
  assert.ok(sanitiseMachineName('x'.repeat(200)).length <= 64, 'and it must fit the column');
});

test('the description syncs between machines; the browser does not', async () => {
  await clean();
  try {
    // Machine A sets the account up: description plus its own folder and port.
    await upsertAccounts(getPool(), [{
      handle: HANDLE, role: 'support', subreddits: ['WordPress'], dailyCeiling: 2,
      quietHours: [0, 8], profileDir: 'chrome-profile-a', debugPort: 9222
    }], A);

    const onA = (await loadAccountsFromDb(getPool(), A)).find((x) => x.handle === HANDLE)!;
    assert.equal(onA.debugPort, 9222);
    assert.equal(onA.profileDir, 'chrome-profile-a');

    /* Machine B reads the SAME database. It must get everything that describes the account... */
    const onB = (await loadAccountsFromDb(getPool(), B)).find((x) => x.handle === HANDLE)!;
    assert.equal(onB.role, 'support', 'the description is the whole point of sharing');
    assert.deepEqual(onB.subreddits, ['WordPress']);
    assert.equal(onB.dailyCeiling, 2);
    assert.deepEqual(onB.quietHours, [0, 8]);

    /* ...and it must NOT be told it has a browser here. That is the bug this split removes:
       inheriting A's port means attaching to whatever holds that number on B. */
    assert.equal((await boundHandles(getPool(), B)).has(HANDLE.toLowerCase()), false,
                 'B must know it has no browser for this account yet');
    assert.equal((await boundHandles(getPool(), A)).has(HANDLE.toLowerCase()), true);
  } finally { await clean(); }
});

test('two machines hold different ports for one account, at the same time', async () => {
  await clean();
  try {
    await upsertAccounts(getPool(), [{
      handle: HANDLE, role: 'support', profileDir: 'chrome-profile-a', debugPort: 9222
    }], A);
    // B signs in once of its own and gets its own numbers — a different port and folder.
    await bindAccountToMachine(getPool(), B, HANDLE, 'chrome-profile-x', 9401);

    const onA = (await loadAccountsFromDb(getPool(), A)).find((x) => x.handle === HANDLE)!;
    const onB = (await loadAccountsFromDb(getPool(), B)).find((x) => x.handle === HANDLE)!;
    assert.equal(onA.debugPort, 9222);
    assert.equal(onB.debugPort, 9401, 'each machine drives its own browser');
    assert.equal(onA.profileDir, 'chrome-profile-a');
    assert.equal(onB.profileDir, 'chrome-profile-x');

    const where = await machinesForAccount(getPool(), HANDLE);
    assert.deepEqual(where.map((w) => w.machine).sort(), [A, B].sort(),
                     'and both are recorded, so a person can see where it already runs');
  } finally { await clean(); }
});

test('an edit made on one machine reaches the other without moving its browser', async () => {
  await clean();
  try {
    await upsertAccounts(getPool(), [{
      handle: HANDLE, role: 'before', profileDir: 'chrome-profile-a', debugPort: 9222
    }], A);
    await bindAccountToMachine(getPool(), B, HANDLE, 'chrome-profile-x', 9401);

    // Someone edits the description on B. The account row is shared, so A must see it...
    await upsertAccounts(getPool(), [{
      handle: HANDLE, role: 'after', profileDir: 'chrome-profile-x', debugPort: 9401
    }], B);

    const onA = (await loadAccountsFromDb(getPool(), A)).find((x) => x.handle === HANDLE)!;
    assert.equal(onA.role, 'after', 'the shared description must travel');
    /* ...but A's browser must not have moved to B's port. This is the assertion that would
       fail if the binding were still a column on the shared row. */
    assert.equal(onA.debugPort, 9222, "editing on one machine must not repoint the other's Chrome");
    assert.equal(onA.profileDir, 'chrome-profile-a');
  } finally { await clean(); }
});

test('one machine cannot give two accounts the same port', async () => {
  await clean();
  await deleteAccount(getPool(), 'Sync_Test_Other');
  try {
    await upsertAccounts(getPool(), [{ handle: HANDLE, profileDir: 'chrome-profile-a', debugPort: 9222 }], A);
    await upsertAccounts(getPool(), [{ handle: 'Sync_Test_Other' }], A);

    /* The console checks this before it writes; the constraint is what makes it true when two
       clicks race. Two accounts on one port is two Reddit identities in one browser. */
    await assert.rejects(
      () => bindAccountToMachine(getPool(), A, 'Sync_Test_Other', 'chrome-profile-z', 9222),
      /one_account_per_port_per_machine/,
      'the database must refuse it, not merely the UI'
    );

    // The SAME port on a DIFFERENT machine is fine — that is the entire point.
    await bindAccountToMachine(getPool(), B, 'Sync_Test_Other', 'chrome-profile-z', 9222);
    const onB = (await loadAccountsFromDb(getPool(), B)).find((x) => x.handle === 'Sync_Test_Other')!;
    assert.equal(onB.debugPort, 9222);
  } finally {
    await deleteAccount(getPool(), 'Sync_Test_Other');
    await clean();
  }
});

test('an account with no binding falls back to the legacy column, so an old install still works', async () => {
  await clean();
  try {
    /* Exactly the shape every pre-0013 row has: values in redbot.accounts, no binding anywhere.
       0013 must be a no-op for an install that has only ever run on one computer. */
    await getPool().query(
      `INSERT INTO redbot.accounts (handle, role, profile_dir, debug_port) VALUES ($1,'legacy','chrome-profile-a',9222)`,
      [HANDLE]
    );
    const seen = (await loadAccountsFromDb(getPool(), A)).find((x) => x.handle === HANDLE)!;
    assert.equal(seen.debugPort, 9222, 'the values it already had must keep answering');
    assert.equal(seen.profileDir, 'chrome-profile-a');
    assert.equal((await boundHandles(getPool(), A)).has(HANDLE.toLowerCase()), false,
                 'but it is still not a binding, and the console must be able to tell');

    // Once this machine claims one, its own answer takes over.
    await bindAccountToMachine(getPool(), A, HANDLE, 'chrome-profile-q', 9444);
    const after = (await loadAccountsFromDb(getPool(), A)).find((x) => x.handle === HANDLE)!;
    assert.equal(after.debugPort, 9444, "this machine's binding must win over the legacy column");
    assert.equal(after.profileDir, 'chrome-profile-q');
  } finally { await clean(); }
});

test('removing a machine leaves the shared account alone', async () => {
  await clean();
  try {
    await upsertAccounts(getPool(), [{ handle: HANDLE, role: 'support', profileDir: 'chrome-profile-a', debugPort: 9222 }], A);
    await bindAccountToMachine(getPool(), B, HANDLE, 'chrome-profile-x', 9401);

    assert.equal(await unbindAccountFromMachine(getPool(), B, HANDLE), 1);
    assert.equal((await boundHandles(getPool(), B)).has(HANDLE.toLowerCase()), false);
    /* Retiring a laptop must not delete the account, nor disturb the machine still running it. */
    assert.equal((await boundHandles(getPool(), A)).has(HANDLE.toLowerCase()), true);
    const onA = (await loadAccountsFromDb(getPool(), A)).find((x) => x.handle === HANDLE)!;
    assert.equal(onA.role, 'support');
    assert.equal(onA.debugPort, 9222);
  } finally { await clean(); }
});

test('deleting the account takes every machine’s binding with it', async () => {
  await clean();
  try {
    await upsertAccounts(getPool(), [{ handle: HANDLE, profileDir: 'chrome-profile-a', debugPort: 9222 }], A);
    await bindAccountToMachine(getPool(), B, HANDLE, 'chrome-profile-x', 9401);
    assert.equal((await machinesForAccount(getPool(), HANDLE)).length, 2);

    await deleteAccount(getPool(), HANDLE);
    assert.deepEqual(await machinesForAccount(getPool(), HANDLE), [],
                     'a removed account must not leave bindings behind on any machine');
  } finally { await clean(); }
});

test.after(async () => { await closePool(); });
