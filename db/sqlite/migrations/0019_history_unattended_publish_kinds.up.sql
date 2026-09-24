-- 0019_history_unattended_publish_kinds — an autonomous install has two more things to say.
--
-- 2026-09-24 this install was switched to autonomous publishing, and src/commands/reply.ts now
-- records what the unattended rule decided: `publish.unattended` when it allowed a post and
-- `publish.refused` when it did not, each carrying the reason from src/autopublish.ts.
--
-- `history.kind` carries a CHECK enum, so both inserts would have been refused with
-- `CHECK constraint failed: kind IN (...)`. That is exactly the failure 0017 was written for —
-- `reset` was added to src/types.ts, the database's copy of the list was not, and a command that
-- had already succeeded exited non-zero with no record of itself. The difference this time is
-- that it was caught before shipping, by db/sqlite/schema.test.mjs:628 ("every HistoryKind the
-- code can write is accepted by the CHECK"), which reads the union out of src/types.ts and tries
-- every member against the live constraint. That test is the link 0017's header said nothing
-- provided.
--
-- WHY TWO KINDS AND NOT ONE, and why neither is folded into an existing one:
--   * `publish.attempt` already means "a person decided and we are submitting". Recording an
--     unattended decision as the same kind makes the two indistinguishable, and the first
--     question anybody asks of an autonomous run is which of its posts it chose by itself.
--   * `gate.block` is a fact about the THREAD — locked, archived, already answered. A refusal
--     here is a fact about the RULE (no CERTIFIED verdict, or an advisory nobody could overrule).
--     Conflating them would make the rule's own refusal rate unmeasurable, which is the number
--     that says whether the rule is calibrated.
--
-- WHY A REBUILD. Unchanged from 0017: SQLite's ALTER TABLE has no DROP/ADD CONSTRAINT, so a CHECK
-- cannot be replaced in place. Nothing REFERENCES history — no foreign key, view or trigger — and
-- its three indexes are recreated below by name. Every existing value is preserved, 'analyze'
-- included: dropping a value would not delete the rows using it, only stop them being readable.

ALTER TABLE history RENAME TO history_old_0019;

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
FROM history_old_0019;

DROP TABLE history_old_0019;

CREATE INDEX history_ts_idx      ON history (ts DESC);
CREATE INDEX history_kind_idx    ON history (kind);
CREATE INDEX history_account_idx ON history (account);
