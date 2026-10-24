/**
 * Removal-aware subreddit floor.
 *
 * KARMA_FLOOR_SUBS (src/autopublish.ts) is a static seed of subreddits an unattended account under
 * the karma floor skips. Measured on cardinal 2026-10-24: every reply-marked-removed observation
 * (4 of them) was in r/Wordpress, the one sub in the seed. But the seed is hardcoded: a DIFFERENT
 * sub that starts removing our comments floors only the account that personally reached
 * policy.removalsBeforeStop (src/health.ts), never the rest of the fleet, until each account is
 * removed there in turn.
 *
 * This derives the floor from what was actually observed: any subreddit with at least
 * thresholdCount removals (across all accounts, over the window the caller already filtered to) is
 * floored for every account. The caller unions the result with the static seed, so behaviour never
 * regresses: it only ever floors MORE, never fewer.
 */

/** The same permalink shape redditPlacement reads in src/autopublish.ts, kept identical so a
    permalink that names a sub to the gate names the same sub here. */
const SUBREDDIT_IN_PERMALINK = /\/r\/([A-Za-z0-9_]+)(?:[/?#]|$)/;

export function subredditOfPermalink(permalink: string | null | undefined): string | null {
  const m = SUBREDDIT_IN_PERMALINK.exec(permalink ?? "");
  return m ? m[1]!.toLowerCase() : null;
}

export function flooredSubsFromRemovals(
  removals: ReadonlyArray<{ permalink: string | null | undefined }>,
  thresholdCount: number
): Set<string> {
  const counts = new Map<string, number>();
  for (const r of removals) {
    const sub = subredditOfPermalink(r.permalink);
    if (sub) counts.set(sub, (counts.get(sub) ?? 0) + 1);
  }
  const floored = new Set<string>();
  for (const [sub, n] of counts) if (n >= thresholdCount) floored.add(sub);
  return floored;
}
