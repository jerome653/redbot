-- 0004_gap_analyses — what a discussion already contains, and what it is missing.
--
-- Mirrors GapAnalysis and Gap in src/types.ts:39 and :56. Produced BEFORE any draft
-- exists, on purpose: a reply written first and justified afterwards will always find
-- a justification.

-- Postgres: CREATE TYPE redbot.gap_kind AS ENUM
--   ('unanswered','partial','incorrect','unverified','missing-diagnostic')
-- Inlined as a CHECK on gaps.kind below.

CREATE TABLE gap_analyses (
  -- One analysis per thread; the engine upserts by threadId (src/store.ts:101).
  thread_id        TEXT PRIMARY KEY REFERENCES threads (id) ON DELETE CASCADE,
  permalink        TEXT    NOT NULL,
  title            TEXT    NOT NULL,

  -- What the asker actually needs to know, in one line.
  question         TEXT    NOT NULL,

  -- Claims already present in the visible comments — the "do not repeat" list that
  -- novelty checking scores a draft against.
  covered          TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(covered)),

  already_answered INTEGER NOT NULL CHECK (already_answered IN (0, 1)),
  headroom         INTEGER NOT NULL CHECK (headroom BETWEEN 0 AND 100),
  analyzed_at      TEXT    NOT NULL CHECK (analyzed_at LIKE '____-__-__T%Z'),
  model            TEXT    NOT NULL,

  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                   CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                   CHECK (updated_at LIKE '____-__-__T%Z')
);

-- Was COMMENT ON TABLE gap_analyses:
--   'Pre-draft analysis of an existing discussion. Mirrors data/gaps.json (src/types.ts:39).'
-- Was COMMENT ON COLUMN gap_analyses.headroom:
--   '0-100, how much room is left for a useful contribution. A model self-assessment: read it
--    as an observation, not a verdict.'
-- Was COMMENT ON COLUMN gap_analyses.model:
--   'The model that produced this analysis. Recorded because a verdict is only interpretable
--    against the model that reached it.'

CREATE INDEX gap_analyses_analyzed_at_idx ON gap_analyses (analyzed_at DESC);

CREATE TRIGGER gap_analyses_set_updated_at AFTER UPDATE ON gap_analyses
FOR EACH ROW
BEGIN
  UPDATE gap_analyses SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE thread_id = NEW.thread_id;
END;


CREATE TABLE gaps (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT    NOT NULL REFERENCES gap_analyses (thread_id) ON DELETE CASCADE,
  position  INTEGER NOT NULL CHECK (position >= 0),
  kind      TEXT    NOT NULL CHECK (kind IN (
              'unanswered', 'partial', 'incorrect', 'unverified', 'missing-diagnostic')),
  what      TEXT    NOT NULL,
  fillable  INTEGER NOT NULL CHECK (fillable IN (0, 1)),

  UNIQUE (thread_id, position)
);

-- Was COMMENT ON COLUMN gaps.fillable:
--   'Model self-assessment: "could someone with the declared expertise fill this?". Measured at
--    ~97% true, i.e. close to no signal (DEV-HANDOVER trap 4). Stored as evidence; do not gate
--    on it.'

CREATE INDEX gaps_thread_idx ON gaps (thread_id);
CREATE INDEX gaps_kind_idx   ON gaps (kind);
