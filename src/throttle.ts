/**
 * What redbot does when Reddit says no: wait longer, leave that source alone, and carry on.
 *
 * MEASURED from the live `history` table, 2026-11-03 — two whole cycles of collection lost in one
 * day:
 *
 *   13:09:44Z  ratelimit  429 while collecting r/webhosting
 *   20:08:39Z  ratelimit  429 while collecting r/Wordpress
 *   20:28:16Z  error      search preview "agency websites" failed: net::ERR_HTTP_RESPONSE_CODE_FAILURE
 *   23:49:21Z  ratelimit  429 during read of r/bigseo
 *   23:49:22Z  ratelimit  429 during read of r/webdev
 *   23:49:22Z  ratelimit  collection abandoned after 2 failures in a row
 *
 * Three defects, one second apart at the end:
 *
 *   1. THE WAIT NEVER GREW. `config.budget.rateLimitBackoffMs` is one number and
 *      `maxRateLimitRetries` is 1, so a host that is still refusing is asked again on exactly the
 *      schedule that was already refused. `backoffMs` doubles it, bounded, with jitter that only
 *      ever adds — the SGEN standing rule is that we may lengthen a wait and never shorten one.
 *   2. THE SOURCE THAT REFUSED US WAS RE-READ. r/webhosting at 13:09 and r/Wordpress at 20:08 were
 *      both back in the next cycle's list unchanged. `cooledSources` / `planSources` leave a
 *      source alone for `SOURCE_COOLDOWN_MS` after it 429s, and say so in `history`.
 *   3. A THROTTLE WORE AN `error` ROW. The 20:28 search row is a 429 by another name — Playwright
 *      reports a navigation that died on one as `net::ERR_HTTP_RESPONSE_CODE_FAILURE` — so the
 *      abandon rule counted it as a fault and health.ts could not see it at all.
 *      `looksThrottled` is the one place that classification lives.
 *
 * Everything here is arithmetic over strings and timestamps, so the rules can be exercised without
 * a browser, a session or a live 429 — the same argument src/collect-wall.ts makes for itself.
 */
import type { HistoryEntry } from './types.js';

/**
 * How a throttle looks when it does NOT arrive as a 429 we can read off the page.
 *
 * Chromium refuses to render a response it cannot show and Playwright surfaces that as
 * ERR_HTTP_RESPONSE_CODE_FAILURE — the 20:28:16 row above, which is a rate-limit page reaching us
 * as a navigation error. Matching on the message is a proxy, and a deliberately narrow one: only
 * the shapes measured on this install are here, so an unknown fault stays a fault.
 */
const THROTTLE_SIGNS: readonly RegExp[] = [
  /ERR_HTTP_RESPONSE_CODE_FAILURE/i,
  /\b429\b/,
  /too many requests/i
];

export function looksThrottled(message: string): boolean {
  return THROTTLE_SIGNS.some((re) => re.test(message));
}

/** How much of the computed wait may be added as jitter, at most. */
export const BACKOFF_JITTER = 0.1;

export interface BackoffOpts {
  /** The wait for the FIRST refusal — the existing measured value, and the floor. */
  baseMs: number;
  /** The ceiling the doubling may not pass. */
  maxMs: number;
  random?: () => number;
}

/**
 * How long to wait after the `hit`th refusal in a run. `hit` is 1-based.
 *
 * `base * 2^(hit-1)`, capped at `maxMs`, plus up to 10% jitter. Jitter is one-sided ON PURPOSE: a
 * +/- jitter would, half the time, ask a refusing host again sooner than the envelope measured in
 * DEFECT-02 allows, and "never shorten an existing delay" is a floor, not a preference. So hit 1
 * waits at least exactly what this install waits today.
 */
export function backoffMs(hit: number, opts: BackoffOpts): number {
  const random = opts.random ?? Math.random;
  const steps = Math.max(0, Math.floor(hit) - 1);
  const grown = opts.baseMs * 2 ** Math.min(steps, 30);
  const capped = Math.max(opts.baseMs, Math.min(grown, opts.maxMs));
  return capped + Math.round(capped * BACKOFF_JITTER * Math.min(Math.max(random(), 0), 1));
}

/**
 * How long a subreddit is left alone after it refuses us.
 *
 * 90 minutes. The measured recovery from a single 429 was under 5 minutes (src/policy.ts:168), so
 * this is not a recovery estimate — it is the distance between this cycle and a few of the next
 * ones, because the cost of re-asking a source that just said no is paid by every OTHER source in
 * the cycle. Deliberately not tunable from the environment, for the reason
 * CONSECUTIVE_FAILURES_TO_ABORT gives in src/collect-wall.ts: a number that can be lowered from
 * outside is a number that gets lowered the first time it is inconvenient.
 */
export const SOURCE_COOLDOWN_MS = 90 * 60_000;

