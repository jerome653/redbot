-- Reverses 0007_certifications. Children before parents: SQLite enforces the FKs.
DROP TABLE IF EXISTS certification_resolution_signals;
DROP TABLE IF EXISTS certification_invalidations;
DROP TABLE IF EXISTS certification_reasons;
DROP TABLE IF EXISTS certification_epistemic_issues;
DROP TABLE IF EXISTS certification_contradictions;
DROP TABLE IF EXISTS certification_claims;
DROP TABLE IF EXISTS certifications;
