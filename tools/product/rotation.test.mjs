import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseShift, onShift, nextHandle, orderByNeed, rotationTick, holdRegistry, DEFAULT_SHIFT,
  parseWindows, inWindows, DEFAULT_AUTO_WINDOWS, DEFAULT_AUTO_WINDOWS_WEEKEND, isWeekend,
  tickSummary, tickLedger, runRotationLoop, turnCounter
} from './rotation.mjs';

const shift = parseShift(DEFAULT_SHIFT);
// 2026-10-22 10:00 Manila = 02:00Z (on shift); 20:00 Manila = 12:00Z (off shift, inside an auto window).
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
  assert.equal(onShift(shift, new Date('2026-10-22T22:00:00Z')), true);   // 06:00 Manila
  assert.equal(onShift(shift, new Date('2026-10-22T09:00:00Z')), false);  // 17:00 Manila
  assert.equal(onShift(parseShift('22-06@UTC'), new Date('2026-10-22T03:00:00Z')), true);
});

test('the default shift is Clark\'s, 06:00 to 17:00 Manila', () => {
  assert.deepEqual(shift, { from: 6, to: 17, zone: 'Asia/Manila' });
});

test('parseWindows reads "HH-HH,HH-HH@Zone" and refuses anything unreadable', () => {
  assert.deepEqual(parseWindows(DEFAULT_AUTO_WINDOWS), [
    { from: 17, to: 24, zone: 'Asia/Manila' }, { from: 0, to: 5, zone: 'Asia/Manila' }
  ]);
  assert.deepEqual(parseWindows('22-06@UTC'), [{ from: 22, to: 6, zone: 'UTC' }]);
  assert.equal(parseWindows('18-24,1-5'), null);
  assert.equal(parseWindows('18-24,xx@Asia/Manila'), null);
  assert.equal(parseWindows('18-24,@Asia/Manila'), null);
  assert.equal(parseWindows(''), null);
});

test('inWindows: 17:00-24:00 and 00:00-05:00 Manila, end hours exclusive', () => {
  const w = parseWindows(DEFAULT_AUTO_WINDOWS);
  const at = (manilaHour) => new Date(Date.UTC(2026, 9, 22, manilaHour - 8));
  for (const h of [17, 18, 20, 23, 24, 25, 27, 28]) assert.equal(inWindows(w, at(h)), true, `${h % 24}:00 Manila`);
  for (const h of [16, 29, 30, 30 + 4, 30 + 10]) assert.equal(inWindows(w, at(h)), false, `${h % 24}:00 Manila`);
});

test('outside the auto windows the tick rests: no needs read, no Chrome', async () => {
  const lines = [];
  const d = deps({ windows: parseWindows(DEFAULT_AUTO_WINDOWS), now: () => ON, log: (l) => lines.push(l),
    needs: async () => { d.calls.push(['needs']); return [due('a')]; } });
  const r = await rotationTick(d);
  assert.equal(r.ran, false);
  assert.equal(r.why, 'off-window');
  assert.deepEqual(d.calls, []);
  assert.match(lines.join('\n'), /outside the auto windows/i);
});

test('inside the auto windows the tick works as before', async () => {
  const d = deps({ windows: parseWindows(DEFAULT_AUTO_WINDOWS), now: () => OFF });
  assert.equal((await rotationTick(d)).ran, true);
});

