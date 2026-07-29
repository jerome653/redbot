import { test } from 'node:test';
import assert from 'node:assert/strict';
import { counters, assess, sameLocalDay, type Observation } from '../health.js';
import { policy } from '../policy.js';
import type { HistoryEntry, HistoryKind } from '../types.js';

const NOW = new Date('2026-07-23T18:00:00.000Z');
const ACC = 'docs-architect';

const at = (isoOffsetMinutes: number): string =>
  new Date(NOW.getTime() - isoOffsetMinutes * 60_000).toISOString();

const h = (kind: HistoryKind, minutesAgo: number, data?: Record<string, unknown>): HistoryEntry => ({
  ts: at(minutesAgo),
  kind,
  account: ACC,
  summary: `${kind} ${minutesAgo}m ago`,
  ...(data ? { data } : {})
});

/* ---- L5: the daily ceiling and quiet hours must agree on where a day ends ---- */

test('sameLocalDay: two instants that are one UTC day but the same Manila day count as one day', async () => {
  // 2026-07-23T18:00Z is 2026-07-24 02:00 in Manila (UTC+8); 2026-07-23T20:00Z is 2026-07-24
  // 04:00 Manila. Same UTC date (the 23rd) — but also the same Manila date (the 24th).
  const a = new Date('2026-07-23T18:00:00Z');
  const b = new Date('2026-07-23T20:00:00Z');
  assert.equal(sameLocalDay(a, b, 'Asia/Manila'), true);
});

test('sameLocalDay: the same UTC day can be two different Manila days', async () => {
  // 2026-07-23T10:00Z is 18:00 on the 23rd in Manila; 2026-07-23T17:00Z is 01:00 on the 24th.
  // Same UTC date, DIFFERENT Manila date — the case the old UTC-only count got wrong, letting
  // replies from the account's previous local evening not count against today's ceiling.
  const a = new Date('2026-07-23T10:00:00Z');
  const b = new Date('2026-07-23T17:00:00Z');
  assert.equal(sameLocalDay(a, b, 'Asia/Manila'), false);
  assert.equal(sameLocalDay(a, b), true, 'without a zone it is still the same UTC day');
});

test('sameLocalDay: an unreadable zone falls back to UTC rather than throwing', async () => {
  const a = new Date('2026-07-23T10:00:00Z');
  const b = new Date('2026-07-23T17:00:00Z');
  assert.equal(sameLocalDay(a, b, 'Nowhere/Nothing'), true);
});

const o = (
  kind: Observation['kind'],
  minutesAgo: number,
  value?: Observation['value']
): Observation => ({
  ts: at(minutesAgo),
  account: ACC,
  kind,
  vector: 'signed-in',
  ...(value !== undefined ? { value } : {})
});

/** A settled account: measured karma, well past the age threshold. */
const SETTLED: Observation[] = [
  o('karma', 60, 500),
  { ts: at(60), account: ACC, kind: 'account-created', vector: 'signed-in', value: '2024-01-01T00:00:00.000Z' }
];

const state = async (history: HistoryEntry[], observations: Observation[] = SETTLED) =>
  assess(await counters(ACC, NOW, { history, observations }), NOW);

test('a quiet, settled account is Healthy and may publish', async () => {
  const v = await state([h('read', 120)]);
  assert.equal(v.state, 'Healthy');
  assert.equal(v.mayPublish, true);
});

test('unmeasured karma is a Caution, not an assumption', async () => {
  const v = await state([], []);
  assert.equal(v.state, 'Caution');
  assert.equal(v.mayPublish, true);
  assert.ok(v.reasons.some((r) => /never been measured/.test(r)));
});

test('single-digit karma is a Caution', async () => {
  const v = await state([], [o('karma', 30, 1)]);
  assert.equal(v.state, 'Caution');
  assert.ok(v.reasons.some((r) => /karma 1 is below/.test(r)));
});

