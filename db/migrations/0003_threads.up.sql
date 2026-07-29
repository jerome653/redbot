-- 0003_threads — the corpus. Mirrors Thread and Comment in src/types.ts:1 and :18.

CREATE TYPE redbot.thread_source AS ENUM ('read', 'search');

CREATE TABLE redbot.threads (
  -- threadId() is sha1(permalink) truncated to 12 hex chars (src/store.ts:64). The
  -- permalink is the natural key; this is its stable short form, and both are unique.
  id            text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{12}$'),
  permalink     text        NOT NULL UNIQUE,
  title         text        NOT NULL,
  subreddit     text        NOT NULL,
  author        text,
  upvotes       integer,
  comment_count integer,

  -- Reddit's own wording, e.g. "3 hr. ago", kept verbatim beside the parsed value.
  -- The engine's rule is to record what was displayed as well as what was derived.
  age_text      text,
  age_minutes   integer,

  body          text,
  collected_at  timestamptz NOT NULL,
  source        redbot.thread_source NOT NULL,

  -- Set when source = 'search'; the query that surfaced this thread.
  query         text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  redbot.threads IS
  'Collected Reddit discussions. Mirrors data/threads.json (src/types.ts:1).';
COMMENT ON COLUMN redbot.threads.age_text IS
  'Reddit''s displayed age, verbatim. age_minutes is the parsed form; both are kept so a parse bug is detectable after the fact.';

CREATE INDEX threads_subreddit_idx    ON redbot.threads (subreddit);
CREATE INDEX threads_collected_at_idx ON redbot.threads (collected_at DESC);
CREATE INDEX threads_source_idx       ON redbot.threads (source);

CREATE TRIGGER threads_set_updated_at
  BEFORE UPDATE ON redbot.threads
  FOR EACH ROW EXECUTE FUNCTION redbot.set_updated_at();


-- Comments are collected as an ordered list with no stable Reddit id attached
-- (src/types.ts:18 carries author, body, depth only). `position` preserves the order
-- as read, which is the only identity these rows have.
CREATE TABLE redbot.thread_comments (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id text    NOT NULL REFERENCES redbot.threads (id) ON DELETE CASCADE,
  position  integer NOT NULL CHECK (position >= 0),
  author    text,
  body      text    NOT NULL,
  depth     integer NOT NULL CHECK (depth >= 0),

  UNIQUE (thread_id, position)
);

COMMENT ON TABLE redbot.thread_comments IS
  'Visible comments beneath a thread, in collection order. The "already covered" ground for gap analysis.';

CREATE INDEX thread_comments_thread_idx ON redbot.thread_comments (thread_id);
