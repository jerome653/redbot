-- 0009_event_logs — the append-only record of what actually happened.
--
-- Seven logs, one table each. On disk these are JSONL files that are only ever
-- appended to; here they keep that discipline — no updated_at, no triggers, and
-- nothing in this migration is designed to be UPDATEd.
--
--   history       data/history.jsonl        src/types.ts:206
--   observations  data/observations.jsonl   src/health.ts:48
--   reviews       data/reviews.jsonl        src/review.ts:63
--   regret        data/regret.jsonl         src/review.ts:155
--   interactions  data/interactions.jsonl   src/interactions.ts:105
--   trace         data/trace.jsonl          src/trace.ts:31
--   confirmations data/confirmations.jsonl  src/confirm.ts:76
--
-- This file mirrors Postgres 0009 EXACTLY, including the columns 0009 was missing — the ones
-- 0010 goes on to add. It would have been less work to fold 0010 in here, and that is precisely
-- why it was not done: the two directories are numbered 1:1 so a reader can diff them, and a
-- migration that quietly did its successor's job would break that.
--
-- Postgres declared 14 enum types across these seven tables. All are inlined as CHECKs. The
-- three `numeric(p,s)` columns become REAL: `pg` hands a numeric back as a STRING (the row
-- interfaces in src/db/logs.ts say so — "numeric arrives as a string") and the mappers wrap
-- them in Number(). SQLite returns a number, Number() of a number is that number, so the
-- mappers keep working; their `: string` annotations are corrected where they are read.

-- ---------------------------------------------------------------------------
-- history — feeds the health state machine and the reliability metrics
-- ---------------------------------------------------------------------------

CREATE TABLE history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL CHECK (ts LIKE '____-__-__T%Z'),

  -- Retired members are retained deliberately. 'analyze' is emitted by no code since
  -- D-01 (2026-07-23), but seven lines already in history.jsonl use it. Removing the
  -- value would not delete those lines; it would only stop them being readable.
  kind       TEXT NOT NULL CHECK (kind IN (
               'job.recovered', 'job.retry', 'job.failed', 'job.action',
               'login', 'login.fail',
               'read', 'operator.add', 'search', 'search.preview',
               'analyze',                                    -- RETIRED 2026-07-23 (D-01)
               'gap', 'opportunity',
               'auto.cycle', 'auto.skip', 'auto.error',
               'draft', 'draft.declined',
               'review', 'approve', 'reject',
               'publish.attempt', 'publish.ok', 'publish.fail',
               'ratelimit', 'selector.miss', 'gate.block',
               'session.start', 'session.end', 'session.view',
               'observe', 'error')),
  account    TEXT,                  -- null for events not taken as any account
  subreddit  TEXT,
  thread_url TEXT,
  permalink  TEXT,
  status     TEXT CHECK (status IS NULL OR status IN ('ok', 'failed', 'blocked', 'unknown')),
  summary    TEXT NOT NULL,
  data       TEXT CHECK (data IS NULL OR json_valid(data))
);

-- Was COMMENT ON TABLE history:
--   'The local activity log. Only events an operator must act on are recorded; routine job
--    transitions stay in jobs.'
-- Was COMMENT ON COLUMN history.account:
--   'Not a foreign key: history outlives the account row, and an event that happened must remain
--    readable after the account is removed.'

CREATE INDEX history_ts_idx      ON history (ts DESC);
CREATE INDEX history_kind_idx    ON history (kind);
CREATE INDEX history_account_idx ON history (account);


-- ---------------------------------------------------------------------------
-- observations — post-publication readings (Part F)
-- ---------------------------------------------------------------------------

