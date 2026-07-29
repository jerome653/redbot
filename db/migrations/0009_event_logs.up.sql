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

-- ---------------------------------------------------------------------------
-- history — feeds the health state machine and the reliability metrics
-- ---------------------------------------------------------------------------

-- Retired members are retained deliberately. 'analyze' is emitted by no code since
-- D-01 (2026-07-23), but seven lines already in history.jsonl use it. Removing the
-- value would not delete those lines; it would only stop them being readable.
CREATE TYPE redbot.history_kind AS ENUM (
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
  'observe', 'error'
);

CREATE TYPE redbot.history_status AS ENUM ('ok', 'failed', 'blocked', 'unknown');

CREATE TABLE redbot.history (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts         timestamptz NOT NULL,
  kind       redbot.history_kind NOT NULL,
  account    text,                  -- null for events not taken as any account
  subreddit  text,
  thread_url text,
  permalink  text,
  status     redbot.history_status,
  summary    text NOT NULL,
  data       jsonb
);

COMMENT ON TABLE  redbot.history IS
  'The local activity log. Only events an operator must act on are recorded; routine job transitions stay in redbot.jobs.';
COMMENT ON COLUMN redbot.history.account IS
  'Not a foreign key: history outlives the account row, and an event that happened must remain readable after the account is removed.';

CREATE INDEX history_ts_idx      ON redbot.history (ts DESC);
CREATE INDEX history_kind_idx    ON redbot.history (kind);
CREATE INDEX history_account_idx ON redbot.history (account);


-- ---------------------------------------------------------------------------
-- observations — post-publication readings (Part F)
-- ---------------------------------------------------------------------------

CREATE TYPE redbot.observation_kind AS ENUM (
  'karma', 'account-created',
  'reply-visible-signed-in', 'reply-visible-signed-out',
  'reply-absent-signed-out', 'reply-absent-signed-in',
  'reply-marked-removed', 'reply-marked-deleted',
  'reply-vote-count', 'reply-child-count',
  'login-refused', 'account-suspended-notice'
);

-- How it was seen. A signed-out reading is a different fact from a signed-in one:
-- only a third party can establish that something is publicly visible.
CREATE TYPE redbot.observation_vector AS ENUM ('signed-in', 'signed-out', 'unauthenticated-http');

CREATE TYPE redbot.checkpoint AS ENUM ('immediate', '1h', '24h', '7d');

CREATE TABLE redbot.observations (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts         timestamptz NOT NULL,
  account    text,
  kind       redbot.observation_kind   NOT NULL,
  vector     redbot.observation_vector NOT NULL,
  permalink  text,
  checkpoint redbot.checkpoint,

  -- Observation.value is number | string | boolean | null in src/health.ts:56. Stored
  -- as jsonb so a karma count stays a number and a notice stays a string, rather than
  -- both being flattened to text and needing to be guessed apart later.
  value      jsonb,
  note       text
);

CREATE INDEX observations_ts_idx      ON redbot.observations (ts DESC);
CREATE INDEX observations_account_idx ON redbot.observations (account);
CREATE INDEX observations_kind_idx    ON redbot.observations (kind);


-- ---------------------------------------------------------------------------
-- reviews — the operator's structured verdict at the approval prompt
-- ---------------------------------------------------------------------------

CREATE TYPE redbot.review_decision AS ENUM ('approved', 'edited', 'rejected');

