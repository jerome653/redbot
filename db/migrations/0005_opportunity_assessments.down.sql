-- Reverses 0005_opportunity_assessments.
DROP TRIGGER IF EXISTS opportunity_assessments_set_updated_at ON redbot.opportunity_assessments;
DROP TABLE   IF EXISTS redbot.opportunity_assessments;
DROP TYPE    IF EXISTS redbot.opportunity_verdict;
