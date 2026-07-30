-- Reverses 0010_event_log_completeness.
--
-- `reviews` is rebuilt back to its 0009 shape — the same procedure the up-migration used, for
-- the same reason: the constraint cannot be swapped in place. Rows whose edit_before/edit_after
-- were set are NOT silently dropped; the columns go, so that text goes with them. That is what
-- rolling back this migration means, and it is why rolling it back on a populated database
-- destroys evidence. Take a copy of the file first.
CREATE TABLE reviews_rebuilt (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL CHECK (ts LIKE '____-__-__T%Z'),
  draft_id      TEXT NOT NULL,
  thread_id     TEXT NOT NULL,
  permalink     TEXT NOT NULL,
  decision      TEXT NOT NULL CHECK (decision IN ('approved', 'edited', 'rejected')),
  reason_code   TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  operator      TEXT,
  review_seconds  INTEGER CHECK (review_seconds  >= 0),
  total_seconds   INTEGER CHECK (total_seconds   >= 0),
  edit_chars_before INTEGER CHECK (edit_chars_before >= 0),
  edit_chars_after  INTEGER CHECK (edit_chars_after  >= 0),
  edit_retained     REAL    CHECK (edit_retained BETWEEN 0 AND 1),
  CONSTRAINT reason_code_matches_decision CHECK (
    (decision = 'approved' AND reason_code IN ('as-written', 'minor-nits'))
    OR (decision = 'edited' AND reason_code IN (
          'tightened', 'corrected-fact', 'added-specifics',
          'removed-filler', 'tone', 'restructured', 'other'))
    OR (decision = 'rejected' AND reason_code IN (
          'inaccurate', 'already-covered', 'not-confident', 'off-topic',
          'adds-nothing', 'tone', 'too-long', 'unsafe', 'other'))
  ),
  CONSTRAINT edit_metrics_only_for_edits CHECK (
    decision = 'edited'
    OR (edit_chars_before IS NULL AND edit_chars_after IS NULL AND edit_retained IS NULL)
  )
);

INSERT INTO reviews_rebuilt (
  id, ts, draft_id, thread_id, permalink, decision, reason_code, note, operator,
  review_seconds, total_seconds, edit_chars_before, edit_chars_after, edit_retained
)
SELECT
  id, ts, draft_id, thread_id, permalink, decision, reason_code, note, operator,
  review_seconds, total_seconds, edit_chars_before, edit_chars_after, edit_retained
FROM reviews;

DROP TABLE reviews;
ALTER TABLE reviews_rebuilt RENAME TO reviews;

CREATE INDEX reviews_ts_idx       ON reviews (ts DESC);
CREATE INDEX reviews_draft_idx    ON reviews (draft_id);
CREATE INDEX reviews_decision_idx ON reviews (decision);

-- SQLite has supported DROP COLUMN since 3.35, and `operator` has no index or constraint on it.
ALTER TABLE regret DROP COLUMN operator;

-- `interactions` is rebuilt back to its 0009 shape rather than DROP COLUMNed, mirroring the
-- up-migration: the five columns it added carry CHECK constraints, and DROP COLUMN refuses on a
-- column a constraint mentions. Same evidence warning as `reviews` — the observation payloads in
-- thread/self/replies go with the columns.
CREATE TABLE interactions_rebuilt (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_version     TEXT NOT NULL,
  ts                 TEXT NOT NULL CHECK (ts LIKE '____-__-__T%Z'),
  kind               TEXT NOT NULL CHECK (kind IN ('publish', 'checkpoint')),
  draft_id           TEXT NOT NULL,
  thread_id          TEXT NOT NULL,
  permalink          TEXT NOT NULL,
  comment_permalink  TEXT,
  comment_id         TEXT,
  account            TEXT,
  checkpoint         TEXT,
  elapsed_minutes    REAL NOT NULL CHECK (elapsed_minutes >= 0)
);

INSERT INTO interactions_rebuilt (
  id, schema_version, ts, kind, draft_id, thread_id, permalink,
  comment_permalink, comment_id, account, checkpoint, elapsed_minutes
)
SELECT
  id, schema_version, ts, kind, draft_id, thread_id, permalink,
  comment_permalink, comment_id, account, checkpoint, elapsed_minutes
FROM interactions;

DROP TABLE interactions;
ALTER TABLE interactions_rebuilt RENAME TO interactions;

CREATE INDEX interactions_ts_idx    ON interactions (ts DESC);
CREATE INDEX interactions_draft_idx ON interactions (draft_id);
