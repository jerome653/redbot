-- 0018_account_locations — where an account's browser actually was, and the end of
-- `accounts.timezone` as something a person types.
--
-- `accounts.timezone` has been hand-typed configuration with a hardcoded fallback:
-- src/console-accounts.ts wrote 'Asia/Manila' whenever the field was left empty. It is also what
-- the browser ANNOUNCES — src/proxy/align.ts drives `Emulation.setTimezoneOverride` from this
-- column — so the one value that has to agree with the exit address was the one value nothing
-- ever measured.
--
-- ---------------------------------------------------------------------------
-- A CORRECTION, AND HOW THE ERROR HAPPENED
--
-- The two figures this header used to carry were both FALSE. They are corrected below with the
-- method that produced them, because a file whose argument is "measure it, do not assume it"
-- must not itself ship an unmeasured claim — and because the mistake is one anybody reading a
-- SQLite database on this project can make again tomorrow.
--
--   WAS: "data/redbot.db  accounts = 1 row (Big_Variation_8580)"
--   WAS: "7 of the 8 seed entries have no database row at all"   (further down, and a
--        consequence of the first)
--
-- Both came from copying data/redbot.db on its own. This database runs in WAL mode, so the .db
-- file holds only the last CHECKPOINTED image and every commit since then lives in
-- data/redbot.db-wal — 2.1 MB of it at the time. A copy taken without the -wal is not a corrupt
-- file and does not announce itself: it opens cleanly, answers every query, and is simply months
-- out of date. It reported one account because Big_Variation_8580 (created 2026-09-01) was the
-- only row that had reached a checkpoint; the rest were still in the log.
--
-- Reproduced deliberately, both ways, on 2026-09-21:
--
--   cp redbot.db <tmp>/                                -> accounts = 1   (Big_Variation_8580)
--   cp redbot.db redbot.db-wal redbot.db-shm <tmp>/    -> accounts = 9
--     then: pragma wal_checkpoint(TRUNCATE)
--
-- HOW TO READ THIS DATABASE, which is the part worth keeping. The .db file on its own is a
-- SNAPSHOT AS OF THE LAST CHECKPOINT. To see the current state, copy all three files together —
-- redbot.db, redbot.db-wal, redbot.db-shm — and checkpoint the copy before reading it. Anything
-- less and the numbers you get are real, self-consistent, and describe a database that stopped
-- existing weeks ago.
--
-- THE HEADCOUNT IS DELIBERATELY NOT THE ARGUMENT HERE, because a headcount rots. It rotted twice
-- while this very comment was being written: the original said 1, a correction in hand said 8,
-- and a measurement on 2026-09-21 against a properly checkpointed copy said 9 — the accounts
-- table and data/accounts.json agreeing at 9 each, one account_machines row apiece, every one of
-- them timezone 'Asia/Manila' and quiet_start = 0, quiet_end = 8. None of those three numbers was
-- a mistake at the moment it was taken. The product simply kept adding accounts.
--
-- Which is why the statement at the foot of this file has NO WHERE CLAUSE. It clears every row
-- there is, whatever the count is on the day it runs, and nothing about it needs to know the
-- number. Any figure quoted above is dated evidence of what was seen once, not a fact this
-- migration depends on.
--
-- The claim it DOES depend on is the one that does not turn on the count: every accounts.timezone
-- in both stores was typed or defaulted, not one had been measured, and all of them said Manila
-- while the machine egresses from San Jose, US. A timezone that contradicts the exit is one of
-- the most reliable proxy tells there is, and 0016 already says so in as many words. It simply
-- had no way to know the zone was false.
--
-- AND THE DEFECT WAS STILL MINTING ROWS WHILE THIS WAS BEING WRITTEN. `colegowth` was created at
-- 2026-09-21T06:14:11.630Z, hours into the work that removes the hardcoded default, and it too
-- arrived carrying 'Asia/Manila' — from src/console-accounts.ts, from nothing anybody measured.
-- That is the clearest statement of why this migration exists: the bad value is not a historical
-- artefact to be cleaned up once, it is a default that was still producing new wrong rows on the
-- day it was removed.
--
-- One more hazard, because it bit the instrument used to check this work: the md5 of redbot.db
-- CANNOT DETECT A RECENT WRITE. colegowth's insert landed in the WAL, so the main file's hash and
-- mtime were both unchanged across it. "redbot.db is byte-identical" proves the checkpointed
-- image was not rewritten; it does not prove the database was not written to. Hash all three
-- files, and read a -wal change as "the application was used", not as damage.
--
-- Two further corrections to what this file used to say: the seed file is NOT the larger,
-- diverging store — the two hold the same accounts — so the write-back in src/console-accounts.ts
-- mirrors into both for the reason restated at the UPDATE below, not for that one.
--
-- From here the stored zone is a RECORD OF A MEASUREMENT. Nothing types it.
--
-- ---------------------------------------------------------------------------
-- WHY A NEW TABLE RATHER THAN MORE COLUMNS ON account_exit_ips.
--
-- account_exit_ips (0016) holds handle, exit_ip, via, matched_pin, and every column in it exists
-- to serve ONE question: is this account still on the address it was pinned to. A location
-- detection answers a different question — what the network says about WHERE this browser is —
-- carries ten fields the pin comparison has no use for, and has a different lifetime: a pin is
-- re-vetted deliberately, a location is read on every launch. Widening that table would leave
-- `matched_pin` meaningless on most of its rows and make "the pin ledger" mean two things.
--
-- This is the same split 0016 itself made between account_proxies and account_machines: a fact
-- goes where its QUESTION lives, not where a column of the same name already sits.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------------ --
-- What the browser's own network said about where it is. Append-only.
-- ------------------------------------------------------------------ --
--
-- AUTOINCREMENT rather than (handle, at), for the reason 0016 measured and wrote down: strftime
-- ('%f') is millisecond precision, and a (handle, observed_at) primary key rejected 49 of 50
-- same-handle inserts made inside one millisecond. Detections are written on launch AND on a
-- run, so the same collision is reachable here. Same shape as account_exit_ips, history and
-- observations.
--
-- FOURTEEN columns: id, plus the thirteen below.
CREATE TABLE account_locations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,

  handle         TEXT    NOT NULL REFERENCES accounts (handle) ON DELETE CASCADE,

  at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                 CHECK (at LIKE '____-__-__T%Z'),

  -- The address the lookup was answered FOR. 45 is the longest an IPv6 address with an embedded
  -- IPv4 tail can be; 7 is "0.0.0.0". Same bounds as account_exit_ips.exit_ip, because it is the
  -- same kind of value — but deliberately NOT a foreign key to it: a detection is evidence in its
  -- own right and must be storable whether or not the pin ledger has seen that address.
  --
  -- NULLABLE, and it was NOT NULL when this file was written. The argument for the change is
  -- worth keeping, because it is a judgement and not a typo.
  --
  -- src/proxy/detect.ts reads this from the provider's `query` field and types it `string | null`.
  -- That parser insists on exactly two fields and states why for each: `timezone`, because it is
  -- the field the whole detection exists to obtain, and `countryCode`, because without it the
  -- zone cannot be checked against anything. `ip` is neither. With NOT NULL here, a provider
  -- record carrying a good zone AND a good country but no `query` produced a perfectly valid
  -- BrowserLocation that this table then refused — measured, not inferred:
  --
  --   NOT NULL constraint failed: account_locations.ip
  --
  -- On the launch path that refusal means declining to open a browser over a corroborating field
  -- nothing downstream reads: the zone and the country drive the override and the alignment
  -- check, and neither consults the address. Fail-closed is the right instinct everywhere in this
  -- table, but here it was pointed at the operator and bought no safety.
  --
  -- So a detection without an IP is still a detection — the zone was measured and is true. What
  -- it is NOT is attributable: it cannot be set beside account_exit_ips and asked whether the
  -- browser really went out through the exit. NULL says precisely that, and says it visibly. The
  -- alternative on offer was a placeholder, and a '0.0.0.0' that passed the length check would
  -- have made an unattributable reading indistinguishable from an attributed one — which is the
  -- class of mistake this whole table exists to stop.
  ip             TEXT    CHECK (ip IS NULL OR length(ip) BETWEEN 7 AND 45),

  -- Two letters, upper-case, so 'us' and 'US' cannot both exist and defeat a comparison. The rule
  -- is copied from account_proxies.exit_country deliberately: src/proxy/align.ts compares these
  -- two values to each other, and a case difference between the tables would be a silent mismatch.
  country_code   TEXT    CHECK (country_code IS NULL
                                OR (length(country_code) = 2
                                    AND country_code NOT GLOB '*[^A-Z]*')),

  -- The country's FULL NAME as the provider gives it ("United States"), beside the code.
  --
  -- It is here because the detector measures it and had nowhere to put it. src/proxy/detect.ts
  -- fills `BrowserLocation.country`; this table had no column for it; the two halves were built
  -- separately and neither compiler nor test could see across the seam, so a successful detection
  -- silently dropped the field on the way to storage. Silent loss of a measured value is the one
  -- failure this table is least entitled to.
  --
  -- NOT a duplicate of country_code. The code is what align.ts COMPARES; this is what a person
  -- READS when an account is being investigated. A provider answering a name but no usable code,
  -- or the reverse, is exactly the disagreement worth having both columns to notice.
  --
  -- Nullable, and with no GLOB over its characters: this is free text from a third party, and the
  -- comparison rules that make country_code's strictness necessary do not apply to a field
  -- nothing compares.
  country        TEXT    CHECK (country IS NULL OR length(country) BETWEEN 1 AND 64),

  region_name    TEXT    CHECK (region_name IS NULL OR length(region_name) <= 64),
  city           TEXT    CHECK (city IS NULL OR length(city) <= 128),

  -- NOT NULL, and this is the fail-closed choice rather than an oversight. The timezone is the
  -- whole reason this table exists; a row without one is not a detection, it is a failed one, and
  -- a failed detection must leave accounts.timezone untouched rather than write a hole into the
  -- record. The detection parser makes the same choice on its side (a record with no zone parses
  -- to null), so this states that contract in the database instead of trusting one caller to keep it.
  timezone       TEXT    NOT NULL CHECK (length(timezone) BETWEEN 3 AND 64),

  -- Seconds east of UTC, as the provider reported it. The real IANA span is UTC-12:00 to UTC+14:00
  -- — a bound worth stating, because a value outside it means the field was misread, not that
  -- somewhere unusual was found.
  offset_seconds INTEGER CHECK (offset_seconds IS NULL
                                OR offset_seconds BETWEEN -43200 AND 50400),

  -- Provider-reported posture flags. Nullable because "the provider did not say" is a real and
  -- different answer from "the provider said no" — collapsing them would turn silence into a
  -- clean bill of health, which is the reading that gets an account caught.
  proxy          INTEGER CHECK (proxy   IS NULL OR proxy   IN (0, 1)),
  hosting        INTEGER CHECK (hosting IS NULL OR hosting IN (0, 1)),

  -- WHICH OCCASION produced the reading. The same closed domain, spelled the same way, as
  -- account_exit_ips.via — the two ledgers are read side by side when an account is investigated,
  -- and two different vocabularies for the same four occasions would make that comparison lie.
  via            TEXT    NOT NULL CHECK (via IN ('vet', 'launch', 'run', 'doctor')),

  -- BY WHAT ROUTE the reading travelled — and that is a different question from `via` above.
  --
  -- These two were one column, which is the whole reason this note exists. src/proxy/detect.ts
  -- types its own `via` as a free string and writes a transport description into it:
  --
  --   renderer fetch of ip-api.com from a local http origin (<handle> @ <endpoint>)
  --
  -- while this table CHECKed `via IN ('vet','launch','run','doctor')`. The insert was refused by
  -- the constraint — measured, not inferred:
  --
  --   CHECK constraint failed: via IN ('vet','launch','run','doctor')
  --
  -- The tempting resolutions were to widen the CHECK or to make the detector write 'launch', and
  -- both destroy a meaning. `via` answers which occasion triggered the reading and has to keep
  -- account_exit_ips' exact vocabulary. This answers by what route it was taken, and the route is
  -- the property the entire detection turns on: src/proxy/detect.ts documents two lookups that
  -- return a correct-looking record over the WRONG network path, one of which returns HTTP 200
  -- and the host machine's location while a proxied browser sits unused. When a stored zone later
  -- looks wrong, this column is what says whether the measurement could have been right at all.
  --
  -- Nullable, because only a browser-side detector has a transport to name. Something that
  -- measured another way must be able to say nothing here rather than invent a sentence — the
  -- same reasoning as proxy and hosting above, and the opposite of a NOT NULL that would force
  -- every future producer to fabricate one.
  transport      TEXT    CHECK (transport IS NULL OR length(transport) BETWEEN 1 AND 200)
);

