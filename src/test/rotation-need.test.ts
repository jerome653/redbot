/**
 * Which account the rotation should work next — the "is this account due" half of
 * tools/product/rotation.mjs, decided from the same counters and the same ceiling math as
 * checkWindow, so the rotation can never think an account is due that the cycle would refuse on
 * quiet hours or ceiling.
 *
 * No database rows: counters are passed in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountRecord } from '../config.js';
import { accountNeed, dailyTargetFor } from '../rotation-need.js';
import { dailyCeilingFor } from '../window.js';
import { policy } from '../policy.js';

/* 2026-10-22 20:00 Manila = 12:00Z = 05:00 Los Angeles (quiet 0-8); 02:00Z = 19:00 LA (awake). */
const QUIET_NOW = new Date('2026-10-22T12:00:00Z');
const AWAKE_NOW = new Date('2026-10-22T02:00:00Z');            // a Thursday (weekday, cap 3)
/* Manila Saturday 10:00 = Los Angeles Friday 19:00 (awake): a weekend instant with the account awake. */
const WEEKEND_AWAKE = new Date('2026-10-24T02:00:00Z');

const acct = (over: Partial<AccountRecord> = {}): AccountRecord => ({
  handle: 'a', timezone: 'America/Los_Angeles', quietHours: [0, 8], dailyCeiling: 10, ...over
});
const none = { repliesToday: 0, lastReplyAt: null };

test('the daily target IS the ceiling checkWindow enforces — no lower rotation-only number', () => {
  // Weekday: the cap is 3, and the rotation works an account all the way up to it.
  assert.equal(dailyCeilingFor(acct({ dailyCeiling: 10 }), AWAKE_NOW), policy.maxRepliesPerDay.value, 'never above the weekday cap');
  assert.equal(dailyCeilingFor(acct({ dailyCeiling: 1 }), AWAKE_NOW), 1);
  assert.equal(dailyCeilingFor(acct({ dailyCeiling: undefined }), AWAKE_NOW), policy.maxRepliesPerDay.value);
  assert.equal(dailyTargetFor(acct({ dailyCeiling: 10 }), AWAKE_NOW), 3, 'weekday target is the cap of 3');
  assert.equal(dailyTargetFor(acct({ dailyCeiling: 1 }), AWAKE_NOW), 1);
  // Weekend: the cap is 6 and the target is all of it; a lower account cap still wins.
  assert.equal(dailyCeilingFor(acct({ dailyCeiling: 10 }), WEEKEND_AWAKE), 6, 'weekend cap');
  assert.equal(dailyTargetFor(acct({ dailyCeiling: 10 }), WEEKEND_AWAKE), 6, 'weekend target is the full weekend cap');
  assert.equal(dailyTargetFor(acct({ dailyCeiling: 0 }), WEEKEND_AWAKE), 0, 'a benched account (ceiling 0) stays benched');
  assert.equal(dailyTargetFor(acct({ dailyCeiling: 1 }), WEEKEND_AWAKE), 1, 'a ceiling-1 account still targets 1');
});

test('an account in its quiet hours is not due', () => {
  const n = accountNeed(acct(), none, QUIET_NOW);
  assert.equal(n.due, false);
  assert.equal(n.rule, 'quiet-hours');
});

test('an unreadable timezone is not due (checkWindow fails closed, so does this)', () => {
  const n = accountNeed(acct({ timezone: 'Not/AZone' }), none, AWAKE_NOW);
  assert.equal(n.due, false);
  assert.equal(n.rule, 'bad-timezone');
});

test('an account that reached its target today is done for today', () => {
  // A weekend instant: the target is the full weekend cap of 6.
  const five = accountNeed(acct(), { repliesToday: 5, lastReplyAt: '2026-10-21T20:00:00Z' }, WEEKEND_AWAKE);
  assert.equal(five.due, true, 'under the weekend cap is still due — the old rotation target stopped at 2');
  const n = accountNeed(acct(), { repliesToday: 6, lastReplyAt: '2026-10-21T20:00:00Z' }, WEEKEND_AWAKE);
  assert.equal(n.due, false);
  assert.equal(n.servedToday, 6);
  assert.equal(n.target, 6);

  const one = accountNeed(acct({ dailyCeiling: 1 }), { repliesToday: 1, lastReplyAt: '2026-10-21T20:00:00Z' }, WEEKEND_AWAKE);
  assert.equal(one.due, false, 'a ceiling-1 account is done after one');
});

test('an account inside the spacing window is not due yet', () => {
  // Weekend instant: 1 reply is under the target of 6, so the spacing rule is what holds it, not the ceiling.
  const last = new Date(WEEKEND_AWAKE.getTime() - (policy.minMinutesBetweenReplies.value - 1) * 60_000).toISOString();
  const n = accountNeed(acct(), { repliesToday: 1, lastReplyAt: last }, WEEKEND_AWAKE);
  assert.equal(n.due, false);
  assert.equal(n.rule, 'spacing');

  const ok = new Date(WEEKEND_AWAKE.getTime() - policy.minMinutesBetweenReplies.value * 60_000).toISOString();
  assert.equal(accountNeed(acct(), { repliesToday: 1, lastReplyAt: ok }, WEEKEND_AWAKE).due, true);
});

test('awake, under target, past spacing: due, with its count carried for least-served ordering', () => {
  // Weekend instant: target 2, so a single reply is still under target and due.
  const n = accountNeed(acct(), { repliesToday: 1, lastReplyAt: '2026-10-21T20:00:00Z' }, WEEKEND_AWAKE);
  assert.equal(n.due, true);
  assert.equal(n.rule, 'due');
  assert.equal(n.servedToday, 1);
  assert.equal(n.handle, 'a');
});
