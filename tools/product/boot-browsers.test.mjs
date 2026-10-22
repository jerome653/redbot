/**
 * The one answer to "which browsers should be open", and the false alarm it exists to stop.
 *
 * MEASURED 2026-10-17: boot's default changed from "open all 13 bound accounts" to "open the one
 * the loop runs as" — which recovered 3.8 GB on an 11.9 GB machine — and `/api/pulse` immediately
 * reported twelve accounts as `browser is not open` with `healthy: false`, because only boot knew
 * about the change. Twelve deliberate states described as faults. The previous defect in that same
 * route was it answering `healthy: true` for eleven days, so a signal crying wolf is not an
 * improvement on one asleep.
 *
 * The last test is the important one: only the CLOSED finding is conditional. A squatted port, a
 * missing folder and a moved exit are faults whether or not anybody meant to open the browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootBrowserSelection, expectedOpen, DEFAULT_WANT, minimiseAtBoot, ROTATION } from './boot-browsers.mjs';
import { fleetProblems } from './fleet-posture.mjs';

const HANDLES = ['Alice', 'bob', 'CAROL'];

test('the default is the loop, and it is the one account', () => {
  assert.equal(DEFAULT_WANT, 'loop');
  const { expected, why } = bootBrowserSelection({ handles: HANDLES, loopAccount: 'bob' });
  assert.deepEqual([...expected], ['bob']);
  assert.match(why, /bob is the account the loop runs as/);
});

test('the handle is matched case-insensitively, both ways', () => {
  const { expected } = bootBrowserSelection({ handles: HANDLES, loopAccount: 'CAROL' });
  assert.ok(expectedOpen(expected, 'carol'));
  assert.ok(expectedOpen(expected, 'CAROL'));
  assert.equal(expectedOpen(expected, 'bob'), false);
});

test('no loop registered means NO RESTRICTION, not an empty selection', () => {
  const { expected, why } = bootBrowserSelection({ handles: HANDLES, loopAccount: null });
  assert.equal(expected, null,
    'null and an empty Set are different facts — one opens everything, the other nothing');
  assert.match(why, /no loop registered/);
  for (const h of HANDLES) assert.ok(expectedOpen(expected, h));
});

test('"all" restores the pre-change behaviour exactly', () => {
  const { expected, why } = bootBrowserSelection({ handles: HANDLES, want: 'all', loopAccount: 'bob' });
  assert.equal(expected, null, 'a loop account must not narrow it when "all" was asked for');
  assert.match(why, /REDBOT_BOOT_BROWSERS=all/);
});

test('an explicit list wins over the loop, and an unknown name selects nothing', () => {
  const named = bootBrowserSelection({ handles: HANDLES, want: 'alice, CAROL', loopAccount: 'bob' });
  assert.deepEqual([...named.expected].sort(), ['alice', 'carol']);
  assert.equal(expectedOpen(named.expected, 'bob'), false, 'an explicit list is not additive');

  const none = bootBrowserSelection({ handles: HANDLES, want: 'nobody' });
  assert.equal(none.expected.size, 1);
  for (const h of HANDLES) assert.equal(expectedOpen(none.expected, h), false);
});

test('an empty or missing want falls back to no restriction rather than to nothing', () => {
  for (const want of ['', '   ', undefined, null]) {
    const { expected } = bootBrowserSelection({ handles: HANDLES, want, loopAccount: null });
    assert.equal(expected, null, `want=${JSON.stringify(want)} must not select nothing`);
  }
});

test('an absent handle list does not throw', () => {
  assert.doesNotThrow(() => bootBrowserSelection({ handles: undefined, loopAccount: 'bob' }));
  assert.doesNotThrow(() => bootBrowserSelection({ handles: null }));
});

/* ------------------------------------------------------------------ *
 * what the pulse does with it
 * ------------------------------------------------------------------ */

const shut = (handle) => ({
  handle, port: 9222, state: 'closed', browserUp: false, profileOnDisk: true,
  exit: { state: 'none' }
});

test('a closed browser nobody asked to open is NOT a problem', () => {
  const { expected } = bootBrowserSelection({ handles: ['bob', 'alice'], loopAccount: 'bob' });
  const problems = fleetProblems([shut('bob'), shut('alice')], expected);
  assert.deepEqual(problems, ['bob: browser is not open'],
    'only the account that was supposed to be open may be reported');
});

test('with no selection every closed browser is still a problem — the old behaviour', () => {
  const problems = fleetProblems([shut('bob'), shut('alice')], null);
  assert.equal(problems.length, 2, 'an install with no loop must not go quiet about closed browsers');
});

test('the measured twelve-false-alarm case produces exactly one finding', () => {
  /* The real fleet: 13 bound accounts, the loop on jordangrowth, the other twelve closed. */
  const fleet = ['Big_Variation_8580', 'alexdigital10', 'colegrowth', 'dylanwebspace',
    'ethanwebspace14', 'evanwebtalk', 'janedigital12', 'jordangrowth', 'joshanweb',
    'kylegrowth', 'nathandigital7', 'noahwebtalk', 'ryangrowth12'];
  const { expected } = bootBrowserSelection({ handles: fleet, loopAccount: 'jordangrowth' });
  const rows = fleet.map((h) => (h === 'jordangrowth'
    ? { ...shut(h), browserUp: true, state: 'running' }
    : shut(h)));
  assert.deepEqual(fleetProblems(rows, expected), [],
    'twelve deliberately-closed browsers and one open one is a healthy install');
});

