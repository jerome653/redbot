/**
 * `ensureVaultKey` — the master key's provenance, and the rows it must never orphan.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS.
 *
 * `electron/vault-key.mjs` takes `safeStorage` as an argument rather than importing it, and says
 * why in its own comment: "so this module can be unit-tested with a fake one". The seam was built
 * and the test was never written. Until now the only thing that exercised the module at all was
 * `electron/smoke.test.mjs`, which sets `REDBOT_VAULT_KEY` before launching — step 1 of four, and
 * the one step that does no key management. Generation, the OS-store round trip, the db/.env
 * import and every refusal were unexecuted code guarding every stored secret in the product.
 *
 * WHAT IS ACTUALLY AT RISK, because it is not "the tests are red". `src/vault.ts` seals rows with
 * AES-256-GCM under this key. A second launch that GENERATES instead of READING produces a working
 * app with a new key and a database full of rows that will never open again — no error, no crash,
 * just an operator's stored API keys quietly gone. The ordering comment in `vault-key.mjs` calls
 * generation "the LAST resort" for exactly that reason, so the ordering is what is pinned here.
 *
 * The fake `safeStorage` is deliberately NOT encryption — it tags and strips a prefix. Testing
 * DPAPI would be testing Windows; what these tests are about is which BRANCH runs, and that a
 * key which was stored comes back byte-identical.
 * ---------------------------------------------------------------------------
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ensureVaultKey, keyFile } from './vault-key.mjs';

/** A stand-in for Electron's safeStorage: reversible, inspectable, and not a cipher. */
const fakeStore = (opts = {}) => ({
  isEncryptionAvailable: () => opts.available !== false,
  encryptString: (s) => {
    if (opts.failEncrypt) throw new Error('encrypt refused');
    return Buffer.from(`sealed:${s}`, 'utf8');
  },
  decryptString: (b) => {
    if (opts.failDecrypt) throw new Error('decrypt refused');
    const s = Buffer.from(b).toString('utf8');
    if (!s.startsWith('sealed:')) throw new Error('not sealed by this store');
    return s.slice('sealed:'.length);
  }
});

/* The module reads and writes the real process environment, so it is saved and restored. */
let userData = '';
let savedKey;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'redbot-vaultkey-'));
  savedKey = process.env.REDBOT_VAULT_KEY;
  delete process.env.REDBOT_VAULT_KEY;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.REDBOT_VAULT_KEY;
  else process.env.REDBOT_VAULT_KEY = savedKey;
  try { rmSync(userData, { recursive: true, force: true }); } catch { /* windows lock */ }
});

/** What `src/vault.ts` parseKey() accepts: exactly 32 bytes, as hex or base64. */
const isUsableKey = (raw) => {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return true;
  return /^[A-Za-z0-9+/=_-]+$/.test(raw) &&
    Buffer.from(raw, /[-_]/.test(raw) ? 'base64url' : 'base64').length === 32;
};

describe('a fresh install with no key anywhere', () => {
  test('generates one, stores it, and hands back a key src/vault.ts can parse', () => {
    const r = ensureVaultKey({ safeStorage: fakeStore(), userData, envValue: () => null });
    assert.equal(r.source, 'generated');
    assert.equal(r.stored, true);
    assert.ok(existsSync(keyFile(userData)), 'the key was not written to the store');
    assert.ok(isUsableKey(process.env.REDBOT_VAULT_KEY),
      `generated a key src/vault.ts would reject: ${process.env.REDBOT_VAULT_KEY}`);
  });

  test('what lands on disk is what the credential store returned, not the raw key', () => {
    /* This cannot assert "the file holds ciphertext": the fake store is a prefix, not a cipher, so
       the key is in there by construction. Confidentiality is DPAPI's property and testing it here
       would be testing Windows. What IS this module's property, and the one worth pinning, is that
       the key reaches disk only by way of `encryptString` — it never writes the key itself. */
    const seen = [];
    const store = fakeStore();
    const spy = { ...store, encryptString: (s) => { seen.push(s); return store.encryptString(s); } };

    ensureVaultKey({ safeStorage: spy, userData, envValue: () => null });

    assert.deepEqual(seen, [process.env.REDBOT_VAULT_KEY], 'the key did not go through the store');
    assert.deepEqual(readFileSync(keyFile(userData)), store.encryptString(process.env.REDBOT_VAULT_KEY),
      'vault.key is not the value the credential store produced');
  });

  test('refuses to generate when there is nowhere safe to put it', () => {
    /* Generating a key that cannot be stored yields an app that seals rows this launch and cannot
       open them the next — worse than refusing, because the damage is invisible until restart. */
    assert.throws(
      () => ensureVaultKey({ safeStorage: fakeStore({ available: false }), userData, envValue: () => null }),
      /credential store is unavailable/i);
    assert.equal(process.env.REDBOT_VAULT_KEY, undefined, 'a key was set despite the refusal');
    assert.ok(!existsSync(keyFile(userData)));
  });
});

