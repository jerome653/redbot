/**
 * The exit posture is one fact with one implementation.
 *
 * The case that matters most is `unknown` vs `none`. Collapsing them is the defect this module
 * exists to prevent: "no proxy" over an account whose exit simply could not be read tells the
 * operator they are on their home connection, which may be false. Silence is the safe answer.
 *
 * The second case that matters is `changed`. A relay answering from an address that is not the
 * vetted one must never render as green, because green is the thing the operator scans for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exitPosture, placeOf, exitBadge, EXIT_STATES } from './exit-posture.mjs';

const vetted = {
  handle: 'docs-architect', enabled: true, host: '191.96.254.138', port: 6185, label: null,
  pinnedExitIp: '191.96.254.138', country: 'US', region: 'Los Angeles',
  asn: 'AS55286', rdns: null, vettedAt: '2026-08-11T04:05:00.000Z', relayPort: 39001
};
const upRelay = { handle: 'docs-architect', port: 39001, running: true, requests: 4, lastError: null,
  exitIp: '191.96.254.138', matchedPin: true, checkedAt: '2026-08-11T04:06:00.000Z',
  startedAt: '2026-08-11T04:05:30.000Z' };

test('an unreadable exit says nothing — it must not read as "no proxy"', () => {
  const p = exitPosture(undefined, null, { browserUp: true });
  assert.equal(p.state, 'unknown');
  assert.notEqual(p.state, 'none', 'unknown collapsing into none is the wrong reassurance');
  assert.equal(p.tag, 'no', 'an unknown exit is never green');
  assert.equal(p.ip, null);
});

test('no exit configured is stated plainly, and is not green', () => {
  assert.equal(exitPosture(null, null, {}).state, 'none');
  assert.equal(exitPosture(null, null, {}).tag, 'no');
  // A configured-but-disabled row is the same claim: traffic is not going through it.
  assert.equal(exitPosture({ ...vetted, enabled: false }, upRelay, {}).state, 'none');
});

test('a configured address that never passed the check is a warning, not success', () => {
  const p = exitPosture({ ...vetted, pinnedExitIp: null, vettedAt: null }, null, {});
  assert.equal(p.state, 'unvetted');
  assert.equal(p.tag, 'no');
  assert.equal(p.ip, null, 'an unproven address must not be published as the exit');
  assert.match(p.detail, /Los Angeles/, 'where it claims to be is still worth showing');
});

test('vetted with no relay is "ready", and says so in future tense', () => {
  const p = exitPosture(vetted, null, { browserUp: false });
  assert.equal(p.state, 'ready');
  assert.equal(p.tag, 'ok');
  assert.match(p.detail, /^Will exit from/, 'a plan must not be phrased as a fact');
});

test('vetted, relay up, address matches — live and green, carrying the location', () => {
  const p = exitPosture(vetted, upRelay, { browserUp: true });
  assert.equal(p.state, 'live');
  assert.equal(p.tag, 'ok');
  assert.equal(p.place, 'Los Angeles, US');
  assert.equal(p.ip, '191.96.254.138');
  assert.equal(exitBadge(p), 'Los Angeles, US · 191.96.254.138');
});

test('a relay answering from a DIFFERENT address is never green', () => {
  const drifted = { ...upRelay, exitIp: '203.0.113.9', matchedPin: false };
  const p = exitPosture(vetted, drifted, { browserUp: true });
  assert.equal(p.state, 'changed');
  assert.equal(p.tag, 'no', 'drift rendered green would defeat the whole indicator');
  assert.equal(p.ip, '203.0.113.9', 'the address actually in use is the one to show');
  assert.match(p.detail, /not the vetted 191\.96\.254\.138/);
});

test('browser open with its relay down is "stranded", and says nothing leaks', () => {
  const p = exitPosture(vetted, null, { browserUp: true });
  assert.equal(p.state, 'stranded');
  assert.equal(p.tag, 'no');
  assert.match(p.detail, /Nothing leaks/);
});

test('every returned state is one of the declared states', () => {
  const cases = [
    exitPosture(undefined, null, {}), exitPosture(null, null, {}),
    exitPosture({ ...vetted, pinnedExitIp: null, vettedAt: null }, null, {}),
    exitPosture(vetted, null, { browserUp: false }),
    exitPosture(vetted, upRelay, { browserUp: true }),
    exitPosture(vetted, { ...upRelay, exitIp: '203.0.113.9', matchedPin: false }, {}),
    exitPosture(vetted, null, { browserUp: true })
  ];
  for (const c of cases) assert.ok(EXIT_STATES.includes(c.state), `${c.state} is not declared`);
});

test('a place falls back to the label, and then to nothing — never to a guess', () => {
  assert.equal(placeOf({ region: 'Seattle', country: 'US' }), 'Seattle, US');
  assert.equal(placeOf({ region: null, country: 'US' }), 'US');
  assert.equal(placeOf({ region: null, country: null, label: 'rig-1' }), 'rig-1');
  assert.equal(placeOf({ region: null, country: null, label: '  ' }), null);
  assert.equal(placeOf(null), null);
});
