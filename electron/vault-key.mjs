/**
 * The vault master key, held by the operating system.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACES, AND WHY.
 *
 * `src/vault.ts` seals every stored secret with AES-256-GCM under a master key it reads from
 * `REDBOT_VAULT_KEY` — process environment first, then `db/.env`. That was correct while redbot
 * was a checkout: the key sat in a gitignored file beside the Postgres password, somewhere no
 * `pg_dump` reached.
 *
 * Neither half of that survives the desktop build. There is no `db/.env` in a packaged app, and
 * "somewhere a database dump does not reach" is a much weaker promise when the database is a
 * single file a person can copy to a USB stick by accident. So the key moves into the OS
 * credential store — DPAPI on Windows, Keychain on macOS — whose ciphertext is bound to one
 * machine and one user account.
 *
 * MEASURED CONSEQUENCE, and it is the right one: copying `redbot.db` to another machine yields
 * sealed rows that will not open there. That is the same answer the Chrome profiles already give,
 * for the same DPAPI reason (0013_account_machines documents it).
 *
 * THE ORDER BELOW IS THE WHOLE POINT.
 *
 * Generating a key when one already exists somewhere else would orphan every sealed row —
 * `src/vault.ts` would correctly report "sealed with a different REDBOT_VAULT_KEY", and the
 * operator's stored API key would be gone. So generation is the LAST resort, after an existing
 * key has been looked for in every place one could be:
 *
 *   1. `REDBOT_VAULT_KEY` already in the environment  -> use it, and adopt it into the store.
 *   2. The OS credential store                        -> decrypt it.
 *   3. `db/.env` (an upgrade from a checkout install)  -> IMPORT it, do not replace it.
 *   4. Nothing anywhere                                -> generate one, and only then.
 *
 * WHY THE PLAINTEXT KEY GOES INTO process.env. `src/vault.ts` must keep working unchanged in
 * plain Node — `npm run redbot doctor` from a terminal has no Electron and no safeStorage — and
 * the CLI children this app spawns need the same key. Putting it in the environment of this
 * process and its children is what lets one decryption at boot serve all of them. It is never
 * written to disk in plaintext, never logged, and never returned by any endpoint.
 * ---------------------------------------------------------------------------
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

/** Where the sealed key lives. Ciphertext only — see the header. */
export function keyFile(userData) {
  return join(userData, 'vault.key');
}

/**
 * Make a master key available in `process.env.REDBOT_VAULT_KEY`, and report how.
 *
 * `safeStorage` is passed in rather than imported so this module can be unit-tested with a fake
 * one; the real one comes from Electron and needs `app.whenReady()`.
 *
 * Returns `{ source, stored }` — never the key itself. Nothing here may return, log or throw a
 * value; `src/vault.ts` holds the same rule and every throw below names the problem only.
 */
export function ensureVaultKey({ safeStorage, userData, envValue }) {
  const file = keyFile(userData);

  /* 1. Already in the environment. A developer's shell, or a deliberate override. Adopt it into
        the store so the next launch does not depend on the shell — but never overwrite a
        DIFFERENT key that is already stored, because that would orphan rows sealed under it. */
  if (process.env.REDBOT_VAULT_KEY) {
    if (!existsSync(file) && available(safeStorage)) {
      try {
        write(file, safeStorage.encryptString(process.env.REDBOT_VAULT_KEY));
        return { source: 'environment', stored: true };
      } catch { /* the environment key still works for this run */ }
    }
    return { source: 'environment', stored: false };
  }

  /* 2. The OS credential store — the normal path on every launch after the first. */
  if (existsSync(file)) {
    if (!available(safeStorage)) {
      throw new Error(
        'A vault key is stored but the OS credential store is unavailable, so it cannot be opened. ' +
        'Stored secrets will not open this session.'
      );
    }
    let plain;
    try {
      plain = safeStorage.decryptString(readFileSync(file));
    } catch {
      // Do NOT delete it and generate a new one. The rows sealed under it would become
      // unopenable, and a key that fails to decrypt today may simply be a different Windows
      // user — recoverable by signing in as the right one.
      throw new Error(
        `${file} exists but this machine and user cannot decrypt it. It was sealed by a different ` +
        'user account or on a different machine. Nothing has been changed.'
      );
    }
    process.env.REDBOT_VAULT_KEY = plain;
    return { source: 'os-credential-store', stored: false };
  }

  /* 3. An upgrade from a checkout install: db/.env holds the key that sealed the existing rows.
        IMPORT it. This is the branch that stops a working install from losing its secrets the
        first time it is opened as a desktop app. */
  const fromFile = envValue?.('REDBOT_VAULT_KEY');
  if (fromFile) {
    process.env.REDBOT_VAULT_KEY = fromFile;
    if (available(safeStorage)) {
      try {
        write(file, safeStorage.encryptString(fromFile));
        return { source: 'imported-from-db-env', stored: true };
      } catch { /* it still works for this run out of db/.env */ }
    }
    return { source: 'imported-from-db-env', stored: false };
  }

  /* 4. Genuinely nothing anywhere: a fresh install with no secrets yet. Only now is generating
        safe, because there are no sealed rows for a new key to orphan. */
  if (!available(safeStorage)) {
    throw new Error(
      'No vault key exists and the OS credential store is unavailable, so one cannot be stored. ' +
      'Set REDBOT_VAULT_KEY in the environment to continue.'
    );
  }
  // 32 bytes, base64 — exactly what src/vault.ts parseKey() accepts.
  const generated = randomBytes(32).toString('base64');
  write(file, safeStorage.encryptString(generated));
  process.env.REDBOT_VAULT_KEY = generated;
  return { source: 'generated', stored: true };
}

function available(safeStorage) {
  try { return Boolean(safeStorage?.isEncryptionAvailable?.()); } catch { return false; }
}

function write(file, buf) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
}
