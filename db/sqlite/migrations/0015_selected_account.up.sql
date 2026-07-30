-- 0015_selected_account — which account THIS machine acts as, as a row rather than an env var.
--
-- WHAT THIS FIXES. `selectedAccount()` (src/config.ts) read exactly one thing: the environment
-- variable REDBOT_ACCOUNT. On a workstation with a shell that is fine — you export it, or you pass
-- it per command. In the desktop app there IS no shell, so with more than one account configured
-- the answer was permanently "none selected": `config.browser.cdpEndpoint` raised NoAccountError,
-- `src/cli.ts` refused to dispatch, and `doctor` failed on it. The install held a full corpus and
-- could not act on any of it.
--
-- WHY IT BELONGS ON account_machines RATHER THAN A NEW TABLE.
--
-- "Which account do I act as" is the same KIND of fact as "which Chrome profile and port does this
-- account use here": per-machine, not portable, and meaningless without the machine. 0013 split
-- those two columns off `accounts` for exactly that reason, and its comment says why — the account
-- row is "a description you can share", and anything machine-local has no business on it. A
-- selection stored on `accounts` would mean two computers fighting over one row.
--
-- WHY A PARTIAL UNIQUE INDEX AND NOT A CHECK.
--
-- The invariant is "at most one selected account per machine", and that is not expressible as a
-- CHECK — a CHECK sees one row at a time. `CREATE UNIQUE INDEX … WHERE selected = 1` sees the set,
-- so a second selection on the same machine is refused by the database rather than by whichever
-- writer happened to look first. The console clears before it sets, in one transaction; the index
-- is what makes that true even when two clicks race.
--
-- THE TABLE IS REBUILT rather than ALTERed, for the reason 0010 documents at length: SQLite cannot
-- attach a CHECK to a column added by ALTER TABLE, and `selected` needs `CHECK (selected IN (0,1))`
-- to keep the convention 0001 sets — a closed domain the database enforces. Nothing references
-- account_machines, so the rebuild has no dependency to break (the same thing 0010 verified before
-- rebuilding `reviews`).

CREATE TABLE account_machines_rebuilt (
  machine      TEXT    NOT NULL
               CHECK (length(machine) BETWEEN 1 AND 64
                      AND machine NOT GLOB '*[^A-Za-z0-9_.-]*'),

  handle       TEXT    NOT NULL REFERENCES accounts (handle) ON DELETE CASCADE,

  profile_dir  TEXT    CHECK (profile_dir IS NULL
                              OR (length(profile_dir) BETWEEN 1 AND 80
                                  AND profile_dir NOT GLOB '*[^A-Za-z0-9_.-]*')),

  debug_port   INTEGER CHECK (debug_port BETWEEN 1 AND 65535),

  -- Added by 0015. 1 on at most one row per machine; see the partial index below.
  --
  -- Deliberately NOT defaulted to "the only account". An install with one account is unambiguous
  -- and `selectedAccount()` resolves it without a row here — inventing a selection would be the
  -- seeding that src/provision.ts refuses, and it would silently pick somebody the moment a second
  -- account was added.
  selected     INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),

  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (updated_at LIKE '____-__-__T%Z'),

  PRIMARY KEY (machine, handle),

  CONSTRAINT one_account_per_port_per_machine   UNIQUE (machine, debug_port),
  CONSTRAINT one_account_per_folder_per_machine UNIQUE (machine, profile_dir)
);

INSERT INTO account_machines_rebuilt
  (machine, handle, profile_dir, debug_port, created_at, updated_at)
SELECT machine, handle, profile_dir, debug_port, created_at, updated_at
  FROM account_machines;

DROP TABLE account_machines;
ALTER TABLE account_machines_rebuilt RENAME TO account_machines;

CREATE INDEX account_machines_by_machine ON account_machines (machine);

-- The invariant, in the database. A second `selected = 1` for the same machine is refused.
CREATE UNIQUE INDEX one_selected_account_per_machine
  ON account_machines (machine) WHERE selected = 1;

CREATE TRIGGER account_machines_set_updated_at AFTER UPDATE ON account_machines
FOR EACH ROW
BEGIN
  UPDATE account_machines SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE machine = NEW.machine AND handle = NEW.handle;
END;
