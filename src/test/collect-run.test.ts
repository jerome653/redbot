/**
 * A 429 is a signal, not a skip.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST EXISTS.
 *
 * Clark's machine, 2026-08-21. `redbot read web_design` took 417.6 seconds against a ~120s
 * baseline and exited 0; `read SEO` came back with 13 threads instead of 15 and exited 0. Both
 * runs had been rate-limited. Nothing in the record said so, because `read`'s collection loop
 * turned every per-thread failure into `skipped++` — and Reddit's rate-limit page does not throw
 * and has no title, so `collectThread` returned null and the loop walked the whole remaining list
 * against a wall.
 *
 * Two consequences, both invisible from the outside:
 *   - `read` is the highest-volume path in the product and was the only one that never wrote a
 *     `ratelimit` row (session.ts, reply.ts and observe.ts all do), so health.ts:204 and
 *     metrics.ts:133 — which count exactly those rows — under-reported the throttling that
 *     matters most;
 *   - `config.budget.rateLimitBackoffMs` and `maxRateLimitRetries` have described a back-off
 *     policy since DEFECT-02 in July, and grep found no reader for either.
 *
 * The fakes here are the point: what needed testing is the COUNTING — back off once, retry the
 * link the throttle cost us, then stop instead of burning the rest of the list — and none of that
 * needs Chromium. `isRateLimited` itself is asserted against a real browser in browser-error.
 * ---------------------------------------------------------------------------
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { collectRun, type CollectDeps } from '../reddit/collect-run.js';
import type { Thread } from '../types.js';

const thread = (id: string): Thread => ({
  id, title: `thread ${id}`, permalink: `/r/x/comments/${id}/`, subreddit: 'x',
  body: '', author: 'a', upvotes: 0, commentCount: 0, ageMinutes: 10, ageText: '10 min ago',
  comments: [], collectedAt: new Date().toISOString(), source: 'read'
} as unknown as Thread);

const LINKS = ['l1', 'l2', 'l3', 'l4', 'l5'];

/** A scripted page: `script[link]` says what happens when that link is opened. */
function harness(script: Record<string, 'thread' | 'null' | '429' | 'throw'>, opts?: {
  budget?: { rateLimitBackoffMs: number; maxRateLimitRetries: number };
  /** Links whose SECOND opening behaves differently — how a backoff is shown to have worked. */
  onRetry?: Record<string, 'thread' | 'null' | '429'>;
}) {
  const opened: string[] = [];
  const slept: number[] = [];
  const throttleRows: Array<{ link: string; hit: number }> = [];
  let throttledNow = false;

  const deps: CollectDeps = {
    async fetch(link) {
      const seen = opened.filter((l) => l === link).length;
      opened.push(link);
      const what = (seen > 0 && opts?.onRetry?.[link]) || script[link] || 'thread';
      throttledNow = what === '429';
      if (what === 'thread') return thread(link);
      if (what === 'throw') throw new Error('net::ERR_HTTP_RESPONSE_CODE_FAILURE');
      return null;
    },
    async rateLimited() { return throttledNow; },
    async onRateLimit(link, hit) { throttleRows.push({ link, hit }); },
    async sleep(ms) { slept.push(ms); },
    budget: opts?.budget
  };

  return { deps, opened, slept, throttleRows };
}

describe('a clean run', () => {
  test('collects every link and reports nothing unusual', async () => {
    const h = harness({});
    const out = await collectRun(LINKS, h.deps);

    assert.equal(out.threads.length, 5);
    assert.equal(out.skipped, 0);
    assert.equal(out.rateLimitHits, 0);
    assert.equal(out.stoppedEarly, false);
    assert.equal(out.notAttempted, 0);
    assert.deepEqual(h.slept, [], 'a run that was never throttled must never wait');
  });

  test('an unreadable thread is still a skip, and the rest of the run continues', async () => {
    const h = harness({ l2: 'null', l4: 'throw' });
    const out = await collectRun(LINKS, h.deps);

    assert.equal(out.skipped, 2, 'a deleted post and an unreachable one are skips, not throttles');
    assert.equal(out.threads.length, 3);
    assert.equal(out.rateLimitHits, 0, 'a skip must not be reported as rate limiting');
    assert.equal(out.stoppedEarly, false);
  });
});

