/**
 * credentials — sealed secrets in redbot.credentials.
 *
 * This module moves CIPHERTEXT. It never encrypts, never decrypts and never sees a plaintext
 * secret; that is src/vault.ts's job, and keeping the two apart is what makes it possible to
 * read this file and confirm no cleartext path exists.
 *
 * `listCredentials` deliberately does not select the ciphertext. Listing is what a UI does,
 * and a UI has no business holding sealed bytes it cannot open — see src/credentials.ts.
 */
import type { Db } from '../db.js';
import type { SealedSecret } from '../vault.js';

/** A stored secret's metadata — everything except the sealed bytes. Safe to show a person. */
export interface CredentialSummary {
  scope: string;
  name: string;
  keyId: string;
  hint: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

interface SealedRow {
  algo: string;
  key_id: string;
  iv: Buffer;
  auth_tag: Buffer;
  ciphertext: Buffer;
  hint: string | null;
}

interface SummaryRow {
  scope: string;
  name: string;
  key_id: string;
  hint: string | null;
  created_at: Date;
  updated_at: Date;
  last_used_at: Date | null;
}

/** Store a sealed secret, replacing any secret already under that (scope, name). */
export async function putCredential(
  db: Db, scope: string, name: string, sealed: SealedSecret
): Promise<void> {
  await db.query(
    `INSERT INTO redbot.credentials
       (scope, name, algo, key_id, iv, auth_tag, ciphertext, hint)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (scope, name) DO UPDATE SET
       algo       = EXCLUDED.algo,
       key_id     = EXCLUDED.key_id,
       iv         = EXCLUDED.iv,
       auth_tag   = EXCLUDED.auth_tag,
       ciphertext = EXCLUDED.ciphertext,
       hint       = EXCLUDED.hint,
       -- A replaced secret is a new secret: whether the OLD one was ever used says nothing
       -- about this one, and leaving the old timestamp would misreport it as already in use.
       last_used_at = NULL`,
    [scope, name, sealed.algo, sealed.keyId, sealed.iv, sealed.authTag, sealed.ciphertext, sealed.hint]
  );
}

/** The sealed secret, or null if there is none. Still sealed — only the vault can open it. */
export async function getCredential(db: Db, scope: string, name: string): Promise<SealedSecret | null> {
  const r = await db.query<SealedRow>(
    `SELECT algo, key_id, iv, auth_tag, ciphertext, hint
       FROM redbot.credentials WHERE scope = $1 AND name = $2`,
    [scope, name]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    algo: row.algo,
    keyId: row.key_id,
    iv: row.iv,
    authTag: row.auth_tag,
    ciphertext: row.ciphertext,
    hint: row.hint
  };
}

/** What is in the vault, without the sealed bytes. */
export async function listCredentials(db: Db): Promise<CredentialSummary[]> {
  const r = await db.query<SummaryRow>(
    `SELECT scope, name, key_id, hint, created_at, updated_at, last_used_at
       FROM redbot.credentials ORDER BY scope, name`
  );
  return r.rows.map((row) => ({
    scope: row.scope,
    name: row.name,
    keyId: row.key_id,
    hint: row.hint,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null
  }));
}

/** Remove a secret. Reports whether there was one, so a caller can tell "gone" from "never there". */
export async function deleteCredential(db: Db, scope: string, name: string): Promise<boolean> {
  const r = await db.query(
    'DELETE FROM redbot.credentials WHERE scope = $1 AND name = $2', [scope, name]
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Record that a secret was actually used.
 *
 * Kept separate from `getCredential` so a read for inspection is not indistinguishable from a
 * read that sent the key somewhere — "is anything still using this credential?" is the
 * question you want answered honestly before revoking one.
 */
export async function touchCredentialUsed(db: Db, scope: string, name: string): Promise<void> {
  await db.query(
    'UPDATE redbot.credentials SET last_used_at = now() WHERE scope = $1 AND name = $2', [scope, name]
  );
}
