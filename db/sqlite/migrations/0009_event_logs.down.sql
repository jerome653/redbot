-- Reverses 0009_event_logs.
--
-- The Postgres original also dropped 13 enum types. There are none here — the vocabularies live
-- in CHECK constraints on the tables, so they go when the tables go.
DROP TABLE IF EXISTS confirmations;
DROP TABLE IF EXISTS trace;
DROP TABLE IF EXISTS interactions;
DROP TABLE IF EXISTS regret;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS observations;
DROP TABLE IF EXISTS history;