test('a new account is a Caution', async () => {
  const v = await state([], [
    o('karma', 30, 500),
    { ts: at(30), account: ACC, kind: 'account-created', vector: 'signed-in', value: at(60 * 24 * 3) }
  ]);
  assert.equal(v.state, 'Caution');
  assert.ok(v.reasons.some((r) => /days old/.test(r)));
});

test('the daily reply ceiling forces a Cooldown that no clock lifts', async () => {
  const replies = [h('publish.ok', 600), h('publish.ok', 480), h('publish.ok', 360)];
  const v = await state(replies);
  assert.equal(v.state, 'Cooldown');
  assert.equal(v.mayPublish, false);
  assert.equal(v.resumeAt, null, 'a daily ceiling must not advertise a resume time');
  assert.ok(v.counters.repliesToday === policy.maxRepliesPerDay.value);
});

test('replies are spaced — a Cooldown right after one, with a resume time', async () => {
  const v = await state([h('publish.ok', 10)]);
  assert.equal(v.state, 'Cooldown');
  assert.equal(v.mayPublish, false);
  assert.ok(v.resumeAt, 'spacing cooldown should say when it lifts');
});

test('a 429 cools the account off, and the cooldown expires', async () => {
  const hot = await state([h('ratelimit', 5)]);
  assert.equal(hot.state, 'Cooldown');
  assert.equal(hot.mayPublish, false);

  const cooled = await state([h('ratelimit', 31)]);
  assert.equal(cooled.state, 'Healthy');
  assert.equal(cooled.mayPublish, true);
});

test('one observed removal blocks posting for a day', async () => {
  const v = await state([], [...SETTLED, o('reply-marked-removed', 60)]);
  assert.equal(v.state, 'Cooldown');
  assert.equal(v.mayPublish, false);
});

test('two observed removals is a Stop', async () => {
  const v = await state([], [...SETTLED, o('reply-marked-removed', 60), o('reply-marked-removed', 2000)]);
  assert.equal(v.state, 'Stop');
  assert.equal(v.mayPublish, false);
  assert.ok(v.reasons.some((r) => /pattern, not noise/.test(r)));
});

test('a suspension notice is a Stop, and says why replacing the account is not the answer', async () => {
  const v = await state([], [...SETTLED, o('account-suspended-notice', 30)]);
  assert.equal(v.state, 'Stop');
  assert.ok(v.reasons.some((r) => /ban evasion/.test(r)));
});

test('Stop wins over Cooldown', async () => {
  const v = await state([h('ratelimit', 1)], [...SETTLED, o('account-suspended-notice', 30)]);
  assert.equal(v.state, 'Stop');
});

test('repeated login failure stops rather than probes', async () => {
  const v = await state([h('login.fail', 30), h('login.fail', 20)]);
  assert.equal(v.state, 'Stop');
  assert.equal(v.mayPublish, false);
});

test('a reply invisible to a signed-out browser is reported as an observation, not a cause', async () => {
  const v = await state([], [
    ...SETTLED,
    { ts: at(30), account: ACC, kind: 'reply-absent-signed-out', vector: 'signed-out', value: false }
  ]);
  assert.equal(v.state, 'Caution');
  const reason = v.reasons.find((r) => /signed-out browser/.test(r));
  assert.ok(reason, 'the observation should be surfaced');
  assert.ok(/does not establish/.test(reason!), 'the reason must not claim a cause');
});

test('counters roll up reads, sessions and dwell from the activity log', async () => {
  const c = await counters(ACC, NOW, {
    history: [
      h('read', 100),
      h('read', 90),
      h('search', 80),
      h('session.start', 70),
      h('session.view', 65, { dwellMs: 30_000 }),
      h('session.view', 60, { dwellMs: 50_000 }),
      h('session.end', 55)
    ],
    observations: SETTLED
  });
  assert.equal(c.readsToday, 2);
  assert.equal(c.searchesToday, 1);
  assert.equal(c.avgDwellMs, 40_000);
  assert.equal(c.avgSessionMs, 15 * 60_000);
});
