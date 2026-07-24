/**
 * Phase 8 — epistemic calibration.
 *
 * Does the language's certainty match the evidence's certainty?
 *
 * OBSERVED FAILURE (HRC-001): the draft asserted, flatly, that an oversized row "inserts empty
 * or truncated **instead of throwing an error**". That is a bare declarative about MySQL
 * internals, backed by nothing, and it was wrong. The craft gate scored the draft *well* — it
 * counts hedges and rewards specificity, so a confident false statement reads as high quality.
 *
 * This module compares the two independently: how certain the sentence SOUNDS, and how certain
 * its evidence ALLOWS. A mismatch in the unsafe direction — asserted language over low or absent
 * evidence — is a certification failure, not a style note.
 *
 * Entirely deterministic. The certainty of a sentence is a property of its words.
 */
import type { Claim, EpistemicIssue } from './types.js';
import { CANNOT_STATE_AS_FACT, AUTHORITATIVE, NO_PROVENANCE } from './types.js';

/** Language that asserts a fact outright. */
const ASSERTED = [
  /\bis caused by\b/i,
  /\bthe (?:cause|reason|problem) is\b/i,
  /\bthis (?:is|means|happens) because\b/i,
  /\bwill (?:not |never )?(?:be|get|cause|happen|work|fail|throw)\b/i,
  /\balways\b/i,
  /\bnever\b/i,
  /\bcannot\b|\bcan't\b/i,
  /\bdoes not\b|\bdoesn'?t\b/i,
  /\binstead of\b/i,
  /\bguarantee[sd]?\b/i,
  /\bdefinitely\b|\bcertainly\b/i,
  /\bthe row (?:inserts|becomes|ends up)\b/i
];

/** Language that marks a possibility rather than a fact. */
const HEDGED = [
  /\b(?:likely|probably|usually|typically|often|generally|commonly|in most cases)\b/i,
  /\b(?:might|may|could|can) be\b/i,
  /\bworth (?:checking|ruling out|a look)\b/i,
  /\bI(?:'d| would) (?:check|start|look|expect|guess)\b/i,
  /\btends? to\b/i,
  /\bsuggests?\b/i
];

/** Language that explicitly disclaims certainty. */
const EXPLICITLY_UNCERTAIN = [
  /\bone possibility is\b/i,
  /\bif .{2,60} (?:then|that would)\b/i,
  /\bI (?:can't|cannot) tell (?:from|without)\b/i,
  /\bwithout (?:seeing|knowing)\b/i,
  /\bmy guess\b/i,
  /\bnot sure\b/i,
  /\bassuming\b/i,
  /\bit depends\b/i
];

export function certaintyOf(text: string): EpistemicIssue['languageCertainty'] {
  // Explicit disclaimers win: a sentence that says "if X, then Y" is not asserting Y.
  if (EXPLICITLY_UNCERTAIN.some((re) => re.test(text))) return 'explicitly-uncertain';
  if (HEDGED.some((re) => re.test(text))) return 'hedged';
  if (ASSERTED.some((re) => re.test(text))) return 'asserted';
  // A bare declarative with no modality is an assertion. "The sky is green" hedges nothing.
  return 'asserted';
}

/**
 * What certainty the evidence actually supports.
 *
 * Independent of what the claim's own `confidence` field says — a claim that declares itself
 * `high` while citing `unsupported` is exactly the defect this catches, so the two are compared
 * rather than one trusted.
 */
export function supportedCertainty(claim: Claim): Claim['confidence'] {
  if (NO_PROVENANCE.has(claim.evidenceClass)) return 'unknown';
  if (AUTHORITATIVE.has(claim.evidenceClass)) return claim.confidence;
  // Non-authoritative provenance (community knowledge, reasoned inference, operator experience)
  // cannot carry a high-confidence factual assertion however sure the model felt.
  return claim.confidence === 'high' ? 'medium' : claim.confidence;
}

/**
 * Find claims whose language outruns their evidence.
 *
 * Only the unsafe direction is reported. Under-claiming — hedged language over authoritative
 * evidence — is a missed opportunity, not a risk to the operator's name.
 */
export function findEpistemicIssues(claims: Claim[]): EpistemicIssue[] {
  const issues: EpistemicIssue[] = [];

  for (const claim of claims) {
    // Opinion and explicit speculation do not present themselves as fact, so "the language is
    // more certain than the evidence" does not apply to them — the same exemption Rules 3 and 6
    // already make in certify.ts. Without it, a flatly-worded opinion ("nginx is always the
    // right choice") was escalated for asserting more than its (absent) evidence carries, a
    // calibration complaint about a preference (evaluation, epistemic opinion exemption).
    if (claim.type === 'opinion' || claim.type === 'speculation') continue;

    const language = certaintyOf(claim.sourceQuote || claim.text);
    const supported = supportedCertainty(claim);

    if (language === 'asserted' && CANNOT_STATE_AS_FACT.has(supported)) {
      issues.push({
        claimId: claim.id,
        languageCertainty: language,
        supportedCertainty: supported,
        quote: claim.sourceQuote || claim.text,
        detail:
          `stated as fact, but the evidence is ${claim.evidenceClass} (${supported}) — ` +
          `say what you would check and why, or drop the claim`
      });
      continue;
    }

    if (language === 'asserted' && supported === 'medium' && claim.confidence === 'high') {
      issues.push({
        claimId: claim.id,
        languageCertainty: language,
        supportedCertainty: supported,
        quote: claim.sourceQuote || claim.text,
        detail:
          `asserted with high confidence, but ${claim.evidenceClass} supports medium at best — ` +
          `hedge it or find primary evidence`
      });
    }
  }

  return issues;
}
