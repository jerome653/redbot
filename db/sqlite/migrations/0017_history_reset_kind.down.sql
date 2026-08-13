-- Reverses 0017_history_reset_kind.
--
-- WHAT IS LOST, stated plainly: any row recording a reset. The narrower CHECK cannot accept
-- `kind = 'reset'`, so those rows are dropped rather than silently rewritten to something they
-- are not — a reset relabelled as an 'error' would be a false record of what happened, and this
-- table is evidence.
--
-- Rows of every other kind are copied across untouched, and the three indexes from 0009 are
-- recreated by name. Nothing REFERENCES history, so the rename has no dependencies to rewrite.

ALTER TABLE history RENAME TO history_new_0017;

CREATE TABLE history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL CHECK (ts LIKE '____-__-__T%Z'),
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
  account    TEXT,
  subreddit  TEXT,
  thread_url TEXT,
  permalink  TEXT,
  status     TEXT CHECK (status IS NULL OR status IN ('ok', 'failed', 'blocked', 'unknown')),
  summary    TEXT NOT NULL,
  data       TEXT CHECK (data IS NULL OR json_valid(data))
);

INSERT INTO history (id, ts, kind, account, subreddit, thread_url, permalink, status, summary, data)
SELECT id, ts, kind, account, subreddit, thread_url, permalink, status, summary, data
FROM history_new_0017
WHERE kind <> 'reset';

DROP TABLE history_new_0017;

CREATE INDEX history_ts_idx      ON history (ts DESC);
CREATE INDEX history_kind_idx    ON history (kind);
CREATE INDEX history_account_idx ON history (account);
