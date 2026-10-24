-- 0023_observation_karma_breakdown_kinds — record the karma breakdown, not just the total.
--
-- src/probe-karma.ts reads link_karma and comment_karma from about.json (parseAboutJson) and the
-- profile page (parseProfileText), but only the total was ever recorded, as a single 'karma'
-- observation. The breakdown was parsed and thrown away. For warming the comment figure is the one
-- that matters — the fleet posts comments — and a total dragged by post karma can hide comment
-- karma moving. These two kinds let the breakdown be stored as its own series, read back the same
-- way src/health.ts reads 'karma'.
--
-- WHY A REBUILD. Same as 0017/0019: SQLite's ALTER TABLE has no DROP/ADD CONSTRAINT, so the
-- observations.kind CHECK (0009) cannot be extended in place. Nothing REFERENCES observations — no
-- foreign key, view or trigger — and its three indexes are recreated below by name. Every existing
-- row is preserved; the two new kinds are added to the enum, none removed.

ALTER TABLE observations RENAME TO observations_old_0023;

CREATE TABLE observations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL CHECK (ts LIKE '____-__-__T%Z'),
  account    TEXT,
  kind       TEXT NOT NULL CHECK (kind IN (
               'karma', 'comment-karma', 'post-karma', 'account-created',
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
FROM observations_old_0023;

DROP TABLE observations_old_0023;

CREATE INDEX observations_ts_idx      ON observations (ts DESC);
CREATE INDEX observations_account_idx ON observations (account);
CREATE INDEX observations_kind_idx    ON observations (kind);