-- "Where has this account been lately", which is the only question asked of this table — and the
-- one the write-back path asks to find the latest zone. Matches account_exit_ips_by_handle.
CREATE INDEX account_locations_by_handle ON account_locations (handle, at DESC);

-- ------------------------------------------------------------------ --
-- The known-false zones.
-- ------------------------------------------------------------------ --
--
-- Every existing accounts.timezone was typed or defaulted, and every one is measurably wrong:
-- they say Manila, the machine exits from California. This clears them — all of them, whatever
-- the count happens to be on the day it runs, which is why the statement below carries no number
-- and no WHERE.
--
-- WHAT THIS DOES NOT REACH, said plainly rather than left to be discovered: data/accounts.json.
-- A migration runs against the database, and the seed file is not the database.
--
-- This paragraph used to continue "and 7 of the 8 seed entries have no database row at all".
-- That was false, for the reason the header now records — it was read from a .db copied without
-- its -wal. Measured properly the two stores list the SAME accounts (9 and 9 on 2026-09-21), and
-- they differ only in that a migration can reach one of them. The seed entries are served to
-- src/config.ts straight from the file and keep their stale value until something rewrites it,
-- which is why the write-back in src/console-accounts.ts mirrors a measured zone into BOTH stores
-- rather than only the column. Until each account has been measured, the launch-time alignment
-- check (src/proxy/align.ts) is what stands between a stale seed value and a browser announcing
-- the wrong hemisphere.
--
-- WHY CLEARING IS SAFER THAN LEAVING THEM. A NULL zone is refused by src/window.ts — an account
-- whose location was never measured is not scheduled. A WRONG zone is not refused by anything: it
-- passes every check, drives setTimezoneOverride, and announces the contradiction to Reddit. So
-- the state this produces is loud and stops work, and the state it replaces is silent and does
-- damage. Fail closed is the cheaper failure by a wide margin.
--
-- Nothing is lost that was worth keeping: these values were never evidence of anything. The
-- accounts come back the moment a detection runs, which is the only thing that should ever have
-- been writing this column — and from this change forward something does, on every browser start,
-- on both launch paths. See tools/product/server.mjs.
UPDATE accounts SET timezone = NULL;
