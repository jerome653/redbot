-- 0018_account_locations — where an account's browser actually was, and the end of
-- `accounts.timezone` as something a person types.
--
-- `accounts.timezone` has been hand-typed configuration with a hardcoded fallback:
-- src/console-accounts.ts wrote 'Asia/Manila' whenever the field was left empty. It is also what
-- the browser ANNOUNCES — src/proxy/align.ts drives `Emulation.setTimezoneOverride` from this
-- column — so the one value that has to agree with the exit address was the one value nothing
-- ever measured.
--
-- MEASURED on the live database and its seed file, 2026-09-21, and the two do not hold the same
-- number of accounts. Worth stating precisely, because a rounder number had been assumed:
--
--   data/redbot.db      accounts = 1 row (Big_Variation_8580), timezone 'Asia/Manila'
--   data/accounts.json  accounts = 8 entries, every one of them 'Asia/Manila'
--
-- while the machine egresses from San Jose, US. A timezone that contradicts the exit is one of
-- the most reliable proxy tells there is, and 0016 already says so in as many words. It simply
-- had no way to know the zone was false.
--
-- From here the stored zone is a RECORD OF A MEASUREMENT. Nothing types it.
--
-- ---------------------------------------------------------------------------
-- WHY A NEW TABLE RATHER THAN MORE COLUMNS ON account_exit_ips.
--
-- account_exit_ips (0016) holds handle, exit_ip, via, matched_pin, and every column in it exists
-- to serve ONE question: is this account still on the address it was pinned to. A location
-- detection answers a different question — what the network says about WHERE this browser is —
-- carries eight fields the pin comparison has no use for, and has a different lifetime: a pin is
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
CREATE TABLE account_locations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,

  handle         TEXT    NOT NULL REFERENCES accounts (handle) ON DELETE CASCADE,

  at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                 CHECK (at LIKE '____-__-__T%Z'),

  -- The address the lookup was answered FOR. 45 is the longest an IPv6 address with an embedded
  -- IPv4 tail can be; 7 is "0.0.0.0". Same bounds as account_exit_ips.exit_ip, because it is the
  -- same kind of value — but deliberately NOT a foreign key to it: a detection is evidence in its
  -- own right and must be storable whether or not the pin ledger has seen that address.
  ip             TEXT    NOT NULL CHECK (length(ip) BETWEEN 7 AND 45),

  -- Two letters, upper-case, so 'us' and 'US' cannot both exist and defeat a comparison. The rule
  -- is copied from account_proxies.exit_country deliberately: src/proxy/align.ts compares these
  -- two values to each other, and a case difference between the tables would be a silent mismatch.
  country_code   TEXT    CHECK (country_code IS NULL
                                OR (length(country_code) = 2
                                    AND country_code NOT GLOB '*[^A-Z]*')),

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

  -- HOW the detection was made. The same closed domain, spelled the same way, as
  -- account_exit_ips.via — the two ledgers are read side by side when an account is investigated,
  -- and two different vocabularies for the same four occasions would make that comparison lie.
  via            TEXT    NOT NULL CHECK (via IN ('vet', 'launch', 'run', 'doctor'))
);

-- "Where has this account been lately", which is the only question asked of this table — and the
-- one the write-back path asks to find the latest zone. Matches account_exit_ips_by_handle.
CREATE INDEX account_locations_by_handle ON account_locations (handle, at DESC);

-- ------------------------------------------------------------------ --
-- The eight known-false zones.
-- ------------------------------------------------------------------ --
--
-- Every existing accounts.timezone was typed or defaulted, and every one is measurably wrong:
-- they say Manila, the machine exits from California. This clears them.
--
-- WHAT THIS DOES NOT REACH, said plainly rather than left to be discovered: data/accounts.json.
-- A migration runs against the database, and 7 of the 8 seed entries have no database row at
-- all. They are served to src/config.ts straight from the file, and keep their stale value until
-- something rewrites it. That is why the write-back in src/console-accounts.ts mirrors a measured
-- zone into BOTH stores rather than only the column. Until each account has been measured, the
-- launch-time alignment check (src/proxy/align.ts) is what stands between a stale seed value and
-- a browser announcing the wrong hemisphere.
--
-- WHY CLEARING IS SAFER THAN LEAVING THEM. A NULL zone is refused by src/window.ts — an account
-- whose location was never measured is not scheduled. A WRONG zone is not refused by anything: it
-- passes every check, drives setTimezoneOverride, and announces the contradiction to Reddit. So
-- the state this produces is loud and stops work, and the state it replaces is silent and does
-- damage. Fail closed is the cheaper failure by a wide margin.
--
-- Nothing is lost that was worth keeping: these values were never evidence of anything. The
-- accounts come back the moment a detection runs, which is the only thing that should ever have
-- been writing this column.
UPDATE accounts SET timezone = NULL;
