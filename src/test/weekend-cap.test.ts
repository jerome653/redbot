import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, type HealthCounters } from '../health.js';
import { checkWindow, dailyCeilingFor } from '../window.js';
import { checkWarmingPace } from '../warming.js';
import type { AccountRecord } from '../config.js';

/** 10:00 Manila (UTC+8) = 02:00 UTC. 2026-10-24 is a Saturday, 2026-10-26 a Monday. */
const SAT = new Date('2026-10-24T02:00:00Z');
const MON = new Date('2026-10-26T02:00:00Z');

const acct = (over: Partial<AccountRecord> = {}): AccountRecord => ({
  handle: 'tester', timezone: 'Asia/Manila', quietHours: [0, 8], dailyCeiling: 96, ...over
});

const counters = (over: Partial<HealthCounters> = {}): HealthCounters => ({
  account: 'tester', readsToday: 0, searchesToday: 0, repliesToday: 5,
  avgSessionMs: null, avgDwellMs: null, rateLimitHits24h: 0, loginFailures24h: 0,
  removalsObserved30d: 0, removalSubreddits30d: 0, absentSignedOut30d: 0, suspensionNotices: 0,
  accountAgeDays: 30, karma: 50, lastReplyAt: null, lastRateLimitAt: null,
  lastReadRateLimitAt: null, readRateLimits24h: 0, lastRemovalAt: null,
  fleetSize: 13, unattributedEvents24h: 0, ...over
});

test('dailyCeilingFor reflects the weekend multiplier (10 weekday, 20 weekend)', () => {
  // acct() pins dailyCeiling 96 so the GLOBAL cap binds and the weekend multiplier shows through.
  assert.equal(dailyCeilingFor(acct(), MON), 10, 'weekday cap 10');
  assert.equal(dailyCeilingFor(acct(), SAT), 20, 'weekend cap 20');
});

test('checkWindow: the 11th reply (repliesToday=10) is refused on a weekday, allowed on a weekend', () => {
  const weekday = checkWindow({ account: acct(), repliesToday: 10, now: MON });
  assert.equal(weekday.allowed, false, 'weekday refused');
  assert.equal(weekday.rule, 'daily-ceiling');
  const weekend = checkWindow({ account: acct(), repliesToday: 10, now: SAT });
  assert.equal(weekend.allowed, true, weekend.detail);
});

test('health.assess: at the weekday ceiling blocks, one-below the weekend ceiling is a caution', () => {
  // 19 replies: at or above the weekday ceiling of 10 (blocks), and exactly one below the weekend
  // ceiling of 20 (caution, still publishes).
  const weekday = assess(counters({ repliesToday: 19 }), MON);
  assert.equal(weekday.mayPublish, false, 'weekday blocks');
  assert.match(weekday.reasons.join('\n'), /daily ceiling is 10/, 'weekday ceiling reads 10');
  const weekend = assess(counters({ repliesToday: 19 }), SAT);
  assert.equal(weekend.mayPublish, true, 'weekend publishes');
  assert.match(weekend.reasons.join('\n'), /one below the daily ceiling/, 'weekend caution at 19 of 20');
});

test('checkWarmingPace: 10 published trips the daily ceiling on a weekday, not on a weekend', () => {
  const weekday = checkWarmingPace({ publishedToday: 10, minutesSinceLast: 600, karma: 50, now: MON });
  assert.ok(weekday.issues.some((i) => i.rule === 'daily-ceiling'), 'weekday ceiling issue');
  const weekend = checkWarmingPace({ publishedToday: 10, minutesSinceLast: 600, karma: 50, now: SAT });
  assert.ok(!weekend.issues.some((i) => i.rule === 'daily-ceiling'), 'no weekend ceiling issue');
});
