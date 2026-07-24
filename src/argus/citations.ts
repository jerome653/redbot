/**
 * Phase 10 — the citation check.
 *
 * Every earlier Argus phase measures a property of the claim's own text: what type it is,
 * what provenance it declares, how confidently it is worded, whether an adversarial pass can
 * refute it. All of those are readable from the draft. None of them consults anything
 * outside it.
 *
 * This phase is the one that looks outward — and it is honest about how little it can see.
 * It consults human-authored reference material, and only where that material actually has
 * standing. A corpus rules on the claims inside its jurisdiction and is silent on everything
 * else; silence is recorded as silence, never as support.
 *
 * **Why it is scoped this tightly.** See `corpus.ts` for the measurement: the SGEN knowledge
 * base has 17 cards that mention WordPress and every one says SGEN does not do WordPress
 * things. Ruling on WordPress claims with it would flag ~100% of them, and a flag that is
 * almost always true is not a filter (DEFECT-15). What it CAN rule on is claims about SGEN
 * itself — and a fabricated product capability asserted in a public subreddit is a real,
 * expensive failure with no other guard in front of it.
 *
 * No model call happens here. Retrieval is term overlap, code decides.
 */
import { claimsJurisdiction, findSupport, corpora } from '../corpus.js';
import type { SupportHit } from '../corpus.js';
import type { Claim } from './types.js';

export interface CitationFinding {
  claimId: string;
  corpusId: string;
  corpusLabel: string;
  /**
   * covered     — reference material exists on this subject. **Not a verification.**
   * uncited     — the corpus has jurisdiction and holds nothing on the subject at all
   * unavailable — the corpus could not be read, so nothing can be concluded
   *
   * MEASURED 2026-07-24, and the reason `covered` is not called `supported`: the claim
   * "SGEN supports installing WordPress plugins" — which is false, and which the KB
   * explicitly contradicts — matched `kb-can-i-install-a-plugin` at 0.60 coverage. Term
   * overlap finds cards ABOUT a subject. It cannot tell a card that confirms a claim from one
   * that refutes it. Calling that outcome "supported" would hand a false claim a citation,
   * which is HRC-001 with a footnote attached.
   */
  status: 'covered' | 'uncited' | 'unavailable';
  hits: SupportHit[];
  detail: string;
}

export interface CitationReport {
  findings: CitationFinding[];
  /** Claims no corpus had standing over. Reported so silence is never read as approval. */
  outOfJurisdiction: string[];
  /** Corpora that were configured but could not be read. */
  unavailable: Array<{ id: string; label: string; why: string }>;
  /** Cards available per corpus, so a review package can say what actually ruled. */
  corporaSummary: Array<{ id: string; label: string; cards: number | null; modified?: string }>;
}

export function checkCitations(claims: Claim[]): CitationReport {
  const findings: CitationFinding[] = [];
  const outOfJurisdiction: string[] = [];

  for (const claim of claims) {
    const ruling = claimsJurisdiction(claim.text);
    if (!ruling.length) { outOfJurisdiction.push(claim.id); continue; }

    for (const c of ruling) {
      if (!c.cards) {
        findings.push({
          claimId: claim.id,
          corpusId: c.config.id,
          corpusLabel: c.config.label,
          status: 'unavailable',
          hits: [],
          detail:
            `${c.config.label} covers this claim but could not be read (${c.unavailable}) — ` +
            `nothing can be concluded about it here`
        });
        continue;
      }

      const hits = findSupport(claim.text, c);
      findings.push(hits.length
        ? {
            claimId: claim.id,
            corpusId: c.config.id,
            corpusLabel: c.config.label,
            status: 'covered',
            hits,
            detail:
              `${c.config.label} holds material on this subject ` +
              `(${hits.map((h) => h.cardId).join(', ')}) — matched on shared vocabulary, ` +
              `which does not establish that the material AGREES with the claim. Read the ` +
              `cards against it.`
          }
        : {
            claimId: claim.id,
            corpusId: c.config.id,
            corpusLabel: c.config.label,
            status: 'uncited',
            hits: [],
            detail:
              `no card in ${c.config.label} covers this claim — it is an assertion about ` +
              `something we maintain the reference material for, so an uncited version of it ` +
              `is a claim we invented`
          });
    }
  }

  const loaded = corpora();

  return {
    findings,
    outOfJurisdiction,
    unavailable: loaded
      .filter((c) => !c.cards)
      .map((c) => ({ id: c.config.id, label: c.config.label, why: c.unavailable ?? 'unknown' })),
    corporaSummary: loaded.map((c) => ({
      id: c.config.id,
      label: c.config.label,
      cards: c.cards ? c.cards.length : null,
      ...(c.fileModified ? { modified: c.fileModified } : {})
    }))
  };
}
