import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWindow, inQuietRange, localHourFor } from '../window.js';
import type { AccountRecord } from '../config.js';

const acct = (over: Partial<AccountRecord> = {}): AccountRecord => ({
  handle: 'tester', timezone: 'Asia/Manila', quietHours: [0, 8], dailyCeiling: 2, ...over
});
/** 2026-07-24 04:00 UTC is 12:00 in Manila (UTC+8); 20:00 UTC is 04:00 next day. */
const AT_NOON_MANILA = new Date('2026-07-24T04:00:00Z');
const AT_4AM_MANILA = new Date('2026-07-24T20:00:00Z');

test('quiet range handles a normal span', () => {
  assert.equal(inQuietRange(3, 0, 8), true);
  assert.equal(inQuietRange(8, 0, 8), false, 'the end hour is excluded');
  assert.equal(inQuietRange(12, 0, 8), false);
});

test('quiet range wraps midnight', () => {
  assert.equal(inQuietRange(23, 22, 7), true);
  assert.equal(inQuietRange(3, 22, 7), true);
  assert.equal(inQuietRange(7, 22, 7), false);
  assert.equal(inQuietRange(12, 22, 7), false);
});

test('an empty range silences nothing', () => {
  assert.equal(inQuietRange(5, 5, 5), false);
});

test('an unknown timezone reads as null rather than server time', () => {
  assert.equal(localHourFor('Not/AZone', new Date()), null);
  assert.equal(localHourFor(undefined, new Date()), null);
});

test('allowed in working hours under the ceiling', () => {
  const v = checkWindow({ account: acct(), repliesToday: 0, now: AT_NOON_MANILA });
  assert.equal(v.allowed, true);
  assert.equal(v.localHour, 12);
});

test('refused during quiet hours', () => {
  const v = checkWindow({ account: acct(), repliesToday: 0, now: AT_4AM_MANILA });
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'quiet-hours');
  assert.equal(v.localHour, 4);
});

test('refused at the daily ceiling', () => {
  const v = checkWindow({ account: acct({ dailyCeiling: 1 }), repliesToday: 1, now: AT_NOON_MANILA });
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'daily-ceiling');
});

test('an account ceiling cannot exceed the global maximum', () => {
  const v = checkWindow({ account: acct({ dailyCeiling: 99 }), repliesToday: 3, now: AT_NOON_MANILA });
  assert.equal(v.allowed, false, 'the global cap of 3 still applies');
  assert.equal(v.rule, 'daily-ceiling');
});

test('fails closed with no account', () => {
  const v = checkWindow({ account: null, repliesToday: 0, now: AT_NOON_MANILA });
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'no-account');
});

test('fails closed on an unreadable timezone', () => {
  const v = checkWindow({ account: acct({ timezone: 'Nowhere/Nothing' }), repliesToday: 0, now: AT_NOON_MANILA });
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'bad-timezone');
});

test('fails closed on a malformed quiet range', () => {
  const v = checkWindow({ account: acct({ quietHours: [0, 44] as [number, number] }), repliesToday: 0, now: AT_NOON_MANILA });
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'bad-quiet-range');
});

test('an account with no quiet hours is judged on the ceiling alone', () => {
  const v = checkWindow({ account: acct({ quietHours: undefined }), repliesToday: 0, now: AT_4AM_MANILA });
  assert.equal(v.allowed, true, '4am is fine if nobody declared quiet hours');
});
