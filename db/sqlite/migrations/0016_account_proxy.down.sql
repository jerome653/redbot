-- Reverses 0016_account_proxy.
--
-- WHAT IS LOST, stated plainly: every exit binding and the whole observation ledger. Rolling this
-- back removes the only record of which address each account was vetted onto, so an account that
-- is re-bound afterwards must be re-vetted from scratch — the pin is evidence, not configuration,
-- and evidence that was dropped cannot be assumed back.
--
-- What SURVIVES: the account rows, their browser bindings (profile_dir, debug_port) and the
-- per-machine selection. This rollback touches no parent table, so no cascade fires.
--
-- The vault credential is NOT removed here. It lives in `credentials` under scope = lower(handle),
-- name = 'proxy_auth', and dropping a schema object must not silently destroy a secret the
-- operator may still need — `redbot vault rm` is the deliberate action for that.

DROP TRIGGER IF EXISTS account_proxies_set_updated_at;
DROP INDEX   IF EXISTS one_account_per_exit_ip;
DROP TABLE   IF EXISTS account_proxies;

DROP INDEX   IF EXISTS account_exit_ips_by_handle;
DROP TABLE   IF EXISTS account_exit_ips;

-- account_machines goes back to its 0015 shape — same columns, same constraints, minus
-- relay_port. Rebuilt rather than ALTERed because SQLite cannot DROP a column that participates
-- in a constraint, and because the 0015 shape is what the next migration up expects to find.
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

  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (updated_at LIKE '____-__-__T%Z'),

  PRIMARY KEY (machine, handle),

  CONSTRAINT one_account_per_port_per_machine   UNIQUE (machine, debug_port),
  CONSTRAINT one_account_per_folder_per_machine UNIQUE (machine, profile_dir)
);

INSERT INTO account_machines_rebuilt
  (machine, handle, profile_dir, debug_port, selected, created_at, updated_at)
SELECT machine, handle, profile_dir, debug_port, selected, created_at, updated_at
  FROM account_machines;

DROP TABLE account_machines;
ALTER TABLE account_machines_rebuilt RENAME TO account_machines;

CREATE INDEX account_machines_by_machine ON account_machines (machine);

CREATE UNIQUE INDEX one_selected_account_per_machine
  ON account_machines (machine) WHERE selected = 1;

CREATE TRIGGER account_machines_set_updated_at AFTER UPDATE ON account_machines
FOR EACH ROW
BEGIN
  UPDATE account_machines SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE machine = NEW.machine AND handle = NEW.handle;
END;
