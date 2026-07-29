-- Reverses 0001_init.
--
-- CASCADE is correct here and only here: this drops the whole domain, and by the time
-- it runs every later migration has already been rolled back.

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I RESET search_path', current_database());
END
$$;

DROP FUNCTION IF EXISTS redbot.set_updated_at();
DROP SCHEMA IF EXISTS redbot CASCADE;
