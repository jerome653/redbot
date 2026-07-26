/**
 * Part E — choosing the one thread.
 *
 * The pilot posts exactly one reply, so the choice has to be defensible in writing. Each
 * criterion from the brief is a separate predicate with its own verdict, and a candidate
 * carries the full breakdown rather than a single number — "it scored 82" explains nothing
 * to the person who has to approve it.
 *
 * Three of the criteria are proxies, and are labelled as such in the output:
 *
 *   "no existing high-quality accepted answer" — Reddit does not expose per-comment scores
 *     on the rendered thread page, so this is approximated by comment volume and the length
 *     of the longest existing comment. A long, detailed comment usually means the ground is
 *     covered. It can be wrong in both directions.
 *
 *   "expertise match" — the thread's own vocabulary against the declared areas
 *     (src/competence.ts). It cannot tell whether an answer would be correct.
 *
 *   "answerable without recommending a product" — the asker's own wording.
 *
 * CHANGED 2026-07-23 (D-01). This module used to read the Phase-1 triage record, and two of its
 * criteria were model self-assessments consumed as input: expertise match was
 * `opp.confidence >= 70`, and the no-pitch check was the model's own `answerableWithoutPitch`
 * boolean. Both came from the same call that produced DEFECT-12. Both now measure the thread.
 */
import { policy } from './policy.js';
import { assessCompetence } from './competence.js';
import type { Thread, OpportunityAssessment } from './types.js';

export interface Criterion {
  name: string;
  pass: boolean;
  detail: string;
  /** True when the check is an approximation rather than a direct observation. */
  proxy?: boolean;
}

export interface Candidate {
  threadId: string;
  title: string;
  permalink: string;
  subreddit: string;
  /** The Opportunity Engine's score. There is no second number — `confidence` was the retired
   *  triage model's rating of its own certainty, and it is gone (D-01). */
  score: number;
  criteria: Criterion[];
  /** All criteria pass. */
  eligible: boolean;
}

/**
 * Subreddits this account has any business posting in. Deliberately narrow for the pilot:
 * one reply, in a room whose rules we have actually read (r/WordPress rule 1 — no promotion
 * of products or services — is recorded in STATUS.md).
 */
export const PILOT_SUBREDDITS = ['wordpress', 'wordpress_help', 'webdev'] as const;

/**
 * Titles that announce content rather than ask for help.
 *
 * DEFECT-12 (2026-07-23): the highest-ranked pilot candidate was
 * "[Guide] Complete cleanup and securing of WordPress after REST Batch API (wp2shell) attack" —
 * scored priority 72, confidence 90. GATE A of the analyze rubric says a guide scores 5. The
 * model did not apply it, and wrote a rationale for the score it had already chosen
 * ("engineers can verify completeness").
 *
 * The fix is mechanical rather than another prompt revision: a prompt is a request and models
 * drift, but a bracket tag in a title is a fact about a string. Same reasoning as the linter.
 */
const ANNOUNCEMENT_TAG = /^\s*[\[(]\s*(?:guide|tutorial|psa|announcement|showcase|resource|release|update|news|meta|discussion|poll|megathread|promo|promotion|oc|wip|hiring|for hire)\s*[\])]/i;

