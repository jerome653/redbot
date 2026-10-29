/**
 * The confirmed-login layer on top of the vault (src/reddit-credentials.ts).
 *
 * THE LOAD-BEARING TEST is the GATE: a login is sealed ONLY when a live check confirms the
 * handle's own browser is signed in as that exact handle. Store it against the wrong account —
 * or against no session at all — and a sign-in fails at the worst possible moment, pointing at
 * a credential that was never that account's. So the refusals are proven first, and each asserts
 * that NOTHING reached the store.
 *
 * Both the confirmation function and the secret store are injected, so this suite needs no
 * browser and no REDBOT_VAULT_KEY: the fake store below holds bytes in a Map, and the crypto it
 * would otherwise exercise is already covered by vault.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Importing the module pulls in credentials.ts -> db.js; point any incidental file access at a
// throwaway dir. Nothing here opens a pool — the store is faked — but this keeps the suite from
// depending on the machine's configuration, the way vault.test.ts and tokens.test.ts do.
process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-reddit-cred-'));

const {
  putRedditLogin, getRedditLogin, listRedditLogins, removeRedditLogin,
  RedditLoginError, REDDIT_PREFIX,
} = await import('../reddit-credentials.js');
const { SCOPE_GLOBAL } = await import('../credentials.js');

/* ------------------------------------------------------------------ *
 * An in-memory stand-in for the vault, keyed exactly as the real one.
 * ------------------------------------------------------------------ */
interface Row { scope: string; name: string; value: string; createdAt: string; updatedAt: string; lastUsedAt: string | null; }

function fakeStore() {
  const rows = new Map<string, Row>();
  const key = (scope: string, name: string) => `${scope}\u0000${name}`;
  return {
    rows,
    async putSecret(name: string, value: string, scope = SCOPE_GLOBAL) {
      const now = new Date().toISOString();
      const existing = rows.get(key(scope, name));
      rows.set(key(scope, name), {
        scope, name, value,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        lastUsedAt: null,
      });
    },
    async getSecret(name: string, scope = SCOPE_GLOBAL) {
      return rows.get(key(scope, name))?.value ?? null;
    },
    async listSecrets() {
      return [...rows.values()].map((r) => ({
        scope: r.scope, name: r.name, keyId: 'test-fp', hint: null,
        createdAt: r.createdAt, updatedAt: r.updatedAt, lastUsedAt: r.lastUsedAt,
      }));
    },
    async removeSecret(name: string, scope = SCOPE_GLOBAL) {
      return rows.delete(key(scope, name));
    },
  };
}

// The three confirmation outcomes the gate must distinguish.
const confirmMatching = async (handle: string) => ({ signedInAs: handle });
const confirmWrongUser = async () => ({ signedInAs: 'someone_else' });
const confirmNoSession = async () => ({ signedInAs: null });

/* ------------------------------------------------------------------ *
 * The gate — the whole point of the module.
 * ------------------------------------------------------------------ */

test('the gate REFUSES when the browser is signed in as a different user, and stores nothing', async () => {
  const store = fakeStore();
  await assert.rejects(
    () => putRedditLogin('jordangrowth', { email: 'a@b.co', password: 'pw-12345678' }, confirmWrongUser, store),
    (e: Error) => {
      assert.ok(e instanceof RedditLoginError);
      assert.match(e.message, /jordangrowth/);
      assert.match(e.message, /someone_else/);
      return true;
    }
  );
  assert.equal(store.rows.size, 0, 'a mismatch must leave the store empty');
});

test('the gate REFUSES when there is no signed-in session, and stores nothing', async () => {
  const store = fakeStore();
  await assert.rejects(
    () => putRedditLogin('jordangrowth', { email: 'a@b.co', password: 'pw-12345678' }, confirmNoSession, store),
    (e: Error) => {
      assert.ok(e instanceof RedditLoginError);
      assert.match(e.message, /no signed-in session/);
      return true;
    }
  );
  assert.equal(store.rows.size, 0, 'no session must leave the store empty');
});

test('a CONFIRMED login is sealed and round-trips email+password back out', async () => {
  const store = fakeStore();
  await putRedditLogin('jordangrowth', { email: 'jg@example.com', password: 'hunter2hunter2' }, confirmMatching, store);
  assert.equal(store.rows.size, 1, 'the confirmed login must be stored');

  // It is filed under reddit.<handle>, global scope.
  const only = [...store.rows.values()][0]!;
  assert.equal(only.name, `${REDDIT_PREFIX}jordangrowth`);
  assert.equal(only.scope, SCOPE_GLOBAL);

  const got = await getRedditLogin('jordangrowth', store);
  assert.deepEqual(got, { email: 'jg@example.com', password: 'hunter2hunter2' });
});

