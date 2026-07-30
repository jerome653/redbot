-- 0003_threads — the corpus. Mirrors Thread and Comment in src/types.ts:1 and :18.

-- Postgres: CREATE TYPE redbot.thread_source AS ENUM ('read','search'). Inlined as a CHECK on
-- threads.source below — see 0001 on why a CHECK keeps the property the enum was there for.

CREATE TABLE threads (
  -- threadId() is sha1(permalink) truncated to 12 hex chars (src/store.ts:64). The
  -- permalink is the natural key; this is its stable short form, and both are unique.
  -- Postgres: id ~ '^[0-9a-f]{12}$'.
  id            TEXT PRIMARY KEY
                CHECK (length(id) = 12 AND id NOT GLOB '*[^0-9a-f]*'),
  permalink     TEXT    NOT NULL UNIQUE,
  title         TEXT    NOT NULL,
  subreddit     TEXT    NOT NULL,
  author        TEXT,
  upvotes       INTEGER,
  comment_count INTEGER,

  -- Reddit's own wording, e.g. "3 hr. ago", kept verbatim beside the parsed value.
  -- The engine's rule is to record what was displayed as well as what was derived.
  age_text      TEXT,
  age_minutes   INTEGER,

  body          TEXT,
  collected_at  TEXT    NOT NULL CHECK (collected_at LIKE '____-__-__T%Z'),
  source        TEXT    NOT NULL CHECK (source IN ('read', 'search')),

  -- Set when source = 'search'; the query that surfaced this thread.
  query         TEXT,

  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (updated_at LIKE '____-__-__T%Z')
);

-- Was COMMENT ON TABLE threads:
--   'Collected Reddit discussions. Mirrors data/threads.json (src/types.ts:1).'
-- Was COMMENT ON COLUMN threads.age_text:
--   'Reddit''s displayed age, verbatim. age_minutes is the parsed form; both are kept so a
--    parse bug is detectable after the fact.'

CREATE INDEX threads_subreddit_idx    ON threads (subreddit);
CREATE INDEX threads_collected_at_idx ON threads (collected_at DESC);
CREATE INDEX threads_source_idx       ON threads (source);

CREATE TRIGGER threads_set_updated_at AFTER UPDATE ON threads
FOR EACH ROW
BEGIN
  UPDATE threads SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;


-- Comments are collected as an ordered list with no stable Reddit id attached
-- (src/types.ts:18 carries author, body, depth only). `position` preserves the order
-- as read, which is the only identity these rows have.
CREATE TABLE thread_comments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT    NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
  position  INTEGER NOT NULL CHECK (position >= 0),
  author    TEXT,
  body      TEXT    NOT NULL,
  depth     INTEGER NOT NULL CHECK (depth >= 0),

  UNIQUE (thread_id, position)
);

-- Was COMMENT ON TABLE thread_comments:
--   'Visible comments beneath a thread, in collection order. The "already covered" ground for
--    gap analysis.'

CREATE INDEX thread_comments_thread_idx ON thread_comments (thread_id);
