/**
 * Phase 12 — the verdict.
 *
 * Three outcomes, no fourth, no score. A certification system that emits a number invites
 * someone to pick a threshold and argue about it; three named outcomes force a decision.
 *
 *   CERTIFIED  every claim is adequately supported — a human still reviews it
 *   ESCALATE   a human with domain expertise must resolve something Argus cannot
 *   REJECT     something is unsupported, contradicted, or false
 *
 * Every rule below cites the observed failure that produced it. A rule with no failure behind
 * it is a guess with a rule's authority, and the engineering rules forbid it.
 *
 * Deterministic: the same claim set always yields the same verdict.
 */
import type {
  Claim, Contradiction, EpistemicIssue, Verdict, VerdictReason, ResolutionVerdict, EvidenceClass
} from './types.js';
import { CANNOT_STATE_AS_FACT, NO_PROVENANCE, AUTHORITATIVE, FALSIFIABLE_TYPES } from './types.js';
import { propagateFailure, validateGraph, type GraphIssue } from './graph.js';
import type { CitationReport } from './citations.js';

/**
 * How much a piece of evidence is worth, as a rank rather than a name: authoritative (2),
 * non-authoritative but stated (1), no provenance at all (0). Used to decide whether a
 * contradiction actually outranks the claim it attacks.
 */
export function evidenceRank(ec: EvidenceClass): 0 | 1 | 2 {
  if (AUTHORITATIVE.has(ec)) return 2;
  if (NO_PROVENANCE.has(ec)) return 0;
  return 1;
}

export interface CertifyInput {
  claims: Claim[];
  contradictions: Contradiction[];
  epistemic: EpistemicIssue[];
  resolution: ResolutionVerdict;
  /** Set when the operator has explicitly overridden a resolved-thread block. */
  humanOverride?: boolean;
  /**
   * Claim ids whose refutation pass actually completed. Absent means "infer it from the
   * contradictions", which is only correct when every refutation succeeded — see Rule 8.
   */
  refutationRan?: ReadonlySet<string>;
  /**
   * Phase 10 output. Absent means the citation check did not run — Rules 9 and 10 then say
   * nothing at all, rather than treating an absent report as a clean one.
   */
  citations?: CitationReport;
}

export interface CertifyResult {
  verdict: Verdict;
  reasons: VerdictReason[];
  invalidated: Array<{ claimId: string; becauseOf: string }>;
  graphIssues: GraphIssue[];
}

