-- 0016_account_proxy — one US exit per account, and the evidence that it is still that exit.
--
-- WHY TWO NEW TABLES RATHER THAN COLUMNS ON `accounts`.
--
-- The obvious shape is `proxy_host`/`proxy_port`/`proxy_enabled` on `accounts`. It is wrong here,
-- and the reason is measurable rather than stylistic. SQLite cannot attach a CHECK to a column
-- added by ALTER TABLE — the reason 0010 and 0015 both REBUILD their tables — so those columns
-- imply DROP TABLE accounts. Four tables reference accounts(handle):
--
--   0006_drafts:40           ON DELETE SET NULL
--   0008_jobs:16             ON DELETE CASCADE
--   0013_account_machines:45 ON DELETE CASCADE
--   0015_selected_account:37 ON DELETE CASCADE
--
-- and db/sqlite/migrate.mjs:102 runs every migration with PRAGMA foreign_keys = ON. Under SQLite
-- a DROP TABLE with foreign keys enabled performs an implicit DELETE FROM that FIRES the
-- referential actions. MEASURED 2026-08-03 on a fixture with the same four relationships:
--
--   before  jobs=1 drafts=1 drafts.account=a
--   after   jobs=0 drafts=1 drafts.account=null
--   accounts survived = 1
--
-- The rebuild REPORTS SUCCESS while deleting every job and orphaning every draft — which is what
-- makes it dangerous rather than merely wrong. 0015's rebuild of account_machines was safe
-- precisely because nothing references THAT table; `accounts` is the parent, and it is not.
--
-- So the exit binding lives in its own table. No rebuild of `accounts`, no foreign key touched.
--
-- WHERE EACH FACT BELONGS. 0013 split `accounts` on one principle: the account row is "a
-- description you can share", and anything machine-local moves to account_machines. A LEASED IP
-- is an account-level identity fact — it travels with the account to any machine — so it goes in
-- account_proxies, keyed by handle alone. A RELAY PORT is machine-local, so it goes on
-- account_machines, exactly like debug_port.
--
-- STILL NO CREDENTIALS. The proxy username/password goes to the vault (src/vault.ts, AES-256-GCM
-- under a key held outside the database), scope = lower(handle), name = 'proxy_auth'. The scope
-- MUST be lower-cased: 0011_credentials CHECKs `scope NOT GLOB '*[^a-z0-9._-]*'` and
-- src/credentials.ts:33 enforces /^[a-z0-9][a-z0-9._-]{0,63}$/, so a handle like
-- "Striking_Mousse6841" is refused. lower(handle) is already this codebase's canonical account
-- key (src/console-accounts.ts:89).

-- ------------------------------------------------------------------ --
-- Which exit this account owns.
-- ------------------------------------------------------------------ --
CREATE TABLE account_proxies (
  handle         TEXT    NOT NULL PRIMARY KEY REFERENCES accounts (handle) ON DELETE CASCADE,

  enabled        INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),

  -- The endpoint redbot's local relay dials. For a per-IP provider this IS the exit address;
  -- for a gateway provider it is one shared host for every account. Both shapes are allowed —
  -- see the uniqueness note below.
  proxy_host     TEXT    NOT NULL CHECK (length(proxy_host) BETWEEN 1 AND 253),
  proxy_port     INTEGER NOT NULL CHECK (proxy_port BETWEEN 1 AND 65535),
  proxy_label    TEXT    CHECK (proxy_label IS NULL OR length(proxy_label) <= 64),

  -- The VETTED identity, written only by the provenance gate, never by hand. NULL until vetted,
  -- and an un-vetted account must never be launched — "not proven" is not "fine".
  --
  -- 45 is the longest an IPv6 address with an embedded IPv4 tail can be; 7 is "0.0.0.0".
  pinned_exit_ip TEXT    CHECK (pinned_exit_ip IS NULL
                                OR length(pinned_exit_ip) BETWEEN 7 AND 45),

  -- Two letters, upper-case, so 'us' and 'US' cannot both exist and defeat a comparison.
  exit_country   TEXT    CHECK (exit_country IS NULL
                                OR (length(exit_country) = 2
                                    AND exit_country NOT GLOB '*[^A-Z]*')),

  -- The US state the exit sits in. This is what makes the browser timezone a KNOWN value rather
  -- than a guess: America/New_York and America/Los_Angeles are three hours apart, and a
  -- timezone that contradicts the exit IP is one of the most reliable proxy tells there is.
  exit_region    TEXT    CHECK (exit_region IS NULL OR length(exit_region) <= 64),

  -- Recorded because provenance is EVIDENCE, not a vendor claim. A consumer-access rDNS shape
  -- behind a product sold as a hosted ISP allocation is the contradiction worth acting on.
  exit_asn       TEXT    CHECK (exit_asn IS NULL OR length(exit_asn) <= 64),
  exit_rdns      TEXT    CHECK (exit_rdns IS NULL OR length(exit_rdns) <= 253),

  vetted_at      TEXT    CHECK (vetted_at IS NULL OR vetted_at LIKE '____-__-__T%Z'),

  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                 CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                 CHECK (updated_at LIKE '____-__-__T%Z')

  -- DELIBERATELY NO `UNIQUE (proxy_host, proxy_port)`.
  --
  -- An earlier draft had one, on the reasoning that "every account has a different proxy". It is
  -- wrong for half the market: with a per-IP provider the endpoint IS the exit and the constraint
  -- is redundant, but with a GATEWAY provider every account dials one shared host:port and picks
  -- its exit through the credential. There the constraint refuses the second account outright.
  -- The invariant we actually want is about the EXIT, not the endpoint — see the index below.
);

