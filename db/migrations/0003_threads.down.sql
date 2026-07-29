-- Reverses 0003_threads.
DROP TABLE   IF EXISTS redbot.thread_comments;
DROP TRIGGER IF EXISTS threads_set_updated_at ON redbot.threads;
DROP TABLE   IF EXISTS redbot.threads;
DROP TYPE    IF EXISTS redbot.thread_source;
