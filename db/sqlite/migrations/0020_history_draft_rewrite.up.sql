-- 0020_history_draft_rewrite — the draft stage can now fix a draft instead of passing it on.
--
-- 2026-09-28. src/commands/draft.ts has always called assessQuality(body, { thread }) before
-- saving, and has always recorded the result (qualityOk, qualityBlocks). It then saved the draft
-- regardless. src/gates.ts:137 turns each block-severity issue into a `quality:<code>` gate and
-- src/autopublish.ts:184 refuses on any advisory, so a refusal that was knowable at the draft line
-- was instead discovered after a full certification:
--
--   02:03:07  draft        d_61dd17759ea3_mukls4ac saved, quality:generic already recorded
--   02:10:06  gate.block   argus REJECT
--   02:15:22  publish.refused  quality:generic, warming:target
--
-- draft.ts now re-asks once with the specific failure appended (src/prompts.ts draftCorrection),
-- keeps the first draft if the rewrite does not clear more than it started with, and records
-- `draft.rewrite` naming which codes were fixed and which remain.
--
-- WHY A NEW KIND rather than reusing 'draft':
--   * 'draft' means "a draft now exists". A rewrite is a statement about the FIRST one having been
--     mechanically unpublishable, and the rewrite rate is the number that says whether the prompt
--     rule added the same day (prompts.ts HARD RULE 7, "quote at least one exact string from the
--     thread") is doing anything. Folded into 'draft', that rate is unmeasurable.
--   * 'draft.declined' is the model refusing to write. This is the model writing and the craft gate
--     refusing the result — a different actor and a different outcome.
--
-- WHY A REBUILD. Unchanged from 0017 and 0019: SQLite's ALTER TABLE has no DROP/ADD CONSTRAINT.
-- Nothing REFERENCES history and its three indexes are recreated by name below.
-- Caught before shipping by db/sqlite/schema.test.mjs, which reads the HistoryKind union out of
-- src/types.ts and asserts every member is accepted by the live CHECK.

ALTER TABLE history RENAME TO history_old_0020;

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
               'draft.rewrite',                              -- ADDED 0020 — see header
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
FROM history_old_0020;

DROP TABLE history_old_0020;

CREATE INDEX history_ts_idx      ON history (ts DESC);
CREATE INDEX history_kind_idx    ON history (kind);
CREATE INDEX history_account_idx ON history (account);
