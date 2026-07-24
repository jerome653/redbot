/**
 * Phases 1-5 — the model-driven half of Argus.
 *
 * Everything here produces STRUCTURE. Nothing here decides anything: the verdict rules in
 * certify.ts run on the structure and never see the prose. That separation is the whole design
 * — HRC-001 failed because fluent output was trusted, so Argus uses a model to generate
 * evidence about a draft and gives the judgement to deterministic code.
 *
 * Every field coming back from the model is validated against the enums in types.ts. An
 * unrecognised value becomes `unknown`, which certify.ts treats as absent provenance — the
 * safe direction. A model that invents a new evidence class cannot thereby invent authority.
 */
import { complete, extractJson } from '../llm.js';
import { config } from '../config.js';
import { claimExtractionPrompt, contradictionPrompt } from './prompts.js';
import {
  CLAIM_TYPES, EVIDENCE_CLASSES, CONFIDENCE_LEVELS, CONTRADICTION_KINDS,
  type Claim, type ClaimType, type EvidenceClass, type Confidence,
  type Contradiction, type ContradictionKind
} from './types.js';

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v.trim() : fallback);

/** Coerce to a known enum member, defaulting to the safest value rather than the model's. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

interface RawClaim {
  id?: unknown; text?: unknown; type?: unknown; evidenceClass?: unknown;
  evidenceDetail?: unknown; confidence?: unknown; dependsOn?: unknown; sourceQuote?: unknown;
}

export async function extractClaims(draft: string, threadTitle: string): Promise<Claim[]> {
  const raw = await complete({
    prompt: claimExtractionPrompt(draft, threadTitle),
    model: config.llm.analyzeModel,
    maxTokens: 3000,
    temperature: 0
  });

  const parsed = extractJson<{ claims?: unknown }>(raw);
  if (!Array.isArray(parsed.claims)) return [];

  const claims: Claim[] = [];
  for (const [i, entry] of parsed.claims.entries()) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as RawClaim;
    const text = str(c.text);
    if (!text) continue;

    claims.push({
      id: str(c.id) || `c${i + 1}`,
      text,
      // An unclassifiable claim is `unknown`, which no rule treats as safe.
      type: oneOf<ClaimType>(c.type, CLAIM_TYPES, 'unknown'),
      // An unrecognised provenance is `unknown`, i.e. absent — never a stronger class.
      evidenceClass: oneOf<EvidenceClass>(c.evidenceClass, EVIDENCE_CLASSES, 'unknown'),
      evidenceDetail: str(c.evidenceDetail, '(none stated)'),
      confidence: oneOf<Confidence>(c.confidence, CONFIDENCE_LEVELS, 'unknown'),
      dependsOn: Array.isArray(c.dependsOn) ? c.dependsOn.map((d) => str(d)).filter(Boolean) : [],
      sourceQuote: str(c.sourceQuote, text)
    });
  }

  return claims;
}

interface RawContradiction {
  kind?: unknown; statement?: unknown; evidenceClass?: unknown;
  evidenceDetail?: unknown; fatal?: unknown;
}

/**
 * Phase 5, per claim.
 *
 * Only claims that can actually be wrong are attacked. Refuting an opinion wastes a call and
 * produces noise that trains reviewers to skim contradiction reports.
 */
export async function findContradictions(claim: Claim, context: string): Promise<Contradiction[]> {
  if (claim.type === 'opinion') return [];

  const raw = await complete({
    prompt: contradictionPrompt(claim.text, claim.type, context),
    model: config.llm.draftModel,
    maxTokens: 1400,
    temperature: 0
  });

  const parsed = extractJson<{ contradictions?: unknown }>(raw);
  if (!Array.isArray(parsed.contradictions)) return [];

  const out: Contradiction[] = [];
  for (const entry of parsed.contradictions) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as RawContradiction;
    const statement = str(c.statement);
    if (!statement) continue;

    out.push({
      claimId: claim.id,
      kind: oneOf<ContradictionKind>(c.kind, CONTRADICTION_KINDS, 'counterexample'),
      statement,
      evidenceClass: oneOf<EvidenceClass>(c.evidenceClass, EVIDENCE_CLASSES, 'unknown'),
      evidenceDetail: str(c.evidenceDetail, '(none stated)'),
      // Fatality must be asserted explicitly. An unclear answer is treated as a qualification,
      // not a kill — otherwise every vague objection would reject a draft and the report would
      // become noise. Rule 4 still escalates weakly-evidenced falsifiable claims regardless.
      fatal: c.fatal === true
    });
  }

  return out;
}