CREATE TABLE observations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL CHECK (ts LIKE '____-__-__T%Z'),
  account    TEXT,
  kind       TEXT NOT NULL CHECK (kind IN (
               'karma', 'account-created',
               'reply-visible-signed-in', 'reply-visible-signed-out',
               'reply-absent-signed-out', 'reply-absent-signed-in',
               'reply-marked-removed', 'reply-marked-deleted',
               'reply-vote-count', 'reply-child-count',
               'login-refused', 'account-suspended-notice')),

  -- How it was seen. A signed-out reading is a different fact from a signed-in one:
  -- only a third party can establish that something is publicly visible.
  vector     TEXT NOT NULL CHECK (vector IN ('signed-in', 'signed-out', 'unauthenticated-http')),
  permalink  TEXT,
  checkpoint TEXT CHECK (checkpoint IS NULL OR checkpoint IN ('immediate', '1h', '24h', '7d')),

  -- Observation.value is number | string | boolean | null in src/health.ts:56. Stored
  -- as JSON so a karma count stays a number and a notice stays a string, rather than
  -- both being flattened to text and needing to be guessed apart later.
  value      TEXT CHECK (value IS NULL OR json_valid(value)),
  note       TEXT
);

CREATE INDEX observations_ts_idx      ON observations (ts DESC);
CREATE INDEX observations_account_idx ON observations (account);
CREATE INDEX observations_kind_idx    ON observations (kind);


-- ---------------------------------------------------------------------------
-- reviews — the operator's structured verdict at the approval prompt
-- ---------------------------------------------------------------------------

CREATE TABLE reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL CHECK (ts LIKE '____-__-__T%Z'),
  draft_id      TEXT NOT NULL,
  thread_id     TEXT NOT NULL,
  permalink     TEXT NOT NULL,
  decision      TEXT NOT NULL CHECK (decision IN ('approved', 'edited', 'rejected')),
  reason_code   TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  operator      TEXT,

  -- Seconds from the draft appearing at the prompt to the operator deciding. Optional
  -- because nothing timestamped the prompt before 2026-07-23, and a reconstructed
  -- reading would be a reading of the wrong thing.
  review_seconds  INTEGER CHECK (review_seconds  >= 0),
  total_seconds   INTEGER CHECK (total_seconds   >= 0),

  -- Present only for 'edited'.
  edit_chars_before INTEGER CHECK (edit_chars_before >= 0),
  edit_chars_after  INTEGER CHECK (edit_chars_after  >= 0),
  edit_retained     REAL    CHECK (edit_retained BETWEEN 0 AND 1),

  -- The vocabularies are fixed and paired with the decision. An "other" bucket that
  -- fills up is a signal the list is wrong, and that signal is worth keeping — so
  -- 'other' is a member here, not an escape hatch from the constraint.
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

-- Was COMMENT ON CONSTRAINT reason_code_matches_decision:
--   'REJECT_REASONS / EDIT_REASONS / APPROVE_REASONS in src/review.ts:32. Adding a code is a
--    deliberate act and takes a migration.'

CREATE INDEX reviews_ts_idx       ON reviews (ts DESC);
CREATE INDEX reviews_draft_idx    ON reviews (draft_id);
CREATE INDEX reviews_decision_idx ON reviews (decision);


-- ---------------------------------------------------------------------------
-- regret — the questions only a person can answer
-- ---------------------------------------------------------------------------

CREATE TABLE regret (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                  TEXT NOT NULL CHECK (ts LIKE '____-__-__T%Z'),
  draft_id            TEXT NOT NULL,
  thread_id           TEXT NOT NULL,
  permalink           TEXT NOT NULL,

  -- 'standalone' is the question asked at publish time; 'regret' is the 24h question.
  kind                TEXT NOT NULL CHECK (kind IN ('standalone', 'regret')),

  -- 'yes'/'no' for standalone; one of REGRET_ANSWERS for regret.
  answer              TEXT NOT NULL,
  category            TEXT CHECK (category IS NULL OR category IN (
                        'technical', 'writing', 'opportunity', 'timing', 'safety', 'confidence')),

  -- The only field in the evidence log a machine cannot fill.
  lessons             TEXT NOT NULL DEFAULT '',
  hours_after_publish REAL NOT NULL CHECK (hours_after_publish >= 0),

  CONSTRAINT answer_matches_kind CHECK (
    (kind = 'standalone' AND answer IN ('yes', 'no'))
    OR (kind = 'regret'  AND answer IN ('unchanged', 'would-edit', 'would-delete'))
  )
);

