-- 0021_drafts_published_has_proof — the REJECT block moves from the schema to the operator.
--
-- 2026-09-28. `reject_is_never_published` forbade (status = 'published' AND cert_verdict =
-- 'REJECT'). Its own comment justified itself like this:
--
--   "The one invariant this table exists to make unbreakable. A REJECT is a hard publish block
--    in src/gates.ts; encoding it here means no future writer -- a script, a migration, a
--    hand-typed UPDATE -- can land a rejected draft in a published state."
--
-- BOTH HALVES OF THAT ARE NOW FALSE, and the second is why this migration exists.
--
-- 1. A REJECT is NOT a hard publish block in src/gates.ts. `HARD_GATES` at gates.ts:80 is
--    `new Set(['identity'])` and nothing else. A REJECT arrives as a `certification` ADVISORY, and
--    src/autopublish.ts:184 filters that advisory out BY NAME so that the verdict bar
--    (REDBOT_PUBLISH_MIN_VERDICT: CERTIFIED | ESCALATE | ANY) can be lowered at all. The operator
--    set ANY. The schema was still enforcing a rule the code had deliberately turned into a dial.
--
-- 2. It did not prevent the publish. It prevented the RECORD of the publish. Measured
--    2026-09-28 06:43:51, draft d_7d762fa0f2b4_muksfd2v: reply.ts wrote its `publish.attempt` row,
--    publishComment submitted, and the comment went live at
--    /r/Wordpress/comments/1wrudhq/comment/pcizrg8/ (thingid t1_pcizrg8, score 1, confirmed by
--    re-reading the live page). The INSERT that followed was refused by this constraint, so the row
--    stayed status='approved' with published_url NULL while a real comment existed on Reddit.
--
--    That outcome is strictly worse than either of the two it was choosing between. An unrecorded
--    published comment cannot be found, cannot be counted, and -- because the duplicate gate reads
--    `allDrafts` for an already-published draft on the thread (gates.ts:359) -- invites a SECOND
--    comment on the same thread from the same account. A constraint that cannot stop the act and
--    can only lose the evidence of it is not protecting the invariant; it is hiding the breach.
--
-- WHAT REPLACES IT, rather than nothing. `published_has_proof`: a row may not claim
-- status='published' while published_url is null or blank. That is an invariant the database CAN
-- enforce, because it is a statement about this table's own internal consistency rather than about
-- a policy that lives in an environment variable. It also catches the opposite lie -- a row marked
-- published with no evidence it ever was -- which nothing checked before.
--
-- The REJECT decision is not deleted. It moves to where it can be made honestly: publishBar() in
-- src/autopublish.ts, whose default is still CERTIFIED and whose reason string records which bar
-- let each post through. Setting REDBOT_PUBLISH_MIN_VERDICT back to CERTIFIED or ESCALATE restores
-- the old behaviour with no migration at all.
--
-- WHY A REBUILD. SQLite's ALTER TABLE has no DROP/ADD CONSTRAINT. Nothing REFERENCES drafts -- no
-- foreign key, view, or other table, checked against sqlite_master -- and its one trigger
-- (drafts_set_updated_at) and four named indexes are recreated below. All 27 existing rows are
-- copied unchanged; drafts' own outgoing foreign keys (thread_id, account) keep the same values,
-- so nothing is re-pointed.

ALTER TABLE drafts RENAME TO drafts_old_0021;

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

  -- REPLACES reject_is_never_published (0021). That constraint named a rule src/gates.ts no longer
  -- has, and it never enforced what its comment claimed: it could not stop a rejected draft being
  -- PUBLISHED, only being RECORDED as published. This one states something the database can
  -- actually guarantee about its own rows.
  CONSTRAINT published_has_proof CHECK (
    NOT (status = 'published' AND (published_url IS NULL OR trim(published_url) = ''))
  )
);

INSERT INTO drafts (id, thread_id, permalink, title, body, contribution_why_thread, contribution_what_new, contribution_why_not_silent, novelty_issues, has_disclosure, lint_issues, created_at, model, account, status, cert_verdict, cert_at, cert_claims, cert_fatal_contradictions, published_url, comment_permalink, comment_id, decided_at, updated_at)
SELECT id, thread_id, permalink, title, body, contribution_why_thread, contribution_what_new, contribution_why_not_silent, novelty_issues, has_disclosure, lint_issues, created_at, model, account, status, cert_verdict, cert_at, cert_claims, cert_fatal_contradictions, published_url, comment_permalink, comment_id, decided_at, updated_at
FROM drafts_old_0021;

DROP TABLE drafts_old_0021;

CREATE INDEX drafts_thread_idx  ON drafts (thread_id);
CREATE INDEX drafts_status_idx  ON drafts (status);
CREATE INDEX drafts_account_idx ON drafts (account);
CREATE INDEX drafts_created_idx ON drafts (created_at DESC);

CREATE TRIGGER drafts_set_updated_at AFTER UPDATE ON drafts
FOR EACH ROW
BEGIN
  UPDATE drafts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
