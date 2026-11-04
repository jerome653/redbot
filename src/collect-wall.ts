import { OK, NOTHING_TO_DO, THROTTLED } from './exit-codes.js';

/**
 * When a run of failed sources means Reddit is REFUSING, not that one source is quiet.
 *
 * `src/commands/auto.ts` collected every configured source unconditionally:
 *
 *     for (const s of subs) { await read(s); }
 *     for (const q of queries) { await search(q); }
 *
 * Both functions return 0 on success and 1 on failure — `read()` at src/commands/read.ts:68 for a
 * 429 that survived its retry, :81 for a block page, :125 for a navigation that died on one — and
 * both return values were discarded. So once Reddit started refusing, the cycle walked the rest of
 * the list and navigated into the wall once per source.
 *
 * MEASURED 2026-09-28, one cycle, account ryangrowth12:
 *
 *   00:56:06  first 429, while collecting r/bigseo
 *   00:57:36  r/CMS            ERR_HTTP_RESPONSE_CODE_FAILURE
 *   00:57:37  r/Entrepreneur   ERR_HTTP_RESPONSE_CODE_FAILURE
 *   …         11 subreddits then 13 searches, every one of them
 *   00:58:03  "too many tools" ERR_HTTP_RESPONSE_CODE_FAILURE
 *
 * 25 sources in 27 seconds, every one a fresh request to a host that had just said no. That is the
 * exact opposite of the backoff src/reddit/collect-run.ts implements WITHIN a source, and it is
 * why `config.budget.rateLimitBackoffMs` bought nothing: the retry budget is spent per source, and
 * nothing held the budget ACROSS sources.
 *
 * THE SECOND HARM IS THE ONE THAT COST THE POSTS. With every fresh read failing, `collected`
 * comes to 0 and reads identically to a quiet hour — so `opportunity()` scored only rows left over
 * from earlier cycles, and a row scored hours after it was written is what produced the
 * `warming:target` refusal that src/opportunity.ts:130 documents. A wall that looks like silence
 * is the same defect class as the 429 that looked like a publish cooldown (src/health.ts).
 *
 * WHY A PURE FUNCTION. The rule has to be exercised without a browser, a session or a live 429,
 * or it stops being exercised — the argument src/autopublish.ts makes at length for the same
 * reason. auto.ts carries the loop; every judgement is here.
 */

/**
 * How many sources must fail BACK TO BACK before the cycle gives up on collecting.
 *
 * Two, not one. One failure is ordinary: a subreddit can be private, renamed, empty, or served a
 * slow page — r/Wordpress_Development returned "0 threads, 0 new" in the measured cycle and that
 * is a success, not a wall. Two in a row is not a property of two unrelated sources; it is a
 * property of the host. Deliberately NOT tunable by env: a number that can be raised from outside
 * is a number that gets raised the first time it fires.
 */
export const CONSECUTIVE_FAILURES_TO_ABORT = 2;

export interface WallVerdict {
  abort: boolean;
  /** Why, in words that go into the history row. Never empty when `abort` is true. */
  why: string;
}

/**
 * @param failuresInARow  consecutive non-zero exit codes from read()/search() so far
 * @param done            sources already attempted
 * @param total           sources configured for this cycle
 */
export function hitCollectionWall(failuresInARow: number, done: number, total: number): WallVerdict {
  if (failuresInARow < CONSECUTIVE_FAILURES_TO_ABORT) {
    return { abort: false, why: '' };
  }
  const left = Math.max(0, total - done);
  return {
    abort: true,
    why: `${failuresInARow} sources failed back to back — Reddit is refusing this account, `
      + `so ${left} remaining source(s) were not attempted rather than navigated into the wall`
  };
}

/**
 * WHAT TWO FAILURES ACTUALLY WERE, measured 2026-11-03 at 23:49:21Z and 23:49:22Z:
 *
 *   ratelimit  429 during read of r/bigseo
 *   ratelimit  429 during read of r/webdev
 *   ratelimit  collection abandoned after 2 failures in a row
 *
 * One second apart, both of them Reddit saying "slow down", and the rule above read them as
 * "Reddit is refusing this account" and threw the rest of the cycle away. Two cycles went that way
 * on 3 November alone. The rule was not wrong about the host; it was wrong about the REMEDY — a
 * throttle is answered by waiting and by leaving that source alone (src/throttle.ts), and the
 * sources that have not refused us are still collectable.
 *
 * So the count is split. A FAULT is a source that broke: a block page, an unreadable feed, a
 * navigation that died for a reason that is not a 429. Two of those back to back is still the host
 * refusing this account, and still aborts — unchanged, including its wording and its threshold. A
 * THROTTLE is pacing, and pacing never abandons a run on its own.
 */

/**
 * How many sources must be throttled BACK TO BACK before the cycle stops collecting.
 *
 * Four, and it is a different number from the fault threshold because it answers a different
 * question. Two throttled sources mean we were going too fast; by the fourth consecutive one,
 * every source we have tried since the first refusal has also been refused despite a growing
 * backoff between them, and the throttle is account-wide rather than per-source. Strictly greater
 * than CONSECUTIVE_FAILURES_TO_ABORT, so the measured case — two throttled reads — can never
 * abandon a cycle again.
 */
export const CONSECUTIVE_THROTTLES_TO_ABORT = 4;

