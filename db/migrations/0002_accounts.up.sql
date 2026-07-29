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

CREATE TABLE redbot.accounts (
  -- Same shape the engine enforces before it will touch the filesystem
  -- (accountDir, src/jobs.ts:101). A handle that cannot be a directory name
  -- cannot be a row either.
  handle          text PRIMARY KEY CHECK (handle ~ '^[A-Za-z0-9_-]{1,40}$'),

  role            text,
  speaks          text,
  knows           text[]      NOT NULL DEFAULT '{}',
  subreddits      text[]      NOT NULL DEFAULT '{}',
  timezone        text,

  -- quietHours is a [start, end] pair in src/config.ts:62. Split into two columns so
  -- each can be range-checked; both null means "no quiet hours configured".
  quiet_start     smallint    CHECK (quiet_start BETWEEN 0 AND 23),
  quiet_end       smallint    CHECK (quiet_end   BETWEEN 0 AND 23),

  daily_ceiling   integer     CHECK (daily_ceiling >= 0),
  profile_dir     text,
  debug_port      integer     CHECK (debug_port BETWEEN 1 AND 65535),
  note            text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quiet_hours_are_a_pair
    CHECK ((quiet_start IS NULL) = (quiet_end IS NULL))
);

COMMENT ON TABLE  redbot.accounts IS
  'Reddit accounts redbot may act as. Mirrors data/accounts.json (src/config.ts:55). Holds no credentials.';
COMMENT ON COLUMN redbot.accounts.debug_port IS
  'CDP port of the Chrome this account drives. redbot attaches to a browser a person started; it never launches one.';
COMMENT ON COLUMN redbot.accounts.profile_dir IS
  'Path to the Chrome profile. The profile itself holds the session and is never stored here.';

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON redbot.accounts
  FOR EACH ROW EXECUTE FUNCTION redbot.set_updated_at();
