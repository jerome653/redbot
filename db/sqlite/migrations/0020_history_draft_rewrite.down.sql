-- 0020_history_draft_rewrite (down) — remove `draft.rewrite` and only that.
--
-- WHAT THIS DELETES, stated plainly: every history row whose kind is 'draft.rewrite'. They cannot
-- survive a CHECK that no longer lists the value, so narrowing the enum and keeping the rows are
-- not both possible. Each such row records that a draft was mechanically unpublishable on its
-- first attempt and which quality codes a re-ask fixed — the measurement that says whether
-- prompts.ts HARD RULE 7 works. Reverting past 0020 discards that series.
--
--   SELECT ts, summary, data FROM history WHERE kind = 'draft.rewrite';
--
-- Run that first if the rate matters; nothing else in the schema holds it.
--
-- The kind list below is 0019's, verbatim, so this down migration reverts EXACTLY one value.
-- Generating it by renumbering 0019's own down file produced a file that also deleted
-- 'publish.unattended' and 'publish.refused' — a revert of one migration silently reverting two.

DELETE FROM history WHERE kind = 'draft.rewrite';

ALTER TABLE history RENAME TO history_old_0020_down;

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
               'publish.unattended', 'publish.refused',      -- ADDED 0019 — see header
               'ratelimit', 'selector.miss', 'gate.block',
               'session.start', 'session.end', 'session.view',
               'observe',
               'reset',                                      -- ADDED 3.2.1 (0017)
               'error')),
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
FROM history_old_0020_down;

DROP TABLE history_old_0020_down;

CREATE INDEX history_ts_idx      ON history (ts DESC);
CREATE INDEX history_kind_idx    ON history (kind);
CREATE INDEX history_account_idx ON history (account);
