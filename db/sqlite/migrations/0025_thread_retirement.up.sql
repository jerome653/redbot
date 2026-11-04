-- 0025_thread_retirement — which stale threads the scan has stopped re-reading, and why.
--
-- WHAT THIS ANSWERS. `redbot opportunity` loads every row of `threads` on every cycle. Measured
-- 2026-11-04: 1,913 threads, 1,415 older than 7 days, 1,274 of those with nothing ever drafted
-- from them — and the stage recorded "collected 1836, prefiltered 99" pass after pass, re-reading
-- the whole backlog to reach the same answer. The operator's words for it: "so we dont over-stack
-- data and engine gets confused."
--
-- A MARKER, NOT A DELETE. The standing rule is archive, never delete, and these rows are the
-- evidence corpus — gap analyses, assessments and published replies all hang off them. So a
-- retired thread keeps its row, its comments and everything derived from it; it simply stops
-- being offered to the scan (src/db/threads.ts, `excludeRetired`). Removing a row here puts the
-- thread straight back in the scan, which is what makes this reversible by hand.
--
-- WHY A TABLE RATHER THAN TWO COLUMNS ON `threads`. Same shape and same reason as 0014's
-- thread_prefilter: `threads` is upserted wholesale by `upsertThreads` on every collect, and a
-- retirement must not be at the mercy of a later re-read of the same thread overwriting it.
-- A separate table also makes "is it retired" a row that exists or does not, which is the
-- cheapest possible question for the scan to ask.
--
-- NOT DERIVED, unlike 0014. A prefilter row is recomputed every run, so dropping it loses a
-- cache. A retirement is a decision taken at a moment, with the measurement that justified it
-- written into `why` — so it is kept, never recomputed, and the write below never overwrites an
-- existing row.
--
-- Holds no content and no credentials: a thread id and the sentence the rule wrote.

CREATE TABLE thread_retirement (
  thread_id  TEXT PRIMARY KEY REFERENCES threads (id) ON DELETE CASCADE,

  -- The measurement that justified it, verbatim, for the person who asks later why a thread
  -- stopped being looked at ("Retired 2026-11-04: 34 days old, nothing drafted from it…").
  why        TEXT NOT NULL CHECK (length(why) > 0),

  retired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             CHECK (retired_at LIKE '____-__-__T%Z'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             CHECK (updated_at LIKE '____-__-__T%Z')
);

-- Was COMMENT ON TABLE thread_retirement:
--   'Threads the scan no longer re-reads. Written by `redbot retire --apply`; a row is never
--    overwritten, and deleting one returns the thread to the scan. The thread itself is kept.'

-- The scan asks "retired?" for every thread it considers, newest-first.
CREATE INDEX thread_retirement_retired_at_idx ON thread_retirement (retired_at DESC);

CREATE TRIGGER thread_retirement_set_updated_at AFTER UPDATE ON thread_retirement
FOR EACH ROW
BEGIN
  UPDATE thread_retirement SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE thread_id = NEW.thread_id;
END;