test('the handle match is case-insensitive — a Mixed-case signed-in name still confirms', async () => {
  const store = fakeStore();
  await putRedditLogin('jordangrowth', { email: 'a@b.co', password: 'pw-12345678' },
    async () => ({ signedInAs: 'JordanGrowth' }), store);
  assert.equal(store.rows.size, 1, 'a case-only difference must still count as confirmed');
});

/* ------------------------------------------------------------------ *
 * Validation and absence
 * ------------------------------------------------------------------ */

test('an INVALID handle is rejected BEFORE the live check runs, and stores nothing', async () => {
  const store = fakeStore();
  let confirmRan = false;
  const spy = async (h: string) => { confirmRan = true; return { signedInAs: h }; };

  await assert.rejects(
    () => putRedditLogin('Not A Handle', { email: 'a@b.co', password: 'pw-12345678' }, spy, store),
    /not a usable handle/
  );
  assert.equal(confirmRan, false, 'a bad handle must be refused before the browser is ever opened');
  assert.equal(store.rows.size, 0);

  // get and remove validate the same way.
  await assert.rejects(() => getRedditLogin('bad handle', store), /not a usable handle/);
  await assert.rejects(() => removeRedditLogin('UPPER', store), /not a usable handle/);
});

test('an empty email or password is refused even when the login is confirmed', async () => {
  const store = fakeStore();
  await assert.rejects(
    () => putRedditLogin('jordangrowth', { email: '', password: 'pw-12345678' }, confirmMatching, store),
    /empty email or password/
  );
  await assert.rejects(
    () => putRedditLogin('jordangrowth', { email: 'a@b.co', password: '' }, confirmMatching, store),
    /empty email or password/
  );
  assert.equal(store.rows.size, 0);
});

test('getRedditLogin returns null for a handle that was never stored', async () => {
  const store = fakeStore();
  assert.equal(await getRedditLogin('jordangrowth', store), null);
});

/* ------------------------------------------------------------------ *
 * Listing — metadata only, never the secret
 * ------------------------------------------------------------------ */

test('listRedditLogins returns handles and metadata ONLY, never the password bytes', async () => {
  const store = fakeStore();
  await putRedditLogin('jordangrowth', { email: 'jg@example.com', password: 'topsecretpw-1' }, confirmMatching, store);
  await putRedditLogin('colegrowth', { email: 'cole@example.com', password: 'anothersecret-2' }, confirmMatching, store);
  // A non-reddit secret in the same vault must NOT be listed as a reddit login.
  await store.putSecret('anthropic_api_key', 'sk-ant-nope', SCOPE_GLOBAL);

  const listed = await listRedditLogins(store);
  assert.deepEqual(listed.map((l) => l.handle).sort(), ['colegrowth', 'jordangrowth']);

  for (const row of listed) {
    assert.ok(typeof row.createdAt === 'string' && row.createdAt.length > 0, 'metadata carries createdAt');
    assert.ok('updatedAt' in row, 'metadata carries updatedAt');
    const keys = Object.keys(row);
    for (const forbidden of ['email', 'password', 'value', 'ciphertext', 'iv', 'authTag', 'hint']) {
      assert.ok(!keys.includes(forbidden), `listRedditLogins must not return ${forbidden}`);
    }
  }
  // And nothing secret survives serialization — the test a UI would rely on.
  const serialized = JSON.stringify(listed);
  assert.equal(serialized.includes('topsecretpw-1'), false, 'no password may appear in the listing');
  assert.equal(serialized.includes('jg@example.com'), false, 'no email may appear in the listing');
});

test('removeRedditLogin removes a stored login and reports whether there was one', async () => {
  const store = fakeStore();
  await putRedditLogin('jordangrowth', { email: 'a@b.co', password: 'pw-12345678' }, confirmMatching, store);
  assert.equal(await removeRedditLogin('jordangrowth', store), true);
  assert.equal(await getRedditLogin('jordangrowth', store), null);
  assert.equal(await removeRedditLogin('jordangrowth', store), false, 'removing nothing must say so');
});
