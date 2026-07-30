/**
 * The credentials vault — sealing secrets so the database can hold them.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS KEEPS
 *
 * db/migrations/0002_accounts.up.sql refused to put credentials in Postgres, for a reason
 * that is still correct: "A database is backed up, dumped and copied around; the moment a
 * session cookie lands in one it is in every dump forever."
 *
 * The objection is to PLAINTEXT in a dump. So nothing here ever writes plaintext. A secret
 * is sealed with AES-256-GCM under a master key that lives outside the database — in
 * REDBOT_VAULT_KEY or db/.env, beside the Postgres password, somewhere no pg_dump reaches.
 * A stolen dump is then bytes without a key.
 *
 * GCM rather than CBC deliberately: it authenticates. A row someone edited in place fails to
 * open instead of decrypting to plausible garbage that gets sent somewhere as an API key.
 * ---------------------------------------------------------------------------
 *
 * No secrets in this file, ever — the same rule as src/config.ts and src/db.ts. The key is
 * read, used, and never logged, echoed, returned, or put in an error message. Note that
 * every throw below names the PROBLEM and never the value.
 *
 * Zero new dependencies: node:crypto ships with the runtime. redbot's only runtime
 * dependencies are playwright and pg, and a vault is not worth a third.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { envValue } from './db.js';

/** 96-bit nonce and 128-bit tag: the sizes 0011_credentials CHECKs, named once. */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
export const VAULT_ALGO = 'aes-256-gcm';

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

/** A sealed secret — exactly the columns credentials stores. */
export interface SealedSecret {
  algo: string;
  keyId: string;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
  /** At most 4 trailing characters, so a person can identify a key without opening it. */
  hint: string | null;
}

/**
 * Accepts base64, base64url or hex, and requires exactly 32 bytes decoded.
 *
 * A short key is refused rather than stretched or padded. Padding a 6-character password up
 * to 32 bytes would produce a key that works, looks fine, and has the entropy of a
 * 6-character password — the failure mode where encryption is present and worthless.
 */
function parseKey(raw: string): Buffer {
  const s = raw.trim();
  if (!s) throw new VaultError('REDBOT_VAULT_KEY is empty.');

  let buf: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    buf = Buffer.from(s, 'hex');
  } else if (/^[A-Za-z0-9+/=_-]+$/.test(s)) {
    // base64 and base64url share a decoder in Node; '-'/'_' are handled by 'base64url'.
    const b = Buffer.from(s, /[-_]/.test(s) ? 'base64url' : 'base64');
    if (b.length === KEY_BYTES) buf = b;
  }

  if (!buf || buf.length !== KEY_BYTES) {
    throw new VaultError(
      `REDBOT_VAULT_KEY must be ${KEY_BYTES} bytes, as hex or base64. Generate one:\n` +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"\n' +
      'Then put it in db/.env as REDBOT_VAULT_KEY=... (gitignored), or set it in the environment.'
    );
  }
  return buf;
}

/** Where the vault cannot be used, in words an operator can act on. Null when it can. */
export function vaultUnavailableReason(): string | null {
  const raw = envValue('REDBOT_VAULT_KEY');
  if (!raw) {
    return 'REDBOT_VAULT_KEY is not set. Generate one:\n' +
           '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"\n' +
           'Then add it to db/.env as REDBOT_VAULT_KEY=... — it is the key to every stored secret, ' +
           'so keep it out of the database and out of git.';
  }
  try { parseKey(raw); return null; }
  catch (e) { return e instanceof Error ? e.message : String(e); }
}

/** Is the vault usable at all? Cheap enough to call before offering a vault-backed feature. */
export function vaultReady(): boolean {
  return vaultUnavailableReason() === null;
}

/**
 * The master key. Read fresh each call rather than cached at module load, so a process that
 * sets the variable after import (a test, the console) is not stuck with the absence it had
 * at startup — the mistake config.ts documents about freezing DATA too early.
 */
function masterKey(): Buffer {
  const raw = envValue('REDBOT_VAULT_KEY');
  if (!raw) throw new VaultError(vaultUnavailableReason() ?? 'the vault is not configured');
  return parseKey(raw);
}

/**
 * Which key sealed a row — SHA-256 of the key, first 12 hex.
 *
 * A fingerprint, not the key. SHA-256 does not run backwards, and this exists only so a row
 * written under a key you no longer hold reports "sealed with a different key" instead of
 * failing with an unexplained authentication error.
 */
export function keyFingerprint(key: Buffer = masterKey()): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/** The bounded hint 0011_credentials allows: at most the last 4 characters, never more. */
function hintFor(plaintext: string): string | null {
  return plaintext.length >= 8 ? plaintext.slice(-4) : null;
}

/**
 * Seal a secret. A fresh random IV every time — reusing a nonce under the same key is the one
 * mistake that breaks GCM outright, so it is generated here and never passed in.
 */
export function seal(plaintext: string): SealedSecret {
  if (typeof plaintext !== 'string' || plaintext === '') {
    throw new VaultError('Refusing to seal an empty secret.');
  }
  const key = masterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(VAULT_ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { algo: VAULT_ALGO, keyId: keyFingerprint(key), iv, authTag, ciphertext, hint: hintFor(plaintext) };
}

/**
 * Open a sealed secret.
 *
 * Fails closed on every mismatch: a different algorithm, a different key, or a tampered
 * ciphertext all throw rather than returning something. Nothing here reports a partial
 * result — a half-decrypted API key is worse than none.
 */
export function open(sealed: SealedSecret): string {
  if (sealed.algo !== VAULT_ALGO) {
    throw new VaultError(`This secret was sealed with "${sealed.algo}", which this build cannot open.`);
  }
  const key = masterKey();

  // Compared in constant time out of habit, not necessity — a fingerprint is public. The habit
  // is what stops the next comparison in this file, on something that is not public, from
  // being written with === .
  const mine = Buffer.from(keyFingerprint(key));
  const theirs = Buffer.from(sealed.keyId);
  if (mine.length !== theirs.length || !timingSafeEqual(mine, theirs)) {
    throw new VaultError(
      `This secret was sealed with a different REDBOT_VAULT_KEY (${sealed.keyId}); the key in use is ${keyFingerprint(key)}. ` +
      'Restore the original key, or delete and re-add the secret.'
    );
  }

  try {
    const decipher = createDecipheriv(VAULT_ALGO, key, sealed.iv);
    decipher.setAuthTag(sealed.authTag);
    return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // The underlying error is "unable to authenticate data", which tells an operator nothing.
    throw new VaultError(
      'This secret failed its authentication check — the stored row has been altered since it was sealed. ' +
      'It cannot be recovered; delete it and add the secret again.'
    );
  }
}
