/**
 * Phase 3 — the Opportunity Engine.
 *
 * Turns a gap analysis into a decision: contribute, or stay silent. Entirely mechanical over
 * the structured fields the analyzer produced — no second model call, no free-choice score.
 * The one thing it does not do is decide whether the reply is any good; that is the drafting
 * stage and the person at the approval prompt.
 *
 * The bar is deliberately set so that "skip" is the common answer. A system that finds an
 * opportunity in every thread has not found any.
 */
import { policy } from './policy.js';
import { isQuestionShaped } from './select.js';
import { assessCompetence } from './competence.js';
import type { Thread, GapAnalysis, OpportunityAssessment, ContributionThesis } from './types.js';

/**
 * Gap kinds ranked by how much a knowledgeable reply improves the thread. Used only to pick
 * which gap the contribution thesis is written from — the score itself comes from headroom,
 * which already encodes these bands. Two scoring paths over the same evidence would drift
 * apart, and the first version of this file did exactly that: it ranked `incorrect` above
 * `unanswered` here while the headroom bands ranked it below.
 */
const KIND_WEIGHT: Record<GapAnalysis['gaps'][number]['kind'], number> = {
  incorrect: 30,          // a wrong answer standing unchallenged is the worst state for a thread
  'missing-diagnostic': 28,
  unanswered: 26,
  partial: 16,
  unverified: 14
};

const KIND_PHRASE: Record<GapAnalysis['gaps'][number]['kind'], string> = {
  incorrect: 'a claim in the thread is wrong and nobody has corrected it',
  unanswered: 'part of the question has had no answer at all',
  'missing-diagnostic': 'nobody has asked for the information needed to tell the causes apart',
  partial: 'the existing answer stops short of the step that resolves it',
  unverified: 'a diagnosis was asserted with no way to confirm it'
};

/**
 * Below this, the gap is not worth a stranger's reply.
 *
 * 40 is exactly one fillable `unanswered` gap and nothing else — the minimum case that still
 * describes a real contribution: someone asked, nobody answered that part, and we can. A
 * thread whose only gap is `partial` (20) does not clear it, because "the existing answer
 * stops slightly short" is rarely worth a stranger appearing.
 *
 * Lives in policy.ts since 2026-07-23 so `redbot policy` prints it with its provenance beside
 * every other operational limit, and so select.ts can read the floor without importing this
 * module back.
 */
export const MIN_OPPORTUNITY_SCORE = policy.minOpportunityToPublish.value;

export function assessOpportunity(thread: Thread, gap: GapAnalysis): OpportunityAssessment {
  const reasons: string[] = [];
  const fillable = gap.gaps.filter((g) => g.fillable);

  /**
   * The score IS the headroom, plus a bonus for breadth. Headroom is already computed
   * locally from the structured gaps (see gap.ts), so adding a second weighting here would
   * be scoring the same evidence twice under two rankings that can disagree — which is the
   * bug this file shipped with.
   */
  let score = gap.headroom;

  if (!fillable.length) {
    reasons.push(
      gap.gaps.length
        ? `${gap.gaps.length} gap(s) found, none fillable from the declared competence`
        : 'no gap found in the discussion'
    );
  } else {
    const best = fillable.reduce((a, b) => (KIND_WEIGHT[a.kind] >= KIND_WEIGHT[b.kind] ? a : b));
    reasons.push(`headroom ${gap.headroom}; best fillable gap is "${best.kind}": ${best.what}`);

    // A second, different kind of gap means the thread is genuinely underserved.
    const otherKinds = new Set(fillable.map((g) => g.kind));
    otherKinds.delete(best.kind);
    if (otherKinds.size) {
      score += 10;
      reasons.push(`${otherKinds.size} further gap kind(s): ${[...otherKinds].join(', ')}`);
    }
  }

  /**
   * How much has already been said.
   *
   * Measured 2026-07-23: the additive bands saturate — 7 of 14 threads scored exactly 100, so
   * the engine excluded bad candidates but could not rank the good ones. `covered` is real
   * signal that was being collected and ignored: a thread carrying 12 claims already has far
   * less room than one carrying 1, whatever its gap kinds.
   */
  const coveragePenalty = Math.min(25, Math.round(gap.covered.length * 2.5));
  if (coveragePenalty > 0) {
    score -= coveragePenalty;
    reasons.push(`-${coveragePenalty} for ${gap.covered.length} claim(s) already on the thread`);
  }

  /* ---- disqualifiers ---- */

  /**
   * Is this our subject at all?
   *
   * The gap analyzer's own `fillable` flag came back true for 65 of 67 gaps on the first real
   * run — including Shopify Liquid architecture and an unspecified "MCP-Server". A flag that
   * is true 97% of the time is not a filter, so competence is checked against the thread's
   * vocabulary instead of the model's opinion. Proxy, and labelled as one.
   */
  const text = [thread.title, thread.body ?? '', ...thread.comments.map((c) => c.body)].join(' ');
  const competence = assessCompetence(text);
  if (!competence.inScope) {
    reasons.push(`outside declared competence (proxy): ${competence.detail}`);
    score = Math.min(score, 15);
  }

  if (gap.alreadyAnswered) {
    reasons.push('the thread is already answered — another reply would restate it');
    score = Math.min(score, 20);
  }

  const shape = isQuestionShaped(thread);
  if (!shape.pass) {
    reasons.push(`nothing is being asked: ${shape.detail}`);
    score = Math.min(score, 15);
  }

  const ageHours = thread.ageMinutes != null ? thread.ageMinutes / 60 : null;
  if (ageHours != null && ageHours > policy.maxThreadAgeHoursToPublish.value) {
    reasons.push(`thread is ${Math.round(ageHours)}h old — past the ${policy.maxThreadAgeHoursToPublish.value}h ceiling`);
    score = Math.min(score, 10);
  }

  score = Math.max(0, Math.min(100, score));
  const verdict: OpportunityAssessment['verdict'] = score >= MIN_OPPORTUNITY_SCORE ? 'contribute' : 'skip';

  /* ---- the case for replying, built from the gap rather than from enthusiasm ---- */
  let thesis: ContributionThesis | null = null;
  if (verdict === 'contribute' && fillable.length) {
    const best = fillable.reduce((a, b) => (KIND_WEIGHT[a.kind] >= KIND_WEIGHT[b.kind] ? a : b));
    thesis = {
      whyThread: `${gap.question} — ${KIND_PHRASE[best.kind]}.`,
      whatNew: best.what,
      whyNotSilent:
        gap.covered.length
          ? `${gap.covered.length} claim(s) are already on the thread and none of them close this gap.`
          : 'nothing of technical substance has been said yet.'
    };
  }

  if (verdict === 'skip' && !reasons.length) reasons.push('score below the contribution floor');

  return {
    threadId: gap.threadId,
    permalink: gap.permalink,
    title: gap.title,
    verdict,
    score,
    thesis,
    reasons,
    assessedAt: new Date().toISOString()
  };
}
