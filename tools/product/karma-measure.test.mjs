/**
 * The measurement that stopped depending on somebody else's browser.
 *
 * The case that matters most is the one that must NOT happen: opening Chrome on a port the
 * rotation is about to drive. On 2026-09-28 a probe against 9222 while reply() held the same
 * browser had to be killed to protect a publish in flight, and redbot-karma.timer's whole
 * 11:00 UTC choice exists to avoid repeating it. So the hold, the refusal while a tick is in
 * flight, and "close only what you opened" are each tested on their own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureKarma } from './karma-measure.mjs';
import { holdRegistry } from './rotation.mjs';

const FLEET = [
  { handle: 'jordangrowth', debugPort: 9222 },
  { handle: 'Big_Variation_8580', debugPort: 9223 }
];

/** A rig whose defaults are the ordinary case: nothing running, nothing busy, probe succeeds. */
function rig(over = {}) {
  const calls = { opened: [], closed: [], probed: [], held: [], released: [] };
  const holds = holdRegistry();
  const deps = {
    accounts: () => FLEET,
    browserState: async () => 'free',
    openBrowser: async (h) => { calls.opened.push(h); return { ok: true }; },
    closeBrowser: async (h) => { calls.closed.push(h); },
    probe: async (e) => { calls.probed.push(e); return 0; },
    busy: () => false,
    rotationLive: () => false,
    hold: (h) => { calls.held.push(h); return holds.hold(h); },
    release: (h, t) => { calls.released.push(h); holds.release(h, t); },
    log: () => {},
    ...over
  };
  return { deps, calls, holds };
}

test('with no browser open it opens one, measures it, and closes it again', async () => {
  const { deps, calls } = rig();
  const r = await measureKarma(deps);
  assert.deepEqual(r.measured, ['jordangrowth', 'Big_Variation_8580']);
  assert.equal(r.code, 0, 'a measurement that worked is not a failed unit');
  assert.deepEqual(calls.opened, ['jordangrowth', 'Big_Variation_8580']);
  assert.deepEqual(calls.closed, ['jordangrowth', 'Big_Variation_8580']);
  assert.deepEqual(calls.probed, ['http://127.0.0.1:9222', 'http://127.0.0.1:9223'],
    'each account is probed on ITS OWN port, not one pinned handle');
});

test('THE REGRESSION: the old probe exited 1 here, because nothing was already open', async () => {
  const { deps } = rig();
  const r = await measureKarma(deps);
  assert.equal(r.code, 0,
    '22 Oct: "no account\'s browser is running (13 with a debug port)" - exit 1 and a FAILED unit');
});

test('a browser that was ALREADY open is measured and left open', async () => {
  const { deps, calls } = rig({ browserState: async () => 'running' });
  const r = await measureKarma(deps);
  assert.deepEqual(r.measured, ['jordangrowth', 'Big_Variation_8580']);
  assert.deepEqual(calls.opened, [], 'it was already up');
  assert.deepEqual(calls.closed, [], 'an operator opened that window - closing it is not ours to do');
});

test('a tick in flight refuses the WHOLE run and touches no browser', async () => {
  const { deps, calls } = rig({ rotationLive: () => true });
  const r = await measureKarma(deps);
  assert.equal(r.code, 1);
  assert.deepEqual(r.measured, []);
  assert.deepEqual(calls.opened, [], 'rotationTick picks its account after it starts - there is nothing safe to open');
  assert.deepEqual(calls.held, []);
});

test('a busy account is SKIPPED, not failed, and is never opened', async () => {
  const { deps, calls } = rig({ busy: (h) => h === 'jordangrowth' });
  const r = await measureKarma(deps);
  assert.deepEqual(r.measured, ['Big_Variation_8580']);
  assert.deepEqual(r.skipped.map((s) => s.handle), ['jordangrowth']);
  assert.ok(!r.failed.includes('jordangrowth'), 'declining to drive a browser in use is the module working');
  assert.deepEqual(calls.opened, ['Big_Variation_8580']);
});

