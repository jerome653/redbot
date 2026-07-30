-- Reverses 0015_selected_account.
--
-- The selection is LOST, and that is what rolling this back means: without the column there is
-- nowhere to record which account a machine acts as, so the install goes back to needing
-- REDBOT_ACCOUNT in the environment. Browser bindings (profile_dir, debug_port) survive.
CREATE TABLE account_machines_rebuilt (
  machine      TEXT    NOT NULL
               CHECK (length(machine) BETWEEN 1 AND 64
                      AND machine NOT GLOB '*[^A-Za-z0-9_.-]*'),
  handle       TEXT    NOT NULL REFERENCES accounts (handle) ON DELETE CASCADE,
  profile_dir  TEXT    CHECK (profile_dir IS NULL
                              OR (length(profile_dir) BETWEEN 1 AND 80
                                  AND profile_dir NOT GLOB '*[^A-Za-z0-9_.-]*')),
  debug_port   INTEGER CHECK (debug_port BETWEEN 1 AND 65535),
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

CREATE TRIGGER account_machines_set_updated_at AFTER UPDATE ON account_machines
FOR EACH ROW
BEGIN
  UPDATE account_machines SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE machine = NEW.machine AND handle = NEW.handle;
END;
