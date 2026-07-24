/**
 * Argus — the truth certification engine.
 *
 * Argus exists because of HRC-001. On 2026-07-23 the drafting pipeline produced a reply that
 * was fluent, specific, correctly hedged, brand-safe, lint-clean, genuinely novel against the
 * thread — and factually wrong. It claimed an oversized row "inserts empty or truncated instead
 * of throwing an error" during a SQL import; MySQL raises ERROR 1153 and aborts. Every
 * automated gate passed it.
 *
 * The architectural lesson, which every type below is shaped by:
 *
 *     WRITING QUALITY DOES NOT IMPLY TECHNICAL CORRECTNESS.
 *
 * So Argus never evaluates prose. It decomposes a draft into atomic claims and evaluates each
 * one on its own evidence. A paragraph cannot be certified; a claim can.
 *
 * Output is one of exactly three verdicts. There is no score, no percentage, and no "mostly
 * fine" — a certification system that emits a number invites someone to pick a threshold.
 */

/* ------------------------------------------------------------------ *
 * Phase 2 — claim classification
 * ------------------------------------------------------------------ */

export const CLAIM_TYPES = [
  'observation',              // a fact about the thread or the asker's report
  'inference',                // a conclusion drawn from something else
  'recommendation',           // an instruction to do something
  'implementation-detail',    // how a specific piece of software is built
  'configuration-advice',     // change this setting
  'version-specific',         // true only of certain versions
  'platform-behaviour',       // how a platform/service behaves
  'protocol-behaviour',       // how a protocol/wire format behaves
  'best-practice',            // widely held professional norm
  'opinion',                  // preference, not fact
  'speculation',              // explicitly uncertain guess
  'unknown'                   // could not be classified
] as const;

export type ClaimType = (typeof CLAIM_TYPES)[number];

/** Claim types that assert how software actually behaves — the ones that can be flatly wrong. */
export const FALSIFIABLE_TYPES: ReadonlySet<ClaimType> = new Set<ClaimType>([
  'implementation-detail',
  'version-specific',
  'platform-behaviour',
  'protocol-behaviour',
  'configuration-advice'
]);

/* ------------------------------------------------------------------ *
 * Phase 3 — evidence provenance
 * ------------------------------------------------------------------ */

export const EVIDENCE_CLASSES = [
  'primary-documentation',
  'official-implementation',
  'language-specification',
  'framework-documentation',
  'source-code',
  'observed-runtime-behaviour',
  'widely-accepted-practice',
  'community-knowledge',
  'operator-experience',
  'reasoned-inference',
  'unsupported',
  'unknown'
] as const;

export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

/** Evidence strong enough for a falsifiable claim to be stated as fact. */
export const AUTHORITATIVE: ReadonlySet<EvidenceClass> = new Set<EvidenceClass>([
  'primary-documentation',
  'official-implementation',
  'language-specification',
  'framework-documentation',
  'source-code',
  'observed-runtime-behaviour'
]);

/** Provenance that cannot support a factual assertion at all. */
export const NO_PROVENANCE: ReadonlySet<EvidenceClass> = new Set<EvidenceClass>([
  'unsupported',
  'unknown'
]);

/* ------------------------------------------------------------------ *
 * Phase 4 — confidence
 * ------------------------------------------------------------------ */

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'unknown'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** Below this, a claim may not be stated as fact. Phase 4, stated as a set rather than a number. */
export const CANNOT_STATE_AS_FACT: ReadonlySet<Confidence> = new Set<Confidence>(['low', 'unknown']);

/* ------------------------------------------------------------------ *
 * Claims
 * ------------------------------------------------------------------ */

export interface Claim {
  /** Stable within a certification run: c1, c2, … */
  id: string;
  /** The assertion, restated atomically. One proposition, no conjunctions. */
  text: string;
  type: ClaimType;
  evidenceClass: EvidenceClass;
  /** What the evidence actually is — a spec section, a doc page, an observed behaviour. */
  evidenceDetail: string;
  confidence: Confidence;
  /**
   * Phase 6. Ids of claims this one rests on. If a dependency fails, this fails with it —
   * there is no partial salvage of invalid reasoning.
   */
  dependsOn: string[];
  /** Where in the draft it came from, so a reviewer can find it. */
  sourceQuote: string;
}

