-- Reverses 0008_jobs.
DROP TRIGGER IF EXISTS jobs_set_updated_at ON redbot.jobs;
DROP TABLE   IF EXISTS redbot.jobs;
DROP TYPE    IF EXISTS redbot.job_kind;
DROP TYPE    IF EXISTS redbot.job_state;
