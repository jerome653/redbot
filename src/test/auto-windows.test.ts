import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offWindowReason, DEFAULT_AUTO_WINDOWS } from '../auto-windows.js';

/** Manila is UTC+8: hour h in Manila on 2026-10-22 is UTC h-8. */
const manila = (h: number) => new Date(Date.UTC(2026, 9, 22, h - 8));

test('the single-account loop runs inside 18:00-24:00 and 01:00-05:00 Manila', () => {
  for (const h of [18, 23, 25, 28]) assert.equal(offWindowReason(manila(h), {}), null, `${h % 24}:00 Manila`);
});

test('the single-account loop rests during and around Clark\'s shift, and from 00:00 to 01:00', () => {
  for (const h of [17, 24, 29, 30, 34, 40]) {
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

test('the loop and the rotation share one default', async () => {
  // @ts-ignore — plain .mjs module outside the tsc project
  const rotation = await import('../../tools/product/rotation.mjs');
  assert.equal(DEFAULT_AUTO_WINDOWS, rotation.DEFAULT_AUTO_WINDOWS);
});
