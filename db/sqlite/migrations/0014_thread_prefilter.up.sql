-- 0014_thread_prefilter — which mechanical rule dropped a thread, and when.
--
-- WHAT THIS ANSWERS. The Threads screen could say "101 collected, 71 never assessed" and no
-- more, because the reason each of the 71 was dropped existed only inside `prefilter()`'s
-- return value (src/commands/opportunity.ts) — printed to the terminal, used by insights.ts,
-- and then discarded. The panel said so honestly rather than inventing a split, which was the
-- right call and a poor answer: "71 dropped" tells an operator nothing they can act on, while
-- "58 outside the pilot set" tells them their collector is reading subreddits nothing will
-- ever reply in.
--
-- ONLY DROPS ARE STORED. A thread that passes has no row, and a row is DELETED the moment a
-- later run keeps that thread — which happens genuinely: the age test is recomputed against
-- the current time (currentAgeHours), so a thread drops out of eligibility as it ages, and a
-- pilot-set change can make a previously-dropped subreddit eligible. A table that only ever
-- accumulated would describe the filter as it was, not as it is.
--
-- Holds no content and no credentials: a thread id, which rule fired, and the sentence the
-- filter wrote for a person. The thread itself is already in threads (0003).

-- Postgres: CREATE TYPE redbot.prefilter_drop_kind AS ENUM (...). Closed vocabulary, per the
-- convention 0001 sets. These are the four branches of `prefilter()`, and a value the code
-- cannot produce is a value the database will not store — so renaming a rule in TypeScript
-- without adding it here fails loudly at the write instead of quietly landing an unknown string
-- the console would have to guess at.

CREATE TABLE thread_prefilter (
  thread_id   TEXT PRIMARY KEY REFERENCES threads (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN (
                'not-a-question',   -- an announcement, a showcase, or nothing is being asked at all
                'age-unknown',      -- no age on record, so recency cannot be confirmed
                'too-old',          -- past policy.maxThreadAgeHoursToPublish, measured NOW
                'outside-pilot')),  -- the subreddit is not in PILOT_SUBREDDITS

  -- The sentence `prefilter()` wrote, kept verbatim so a person reading one row gets the
  -- specific fact ("103h old, past the 72h ceiling") and not just the category.
  detail      TEXT NOT NULL,

  -- When the filter last decided this. The age rule is time-dependent, so a verdict without
  -- the moment it was reached is not reproducible.
  checked_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              CHECK (checked_at LIKE '____-__-__T%Z'),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              CHECK (updated_at LIKE '____-__-__T%Z')
);

-- Was COMMENT ON TABLE thread_prefilter:
--   'Why a collected thread never reached a model call. Written by `redbot opportunity` from
--    prefilter(); rows are removed when a later run keeps the thread. Only dropped threads appear
--    here.'
-- Was COMMENT ON COLUMN thread_prefilter.kind:
--   'The rule that fired. Grouped on by the console; insights.ts reads it instead of
--    pattern-matching the prose.'

-- The console groups by kind on every Threads read.
CREATE INDEX thread_prefilter_kind_idx ON thread_prefilter (kind);

CREATE TRIGGER thread_prefilter_set_updated_at AFTER UPDATE ON thread_prefilter
FOR EACH ROW
BEGIN
  UPDATE thread_prefilter SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE thread_id = NEW.thread_id;
END;
