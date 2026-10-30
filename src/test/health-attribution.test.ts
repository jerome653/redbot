import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { counters, assess } from '../health.js';
import type { HistoryEntry } from '../types.js';

/**
 * WHAT THIS PINS: one event that names no account could stop every account at once.
 *
 * `counters()` charged a row with `account: null` to whichever account was being asked about.
 * With one account that is nearly right — an unattributed row can only be that account's. With
 * a fleet it is wrong in the most expensive direction: two `login.fail` rows with `account:
 * null` — exactly what a foreign headless Chrome's block page writes, as happened 2026-07-27 —
 * set `loginFailures24h = 2` for EVERY account, which `assess()` turns into `Stop` /
 * `mayPublish: false` with no override and no reset until the rows age out of the 24h window.
 *
 * The rule now: an unattributed row is charged to a named account only when there is nothing
 * else it could belong to. Beyond that it is not counted — and it is REPORTED, because an event
 * that quietly belongs to nobody is how a real block page goes unnoticed.
 */
describe('an event that names no account is not charged to every account', () => {
  const NOW = new Date('2026-08-13T12:00:00.000Z');
  const ago = (mins: number) => new Date(NOW.getTime() - mins * 60_000).toISOString();

  const history = (rows: Array<Partial<HistoryEntry>>): HistoryEntry[] =>
    rows.map((r) => ({ ts: ago(30), kind: 'read', summary: '', account: null, ...r }) as HistoryEntry);

  const nobodysFailures = history([
    { kind: 'login.fail', summary: 'block page', account: null, ts: ago(20) },
    { kind: 'login.fail', summary: 'block page', account: null, ts: ago(10) }
  ]);

  test('with a fleet, an unattributed failure is charged to no one', async () => {
    const c = await counters('docs-architect', NOW, { history: nobodysFailures, observations: [] }, undefined, 2);
    assert.equal(c.loginFailures24h, 0, 'a row that names no account is not this account’s');
    assert.equal(c.unattributedEvents24h, 2, 'but it is reported rather than dropped in silence');
    assert.notEqual(assess(c, NOW).state, 'Stop');
    assert.equal(assess(c, NOW).mayPublish, true);
  });

  test('and the fleet does not silently swallow it — the operator is told', async () => {
    const c = await counters('docs-architect', NOW, { history: nobodysFailures, observations: [] }, undefined, 2);
    const v = assess(c, NOW);
    assert.equal(v.state, 'Caution', 'unattributed events are worth saying out loud');
    assert.ok(v.reasons.some((r) => /2 event/.test(r) && /no account/i.test(r)),
              `no reason names the unattributed events: ${JSON.stringify(v.reasons)}`);
  });

  test('with one account there is nothing else it could be, so it still counts', async () => {
    const c = await counters('docs-architect', NOW, { history: nobodysFailures, observations: [] }, undefined, 1);
    assert.equal(c.loginFailures24h, 2, 'the single-account install must not go blind');
    assert.equal(c.unattributedEvents24h, 0, 'nothing was excluded, so nothing is outstanding');
  });

  test('a failure that DOES name the account still stops it, fleet or not', async () => {
    const mine = history([
      { kind: 'login.fail', summary: 'refused', account: 'docs-architect', ts: ago(20) },
      { kind: 'login.fail', summary: 'refused', account: 'docs-architect', ts: ago(10) }
    ]);
    const c = await counters('docs-architect', NOW, { history: mine, observations: [] }, undefined, 2);
    assert.equal(c.loginFailures24h, 2);
    assert.equal(assess(c, NOW).state, 'Stop');
    assert.equal(assess(c, NOW).mayPublish, false);
  });

  test('another account’s failure was never this account’s, and still is not', async () => {
    const theirs = history([
      { kind: 'login.fail', summary: 'refused', account: 'jrum_sgen', ts: ago(20) },
      { kind: 'login.fail', summary: 'refused', account: 'jrum_sgen', ts: ago(10) }
    ]);
    const c = await counters('docs-architect', NOW, { history: theirs, observations: [] }, undefined, 2);
    assert.equal(c.loginFailures24h, 0);
    assert.equal(c.unattributedEvents24h, 0, 'an event with an owner is not unattributed');
  });

  test('only the last 24h is reported outstanding — old noise is not a standing alarm', async () => {
    const old = history([
      { kind: 'login.fail', summary: 'block page', account: null, ts: ago(60 * 48) },
      { kind: 'login.fail', summary: 'block page', account: null, ts: ago(30) }
    ]);
    const c = await counters('docs-architect', NOW, { history: old, observations: [] }, undefined, 3);
    assert.equal(c.unattributedEvents24h, 1);
  });

  test('the fleet size travels with the counters, so a reader can check the rule that was used', async () => {
    const c = await counters('docs-architect', NOW, { history: nobodysFailures, observations: [] }, undefined, 2);
    assert.equal(c.fleetSize, 2);
  });

  test('asking about the whole install (no account) still sees everything', async () => {
    const c = await counters(null, NOW, { history: nobodysFailures, observations: [] }, undefined, 2);
    assert.equal(c.loginFailures24h, 2, 'with no account named, nothing is being attributed to anyone');
    assert.equal(c.unattributedEvents24h, 0);
  });

  /* Measured on cardinal 2026-10-17: 13 accounts, 36 unowned rows in 24h, every one of them
     search.preview, search, read, opportunity, gate.block or draft. The caution fired every cycle. */
  test('the loop\'s own unowned searches, reads and drafts are not an outstanding event', async () => {
    const loopRows = history(['search.preview', 'search', 'read', 'opportunity', 'gate.block', 'draft']
      .map((kind) => ({ kind: kind as HistoryEntry['kind'], account: null, ts: ago(15) })));
    const c = await counters('docs-architect', NOW, { history: loopRows, observations: [] }, undefined, 13);
    assert.equal(c.unattributedEvents24h, 0, 'no verdict reads these kinds, so nobody owning them changes nothing');
    assert.ok(!assess(c, NOW).reasons.some((r) => /no account/i.test(r)), JSON.stringify(assess(c, NOW).reasons));
  });

  test('every verdict kind, unowned, is still reported, and each one moves a counter when charged', async () => {
    const { VERDICT_KINDS } = await import('../health.js');
    assert.deepEqual([...VERDICT_KINDS].sort(), ['login.fail', 'publish.ok', 'ratelimit'],
      'health.ts derives repliesToday, loginFailures24h and the rate-limit counters from exactly these');
    const empty = await counters('docs-architect', NOW, { history: [], observations: [] }, undefined, 1);
    for (const kind of VERDICT_KINDS) {
      const row = history([{ kind: kind as HistoryEntry['kind'], account: null, ts: ago(15) }]);
      const fleet = await counters('docs-architect', NOW, { history: row, observations: [] }, undefined, 2);
      assert.equal(fleet.unattributedEvents24h, 1, `an unowned ${kind} must be reported`);
      const charged = await counters('docs-architect', NOW, { history: row, observations: [] }, undefined, 1);
      assert.notDeepEqual(charged, empty, `${kind} changes no counter, so it does not belong in VERDICT_KINDS`);
    }
  });

  test('the caution points at a command that exists, not at a file that no longer does', async () => {
    const c = await counters('docs-architect', NOW, { history: nobodysFailures, observations: [] }, undefined, 2);
    const r = assess(c, NOW).reasons.find((x) => /no account/i.test(x)) ?? '';
    assert.match(r, /redbot history/);
    assert.doesNotMatch(r, /history\.jsonl/);
  });
});