test('unreadable auto windows refuse to rotate', async () => {
  const d = deps({ windows: null });
  assert.equal((await rotationTick(d)).why, 'bad-windows');
  assert.deepEqual(d.calls, []);
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

test('orderByNeed: TURNS today come first — an account whose turns never publish cannot win every tick (25 Oct)', () => {
  const needs = [due('ryan', 0), due('a', 1), due('b', 1)];
  assert.deepEqual(orderByNeed(needs, null).map((n) => n.handle), ['ryan', 'a', 'b'], 'without turns: least-served, as before');
  const turns = new Map([['ryan', 34], ['a', 1], ['b', 1]]);
  assert.deepEqual(orderByNeed(needs, null, turns).map((n) => n.handle), ['a', 'b', 'ryan']);
  assert.deepEqual(orderByNeed([due('a', 0), due('b', 2)], null, new Map([['b', 2]])).map((n) => n.handle), ['a', 'b'], 'no turns yet goes first');
});

test('the tick notes the turn it commits to, and the next tick moves on even though nothing published', async () => {
  const tc = turnCounter('Asia/Manila', () => ON);
  const d = deps({ needs: async () => [due('a', 0), due('b', 0), due('c', 0)] });
  d.turns = () => tc.get(); d.noteTurn = (h) => tc.note(h);
  d.last = () => null;   // round robin pinned, so only the turn count can move the choice
  const seen = [];
  for (let i = 0; i < 3; i++) seen.push((await rotationTick(d)).handle);
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.equal(tc.get().get('a'), 1);
});

test('turnCounter resets at the Manila day boundary', () => {
  let t = new Date('2026-10-28T15:59:00Z');   // 23:59 Manila
  const tc = turnCounter('Asia/Manila', () => t);
  tc.note('a'); tc.note('a');
  assert.equal(tc.get().get('a'), 2);
  t = new Date('2026-10-28T16:00:00Z');       // 00:00 Manila, next day
  assert.equal(tc.get().get('a'), undefined);
});

test('server.mjs feeds the turn counter to the rotation', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(src, /const rotationTurns = turnCounter\(\);/);
  assert.match(src, /turns: \(\) => rotationTurns\.get\(\),/);
  assert.match(src, /noteTurn: \(h\) => rotationTurns\.note\(h\),/);
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

/** hold/release recorded as calls, so a test can see what the buttons would have been refused. */
const guarded = (over = {}) => {
  let held = null;
  const d = deps({
    hold: (h) => { held = h; d.calls.push(['hold', h]); },
    release: (h) => { if (held === h) held = null; d.calls.push(['release', h]); },
    ...over
  });
  d.held = () => held;
  return d;
};

test('the account is held from before its port is probed until after its Chrome is closed', async () => {
  const d = guarded({ runCycle: async (h) => { d.calls.push(['cycle', h, d.held()]); return 0; } });
  await rotationTick(d);
  assert.deepEqual(d.calls, [['hold', 'a'], ['state', 'a'], ['setLast', 'a'], ['open', 'a'], ['cycle', 'a', 'a'], ['close', 'a'], ['release', 'a']]);
  assert.equal(d.held(), null);
});

test('Stop pressed while Chrome is opening: no cycle runs, what it opened is closed, the hold is released', async () => {
  let alive = true;
  const d = guarded({
    openBrowser: async (h) => { d.calls.push(['open', h]); alive = false; return { ok: true }; },
    alive: () => alive
  });
  const r = await rotationTick(d);
  assert.equal(r.why, 'stopped');
  assert.equal(d.calls.some((c) => c[0] === 'cycle'), false);
  assert.deepEqual(withoutProbes(d).slice(-2), [['close', 'a'], ['release', 'a']]);
  assert.equal(d.held(), null);
});

test('a failed open releases its hold and the next due account runs', async () => {
  const d = guarded({ openBrowser: async (h) => { d.calls.push(['open', h]); return h === 'a' ? { ok: false, error: 'no chrome' } : { ok: true }; } });
  const r = await rotationTick(d);
  assert.equal(r.handle, 'b');
  const w = withoutProbes(d);
  assert.deepEqual(w.slice(0, 4), [['hold', 'a'], ['setLast', 'a'], ['open', 'a'], ['release', 'a']]);
  assert.equal(w.some((c) => c[0] === 'close' && c[1] === 'a'), false);
  assert.equal(d.held(), null);
});

test('the hold is released even when the cycle throws', async () => {
  const d = guarded({ runCycle: async () => { throw new Error('boom'); } });
  await assert.rejects(rotationTick(d), /boom/);
  assert.equal(d.held(), null);
  assert.deepEqual(d.calls.at(-1), ['release', 'a']);
});

test('an account a console button is driving is skipped without probing its port', async () => {
  const d = guarded({ busy: (h) => h === 'a' });
  const r = await rotationTick(d);
  assert.equal(r.handle, 'b');
  assert.equal(d.calls.some((c) => c[1] === 'a'), false);
});

test('holdRegistry: a late release from an older turn cannot clear a newer turn hold', () => {
  const r = holdRegistry();
  const t1 = r.hold('x');
  const t2 = r.hold('x');
  r.release('x', t1);
  assert.equal(r.holds('x'), true, 'the old turn release must not clear the new turn hold');
  r.release('x', t2);
  assert.equal(r.holds('x'), false);
  assert.equal(r.live, false);
  r.live = true; assert.equal(r.live, true);
});

test('server.mjs wires the guard: button checks ask loopHolds, Start waits for a live turn, the rotation passes busy/hold/release/alive', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.equal((src.match(/loopHolds\(account\)/g) || []).length, 2);
  assert.match(src, /const rotationHolds = holdRegistry\(\)/);
  assert.match(src, /if \(rotationHolds\.live\) return \{ ok: false/);
  assert.match(src, /rotationHolds\.live = true;\s+try \{ return await rotationTick\(\{ \.\.\.deps, alive: current \}\); \}/);
  assert.match(src, /finally \{ rotationHolds\.live = false; \}/);
  assert.match(src, /busy: \(h\) => /);
  assert.match(src, /hold: rotationHolds\.hold,/);
  assert.match(src, /release: rotationHolds\.release,/);
  assert.match(src, /alive: \(\) => autoProc === me/);
});

/* ---- weekends: Clark is away, the window opens to a full 24h (the LIVE service path) ---- */

const SAT_1000 = new Date('2026-10-24T02:00:00Z'); // Saturday 10:00 Manila
const MON_1000 = new Date('2026-10-26T02:00:00Z'); // Monday 10:00 Manila

test('isWeekend is Sat/Sun in Asia/Manila and fails closed to false on a bad zone', () => {
  assert.equal(isWeekend(SAT_1000), true);
  assert.equal(isWeekend(MON_1000), false);
  assert.equal(isWeekend(SAT_1000, 'Nowhere/Nothing'), false);
});

test('inWindows: the weekend default 00-24 covers every hour of the day', () => {
  const we = parseWindows(DEFAULT_AUTO_WINDOWS_WEEKEND);
  const at = (manilaHour) => new Date(Date.UTC(2026, 9, 24, manilaHour - 8));
  for (const h of [0, 1, 5, 10, 17, 23]) assert.equal(inWindows(we, at(h)), true, `Sat ${h}:00 Manila`);
});

test('on a weekend the rotation runs at 10:00 (full-24h window); on a weekday 10:00 it rests', async () => {
  const wd = parseWindows(DEFAULT_AUTO_WINDOWS);
  const we = parseWindows(DEFAULT_AUTO_WINDOWS_WEEKEND);
  const sat = deps({ windows: wd, weekendWindows: we, now: () => SAT_1000 });
  assert.equal((await rotationTick(sat)).ran, true, 'Saturday 10:00 runs');
  const mon = deps({ windows: wd, weekendWindows: we, now: () => MON_1000 });
  const r = await rotationTick(mon);
  assert.equal(r.ran, false, 'Monday 10:00 rests');
  assert.equal(r.why, 'off-window');
});

/* ---- the tick ledger and the watchdog (2026-10-25: 8 h with no turn, and no record of why) ---- */

test('nothing-due carries its tally, none-available names why each due account was skipped', async () => {
  const nd = await rotationTick(deps({ needs: async () => [notDue('a', 'quiet-hours'), notDue('b', 'quiet-hours')] }));
  assert.equal(nd.why, 'nothing-due');
  assert.equal(nd.tally, '2 quiet-hours');
  const na = await rotationTick(deps({ busy: (h) => h === 'a',
    browserState: async () => 'foreign', needs: async () => [due('a'), due('b')] }));
  assert.equal(na.why, 'none-available');
  assert.deepEqual(na.skipped, [{ handle: 'a', why: 'busy' }, { handle: 'b', why: 'foreign' }]);
});

test('tickSummary says what the tick decided in one readable line', () => {
  assert.match(tickSummary({ ran: false, why: 'nothing-due', tally: '3 quiet-hours' }), /nothing due \(3 quiet-hours\)/i);
  assert.match(tickSummary({ ran: true, handle: 'a', code: 0 }), /a ran.*exit 0/);
  assert.match(tickSummary({ ran: false, why: 'none-available', skipped: [{ handle: 'a', why: 'busy' }] }), /a: busy/);
  assert.match(tickSummary({ ran: false, why: 'error', error: 'boom' }), /boom/);
});

test('tickLedger writes when the outcome changes, and otherwise at most an hourly heartbeat', () => {
  const rows = [];
  const l = tickLedger({ write: (r) => rows.push(r), heartbeatMs: 3_600_000 });
  const t0 = Date.parse('2026-10-25T07:00:00Z');
  const nd = { ran: false, why: 'nothing-due', tally: '13 quiet-hours' };
  l.note(nd, t0);
  for (let i = 1; i <= 5; i++) l.note(nd, t0 + i * 600_000);      // 50 min resting: no new row
  assert.equal(rows.length, 1);
  l.note({ ...nd, tally: '12 quiet-hours' }, t0 + 3_000_000);       // tally drift alone is not a change
  assert.equal(rows.length, 1);
  l.note(nd, t0 + 3_600_000);                                        // an hour on: heartbeat
  assert.equal(rows.length, 2);
  assert.equal(rows[1].heartbeat, true);
  l.note({ ran: true, handle: 'a', code: 0 }, t0 + 3_700_000);       // a change: written at once
  l.note({ ran: true, handle: 'b', code: 0 }, t0 + 4_300_000);       // another account is another outcome
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.why), ['nothing-due', 'nothing-due', 'ran', 'ran']);
  assert.equal(rows[3].handle, 'b');
  assert.equal(l.last().why, 'ran');
  assert.match(l.last().at, /^2026-10-25T/);
});

/** A hand-cranked clock: sleeps and the watchdog interval advance only when the test says so. */
function clock() {
  let t = 0; const sleeps = []; let watch = null;
  const flush = () => new Promise((r) => setImmediate(r));
  return {
    now: () => t,
    sleep: (ms) => new Promise((r) => sleeps.push({ at: t + ms, r })),
    every: (fn) => { watch = fn; return 1; },
    stopEvery: () => { watch = null; },
    async advance(ms) {
      t += ms;
      const due = sleeps.filter((s) => s.at <= t);
      for (const s of due) { sleeps.splice(sleeps.indexOf(s), 1); s.r(); }
      await flush();
      if (watch) watch();
      await flush();
    }
  };
}

test('a tick that throws is recorded as an error and the loop carries on', async () => {
  const c = clock(); const results = []; let n = 0;
  runRotationLoop({ ...c, gapMs: 600_000, stallMs: 1_800_000, alive: () => n < 3,
    tick: async () => { n++; if (n === 1) throw new Error('db locked'); return { ran: false, why: 'nothing-due' }; },
    onResult: (r) => results.push(r), onStall: () => {}, killChild: () => false });
  await c.advance(0); await c.advance(600_000); await c.advance(600_000);
  assert.equal(results[0].why, 'error');
  assert.match(results[0].error, /db locked/);
  assert.equal(results[1].why, 'nothing-due');
});

test('watchdog: a tick stuck outside any child is reported on every stall and NEVER replaced by a second runner', async () => {
  const c = clock(); const stalls = []; let calls = 0;
  runRotationLoop({ ...c, gapMs: 600_000, stallMs: 1_800_000, alive: () => true,
    tick: async () => { calls++; await new Promise(() => {}); },   // never resolves
    onResult: () => {}, onStall: (ms, killed) => stalls.push(killed), killChild: () => false });
  await c.advance(0);
  await c.advance(1_200_000);
  assert.equal(stalls.length, 0, '20 min is not a stall at 30 min');
  await c.advance(700_000);
  assert.deepEqual(stalls, [false], 'past 30 min the stall is reported');
  await c.advance(1_900_000);
  assert.deepEqual(stalls, [false, false], 'and reported again a stall period later');
  assert.equal(calls, 1, 'no second runner: a stuck runner beside a new one could close the Chrome of the new cycle');
});

test('watchdog: strikes count consecutive stalls on one tick, so the server can escalate to SIGKILL; a finished tick resets them', async () => {
  const c = clock(); const strikes = []; let calls = 0; let release;
  runRotationLoop({ ...c, gapMs: 600_000, stallMs: 1_800_000, alive: () => true,
    tick: async () => { calls++; if (calls === 1) await new Promise((r) => { release = r; }); else await new Promise(() => {}); return { ran: true, handle: 'a', code: 1 }; },
    onResult: () => {}, onStall: () => {}, killChild: (n) => { strikes.push(n); return true; } });
  await c.advance(0);
  await c.advance(1_900_000);
  await c.advance(1_900_000);
  assert.deepEqual(strikes, [1, 2], 'a child that ignored the first signal is struck again, harder');
  release(); await c.advance(0); await c.advance(600_000);
  await c.advance(1_900_000);
  assert.deepEqual(strikes, [1, 2, 1], 'a new tick starts its strikes from 1');
});

test('watchdog: a hung cycle child is killed and the same runner carries on, no second runner', async () => {
  const c = clock(); let calls = 0; let release; let kills = 0;
  runRotationLoop({ ...c, gapMs: 600_000, stallMs: 1_800_000, alive: () => true,
    tick: async () => { calls++; if (calls === 1) await new Promise((r) => { release = r; }); return { ran: true, handle: 'a', code: 1 }; },
    onResult: () => {}, onStall: () => {}, killChild: () => { kills++; release(); return true; } });
  await c.advance(0);
  await c.advance(1_900_000);
  assert.equal(kills, 1);
  assert.equal(calls, 1, 'no second runner was started beside the one whose child was killed');
  await c.advance(600_000);
  assert.equal(calls, 2, 'the same runner ticked again after its gap');
});

test('watchdog: output from a long cycle is progress, so a 46-minute cycle that talks is never killed', async () => {
  const c = clock(); let kills = 0;
  const loop = runRotationLoop({ ...c, gapMs: 600_000, stallMs: 1_800_000, alive: () => true,
    tick: async () => new Promise(() => {}),
    onResult: () => {}, onStall: () => {}, killChild: () => { kills++; return true; } });
  for (let i = 0; i < 10; i++) { await c.advance(300_000); loop.progress(); }
  assert.equal(kills, 0);
  await c.advance(1_900_000);
  assert.equal(kills, 1, 'the same silence without output IS a stall — progress() is what spared it');
});

test('server.mjs wires the ledger, the watchdog and the one-child guard into the rotation', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(src, /runRotationLoop\(\{/);
  assert.match(src, /stallMs: Math\.max\(3 \* gap, 45\) \* 60_000/, 'never under 45 min: reading sessions run 15-30');
  assert.match(src, /const out = \(d\) => \{ keep\(d\); if \(loop\) loop\.progress\(\); \};/, 'cycle output counts as progress');
  assert.match(src, /me\.child\.kill\(strikes > 1 \? 'SIGKILL' : 'SIGTERM'\)/, 'a child that ignores SIGTERM gets SIGKILL');
  assert.match(src, /record\('rotation\.tick'/);
  assert.match(src, /record\('error', `rotation watchdog/);
  assert.match(src, /if \(me\.child\) \{/, 'runCycle refuses while a cycle child is still alive');
  assert.match(src, /lastTick: autoProc && autoProc\.ledger \? autoProc\.ledger\.last\(\) : null/, 'the last decision is readable from autoStatus / pulse');
});