describe('the second launch — the property that protects every sealed row', () => {
  test('reads the stored key back byte-identical instead of generating a new one', () => {
    const store = fakeStore();
    ensureVaultKey({ safeStorage: store, userData, envValue: () => null });
    const first = process.env.REDBOT_VAULT_KEY;

    delete process.env.REDBOT_VAULT_KEY;              // a new process
    const r = ensureVaultKey({ safeStorage: store, userData, envValue: () => null });

    assert.equal(r.source, 'os-credential-store', 'the second launch did not use the stored key');
    assert.equal(process.env.REDBOT_VAULT_KEY, first,
      'the key changed between launches — every row sealed under the first is now unopenable');
  });

  test('a key that will not decrypt is an error, never a silent regeneration', () => {
    ensureVaultKey({ safeStorage: fakeStore(), userData, envValue: () => null });
    const before = readFileSync(keyFile(userData));

    delete process.env.REDBOT_VAULT_KEY;
    assert.throws(
      () => ensureVaultKey({ safeStorage: fakeStore({ failDecrypt: true }), userData, envValue: () => null }),
      /cannot decrypt it/i);
    /* A different Windows user is recoverable by signing in as the right one — but only if the
       file is still there. Overwriting it is the one irreversible move available here. */
    assert.deepEqual(readFileSync(keyFile(userData)), before, 'the stored key was modified');
  });

  test('a stored key with no way to open it refuses rather than starting keyless', () => {
    ensureVaultKey({ safeStorage: fakeStore(), userData, envValue: () => null });
    delete process.env.REDBOT_VAULT_KEY;
    assert.throws(
      () => ensureVaultKey({ safeStorage: fakeStore({ available: false }), userData, envValue: () => null }),
      /cannot be opened|unavailable/i);
  });
});

describe('a key already in the environment', () => {
  const ENV_KEY = 'A'.repeat(43) + '=';   // 32 bytes, base64

  test('is used as-is and adopted into the store for next time', () => {
    process.env.REDBOT_VAULT_KEY = ENV_KEY;
    const r = ensureVaultKey({ safeStorage: fakeStore(), userData, envValue: () => null });
    assert.equal(r.source, 'environment');
    assert.equal(r.stored, true);
    assert.equal(process.env.REDBOT_VAULT_KEY, ENV_KEY, 'the environment key was replaced');
  });

  test('never overwrites a DIFFERENT key that is already stored', () => {
    /* The orphaning case the module's own comment calls out: a shell variable must not be allowed
       to replace the key that sealed the rows already in the database. */
    const store = fakeStore();
    ensureVaultKey({ safeStorage: store, userData, envValue: () => null });   // stores key A
    const storedBefore = readFileSync(keyFile(userData));

    delete process.env.REDBOT_VAULT_KEY;
    process.env.REDBOT_VAULT_KEY = ENV_KEY;                                   // shell offers key B
    const r = ensureVaultKey({ safeStorage: store, userData, envValue: () => null });

    assert.equal(r.stored, false, 'the environment key overwrote the stored one');
    assert.deepEqual(readFileSync(keyFile(userData)), storedBefore,
      'vault.key was rewritten — every row sealed under the previous key is now unopenable');
  });

  test('still works for this run when the store refuses to hold it', () => {
    process.env.REDBOT_VAULT_KEY = ENV_KEY;
    const r = ensureVaultKey({ safeStorage: fakeStore({ failEncrypt: true }), userData, envValue: () => null });
    assert.equal(r.source, 'environment');
    assert.equal(r.stored, false);
    assert.equal(process.env.REDBOT_VAULT_KEY, ENV_KEY);
  });
});

describe('upgrading a checkout install', () => {
  const FILE_KEY = 'B'.repeat(43) + '=';

  test('imports the db/.env key rather than generating over the rows it sealed', () => {
    const r = ensureVaultKey({ safeStorage: fakeStore(), userData, envValue: (n) => (n === 'REDBOT_VAULT_KEY' ? FILE_KEY : null) });
    assert.equal(r.source, 'imported-from-db-env');
    assert.equal(r.stored, true);
    assert.equal(process.env.REDBOT_VAULT_KEY, FILE_KEY);
  });

  test('the stored copy is what a later launch reads, so db/.env is needed once', () => {
    const store = fakeStore();
    ensureVaultKey({ safeStorage: store, userData, envValue: () => FILE_KEY });
    delete process.env.REDBOT_VAULT_KEY;

    const r = ensureVaultKey({ safeStorage: store, userData, envValue: () => null });
    assert.equal(r.source, 'os-credential-store');
    assert.equal(process.env.REDBOT_VAULT_KEY, FILE_KEY, 'the imported key did not survive');
  });

  test('the OS store wins over db/.env — order 2 before 3', () => {
    /* Both present and different. Reading db/.env would swap the key under the sealed rows. */
    const store = fakeStore();
    ensureVaultKey({ safeStorage: store, userData, envValue: () => null });   // generates + stores
    const stored = process.env.REDBOT_VAULT_KEY;

    delete process.env.REDBOT_VAULT_KEY;
    const r = ensureVaultKey({ safeStorage: store, userData, envValue: () => FILE_KEY });
    assert.equal(r.source, 'os-credential-store');
    assert.equal(process.env.REDBOT_VAULT_KEY, stored, 'db/.env overrode the stored key');
  });
});

test('the return value never carries the key itself', () => {
  /* `src/vault.ts` holds the same rule: nothing may return, log or throw the key. */
  const r = ensureVaultKey({ safeStorage: fakeStore(), userData, envValue: () => null });
  assert.ok(!JSON.stringify(r).includes(process.env.REDBOT_VAULT_KEY),
    `the key leaked through the return value: ${JSON.stringify(r)}`);
  assert.deepEqual(Object.keys(r).sort(), ['source', 'stored']);
});

test('a pre-existing vault.key that is not ours is refused, not replaced', () => {
  /* Whatever wrote it, it is not this test's fake — the module must not decide it is junk. */
  writeFileSync(keyFile(userData), Buffer.from('some other program wrote this', 'utf8'));
  assert.throws(
    () => ensureVaultKey({ safeStorage: fakeStore(), userData, envValue: () => null }),
    /cannot decrypt it/i);
});
