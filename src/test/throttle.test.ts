/**
 * Being throttled is a wait, a cooldown and a reason — not a failure.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST EXISTS. Measured from the live `history` table, 2026-11-03:
 *
 *   13:09:44Z  ratelimit  429 while collecting r/webhosting
 *   20:08:39Z  ratelimit  429 while collecting r/Wordpress
 *   20:28:16Z  error      search preview "agency websites" failed: page.goto:
 *                         net::ERR_HTTP_RESPONSE_CODE_FAILURE
 *   23:49:21Z  ratelimit  429 during read of r/bigseo
 *   23:49:22Z  ratelimit  429 during read of r/webdev
 *   23:49:22Z  ratelimit  collection abandoned after 2 failures in a row
 *
 * One second separates the two 429s that ended the cycle, and the whole cycle's collection went
 * with them. Three facts were missing, and each is a function here:
 *
 *   - the wait was FLAT (`config.budget.rateLimitBackoffMs`, one value, one retry), so a host
 *     that is still refusing is asked again on exactly the same schedule;
 *   - the subreddit that just refused us was in the next cycle's list, unchanged, which is how
 *     r/webhosting at 13:09 and r/Wordpress at 20:08 were both re-read the same day;
 *   - `search ... net::ERR_HTTP_RESPONSE_CODE_FAILURE` is a throttle wearing an `error` row, so
 *     it was counted as a fault by the abandon rule and as nothing at all by health.ts.
 *
 * Every judgement here is arithmetic over strings and timestamps. None of it needs a browser, a
 * session or a live 429 — the argument src/collect-wall.ts makes in its own header.
 * ---------------------------------------------------------------------------
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  looksThrottled, backoffMs, cooledSources, planSources, isCooldownSkip, cooldownSkipRow,
  SOURCE_COOLDOWN_MS, BACKOFF_JITTER
} from '../throttle.js';
import type { HistoryEntry } from '../types.js';

const row = (p: Partial<HistoryEntry> & { kind: HistoryEntry['kind']; ts: string }): HistoryEntry => ({
  account: null, summary: '', ...p
} as HistoryEntry);

const rl = (sub: string, ts: string, data?: Record<string, unknown>): HistoryEntry =>
  row({ kind: 'ratelimit', ts, subreddit: sub, summary: `429 while collecting r/${sub}`,
        data: { stage: 'read', ...data } });

describe('what counts as being throttled', () => {
  test('the two shapes measured on 3 November are both throttles', () => {
    assert.equal(looksThrottled('page.goto: net::ERR_HTTP_RESPONSE_CODE_FAILURE at https://www.reddit.com/search/?q=agency%20websites'), true,
      'this is the row that was filed `error` and counted as a fault');
    assert.equal(looksThrottled('Request failed with HTTP 429'), true);
  });

  test('an ordinary fault is not a throttle, which is the whole point of the split', () => {
    for (const m of [
      'no title found',
      'page.goto: net::ERR_NAME_NOT_RESOLVED',
      'Target page, context or browser has been closed',
      'CHECK constraint failed: kind IN (...)'
    ]) {
      assert.equal(looksThrottled(m), false, `${m} must stay a fault`);
    }
  });
});

describe('the wait grows instead of repeating', () => {
  const base = 300_000;
  const max = 1_800_000;
  const none = () => 0;

  test('the first wait is the wait we have today — the floor does not move', async () => {
    const { config } = await import('../config.js');
    assert.equal(backoffMs(1, { baseMs: base, maxMs: max, random: none }), base,
      'hit 1 is base * 2^0, so an install that upgrades waits exactly as long as before');
    assert.ok(config.budget.rateLimitBackoffMs >= 300_000,
      'and the configured base is still the measured 300s, not something shorter');
  });

  test('each further refusal doubles the wait', () => {
    assert.equal(backoffMs(2, { baseMs: base, maxMs: max, random: none }), 600_000);
    assert.equal(backoffMs(3, { baseMs: base, maxMs: max, random: none }), 1_200_000);
  });

  test('a maximum bounds it, so a long refusal cannot wait for hours', () => {
    for (const hit of [4, 5, 10, 40]) {
      const ms = backoffMs(hit, { baseMs: base, maxMs: max, random: () => 0.999 });
      assert.ok(ms <= max * (1 + BACKOFF_JITTER),
        `hit ${hit} waited ${ms}, past the ceiling ${max} + jitter`);
      assert.ok(ms >= max, `and it must still be at the ceiling, got ${ms}`);
    }
  });

  test('jitter only ever ADDS — no random draw can shorten a wait', () => {
    /* SGEN standing rule: we may only add waiting. A jitter implemented as +/- would, half the
       time, ask a refusing host again sooner than the measured envelope allows. */
    for (const r of [0, 0.01, 0.5, 0.9999]) {
      for (const hit of [1, 2, 3, 9]) {
        const ms = backoffMs(hit, { baseMs: base, maxMs: max, random: () => r });
        const flat = Math.min(base * 2 ** (hit - 1), max);
        assert.ok(ms >= flat, `hit ${hit} with random ${r} waited ${ms} < ${flat}`);
        assert.ok(ms >= base, 'and never under the base wait');
      }
    }
  });

  test('jitter is real — two draws differ, so a fleet does not retry in lockstep', () => {
    const a = backoffMs(2, { baseMs: base, maxMs: max, random: () => 0 });
    const b = backoffMs(2, { baseMs: base, maxMs: max, random: () => 0.9 });
    assert.notEqual(a, b);
  });

  test('a nonsensical hit number still waits at least the base', () => {
    for (const hit of [0, -3]) {
      assert.ok(backoffMs(hit, { baseMs: base, maxMs: max, random: none }) >= base);
    }
  });
});

