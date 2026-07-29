-- 0013_account_machines — which browser, on which machine, for a shared account.
--
-- THE PROBLEM THIS SPLITS APART. `redbot.accounts` (0002) mixes two kinds of fact in one row.
-- Most of it is portable and worth sharing: who this account is, what it talks about, which
-- subreddits, the daily ceiling, the quiet hours. Two of the columns are not portable at all —
-- `profile_dir` names a folder under data/ on ONE computer, and `debug_port` names a TCP port
-- that is free on ONE computer. Pointing a second machine at the same database therefore hands
-- it the first machine's port, and a port is a rendezvous with whatever got there first: on the
-- development machine 9222 is held by Lenovo Vantage's Edge WebView, which speaks the debugging
-- protocol fluently and would be driven as though it were the account's own Chrome.
--
-- So the browser binding moves here, keyed by machine, and the account row goes back to being
-- what it claims to be: a description you can share.
--
-- STILL NO CREDENTIALS, and now for a second reason. The Reddit session lives in the Chrome
-- profile FOLDER, encrypted under a key that Windows DPAPI has bound to one user on one
-- machine — measured: the cookies in data/chrome-profile-a carry the `v10` tag and Local State
-- holds a DPAPI-wrapped `encrypted_key`. Copying that folder to another machine yields a
-- signed-out profile. This table therefore stores the folder's NAME, never its contents: what
-- syncs is "this account uses that folder here", and each machine still signs in once, by hand.
--
-- The legacy `accounts.profile_dir` / `accounts.debug_port` columns are deliberately NOT
-- dropped. Every existing install has its real values there and no row here yet, so the read
-- path falls back to them until this machine claims a binding — an upgrade that changes nothing
-- until you ask it to.

CREATE TABLE redbot.account_machines (
  -- Which computer. Human-readable on purpose: an operator looking at this table needs to know
  -- which machine a row is about, and a UUID would make them go and look it up. Resolved by
  -- src/machine.ts and pinned in data/machine-id so a hostname change cannot orphan bindings.
  machine      text        NOT NULL CHECK (machine ~ '^[A-Za-z0-9_.-]{1,64}$'),

  handle       text        NOT NULL REFERENCES redbot.accounts (handle) ON DELETE CASCADE,

  -- The folder under data/ holding this account's signed-in Chrome, on THIS machine.
  profile_dir  text        CHECK (profile_dir IS NULL OR profile_dir ~ '^[A-Za-z0-9_.-]{1,80}$'),

  -- The CDP port that Chrome is started on here. Null means "not set up on this machine yet",
  -- which is exactly the state a second machine is in before anybody signs in on it.
  debug_port   integer     CHECK (debug_port BETWEEN 1 AND 65535),

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (machine, handle),

  -- Two accounts sharing a port on one machine is two Reddit identities taking turns in one
  -- browser, which the standing rules forbid outright. The console checks this before it
  -- writes; the constraint is what makes it true even when two clicks race.
  -- NULLs compare as distinct in Postgres, so any number of unbound accounts coexist.
  CONSTRAINT one_account_per_port_per_machine   UNIQUE (machine, debug_port),
  CONSTRAINT one_account_per_folder_per_machine UNIQUE (machine, profile_dir)
);

COMMENT ON TABLE redbot.account_machines IS
  'Which Chrome profile folder and debugging port an account uses ON A GIVEN MACHINE. Split out of redbot.accounts so the account description can be shared between computers while the browser binding stays local. Holds no credentials — the Reddit session is in the folder, DPAPI-bound to one machine, and does not travel.';
COMMENT ON COLUMN redbot.account_machines.debug_port IS
  'Null means this account has not been set up on this machine yet. A port free on one computer is not free on another.';

-- The console asks "what is set up on this machine" on every accounts read.
CREATE INDEX account_machines_by_machine ON redbot.account_machines (machine);

CREATE TRIGGER account_machines_set_updated_at
  BEFORE UPDATE ON redbot.account_machines
  FOR EACH ROW EXECUTE FUNCTION redbot.set_updated_at();
