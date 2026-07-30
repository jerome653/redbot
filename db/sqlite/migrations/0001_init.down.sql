-- Reverses 0001_init.
--
-- There is nothing to drop: 0001 creates no object. It sets journal_mode, which is a property
-- of the file and is deliberately NOT reverted — going back to a rollback journal would break
-- the multi-process reader/writer guarantee for any connection still open, and "the migration
-- I rolled back took the concurrency model with it" is a worse surprise than a file that is
-- still in WAL. Delete the file if you want a truly clean slate.
--
-- SQLite needs at least one statement here for the runner to have something to execute.
SELECT 1;
