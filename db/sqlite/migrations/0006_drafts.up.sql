-- 0006_drafts — the reply, and everything decided about it.
--
-- Mirrors Draft in src/types.ts:85.

-- Postgres: CREATE TYPE redbot.draft_status AS ENUM
--   ('pending','approved','rejected','published','failed')
-- and CREATE TYPE redbot.certification_verdict AS ENUM ('CERTIFIED','ESCALATE','REJECT').
--
-- The verdict vocabulary is used TWICE — here on the draft, and again in 0007 on the
-- certification record. A Postgres enum was declared once and referenced twice; a CHECK cannot
-- be shared, so the same three values are written out in both files. That duplication is the
-- one real cost of dropping enums, and it is called out here so a future change to the
-- vocabulary is known to need edits in two places: this file and 0007.

CREATE TABLE drafts (
  id                          TEXT PRIMARY KEY,
  thread_id                   TEXT NOT NULL REFERENCES threads (id) ON DELETE RESTRICT,
  permalink                   TEXT    NOT NULL,
  title                       TEXT    NOT NULL,
  body                        TEXT    NOT NULL,

  -- The draft's own account of what it adds — checked against gap_analyses.covered,
  -- never taken on trust.
  contribution_why_thread     TEXT,
  contribution_what_new       TEXT,
  contribution_why_not_silent TEXT,

  -- Covered claims this draft appears to restate. Non-empty blocks publishing.
  novelty_issues              TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(novelty_issues)),
  has_disclosure              INTEGER NOT NULL CHECK (has_disclosure IN (0, 1)),
  lint_issues                 TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(lint_issues)),

  created_at                  TEXT    NOT NULL CHECK (created_at LIKE '____-__-__T%Z'),
  model                       TEXT    NOT NULL,

  -- Nullable on purpose. Drafts written before 2026-07-27 predate the field, and a
  -- draft with no account is shown as unassigned rather than attributed to whoever
  -- happens to be selected now (src/types.ts:99). Inventing an owner for existing
  -- evidence is worse than admitting it was never recorded.
  account                     TEXT    REFERENCES accounts (handle) ON DELETE SET NULL,

  status                      TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'rejected', 'published', 'failed')),

  -- The Argus verdict copied onto the draft so the publish gate can consult it without
  -- re-reading the certification log. Before this existed the publish path never read
  -- the verdict at all and a REJECT could still be approved and posted (evaluation H6).
  cert_verdict                TEXT    CHECK (cert_verdict IS NULL
                                             OR cert_verdict IN ('CERTIFIED', 'ESCALATE', 'REJECT')),
  cert_at                     TEXT    CHECK (cert_at IS NULL OR cert_at LIKE '____-__-__T%Z'),
  cert_claims                 INTEGER CHECK (cert_claims >= 0),
  cert_fatal_contradictions   INTEGER CHECK (cert_fatal_contradictions >= 0),

  published_url               TEXT,
  comment_permalink           TEXT,
  comment_id                  TEXT,
  decided_at                  TEXT    CHECK (decided_at IS NULL OR decided_at LIKE '____-__-__T%Z'),

  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                              CHECK (updated_at LIKE '____-__-__T%Z'),

  CONSTRAINT certification_is_whole CHECK (
    (cert_verdict IS NULL AND cert_at IS NULL
      AND cert_claims IS NULL AND cert_fatal_contradictions IS NULL)
    OR
    (cert_verdict IS NOT NULL AND cert_at IS NOT NULL
      AND cert_claims IS NOT NULL AND cert_fatal_contradictions IS NOT NULL)
  ),

  -- The one invariant this table exists to make unbreakable. A REJECT is a hard
  -- publish block in src/gates.ts; encoding it here means no future writer — a script,
  -- a migration, a hand-typed UPDATE — can land a rejected draft in a published state.
  CONSTRAINT reject_is_never_published CHECK (
    NOT (status = 'published' AND cert_verdict = 'REJECT')
  )
);

-- Was COMMENT ON TABLE drafts:
--   'Candidate replies. Mirrors data/drafts.json (src/types.ts:85). Publishing is a human act;
--    nothing here performs one.'
-- Was COMMENT ON COLUMN drafts.comment_permalink:
--   'Permalink of the posted comment itself — what the post-publication checkpoints read.
--    Distinct from published_url.'
-- Was COMMENT ON CONSTRAINT reject_is_never_published:
--   'Evaluation H6: a REJECTed draft was approvable and postable because the publish path never
--    read the certification.'

CREATE INDEX drafts_thread_idx  ON drafts (thread_id);
CREATE INDEX drafts_status_idx  ON drafts (status);
CREATE INDEX drafts_account_idx ON drafts (account);
CREATE INDEX drafts_created_idx ON drafts (created_at DESC);

CREATE TRIGGER drafts_set_updated_at AFTER UPDATE ON drafts
FOR EACH ROW
BEGIN
  UPDATE drafts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
