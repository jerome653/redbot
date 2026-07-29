-- Reverses 0009_event_logs.
DROP TABLE IF EXISTS redbot.confirmations;
DROP TABLE IF EXISTS redbot.trace;
DROP TABLE IF EXISTS redbot.interactions;
DROP TABLE IF EXISTS redbot.regret;
DROP TABLE IF EXISTS redbot.reviews;
DROP TABLE IF EXISTS redbot.observations;
DROP TABLE IF EXISTS redbot.history;

DROP TYPE IF EXISTS redbot.visibility;
DROP TYPE IF EXISTS redbot.evidence_source;
DROP TYPE IF EXISTS redbot.trace_level;
DROP TYPE IF EXISTS redbot.trace_stage;
DROP TYPE IF EXISTS redbot.interaction_kind;
DROP TYPE IF EXISTS redbot.issue_category;
DROP TYPE IF EXISTS redbot.regret_kind;
DROP TYPE IF EXISTS redbot.review_decision;
DROP TYPE IF EXISTS redbot.checkpoint;
DROP TYPE IF EXISTS redbot.observation_vector;
DROP TYPE IF EXISTS redbot.observation_kind;
DROP TYPE IF EXISTS redbot.history_status;
DROP TYPE IF EXISTS redbot.history_kind;