CREATE TABLE redbot.reviews (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts            timestamptz NOT NULL,
  draft_id      text        NOT NULL,
  thread_id     text        NOT NULL,
  permalink     text        NOT NULL,
  decision      redbot.review_decision NOT NULL,
  reason_code   text        NOT NULL,
  note          text        NOT NULL DEFAULT '',
  operator      text,

  -- Seconds from the draft appearing at the prompt to the operator deciding. Optional
  -- because nothing timestamped the prompt before 2026-07-23, and a reconstructed
  -- reading would be a reading of the wrong thing.
  review_seconds  integer CHECK (review_seconds  >= 0),
  total_seconds   integer CHECK (total_seconds   >= 0),

  -- Present only for 'edited'.
  edit_chars_before integer CHECK (edit_chars_before >= 0),
  edit_chars_after  integer CHECK (edit_chars_after  >= 0),
  edit_retained     numeric(5,4) CHECK (edit_retained BETWEEN 0 AND 1),

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

COMMENT ON CONSTRAINT reason_code_matches_decision ON redbot.reviews IS
  'REJECT_REASONS / EDIT_REASONS / APPROVE_REASONS in src/review.ts:32. Adding a code is a deliberate act and takes a migration.';

CREATE INDEX reviews_ts_idx       ON redbot.reviews (ts DESC);
CREATE INDEX reviews_draft_idx    ON redbot.reviews (draft_id);
CREATE INDEX reviews_decision_idx ON redbot.reviews (decision);


-- ---------------------------------------------------------------------------
-- regret — the questions only a person can answer
-- ---------------------------------------------------------------------------

CREATE TYPE redbot.regret_kind AS ENUM ('standalone', 'regret');

CREATE TYPE redbot.issue_category AS ENUM (
  'technical', 'writing', 'opportunity', 'timing', 'safety', 'confidence'
);

CREATE TABLE redbot.regret (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts                  timestamptz NOT NULL,
  draft_id            text        NOT NULL,
  thread_id           text        NOT NULL,
  permalink           text        NOT NULL,

  -- 'standalone' is the question asked at publish time; 'regret' is the 24h question.
  kind                redbot.regret_kind NOT NULL,

  -- 'yes'/'no' for standalone; one of REGRET_ANSWERS for regret.
  answer              text        NOT NULL,
  category            redbot.issue_category,

  -- The only field in the evidence log a machine cannot fill.
  lessons             text        NOT NULL DEFAULT '',
  hours_after_publish numeric(8,2) NOT NULL CHECK (hours_after_publish >= 0),

  CONSTRAINT answer_matches_kind CHECK (
    (kind = 'standalone' AND answer IN ('yes', 'no'))
    OR (kind = 'regret'  AND answer IN ('unchanged', 'would-edit', 'would-delete'))
  )
);

CREATE INDEX regret_ts_idx    ON redbot.regret (ts DESC);
CREATE INDEX regret_draft_idx ON redbot.regret (draft_id);


-- ---------------------------------------------------------------------------
-- interactions — what was published and how it fared
-- ---------------------------------------------------------------------------

CREATE TYPE redbot.interaction_kind AS ENUM ('publish', 'checkpoint');

CREATE TABLE redbot.interactions (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schema_version     text        NOT NULL,
  ts                 timestamptz NOT NULL,
  kind               redbot.interaction_kind NOT NULL,
  draft_id           text        NOT NULL,
  thread_id          text        NOT NULL,
  permalink          text        NOT NULL,
  comment_permalink  text,
  comment_id         text,
  account            text,
  checkpoint         text,
  elapsed_minutes    numeric(10,2) NOT NULL CHECK (elapsed_minutes >= 0)
);

COMMENT ON TABLE redbot.interactions IS
  'Published replies and their follow-up readings. Zero rows is the honest state until a reply is actually published.';

CREATE INDEX interactions_ts_idx    ON redbot.interactions (ts DESC);
CREATE INDEX interactions_draft_idx ON redbot.interactions (draft_id);


-- ---------------------------------------------------------------------------
-- trace — structured telemetry
-- ---------------------------------------------------------------------------

CREATE TYPE redbot.trace_stage AS ENUM (
  'collect', 'gap', 'opportunity', 'draft', 'gate', 'review', 'publish', 'observe', 'system'
);

CREATE TYPE redbot.trace_level AS ENUM ('debug', 'info', 'warn', 'error');

CREATE TABLE redbot.trace (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts        timestamptz NOT NULL,

  -- Groups every event from one CLI invocation.
  run_id    text        NOT NULL,
  stage     redbot.trace_stage NOT NULL,

  -- Short machine-readable name, e.g. 'thread.dropped', 'headroom.corrected'.
  event     text        NOT NULL,
  level     redbot.trace_level NOT NULL,
  thread_id text,
  draft_id  text,
  ms        integer     CHECK (ms >= 0),
  data      jsonb
);

CREATE INDEX trace_ts_idx    ON redbot.trace (ts DESC);
CREATE INDEX trace_run_idx   ON redbot.trace (run_id);
CREATE INDEX trace_stage_idx ON redbot.trace (stage, level);


-- ---------------------------------------------------------------------------
-- confirmations — did the action's effect survive an independent read?
-- ---------------------------------------------------------------------------

CREATE TYPE redbot.evidence_source AS ENUM (
  'reloaded',      -- re-read after a fresh navigation; the state came from the server again
  'second-page',   -- read from a different page entirely
  'third-party',   -- read by a different account or signed out — the only proof of public visibility
  'same-page'      -- read off the page the action just touched. NOT sufficient on its own
);

CREATE TYPE redbot.visibility AS ENUM ('public', 'author-only', 'unknown');

CREATE TABLE redbot.confirmations (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts         timestamptz NOT NULL,
  action     text        NOT NULL,
  account    text        NOT NULL,
  job_id     text,

  confirmed  boolean     NOT NULL,
  source     redbot.evidence_source NOT NULL,

  -- What was actually observed, in plain terms, for a human reading the log later.
  observed   text        NOT NULL,
  permalink  text,

  -- Defaults to 'unknown' and is never inferred from the fact that WE can see it.
  visibility redbot.visibility NOT NULL DEFAULT 'unknown',

  ms         integer     NOT NULL CHECK (ms >= 0),
  error      text,

  -- Only a third-party read can establish public visibility. This is the schema-level
  -- statement of the rule the confirm stage exists to enforce.
  CONSTRAINT public_visibility_needs_a_third_party CHECK (
    visibility <> 'public' OR source = 'third-party'
  )
);

COMMENT ON CONSTRAINT public_visibility_needs_a_third_party ON redbot.confirmations IS
  'Seeing your own comment while signed in proves nothing about whether anyone else can see it.';

CREATE INDEX confirmations_ts_idx      ON redbot.confirmations (ts DESC);
CREATE INDEX confirmations_account_idx ON redbot.confirmations (account);
CREATE INDEX confirmations_job_idx     ON redbot.confirmations (job_id);
