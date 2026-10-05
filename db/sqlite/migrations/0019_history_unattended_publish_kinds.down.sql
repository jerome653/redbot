-- Reverses 0019_history_unattended_publish_kinds.
--
-- WHAT IS LOST, stated plainly: every row recording what the UNATTENDED publish rule decided.
-- `publish.unattended` and `publish.refused` are the only statements this system holds about which
-- posts an autonomous install chose by itself and which it declined, each with the reason from
-- src/autopublish.ts. They are deleted here, not migrated to another kind, because there is no
-- honest kind to move them to: `publish.attempt` means a person decided, and `gate.block` is a
-- fact about the thread rather than about the rule. Relabelling them either way would turn a real
-- record into a false one, which is worse than losing it.
--
-- So the DELETE is deliberate and comes FIRST. Leaving the rows in place would make the rebuilt
-- CHECK reject its own table's contents on the next write, and the failure would surface far from
-- here as an unexplained constraint error on an unrelated insert.
--
-- What SURVIVES: every other history row, ids included, and all three indexes. Nothing REFERENCES
-- history, so there is no cascade and nothing else to rewrite.
--
-- BEFORE ROLLING BACK, if those decisions matter:
--   sqlite3 data/redbot.db "SELECT ts, kind, summary, data FROM history
--                           WHERE kind IN ('publish.unattended','publish.refused')
--                           ORDER BY ts;" > unattended-decisions.txt

DELETE FROM history WHERE kind IN ('publish.unattended', 'publish.refused');

ALTER TABLE history RENAME TO history_old_0019_down;

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
FROM history_old_0019_down;

DROP TABLE history_old_0019_down;

CREATE INDEX history_ts_idx      ON history (ts DESC);
CREATE INDEX history_kind_idx    ON history (kind);
CREATE INDEX history_account_idx ON history (account);
