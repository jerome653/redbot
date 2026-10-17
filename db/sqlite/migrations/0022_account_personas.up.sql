-- 0022_account_personas — who each account is, and how it writes.
--
-- WHY THIS EXISTS, as a measurement rather than a preference.
--
-- `accounts` already carries `role`, `speaks` and `knows`. All three are editable on the console
-- (src/console-accounts.ts:412 lists them in EDITABLE), all three are pushed to the dashboard
-- (src/push/accounts.ts:371), all three are read back by the Accounts screen — AND NOT ONE OF THEM
-- REACHES A PROMPT. `draftPrompt` (src/prompts.ts:176) takes `(thread, reason, angle, gap,
-- reference)`. There is no account parameter. `warmupPrompt` takes `(thread)` alone. Grepped
-- 2026-10-16: outside console editing, sync and the DB layer, nothing reads `.speaks` or `.knows`
-- at all.
--
-- So every account on this install drafts from one identical prompt, in one register, with one
-- hedging style, one sentence-length rule and one set of banned phrases. Measured on the live
-- rows the same day: 13 accounts, 7 with a role and a `speaks` line, 6 with neither, and `knows`
-- EMPTY on all 13. The seven filled-in ones made no difference to a single word of output,
-- because the column was never on the path.
--
-- That is a single authorial fingerprint across thirteen identities, which is exactly the shape
-- that reads as one writer. The four comments this install published to r/Wordpress were removed
-- by moderators, one with the public reply "Please don't post AI-generated comments."
--
-- ---------------------------------------------------------------------------
-- WHY A SEPARATE TABLE AND NOT COLUMNS ON `accounts` — the reason 0016 states and measures.
--
-- SQLite cannot attach a CHECK to a column added by ALTER TABLE, so CHECKed columns on `accounts`
-- mean rebuilding it. SIX tables reference accounts(handle), five ON DELETE CASCADE — verified
-- against this database's own sqlite_master on 2026-10-16, not taken from 0016's comment:
--
--   drafts.account            ON DELETE SET NULL
--   jobs.account              ON DELETE CASCADE
--   account_machines.handle   ON DELETE CASCADE
--   account_proxies.handle    ON DELETE CASCADE
--   account_locations.handle  ON DELETE CASCADE
--   account_exit_ips.handle   ON DELETE CASCADE
--
-- migrate.mjs runs every migration under PRAGMA foreign_keys = ON, where DROP TABLE performs an
-- implicit DELETE FROM that FIRES those actions. 0016 measured the result on a fixture with four
-- of the six relationships: jobs 1 -> 0, drafts.account a -> null, and the migration REPORTING
-- SUCCESS. With six relationships the damage is strictly larger. So `accounts` is not touched,
-- and this follows the shape 0016 and 0018 already established: one row per handle, in its own
-- table, cascading from the parent.
--
-- WHAT GOES HERE vs WHAT STAYS ON `accounts`. 0013's principle, unchanged: an account row is "a
-- description you can share". A persona is exactly that — it travels with the account to any
-- machine — so it is keyed by handle alone with nothing machine-local in it.
--
-- ---------------------------------------------------------------------------
-- EVERY COLUMN IS READ BY A PROMPT. That is a hard rule for this table, and it is the lesson of
-- `role`/`speaks`/`knows` above: a settings column nothing consumes is not a setting, it is a form
-- field that lies to the person filling it in. src/persona.ts renders all eleven, and
-- src/test/persona.test.ts asserts that each one changes the rendered block — so a column added
-- here without a reader fails a test rather than sitting there looking configured.