test('a removal filed under Reddit\'s spelling of the name still reaches the configured handle', async () => {
  const NOW = new Date('2026-10-22T12:00:00.000Z');
  const ts = new Date(NOW.getTime() - 60 * 60_000).toISOString();
  const observations = [
    { ts, account: 'Big_Variation_8580', kind: 'reply-marked-removed', vector: 'signed-in', value: true },
    { ts, account: 'Big_Variation_8580', kind: 'reply-marked-removed', vector: 'signed-in', value: true }
  ] as never[];
  const c = await counters('big_variation_8580', NOW, { history: [], observations }, undefined, 2);
  assert.equal(c.removalsObserved30d, 2, 'Reddit usernames are case-insensitive; the stop must not miss a recased name');
  assert.equal(assess(c, NOW).mayPublish, false);
});

test('one comment seen removed at the 24h and the 7d checkpoint is ONE removal, not two', async () => {
  const NOW = new Date('2026-10-30T00:00:00.000Z');
  const at = (h: number) => new Date(NOW.getTime() - h * 60 * 60_000).toISOString();
  const permalink = '/r/webdev/comments/1xeaekz/comment/19rldrjaqk51h/';
  const observations = [
    { ts: at(100), account: 'evanwebtalk', kind: 'reply-marked-removed', vector: 'signed-in', permalink, checkpoint: '24h', value: 'Comment removed by moderator' },
    { ts: at(30), account: 'evanwebtalk', kind: 'reply-marked-removed', vector: 'signed-in', permalink, checkpoint: '7d', value: 'Comment removed by moderator' },
    { ts: at(30), account: 'evanwebtalk', kind: 'reply-absent-signed-in', vector: 'signed-in', permalink, checkpoint: '7d', value: true }
  ] as never[];
  const c = await counters('evanwebtalk', NOW, { history: [], observations }, undefined, 1);
  assert.equal(c.removalsObserved30d, 1, 'the stop counts comments removed, not times we looked');
  assert.ok(!assess(c, NOW).reasons.some((r) => /removals observed in 30 days/.test(r)), JSON.stringify(assess(c, NOW).reasons));
});
