-- Reverses 0025_thread_retirement.
--
-- Loses the retirement decisions, not the threads: every row here names a thread that is still
-- in `threads` with its comments and its assessments. The cost of going down is that the
-- opportunity scan starts re-reading the whole backlog again, and the measured reason each
-- thread was set aside is gone — so a later `redbot retire --apply` recomputes the verdicts but
-- cannot recover the sentences. Nothing REFERENCES this table.
DROP TRIGGER IF EXISTS thread_retirement_set_updated_at;
DROP INDEX   IF EXISTS thread_retirement_retired_at_idx;
DROP TABLE   IF EXISTS thread_retirement;
