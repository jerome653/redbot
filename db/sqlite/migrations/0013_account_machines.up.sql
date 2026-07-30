-- 0013_account_machines — which browser, on which machine, for a shared account.
--
-- THE PROBLEM THIS SPLITS APART. `accounts` (0002) mixes two kinds of fact in one row.
-- Most of it is portable and worth sharing: who this account is, what it talks about, which
-- subreddits, the daily ceiling, the quiet hours. Two of the columns are not portable at all —
-- `profile_dir` names a folder under data/ on ONE computer, and `debug_port` names a TCP port
-- that is free on ONE computer. Pointing a second machine at the same database therefore hands
-- it the first machine's port, and a port is a rendezvous with whatever got there first: on the
-- development machine 9222 is held by Lenovo Vantage's Edge WebView, which speaks the debugging
-- protocol fluently and would be driven as though it were the account's own Chrome.
--
-- (Still true, and re-measured 2026-07-30 while porting this schema: attaching over CDP to
-- 127.0.0.1:9222 on this machine reports `Edg/150.0.4078.105`, user agent LenovoVantage/3.0.0.197.)
--
-- So the browser binding moves here, keyed by machine, and the account row goes back to being
-- what it claims to be: a description you can share.
--
-- ON A LOCAL DATABASE, IS THIS TABLE STILL NEEDED? Yes, and it is kept deliberately. A SQLite
-- file is one machine's, so the sharing case this table was designed for is not live today. But
-- the table is what keeps the non-portable columns SEPARATED from the portable ones, and that
-- separation is what makes a future export/sync possible at all. Collapsing it back into
-- `accounts` would be undoing the design in order to shorten a migration.
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

CREATE TABLE account_machines (
  -- Which computer. Human-readable on purpose: an operator looking at this table needs to know
  -- which machine a row is about, and a UUID would make them go and look it up. Resolved by
  -- src/machine.ts and pinned in data/machine-id so a hostname change cannot orphan bindings.
  -- Postgres: machine ~ '^[A-Za-z0-9_.-]{1,64}$'.
  machine      TEXT    NOT NULL
               CHECK (length(machine) BETWEEN 1 AND 64
                      AND machine NOT GLOB '*[^A-Za-z0-9_.-]*'),

  handle       TEXT    NOT NULL REFERENCES accounts (handle) ON DELETE CASCADE,

  -- The folder under data/ holding this account's signed-in Chrome, on THIS machine.
  -- Postgres: profile_dir ~ '^[A-Za-z0-9_.-]{1,80}$'.
  profile_dir  TEXT    CHECK (profile_dir IS NULL
                              OR (length(profile_dir) BETWEEN 1 AND 80
                                  AND profile_dir NOT GLOB '*[^A-Za-z0-9_.-]*')),

  -- The CDP port that Chrome is started on here. Null means "not set up on this machine yet",
  -- which is exactly the state a second machine is in before anybody signs in on it.
  debug_port   INTEGER CHECK (debug_port BETWEEN 1 AND 65535),

  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (updated_at LIKE '____-__-__T%Z'),

  PRIMARY KEY (machine, handle),

  -- Two accounts sharing a port on one machine is two Reddit identities taking turns in one
  -- browser, which the standing rules forbid outright. The console checks this before it
  -- writes; the constraint is what makes it true even when two clicks race.
  --
  -- The Postgres comment noted "NULLs compare as distinct in Postgres, so any number of unbound
  -- accounts coexist." SQLite behaves the same way — a UNIQUE index treats each NULL as
  -- distinct — so the property survives the port. It is load-bearing (every account on a second
  -- machine starts unbound), so it is asserted by a test rather than assumed from this comment.
  CONSTRAINT one_account_per_port_per_machine   UNIQUE (machine, debug_port),
  CONSTRAINT one_account_per_folder_per_machine UNIQUE (machine, profile_dir)
);

-- Was COMMENT ON TABLE account_machines:
--   'Which Chrome profile folder and debugging port an account uses ON A GIVEN MACHINE. Split out
--    of accounts so the account description can be shared between computers while the browser
--    binding stays local. Holds no credentials — the Reddit session is in the folder, DPAPI-bound
--    to one machine, and does not travel.'
-- Was COMMENT ON COLUMN account_machines.debug_port:
--   'Null means this account has not been set up on this machine yet. A port free on one computer
--    is not free on another.'

-- The console asks "what is set up on this machine" on every accounts read.
CREATE INDEX account_machines_by_machine ON account_machines (machine);

CREATE TRIGGER account_machines_set_updated_at AFTER UPDATE ON account_machines
FOR EACH ROW
BEGIN
  UPDATE account_machines SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE machine = NEW.machine AND handle = NEW.handle;
END;
