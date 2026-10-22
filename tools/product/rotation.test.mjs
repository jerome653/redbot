import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShift, onShift, nextHandle, orderByNeed, rotationTick, DEFAULT_SHIFT } from './rotation.mjs';

const shift = parseShift(DEFAULT_SHIFT);
// 2026-10-22 10:00 Manila = 02:00Z (on shift); 20:00 Manila = 12:00Z (off shift).
const ON = new Date('2026-10-22T02:00:00Z');
const OFF = new Date('2026-10-22T12:00:00Z');

/** A need row as src/rotation-need.ts fleetNeeds() returns it. */
const due = (handle, servedToday = 0) => ({ handle, due: true, rule: 'due', why: `${handle}: due`, servedToday, target: 2 });
const notDue = (handle, rule, servedToday = 0) => ({ handle, due: false, rule, why: `${handle}: ${rule}`, servedToday, target: 2 });

function deps(over = {}) {
  const calls = [];
  let last = over.lastStart ?? null;
  const d = {
    calls,
    now: () => OFF,
    shift,
    needs: async () => [due('a'), due('b'), due('c')],
    last: () => last,
    setLast: (h) => { last = h; calls.push(['setLast', h]); },
    browserState: async (h) => { calls.push(['state', h]); return 'free'; },
    openBrowser: async (h) => { calls.push(['open', h]); return { ok: true }; },
    runCycle: async (h) => { calls.push(['cycle', h]); return 0; },
    closeBrowser: async (h) => { calls.push(['close', h]); },
    log: () => {},
    ...over
  };
  return d;
}
const chromeCalls = (d) => d.calls.filter((c) => c[0] === 'open' || c[0] === 'state' || c[0] === 'cycle');
const withoutProbes = (d) => d.calls.filter((c) => c[0] !== 'state');

test('parseShift reads HH-HH@Zone and refuses anything else', () => {
  assert.deepEqual(parseShift('07-16@Asia/Manila'), { from: 7, to: 16, zone: 'Asia/Manila' });
  assert.equal(parseShift('7am-4pm'), null);
  assert.equal(parseShift('07-07@Asia/Manila'), null);
  assert.equal(parseShift('07-16@Not/AZone'), null);
});

test('onShift uses the shift zone, not the machine clock, and the end hour is exclusive', () => {
  assert.equal(onShift(shift, ON), true);
  assert.equal(onShift(shift, OFF), false);
  assert.equal(onShift(shift, new Date('2026-10-22T23:00:00Z')), true);   // 07:00 Manila
  assert.equal(onShift(shift, new Date('2026-10-22T08:00:00Z')), false);  // 16:00 Manila
  assert.equal(onShift(parseShift('22-06@UTC'), new Date('2026-10-22T03:00:00Z')), true);
});

test('nextHandle walks the list and wraps', () => {
  assert.equal(nextHandle(['a', 'b', 'c'], null), 'a');
  assert.equal(nextHandle(['a', 'b', 'c'], 'b'), 'c');
  assert.equal(nextHandle(['a', 'b', 'c'], 'c'), 'a');
  assert.equal(nextHandle(['a', 'b'], 'gone'), 'a');
  assert.equal(nextHandle([], 'a'), null);
});

test('orderByNeed: only due accounts, least-served first, ties by round robin after the last one', () => {
  const needs = [due('a', 1), due('b', 0), notDue('c', 'quiet-hours'), due('d', 0), due('e', 1)];
  assert.deepEqual(orderByNeed(needs, null).map((n) => n.handle), ['b', 'd', 'a', 'e']);
  assert.deepEqual(orderByNeed(needs, 'b').map((n) => n.handle), ['d', 'b', 'e', 'a']);
  assert.deepEqual(orderByNeed(needs, 'd').map((n) => n.handle), ['b', 'd', 'e', 'a']);
  assert.deepEqual(orderByNeed([notDue('a', 'done-for-today', 2)], null), []);
});

test('on shift the rotation still works the accounts the operator is not using', async () => {
  const d = deps({ now: () => ON });
  const r = await rotationTick(d);
  assert.equal(r.ran, true);
  assert.equal(r.handle, 'a');
});

test('on shift an account whose Chrome is already running is the operator\'s, and is skipped', async () => {
  const d = deps({ now: () => ON });
  d.browserState = async (h) => { d.calls.push(['state', h]); return h === 'a' ? 'running' : 'free'; };
  const r = await rotationTick(d);
  assert.equal(r.handle, 'b', 'the next due account is taken instead');
  assert.ok(!d.calls.some((c) => c[0] === 'cycle' && c[1] === 'a'), 'never a cycle in the operator\'s Chrome');
  assert.deepEqual(withoutProbes(d), [['setLast', 'b'], ['open', 'b'], ['cycle', 'b'], ['close', 'b']]);
});

test('on shift with every due account in the operator\'s hands, the tick does nothing', async () => {
  const d = deps({ now: () => ON, browserState: async () => 'running' });
  const r = await rotationTick(d);
  assert.equal(r.ran, false);
  assert.equal(r.why, 'none-available');
  assert.ok(!d.calls.some((c) => c[0] === 'cycle' || c[0] === 'open'));
});

test('off shift a Chrome that was already running is used and left open', async () => {
  const d = deps({ browserState: async () => 'running' });
  const r = await rotationTick(d);
  assert.equal(r.handle, 'a');
  assert.deepEqual(d.calls.map((c) => c[0]), ['setLast', 'cycle']);
});

