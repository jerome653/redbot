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
--
-- Postgres declared six enum types here (claim_type, evidence_class, confidence,
-- contradiction_kind, language_certainty, resolution_where) plus a reference to
-- certification_verdict from 0006. All seven are inlined as CHECKs. `evidence_class` is used
-- on two tables and so is written out twice — see the note in 0006 about the cost of that.

CREATE TABLE certifications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,

  -- No FK to drafts: a certification outlives the draft it examined. Deleting a draft
  -- must not delete the evidence about it.
  draft_id          TEXT NOT NULL,
  thread_id         TEXT NOT NULL,

  verdict           TEXT NOT NULL CHECK (verdict IN ('CERTIFIED', 'ESCALATE', 'REJECT')),
  certified_at      TEXT NOT NULL CHECK (certified_at LIKE '____-__-__T%Z'),

  -- Kept for backward compatibility and equal to the analyze model. It named only one
  -- model while two produce the evidence, which answered "which model called this
  -- fatal?" wrongly. Prefer the two columns below.
  model             TEXT NOT NULL,
  model_analyze     TEXT,
  model_draft       TEXT,

  -- Resolution detection (Phase 7): was the thread already resolved?
  resolution_resolved INTEGER NOT NULL CHECK (resolution_resolved IN (0, 1)),
  resolution_detail   TEXT    NOT NULL,

  -- EB-40. Claim ids whose refutation call COMPLETED, whatever it found. Without this
  -- a certification cannot be replayed from its own record: a refutation that timed
  -- out and one that completed and found nothing are otherwise indistinguishable, and
  -- they produce different verdicts.
  --
  -- Postgres: text[] with NO default and NO NOT NULL — so NULL ("this build did not record
  -- it") and '{}' ("it recorded that nothing ran") are different facts, and that distinction is
  -- the whole point of the column. Preserved here: nullable, no default.
  refutation_ran    TEXT CHECK (refutation_ran IS NULL OR json_valid(refutation_ran)),

  -- Phase 10 citation check. Wired but never yet fired on real input, and its shape is
  -- owned by src/argus/citations.ts rather than by this schema — kept whole rather
  -- than half-modelled from a type this migration cannot see.
  citations         TEXT CHECK (citations IS NULL OR json_valid(citations)),

  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    CHECK (created_at LIKE '____-__-__T%Z')
);

-- Was COMMENT ON TABLE certifications:
--   'One Argus run over one draft. Mirrors data/certifications.jsonl (src/argus/types.ts:200).
--    Append-only; many rows per draft are expected.'
-- Was COMMENT ON COLUMN certifications.model:
--   'Legacy single-model field, equal to model_analyze. Prefer model_analyze/model_draft.'
-- Was COMMENT ON COLUMN certifications.refutation_ran:
--   'EB-40: which refutations actually completed. A timed-out refutation and an empty one
--    produce different verdicts.'

CREATE INDEX certifications_draft_idx   ON certifications (draft_id);
CREATE INDEX certifications_thread_idx  ON certifications (thread_id);
CREATE INDEX certifications_verdict_idx ON certifications (verdict);
CREATE INDEX certifications_at_idx      ON certifications (certified_at DESC);


-- Claims are identified as c1, c2, … and are stable only WITHIN one certification.
CREATE TABLE certification_claims (
  cert_id        INTEGER NOT NULL REFERENCES certifications (id) ON DELETE CASCADE,
  claim_id       TEXT    NOT NULL,
  text           TEXT    NOT NULL,
  type           TEXT    NOT NULL CHECK (type IN (
                   'observation', 'inference', 'recommendation', 'implementation-detail',
                   'configuration-advice', 'version-specific', 'platform-behaviour',
                   'protocol-behaviour', 'best-practice', 'opinion', 'speculation', 'unknown')),
  evidence_class TEXT    NOT NULL CHECK (evidence_class IN (
                   'primary-documentation', 'official-implementation', 'language-specification',
                   'framework-documentation', 'source-code', 'observed-runtime-behaviour',
                   'widely-accepted-practice', 'community-knowledge', 'operator-experience',
                   'reasoned-inference', 'unsupported', 'unknown')),
  evidence_detail TEXT   NOT NULL,
  confidence     TEXT    NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),

  -- Ids of claims this one rests on. If a dependency fails, this fails with it —
  -- there is no partial salvage of invalid reasoning. Left as an array rather than a
  -- join table because it is read whole, as a set, and never queried across claims.
  depends_on     TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(depends_on)),

  -- Where in the draft it came from, so a reviewer can find it.
  source_quote   TEXT    NOT NULL,

  PRIMARY KEY (cert_id, claim_id)
);