CREATE INDEX regret_ts_idx    ON regret (ts DESC);
CREATE INDEX regret_draft_idx ON regret (draft_id);


-- ---------------------------------------------------------------------------
-- interactions — what was published and how it fared
-- ---------------------------------------------------------------------------

CREATE TABLE interactions (
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

-- Was COMMENT ON TABLE interactions:
--   'Published replies and their follow-up readings. Zero rows is the honest state until a reply
--    is actually published.'

CREATE INDEX interactions_ts_idx    ON interactions (ts DESC);
CREATE INDEX interactions_draft_idx ON interactions (draft_id);


-- ---------------------------------------------------------------------------
-- trace — structured telemetry
-- ---------------------------------------------------------------------------

CREATE TABLE trace (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL CHECK (ts LIKE '____-__-__T%Z'),

  -- Groups every event from one CLI invocation.
  run_id    TEXT NOT NULL,
  stage     TEXT NOT NULL CHECK (stage IN (
              'collect', 'gap', 'opportunity', 'draft', 'gate',
              'review', 'publish', 'observe', 'system')),

  -- Short machine-readable name, e.g. 'thread.dropped', 'headroom.corrected'.
  event     TEXT NOT NULL,
  level     TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  thread_id TEXT,
  draft_id  TEXT,
  ms        INTEGER CHECK (ms >= 0),
  data      TEXT CHECK (data IS NULL OR json_valid(data))
);

CREATE INDEX trace_ts_idx    ON trace (ts DESC);
CREATE INDEX trace_run_idx   ON trace (run_id);
CREATE INDEX trace_stage_idx ON trace (stage, level);


-- ---------------------------------------------------------------------------
-- confirmations — did the action's effect survive an independent read?
-- ---------------------------------------------------------------------------

CREATE TABLE confirmations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT    NOT NULL CHECK (ts LIKE '____-__-__T%Z'),
  action     TEXT    NOT NULL,
  account    TEXT    NOT NULL,
  job_id     TEXT,

  confirmed  INTEGER NOT NULL CHECK (confirmed IN (0, 1)),

  -- reloaded     -- re-read after a fresh navigation; the state came from the server again
  -- second-page  -- read from a different page entirely
  -- third-party  -- read by a different account or signed out — the only proof of public visibility
  -- same-page    -- read off the page the action just touched. NOT sufficient on its own
  source     TEXT    NOT NULL CHECK (source IN (
               'reloaded', 'second-page', 'third-party', 'same-page')),

  -- What was actually observed, in plain terms, for a human reading the log later.
  observed   TEXT    NOT NULL,
  permalink  TEXT,

  -- Defaults to 'unknown' and is never inferred from the fact that WE can see it.
  visibility TEXT    NOT NULL DEFAULT 'unknown'
             CHECK (visibility IN ('public', 'author-only', 'unknown')),

  ms         INTEGER NOT NULL CHECK (ms >= 0),
  error      TEXT,

  -- Only a third-party read can establish public visibility. This is the schema-level
  -- statement of the rule the confirm stage exists to enforce.
  CONSTRAINT public_visibility_needs_a_third_party CHECK (
    visibility <> 'public' OR source = 'third-party'
  )
);

-- Was COMMENT ON CONSTRAINT public_visibility_needs_a_third_party:
--   'Seeing your own comment while signed in proves nothing about whether anyone else can see
--    it.'

CREATE INDEX confirmations_ts_idx      ON confirmations (ts DESC);
CREATE INDEX confirmations_account_idx ON confirmations (account);
CREATE INDEX confirmations_job_idx     ON confirmations (job_id);
