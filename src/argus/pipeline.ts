/**
 * Argus orchestration — runs the phases in order and stores the certification.
 *
 * Order matters and is not negotiable:
 *
 *   7  resolution detection   deterministic, and FIRST — a finished thread needs no analysis
 *   1  claim extraction       model
 *   2  classification         model (same pass)
 *   3  evidence/provenance    model (same pass)
 *   4  confidence             model (same pass)
 *   5  contradiction          model, adversarial, per claim
 *   6  dependency graph       deterministic
 *   8  epistemic calibration  deterministic
 *  12  verdict                deterministic
 *
 * The model contributes structure. Every decision is made by code. That inversion is the
 * response to HRC-001, where a fluent model output was trusted end to end.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, ensureData, config } from '../config.js';
import { trace, timed } from '../trace.js';
import { say } from '../log.js';
import { detectResolution } from './resolution.js';
import { extractClaims, findContradictions } from './extract.js';
import { findEpistemicIssues } from './epistemic.js';
import { checkCitations } from './citations.js';
import { certify } from './certify.js';
import { FALSIFIABLE_TYPES } from './types.js';
import type { Certification } from './types.js';
import type { Draft, Thread } from '../types.js';

export const certificationsPath = join(DATA, 'certifications.jsonl');

export function recordCertification(c: Certification): void {
  ensureData();
  appendFileSync(certificationsPath, JSON.stringify(c) + '\n', 'utf8');
}

export function loadCertifications(): Certification[] {
  if (!existsSync(certificationsPath)) return [];
  return readFileSync(certificationsPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l) as Certification; } catch { return null; } })
    .filter((c): c is Certification => c !== null);
}

export interface RunOptions {
  /** Continue past a resolved thread. Explicit human override, per Phase 7. */
  override?: boolean;
  /** Print progress. */
  verbose?: boolean;
}

