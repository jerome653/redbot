-- 0017_history_reset_kind — 'reset' is a thing redbot does, so history must be able to say so.
--
-- 3.2.0 added `redbot reset`, and the command records what it did — deliberately AFTER the wipe,
-- because with scope `all` the history it writes into is one of the things removed, which makes
-- that row the only surviving statement that a reset happened at all.
--
-- The row was refused. `history.kind` carries a CHECK enum written in 0009, `reset` was not in
-- it, and the insert failed with `CHECK constraint failed: kind IN (...)` — so a reset that had
-- already succeeded exited non-zero and left no record of itself. Found by running it against a
-- throwaway data directory on 2026-08-13, not by reading the code: the type in src/types.ts was
-- updated and the database's own copy of that list was not, and nothing links the two.
--
-- ---------------------------------------------------------------------------
-- WHY A REBUILD. SQLite's ALTER TABLE has no DROP CONSTRAINT and no ADD CONSTRAINT, so a CHECK
-- cannot be replaced in place. The documented procedure is to rebuild the table, which is what
-- 0010 already did for `reviews` — same reasoning, same shape.
--
-- Two things make it safe here, both re-checked rather than assumed:
--   * nothing REFERENCES history — no foreign key, view or trigger points at it, so the rename
--     has no dependencies to rewrite.
--   * its three indexes are recreated below, by name, from 0009.
--
-- Every existing value is preserved, including 'analyze', which no code has emitted since D-01
-- (2026-07-23) but which real rows still use. Dropping a value would not delete those rows; it
-- would only stop them being readable.
-- ---------------------------------------------------------------------------

ALTER TABLE history RENAME TO history_old_0017;

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
               'reset',                                      -- ADDED 3.2.1 — see header
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
FROM history_old_0017;

DROP TABLE history_old_0017;

CREATE INDEX history_ts_idx      ON history (ts DESC);
CREATE INDEX history_kind_idx    ON history (kind);
CREATE INDEX history_account_idx ON history (account);