test('accounts in their quiet hours are skipped without opening Chrome', async () => {
  const d = deps({ needs: async () => [notDue('a', 'quiet-hours'), notDue('b', 'quiet-hours'), notDue('c', 'quiet-hours')] });
  const r = await rotationTick(d);
  assert.equal(r.ran, false);
  assert.equal(r.why, 'nothing-due');
  assert.deepEqual(chromeCalls(d), [], 'no port probe, no Chrome, no cycle');
});

test('an account done for today is skipped and the others still get their turn', async () => {
  const d = deps({ needs: async () => [notDue('a', 'done-for-today', 2), due('b', 1)] });
  const r = await rotationTick(d);
  assert.equal(r.handle, 'b');
  assert.ok(!d.calls.some((c) => c[1] === 'a'));
});

test('an account inside its spacing window is skipped', async () => {
  const d = deps({ needs: async () => [notDue('a', 'spacing', 1), due('b', 1)] });
  assert.equal((await rotationTick(d)).handle, 'b');
  assert.ok(!d.calls.some((c) => c[1] === 'a'));
});

test('the least-served account goes first, whatever the round robin says', async () => {
  const d = deps({ lastStart: 'c', needs: async () => [due('a', 1), due('b', 1), due('c', 0)] });
  assert.equal((await rotationTick(d)).handle, 'c');
});

test('equal counts walk the round robin across ticks', async () => {
  const d = deps();
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push((await rotationTick(d)).handle);
  assert.deepEqual(seen, ['a', 'b', 'c', 'a']);
});

test('off shift: opens the account Chrome, runs one cycle as it, closes what it opened', async () => {
  const d = deps({ lastStart: 'a' });
  const r = await rotationTick(d);
  assert.equal(r.handle, 'b');
  assert.deepEqual(withoutProbes(d), [['setLast', 'b'], ['open', 'b'], ['cycle', 'b'], ['close', 'b']]);
});

test('a foreign port or a failed open skips that account and the next due one runs', async () => {
  const d = deps({ browserState: async (h) => (h === 'a' ? 'foreign' : 'free') });
  assert.equal((await rotationTick(d)).handle, 'b');

  const e = deps({ openBrowser: async (h) => (h === 'a' ? { ok: false, error: 'no chrome' } : { ok: true }) });
  assert.equal((await rotationTick(e)).handle, 'b');

  const f = deps({ openBrowser: async () => ({ ok: false, error: 'no chrome' }) });
  assert.equal((await rotationTick(f)).why, 'none-available');
});

test('the Chrome it opened is closed even when the cycle throws', async () => {
  const d = deps({ runCycle: async () => { throw new Error('boom'); } });
  await assert.rejects(rotationTick(d), /boom/);
  assert.deepEqual(d.calls.at(-1), ['close', 'a']);
});

test('an unreadable shift refuses to rotate', async () => {
  const d = deps({ shift: null });
  assert.equal((await rotationTick(d)).why, 'bad-shift');
  assert.deepEqual(d.calls, []);
});

test('no accounts at all is said, not a crash', async () => {
  const d = deps({ needs: async () => [] });
  assert.equal((await rotationTick(d)).why, 'no-accounts');
});

test('loopHolds: a single-account loop holds its account; the rotation holds only the account of its current turn', async () => {
  const { loopHolds } = await import('./rotation.mjs');
  assert.equal(loopHolds(null, 'a'), false);
  assert.equal(loopHolds({ account: 'a' }, 'a'), true);
  assert.equal(loopHolds({ account: 'a' }, 'b'), false);
  assert.equal(loopHolds({ account: '*', rotate: true, turnAccount: null }, 'a'), false, 'between turns every account is free');
  assert.equal(loopHolds({ account: '*', rotate: true, turnAccount: 'a' }, 'a'), true, 'a button must not drive the Chrome a turn is using');
  assert.equal(loopHolds({ account: '*', rotate: true, turnAccount: 'a' }, 'b'), false);
});

test('the account is held from before its browser is checked until after its Chrome is closed', async () => {
  const d = deps();
  d.hold = (h) => d.calls.push(['hold', h]);
  d.release = (h) => d.calls.push(['release', h]);
  await rotationTick(d);
  const seq = d.calls.map((c) => c[0]);
  assert.deepEqual(seq.filter((k) => k !== 'setLast'), ['hold', 'state', 'open', 'cycle', 'close', 'release']);
});

test('a skipped account is released again, and the next one is held in its place', async () => {
  const d = deps({ browserState: async (h) => (h === 'a' ? 'foreign' : 'free') });
  d.hold = (h) => d.calls.push(['hold', h]);
  d.release = (h) => d.calls.push(['release', h]);
  const r = await rotationTick(d);
  assert.equal(r.handle, 'b');
  assert.deepEqual(d.calls.filter((c) => c[0] === 'hold' || c[0] === 'release'),
    [['hold', 'a'], ['release', 'a'], ['hold', 'b'], ['release', 'b']]);
});

test('the hold is released even when the cycle throws', async () => {
  const d = deps({ runCycle: async () => { throw new Error('boom'); } });
  const held = [];
  d.hold = (h) => held.push(h);
  d.release = (h) => held.splice(held.indexOf(h), 1);
  await assert.rejects(rotationTick(d), /boom/);
  assert.deepEqual(held, []);
});

test('an account a console action is using is skipped — never opened, never cycled', async () => {
  const d = deps({ browserState: async (h) => (h === 'a' ? 'busy' : 'free') });
  const r = await rotationTick(d);
  assert.equal(r.handle, 'b');
  assert.equal(d.calls.some((c) => (c[0] === 'open' || c[0] === 'cycle') && c[1] === 'a'), false);
});
