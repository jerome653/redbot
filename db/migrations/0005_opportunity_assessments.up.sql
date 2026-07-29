-- 0005_opportunity_assessments — contribute or stay silent.
--
-- Mirrors OpportunityAssessment and ContributionThesis in src/types.ts:73 and :67.
-- The score is DERIVED in code from the gap analysis and thread signals, not chosen
-- freely by a model — that inversion is the project's response to HRC-001.

CREATE TYPE redbot.opportunity_verdict AS ENUM ('contribute', 'skip');

CREATE TABLE redbot.opportunity_assessments (
  thread_id             text PRIMARY KEY REFERENCES redbot.threads (id) ON DELETE CASCADE,
  permalink             text        NOT NULL,
  title                 text        NOT NULL,
  verdict               redbot.opportunity_verdict NOT NULL,
  score                 smallint    NOT NULL CHECK (score BETWEEN 0 AND 100),

  -- ContributionThesis, flattened. Null as a group when the model would not make the
  -- case for replying — which is itself a recorded outcome, not a missing value.
  thesis_why_thread     text,
  thesis_what_new       text,
  thesis_why_not_silent text,

  reasons               text[]      NOT NULL DEFAULT '{}',
  assessed_at           timestamptz NOT NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- All three or none. A partial thesis is the shape of an argument that was never
  -- actually made, and it must not be storable.
  CONSTRAINT thesis_is_whole CHECK (
    (thesis_why_thread IS NULL AND thesis_what_new IS NULL AND thesis_why_not_silent IS NULL)
    OR
    (thesis_why_thread IS NOT NULL AND thesis_what_new IS NOT NULL AND thesis_why_not_silent IS NOT NULL)
  )
);

COMMENT ON TABLE  redbot.opportunity_assessments IS
  'Contribute-or-skip, decided before any draft exists. Mirrors data/assessments.json (src/types.ts:73).';
COMMENT ON COLUMN redbot.opportunity_assessments.score IS
  '0-100, computed in code from the gap analysis and thread signals. Not a model''s free choice.';
COMMENT ON CONSTRAINT thesis_is_whole ON redbot.opportunity_assessments IS
  'If whyThread, whatNew and whyNotSilent cannot all be stated, there is nothing to contribute and the correct action is silence.';

CREATE INDEX opportunity_assessments_verdict_idx ON redbot.opportunity_assessments (verdict);
CREATE INDEX opportunity_assessments_score_idx   ON redbot.opportunity_assessments (score DESC);

CREATE TRIGGER opportunity_assessments_set_updated_at
  BEFORE UPDATE ON redbot.opportunity_assessments
  FOR EACH ROW EXECUTE FUNCTION redbot.set_updated_at();
