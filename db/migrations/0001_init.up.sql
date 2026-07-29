-- 0001_init — schema, conventions, and the one shared helper.
--
-- Everything redbot owns lives in the `redbot` schema, never `public`. A named schema
-- means a future extension, a reporting view or a second application can share the
-- database without colliding, and `\dn` answers "what is this database for".
--
-- Conventions every later migration follows:
--   * ids that the engine already generates (sha1 prefixes, job ids) stay `text` and
--     stay the primary key — inventing a surrogate integer would create a second
--     identity for a thing that already has one.
--   * timestamps are `timestamptz`. The engine writes ISO-8601 strings with an offset.
--   * closed vocabularies from the TypeScript source become native enums, so a typo
--     is rejected by the database rather than discovered in a report.
--   * `updated_at` is maintained by a trigger, never by application code.

CREATE SCHEMA IF NOT EXISTS redbot;

COMMENT ON SCHEMA redbot IS
  'redbot domain tables. Mirrors the local-first JSON/JSONL store under data/; see db/README.md.';

-- Resolve unqualified names to redbot first for every session on this database, so
-- psql and any client see the domain without qualifying every table.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path TO redbot, public', current_database());
END
$$;

CREATE OR REPLACE FUNCTION redbot.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION redbot.set_updated_at() IS
  'BEFORE UPDATE trigger. Keeps updated_at honest even when a client forgets to set it.';
