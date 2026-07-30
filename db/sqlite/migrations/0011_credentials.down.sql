-- Reverses 0011_credentials.
--
-- This DESTROYS every stored secret. They are not recoverable from anywhere else: the master
-- key seals them and nothing keeps a plaintext copy. Re-add them with `redbot vault set`.
DROP TRIGGER IF EXISTS credentials_set_updated_at;
DROP TABLE   IF EXISTS credentials;
