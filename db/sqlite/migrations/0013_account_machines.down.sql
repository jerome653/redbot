-- Reverses 0013_account_machines.
--
-- Safe on this machine only because 0002's legacy accounts.profile_dir / accounts.debug_port
-- columns were never dropped: the read path falls back to them. A SECOND machine's bindings
-- have nowhere to fall back to and are simply lost.
DROP TRIGGER IF EXISTS account_machines_set_updated_at;
DROP TABLE   IF EXISTS account_machines;
