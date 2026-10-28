/**
 * FRESH, QUIET THREADS FIRST — an ORDER over threads that are already eligible, never a filter.
 *
 * MEASURED 2026-10-28 on production: 44 comments published 21–27 Oct. Of the 38 with a later score
 * check, 30 stayed at 1 (the automatic self-vote, which is not karma), 5 reached 2, 3 fell to 0, and
 * fleet karma rose about +4 in the week. Most of them sat in big, busy r/webdev threads. Nothing here
 * was ineligible — the ceilings (24h, 8 answers; src/opportunity.ts, src/warming.ts) held — but
 * inside those ceilings the three places that choose a thread all chose by something other than
 * "will anyone still read this":
 *
 *   src/pick.ts                  rankCandidates   gap score only — saturates, 7 of 14 at 100 (2026-07-23)
 *   src/commands/opportunity.ts  analysis queue   collected_at DESC, then .slice(0, 15)
 *   src/commands/warmup.ts       warmingCandidates youngest first, answer count ignored
 *
 * So the same two-tier rule is applied to all three: a thread under `freshThreadMaxAgeHours` with
 * at most `freshThreadMaxAnswers` answers comes before any thread that is not, then younger first.
 * It reorders and removes nothing, so a cycle with no fresh thread drafts exactly what it did before.
 *
 * Inputs are fields the scraper already stores (`ageMinutes` + `collectedAt` via currentAgeHours,
 * and `commentCount` from the shreddit-post `comment-count` attribute, src/reddit/scrape.ts:469).
 * No new request per thread.
 *
 * UNKNOWN IS NOT FRESH. A missing age or answer count is "not proven quiet", so it keeps its old
 * place in the second tier — the opposite choice to the ceilings, where unknown is not a violation.
 * Both are the conservative reading for what each one decides: a ceiling must not refuse on a
 * missing fact, and a preference must not be granted on one.
 */
import { policy } from './policy.js';
import { currentAgeHours } from './select.js';
import type { Thread } from './types.js';

type Facts = Pick<Thread, 'ageMinutes' | 'collectedAt' | 'commentCount'>;

export function isFresh(t: Facts, now: number = Date.now()): boolean {
  const age = currentAgeHours(t, now);
  return age != null && age <= policy.freshThreadMaxAgeHours.value &&
    t.commentCount != null && t.commentCount <= policy.freshThreadMaxAnswers.value;
}

/**
 * 0 = fresh, 1 = everything else. A sort key rather than a comparator so callers can chain their
 * own key between tier and age — rankCandidates puts the gap score there.
 */
export function freshTier(t: Facts, now: number = Date.now()): 0 | 1 {
  return isFresh(t, now) ? 0 : 1;
}

/** Younger first; unknown age last. */
export function byAge(a: Facts, b: Facts, now: number = Date.now()): number {
  return (currentAgeHours(a, now) ?? Infinity) - (currentAgeHours(b, now) ?? Infinity) || 0;
}

/**
 * The gap-analysis queue. src/commands/opportunity.ts analyzes at most 15 threads a run (~25-70 s of
 * model time each), and took them in collected_at order — so a batch of busy /hot threads collected
 * last could fill all 15 slots while a 2-hour-old, 1-answer thread waited a cycle and aged.
 */
export function analysisOrder<T extends Facts>(threads: readonly T[], now: number = Date.now()): T[] {
  return [...threads].sort((a, b) => freshTier(a, now) - freshTier(b, now) || byAge(a, b, now));
}
