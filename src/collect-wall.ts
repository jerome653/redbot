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
