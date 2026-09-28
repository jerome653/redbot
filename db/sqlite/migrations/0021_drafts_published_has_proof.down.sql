-- 0021 (down) — restore `reject_is_never_published`.
--
-- WHAT THIS REFUSES TO DO, stated plainly: any row that is status='published' with
-- cert_verdict='REJECT' violates the restored constraint, so this migration CANNOT complete while
-- one exists. That is deliberate. Deleting or rewriting such a row to satisfy a constraint would
-- destroy the only record that a real, live Reddit comment exists — the exact failure 0021 was
-- written to stop. Find them first:
--
--   SELECT id, published_url, comment_permalink, cert_verdict FROM drafts
--    WHERE status = 'published' AND cert_verdict = 'REJECT';
--
-- Each one names a comment that is still on Reddit. Decide what to do about the comments before
-- reverting the schema, and set REDBOT_PUBLISH_MIN_VERDICT back to CERTIFIED (or ESCALATE) so no
-- more are produced — that switch, not this constraint, is what actually governs whether a REJECT
-- can publish (src/autopublish.ts publishBar, and HARD_GATES at src/gates.ts:80 which does not
-- include `certification`).
--
-- The `published_has_proof` invariant added in 0021 is dropped by this revert. Nothing else
-- enforced it, so after reverting a row may again claim status='published' with no published_url.

ALTER TABLE drafts RENAME TO drafts_old_0021_down;

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

INSERT INTO drafts (id, thread_id, permalink, title, body, contribution_why_thread, contribution_what_new, contribution_why_not_silent, novelty_issues, has_disclosure, lint_issues, created_at, model, account, status, cert_verdict, cert_at, cert_claims, cert_fatal_contradictions, published_url, comment_permalink, comment_id, decided_at, updated_at)
SELECT id, thread_id, permalink, title, body, contribution_why_thread, contribution_what_new, contribution_why_not_silent, novelty_issues, has_disclosure, lint_issues, created_at, model, account, status, cert_verdict, cert_at, cert_claims, cert_fatal_contradictions, published_url, comment_permalink, comment_id, decided_at, updated_at
FROM drafts_old_0021_down;

DROP TABLE drafts_old_0021_down;

CREATE INDEX drafts_thread_idx  ON drafts (thread_id);
CREATE INDEX drafts_status_idx  ON drafts (status);
CREATE INDEX drafts_account_idx ON drafts (account);
CREATE INDEX drafts_created_idx ON drafts (created_at DESC);

CREATE TRIGGER drafts_set_updated_at AFTER UPDATE ON drafts
FOR EACH ROW
BEGIN
  UPDATE drafts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
