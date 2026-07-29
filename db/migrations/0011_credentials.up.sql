-- 0011_credentials — the vault.
--
-- 0002_accounts says, in its own comment: "DELIBERATELY ABSENT: credentials. [...] A database
-- is backed up, dumped and copied around; the moment a session cookie lands in one it is in
-- every dump forever." That reasoning is not repealed here — it is satisfied.
--
-- This table stores CIPHERTEXT ONLY. Every secret is sealed with AES-256-GCM (src/vault.ts)
-- under a master key that lives OUTSIDE the database, in REDBOT_VAULT_KEY or db/.env — the
-- same place the Postgres password lives, and a place no pg_dump reaches. A stolen dump
-- yields bytes with no key: the objection 0002 raised was to *plaintext* in a dump, and
-- plaintext is exactly what never lands here.
--
-- What still must NOT come near this table:
--   * the master key itself. `key_id` is a SHA-256 fingerprint of it, not the key — it exists
--     so a row encrypted under a rotated-away key fails with "wrong key" instead of an
--     unexplained GCM authentication error.
--   * the Chrome profiles under data/chrome-profile-*/. Those are Chrome's own on-disk format
--     and Chrome must read them from a real directory; they cannot be a column, sealed or not.
--   * the Postgres password. It unlocks the database this table lives in — storing it here is
--     a locked key inside the locked box.

CREATE TABLE redbot.credentials (
  -- Who the secret belongs to. 'global' for machine-wide secrets; otherwise an operator or
  -- account name. Not a foreign key: an operator is a folder on disk (data/operators/), not a
  -- row, and a credential must not become undeleteable because its owner was never a record.
  scope        text        NOT NULL DEFAULT 'global'
                           CHECK (scope ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),

  -- What the secret IS, e.g. 'anthropic_api_key'. Same shape rule as scope so a name is
  -- always safe to print in a log line, an error or a UI list.
  name         text        NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),

  -- Pinned rather than free text: a row claiming an algorithm src/vault.ts does not implement
  -- is a row nothing can open, and it should be impossible to write rather than puzzling to read.
  algo         text        NOT NULL DEFAULT 'aes-256-gcm' CHECK (algo = 'aes-256-gcm'),

  -- First 12 hex of SHA-256(master key). A fingerprint, never the key: SHA-256 is not
  -- reversible, and 12 hex characters identify which key sealed this row without narrowing it.
  key_id       text        NOT NULL CHECK (key_id ~ '^[0-9a-f]{12}$'),

  -- GCM: a 96-bit nonce and a 128-bit tag are the sizes src/vault.ts writes. Fixed-length
  -- CHECKs mean a truncated or hand-edited row is refused at write time, not at decrypt time.
  iv           bytea       NOT NULL CHECK (length(iv) = 12),
  auth_tag     bytea       NOT NULL CHECK (length(auth_tag) = 16),
  ciphertext   bytea       NOT NULL CHECK (length(ciphertext) > 0),

  -- A deliberate, bounded disclosure: at most 4 characters, so an operator can tell
  -- "sk-ant-...f4a2" from "sk-ant-...9c01" in a list without decrypting anything. Four
  -- trailing characters of a key are not usable as a key; the CHECK is what keeps this a
  -- hint and stops it drifting into "store a bit of the secret in the clear".
  hint         text        CHECK (hint IS NULL OR length(hint) <= 4),

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Answers "is this credential still in use?" before someone revokes one that is.
  last_used_at timestamptz,

  PRIMARY KEY (scope, name)
);

COMMENT ON TABLE redbot.credentials IS
  'Encrypted secrets. AES-256-GCM ciphertext only; the master key lives outside the database (REDBOT_VAULT_KEY / db/.env). A dump of this table without that key yields nothing. See src/vault.ts.';
COMMENT ON COLUMN redbot.credentials.key_id IS
  'SHA-256 fingerprint of the master key (first 12 hex) — identifies which key sealed the row. NEVER the key itself.';
COMMENT ON COLUMN redbot.credentials.hint IS
  'At most 4 trailing characters, so a person can identify a key in a list without decrypting it.';
COMMENT ON COLUMN redbot.credentials.ciphertext IS
  'AES-256-GCM ciphertext. Plaintext never touches this database.';

CREATE TRIGGER credentials_set_updated_at
  BEFORE UPDATE ON redbot.credentials
  FOR EACH ROW EXECUTE FUNCTION redbot.set_updated_at();