-- Was COMMENT ON COLUMN certification_claims.claim_id:
--   'c1, c2, … Stable within one certification run only. Never treat a claim id as a property
--    of a draft (DEV-HANDOVER trap 3).'


CREATE TABLE certification_contradictions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cert_id         INTEGER NOT NULL,
  claim_id        TEXT    NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN (
                    'known-exception', 'counterexample', 'version-difference',
                    'configuration-dependency', 'alternative-explanation',
                    'contradictory-documentation', 'edge-case')),
  statement       TEXT    NOT NULL,
  evidence_class  TEXT    NOT NULL CHECK (evidence_class IN (
                    'primary-documentation', 'official-implementation', 'language-specification',
                    'framework-documentation', 'source-code', 'observed-runtime-behaviour',
                    'widely-accepted-practice', 'community-knowledge', 'operator-experience',
                    'reasoned-inference', 'unsupported', 'unknown')),
  evidence_detail TEXT    NOT NULL,

  -- True when the contradiction defeats the claim outright rather than qualifying it.
  -- A surviving fatal contradiction is an automatic REJECT.
  fatal           INTEGER NOT NULL CHECK (fatal IN (0, 1)),

  FOREIGN KEY (cert_id, claim_id)
    REFERENCES certification_claims (cert_id, claim_id) ON DELETE CASCADE
);

CREATE INDEX certification_contradictions_cert_idx  ON certification_contradictions (cert_id);
-- Partial index, as in Postgres: only the fatal rows are worth an index entry, and "is there a
-- surviving fatal contradiction" is the question the publish gate asks.
CREATE INDEX certification_contradictions_fatal_idx ON certification_contradictions (cert_id) WHERE fatal;


CREATE TABLE certification_epistemic_issues (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  cert_id             INTEGER NOT NULL,
  claim_id            TEXT    NOT NULL,
  language_certainty  TEXT    NOT NULL CHECK (language_certainty IN (
                        'asserted', 'hedged', 'explicitly-uncertain')),
  supported_certainty TEXT    NOT NULL CHECK (supported_certainty IN (
                        'high', 'medium', 'low', 'unknown')),
  quote               TEXT    NOT NULL,
  detail              TEXT    NOT NULL,

  FOREIGN KEY (cert_id, claim_id)
    REFERENCES certification_claims (cert_id, claim_id) ON DELETE CASCADE
);

-- Was COMMENT ON TABLE certification_epistemic_issues:
--   'Phase 8 calibration: where the draft''s language is more certain than its evidence
--    supports.'

CREATE INDEX certification_epistemic_cert_idx ON certification_epistemic_issues (cert_id);


CREATE TABLE certification_reasons (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  cert_id  INTEGER NOT NULL REFERENCES certifications (id) ON DELETE CASCADE,

  -- Which deterministic rule fired. The verdict is computed from these in code.
  rule     TEXT    NOT NULL,

  -- Optional: a rule may be about the draft as a whole rather than one claim. Not a
  -- composite FK for that reason.
  claim_id TEXT,
  detail   TEXT    NOT NULL
);

CREATE INDEX certification_reasons_cert_idx ON certification_reasons (cert_id);
CREATE INDEX certification_reasons_rule_idx ON certification_reasons (rule);


CREATE TABLE certification_invalidations (
  cert_id    INTEGER NOT NULL,
  claim_id   TEXT    NOT NULL,
  because_of TEXT    NOT NULL,

  PRIMARY KEY (cert_id, claim_id, because_of),
  FOREIGN KEY (cert_id, claim_id)
    REFERENCES certification_claims (cert_id, claim_id) ON DELETE CASCADE
);

-- Was COMMENT ON TABLE certification_invalidations:
--   'Claims invalidated because something they depend on failed (Phase 6 dependency graph).'


CREATE TABLE certification_resolution_signals (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  cert_id              INTEGER NOT NULL REFERENCES certifications (id) ON DELETE CASCADE,
  where_found          TEXT    NOT NULL CHECK (where_found IN ('post-body', 'comment', 'op-reply')),
  matched              TEXT    NOT NULL,
  context              TEXT    NOT NULL,
  by_original_poster   INTEGER NOT NULL CHECK (by_original_poster IN (0, 1))
);

-- Was COMMENT ON COLUMN certification_resolution_signals.where_found:
--   'Named where_found because "where" is reserved. Maps to ResolutionSignal.where
--    (src/argus/types.ts:170).'

CREATE INDEX certification_resolution_signals_cert_idx
  ON certification_resolution_signals (cert_id);
