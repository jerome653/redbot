-- Reverses 0013_account_machines.
--
-- Safe to run: the legacy accounts.profile_dir / accounts.debug_port columns were never
-- dropped, so removing this table returns every install to the single-machine behaviour it
-- had before. What is lost is the OTHER machines' bindings — this machine's own values are
-- still in data/accounts.json and can be put back with `redbot accounts import`.
DROP TRIGGER IF EXISTS account_machines_set_updated_at ON redbot.account_machines;
DROP TABLE   IF EXISTS redbot.account_machines;
