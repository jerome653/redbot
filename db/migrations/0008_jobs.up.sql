-- 0008_jobs — the per-account work queue.
--
-- Mirrors Job / JobSpec in src/jobs.ts:64 and :80. On disk this is one append-only
-- log per account (data/accounts/<handle>/jobs.jsonl) folded to current state, last
-- write per id winning. Here it is the folded state itself, with the log's ordering
-- preserved by created_at/updated_at.

CREATE TYPE redbot.job_state AS ENUM (
  'pending',    -- created, eligible to run when its preconditions are met
  'scheduled',  -- has a run_at in the future
  'running',    -- claimed by a worker
  'waiting',    -- blocked on a human decision; the scheduler will not advance it
  'completed',
  'cancelled',
  'failed'
);

CREATE TYPE redbot.job_kind AS ENUM (
  'read', 'search', 'opportunity', 'draft', 'certify',
  'reply', 'reply-comment', 'post',
  'vote', 'save', 'follow',
  'publish'
);

CREATE TABLE redbot.jobs (
  id            text PRIMARY KEY,
  account       text NOT NULL REFERENCES redbot.accounts (handle) ON DELETE CASCADE,
  kind          redbot.job_kind  NOT NULL,
  state         redbot.job_state NOT NULL DEFAULT 'pending',

  -- Free-form runner arguments: thread id, query, draft id, direction. jsonb rather
  -- than columns because the set differs per kind and the engine treats it as opaque.
  args          jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Earliest time this job may run. Null means "as soon as possible".
  run_at        timestamptz,

  -- This job stays pending until the named job reaches completed. Self-reference, so
  -- a dependency that is deleted nulls the link rather than removing the dependent.
  after_id      text        REFERENCES redbot.jobs (id) ON DELETE SET NULL,

  max_attempts  integer     NOT NULL DEFAULT 0 CHECK (max_attempts >= 0),
  every_minutes integer     CHECK (every_minutes > 0),
  note          text,

  attempts      integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,

  -- Why it is in its current state. The engine always populates this for
  -- failed/cancelled/waiting, and the database insists on it.
  detail        text,

  -- Exit code of the underlying command, when one ran.
  code          integer,

  CONSTRAINT terminal_and_waiting_states_explain_themselves CHECK (
    state NOT IN ('failed', 'cancelled', 'waiting') OR detail IS NOT NULL
  ),

  CONSTRAINT a_job_cannot_wait_on_itself CHECK (after_id IS NULL OR after_id <> id)
);

COMMENT ON TABLE  redbot.jobs IS
  'Per-account work queue. Mirrors data/accounts/<handle>/jobs.jsonl folded to current state (src/jobs.ts:80).';
COMMENT ON COLUMN redbot.jobs.state IS
  'publish, reply-comment and post are PUBLISH_KINDS: a scheduler pass parks them at "waiting" for a person rather than running them.';
COMMENT ON COLUMN redbot.jobs.max_attempts IS
  '0 means one attempt and no retry — matching src/jobs.ts:74, not "never run".';

-- The scheduler's own lookup: what can this account run next.
CREATE INDEX jobs_account_state_idx ON redbot.jobs (account, state);
CREATE INDEX jobs_runnable_idx      ON redbot.jobs (state, run_at)
  WHERE state IN ('pending', 'scheduled');
CREATE INDEX jobs_kind_idx          ON redbot.jobs (kind);

CREATE TRIGGER jobs_set_updated_at
  BEFORE UPDATE ON redbot.jobs
  FOR EACH ROW EXECUTE FUNCTION redbot.set_updated_at();