export function certify(input: CertifyInput): CertifyResult {
  const reasons: VerdictReason[] = [];
  const reject: VerdictReason[] = [];
  const escalate: VerdictReason[] = [];

  const { claims, contradictions, epistemic, resolution } = input;

  /* ---------------------------------------------------------------- *
   * Rule 0 — nothing to certify
   * ---------------------------------------------------------------- */
  if (!claims.length) {
    return {
      verdict: 'REJECT',
      reasons: [{
        rule: 'no-claims',
        detail: 'no factual claims could be extracted — there is nothing to certify'
      }],
      invalidated: [],
      graphIssues: []
    };
  }

  /* ---------------------------------------------------------------- *
   * Rule 1 — the thread is finished
   * OBSERVED FAILURE: HRC-001-A. thread f11d8de68709 carried "UPDATE: … it found all the CSS"
   * plus two OP confirmations, and the pipeline drafted a reply anyway.
   * ---------------------------------------------------------------- */
  if (resolution.resolved && !input.humanOverride) {
    reject.push({
      rule: 'thread-resolved',
      detail: `${resolution.detail} — a reply here answers a question nobody is still asking`
    });
  }

  /* ---------------------------------------------------------------- *
   * Rule 2 — a surviving fatal contradiction
   * OBSERVED FAILURE: HRC-001. "the row inserts empty or truncated instead of throwing an
   * error" is contradicted by MySQL ERROR 1153, which aborts the import.
   *
   * `fatal` is a raw model boolean (extract.ts). Taken verbatim it lets a contradiction whose
   * OWN evidence coerced to `unknown` reject a claim backed by primary documentation — the
   * model's say-so overriding the evidence, which is the exact inversion Argus exists to stop
   * (evaluation M6). So a model-flagged-fatal contradiction only stays fatal when its evidence
   * is at least as strong as the claim's; otherwise it de-escalates to ESCALATE, where a person
   * weighs it. HRC-001 is unaffected: ERROR 1153 is primary/authoritative and outranks the
   * reasoned-inference claim it kills.
   * ---------------------------------------------------------------- */
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const trueFatal: Contradiction[] = [];
  for (const c of contradictions) {
    if (!c.fatal) continue;
    const claim = claimById.get(c.claimId);
    if (claim && evidenceRank(c.evidenceClass) < evidenceRank(claim.evidenceClass)) {
      escalate.push({
        rule: 'contested-contradiction',
        claimId: c.claimId,
        detail:
          `${c.kind}: ${c.statement} [${c.evidenceClass}] — flagged fatal, but its evidence ` +
          `is weaker than the claim's (${claim.evidenceClass}); a person must judge which is right`
      });
      continue;
    }
    trueFatal.push(c);
    reject.push({
      rule: 'fatal-contradiction',
      claimId: c.claimId,
      detail: `${c.kind}: ${c.statement} [${c.evidenceClass}]`
    });
  }

  /* ---------------------------------------------------------------- *
   * Rule 3 — no provenance
   * Phase 3: "if provenance cannot be stated, certification fails."
   * ---------------------------------------------------------------- */
  const unsupported = claims.filter((c) => NO_PROVENANCE.has(c.evidenceClass));
  for (const c of unsupported) {
    // An opinion or an explicit speculation is allowed to be unsupported — it does not
    // present itself as fact. Anything else must say where it comes from.
    if (c.type === 'opinion' || c.type === 'speculation') continue;
    reject.push({
      rule: 'no-provenance',
      claimId: c.id,
      detail: `"${c.text}" is ${c.evidenceClass} — a factual claim must say where it comes from`
    });
  }

  /* ---------------------------------------------------------------- *
   * Rule 4 — a falsifiable claim resting on non-authoritative evidence
   * OBSERVED FAILURE: HRC-001. The truncation claim was reasoned inference presented as
   * implementation detail. Reasoning about how software behaves is not evidence of how it
   * behaves; that is the exact shape of the failure.
   * ---------------------------------------------------------------- */
  const weakFalsifiable = claims.filter(
    (c) => FALSIFIABLE_TYPES.has(c.type) &&
           !AUTHORITATIVE.has(c.evidenceClass) &&
           !NO_PROVENANCE.has(c.evidenceClass)
  );
  for (const c of weakFalsifiable) {
    escalate.push({
      rule: 'falsifiable-claim-weak-evidence',
      claimId: c.id,
      detail:
        `"${c.text}" asserts ${c.type} on ${c.evidenceClass} — ` +
        `someone who knows the subject must confirm it, or it needs primary evidence`
    });
  }

  /* ---------------------------------------------------------------- *
   * Rule 5 — language outruns evidence
   * Phase 8. Overconfidence is a certification failure, not a style note.
   * ---------------------------------------------------------------- */
  for (const e of epistemic) {
    const claim = claims.find((c) => c.id === e.claimId);
    const falsifiable = claim ? FALSIFIABLE_TYPES.has(claim.type) : false;
    (falsifiable ? reject : escalate).push({
      rule: 'overconfident-language',
      claimId: e.claimId,
      detail: `${e.detail} — "${e.quote.slice(0, 90)}"`
    });
  }

  /* ---------------------------------------------------------------- *
   * Rule 6 — low or unknown confidence stated as fact
   * ---------------------------------------------------------------- */
  const lowStated = claims.filter(
    (c) => CANNOT_STATE_AS_FACT.has(c.confidence) && c.type !== 'opinion' && c.type !== 'speculation'
  );
  for (const c of lowStated) {
    escalate.push({
      rule: 'low-confidence-as-fact',
      claimId: c.id,
      detail: `"${c.text}" carries ${c.confidence} confidence and is not marked as speculation`
    });
  }

  /* ---------------------------------------------------------------- *
   * Rule 8 — a falsifiable claim that was never actually attacked
   *
   * OBSERVED FAILURE 2026-07-23, first real Argus run on d_f11d8de68709_mrwj1koh. Extraction
   * returned twelve claims, and the two carrying the false max_allowed_packet assertion came
   * back as:
   *
   *     c5  protocol-behaviour  observed-runtime-behaviour
   *     c8  protocol-behaviour  official-implementation
   *
   * The model declared AUTHORITATIVE provenance for a claim that primary documentation
   * contradicts. Provenance is self-declared, so Rule 4 cannot catch inflation — the only
   * check on it is the Phase 5 refutation, and on that run two refutations hit the CLI timeout.
   *
   * A claim judged on its own declared evidence, having never been attacked, is a claim
   * marking its own homework. So an unrefuted falsifiable claim cannot certify. It escalates,
   * which puts it in front of the one reviewer who can tell whether "official-implementation"
   * means anything here.
   * ---------------------------------------------------------------- */
  const attacked = new Set(contradictions.map((c) => c.claimId));
  const refutationRan = input.refutationRan ?? attacked;
  for (const c of claims) {
    if (!FALSIFIABLE_TYPES.has(c.type)) continue;
    if (refutationRan.has(c.id)) continue;
    escalate.push({
      rule: 'unrefuted-falsifiable-claim',
      claimId: c.id,
      detail:
        `"${c.text}" asserts ${c.type} and was never successfully attacked — ` +
        `its provenance (${c.evidenceClass}) is self-declared and unchecked`
    });
  }

  /* ---------------------------------------------------------------- *
   * Rule 9 — a claim inside a corpus's jurisdiction that no card supports
   *
   * ADDED 2026-07-24 under a recorded freeze exception (see ENGINE-FREEZE.md). Unlike Rules
   * 1-8 this rule is **preventive**: it has never fired on real input, and that is stated
   * rather than dressed up as an observation, because a rule that cites a failure it did not
   * have is exactly the kind of borrowed authority the freeze exists to stop.
   *
   * What IS measured, 2026-07-24: redbot has no retrieval of any kind — grepped, zero
   * embeddings, zero vector store, zero corpus lookup. `draftPrompt` receives the thread,
   * eight comments, the gap analysis and six hardcoded expertise strings. **Every factual
   * claim in every draft comes from model memory**, which is the exact provenance of the
   * false ERROR 1153 claim in HRC-001.
   *
   * Nothing can be done about that in general — no corpus covers WordPress. But there is one
   * claim class where reference material exists and the cost of inventing an answer is high:
   * assertions about SGEN itself, published under a pseudonymous account in a subreddit. A
   * fabricated product capability there is unretractable. So where a human-authored corpus
   * has standing, a claim it cannot support does not go out.
   *
   * This rule is silent for every claim no corpus has jurisdiction over — which, given a
   * WordPress pipeline and an SGEN-only corpus, is expected to be nearly all of them. That is
   * the design, not a shortfall: a check that fires on everything is DEFECT-15.
   * ---------------------------------------------------------------- */
  if (input.citations) {
    for (const f of input.citations.findings) {
      if (f.status === 'uncited') {
        reject.push({
          rule: 'uncited-claim-in-jurisdiction',
          claimId: f.claimId,
          detail: f.detail
        });
      }
    }

    /* -------------------------------------------------------------- *
     * Rule 11 — reference material exists on the subject, so a person reads it
     *
     * MEASURED 2026-07-24: the false claim "SGEN supports installing WordPress plugins"
     * matched `kb-can-i-install-a-plugin` at 0.60 term coverage — a card that says the exact
     * opposite. Term overlap locates cards ABOUT a subject; it cannot tell agreement from
     * contradiction. So a covered claim is escalated with its cards attached, never certified
     * on the strength of the match. Automating the comparison would put a model back in the
     * adjudicating seat, which is the one thing Argus is built not to do.
     *
     * This does mean every claim about SGEN reaches a human. That is intended: `brand.org`
     * is set with `forbidMention`, so a compliant draft contains none, and one that does is
     * worth stopping on.
     * -------------------------------------------------------------- */
    for (const f of input.citations.findings) {
      if (f.status === 'covered') {
        escalate.push({
          rule: 'covered-claim-needs-reading',
          claimId: f.claimId,
          detail: f.detail
        });
      }
    }

    /* -------------------------------------------------------------- *
     * Rule 10 — the corpus that should have ruled could not be read
     *
     * Fails closed, and escalates rather than rejects: an unreadable corpus says nothing
     * about the claim, so the only honest outcome is that a person has to look. Treating a
     * missing file as a pass would make the whole check evaporate the moment the checkout
     * moves — which is precisely when nobody would notice.
     * -------------------------------------------------------------- */
    for (const f of input.citations.findings) {
      if (f.status === 'unavailable') {
        escalate.push({
          rule: 'corpus-unavailable',
          claimId: f.claimId,
          detail: f.detail
        });
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Rule 7 — structural problems in the argument
   * ---------------------------------------------------------------- */
  const graphIssues = validateGraph(claims);
  for (const g of graphIssues) {
    (g.kind === 'cycle' ? reject : escalate).push({
      rule: `graph-${g.kind}`,
      claimId: g.claimId,
      detail: g.detail
    });
  }

  /* ---------------------------------------------------------------- *
   * Phase 6 — propagate failure downstream. No partial salvage.
   * ---------------------------------------------------------------- */
  const failedIds = new Set<string>([
    ...trueFatal.map((c) => c.claimId),
    ...unsupported.filter((c) => c.type !== 'opinion' && c.type !== 'speculation').map((c) => c.id)
  ]);
  const invalidated = propagateFailure(claims, failedIds);
  for (const inv of invalidated) {
    reject.push({
      rule: 'invalidated-dependency',
      claimId: inv.claimId,
      detail: `rests on ${inv.becauseOf}, which failed — invalid reasoning is not partially salvageable`
    });
  }

  /* ---------------------------------------------------------------- *
   * Verdict. Reject dominates escalate; escalate dominates certify.
   * ---------------------------------------------------------------- */
  if (reject.length) {
    reasons.push(...reject, ...escalate);
    return { verdict: 'REJECT', reasons, invalidated, graphIssues };
  }
  if (escalate.length) {
    reasons.push(...escalate);
    return { verdict: 'ESCALATE', reasons, invalidated, graphIssues };
  }

  return {
    verdict: 'CERTIFIED',
    reasons: [{
      rule: 'all-claims-supported',
      detail:
        `${claims.length} claim(s), each with stated provenance, no surviving contradiction, ` +
        `and language matched to evidence. A human still reviews it.`
    }],
    invalidated,
    graphIssues
  };
}