export async function runCertification(
  draft: Draft,
  thread: Thread,
  opts: RunOptions = {}
): Promise<Certification> {
  const log = (m: string) => { if (opts.verbose) say.step(m); };

  /* ---- Phase 7, first and deterministic ---- */
  const resolution = detectResolution(thread);
  trace('gate', 'argus.resolution', {
    resolved: resolution.resolved,
    signals: resolution.signals.length,
    detail: resolution.detail
  }, { threadId: thread.id, draftId: draft.id });

  log(`Resolution : ${resolution.resolved ? 'RESOLVED' : 'open'} — ${resolution.detail}`);

  /**
   * A resolved thread short-circuits. Extracting claims from a reply nobody needs would cost
   * a dozen model calls to reach a verdict already determined by the asker's own words.
   */
  if (resolution.resolved && !opts.override) {
    const c: Certification = {
      draftId: draft.id,
      threadId: thread.id,
      verdict: 'REJECT',
      reasons: [{
        rule: 'thread-resolved',
        detail: `${resolution.detail} — certification stopped before claim extraction`
      }],
      claims: [],
      contradictions: [],
      epistemic: [],
      invalidated: [],
      resolution,
      certifiedAt: new Date().toISOString(),
      model: config.llm.analyzeModel,
      models: { analyze: config.llm.analyzeModel, draft: config.llm.draftModel }
    };
    recordCertification(c);
    trace('gate', 'argus.verdict', { verdict: c.verdict, rule: 'thread-resolved' }, { draftId: draft.id });
    return c;
  }

  /* ---- Phases 1-4 ---- */
  log('Extracting claims…');
  const claims = await timed(
    'gate', 'argus.extract', () => extractClaims(draft.body, thread.title), { threadId: thread.id }
  );
  log(`Claims     : ${claims.length}`);
  trace('gate', 'argus.claims', {
    count: claims.length,
    types: claims.map((c) => c.type),
    evidence: claims.map((c) => c.evidenceClass)
  }, { draftId: draft.id });

  /* ---- Phase 5, adversarial, on the claims that can actually be wrong ---- */
  /**
   * PRODUCTION OBSERVATION 2026-07-23, first real Argus run on d_f11d8de68709_mrwj1koh:
   * extraction produced **12 claims**, and refuting them one at a time hit the 180 s CLI
   * timeout repeatedly (`argus.contradiction.failed` for c2, c3, …). Twelve sequential
   * refutations is 18-36 minutes per draft, and a timed-out refutation means the claim is
   * judged without ever being attacked.
   *
   * Refutation is now spent only where a contradiction is possible. An `observation` ("the
   * asker said their CSS is blank") cannot be refuted by documentation, and an `opinion` is
   * not the kind of thing that has counterexamples. Attacking them consumed the budget that
   * the falsifiable claims needed.
   *
   * This narrows cost, not rigour: every type in FALSIFIABLE_TYPES — the ones that assert how
   * software behaves, which is precisely the HRC-001 failure shape — is still attacked, plus
   * inferences and best-practice claims, which can be wrong about the world.
   */
  const worthRefuting = claims.filter(
    (c) => FALSIFIABLE_TYPES.has(c.type) || c.type === 'inference' || c.type === 'best-practice'
  );
  const skipped = claims.length - worthRefuting.length;
  if (skipped) log(`Refuting   : ${worthRefuting.length} of ${claims.length} claims (${skipped} cannot be contradicted)`);

  const contradictions = [];
  const refutationRan = new Set<string>();
  for (const [i, claim] of worthRefuting.entries()) {
    log(`  [${i + 1}/${worthRefuting.length}] refuting ${claim.id}: ${claim.text.slice(0, 60)}`);
    try {
      const found = await findContradictions(claim, draft.body.slice(0, 1200));
      contradictions.push(...found);
      refutationRan.add(claim.id);   // completed, whatever it found
      if (found.length) {
        log(`      ${found.length} contradiction(s), ${found.filter((f) => f.fatal).length} fatal`);
      }
    } catch (e) {
      // A failed refutation is not a pass. The claim keeps whatever evidence it declared, and
      // rules 3-6 still judge it; the failure is recorded so the gap is visible.
      trace('gate', 'argus.contradiction.failed', {
        claimId: claim.id, error: e instanceof Error ? e.message.slice(0, 160) : String(e)
      }, { draftId: draft.id, level: 'error' });
      log(`      refutation failed — claim judged on its declared evidence alone`);
    }
  }

  /* ---- Phase 8, deterministic ---- */
  const epistemic = findEpistemicIssues(claims);
  if (epistemic.length) log(`Epistemic  : ${epistemic.length} claim(s) assert more than the evidence carries`);

  /* ---- Phase 10, deterministic, no model call ---- */
  const citations = checkCitations(claims);
  const ruled = citations.findings.length;
  log(ruled
    ? `Citations  : ${ruled} claim-ruling(s) — ` +
      `${citations.findings.filter((f) => f.status === 'covered').length} covered (read them), ` +
      `${citations.findings.filter((f) => f.status === 'uncited').length} uncited, ` +
      `${citations.findings.filter((f) => f.status === 'unavailable').length} unavailable`
    : `Citations  : no corpus has standing over any of these ${claims.length} claim(s) — ` +
      `this draft is NOT grounded in reference material`);
  trace('gate', 'argus.citations', {
    ruled,
    outOfJurisdiction: citations.outOfJurisdiction.length,
    corpora: citations.corporaSummary
  }, { draftId: draft.id });

  /* ---- Phases 6 + 12, deterministic ---- */
  const result = certify({
    claims,
    contradictions,
    epistemic,
    resolution,
    refutationRan,
    citations,
    ...(opts.override ? { humanOverride: true } : {})
  });

  const certification: Certification = {
    draftId: draft.id,
    threadId: thread.id,
    verdict: result.verdict,
    reasons: result.reasons,
    claims,
    contradictions,
    epistemic,
    invalidated: result.invalidated,
    resolution,
    certifiedAt: new Date().toISOString(),
    model: config.llm.analyzeModel,
    // Both models the verdict rests on — claims from analyze, contradictions from draft. The
    // single `model` field above named only the first (evaluation, wrong-model finding).
    models: { analyze: config.llm.analyzeModel, draft: config.llm.draftModel },
    // EB-40 — persist the set the verdict was actually computed against, so this record can be
    // replayed without inferring it. Evidence only; nothing reads it back into a decision.
    refutationRan: [...refutationRan],
    citations
  };

  recordCertification(certification);
  trace('gate', 'argus.verdict', {
    verdict: result.verdict,
    rules: result.reasons.map((r) => r.rule),
    claims: claims.length,
    fatalContradictions: contradictions.filter((c) => c.fatal).length
  }, { draftId: draft.id });

  return certification;
}
