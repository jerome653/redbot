-- Reverses 0023_observation_karma_breakdown_kinds.
--
-- WHAT IS LOST, stated plainly: every 'comment-karma' and 'post-karma' observation — the recorded
-- breakdown of each account's karma over time. The total ('karma') is untouched. These rows are
-- DELETED, not relabelled, because there is no honest kind to move them to: a comment-karma count
-- is not a total. The DELETE comes FIRST, so the rebuilt CHECK never has to reject its own table's
-- contents on a later write.
--
-- What SURVIVES: every other observation, ids included, and all three indexes. Nothing REFERENCES
-- observations, so there is no cascade.
--
-- BEFORE ROLLING BACK, if the breakdown matters:
--   sqlite3 data/redbot.db "SELECT ts, account, kind, value FROM observations
--                           WHERE kind IN ('comment-karma','post-karma') ORDER BY ts;" > karma-breakdown.txt

DELETE FROM observations WHERE kind IN ('comment-karma', 'post-karma');

ALTER TABLE observations RENAME TO observations_old_0023_down;

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
  vector     TEXT NOT NULL CHECK (vector IN ('signed-in', 'signed-out', 'unauthenticated-http')),
  permalink  TEXT,
  checkpoint TEXT CHECK (checkpoint IS NULL OR checkpoint IN ('immediate', '1h', '24h', '7d')),
  value      TEXT CHECK (value IS NULL OR json_valid(value)),
  note       TEXT
);

INSERT INTO observations (id, ts, account, kind, vector, permalink, checkpoint, value, note)
SELECT id, ts, account, kind, vector, permalink, checkpoint, value, note
FROM observations_old_0023_down;

DROP TABLE observations_old_0023_down;

CREATE INDEX observations_ts_idx      ON observations (ts DESC);
CREATE INDEX observations_account_idx ON observations (account);
CREATE INDEX observations_kind_idx    ON observations (kind);
