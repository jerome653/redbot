import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWeekend, effectiveMaxRepliesPerDay } from '../weekend.js';
import { policy } from '../policy.js';

/** Manila is UTC+8: a given Manila wall-clock hour on a date is that date at UTC h-8. */
const manilaAt = (y: number, m: number, d: number, h: number) => new Date(Date.UTC(y, m, d, h - 8));

test('isWeekend is true on Saturday and Sunday in Asia/Manila', () => {
  // 2026-10-24 is a Saturday and 2026-10-25 a Sunday in Manila.
  assert.equal(isWeekend(manilaAt(2026, 9, 24, 10)), true, 'Sat');
  assert.equal(isWeekend(manilaAt(2026, 9, 25, 10)), true, 'Sun');
});

test('isWeekend is false Monday through Friday in Asia/Manila', () => {
  // 2026-10-26 Mon through 2026-10-30 Fri.
  for (let d = 26; d <= 30; d++) {
    assert.equal(isWeekend(manilaAt(2026, 9, d, 10)), false, `2026-10-${d}`);
  }
});

test('isWeekend reads the day in the zone, not in UTC, across the midnight boundary', () => {
  // Friday 2026-10-23 20:00 UTC is Saturday 04:00 in Manila -> weekend.
  assert.equal(isWeekend(new Date('2026-10-23T20:00:00Z')), true, 'Fri-UTC is Sat-Manila');
  // Sunday 2026-10-25 17:00 UTC is Monday 01:00 in Manila -> weekday.
  assert.equal(isWeekend(new Date('2026-10-25T17:00:00Z')), false, 'Sun-UTC is Mon-Manila');
});

test('isWeekend fails closed to false on an invalid zone', () => {
  assert.equal(isWeekend(manilaAt(2026, 9, 24, 10), 'Nowhere/Nothing'), false);
});

test('effectiveMaxRepliesPerDay: weekday is the base cap, weekend is base x multiplier', () => {
  const weekday = manilaAt(2026, 9, 26, 10); // Monday
  const weekend = manilaAt(2026, 9, 24, 10); // Saturday
  assert.equal(effectiveMaxRepliesPerDay(weekday), policy.maxRepliesPerDay.value, 'weekday = base');
  assert.equal(
    effectiveMaxRepliesPerDay(weekend),
    policy.maxRepliesPerDay.value * policy.weekendReplyMultiplier.value,
    'weekend = base x multiplier'
  );
  // The decided numbers: weekday cap 1, weekend effective cap 5.
  assert.equal(effectiveMaxRepliesPerDay(weekday), 1, 'weekday literal');
  assert.equal(effectiveMaxRepliesPerDay(weekend), 5, 'weekend literal');
});
