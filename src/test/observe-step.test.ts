/**
 * Observe every turn: the auto cycle's observe step and the removal brake (src/commands/auto.ts).
 *
 *   - the cycle observes BEFORE it collects, drafts, warms up or publishes;
 *   - a 429 or block page while observing ends the turn with nothing published;
 *   - a removal observed in this turn ends the turn too (the brake), and an observe that throws
 *     does not.
 *
 * Due selection is tested in observe-due.test.ts. No database rows: every seam is stubbed.
 * observe-brake.test.ts drives the real health path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HealthVerdict, HealthCounters } from '../health.js';
import { observeStep, cycle, removalBrake, type ObserveStepDeps, type CycleDeps } from '../commands/auto.js';

const NOW = new Date('2026-10-22T12:00:00.000Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

function verdict(state: HealthVerdict['state'], c: Partial<HealthCounters> = {}, reasons = ['why']): HealthVerdict {
  return {
    state, mayPublish: state === 'Healthy' || state === 'Caution', reasons, resumeAt: null,
    counters: { lastRemovalAt: null, ...c } as HealthCounters
  };
}

test('removalBrake: Stop brakes; a removal inside its cooldown brakes; spacing alone does not', () => {
  assert.ok(removalBrake(verdict('Stop', {}, ['2 removals observed in 30 days']), NOW));
  assert.ok(removalBrake(verdict('Cooldown', { lastRemovalAt: ago(60) }), NOW), 'removal 1h ago, 24h cooldown');
  assert.equal(removalBrake(verdict('Cooldown', { lastRemovalAt: null }), NOW), null, 'reply spacing is the publish gate\'s job');
  assert.equal(removalBrake(verdict('Caution', { lastRemovalAt: ago(25 * 60) }), NOW), null, 'cooldown over');
  assert.equal(removalBrake(verdict('Healthy'), NOW), null);
});

/* ---- the step -------------------------------------------------------------------------------- */

function stepDeps(over: Partial<ObserveStepDeps> = {}) {
  const calls = { observe: [] as string[], rec: [] as string[] };
  const d: ObserveStepDeps = {
    browserUp: async () => true,
    observeDue: async ({ account }) => { calls.observe.push(account); return { due: 1, observed: 1, stopped: null }; },
    verdict: async () => verdict('Caution'),
    rec: async (kind) => { calls.rec.push(kind); },
    now: () => NOW,
    ...over
  };
  return { d, calls };
}

test('the step observes for the selected account and lets the turn go on when nothing is wrong', async () => {
  const { d, calls } = stepDeps();
  const r = await observeStep('alice', d);
  assert.deepEqual(calls.observe, ['alice']);
  assert.equal(r.stop, false);
});

test('a 429 or a block page while observing stops the turn', async () => {
  for (const stopped of ['ratelimit', 'blocked'] as const) {
    const { d } = stepDeps({ observeDue: async () => ({ due: 1, observed: 0, stopped }) });
    const r = await observeStep('alice', d);
    assert.equal(r.stop, true, stopped);
    assert.match(r.why, new RegExp(stopped === 'ratelimit' ? '429|rate' : 'block'));
  }
});

test('a removal observed in this turn stops the turn (the health verdict is read AFTER observing)', async () => {
  let observed = false;
  const { d } = stepDeps({
    observeDue: async () => { observed = true; return { due: 1, observed: 1, stopped: null }; },
    verdict: async () => (observed ? verdict('Cooldown', { lastRemovalAt: ago(1) }) : verdict('Healthy'))
  });
  const r = await observeStep('alice', d);
  assert.equal(r.stop, true);
  assert.match(r.why, /removal/);
});

test('an observe that throws is logged and does not stop the turn', async () => {
  const { d, calls } = stepDeps({ observeDue: async () => { throw new Error('page crashed'); } });
  const r = await observeStep('alice', d);
  assert.equal(r.stop, false);
  assert.deepEqual(calls.rec, ['error']);
});

test('no browser: nothing is observed, but a brake already on record still stops the turn', async () => {
  const { d, calls } = stepDeps({ browserUp: async () => false });
  assert.equal((await observeStep('alice', d)).stop, false);
  assert.deepEqual(calls.observe, []);

  const braked = stepDeps({ browserUp: async () => false, verdict: async () => verdict('Stop', {}, ['suspension']) });
  assert.equal((await observeStep('alice', braked.d)).stop, true);
});

test('no account selected: no observe', async () => {
  const { d, calls } = stepDeps();
  assert.equal((await observeStep(null, d)).stop, false);
  assert.deepEqual(calls.observe, []);
});

/* ---- the cycle ------------------------------------------------------------------------------- */

function cycleDeps(over: Partial<CycleDeps> = {}) {
  const order: string[] = [];
  const d: CycleDeps = {
    account: () => ({ handle: 'alice' }) as ReturnType<CycleDeps['account']>,
    window: async () => { order.push('window'); return { allowed: true, detail: 'ok' }; },
    observe: async (h) => { order.push(`observe:${h}`); return { stop: false, why: '' }; },
    work: async () => { order.push('work'); return 0; },
    rec: async (kind) => { order.push(`rec:${kind}`); },
    ...over
  };
  return { d, order };
}

test('the cycle observes after the window check and BEFORE collecting, drafting, warmup or publishing', async () => {
  const { d, order } = cycleDeps();
  assert.equal(await cycle(d), 0);
  assert.deepEqual(order, ['window', 'observe:alice', 'work']);
});

test('a stop from the observe step ends the cycle: nothing is drafted or published', async () => {
  const { d, order } = cycleDeps({
    observe: async (h) => { order.push(`observe:${h}`); return { stop: true, why: '429 while observing' }; }
  });
  assert.equal(await cycle(d), 0);
  assert.ok(!order.includes('work'), `work ran after a stop: ${order.join(', ')}`);
  assert.deepEqual(order, ['window', 'observe:alice', 'rec:auto.skip']);
});

test('the skip a stop records is filed under rule "observe", with the account and the reason', async () => {
  const rows: Array<{ kind: string; summary: string; extra?: Record<string, unknown> }> = [];
  const { d } = cycleDeps({
    observe: async () => ({ stop: true, why: 'a removal was observed' }),
    rec: async (kind, summary, extra) => { rows.push({ kind, summary, extra }); }
  });
  assert.equal(await cycle(d), 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.kind, 'auto.skip');
  assert.equal(rows[0]!.summary, 'a removal was observed');
  assert.deepEqual(rows[0]!.extra, { rule: 'observe', account: 'alice' });
});

test('quiet hours still skip before anything touches the browser', async () => {
  const { d, order } = cycleDeps({ window: async () => { order.push('window'); return { allowed: false, detail: 'quiet', rule: 'quiet-hours' }; } });
  assert.equal(await cycle(d), 0);
  assert.deepEqual(order, ['window', 'rec:auto.skip']);
});