/* ------------------------------------------------------------------ *
 * Phase 5 — contradiction
 * ------------------------------------------------------------------ */

export const CONTRADICTION_KINDS = [
  'known-exception',
  'counterexample',
  'version-difference',
  'configuration-dependency',
  'alternative-explanation',
  'contradictory-documentation',
  'edge-case'
] as const;

export type ContradictionKind = (typeof CONTRADICTION_KINDS)[number];

export interface Contradiction {
  claimId: string;
  kind: ContradictionKind;
  /** What the contradiction is. */
  statement: string;
  /** What backs the contradiction — same provenance vocabulary as the claim. */
  evidenceClass: EvidenceClass;
  evidenceDetail: string;
  /**
   * True when the contradiction defeats the claim outright rather than qualifying it.
   * A surviving fatal contradiction is an automatic REJECT.
   */
  fatal: boolean;
}

/* ------------------------------------------------------------------ *
 * Phase 8 — epistemic calibration
 * ------------------------------------------------------------------ */

export interface EpistemicIssue {
  claimId: string;
  /** The certainty the prose projects. */
  languageCertainty: 'asserted' | 'hedged' | 'explicitly-uncertain';
  /** The certainty the evidence supports. */
  supportedCertainty: Confidence;
  quote: string;
  detail: string;
}

/* ------------------------------------------------------------------ *
 * Phase 7 — resolution detection
 * ------------------------------------------------------------------ */

export interface ResolutionSignal {
  /** Where it was found. */
  where: 'post-body' | 'comment' | 'op-reply';
  /** The literal matched text, so the finding can be checked by eye. */
  matched: string;
  /** Surrounding text for context. */
  context: string;
  /** True when the signal came from the original poster rather than a bystander. */
  byOriginalPoster: boolean;
}

export interface ResolutionVerdict {
  resolved: boolean;
  signals: ResolutionSignal[];
  detail: string;
}

/* ------------------------------------------------------------------ *
 * Phase 12 — verdict
 * ------------------------------------------------------------------ */

export type Verdict = 'CERTIFIED' | 'ESCALATE' | 'REJECT';

export interface VerdictReason {
  /** Machine-readable rule id, e.g. 'fatal-contradiction'. Every rule cites an observed failure. */
  rule: string;
  claimId?: string;
  detail: string;
}

export interface Certification {
  draftId: string;
  threadId: string;
  verdict: Verdict;
  reasons: VerdictReason[];
  claims: Claim[];
  contradictions: Contradiction[];
  epistemic: EpistemicIssue[];
  /** Claims invalidated because something they rest on failed. */
  invalidated: Array<{ claimId: string; becauseOf: string }>;
  resolution: ResolutionVerdict;
  certifiedAt: string;
  /**
   * Kept for backward compatibility and equal to the analyze model. It named only ONE model
   * while two produce the evidence — claims come from the analyze model, contradictions from
   * the draft model — so "which model called this fatal?" was answered wrong (evaluation,
   * "certification names the wrong model"). Prefer `models` below, which records both.
   */
  model: string;
  /** Both models the verdict rests on: claim extraction vs contradiction refutation. */
  models?: { analyze: string; draft: string };
  /**
   * Claim ids whose refutation call COMPLETED — whatever it found.
   *
   * EB-40. Without this a certification cannot be replayed from its own record: a refutation
   * that TIMED OUT and one that completed and returned nothing are indistinguishable
   * afterwards, and they produce different verdicts. Rule 8 escalates the first and stays
   * silent for the second.
   *
   * Measured 2026-07-23: replaying cert #2 by inferring the set from the attacked claims fired
   * `unrefuted-falsifiable-claim` on c13, which the production run did not.
   *
   * **Optional for backward compatibility.** The three records written before this field
   * existed have no value here, and `undefined` must be read as "not recorded" — never as
   * "refutation ran for nothing". No gate and no rule consumes this; it is evidence only.
   */
  refutationRan?: string[];
  /**
   * Phase 10 — what human-authored reference material had to say about the claims it has
   * standing over. Optional: certifications written before 2026-07-24 have none, and
   * `undefined` means "the phase did not run", never "nothing was found".
   */
  citations?: import('./citations.js').CitationReport;
}
