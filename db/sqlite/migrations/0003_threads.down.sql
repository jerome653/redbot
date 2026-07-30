-- Reverses 0003_threads.
DROP TABLE   IF EXISTS thread_comments;
DROP TRIGGER IF EXISTS threads_set_updated_at;
DROP TABLE   IF EXISTS threads;
