/**
 * Warming — the rules that keep an account alive, enforced mechanically.
 *
 * ## Why this is priority one
 *
 * Everything redbot does runs through an account. If an account gets flagged, nothing else in
 * this repository matters — the pipeline, the gates, the certification engine all become
 * decoration around a login that Reddit ignores. Warming is the lifeline.
 *
 * MEASURED 2026-07-27: `publish.ok` rows in the history log = **0**. Not one comment has ever
 * been posted by either account, by redbot or by hand. Karma is still 1, exactly where it
 * started on 2026-07-22. `ACCOUNT-WARMING.md` has prescribed the protocol since day one and
 * **none of it has ever been executed.** That is why votes are discarded: not a penalty, not a
 * block — an account that has never been used.
 *
 * ## What this module is
 *
 * `ACCOUNT-WARMING.md` states the stage-1 rules in prose. Prose does not stop anything. This
 * turns each one into a check that runs before a warming comment can be published, on the same
 * principle the rest of the codebase already follows: a rule nothing enforces is a note.
 *
 * ## What warming is NOT
 *
 * It is not the contribution pipeline aimed at easier threads. A warming comment exists to make
 * the account look like a person who reads this subreddit — short, useful, unremarkable. It
 * carries no links, no product names, and nothing that would read as marketing to a moderator
 * skimming a new account's history. The contribution pipeline's job is to add something nobody
 * else has said; warming's job is to be ordinary.
 */
import { policy } from './policy.js';
import { config } from './config.js';
import { assessClaims } from './claims.js';

export interface WarmingIssue {
  rule: string;
  detail: string;
}

export interface WarmingVerdict {
  ok: boolean;
  issues: WarmingIssue[];
  warnings: string[];
}

/**
 * Anything that reads as a link. Stage 1 is explicit: *"Zero links. Zero product names. Zero
 * company mention. Even a helpful link this early reads as promotion."*
 *
 * Deliberately broad — bare domains and markdown links both count, because a moderator skimming
 * a two-day-old account's history is not parsing syntax, they are pattern-matching on "is this
 * person here to help or to sell".
 */
const LINK_PATTERNS: RegExp[] = [
  /https?:\/\//i,
  /\bwww\./i,
  /\]\([^)]*\)/,                       // markdown link
  /\b[a-z0-9-]+\.(com|net|org|io|dev|co|app|sh|ai)\b/i
];

/**
 * Words that make a warming comment read as marketing. The brand list comes from config so it
 * stays in step with `forbidMention`; the rest are the generic tells.
 */
function promotionalTerms(): string[] {
  const brand = [config.brand?.org]
    .filter((s): s is string => typeof s === 'string' && s.length > 1);
  return [
    ...brand,
    'my product', 'our product', 'my tool', 'our tool', 'my company', 'our company',
    'my saas', 'we built', 'i built a', 'check out my', 'try our', 'sign up',
    'discount', 'free trial', 'affiliate'
  ];
}

/**
 * A warming comment must be short.
 *
 * An essay from a two-day-old account is conspicuous in a way a two-line answer is not. This is
 * lower than the contribution pipeline's ceiling on purpose — they are different jobs.
 */
export const WARMING_MAX_WORDS = 120;
export const WARMING_MIN_WORDS = 12;

