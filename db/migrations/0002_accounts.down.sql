-- Reverses 0002_accounts.
DROP TRIGGER IF EXISTS accounts_set_updated_at ON redbot.accounts;
DROP TABLE IF EXISTS redbot.accounts;
