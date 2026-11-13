import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyCeilingFor } from '../window.js';
import { effectiveMaxRepliesPerDay } from '../weekend.js';
import { policy } from '../policy.js';
import type { AccountRecord } from '../config.js';

/**
 * Slice 4 — staged cadence by ceiling.
 *
 * The goal: proven accounts (karma >= 10) post more, while the young fleet (karma <= 4) stays
 * throttled. The mechanism is the one that already exists — `dailyCeilingFor`'s `Math.min` of the
 * account's own `dailyCeiling` and the global cap — NOT a karma read inside the enforcer. Karma is
 * not reachable here (AccountRecord has no karma field and effectiveMaxRepliesPerDay(now) takes only
 * `now`), and this test proves the behaviour is achieved WITHOUT reaching for it.
 *
 * A young account is represented exactly as migration 0026 leaves it: `dailyCeiling` PINNED to the
 * old low cap (3). A mature account is left UNPINNED (dailyCeiling undefined), so it rides whatever
 * the global cap is.
 *
 * now = a weekday in Asia/Manila (Monday 2026-10-26, 10:00 local = 02:00 UTC), so the weekend
 * multiplier is not in play and the effective cap is the raw weekday cap.
 */
const WEEKDAY_MANILA = new Date('2026-10-26T02:00:00Z');

const LOW_PIN = 3; // the weekday cap before slice 4; migration 0026 pins every young account here.

const young = (): AccountRecord => ({
  handle: 'ryangrowth12', timezone: 'Asia/Manila', quietHours: [0, 8], dailyCeiling: LOW_PIN
});
const mature = (): AccountRecord => ({
  handle: 'joshanweb', timezone: 'Asia/Manila', quietHours: [0, 8] // no dailyCeiling: rides the global cap
});

test('a pinned karma-1 account stays at the low ceiling while an unpinned mature account rides the raised cap', () => {
  const cap = effectiveMaxRepliesPerDay(WEEKDAY_MANILA);

  // The raise must actually have happened: the global weekday cap is now above the old low pin.
  assert.ok(cap > LOW_PIN, `the global cap (${cap}) must be raised above the low pin (${LOW_PIN})`);

  // Young: pinned to 3 — the raised cap must NOT leak to it. min(3, cap) === 3.
  assert.equal(dailyCeilingFor(young(), WEEKDAY_MANILA), LOW_PIN,
    'a pinned young account stays capped at the low value even after the global raise');

  // Mature: unpinned — rides the new, higher cap. min(cap, cap) === cap.
  assert.equal(dailyCeilingFor(mature(), WEEKDAY_MANILA), cap,
    'an unpinned mature account reaches the raised global cap');

  // The staging is real: mature is allowed strictly more than young.
  assert.ok(dailyCeilingFor(mature(), WEEKDAY_MANILA) > dailyCeilingFor(young(), WEEKDAY_MANILA),
    'the proven account is allowed more replies than the pinned young account');
});

test('the raised weekday cap is the decided literal (10), and the enforcer reads it through Math.min', () => {
  // Pins the decision so an accidental revert of policy.maxRepliesPerDay is caught here.
  assert.equal(policy.maxRepliesPerDay.value, 10, 'slice 4 raises the weekday cap to 10');
  assert.equal(effectiveMaxRepliesPerDay(WEEKDAY_MANILA), 10, 'weekday effective cap is 10');
  assert.equal(dailyCeilingFor(mature(), WEEKDAY_MANILA), 10, 'unpinned mature rides the cap of 10');
  assert.equal(dailyCeilingFor(young(), WEEKDAY_MANILA), 3, 'pinned young is held at 3');
});
