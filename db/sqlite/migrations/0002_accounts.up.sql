-- 0002_accounts — who redbot posts as.
--
-- Mirrors AccountRecord in src/config.ts:55. `data/accounts.json` is configuration a
-- person writes; this table is the same information in queryable form.
--
-- DELIBERATELY ABSENT: credentials. No password, no cookie, no token, no session.
-- Those live in data/chrome-profile*/ and data/operators/, which are gitignored and
-- stay on one machine. A database is backed up, dumped and copied around; the moment
-- a session cookie lands in one it is in every dump forever. `profile_dir` is a path,
-- not a secret.
--
-- That reasoning does not weaken on a desktop file. It gets sharper: a SQLite database is a
-- single file a person can copy to a USB stick without meaning to, which is easier to leak by
-- accident than a container volume.

CREATE TABLE accounts (
  -- Same shape the engine enforces before it will touch the filesystem
  -- (accountDir, src/jobs.ts:101). A handle that cannot be a directory name
  -- cannot be a row either.
  --
  -- Postgres wrote this as `handle ~ '^[A-Za-z0-9_-]{1,40}$'`. GLOB is SQLite's
  -- case-sensitive pattern operator; `[^...]` is a negated class, so "contains nothing outside
  -- the set" plus a length bound is the same assertion. The trailing `-` in the class is a
  -- literal hyphen — inside a GLOB class a hyphen only means a range when it sits between two
  -- characters.
  handle          TEXT PRIMARY KEY
                  CHECK (length(handle) BETWEEN 1 AND 40
                         AND handle NOT GLOB '*[^A-Za-z0-9_-]*'),

  role            TEXT,
  speaks          TEXT,

  -- Postgres: text[] NOT NULL DEFAULT '{}'. JSON array in TEXT; src/db.ts parses it.
  knows           TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(knows)),
  subreddits      TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(subreddits)),
  timezone        TEXT,

  -- quietHours is a [start, end] pair in src/config.ts:62. Split into two columns so
  -- each can be range-checked; both null means "no quiet hours configured".
  quiet_start     INTEGER CHECK (quiet_start BETWEEN 0 AND 23),
  quiet_end       INTEGER CHECK (quiet_end   BETWEEN 0 AND 23),

  daily_ceiling   INTEGER CHECK (daily_ceiling >= 0),
  profile_dir     TEXT,
  debug_port      INTEGER CHECK (debug_port BETWEEN 1 AND 65535),
  note            TEXT,

  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                  CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                  CHECK (updated_at LIKE '____-__-__T%Z'),

  CONSTRAINT quiet_hours_are_a_pair
    CHECK ((quiet_start IS NULL) = (quiet_end IS NULL))
);

-- Was COMMENT ON TABLE accounts:
--   'Reddit accounts redbot may act as. Mirrors data/accounts.json (src/config.ts:55).
--    Holds no credentials.'
-- Was COMMENT ON COLUMN accounts.debug_port:
--   'CDP port of the Chrome this account drives. redbot attaches to a browser a person
--    started; it never launches one.'
-- Was COMMENT ON COLUMN accounts.profile_dir:
--   'Path to the Chrome profile. The profile itself holds the session and is never stored here.'

-- The Postgres set kept `updated_at` honest with one shared plpgsql function
-- (redbot.set_updated_at) and ten BEFORE UPDATE triggers. SQLite has no stored functions, so
-- each table carries its own AFTER UPDATE trigger. Three things about this translation:
--
--   1. AFTER, not BEFORE. SQLite triggers cannot assign to NEW, so the row is written and then
--      corrected. The net effect on the stored row is the same.
--   2. It is UNCONDITIONAL, matching `NEW.updated_at := now()`. Postgres overwrote an
--      updated_at the application had set explicitly, and src/db/jobs.ts does set one — so
--      guarding this with `WHEN NEW.updated_at = OLD.updated_at` would silently change
--      behaviour that is currently observable. Faithful beats tidy.
--   3. It does not recurse. SQLite's `recursive_triggers` pragma defaults to OFF, so the
--      UPDATE inside the trigger body does not re-fire the trigger. This is asserted by a test
--      rather than trusted, because the whole table would spin if it were ever turned on.
CREATE TRIGGER accounts_set_updated_at AFTER UPDATE ON accounts
FOR EACH ROW
BEGIN
  UPDATE accounts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE handle = NEW.handle;
END;
