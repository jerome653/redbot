-- Reverses 0006_drafts.
-- certification_verdict is dropped in 0007, which owns the certification tables that
-- also use it and is rolled back first.
DROP TRIGGER IF EXISTS drafts_set_updated_at ON redbot.drafts;
DROP TABLE   IF EXISTS redbot.drafts;
DROP TYPE    IF EXISTS redbot.certification_verdict;
DROP TYPE    IF EXISTS redbot.draft_status;