/**
 * True when a `ratelimit` row is one of OUR cooldown skips rather than a refusal from Reddit.
 *
 * The skip is filed as `ratelimit` so it sits where an operator already looks for throttling. That
 * makes two exclusions necessary and both are load-bearing: `cooledSources` below (or one 429
 * would renew its own cooldown for ever and silently retire the source) and the read-429 counters
 * in src/health.ts and src/metrics.ts (or our own decision would be counted as Reddit's refusal).
 */
export function isCooldownSkip(e: HistoryEntry): boolean {
  return (e.data as { cooldownSkip?: unknown } | undefined)?.cooldownSkip === true;
}

export interface CooledSource {
  /** ISO timestamp of the 429 that started the cooldown. */
  lastAt: string;
  /** Epoch ms at which this source may be read again. */
  untilMs: number;
}

/**
 * Which sources are still cooling off, keyed by lower-cased subreddit name.
 *
 * READ-PATH ROWS ONLY. `ratelimit` carries two unrelated facts and conflating them blocked every
 * publish on this install for nine days (src/health.ts:275); a publish-path 429 says nothing about
 * whether a subreddit can be collected.
 */
export function cooledSources(
  history: readonly HistoryEntry[], now: Date, cooldownMs: number
): Map<string, CooledSource> {
  const out = new Map<string, CooledSource>();
  for (const e of history) {
    if (e.kind !== 'ratelimit' || isCooldownSkip(e)) continue;
    if ((e.data as { stage?: unknown } | undefined)?.stage === 'publish') continue;
    const name = (e.subreddit ?? '').replace(/^\/?r\//i, '').toLowerCase();
    if (!name) continue;
    const at = new Date(e.ts).getTime();
    if (!Number.isFinite(at)) continue;
    const untilMs = at + cooldownMs;
    if (untilMs <= now.getTime()) continue;
    const seen = out.get(name);
    if (!seen || untilMs > seen.untilMs) out.set(name, { lastAt: e.ts, untilMs });
  }
  return out;
}

export interface SourcePlan {
  /** Subreddit names to read this cycle, in the order given. */
  read: string[];
  skipped: Array<{ name: string; why: string; lastAt: string; untilMs: number }>;
}

/**
 * This cycle's subreddit list, minus the ones that refused us recently.
 *
 * ONE SOURCE IS ALWAYS ATTEMPTED. If every configured source is cooling off, skipping them all
 * would collect nothing — and `collected: 0` reads identically to a quiet hour, which is the half
 * of the 2026-09-28 defect that cost the posts (src/collect-wall.ts). So the longest-cooled source
 * is tried anyway; it is the one most likely to have recovered, and one request is not a burst.
 */
/**
 * The `history` row that records a cooldown skip, so a short collection can be told from a quiet
 * hour — the half of the 2026-09-28 defect that cost the posts (src/collect-wall.ts).
 *
 * `ratelimit`, because that is where an operator already looks for throttling, and
 * `cooldownSkip: true` because it is redbot's own decision rather than Reddit's refusal. That flag
 * is load-bearing in three places: `cooledSources` above (or one 429 would renew its own cooldown
 * for ever and silently retire the source), src/health.ts and src/metrics.ts (or correct behaviour
 * would be counted as being rate-limited). `status: 'unknown'` for the same reason — nothing was
 * blocked here, we chose to wait.
 */
export function cooldownSkipRow(s: SourcePlan['skipped'][number]): {
  kind: 'ratelimit'; summary: string; data: Record<string, unknown>;
} {
  return {
    kind: 'ratelimit',
    summary: s.why,
    data: {
      subreddit: s.name, status: 'unknown', stage: 'read',
      cooldownSkip: true, lastRateLimitAt: s.lastAt, until: new Date(s.untilMs).toISOString()
    }
  };
}

export function planSources(
  names: readonly string[], history: readonly HistoryEntry[], now: Date,
  cooldownMs: number = SOURCE_COOLDOWN_MS
): SourcePlan {
  const cooled = cooledSources(history, now, cooldownMs);
  const plan: SourcePlan = { read: [], skipped: [] };
  for (const name of names) {
    const hit = cooled.get(name.replace(/^\/?r\//i, '').toLowerCase());
    if (!hit) { plan.read.push(name); continue; }
    const mins = Math.max(1, Math.round((hit.untilMs - now.getTime()) / 60_000));
    plan.skipped.push({
      name, lastAt: hit.lastAt, untilMs: hit.untilMs,
      why: `r/${name} skipped — it answered 429 at ${hit.lastAt} and is cooling off for another `
        + `${mins} min, so this cycle reads the other sources instead of asking it again`
    });
  }
  if (plan.read.length === 0 && plan.skipped.length > 0) {
    plan.skipped.sort((a, b) => a.untilMs - b.untilMs);
    plan.read.push(plan.skipped.shift()!.name);
  }
  return plan;
}
