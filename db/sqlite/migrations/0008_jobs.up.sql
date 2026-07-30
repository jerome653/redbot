-- 0008_jobs — the per-account work queue.
--
-- Mirrors Job / JobSpec in src/jobs.ts:64 and :80. On disk this is one append-only
-- log per account (data/accounts/<handle>/jobs.jsonl) folded to current state, last
-- write per id winning. Here it is the folded state itself, with the log's ordering
-- preserved by created_at/updated_at.
--
-- Postgres declared job_state and job_kind as enums; both are inlined as CHECKs. Note that
-- src/db/jobs.ts casts `$3::redbot.job_state` in several places and explains why: "A bare $3
-- binds as `text`, and while `state = $3` works in assignment context, `$3 = 'running'` inside
-- a CASE has none". That problem is specific to Postgres enum typing and does not exist here —
-- the column IS text — so those casts are removed rather than translated.

CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,
  account       TEXT NOT NULL REFERENCES accounts (handle) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'read', 'search', 'opportunity', 'draft', 'certify',
                  'reply', 'reply-comment', 'post',
                  'vote', 'save', 'follow',
                  'publish')),
  -- pending    -- created, eligible to run when its preconditions are met
  -- scheduled  -- has a run_at in the future
  -- running    -- claimed by a worker
  -- waiting    -- blocked on a human decision; the scheduler will not advance it
  state         TEXT NOT NULL DEFAULT 'pending' CHECK (state IN (
                  'pending', 'scheduled', 'running', 'waiting',
                  'completed', 'cancelled', 'failed')),

  -- Free-form runner arguments: thread id, query, draft id, direction. JSON rather
  -- than columns because the set differs per kind and the engine treats it as opaque.
  args          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(args)),

  -- Earliest time this job may run. Null means "as soon as possible".
  run_at        TEXT CHECK (run_at IS NULL OR run_at LIKE '____-__-__T%Z'),

  -- This job stays pending until the named job reaches completed. Self-reference, so
  -- a dependency that is deleted nulls the link rather than removing the dependent.
  after_id      TEXT REFERENCES jobs (id) ON DELETE SET NULL,

  max_attempts  INTEGER NOT NULL DEFAULT 0 CHECK (max_attempts >= 0),
  every_minutes INTEGER CHECK (every_minutes > 0),
  note          TEXT,

  attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (updated_at LIKE '____-__-__T%Z'),
  started_at    TEXT CHECK (started_at  IS NULL OR started_at  LIKE '____-__-__T%Z'),
  finished_at   TEXT CHECK (finished_at IS NULL OR finished_at LIKE '____-__-__T%Z'),

  -- Why it is in its current state. The engine always populates this for
  -- failed/cancelled/waiting, and the database insists on it.
  detail        TEXT,

  -- Exit code of the underlying command, when one ran.
  code          INTEGER,

  CONSTRAINT terminal_and_waiting_states_explain_themselves CHECK (
    state NOT IN ('failed', 'cancelled', 'waiting') OR detail IS NOT NULL
  ),

  CONSTRAINT a_job_cannot_wait_on_itself CHECK (after_id IS NULL OR after_id <> id)
);

-- Was COMMENT ON TABLE jobs:
--   'Per-account work queue. Mirrors data/accounts/<handle>/jobs.jsonl folded to current state
--    (src/jobs.ts:80).'
-- Was COMMENT ON COLUMN jobs.state:
--   'publish, reply-comment and post are PUBLISH_KINDS: a scheduler pass parks them at
--    "waiting" for a person rather than running them.'
-- Was COMMENT ON COLUMN jobs.max_attempts:
--   '0 means one attempt and no retry — matching src/jobs.ts:74, not "never run".'

-- The scheduler's own lookup: what can this account run next.
CREATE INDEX jobs_account_state_idx ON jobs (account, state);
CREATE INDEX jobs_runnable_idx      ON jobs (state, run_at)
  WHERE state IN ('pending', 'scheduled');
CREATE INDEX jobs_kind_idx          ON jobs (kind);

CREATE TRIGGER jobs_set_updated_at AFTER UPDATE ON jobs
FOR EACH ROW
BEGIN
  UPDATE jobs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
