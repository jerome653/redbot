-- 0005_opportunity_assessments — contribute or stay silent.
--
-- Mirrors OpportunityAssessment and ContributionThesis in src/types.ts:73 and :67.
-- The score is DERIVED in code from the gap analysis and thread signals, not chosen
-- freely by a model — that inversion is the project's response to HRC-001.

-- Postgres: CREATE TYPE redbot.opportunity_verdict AS ENUM ('contribute','skip').

CREATE TABLE opportunity_assessments (
  thread_id             TEXT PRIMARY KEY REFERENCES threads (id) ON DELETE CASCADE,
  permalink             TEXT    NOT NULL,
  title                 TEXT    NOT NULL,
  verdict               TEXT    NOT NULL CHECK (verdict IN ('contribute', 'skip')),
  score                 INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),

  -- ContributionThesis, flattened. Null as a group when the model would not make the
  -- case for replying — which is itself a recorded outcome, not a missing value.
  thesis_why_thread     TEXT,
  thesis_what_new       TEXT,
  thesis_why_not_silent TEXT,

  reasons               TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(reasons)),
  assessed_at           TEXT    NOT NULL CHECK (assessed_at LIKE '____-__-__T%Z'),

  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                        CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                        CHECK (updated_at LIKE '____-__-__T%Z'),

  -- All three or none. A partial thesis is the shape of an argument that was never
  -- actually made, and it must not be storable.
  CONSTRAINT thesis_is_whole CHECK (
    (thesis_why_thread IS NULL AND thesis_what_new IS NULL AND thesis_why_not_silent IS NULL)
    OR
    (thesis_why_thread IS NOT NULL AND thesis_what_new IS NOT NULL AND thesis_why_not_silent IS NOT NULL)
  )
);

-- Was COMMENT ON TABLE opportunity_assessments:
--   'Contribute-or-skip, decided before any draft exists. Mirrors data/assessments.json
--    (src/types.ts:73).'
-- Was COMMENT ON COLUMN opportunity_assessments.score:
--   '0-100, computed in code from the gap analysis and thread signals. Not a model''s free
--    choice.'
-- Was COMMENT ON CONSTRAINT thesis_is_whole:
--   'If whyThread, whatNew and whyNotSilent cannot all be stated, there is nothing to
--    contribute and the correct action is silence.'

CREATE INDEX opportunity_assessments_verdict_idx ON opportunity_assessments (verdict);
CREATE INDEX opportunity_assessments_score_idx   ON opportunity_assessments (score DESC);

CREATE TRIGGER opportunity_assessments_set_updated_at AFTER UPDATE ON opportunity_assessments
FOR EACH ROW
BEGIN
  UPDATE opportunity_assessments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE thread_id = NEW.thread_id;
END;
