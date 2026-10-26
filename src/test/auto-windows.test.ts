import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offWindowReason, DEFAULT_AUTO_WINDOWS, DEFAULT_AUTO_WINDOWS_WEEKEND } from '../auto-windows.js';

/** Manila is UTC+8: hour h in Manila on 2026-10-22 (a Thursday) is UTC h-8. */
const manila = (h: number) => new Date(Date.UTC(2026, 9, 22, h - 8));

test('the single-account loop runs from 17:00 Manila through to 05:00', () => {
  for (const h of [17, 18, 23, 24, 25, 28]) assert.equal(offWindowReason(manila(h), {}), null, `${h % 24}:00 Manila`);
});

test('the single-account loop rests through Clark\'s shift and the hour before it', () => {
  for (const h of [16, 29, 30, 34, 40]) {
    assert.match(offWindowReason(manila(h), {}) ?? '', /outside the auto windows/i, `${h % 24}:00 Manila`);
  }
});

test('REDBOT_AUTO_WINDOWS overrides the default', () => {
  assert.equal(offWindowReason(manila(10), { REDBOT_AUTO_WINDOWS: '09-11@Asia/Manila' }), null);
  assert.notEqual(offWindowReason(manila(20), { REDBOT_AUTO_WINDOWS: '09-11@Asia/Manila' }), null);
});

test('unreadable windows refuse to run, they never mean "any hour"', () => {
  assert.match(offWindowReason(manila(20), { REDBOT_AUTO_WINDOWS: '18-24' }) ?? '', /not "HH-HH,HH-HH@Zone"/);
  assert.match(offWindowReason(manila(20), { REDBOT_AUTO_WINDOWS: '18-24,x@Asia/Manila' }) ?? '', /not "HH-HH,HH-HH@Zone"/);
});

/* ---- weekends: Clark is away all weekend, so the window opens to a full 24h ---- */

/** A Manila hour on 2026-10-24 (a Saturday). */
const sat = (h: number) => new Date(Date.UTC(2026, 9, 24, h - 8));
/** A Manila hour on 2026-10-26 (a Monday). */
const mon = (h: number) => new Date(Date.UTC(2026, 9, 26, h - 8));

test('on a weekend the window is the full 24h — Saturday 10:00 Manila runs', () => {
  assert.equal(offWindowReason(sat(10), {}), null, 'Sat 10:00 Manila');
});

test('on a weekday the normal window still rests at 10:00 — Monday 10:00 Manila', () => {
  assert.match(offWindowReason(mon(10), {}) ?? '', /outside the auto windows/i, 'Mon 10:00 Manila');
});

test('the weekend default 00-24 is always-inside, every hour of the weekend day', () => {
  for (const h of [0, 1, 5, 10, 17, 23]) assert.equal(offWindowReason(sat(h), {}), null, `Sat ${h}:00 Manila`);
});

test('REDBOT_AUTO_WINDOWS_WEEKEND overrides the weekend default', () => {
  assert.equal(offWindowReason(sat(10), { REDBOT_AUTO_WINDOWS_WEEKEND: '09-11@Asia/Manila' }), null, 'inside override');
  assert.notEqual(offWindowReason(sat(20), { REDBOT_AUTO_WINDOWS_WEEKEND: '09-11@Asia/Manila' }), null, 'outside override');
});

test('the loop and the rotation share one weekday default and one weekend default', async () => {
  // @ts-ignore — plain .mjs module outside the tsc project
  const rotation = await import('../../tools/product/rotation.mjs');
  assert.equal(DEFAULT_AUTO_WINDOWS, rotation.DEFAULT_AUTO_WINDOWS);
  assert.equal(DEFAULT_AUTO_WINDOWS_WEEKEND, rotation.DEFAULT_AUTO_WINDOWS_WEEKEND);
});
