-- 0004_gap_analyses — what a discussion already contains, and what it is missing.
--
-- Mirrors GapAnalysis and Gap in src/types.ts:39 and :56. Produced BEFORE any draft
-- exists, on purpose: a reply written first and justified afterwards will always find
-- a justification.

CREATE TYPE redbot.gap_kind AS ENUM (
  'unanswered',
  'partial',
  'incorrect',
  'unverified',
  'missing-diagnostic'
);

CREATE TABLE redbot.gap_analyses (
  -- One analysis per thread; the engine upserts by threadId (src/store.ts:101).
  thread_id        text PRIMARY KEY REFERENCES redbot.threads (id) ON DELETE CASCADE,
  permalink        text        NOT NULL,
  title            text        NOT NULL,

  -- What the asker actually needs to know, in one line.
  question         text        NOT NULL,

  -- Claims already present in the visible comments — the "do not repeat" list that
  -- novelty checking scores a draft against.
  covered          text[]      NOT NULL DEFAULT '{}',

  already_answered boolean     NOT NULL,
  headroom         smallint    NOT NULL CHECK (headroom BETWEEN 0 AND 100),
  analyzed_at      timestamptz NOT NULL,
  model            text        NOT NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  redbot.gap_analyses IS
  'Pre-draft analysis of an existing discussion. Mirrors data/gaps.json (src/types.ts:39).';
COMMENT ON COLUMN redbot.gap_analyses.headroom IS
  '0-100, how much room is left for a useful contribution. A model self-assessment: read it as an observation, not a verdict.';
COMMENT ON COLUMN redbot.gap_analyses.model IS
  'The model that produced this analysis. Recorded because a verdict is only interpretable against the model that reached it.';

CREATE INDEX gap_analyses_analyzed_at_idx ON redbot.gap_analyses (analyzed_at DESC);

CREATE TRIGGER gap_analyses_set_updated_at
  BEFORE UPDATE ON redbot.gap_analyses
  FOR EACH ROW EXECUTE FUNCTION redbot.set_updated_at();


CREATE TABLE redbot.gaps (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id text    NOT NULL REFERENCES redbot.gap_analyses (thread_id) ON DELETE CASCADE,
  position  integer NOT NULL CHECK (position >= 0),
  kind      redbot.gap_kind NOT NULL,
  what      text    NOT NULL,
  fillable  boolean NOT NULL,

  UNIQUE (thread_id, position)
);

COMMENT ON COLUMN redbot.gaps.fillable IS
  'Model self-assessment: "could someone with the declared expertise fill this?". Measured at ~97% true, i.e. close to no signal (DEV-HANDOVER trap 4). Stored as evidence; do not gate on it.';

CREATE INDEX gaps_thread_idx ON redbot.gaps (thread_id);
CREATE INDEX gaps_kind_idx   ON redbot.gaps (kind);