export function checkWarmingComment(body: string): WarmingVerdict {
  const issues: WarmingIssue[] = [];
  const warnings: string[] = [];
  const text = body.trim();
  const words = text.split(/\s+/).filter(Boolean).length;

  for (const re of LINK_PATTERNS) {
    if (re.test(text)) {
      issues.push({
        rule: 'no-links',
        detail: 'a warming comment carries no links at all — even a helpful one reads as promotion from a new account'
      });
      break;
    }
  }

  const lower = text.toLowerCase();
  for (const term of promotionalTerms()) {
    if (lower.includes(term.toLowerCase())) {
      issues.push({ rule: 'no-promotion', detail: `contains "${term}" — warming comments never mention a product or company` });
      break;
    }
  }

  if (words > WARMING_MAX_WORDS) {
    issues.push({
      rule: 'too-long',
      detail: `${words} words — an essay from a new account is conspicuous; keep warming comments under ${WARMING_MAX_WORDS}`
    });
  }
  if (words < WARMING_MIN_WORDS) {
    issues.push({ rule: 'too-short', detail: `${words} words — too thin to be worth a stranger's attention` });
  }

  /**
   * A warming comment that asserts a lot of checkable behaviour is a warming comment that can be
   * publicly wrong, and being publicly wrong on a two-day-old account is the fastest way to the
   * outcome this whole module exists to avoid. Warned rather than blocked: the claim budget is a
   * provisional number and has no business refusing a publish on its own.
   */
  const claims = assessClaims(text);
  if (claims.unhedged.length > 2) {
    warnings.push(
      `${claims.unhedged.length} unhedged factual claims — for warming, prefer answering from ` +
      `experience or asking a clarifying question over asserting how software behaves`
    );
  }

  return { ok: issues.length === 0, issues, warnings };
}

/* ------------------------------------------------------------------ *
 * Pace
 * ------------------------------------------------------------------ */

export interface PaceInput {
  /** Warming comments already published by this account today. */
  publishedToday: number;
  /** Minutes since the last warming comment, or null if there has never been one. */
  minutesSinceLast: number | null;
  karma: number | null;
}

/**
 * Stage 1 pace: 2–4 comments a day, spaced out.
 *
 * The ceiling is the account's own daily cap where one is configured, because an account may
 * lower it but must never raise it — the same rule the publish window already enforces.
 */
export function checkWarmingPace(input: PaceInput): WarmingVerdict {
  const issues: WarmingIssue[] = [];
  const warnings: string[] = [];

  const ceiling = policy.maxRepliesPerDay.value;
  if (input.publishedToday >= ceiling) {
    issues.push({
      rule: 'daily-ceiling',
      detail: `${input.publishedToday} already today (ceiling ${ceiling}) — warming is a marathon, and a burst is the signal it is meant to avoid`
    });
  }

  const gap = policy.minMinutesBetweenReplies.value;
  if (input.minutesSinceLast !== null && input.minutesSinceLast < gap) {
    issues.push({
      rule: 'spacing',
      detail: `${Math.round(input.minutesSinceLast)} minutes since the last one (minimum ${gap}) — comments arriving in a cluster read as automation`
    });
  }

  if (input.karma !== null && input.karma >= policy.cautionKarmaBelow.value) {
    warnings.push(
      `karma ${input.karma} is at or above the caution threshold — the account may be past ` +
      `stage 1, so warming rules can relax to normal operation`
    );
  }

  return { ok: issues.length === 0, issues, warnings };
}

/* ------------------------------------------------------------------ *
 * Thread selection
 * ------------------------------------------------------------------ */

export interface WarmingTarget {
  ageHours: number | null;
  commentCount: number | null;
  subreddit: string;
  title: string;
}

/**
 * Which threads are worth a warming comment.
 *
 * The protocol's own guidance: threads **under 2 hours old** so the comment is read rather than
 * buried, and threads with **few existing answers** — a good reply to an unanswered question is
 * worth more than the tenth reply to a popular one. Both are about being seen by humans, which
 * is the only thing that moves karma.
 */
export function isWarmingTarget(t: WarmingTarget): { ok: boolean; why: string } {
  if (t.ageHours === null) {
    return { ok: false, why: 'thread age unknown — cannot tell whether a comment would be read' };
  }
  if (t.ageHours > 2) {
    return { ok: false, why: `${Math.round(t.ageHours)}h old — past 2h a new comment is buried and earns nothing` };
  }
  if (t.commentCount !== null && t.commentCount > 8) {
    return { ok: false, why: `${t.commentCount} answers already — a reply here is the eleventh voice, not the first` };
  }
  return {
    ok: true,
    why: `${Math.round(t.ageHours)}h old with ${t.commentCount ?? 'unknown'} answers — early enough to be read`
  };
}
