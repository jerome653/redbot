-- Reverses 0012_sources.
--
-- Safe against total loss only if data/sources.json still holds the seed: `redbot sources
-- export` writes it, and `redbot sources import` reads it back. The `why` prose a person typed
-- into the console is the part that is not in the seed.
DROP TRIGGER IF EXISTS sources_set_updated_at;
DROP TABLE   IF EXISTS sources;
