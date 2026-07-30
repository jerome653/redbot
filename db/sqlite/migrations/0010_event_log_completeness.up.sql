-- 0010_event_log_completeness — columns 0009 was missing.
--
-- 0009 was written from a partial reading of the record types and silently dropped
-- fields on the floor. The typechecker caught it when the writers were wired up. Each
-- column below exists because a real field had nowhere to go, and every one of them is
-- evidence that cannot be reconstructed after the fact.
--
-- ---------------------------------------------------------------------------
-- THE ONE PLACE SQLITE CANNOT FOLLOW POSTGRES STEP FOR STEP.
--
-- The Postgres original does, on `reviews`:
--
--     ALTER TABLE redbot.reviews DROP CONSTRAINT edit_metrics_only_for_edits;
--     ALTER TABLE redbot.reviews ADD  CONSTRAINT edit_metrics_only_for_edits CHECK (...);
--
-- SQLite's ALTER TABLE supports RENAME, ADD COLUMN, RENAME COLUMN and DROP COLUMN — and
-- nothing else. There is no DROP CONSTRAINT and no ADD CONSTRAINT, so a CHECK cannot be
-- replaced in place. The supported way to change a constraint is to rebuild the table
-- (SQLite's own documented procedure), which is what happens below.
--
-- Two things make the rebuild safe here rather than merely possible:
--
--   * Nothing references `reviews`. No foreign key, view or trigger points at it, so
--     `ALTER TABLE ... RENAME TO` has no references to rewrite and no dependency to break.
--     (This is worth re-checking before ever rebuilding a table that IS referenced.)
--   * The six ADD COLUMNs this migration also needs are folded into the new definition rather
--     than done as separate ALTERs. Doing both in one rebuild means the table is written once,
--     and the end state is identical either way.
--
-- The other two tables in this migration need only ADD COLUMN, which SQLite does support, so
-- they are translated literally.
-- ---------------------------------------------------------------------------

/* ---------------------------------------------------------------- *
 * reviews — the verbatim texts, and the decision-time snapshots
 * ---------------------------------------------------------------- */

-- src/review.ts records `before` and `after` for an edit, and says why: `reply`
-- overwrites draft.body with the edited text, so without these the model's actual
-- output is destroyed the moment a human improves it. Two integers (charsBefore,
-- charsAfter) are not a substitute — "what do humans keep changing" needs the texts.
--
-- Snapshots (quality/gates/novelty/contribution) are taken at decision time so a later
-- threshold change cannot rewrite the history of what the operator was actually looking at.
-- Kept whole as JSON: their shapes are owned by quality.ts / gates.ts, not by this schema, and
-- half-modelling them here is what produced this migration in the first place.
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

  -- Added by 0010. The generated draft, verbatim: reviews is append-only, so this is the
  -- durable copy — drafts.body can be edited again.
  edit_before   TEXT,
  edit_after    TEXT,

  quality       TEXT CHECK (quality      IS NULL OR json_valid(quality)),
  gates         TEXT CHECK (gates        IS NULL OR json_valid(gates)),
  novelty       TEXT CHECK (novelty      IS NULL OR json_valid(novelty)),
  contribution  TEXT CHECK (contribution IS NULL OR json_valid(contribution)),

  CONSTRAINT reason_code_matches_decision CHECK (
    (decision = 'approved' AND reason_code IN ('as-written', 'minor-nits'))
    OR (decision = 'edited' AND reason_code IN (
          'tightened', 'corrected-fact', 'added-specifics',
          'removed-filler', 'tone', 'restructured', 'other'))
    OR (decision = 'rejected' AND reason_code IN (
          'inaccurate', 'already-covered', 'not-confident', 'off-topic',
          'adds-nothing', 'tone', 'too-long', 'unsafe', 'other'))
  ),

  -- The edit trio must stay all-or-nothing now that the texts are part of it. This is the
  -- constraint 0010 exists to replace: 0009's version did not mention edit_before/edit_after.
  CONSTRAINT edit_metrics_only_for_edits CHECK (
    decision = 'edited'
    OR (edit_chars_before IS NULL AND edit_chars_after IS NULL AND edit_retained IS NULL
        AND edit_before IS NULL AND edit_after IS NULL)
  )
);

-- Columns listed explicitly on both sides. `INSERT INTO ... SELECT *` would silently depend on
-- column order matching, which is exactly the kind of thing that breaks quietly years later.
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

-- DROP TABLE took the three indexes with it; recreate them under the same names.
CREATE INDEX reviews_ts_idx       ON reviews (ts DESC);
CREATE INDEX reviews_draft_idx    ON reviews (draft_id);
CREATE INDEX reviews_decision_idx ON reviews (decision);

/* ---------------------------------------------------------------- *
 * regret — who answered
 * ---------------------------------------------------------------- */

-- RegretRecord.operator. The regret answer is the one field in the evidence log a
-- machine cannot fill, so which person filled it is part of the record.
ALTER TABLE regret ADD COLUMN operator TEXT;

/* ---------------------------------------------------------------- *
 * interactions — observation schema v1.0, in full
 * ---------------------------------------------------------------- */

-- ENGINE-FREEZE lists src/interactions.ts as frozen at observation schema v1.0.
-- Five of its fields had no column in 0009, which would have meant storing a v1.0
-- record as something less than v1.0 — a silent schema change to a frozen surface.
--
-- Postgres: CREATE TYPE redbot.interaction_vector AS ENUM ('signed-in','signed-out','publish').
--
-- `ALTER TABLE ... ADD COLUMN vector TEXT` would take all five columns in five lines, and was
-- the first version of this file. It is not what runs, because SQLite cannot attach a CHECK to a
-- column added that way: `vector` would have been the ONE enum out of 29 whose vocabulary the
-- database no longer enforced, leaving src/db/logs.ts as the only thing standing between a typo
-- and a stored row. 0001 states the convention this schema is built on — "a typo is rejected by
-- the database rather than discovered in a report" — and 28 out of 29 is not that convention.
--
-- So `interactions` is rebuilt, exactly as `reviews` is above and for the same reason. It is
-- equally safe to rebuild: nothing references it either. The four JSON/text columns come along
-- in the same pass.
--
-- ObservedThread / ObservedSelf / ObservedReply[] are nested observation payloads
-- whose shape is owned by the frozen module. JSON keeps them byte-faithful; a
-- normalised copy here would be a second definition free to drift from the frozen one.
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
  elapsed_minutes    REAL NOT NULL CHECK (elapsed_minutes >= 0),

  -- Added by 0010. How the reading was taken. A signed-out reading is a different fact from a
  -- signed-in one.
  vector             TEXT CHECK (vector IS NULL
                                 OR vector IN ('signed-in', 'signed-out', 'publish')),

  thread             TEXT CHECK (thread IS NULL OR json_valid(thread)),
  -- `self` is quoted: it is not reserved in SQLite today, but it reads as a keyword and quoting
  -- it costs nothing. Null is meaningful — it means the reply was not found at all.
  "self"             TEXT CHECK ("self" IS NULL OR json_valid("self")),
  replies            TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(replies)),
  note               TEXT NOT NULL DEFAULT ''
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
