-- Reverses 0014_thread_prefilter.
--
-- Safe: this table is derived. Everything in it is recomputed by the next `redbot opportunity`
-- from threads that are still on record, so dropping it loses a cache of a decision, not the
-- evidence the decision was made from. The console falls back to reporting the count without a
-- breakdown, which is what it did before this migration.
DROP TRIGGER IF EXISTS thread_prefilter_set_updated_at ON redbot.thread_prefilter;
DROP TABLE   IF EXISTS redbot.thread_prefilter;
DROP TYPE    IF EXISTS redbot.prefilter_drop_kind;
