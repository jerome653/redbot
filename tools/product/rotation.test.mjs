import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShift, onShift, nextHandle, rotationTick, DEFAULT_SHIFT } from './rotation.mjs';

const shift = parseShift(DEFAULT_SHIFT);
// 2026-10-22 10:00 Manila = 02:00Z (on shift); 20:00 Manila = 12:00Z (off shift).
const ON = new Date('2026-10-22T02:00:00Z');
const OFF = new Date('2026-10-22T12:00:00Z');

function deps(over = {}) {
  const calls = [];
  let last = over.lastStart ?? null;
  const d = {
    calls,
    now: () => OFF,
    shift,
    handles: async () => ['a', 'b', 'c'],
    last: () => last,
    setLast: (h) => { last = h; calls.push(['setLast', h]); },
    browserState: async () => 'free',
    openBrowser: async (h) => { calls.push(['open', h]); return { ok: true }; },
    runCycle: async (h) => { calls.push(['cycle', h]); return 0; },
    closeBrowser: async (h) => { calls.push(['close', h]); },
    log: () => {},
    ...over
  };
  return d;
}

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

test('on shift it touches no account', async () => {
  const d = deps({ now: () => ON });
  const r = await rotationTick(d);
  assert.equal(r.why, 'on-shift');
  assert.deepEqual(d.calls, []);
});

test('off shift: opens the next account Chrome, runs one cycle as it, closes what it opened', async () => {
  const d = deps({ lastStart: 'a' });
  const r = await rotationTick(d);
  assert.equal(r.handle, 'b');
  assert.deepEqual(d.calls, [['setLast', 'b'], ['open', 'b'], ['cycle', 'b'], ['close', 'b']]);
});

test('every account gets a turn across consecutive ticks', async () => {
  const d = deps();
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push((await rotationTick(d)).handle);
  assert.deepEqual(seen, ['a', 'b', 'c', 'a']);
});

test('a Chrome that was already running is used and left open', async () => {
  const d = deps({ browserState: async () => 'running' });
  await rotationTick(d);
  assert.deepEqual(d.calls.map((c) => c[0]), ['setLast', 'cycle']);
});

test('a foreign port or a failed open skips that account but still advances', async () => {
  const d = deps({ browserState: async (h) => (h === 'a' ? 'foreign' : 'free') });
  assert.equal((await rotationTick(d)).why, 'port-foreign');
  assert.equal((await rotationTick(d)).handle, 'b');

  const e = deps({ openBrowser: async () => ({ ok: false, error: 'no chrome' }) });
  assert.equal((await rotationTick(e)).why, 'open-failed');
  assert.equal(e.last(), 'a');
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
