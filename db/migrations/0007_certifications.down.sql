-- Reverses 0007_certifications. Children first, then the parent, then the vocabularies.
-- certification_verdict is NOT dropped here: 0006 owns it and drafts still uses it.
DROP TABLE IF EXISTS redbot.certification_resolution_signals;
DROP TABLE IF EXISTS redbot.certification_invalidations;
DROP TABLE IF EXISTS redbot.certification_reasons;
DROP TABLE IF EXISTS redbot.certification_epistemic_issues;
DROP TABLE IF EXISTS redbot.certification_contradictions;
DROP TABLE IF EXISTS redbot.certification_claims;
DROP TABLE IF EXISTS redbot.certifications;

DROP TYPE IF EXISTS redbot.resolution_where;
DROP TYPE IF EXISTS redbot.language_certainty;
DROP TYPE IF EXISTS redbot.contradiction_kind;
DROP TYPE IF EXISTS redbot.confidence;
DROP TYPE IF EXISTS redbot.evidence_class;
DROP TYPE IF EXISTS redbot.claim_type;
