-- 0007_certifications — Argus. The fact-checking record, normalised.
--
-- Mirrors Certification in src/argus/types.ts:200 and the vocabularies above it.
--
-- APPEND-ONLY EVIDENCE. There is deliberately NO unique constraint on draft_id: the
-- same draft certified five times on a byte-identical build produced claim counts of
-- 0, 0, 12, 12 and 16 (DEV-HANDOVER trap 3). Every run is its own record. A schema
-- that allowed only one certification per draft would quietly assert a determinism
-- the engine has been measured NOT to have.
--
-- Rows are never updated, so these tables carry no updated_at and no trigger.

CREATE TYPE redbot.claim_type AS ENUM (
  'observation', 'inference', 'recommendation', 'implementation-detail',
  'configuration-advice', 'version-specific', 'platform-behaviour',
  'protocol-behaviour', 'best-practice', 'opinion', 'speculation', 'unknown'
);

CREATE TYPE redbot.evidence_class AS ENUM (
  'primary-documentation', 'official-implementation', 'language-specification',
  'framework-documentation', 'source-code', 'observed-runtime-behaviour',
  'widely-accepted-practice', 'community-knowledge', 'operator-experience',
  'reasoned-inference', 'unsupported', 'unknown'
);

CREATE TYPE redbot.confidence AS ENUM ('high', 'medium', 'low', 'unknown');

CREATE TYPE redbot.contradiction_kind AS ENUM (
  'known-exception', 'counterexample', 'version-difference',
  'configuration-dependency', 'alternative-explanation',
  'contradictory-documentation', 'edge-case'
);

CREATE TYPE redbot.language_certainty AS ENUM ('asserted', 'hedged', 'explicitly-uncertain');

CREATE TYPE redbot.resolution_where AS ENUM ('post-body', 'comment', 'op-reply');


CREATE TABLE redbot.certifications (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- No FK to drafts: a certification outlives the draft it examined. Deleting a draft
  -- must not delete the evidence about it.
  draft_id          text        NOT NULL,
  thread_id         text        NOT NULL,

  verdict           redbot.certification_verdict NOT NULL,
  certified_at      timestamptz NOT NULL,

  -- Kept for backward compatibility and equal to the analyze model. It named only one
  -- model while two produce the evidence, which answered "which model called this
  -- fatal?" wrongly. Prefer the two columns below.
  model             text        NOT NULL,
  model_analyze     text,
  model_draft       text,

  -- Resolution detection (Phase 7): was the thread already resolved?
  resolution_resolved boolean   NOT NULL,
  resolution_detail   text      NOT NULL,

  -- EB-40. Claim ids whose refutation call COMPLETED, whatever it found. Without this
  -- a certification cannot be replayed from its own record: a refutation that timed
  -- out and one that completed and found nothing are otherwise indistinguishable, and
  -- they produce different verdicts.
  refutation_ran    text[],

  -- Phase 10 citation check. Wired but never yet fired on real input, and its shape is
  -- owned by src/argus/citations.ts rather than by this schema — kept whole rather
  -- than half-modelled from a type this migration cannot see.
  citations         jsonb,

  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  redbot.certifications IS
  'One Argus run over one draft. Mirrors data/certifications.jsonl (src/argus/types.ts:200). Append-only; many rows per draft are expected.';
COMMENT ON COLUMN redbot.certifications.model IS
  'Legacy single-model field, equal to model_analyze. Prefer model_analyze/model_draft.';
COMMENT ON COLUMN redbot.certifications.refutation_ran IS
  'EB-40: which refutations actually completed. A timed-out refutation and an empty one produce different verdicts.';

CREATE INDEX certifications_draft_idx   ON redbot.certifications (draft_id);
CREATE INDEX certifications_thread_idx  ON redbot.certifications (thread_id);
CREATE INDEX certifications_verdict_idx ON redbot.certifications (verdict);
CREATE INDEX certifications_at_idx      ON redbot.certifications (certified_at DESC);


-- Claims are identified as c1, c2, … and are stable only WITHIN one certification.
CREATE TABLE redbot.certification_claims (
  cert_id        bigint NOT NULL REFERENCES redbot.certifications (id) ON DELETE CASCADE,
  claim_id       text   NOT NULL,
  text           text   NOT NULL,
  type           redbot.claim_type      NOT NULL,
  evidence_class redbot.evidence_class  NOT NULL,
  evidence_detail text  NOT NULL,
  confidence     redbot.confidence      NOT NULL,

  -- Ids of claims this one rests on. If a dependency fails, this fails with it —
  -- there is no partial salvage of invalid reasoning. Left as an array rather than a
  -- join table because it is read whole, as a set, and never queried across claims.
  depends_on     text[] NOT NULL DEFAULT '{}',

  -- Where in the draft it came from, so a reviewer can find it.
  source_quote   text   NOT NULL,

  PRIMARY KEY (cert_id, claim_id)
);

COMMENT ON COLUMN redbot.certification_claims.claim_id IS
  'c1, c2, … Stable within one certification run only. Never treat a claim id as a property of a draft (DEV-HANDOVER trap 3).';


CREATE TABLE redbot.certification_contradictions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cert_id         bigint NOT NULL,
  claim_id        text   NOT NULL,
  kind            redbot.contradiction_kind NOT NULL,
  statement       text   NOT NULL,
  evidence_class  redbot.evidence_class NOT NULL,
  evidence_detail text   NOT NULL,

  -- True when the contradiction defeats the claim outright rather than qualifying it.
  -- A surviving fatal contradiction is an automatic REJECT.
  fatal           boolean NOT NULL,

  FOREIGN KEY (cert_id, claim_id)
    REFERENCES redbot.certification_claims (cert_id, claim_id) ON DELETE CASCADE
);

