-- 0006_drafts — the reply, and everything decided about it.
--
-- Mirrors Draft in src/types.ts:85.

CREATE TYPE redbot.draft_status AS ENUM (
  'pending', 'approved', 'rejected', 'published', 'failed'
);

-- Argus's three verdicts. Used here on the draft and again in 0007 on the
-- certification record itself.
CREATE TYPE redbot.certification_verdict AS ENUM ('CERTIFIED', 'ESCALATE', 'REJECT');

CREATE TABLE redbot.drafts (
  id                          text PRIMARY KEY,
  thread_id                   text NOT NULL REFERENCES redbot.threads (id) ON DELETE RESTRICT,
  permalink                   text        NOT NULL,
  title                       text        NOT NULL,
  body                        text        NOT NULL,

  -- The draft's own account of what it adds — checked against gap_analyses.covered,
  -- never taken on trust.
  contribution_why_thread     text,
  contribution_what_new       text,
  contribution_why_not_silent text,

  -- Covered claims this draft appears to restate. Non-empty blocks publishing.
  novelty_issues              text[]      NOT NULL DEFAULT '{}',
  has_disclosure              boolean     NOT NULL,
  lint_issues                 text[]      NOT NULL DEFAULT '{}',

  created_at                  timestamptz NOT NULL,
  model                       text        NOT NULL,

  -- Nullable on purpose. Drafts written before 2026-07-27 predate the field, and a
  -- draft with no account is shown as unassigned rather than attributed to whoever
  -- happens to be selected now (src/types.ts:99). Inventing an owner for existing
  -- evidence is worse than admitting it was never recorded.
  account                     text        REFERENCES redbot.accounts (handle) ON DELETE SET NULL,

  status                      redbot.draft_status NOT NULL DEFAULT 'pending',

  -- The Argus verdict copied onto the draft so the publish gate can consult it without
  -- re-reading the certification log. Before this existed the publish path never read
  -- the verdict at all and a REJECT could still be approved and posted (evaluation H6).
  cert_verdict                redbot.certification_verdict,
  cert_at                     timestamptz,
  cert_claims                 integer     CHECK (cert_claims >= 0),
  cert_fatal_contradictions   integer     CHECK (cert_fatal_contradictions >= 0),

  published_url               text,
  comment_permalink           text,
  comment_id                  text,
  decided_at                  timestamptz,

  updated_at                  timestamptz NOT NULL DEFAULT now(),

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

COMMENT ON TABLE  redbot.drafts IS
  'Candidate replies. Mirrors data/drafts.json (src/types.ts:85). Publishing is a human act; nothing here performs one.';
COMMENT ON COLUMN redbot.drafts.comment_permalink IS
  'Permalink of the posted comment itself — what the post-publication checkpoints read. Distinct from published_url.';
COMMENT ON CONSTRAINT reject_is_never_published ON redbot.drafts IS
  'Evaluation H6: a REJECTed draft was approvable and postable because the publish path never read the certification.';

CREATE INDEX drafts_thread_idx  ON redbot.drafts (thread_id);
CREATE INDEX drafts_status_idx  ON redbot.drafts (status);
CREATE INDEX drafts_account_idx ON redbot.drafts (account);
CREATE INDEX drafts_created_idx ON redbot.drafts (created_at DESC);

CREATE TRIGGER drafts_set_updated_at
  BEFORE UPDATE ON redbot.drafts
  FOR EACH ROW EXECUTE FUNCTION redbot.set_updated_at();