CREATE TABLE account_personas (
  handle            TEXT    NOT NULL PRIMARY KEY REFERENCES accounts (handle) ON DELETE CASCADE,

  -- Off without being deleted. A persona an operator is still writing must not be half-applied to
  -- live drafts, and deleting it to pause it would lose the work.
  enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),

  -- ---- personal: who this account reads as ----

  -- The first name the account writes as, which is NOT the Reddit handle. Bounded at 40 to match
  -- `accounts.handle`; no character class, because a human first name is not a directory name.
  display_name      TEXT    CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 40),

  -- One paragraph, first person, present tense. Rendered verbatim into the prompt, so the bound is
  -- what keeps a persona from crowding out the thread it is supposed to be answering: 900
  -- characters is roughly 150 words against the 2500-character thread body `trim` already allows.
  bio               TEXT    CHECK (bio IS NULL OR length(bio) <= 900),

  -- 0 is a real answer and means "new to this". 50 is a bound, not a belief about careers.
  experience_years  INTEGER CHECK (experience_years IS NULL OR experience_years BETWEEN 0 AND 50),

  -- What this account actually works with, as a JSON array of strings. Distinct from
  -- `accounts.knows`, which is a topic list; this is the toolset a reply may speak from.
  stack             TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(stack) AND json_type(stack) = 'array'),

  -- Spelling and idiom. Two lower-case letters so 'uk' and 'UK' cannot both exist and defeat a
  -- comparison — the same reasoning as `account_proxies.exit_country`, inverted case because this
  -- one is a language tag rather than an ISO country code.
  locale_flavour    TEXT    CHECK (locale_flavour IS NULL
                                   OR (length(locale_flavour) = 2
                                       AND locale_flavour NOT GLOB '*[^a-z]*')),

  -- ---- voice: how it writes ----

  -- A closed set, because an open one drifts into a second prose style per account and the point
  -- is a DIFFERENCE between accounts, not a free-text field nobody can diff. src/persona.ts maps
  -- each of these to concrete instructions; an unmapped value would be a silent no-op, so the
  -- CHECK and the map are asserted against each other in src/test/persona.test.ts.
  register          TEXT    CHECK (register IS NULL
                                   OR register IN ('terse', 'plain', 'warm', 'technical')),

  -- The per-account ceiling on reply length, in sentences.
  --
  -- THIS IS THE "DO NOT ADD TOO MUCH" DIAL. src/prompts.ts has one hardcoded "LENGTH: two to four
  -- sentences" for all thirteen accounts, so every reply lands in the same band — and a uniform
  -- length across identities is itself a tell. 1 is allowed: a one-sentence answer is the most
  -- human output this engine can produce and the prompt already says so ("one sentence is fine
  -- when one sentence answers it"). 6 is the bound, below anything that reads as an essay.
  max_sentences     INTEGER CHECK (max_sentences IS NULL OR max_sentences BETWEEN 1 AND 6),

  -- Concrete, checkable habits — "writes 'wordpress' lowercase", "never uses em dashes". A JSON
  -- array of strings. NOT a licence to fake human error: src/prompts.ts rule 3 forbids deliberate
  -- typos and forced slang, src/persona.ts repeats that refusal next to this field, and
  -- src/persona.ts rejects a quirk that asks for one.
  quirks            TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(quirks) AND json_type(quirks) = 'array'),

  -- How THIS account says it is not sure. The draft prompt requires visible uncertainty on any
  -- ungrounded claim, and with one phrasing for every account that requirement produces the same
  -- half-dozen hedges forever. One line, e.g. "says 'not sure but' and moves on".
  hedge_style       TEXT    CHECK (hedge_style IS NULL OR length(hedge_style) <= 200),

  -- Phrases this account never writes, as a JSON array. Per-account on purpose: a global ban list
  -- makes thirteen accounts avoid the same words in the same way, which is another shared
  -- fingerprint. Checked mechanically after drafting as well as stated in the prompt.
  banned_phrases    TEXT    NOT NULL DEFAULT '[]'
                            CHECK (json_valid(banned_phrases) AND json_type(banned_phrases) = 'array'),

  -- ---- operating ----

  -- Subjects this account declines even when a gap exists. Narrower than the prompt's global
  -- decline list, and additive to it — never a way to widen what may be answered.
  avoid_topics      TEXT    NOT NULL DEFAULT '[]'
                            CHECK (json_valid(avoid_topics) AND json_type(avoid_topics) = 'array'),

  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    CHECK (created_at LIKE '____-__-__T%Z'),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    CHECK (updated_at LIKE '____-__-__T%Z')
);

-- `updated_at` maintained by the database, like every other table here. A column the application
-- is trusted to set is a column that is wrong the first time somebody writes a row by hand.
CREATE TRIGGER account_personas_set_updated_at
AFTER UPDATE ON account_personas
FOR EACH ROW
BEGIN
  UPDATE account_personas
     SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE handle = NEW.handle;
END;

-- Nothing is seeded. A persona nobody wrote is an invented person, and the whole defect above is
-- the build choosing how somebody else's account sounds — `accounts.subreddits` and
-- `accounts.timezone` both had exactly that fallback removed for the same reason
-- (src/console-accounts.ts). An account with no row here drafts from the base prompt unchanged,
-- which is the behaviour before this migration.