CREATE INDEX certification_contradictions_cert_idx  ON redbot.certification_contradictions (cert_id);
CREATE INDEX certification_contradictions_fatal_idx ON redbot.certification_contradictions (cert_id) WHERE fatal;


CREATE TABLE redbot.certification_epistemic_issues (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cert_id             bigint NOT NULL,
  claim_id            text   NOT NULL,
  language_certainty  redbot.language_certainty NOT NULL,
  supported_certainty redbot.confidence         NOT NULL,
  quote               text   NOT NULL,
  detail              text   NOT NULL,

  FOREIGN KEY (cert_id, claim_id)
    REFERENCES redbot.certification_claims (cert_id, claim_id) ON DELETE CASCADE
);

COMMENT ON TABLE redbot.certification_epistemic_issues IS
  'Phase 8 calibration: where the draft''s language is more certain than its evidence supports.';

CREATE INDEX certification_epistemic_cert_idx ON redbot.certification_epistemic_issues (cert_id);


CREATE TABLE redbot.certification_reasons (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cert_id  bigint NOT NULL REFERENCES redbot.certifications (id) ON DELETE CASCADE,

  -- Which deterministic rule fired. The verdict is computed from these in code.
  rule     text   NOT NULL,

  -- Optional: a rule may be about the draft as a whole rather than one claim. Not a
  -- composite FK for that reason.
  claim_id text,
  detail   text   NOT NULL
);

CREATE INDEX certification_reasons_cert_idx ON redbot.certification_reasons (cert_id);
CREATE INDEX certification_reasons_rule_idx ON redbot.certification_reasons (rule);


CREATE TABLE redbot.certification_invalidations (
  cert_id    bigint NOT NULL,
  claim_id   text   NOT NULL,
  because_of text   NOT NULL,

  PRIMARY KEY (cert_id, claim_id, because_of),
  FOREIGN KEY (cert_id, claim_id)
    REFERENCES redbot.certification_claims (cert_id, claim_id) ON DELETE CASCADE
);

COMMENT ON TABLE redbot.certification_invalidations IS
  'Claims invalidated because something they depend on failed (Phase 6 dependency graph).';


CREATE TABLE redbot.certification_resolution_signals (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cert_id              bigint NOT NULL REFERENCES redbot.certifications (id) ON DELETE CASCADE,
  where_found          redbot.resolution_where NOT NULL,
  matched              text    NOT NULL,
  context              text    NOT NULL,
  by_original_poster   boolean NOT NULL
);

COMMENT ON COLUMN redbot.certification_resolution_signals.where_found IS
  'Named where_found because "where" is reserved. Maps to ResolutionSignal.where (src/argus/types.ts:170).';

CREATE INDEX certification_resolution_signals_cert_idx
  ON redbot.certification_resolution_signals (cert_id);
