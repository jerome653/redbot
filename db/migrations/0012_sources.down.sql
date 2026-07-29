-- Reverses 0012_sources.
DROP TRIGGER IF EXISTS sources_set_updated_at ON redbot.sources;
DROP TABLE   IF EXISTS redbot.sources;
DROP TYPE    IF EXISTS redbot.source_kind;