describe('a subreddit that just refused us is left alone next cycle', () => {
  const now = new Date('2026-11-03T23:55:00Z');

  test('the source 429d six minutes ago is on cooldown, with the time it happened', () => {
    const cooled = cooledSources([rl('bigseo', '2026-11-03T23:49:21Z')], now, SOURCE_COOLDOWN_MS);
    const hit = cooled.get('bigseo');
    assert.ok(hit, 'r/bigseo 429d at 23:49:21 and must not be the first thing we open at 23:55');
    assert.equal(hit.lastAt, '2026-11-03T23:49:21Z');
    assert.ok(hit.untilMs > now.getTime(), 'and the cooldown has time left to run');
  });

  test('a source whose 429 is older than the cooldown is readable again', () => {
    const cooled = cooledSources([rl('webhosting', '2026-11-03T13:09:44Z')], now, SOURCE_COOLDOWN_MS);
    assert.equal(cooled.has('webhosting'), false,
      'a cooldown that never expires is a retirement, and retiring a source is not this rule');
  });

  test('the cooldown is matched case-insensitively — r/Wordpress and r/wordpress are one source', () => {
    const cooled = cooledSources([rl('Wordpress', '2026-11-03T23:50:00Z')], now, SOURCE_COOLDOWN_MS);
    assert.ok(cooled.has('wordpress'), 'the source list and the history row need not agree on case');
  });

  test('a PUBLISH-path 429 does not cool a subreddit off', () => {
    /* health.ts:275 spent nine days on exactly this conflation: `ratelimit` carries two unrelated
       facts, and only the read-path one says anything about collecting. */
    const cooled = cooledSources(
      [rl('bigseo', '2026-11-03T23:49:21Z', { stage: 'publish' })], now, SOURCE_COOLDOWN_MS);
    assert.equal(cooled.size, 0);
  });

  test('the skip row this rule writes can never renew the cooldown it came from', () => {
    /* THE TRAP. The skip is recorded as a `ratelimit` row so it is visible where the 429s are. If
       `cooledSources` counted its own skips, one 429 would cool a source off for ever — a silent
       retirement nobody asked for. */
    const history = [
      rl('bigseo', '2026-11-03T23:49:21Z'),
      rl('bigseo', '2026-11-03T23:52:00Z', { cooldownSkip: true })
    ];
    const cooled = cooledSources(history, new Date('2026-11-04T01:30:00Z'), SOURCE_COOLDOWN_MS);
    assert.equal(cooled.size, 0, 'the 429 expired; the skip row must not have extended it');
    assert.equal(isCooldownSkip(history[1]!), true);
    assert.equal(isCooldownSkip(history[0]!), false);
  });
});

