-- Reverses 0010_event_log_completeness.

ALTER TABLE redbot.interactions DROP COLUMN IF EXISTS note;
ALTER TABLE redbot.interactions DROP COLUMN IF EXISTS replies;
ALTER TABLE redbot.interactions DROP COLUMN IF EXISTS self;
ALTER TABLE redbot.interactions DROP COLUMN IF EXISTS thread;
ALTER TABLE redbot.interactions DROP COLUMN IF EXISTS vector;
DROP TYPE IF EXISTS redbot.interaction_vector;

ALTER TABLE redbot.regret DROP COLUMN IF EXISTS operator;

-- Restore 0009's narrower constraint before dropping the columns it must not mention.
ALTER TABLE redbot.reviews DROP CONSTRAINT IF EXISTS edit_metrics_only_for_edits;
ALTER TABLE redbot.reviews ADD  CONSTRAINT edit_metrics_only_for_edits CHECK (
  decision = 'edited'
  OR (edit_chars_before IS NULL AND edit_chars_after IS NULL AND edit_retained IS NULL)
);

ALTER TABLE redbot.reviews DROP COLUMN IF EXISTS contribution;
ALTER TABLE redbot.reviews DROP COLUMN IF EXISTS novelty;
ALTER TABLE redbot.reviews DROP COLUMN IF EXISTS gates;
ALTER TABLE redbot.reviews DROP COLUMN IF EXISTS quality;
ALTER TABLE redbot.reviews DROP COLUMN IF EXISTS edit_after;
ALTER TABLE redbot.reviews DROP COLUMN IF EXISTS edit_before;