test('a foreign or unidentifiable port is never driven', async () => {
  for (const state of ['foreign', 'unknown']) {
    const { deps, calls } = rig({ browserState: async () => state });
    const r = await measureKarma(deps);
    assert.deepEqual(calls.opened, [], `${state}: that port is not ours`);
    assert.deepEqual(r.measured, []);
    assert.equal(r.code, 1);
    assert.deepEqual(r.skipped.map((s) => s.why), [`port is ${state}`, `port is ${state}`]);
  }
});

test('the hold is taken and released around every account, even when the probe throws', async () => {
  const { deps, calls, holds } = rig({ probe: async () => { throw new Error('CDP went away'); } });
  const r = await measureKarma(deps);
  assert.deepEqual(r.failed, ['jordangrowth', 'Big_Variation_8580']);
  assert.deepEqual(calls.held, ['jordangrowth', 'Big_Variation_8580']);
  assert.deepEqual(calls.released, ['jordangrowth', 'Big_Variation_8580']);
  assert.equal(holds.held(), null, 'a hold left behind locks that account out of every future turn');
});

test('a browser it opened is closed even when the probe throws', async () => {
  const { deps, calls } = rig({ probe: async () => { throw new Error('boom'); } });
  await measureKarma(deps);
  assert.deepEqual(calls.closed, ['jordangrowth', 'Big_Variation_8580'],
    'a leaked Chrome per failed run is how the fleet reached 39 processes and 3.6 GB');
});

test('the hold is released even when CLOSING throws', async () => {
  const { deps, holds } = rig({ closeBrowser: async () => { throw new Error('stop failed'); } });
  await measureKarma(deps);
  assert.equal(holds.held(), null);
});

test('an account that would not open is a failure, is not probed, and is not closed', async () => {
  const { deps, calls } = rig({
    openBrowser: async (h) => (h === 'jordangrowth' ? { ok: false, error: 'port busy' } : { ok: true })
  });
  const r = await measureKarma(deps);
  assert.deepEqual(r.failed, ['jordangrowth']);
  assert.deepEqual(r.measured, ['Big_Variation_8580']);
  assert.deepEqual(calls.probed, ['http://127.0.0.1:9223'], 'never probe a browser that did not open');
  assert.deepEqual(calls.closed, ['Big_Variation_8580'], 'never close what was never opened');
});

test('one account failing does not cost the others their measurement', async () => {
  const { deps } = rig({ probe: async (e) => (e.endsWith('9222') ? 1 : 0) });
  const r = await measureKarma(deps);
  assert.deepEqual(r.measured, ['Big_Variation_8580']);
  assert.deepEqual(r.failed, ['jordangrowth']);
  assert.equal(r.code, 1, 'a data point the operator expects is missing, and the unit has to say so');
});

test('`only` measures that one account and leaves the rest alone', async () => {
  const { deps, calls } = rig();
  const r = await measureKarma(deps, 'Big_Variation_8580');
  assert.deepEqual(r.measured, ['Big_Variation_8580']);
  assert.deepEqual(calls.opened, ['Big_Variation_8580']);
});

test('an unknown handle, or a fleet with no debug ports, is a refusal rather than a crash', async () => {
  const a = await measureKarma(rig().deps, 'nobody');
  assert.equal(a.code, 1);
  assert.deepEqual(a.measured, []);

  const b = await measureKarma(rig({ accounts: () => [{ handle: 'x' }] }).deps);
  assert.equal(b.code, 1, 'an account with no debugPort cannot be probed');
});

test('every account busy is exit 1 and no failures - nothing was measured and nothing broke', async () => {
  const { deps, calls } = rig({ busy: () => true });
  const r = await measureKarma(deps);
  assert.equal(r.code, 1);
  assert.deepEqual(r.failed, []);
  assert.equal(r.skipped.length, 2);
  assert.deepEqual(calls.opened, []);
});