test('ONLY the closed finding is conditional — every other fault still reports', () => {
  const { expected } = bootBrowserSelection({ handles: ['bob', 'alice'], loopAccount: 'bob' });

  /* A port held by something else: how redbot came to drive Edge WebView2 on 9222. */
  const foreign = fleetProblems([{ ...shut('alice'), state: 'foreign' }], expected);
  assert.deepEqual(foreign, ['alice: port 9222 is held by something else']);

  /* Unidentifiable is also not a pass. */
  const unknown = fleetProblems([{ ...shut('alice'), state: 'unknown' }], expected);
  assert.match(unknown[0], /could not be identified/);

  /* A missing sign-in folder means it cannot be opened ON DEMAND either. */
  const noFolder = fleetProblems([{ ...shut('alice'), profileOnDisk: false }], expected);
  assert.deepEqual(noFolder, ['alice: its browser folder is missing']);

  /* An exit that moved is a fact about identity, not about a window. */
  const moved = fleetProblems(
    [{ ...shut('alice'), exit: { state: 'changed', detail: 'now 1.2.3.4' } }], expected);
  assert.equal(moved.length, 1);
  assert.match(moved[0], /exit CHANGED/);
});

test('an empty fleet is still the finding it always was', () => {
  const { expected } = bootBrowserSelection({ handles: [], loopAccount: 'bob' });
  assert.match(fleetProblems([], expected)[0], /no account is configured/);
});

test('boot leaves the loop account\'s browser un-minimised and minimises every other one', () => {
  assert.equal(minimiseAtBoot('jordangrowth', 'jordangrowth'), false, 'a minimised window takes no scroll');
  assert.equal(minimiseAtBoot('JordanGrowth', 'jordangrowth'), false, 'matched case-insensitively');
  assert.equal(minimiseAtBoot('ryangrowth12', 'jordangrowth'), true);
  assert.equal(minimiseAtBoot('ryangrowth12', null), true, 'no loop registered: every boot window is minimised, as before');
});

/* ------------------------------------------------------------------ *
 * the rotation sentinel — MEASURED on cardinal 2026-10-22
 *
 * push-state.json carried `autoLoop.account: "*"`, the sentinel server.mjs reads as
 * "rotate across every account". This module knew only literal handles, so it answered
 * Set(["*"]) and the boot log said `opening 1 of 13 — * is the account the loop runs as`
 * followed by all thirteen `not opened at boot`. Zero browsers. redbot-karma.service then
 * failed at 11:00 UTC: `no account's browser is running (13 with a debug port)`.
 * ------------------------------------------------------------------ */

test('the rotation sentinel selects NOTHING, not an account named "*"', () => {
  const fleet = ['Big_Variation_8580', 'jordangrowth', 'ryangrowth12'];
  const { expected, why } = bootBrowserSelection({ handles: fleet, loopAccount: ROTATION });
  assert.ok(expected instanceof Set, 'a rotation is a selection, not an absent one');
  assert.equal(expected.size, 0,
    'Set(["*"]) is what opened zero of thirteen while the log claimed "opening 1 of 13"');
  assert.match(why, /rotation opens each account for its own turn/);
  for (const h of fleet) assert.equal(expectedOpen(expected, h), false);
});

test('under the rotation a closed browser is NOT a fault — null here would be thirteen false alarms', () => {
  const fleet = ['bob', 'alice', 'carol'];
  const { expected } = bootBrowserSelection({ handles: fleet, loopAccount: ROTATION });
  assert.notEqual(expected, null,
    'null means every account is expected open — the cry-wolf case this module exists to stop');
  assert.deepEqual(fleetProblems(fleet.map(shut), expected), []);
});

test('a squatted port or a missing folder is still a fault under the rotation', () => {
  const { expected } = bootBrowserSelection({ handles: ['bob', 'alice'], loopAccount: ROTATION });
  assert.deepEqual(fleetProblems([{ ...shut('alice'), state: 'foreign' }], expected),
    ['alice: port 9222 is held by something else']);
  assert.deepEqual(fleetProblems([{ ...shut('alice'), profileOnDisk: false }], expected),
    ['alice: its browser folder is missing']);
});

test('"all" and an explicit list still win over the rotation sentinel', () => {
  assert.equal(
    bootBrowserSelection({ handles: ['bob'], want: 'all', loopAccount: ROTATION }).expected, null);
  const named = bootBrowserSelection({ handles: ['bob', 'alice'], want: 'bob', loopAccount: ROTATION });
  assert.deepEqual([...named.expected], ['bob']);
});

test('the rotation has no permanent window, so every boot window is minimised', () => {
  assert.equal(minimiseAtBoot('jordangrowth', ROTATION), true);
  assert.equal(minimiseAtBoot('*', ROTATION), true, 'there is no account named "*" to except');
});
