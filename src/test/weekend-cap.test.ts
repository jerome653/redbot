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
  removalsObserved30d: 0, absentSignedOut30d: 0, suspensionNotices: 0,
  accountAgeDays: 30, karma: 50, lastReplyAt: null, lastRateLimitAt: null,
  lastReadRateLimitAt: null, readRateLimits24h: 0, lastRemovalAt: null,
  fleetSize: 13, unattributedEvents24h: 0, ...over
});

test('dailyCeilingFor reflects the weekend multiplier (3 weekday, 6 weekend)', () => {
  assert.equal(dailyCeilingFor(acct(), MON), 3, 'weekday cap 3');
  assert.equal(dailyCeilingFor(acct(), SAT), 6, 'weekend cap 6');
});

test('checkWindow: a 6th reply (repliesToday=5) is refused on a weekday, allowed on a weekend', () => {
  const weekday = checkWindow({ account: acct(), repliesToday: 5, now: MON });
  assert.equal(weekday.allowed, false, 'weekday refused');
  assert.equal(weekday.rule, 'daily-ceiling');
  const weekend = checkWindow({ account: acct(), repliesToday: 5, now: SAT });
  assert.equal(weekend.allowed, true, weekend.detail);
});

test('health.assess: repliesToday=5 blocks on a weekday, is one-below-ceiling on a weekend', () => {
  const weekday = assess(counters(), MON);
  assert.equal(weekday.mayPublish, false, 'weekday blocks');
  assert.match(weekday.reasons.join('\n'), /daily ceiling is 3/, 'weekday ceiling reads 3');
  const weekend = assess(counters(), SAT);
  assert.equal(weekend.mayPublish, true, 'weekend publishes');
  assert.match(weekend.reasons.join('\n'), /one below the daily ceiling/, 'weekend caution at 5 of 6');
});

test('checkWarmingPace: 5 published trips the daily ceiling on a weekday, not on a weekend', () => {
  const weekday = checkWarmingPace({ publishedToday: 5, minutesSinceLast: 600, karma: 50, now: MON });
  assert.ok(weekday.issues.some((i) => i.rule === 'daily-ceiling'), 'weekday ceiling issue');
  const weekend = checkWarmingPace({ publishedToday: 5, minutesSinceLast: 600, karma: 50, now: SAT });
  assert.ok(!weekend.issues.some((i) => i.rule === 'daily-ceiling'), 'no weekend ceiling issue');
});