/** Phrasings that ask for help without a question mark. */
const HELP_SHAPED = [
  /\bhow (?:do|can|would|should) i\b/i,
  /\bany (?:idea|advice|suggestions|help)\b/i,
  /\b(?:is|are|does|do|can|should|why|what|which|where|when)\b[^.?!]{0,80}\?/i,
  /\bnot working\b|\bdoesn'?t work\b|\bstopped working\b/i,
  /\b(?:i'?m|im) (?:stuck|lost|struggling)\b/i,
  /\bcan'?t (?:get|figure|work|seem)\b/i,
  /\bissue with\b|\bproblem with\b|\btrouble with\b/i,
  /\bhelp\b/i,
  /\btried everything\b/i,
  // A bare symptom report is a request for help with the request left implicit —
  // "Sidebar widget throws a JSON error" is someone asking, in a support subreddit.
  /\b(?:error|errors|fails?|failing|failed|broken|breaks|crash(?:es|ing)?|throws?|timing out|timeout|blank page|white screen|50[023]|404)\b/i
];

/**
 * Is this thread someone asking for help, rather than someone publishing something?
 *
 * Deliberately generous on the help side and strict on the announcement side: missing a real
 * question costs one candidate, replying under a guide costs credibility.
 */
/**
 * Showcase and feedback posts, which are announcements without the bracket tag.
 *
 * DEFECT-13 (2026-07-23): "Redesigning my AI company's site, would appreciate honest feedback"
 * scored 90/100 and was assessed "contribute". It is not a technical question — it is someone
 * presenting work and inviting opinion, and answering it with a diagnosis is the wrong
 * register for the room. Same class as DEFECT-12, caught by the same kind of check.
 *
 * Anchored to "my <thing>" so that "any feedback on why this errors?" — a genuine question —
 * still passes.
 */
const SHOWCASE = [
  /\b(?:honest )?(?:feedback|thoughts|opinions|critique)\b[^.?!]{0,40}\bmy\b/i,
  /\bmy\b[^.?!]{0,40}\b(?:honest )?(?:feedback|thoughts|opinions|critique)\b/i,
  /\broast my\b/i,
  /\brate my\b/i,
  /\bcheck out my\b/i,
  /\bjust (?:launched|shipped|finished|built|released)\b/i,
  /\bwhat do you think of my\b/i,
  /\bshowing off\b/i,
  // PRODUCTION OBSERVATION 2026-07-23, fresh r/Wordpress collect: 3 of 15 threads were
  // [PROMO]-tagged (now in ANNOUNCEMENT_TAG) and one more — "A feedback about a search plugin
  // i'm about to launch" — is the same thing without a tag. Pre-launch announcements invite
  // opinion on unreleased work; they are not questions.
  /\b(?:about to|going to|planning to) (?:launch|release|ship)\b/i,
  /\ba feedback (?:about|on)\b/i
];

/**
 * Is the asker asking us to name a product?
 *
 * r/WordPress rule 1 is "No promotions of products or services". A thread whose question IS
 * "which one should I buy" cannot be answered by us at all: any honest answer names a product,
 * and naming one in that room is the violation.
 *
 * Replaced the triage model's `answerableWithoutPitch` flag on 2026-07-23 (D-01). That flag was
 * a prediction about an answer that did not exist yet, produced by the same call as the
 * DEFECT-12 score. This reads the request instead, which is a fact about a string.
 *
 * Proxy, and labelled as one: "what's the best caching plugin" is caught, "my caching plugin is
 * misbehaving" is not, and a recommendation request phrased without recommendation vocabulary
 * reaches the human at the approval prompt.
 */
const PRODUCT_REQUEST = [
  /\b(?:best|recommend(?:ed|ations?)?|suggest(?:ions?)?|favou?rite|top)\b[^.?!]{0,40}\b(?:plugins?|themes?|hosts?|hosting|builders?|tools?|services?|stack|providers?|companies|agenc(?:y|ies))\b/i,
  /\b(?:which|what)\b[^.?!]{0,30}\b(?:plugins?|themes?|hosts?|hosting|builders?|tools?|services?|providers?)\b[^.?!]{0,40}\b(?:should i|do you|would you|is best|are best|recommend)\b/i,
  /\b(?:any|anyone)\b[^.?!]{0,20}\brecommend/i,
  /\blooking for a\b[^.?!]{0,30}\b(?:plugins?|themes?|hosts?|hosting|builders?|tools?|services?|agenc(?:y|ies))\b/i
];

export function asksForAProduct(thread: Pick<Thread, 'title' | 'body'>): { matched: boolean; detail: string } {
  const text = `${thread.title}\n${thread.body ?? ''}`;
  const hit = PRODUCT_REQUEST.find((re) => re.test(text));
  if (!hit) return { matched: false, detail: 'the question does not ask for a product recommendation' };
  const m = hit.exec(text)?.[0]?.replace(/\s+/g, ' ').trim() ?? '';
  return {
    matched: true,
    detail: `the asker is asking what to use — "${m.slice(0, 70)}" — and naming one breaks the room's rules`
  };
}

export function isQuestionShaped(thread: Pick<Thread, 'title' | 'body'>): { pass: boolean; detail: string } {
  if (ANNOUNCEMENT_TAG.test(thread.title)) {
    const tag = ANNOUNCEMENT_TAG.exec(thread.title)?.[0]?.trim() ?? '';
    return { pass: false, detail: `title is tagged ${tag} — this publishes something, it does not ask` };
  }

  const showcase = SHOWCASE.find((re) => re.test(thread.title));
  if (showcase) {
    return {
      pass: false,
      detail: 'the title presents work and invites opinion — a showcase, not a technical question'
    };
  }

  const text = `${thread.title}\n${thread.body ?? ''}`;
  if (text.includes('?')) return { pass: true, detail: 'contains a direct question' };

  const hit = HELP_SHAPED.find((re) => re.test(text));
  if (hit) return { pass: true, detail: 'phrased as a request for help without a question mark' };

  return { pass: false, detail: 'no question and no request for help — nothing is being asked' };
}

/**
 * How old the thread is **now**, not how old it was when we collected it.
 *
 * PRODUCTION OBSERVATION 2026-07-23: `thread.ageMinutes` is stamped once, at collection.
 * Measured on thread c14d9d8caa0e — stored 17.8h, true age 28.3h, because the corpus had sat
 * for 10.6h. The stale-thread gate enforces a 72h ceiling against the stored number, so a
 * thread collected at 70h and drafted a day later publishes as "70h" while actually being
 * ~95h old. The gate does not fail loudly; it passes something it was built to stop.
 *
 * Derived from fields that already exist (`ageMinutes` + `collectedAt`). No new state, and
 * every caller that asked the old question now asks the right one.
 *
 * `now` is injectable, and that is not a testing convenience. `evaluateGates` documents itself
 * as a pure function of facts already gathered, but it reached this helper and this helper read
 * the wall clock, so the gate matrix quietly depended on the day it ran: the gates suite passed
 * only within 72h of its own fixture date and went red on 2026-07-27 with `thread is 77h old`.
 * A gate whose result changes while its inputs do not cannot be reasoned about. Defaulted to
 * `Date.now()` so every production caller behaves exactly as before.
 */
export function currentAgeHours(
  thread: Pick<Thread, 'ageMinutes' | 'collectedAt'>,
  now: number = Date.now()
): number | null {
  if (thread.ageMinutes == null) return null;
  const collected = Date.parse(thread.collectedAt);
  const sinceCollection = Number.isFinite(collected) ? (now - collected) / 3_600_000 : 0;
  return thread.ageMinutes / 60 + Math.max(0, sinceCollection);
}

export function evaluateCandidate(thread: Thread, assessment: OpportunityAssessment): Candidate {
  const criteria: Criterion[] = [];

  /* a gap worth filling — mechanical over the gap analysis, not a model's opinion of the title */
  criteria.push({
    name: 'a gap worth filling',
    pass: assessment.verdict === 'contribute' && assessment.score >= policy.minOpportunityToPublish.value,
    detail: `opportunity ${assessment.score} (floor ${policy.minOpportunityToPublish.value}), verdict ${assessment.verdict}` +
      (assessment.reasons[0] ? ` — ${assessment.reasons[0]}` : '')
  });

  /* …and it is actually a question, checked against the title rather than the score */
  const shape = isQuestionShaped(thread);
  criteria.push({
    name: 'asks something',
    pass: shape.pass,
    detail: shape.detail
  });

  /* answerable without a pitch — r/WordPress rule 1 */
  const pitch = asksForAProduct(thread);
  criteria.push({
    name: 'answerable without recommending a product',
    pass: !pitch.matched,
    proxy: true,
    detail: pitch.detail
  });

  /* no existing high-quality accepted answer (proxy) */
  const longest = thread.comments.reduce((m, c) => Math.max(m, c.body.length), 0);
  const count = thread.commentCount ?? thread.comments.length;
  const covered = count > 15 || longest > 800;
  criteria.push({
    name: 'no existing high-quality answer',
    pass: !covered,
    proxy: true,
    detail: `${count} comments, longest ${longest} chars — ` +
      (covered ? 'the ground looks covered' : 'nothing long enough to look like a settled answer'),
  });

  /* recent activity — measured now, not at collection time */
  const ageH = currentAgeHours(thread);
  criteria.push({
    name: 'recent activity',
    pass: ageH != null && ageH <= policy.maxThreadAgeHoursToPublish.value,
    detail: ageH == null
      ? 'age unknown — cannot confirm recency'
      : `${Math.round(ageH)}h old (limit ${policy.maxThreadAgeHoursToPublish.value}h)`
  });

  /* appropriate subreddit */
  const sub = thread.subreddit.toLowerCase();
  criteria.push({
    name: 'appropriate subreddit',
    pass: (PILOT_SUBREDDITS as readonly string[]).includes(sub),
    detail: `r/${thread.subreddit} — pilot set is ${PILOT_SUBREDDITS.map((s) => 'r/' + s).join(', ')}`
  });

  /* expertise match (proxy) — the thread's vocabulary, not the model's confidence in itself */
  const text = [thread.title, thread.body ?? '', ...thread.comments.map((c) => c.body)].join(' ');
  const competence = assessCompetence(text);
  criteria.push({
    name: 'expertise match',
    pass: competence.inScope,
    proxy: true,
    detail: competence.detail
  });

  return {
    threadId: thread.id,
    title: thread.title,
    permalink: thread.permalink,
    subreddit: thread.subreddit,
    score: assessment.score,
    criteria,
    eligible: criteria.every((c) => c.pass)
  };
}

/** Every assessed thread, best first. Ineligible ones are kept so the rejection is visible. */
export function rankCandidates(threads: Thread[], assessments: OpportunityAssessment[]): Candidate[] {
  const byId = new Map(threads.map((t) => [t.id, t]));
  return assessments
    .map((a) => {
      const t = byId.get(a.threadId);
      return t ? evaluateCandidate(t, a) : null;
    })
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.threadId.localeCompare(b.threadId);   // stable, not a second model number
    });
}