-- THE INVARIANT, IN THE DATABASE: no two accounts share an exit address.
--
-- A partial unique index rather than a CHECK, for the reason 0015 gives about `selected`: a CHECK
-- sees one row at a time, and "no two accounts share an exit" is a statement about the SET.
-- Partial because an un-vetted account has no pin yet, and any number of those must coexist —
-- a UNIQUE index treats each NULL as distinct in SQLite, but WHERE ... IS NOT NULL says so
-- explicitly rather than relying on that.
CREATE UNIQUE INDEX one_account_per_exit_ip
  ON account_proxies (pinned_exit_ip) WHERE pinned_exit_ip IS NOT NULL;

CREATE TRIGGER account_proxies_set_updated_at AFTER UPDATE ON account_proxies
FOR EACH ROW
BEGIN
  UPDATE account_proxies SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE handle = NEW.handle;
END;

-- ------------------------------------------------------------------ --
-- What the exit ACTUALLY was, every time anything looked. Append-only.
-- ------------------------------------------------------------------ --
--
-- WHY A LEDGER AND NOT A COLUMN. A residential exit node is somebody's device holding an
-- outbound tunnel open; it can drop, and the address then changes underneath a live session.
-- A single "last seen" column would overwrite the evidence of exactly that. This table is how a
-- silent identity swap becomes visible after the fact instead of being lost.
--
-- WHY AUTOINCREMENT AND NOT (handle, observed_at). MEASURED 2026-08-03: strftime('%f') is
-- millisecond precision, and a (handle, observed_at) primary key rejected 49 of 50 same-handle
-- inserts made inside one millisecond with "UNIQUE constraint failed". Observations are written
-- on every browser launch AND at the start of every run, so a launch immediately followed by a
-- run would have thrown. This is the shape `history` and `observations` already use
-- (0009_event_logs.up.sql:31,76).
CREATE TABLE account_exit_ips (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,

  handle      TEXT    NOT NULL REFERENCES accounts (handle) ON DELETE CASCADE,

  observed_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              CHECK (observed_at LIKE '____-__-__T%Z'),

  exit_ip     TEXT    NOT NULL CHECK (length(exit_ip) BETWEEN 7 AND 45),

  -- HOW the observation was made — the same "say how it was established" discipline src/ports.ts
  -- applies to port ownership, applied here to the network. A closed domain the database
  -- enforces, per the convention 0001 sets.
  via         TEXT    NOT NULL CHECK (via IN ('vet', 'launch', 'run', 'doctor')),

  -- Whether it matched the pin AT THE TIME. Stored rather than recomputed, because the pin can
  -- legitimately be re-vetted later and that must not rewrite history.
  matched_pin INTEGER NOT NULL CHECK (matched_pin IN (0, 1))
);

-- "What has this account's exit been lately" is the only question asked of this table.
CREATE INDEX account_exit_ips_by_handle ON account_exit_ips (handle, observed_at DESC);

-- ------------------------------------------------------------------ --
-- The relay port — machine-local, so it belongs on account_machines.
-- ------------------------------------------------------------------ --
--
-- REBUILT rather than ALTERed, for the reason at the top: SQLite cannot attach a CHECK to a
-- column added by ALTER TABLE. This rebuild is SAFE where a rebuild of `accounts` would not be —
-- nothing references account_machines (0013 says so, and 0015 already rebuilt it on that basis),
-- so dropping it fires no referential action.
CREATE TABLE account_machines_rebuilt (
  machine      TEXT    NOT NULL
               CHECK (length(machine) BETWEEN 1 AND 64
                      AND machine NOT GLOB '*[^A-Za-z0-9_.-]*'),

  handle       TEXT    NOT NULL REFERENCES accounts (handle) ON DELETE CASCADE,

  profile_dir  TEXT    CHECK (profile_dir IS NULL
                              OR (length(profile_dir) BETWEEN 1 AND 80
                                  AND profile_dir NOT GLOB '*[^A-Za-z0-9_.-]*')),

  debug_port   INTEGER CHECK (debug_port BETWEEN 1 AND 65535),

  selected     INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),

  -- Added by 0016. The loopback port this account's authenticating relay listens on, on THIS
  -- machine. Null means "no relay here yet", the state every account is in before it is bound.
  relay_port   INTEGER CHECK (relay_port BETWEEN 1 AND 65535),

  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (updated_at LIKE '____-__-__T%Z'),

  PRIMARY KEY (machine, handle),

  CONSTRAINT one_account_per_port_per_machine   UNIQUE (machine, debug_port),
  CONSTRAINT one_account_per_folder_per_machine UNIQUE (machine, profile_dir),

  -- Two accounts on one relay is two Reddit identities behind one IP — the exact correlation
  -- this whole feature is bought to remove. Same reasoning, and same shape, as the debug_port
  -- constraint above it. NULLs compare as distinct, so any number of unbound accounts coexist.
  CONSTRAINT one_account_per_relay_per_machine  UNIQUE (machine, relay_port)
);

INSERT INTO account_machines_rebuilt
  (machine, handle, profile_dir, debug_port, selected, created_at, updated_at)
SELECT machine, handle, profile_dir, debug_port, selected, created_at, updated_at
  FROM account_machines;

DROP TABLE account_machines;
ALTER TABLE account_machines_rebuilt RENAME TO account_machines;

CREATE INDEX account_machines_by_machine ON account_machines (machine);

-- Re-created after the rebuild: the invariant 0015 added, which the DROP above took with it.
CREATE UNIQUE INDEX one_selected_account_per_machine
  ON account_machines (machine) WHERE selected = 1;

CREATE TRIGGER account_machines_set_updated_at AFTER UPDATE ON account_machines
FOR EACH ROW
BEGIN
  UPDATE account_machines SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE machine = NEW.machine AND handle = NEW.handle;
END;
