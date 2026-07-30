-- 0012_sources — where redbot looks for threads.
--
-- `data/sources.json` was the only record of this, and it had the same defect 0011's sibling
-- work found in accounts.json: the console's "add a subreddit" button refused on a fresh
-- install ("sources.json is missing.") because the file it needed is the file that button
-- exists to create. Worse, `src/commands/auto.ts` treated an UNREADABLE file the same as an
-- empty one, so a corrupt config made the unattended loop report "Nothing switched on" and
-- quietly collect nothing — for as long as nobody looked.
--
-- The list is now a table. `data/sources.json` stays as the seed to import from and the
-- fallback when the database is unreachable, exactly as it does for accounts.
--
-- Holds no credentials and no content: this is a list of public subreddit names and search
-- strings. The threads collected FROM these sources live in threads (0003).

-- Postgres: CREATE TYPE redbot.source_kind AS ENUM ('subreddit','search'). Closed vocabulary
-- from the TypeScript source, per the convention 0001 sets: a typo is rejected by the database
-- rather than found later in a collection run that read nothing.

CREATE TABLE sources (
  kind        TEXT    NOT NULL CHECK (kind IN ('subreddit', 'search')),

  -- The subreddit name, or the search query. Length-bounded so a paste accident cannot
  -- become a row that no UI can render.
  value       TEXT    NOT NULL CHECK (length(value) BETWEEN 1 AND 200),

  -- Why this source is on the list. Prose a person wrote; the console fills it in.
  why         TEXT,

  -- Off, not deleted. Turning a source off keeps the reason it was ever added, which is the
  -- thing you want when deciding whether to turn it back on.
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),

  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              CHECK (updated_at LIKE '____-__-__T%Z'),

  -- One row per source per kind. A subreddit and a search may legitimately share a string.
  PRIMARY KEY (kind, value),

  -- The same rule the console's form states to the person, enforced where it cannot be
  -- bypassed by a second caller. Reddit subreddit names are 2–21 of these characters.
  -- Postgres: value ~ '^[A-Za-z0-9_]{2,21}$'.
  CONSTRAINT subreddit_name_shape
    CHECK (kind <> 'subreddit'
           OR (length(value) BETWEEN 2 AND 21 AND value NOT GLOB '*[^A-Za-z0-9_]*'))
);

-- Was COMMENT ON TABLE sources:
--   'Where redbot looks for threads: subreddit names and search queries. Mirrors
--    data/sources.json, which is now the seed and the offline fallback. Public identifiers only
--    — no credentials.'
-- Was COMMENT ON COLUMN sources.enabled:
--   'False switches a source off without losing why it was added. auto.ts collects only enabled
--    rows.'

-- The unattended loop asks for exactly this, every cycle. Partial index, as in Postgres.
CREATE INDEX sources_enabled_idx ON sources (enabled) WHERE enabled;

CREATE TRIGGER sources_set_updated_at AFTER UPDATE ON sources
FOR EACH ROW
BEGIN
  UPDATE sources SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE kind = NEW.kind AND value = NEW.value;
END;
