-- 0024_history_rotation_tick — the rotation loop writes down what each tick decided.
--
-- On 2026-10-25 the rotation ran no turn for 8 h (06:54Z to 15:04Z) while a replay of
-- src/rotation-need.ts shows 10 of 13 accounts due. The loop's own log lived only in memory
-- (/api/pulse auto.log, the last 40 lines), so why it did nothing was lost with the restart.
-- tools/product/rotation.mjs tickLedger now records each outcome as a 'rotation.tick' row: one row
-- when the outcome changes plus at most an hourly heartbeat, so a resting loop writes ~24 rows a
-- day, not 144.
--
-- WHY A REBUILD. Same as 0017/0019/0020: SQLite cannot alter a CHECK in place. Nothing REFERENCES
-- history; its three indexes are recreated by name. Every row is kept; one value is added.

ALTER TABLE history RENAME TO history_old_0024;

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
               'publish.unattended', 'publish.refused',      -- ADDED 0019
               'draft.rewrite',                              -- ADDED 0020
               'ratelimit', 'selector.miss', 'gate.block',
               'session.start', 'session.end', 'session.view',
               'observe',
               'reset',                                      -- ADDED 3.2.1 (0017)
               'rotation.tick',                              -- ADDED 0024 — see header
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
FROM history_old_0024;

DROP TABLE history_old_0024;

CREATE INDEX history_ts_idx      ON history (ts DESC);
CREATE INDEX history_kind_idx    ON history (kind);
CREATE INDEX history_account_idx ON history (account);
