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
import { accountNeed, dailyTargetFor, ROTATION_DAILY_TARGET } from '../rotation-need.js';
import { dailyCeilingFor } from '../window.js';
import { policy } from '../policy.js';

/* 2026-10-22 20:00 Manila = 12:00Z = 05:00 Los Angeles (quiet 0-8); 02:00Z = 19:00 LA (awake). */
const QUIET_NOW = new Date('2026-10-22T12:00:00Z');
const AWAKE_NOW = new Date('2026-10-22T02:00:00Z');

const acct = (over: Partial<AccountRecord> = {}): AccountRecord => ({
  handle: 'a', timezone: 'America/Los_Angeles', quietHours: [0, 8], dailyCeiling: 10, ...over
});
const none = { repliesToday: 0, lastReplyAt: null };

test('the daily target is min(2, the ceiling checkWindow enforces)', () => {
  assert.equal(ROTATION_DAILY_TARGET, 2);
  assert.equal(dailyCeilingFor(acct({ dailyCeiling: 10 })), policy.maxRepliesPerDay.value, 'never above the global cap');
  assert.equal(dailyCeilingFor(acct({ dailyCeiling: 1 })), 1);
  assert.equal(dailyCeilingFor(acct({ dailyCeiling: undefined })), policy.maxRepliesPerDay.value);
  assert.equal(dailyTargetFor(acct({ dailyCeiling: 10 })), 2);
  assert.equal(dailyTargetFor(acct({ dailyCeiling: 1 })), 1);
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
  const n = accountNeed(acct(), { repliesToday: 2, lastReplyAt: '2026-10-21T20:00:00Z' }, AWAKE_NOW);
  assert.equal(n.due, false);
  assert.equal(n.rule, 'done-for-today');
  assert.equal(n.servedToday, 2);
  assert.equal(n.target, 2);

  const one = accountNeed(acct({ dailyCeiling: 1 }), { repliesToday: 1, lastReplyAt: '2026-10-21T20:00:00Z' }, AWAKE_NOW);
  assert.equal(one.due, false, 'a ceiling-1 account is done after one');
});

test('an account inside the spacing window is not due yet', () => {
  const last = new Date(AWAKE_NOW.getTime() - (policy.minMinutesBetweenReplies.value - 1) * 60_000).toISOString();
  const n = accountNeed(acct(), { repliesToday: 1, lastReplyAt: last }, AWAKE_NOW);
  assert.equal(n.due, false);
  assert.equal(n.rule, 'spacing');

  const ok = new Date(AWAKE_NOW.getTime() - policy.minMinutesBetweenReplies.value * 60_000).toISOString();
  assert.equal(accountNeed(acct(), { repliesToday: 1, lastReplyAt: ok }, AWAKE_NOW).due, true);
});

test('awake, under target, past spacing: due, with its count carried for least-served ordering', () => {
  const n = accountNeed(acct(), { repliesToday: 1, lastReplyAt: '2026-10-21T20:00:00Z' }, AWAKE_NOW);
  assert.equal(n.due, true);
  assert.equal(n.rule, 'due');
  assert.equal(n.servedToday, 1);
  assert.equal(n.handle, 'a');
});
