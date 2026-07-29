-- Reverses 0011_credentials.
--
-- Dropping this table destroys every sealed secret in it. That is the correct behaviour for a
-- rollback — a vault that survived its own removal would leave ciphertext in a database whose
-- schema no longer explains what it is — but it is not recoverable from the master key alone.
DROP TRIGGER IF EXISTS credentials_set_updated_at ON redbot.credentials;
DROP TABLE IF EXISTS redbot.credentials;