/** What one source's exit code meant. */
export type SourceOutcome = 'ok' | 'nothing' | 'throttled' | 'fault';

/**
 * A source's exit code, read as one of the four things it can mean.
 *
 * `NOTHING_TO_DO` is not a failure and never was (src/exit-codes.ts) — a search that found nothing
 * usable is a legitimate answer, which src/test/search.test.ts:124 already says must not be read as
 * Reddit refusing. `THROTTLED` is the code this change adds so the distinction survives the
 * boundary between a command and the cycle that called it.
 */
export function classifySourceExit(code: number): SourceOutcome {
  if (code === OK) return 'ok';
  if (code === NOTHING_TO_DO) return 'nothing';
  if (code === THROTTLED) return 'throttled';
  return 'fault';
}

export interface CollectRunState {
  /** consecutive non-throttle failures */
  faultsInARow: number;
  /** consecutive throttles */
  throttlesInARow: number;
  done: number;
  total: number;
}

/**
 * Whether the cycle should stop collecting, given what the last few sources did.
 *
 * Faults are judged by `hitCollectionWall`, unchanged. Throttles get their own, higher threshold
 * and their own words, because the two abandonments send a person to different places: a fault
 * wall means look at the account, and a throttle wall means look at the rate.
 */
export function collectionWall(s: CollectRunState): WallVerdict {
  const fault = hitCollectionWall(s.faultsInARow, s.done, s.total);
  if (fault.abort) return fault;
  if (s.throttlesInARow < CONSECUTIVE_THROTTLES_TO_ABORT) return { abort: false, why: '' };
  const left = Math.max(0, s.total - s.done);
  return {
    abort: true,
    why: `${s.throttlesInARow} sources in a row were throttled even with a growing backoff `
      + `between them — this is a rate limit on the account, not on one source, so ${left} `
      + `remaining source(s) were left for the next cycle rather than asked now`
  };
}

export interface SourceRun {
  /** What to show before it runs. */
  step: string;
  run: () => Promise<number>;
}

export interface RunSourcesDeps {
  step?(line: string): void;
  warn?(line: string): void;
  /** Writes the one history row that says the cycle stopped collecting, and why. */
  onAbandon(why: string, info: {
    abandoned: number; attempted: number; configured: number; reason: 'fault' | 'throttle';
  }): Promise<void>;
  /** Announced before a wait, so a long silence on screen has a reason beside it. */
  onThrottleWait?(ms: number, throttlesInARow: number): void;
  sleep(ms: number): Promise<void>;
  /** How long to wait after the nth consecutive throttle — src/throttle.ts `backoffMs`. */
  backoff(throttlesInARow: number): number;
}

export interface RunSourcesOutcome {
  attempted: number;
  /** Sources never asked, because the cycle stopped. 0 when it ran the whole list. */
  abandoned: number;
  throttled: number;
  faults: number;
  /** Total time spent waiting because a source was throttled. */
  waitedMs: number;
}

/**
 * Walk this cycle's sources, waiting when Reddit throttles us and stopping only when something
 * is actually wrong.
 *
 * THE LOOP THIS REPLACES counted every non-zero exit the same way and had nothing to do with a
 * throttle except stop: two 429s one second apart ended collection for the whole cycle
 * (2026-11-03 23:49:22Z), twice that day. Here a throttle costs a growing wait and the source's
 * own cooldown (src/throttle.ts), and the sources that have not refused us are still collected.
 *
 * It takes its waiting and its recording as callbacks for the reason the rest of this file is a
 * pure function: the decisions worth testing are about counting, and a test for them must not
 * need a browser, a session or a live 429.
 */
export async function runSources(
  sources: readonly SourceRun[], deps: RunSourcesDeps
): Promise<RunSourcesOutcome> {
  let faultsInARow = 0;
  let throttlesInARow = 0;
  const out: RunSourcesOutcome = { attempted: 0, abandoned: 0, throttled: 0, faults: 0, waitedMs: 0 };

  for (let i = 0; i < sources.length; i++) {
    const wall = collectionWall({ faultsInARow, throttlesInARow, done: i, total: sources.length });
    if (wall.abort) {
      out.abandoned = sources.length - i;
      deps.warn?.(wall.why);
      await deps.onAbandon(wall.why, {
        abandoned: out.abandoned, attempted: i, configured: sources.length,
        reason: faultsInARow >= CONSECUTIVE_FAILURES_TO_ABORT ? 'fault' : 'throttle'
      });
      return out;
    }

    const src = sources[i]!;
    deps.step?.(src.step);
    const outcome = classifySourceExit(await src.run());
    out.attempted++;

    if (outcome === 'throttled') {
      throttlesInARow++;
      out.throttled++;
      faultsInARow = 0;
      /* WAIT, THEN CARRY ON. The wait is between SOURCES and is new — nothing paced them before,
         which is how 25 of them died in 27 seconds on 2026-09-28. It grows with the run of
         throttles, so the next source is asked later each time rather than abandoned. */
      if (i + 1 < sources.length) {
        const ms = deps.backoff(throttlesInARow);
        deps.onThrottleWait?.(ms, throttlesInARow);
        out.waitedMs += ms;
        await deps.sleep(ms);
      }
      continue;
    }

    throttlesInARow = 0;
    if (outcome === 'fault') { faultsInARow++; out.faults++; } else faultsInARow = 0;
  }
  return out;
}
