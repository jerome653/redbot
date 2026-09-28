/**
 * The per-thread collection loop, with the one thing it was missing: a 429 is a signal, not a skip.
 *
 * WHAT WENT WRONG. `read` opened each permalink inside a try/catch that turned ANY failure into
 * `skipped++` and a line of output, and `collectThread` returns null — also a skip — when the page
 * has no title. Reddit's rate-limit page has no title and does not throw, so a throttled read
 * walked the whole list, skipped every remaining thread, and exited 0. Clark's machine, 2026-08-21:
 * r/web_design took 417.6s (baseline ~120s) and r/SEO lost 2 of 15 threads, and both runs are
 * recorded as SUCCESS. Worse, `read` is the highest-volume path in the product and the ONLY one
 * that never wrote a `ratelimit` row — `session`, `reply` and `observe` all do — so health.ts:204
 * and metrics.ts:133, which count exactly those rows, could not see the throttling that matters
 * most.
 *
 * `config.budget.rateLimitBackoffMs` and `maxRateLimitRetries` have described this behaviour since
 * DEFECT-02 in July and no code read either of them. They are read here.
 *
 * The loop takes its browser work as callbacks rather than a Page, because the decisions worth
 * testing — back off, retry once, stop rather than burn the rest of the list — are decisions about
 * counting, and a test for them should not need Chromium.
 */
import { config } from '../config.js';
import { sleep as realSleep, between } from '../pacing.js';
import type { Thread } from '../types.js';

export interface CollectOutcome {
  threads: Thread[];
  /** Threads that were unreachable or had no title, and are not rate-limit casualties. */
  skipped: number;
  /** How many times the run was told it is going too fast. */
  rateLimitHits: number;
  /** True when the run gave up with links still on the list. */
  stoppedEarly: boolean;
  /** How many links were never opened, because the run stopped. */
  notAttempted: number;
}

export interface CollectDeps {
  /** Open one permalink. Returns null when the page is not a readable thread. */
  fetch(link: string): Promise<Thread | null>;
  /** Ask the live page whether Reddit is rate-limiting us right now. */
  rateLimited(): Promise<boolean>;
  /** Called on every 429, before any backoff. The caller writes the history row. */
  onRateLimit(link: string, hit: number): Promise<void>;
  onThread?(t: Thread, index: number, total: number): void;
  onSkip?(link: string, index: number, total: number, why: string): void;
  /** Announced before a backoff so a long silence has a reason on screen. */
  onBackoff?(ms: number, hit: number): void;
  sleep?(ms: number): Promise<void>;
  /**
   * Deliberate pacing between opens — a DIFFERENT fact from `sleep`, which is the 429 backoff.
   * Kept separate so "waited because Reddit refused us" and "waited on purpose" stay
   * distinguishable in a test and in a log; collapsing them is how a paced run and a throttled
   * run come to look identical.
   */
  pace?(ms: number): Promise<void>;
  budget?: { rateLimitBackoffMs: number; maxRateLimitRetries: number };
  pacing?: { minActionMs: number; maxActionMs: number; burstEvery: number; burstPauseMs: number };
}

export async function collectRun(links: string[], deps: CollectDeps): Promise<CollectOutcome> {
  const sleep = deps.sleep ?? realSleep;
  const pace = deps.pace ?? realSleep;
  const budget = deps.budget ?? config.budget;
  const pacing = deps.pacing ?? config.pacing;
  const threads: Thread[] = [];
  let skipped = 0;
  let rateLimitHits = 0;
  let retriesUsed = 0;

  for (const [i, link] of links.entries()) {
    /**
     * PACE BETWEEN OPENS. This loop is the highest-request-rate path in the product — 15 page
     * opens per subreddit, 11 subreddits and 13 searches per cycle — and it ran with no pacing at
     * all, while src/reddit/actions.ts calls `pause()` ten times on the reply path, which makes
     * the fewest requests of anything here.
     *
     * The envelope was already measured and already in config, unread. config.ts:456-458:
     * "DEFECT-02 (2026-07-22): the previous values (900-2600 ms) produced HTTP 429 after roughly
     * 75 page loads in a few minutes." And config.ts:467-468 defines `burstEvery: 8` /
     * `burstPauseMs: 20_000` with the comment "extra pause after every N thread fetches" — grep
     * found no reader for either anywhere in the tree.
     *
     * MEASURED 2026-09-28: 6 subreddits x 15 links = 90 page loads, 429 at 00:56:06, then 25
     * sources dead in 27 seconds (see src/collect-wall.ts). The config predicted that failure at
     * ~75 loads three months before it happened; nothing read the prediction.
     *
     * `i > 0` because pacing is the gap BETWEEN requests: charging the first open 3.2s buys
     * nothing. The burst pause rides on the same `i > 0`, so a run shorter than `burstEvery`
     * never takes one.
     */
    if (i > 0) {
      await pace(between(pacing.minActionMs, pacing.maxActionMs));
      if (i % pacing.burstEvery === 0) await pace(pacing.burstPauseMs);
    }

    /* One attempt, plus at most one more after a backoff — the retry budget is per RUN, not per
       thread, because being throttled is a property of the account and the minute, not the link. */
    let thread: Thread | null = null;
    let attempted = false;

    for (;;) {
      let failure: string | null = null;
      try {
        thread = await deps.fetch(link);
      } catch (e) {
        thread = null;
        failure = e instanceof Error ? e.message.slice(0, 60) : String(e);
      }
      attempted = true;

      if (thread) break;

      /* A missing thread is either a 429 page or a genuinely unreadable one, and only the live
         page can say which. Asking costs one DOM read and is what separates "went too fast" from
         "that post was deleted". */
      const throttled = await deps.rateLimited().catch(() => false);
      if (!throttled) {
        skipped++;
        deps.onSkip?.(link, i, links.length, failure ?? 'no title found');
        break;
      }

      rateLimitHits++;
      await deps.onRateLimit(link, rateLimitHits);

      if (retriesUsed >= budget.maxRateLimitRetries) {
        /* Continuing would open every remaining link against a page that is refusing us — the
           behaviour that turned a throttled read into seven minutes of skips. */
        return {
          threads, skipped, rateLimitHits,
          stoppedEarly: true,
          notAttempted: links.length - i - 1
        };
      }
      retriesUsed++;
      deps.onBackoff?.(budget.rateLimitBackoffMs, rateLimitHits);
      await sleep(budget.rateLimitBackoffMs);
      /* Loop back and open the SAME link again — the one the throttle cost us. */
    }

    if (thread && attempted) {
      threads.push(thread);
      deps.onThread?.(thread, i, links.length);
    }
  }

  return { threads, skipped, rateLimitHits, stoppedEarly: false, notAttempted: 0 };
}
