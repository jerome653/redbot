-- Reverses 0022_account_personas.
--
-- WHAT IS LOST, stated plainly: every persona. These are hand-written — a bio, a voice, a ban
-- list per account — and nothing reconstructs them from another table, so rolling this back
-- discards operator work rather than a derived value. Take a copy first if the rows matter:
--
--   node db/sqlite/migrate.mjs sql "SELECT * FROM account_personas"
--
-- Nothing REFERENCES account_personas — it is a leaf, and `accounts` is its parent rather than
-- its child — so the drop has no referential actions to fire. The trigger goes with the table it
-- is attached to, and is dropped explicitly so the rollback is readable rather than relying on
-- that.

DROP TRIGGER IF EXISTS account_personas_set_updated_at;
DROP TABLE IF EXISTS account_personas;
