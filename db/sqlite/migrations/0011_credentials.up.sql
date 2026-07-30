-- 0011_credentials — the vault.
--
-- 0002_accounts says, in its own comment: "DELIBERATELY ABSENT: credentials. [...] A database
-- is backed up, dumped and copied around; the moment a session cookie lands in one it is in
-- every dump forever." That reasoning is not repealed here — it is satisfied.
--
-- This table stores CIPHERTEXT ONLY. Every secret is sealed with AES-256-GCM (src/vault.ts)
-- under a master key that lives OUTSIDE the database. A stolen copy of the database yields
-- bytes with no key: the objection 0002 raised was to *plaintext* in a dump, and plaintext is
-- exactly what never lands here.
--
-- WHERE THE MASTER KEY LIVES NOW. The Postgres comment said "in REDBOT_VAULT_KEY or db/.env —
-- the same place the Postgres password lives, and a place no pg_dump reaches". Both halves of
-- that changed with the move to a desktop database:
--
--   * There is no Postgres password any more, so there is no longer a gitignored env file that
--     the key can hide beside.
--   * "A place no pg_dump reaches" is a weaker guarantee when the database is a single file a
--     person can copy by accident. The key must be somewhere a file copy does not pick up.
--
-- So the key moves to the OS credential store (Electron safeStorage: DPAPI on Windows, Keychain
-- on macOS), whose ciphertext is bound to one machine and one user account. REDBOT_VAULT_KEY
-- remains an override, read first, because the tests set it and because an operator has to be
-- able to restore a key they are holding. Measured consequence, and it is the right one: copying
-- redbot.db to another machine yields sealed rows that will not open there — which is the same
-- answer the Chrome profiles already give, for the same DPAPI reason (see 0013).
--
-- What still must NOT come near this table:
--   * the master key itself. `key_id` is a SHA-256 fingerprint of it, not the key — it exists
--     so a row encrypted under a rotated-away key fails with "wrong key" instead of an
--     unexplained GCM authentication error.
--   * the Chrome profiles under data/chrome-profile-*/. Those are Chrome's own on-disk format
--     and Chrome must read them from a real directory; they cannot be a column, sealed or not.

CREATE TABLE credentials (
  -- Who the secret belongs to. 'global' for machine-wide secrets; otherwise an operator or
  -- account name. Not a foreign key: an operator is a folder on disk (data/operators/), not a
  -- row, and a credential must not become undeleteable because its owner was never a record.
  --
  -- Postgres: scope ~ '^[a-z0-9][a-z0-9._-]{0,63}$'. Three assertions, so three clauses: a
  -- length bound, a first character from the narrower set, and no character anywhere outside
  -- the wider set.
  scope        TEXT    NOT NULL DEFAULT 'global'
               CHECK (length(scope) BETWEEN 1 AND 64
                      AND substr(scope, 1, 1) GLOB '[a-z0-9]'
                      AND scope NOT GLOB '*[^a-z0-9._-]*'),

  -- What the secret IS, e.g. 'anthropic_api_key'. Same shape rule as scope so a name is
  -- always safe to print in a log line, an error or a UI list.
  name         TEXT    NOT NULL
               CHECK (length(name) BETWEEN 1 AND 64
                      AND substr(name, 1, 1) GLOB '[a-z0-9]'
                      AND name NOT GLOB '*[^a-z0-9._-]*'),

  -- Pinned rather than free text: a row claiming an algorithm src/vault.ts does not implement
  -- is a row nothing can open, and it should be impossible to write rather than puzzling to read.
  algo         TEXT    NOT NULL DEFAULT 'aes-256-gcm' CHECK (algo = 'aes-256-gcm'),

  -- First 12 hex of SHA-256(master key). A fingerprint, never the key: SHA-256 is not
  -- reversible, and 12 hex characters identify which key sealed this row without narrowing it.
  key_id       TEXT    NOT NULL
               CHECK (length(key_id) = 12 AND key_id NOT GLOB '*[^0-9a-f]*'),

  -- GCM: a 96-bit nonce and a 128-bit tag are the sizes src/vault.ts writes. Fixed-length
  -- CHECKs mean a truncated or hand-edited row is refused at write time, not at decrypt time.
  --
  -- BLOB, and length() on a BLOB counts BYTES in SQLite — which is what these assert. (On TEXT
  -- it would count characters, so storing these as anything but a BLOB would break the check as
  -- well as the type.)
  iv           BLOB    NOT NULL CHECK (length(iv) = 12),
  auth_tag     BLOB    NOT NULL CHECK (length(auth_tag) = 16),
  ciphertext   BLOB    NOT NULL CHECK (length(ciphertext) > 0),

  -- A deliberate, bounded disclosure: at most 4 characters, so an operator can tell
  -- "sk-ant-...f4a2" from "sk-ant-...9c01" in a list without decrypting anything. Four
  -- trailing characters of a key are not usable as a key; the CHECK is what keeps this a
  -- hint and stops it drifting into "store a bit of the secret in the clear".
  hint         TEXT    CHECK (hint IS NULL OR length(hint) <= 4),

  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (updated_at LIKE '____-__-__T%Z'),
  -- Answers "is this credential still in use?" before someone revokes one that is.
  last_used_at TEXT CHECK (last_used_at IS NULL OR last_used_at LIKE '____-__-__T%Z'),

  PRIMARY KEY (scope, name)
);

-- Was COMMENT ON TABLE credentials:
--   'Encrypted secrets. AES-256-GCM ciphertext only; the master key lives outside the database.
--    A copy of this table without that key yields nothing. See src/vault.ts.'
-- Was COMMENT ON COLUMN credentials.key_id:
--   'SHA-256 fingerprint of the master key (first 12 hex) — identifies which key sealed the row.
--    NEVER the key itself.'
-- Was COMMENT ON COLUMN credentials.hint:
--   'At most 4 trailing characters, so a person can identify a key in a list without decrypting
--    it.'
-- Was COMMENT ON COLUMN credentials.ciphertext:
--   'AES-256-GCM ciphertext. Plaintext never touches this database.'

CREATE TRIGGER credentials_set_updated_at AFTER UPDATE ON credentials
FOR EACH ROW
BEGIN
  UPDATE credentials SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE scope = NEW.scope AND name = NEW.name;
END;