describe('a rate limit part-way down the list', () => {
  test('is recorded, not counted as a skip', async () => {
    const h = harness({ l3: '429' }, { onRetry: { l3: 'thread' } });
    const out = await collectRun(LINKS, h.deps);

    assert.equal(out.rateLimitHits, 1, 'the 429 has to be visible in the outcome');
    assert.equal(out.skipped, 0, 'this is the defect: a 429 used to be filed as "no title found"');
    assert.deepEqual(h.throttleRows, [{ link: 'l3', hit: 1 }],
      'the caller writes the ratelimit history row, so it must be told exactly once');
  });

  test('backs off once and re-opens the link the throttle cost us', async () => {
    const h = harness({ l3: '429' }, { onRetry: { l3: 'thread' } });
    const out = await collectRun(LINKS, h.deps);

    assert.equal(h.slept.length, 1, 'exactly one backoff — the configured retry budget is 1');
    assert.equal(h.opened.filter((l) => l === 'l3').length, 2, 'the throttled link is retried');
    assert.equal(out.threads.length, 5, 'and the retry means no thread is lost to the throttle');
    assert.equal(out.stoppedEarly, false);
  });

  test('stops the run once the retry budget is spent, instead of opening the rest', async () => {
    /* The behaviour that cost 417.6 seconds: every remaining link opened against a wall. */
    const h = harness({ l2: '429', l3: '429', l4: '429', l5: '429' });
    const out = await collectRun(LINKS, h.deps);

    assert.equal(out.stoppedEarly, true);
    assert.equal(out.notAttempted, 3, 'l3, l4 and l5 were never opened');
    assert.deepEqual(h.opened, ['l1', 'l2', 'l2'],
      `only the first link, the throttled one, and its one retry — saw ${h.opened.join(', ')}`);
    assert.equal(out.rateLimitHits, 2, 'both refusals are recorded, not just the first');
  });

  test('keeps what was already collected', async () => {
    const h = harness({ l3: '429', l4: '429' });
    const out = await collectRun(LINKS, h.deps);

    assert.equal(out.stoppedEarly, true);
    assert.deepEqual(out.threads.map((t) => t.id), ['l1', 'l2'],
      'stopping early must not discard the threads the run already has');
  });
});

describe('the budget in config is the budget that is used', () => {
  test('the backoff length comes from config, not from a constant in the loop', async () => {
    const h = harness({ l2: '429' }, {
      budget: { rateLimitBackoffMs: 1234, maxRateLimitRetries: 1 },
      onRetry: { l2: 'thread' }
    });
    await collectRun(LINKS, h.deps);
    assert.deepEqual(h.slept, [1234], 'change the config and the wait must change with it');
  });

  test('more retries means more attempts before giving up', async () => {
    const h = harness({ l2: '429', l3: '429' }, {
      budget: { rateLimitBackoffMs: 5, maxRateLimitRetries: 3 },
      onRetry: { l2: 'thread', l3: 'thread' }
    });
    const out = await collectRun(LINKS, h.deps);

    assert.equal(out.stoppedEarly, false, 'with three retries available, two throttles are survivable');
    assert.equal(h.slept.length, 2);
    assert.equal(out.threads.length, 5);
  });

  test('a zero retry budget stops on the first 429 and waits for nothing', async () => {
    const h = harness({ l2: '429' }, { budget: { rateLimitBackoffMs: 60_000, maxRateLimitRetries: 0 } });
    const out = await collectRun(LINKS, h.deps);

    assert.equal(out.stoppedEarly, true);
    assert.deepEqual(h.slept, [], 'nothing may sleep once the run has decided to stop');
    assert.equal(out.threads.length, 1);
  });
});
