-- 0026_stage_cadence_pin_young_ceilings — hold the young fleet at the old cap while the global rises.
--
-- WHY. Slice 4 raises policy.maxRepliesPerDay 3 -> 10 (src/policy.ts) so the PROVEN accounts post
-- more. The global cap is a HARD ceiling every account's own daily_ceiling is Math.min'd against
-- (src/window.ts dailyCeilingFor). In production, daily_ceiling is 10 on several of the thirteen
-- live accounts and 1 on the rest, so raising the global cap alone would let a karma-1 account that
-- happens to hold daily_ceiling 10 jump straight to 10 replies/day — the exact new-account ban risk
-- the "⚠ THE RISK" note in src/policy.ts was written about. This migration removes that risk by
-- pinning every account that has NOT yet proven itself to the old low cap, 3.
--
-- NOT A KARMA GATE ON THE ENFORCER. The enforcer (dailyCeilingFor / effectiveMaxRepliesPerDay) is
-- unchanged and still reads only the static daily_ceiling column; karma is never consulted at reply
-- time. Karma is used HERE, once, to CLASSIFY accounts into the static pin — a one-time data step,
-- not a runtime signal. This is deliberate: AccountRecord has no karma field and the enforcer's
-- signature takes only `now`, and slice 4 does not change that.
--
-- WHO GETS PINNED, named by rule rather than by a guessed roster (the roster is DB data, not in the
-- repo): every account whose LATEST measured karma is below cautionKarmaBelow (10) — the engine's
-- own maturity line (src/warming.ts, src/health.ts) — OR that has never been measured. "Latest" is
-- the newest observation by id, the same selection src/db/summary.ts uses (highest id, not ts,
-- because a checkpoint reading can be back-dated). Accounts at karma >= 10 are the proven ones
-- (today: the josh/ethan pair); their pin is CLEARED so they ride the new global cap of 10.
--
-- FAILS CLOSED. On a database with no karma observations (a fresh or test DB), the mature set is
-- empty, so EVERY account is pinned to 3 and NONE rides the raise. Under-sending, never over-sending
-- — the same safe direction every cap in this engine chooses.
--
-- ATOMIC WITH THE RAISE. This file and the src/policy.ts raise ship in one commit; migrations run
-- before the new binary starts (src/db.ts ping refuses an unmigrated DB), so the raised cap is never
-- live while these pins are unset.

-- The proven accounts: latest karma at or above the maturity line. Computed once, reused by both
-- statements so the two cannot disagree.
CREATE TEMP TABLE _slice4_mature AS
  SELECT account FROM (
    SELECT account,
           CAST(value AS INTEGER) AS karma,
           row_number() OVER (PARTITION BY account ORDER BY id DESC) AS rn
      FROM observations
     WHERE account IS NOT NULL AND kind = 'karma' AND value IS NOT NULL
  )
  WHERE rn = 1 AND karma >= 10;

-- Young / unproven / unmeasured: pin to the old low cap so the raise cannot leak to them.
UPDATE accounts
   SET daily_ceiling = 3
 WHERE handle NOT IN (SELECT account FROM _slice4_mature);

-- Proven: clear any pin so Math.min(NULL-as-cap, 10) = 10 — they ride the raised global cap.
UPDATE accounts
   SET daily_ceiling = NULL
 WHERE handle IN (SELECT account FROM _slice4_mature);

DROP TABLE _slice4_mature;
