-- Reverses 0004_gap_analyses.
DROP TABLE   IF EXISTS redbot.gaps;
DROP TRIGGER IF EXISTS gap_analyses_set_updated_at ON redbot.gap_analyses;
DROP TABLE   IF EXISTS redbot.gap_analyses;
DROP TYPE    IF EXISTS redbot.gap_kind;