describe('the cycle plan says what it will read and why it is leaving the rest', () => {
  const now = new Date('2026-11-03T23:55:00Z');
  const history = [rl('bigseo', '2026-11-03T23:49:21Z'), rl('webdev', '2026-11-03T23:49:22Z')];

  test('the throttled sources are dropped and the rest are still collected', () => {
    const plan = planSources(['bigseo', 'webdev', 'SEO', 'webhosting'], history, now, SOURCE_COOLDOWN_MS);
    assert.deepEqual(plan.read, ['SEO', 'webhosting'],
      'the two that refused us at 23:49 are the two we skip — not the cycle');
    assert.deepEqual(plan.skipped.map((s) => s.name), ['bigseo', 'webdev']);
  });

  test('every skip carries a reason fit for a history row, naming the source and the wait', () => {
    /* r/SEO rides along because a plan with nothing readable promotes its longest-cooled
       source instead — the rule the last test in this block pins. */
    const plan = planSources(['bigseo', 'SEO'], history, now, SOURCE_COOLDOWN_MS);
    const why = plan.skipped[0]!.why;
    assert.match(why, /bigseo/);
    assert.match(why, /429/);
    assert.match(why, /\d+ min/, 'a reason without the remaining time cannot be acted on');
    assert.ok(why.length > 30, `the reason IS the record: ${JSON.stringify(why)}`);
  });

  test('a clean history plans every source and skips nothing', () => {
    const plan = planSources(['bigseo', 'SEO'], [], now, SOURCE_COOLDOWN_MS);
    assert.deepEqual(plan.read, ['bigseo', 'SEO']);
    assert.deepEqual(plan.skipped, []);
  });

  test('a cooldown may never empty the cycle — the last readable source is not optional', () => {
    /* If every source is cooling off, skipping them all collects nothing and reads as a quiet
       hour, which is the half of the 2026-09-28 defect that cost the posts (src/collect-wall.ts).
       One source is still attempted, the oldest refusal first. */
    const all = [rl('bigseo', '2026-11-03T23:49:21Z'), rl('webdev', '2026-11-03T23:50:00Z')];
    const plan = planSources(['bigseo', 'webdev'], all, now, SOURCE_COOLDOWN_MS);
    assert.deepEqual(plan.read, ['bigseo'], 'the longest-cooled source is the one still tried');
    assert.deepEqual(plan.skipped.map((s) => s.name), ['webdev']);
  });
});

describe('the skip that goes into history', () => {
  const now = new Date('2026-11-03T23:55:00Z');

  test('the row names the source, the reason and the flag its three readers need', () => {
    const plan = planSources(['bigseo', 'SEO'], [rl('bigseo', '2026-11-03T23:49:21Z')], now, SOURCE_COOLDOWN_MS);
    const row = cooldownSkipRow(plan.skipped[0]!);

    assert.equal(row.kind, 'ratelimit', 'it sits where an operator looks for throttling');
    assert.equal(row.summary, plan.skipped[0]!.why);
    assert.equal(row.data.subreddit, 'bigseo');
    assert.equal(row.data.stage, 'read',
      'a read-path row — health.ts counts only PUBLISH-stage 429s toward a cooldown');
    assert.equal(row.data.cooldownSkip, true,
      'without this flag the cooldown renews itself for ever and the 429 counts rise on their own');
    assert.equal(row.data.status, 'unknown', 'nothing was blocked here; we chose to wait');
    assert.equal(row.data.lastRateLimitAt, '2026-11-03T23:49:21Z');
    assert.equal(row.data.until, '2026-11-04T01:19:21.000Z');
  });

  test('the row this rule writes cannot start a cooldown of its own', async () => {
    /* Fed straight back in as history — the next cycle's input — it must change nothing. */
    const plan = planSources(['bigseo', 'SEO'], [rl('bigseo', '2026-11-03T23:49:21Z')], now, SOURCE_COOLDOWN_MS);
    const row = cooldownSkipRow(plan.skipped[0]!);
    const fed = [{ kind: row.kind, ts: now.toISOString(), account: null, subreddit: 'bigseo',
                   summary: row.summary, data: row.data } as unknown as HistoryEntry];
    assert.equal(cooledSources(fed, new Date('2026-11-04T01:30:00Z'), SOURCE_COOLDOWN_MS).size, 0);
  });
});
