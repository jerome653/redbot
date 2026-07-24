/**
 * ARE-001 — Argus Replay Experiment
 *
 * WHAT THIS IS. A replay of Argus's deterministic verdict layer over the ONE real certification
 * record on disk, under systematic perturbation. It makes no model calls, opens no browser,
 * touches no Reddit, needs no operator credentials, and writes nothing to data/.
 *
 * WHY IT EXISTS — the measurement that justifies it, not a hunch:
 *
 *   E-26 (observed 2026-07-23): per-claim refutation hit the 180s CLI timeout on claims c2 and
 *   c3 of the real run. **Incomplete refutation is not hypothetical. It has already happened.**
 *   Rule 8 exists for exactly that case and has never fired.
 *
 *   N-06b (observed): the real record declares 8 dependency edges and reports `invalidated: 0`,
 *   because every downstream claim was independently refuted. Propagation is correct code with
 *   zero production exposure.
 *
 *   N-06c / EB-17 (observed): both real verdicts are REJECT. A certification engine that has
 *   never certified anything has not been shown to DISCRIMINATE.
 *
 * WHAT IT CANNOT TELL YOU. This measures the deterministic RULES against one real claim
 * structure. It does not measure extraction, classification, provenance assignment or
 * refutation — all of which are model work — and it is one draft, so nothing here generalises
 * to "Argus's false-positive rate". Treat every result as a property of the rule layer.
 *
 * Run:  node qa/ARE-001-argus-replay.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { certify } from '../dist/argus/certify.js';
import { FALSIFIABLE_TYPES } from '../dist/argus/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CERTS = join(ROOT, 'data', 'certifications.jsonl');

if (!existsSync(CERTS)) {
  console.error('No certifications.jsonl on disk. Nothing to replay.');
  process.exit(1);
}

const records = readFileSync(CERTS, 'utf8')
  .split('\n').filter((l) => l.trim())
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

// EB-35: count distinct drafts, not records. Replay the richest record per draft.
const richest = new Map();
for (const r of records) {
  const prev = richest.get(r.draftId);
  if (!prev || (r.claims ?? []).length > (prev.claims ?? []).length) richest.set(r.draftId, r);
}

console.log('ARE-001 — Argus Replay Experiment');
console.log('='.repeat(78));
console.log(`certification records on disk : ${records.length}`);
console.log(`distinct drafts               : ${richest.size}`);

const base = [...richest.values()].sort((a, b) => (b.claims ?? []).length - (a.claims ?? []).length)[0];
const claims = base.claims ?? [];
const contradictions = base.contradictions ?? [];
const epistemic = base.epistemic ?? [];
const resolution = base.resolution ?? { resolved: false, signals: [], detail: 'none recorded' };

const falsifiable = claims.filter((c) => FALSIFIABLE_TYPES.has(c.type));
const edges = claims.reduce((n, c) => n + (c.dependsOn?.length ?? 0), 0);
const allIds = new Set(claims.map((c) => c.id));

console.log(`replaying                     : ${base.draftId}`);
console.log(`  claims ${claims.length} (falsifiable ${falsifiable.length}) · contradictions ${contradictions.length} ` +
            `(fatal ${contradictions.filter((c) => c.fatal).length}) · epistemic ${epistemic.length} · dep-edges ${edges}`);
console.log(`  recorded verdict: ${base.verdict} · recorded invalidated: ${(base.invalidated ?? []).length}`);
console.log('='.repeat(78));

const ruleCounts = (r) => {
  const m = new Map();
  for (const x of r.reasons) m.set(x.rule, (m.get(x.rule) ?? 0) + 1);
  return [...m.entries()].map(([k, v]) => `${k}×${v}`).join(', ') || '(none)';
};

const results = [];
function run(id, question, input, expectation) {
  const r = certify(input);
  results.push({ id, question, verdict: r.verdict, invalidated: r.invalidated.length, expectation, r });
  console.log(`\n${id} — ${question}`);
  console.log(`  verdict     : ${r.verdict}${expectation ? `   (expected ${expectation})` : ''}`);
  console.log(`  invalidated : ${r.invalidated.length}`);
  console.log(`  rules fired : ${ruleCounts(r)}`);
  if (r.invalidated.length) {
    for (const inv of r.invalidated.slice(0, 4)) {
      console.log(`                ${inv.claimId} ← dead because ${inv.becauseOf} failed`);
    }
  }
  return r;
}

/* ---------------------------------------------------------------- *
 * P0 — does the replay reproduce the recorded verdict?
 * If this disagrees, every result below is untrustworthy.
 * ---------------------------------------------------------------- */
const p0 = run('P0', 'exact recorded input — reproduction check',
  { claims, contradictions, epistemic, resolution }, base.verdict);
const reproduces = p0.verdict === base.verdict;
console.log(`  REPRODUCES  : ${reproduces ? 'yes' : 'NO — replay disagrees with the record'}`);

/* ---------------------------------------------------------------- *
 * P1 — the --override path: resolution suppressed, everything else real
 * ---------------------------------------------------------------- */
run('P1', 'human override of thread-resolved',
  { claims, contradictions, epistemic, resolution, humanOverride: true }, 'REJECT');

/* ---------------------------------------------------------------- *
 * P2 — RULE 8. The E-26 case: refutation ran on nothing.
 * Contradictions removed AND refutationRan empty, so falsifiable claims stand unattacked.
 * ---------------------------------------------------------------- */
run('P2', 'RULE 8 — refutation completed for no claim (the observed timeout case)',
  { claims, contradictions: [], epistemic: [], resolution, humanOverride: true,
    refutationRan: new Set() }, 'ESCALATE if Rule 8 fires');

/* ---------------------------------------------------------------- *
 * P2b — the dangerous inverse: refutation "ran" on everything and found nothing.
 * This is what the default inference (attacked-set) assumes when a call times out silently.
 * ---------------------------------------------------------------- */
run('P2b', 'RULE 8 suppressed — refutation ran on every claim and found nothing (epistemic ALSO cleared)',
  { claims, contradictions: [], epistemic: [], resolution, humanOverride: true,
    refutationRan: allIds }, 'whatever remains after Rule 8 is removed');

/* ---------------------------------------------------------------- *
 * P2c — the faithful version of P2b, and the question that matters most.
 *
 * P2b cleared `epistemic` along with the contradictions. That is NOT what a silent refutation
 * failure looks like: Phase 8 compares the language of a claim against the certainty its
 * provenance supports, and never consults contradictions. In a real "refutation returned
 * nothing" run the epistemic issues still exist.
 *
 * So this asks, of the REAL claims of the REAL known-false draft:
 *   if refutation had come back empty instead of finding 32 contradictions,
 *   would Argus have certified HRC-001?
 * ---------------------------------------------------------------- */
run('P2c', 'FAITHFUL silent-refutation-failure — real epistemic issues retained',
  { claims, contradictions: [], epistemic, resolution, humanOverride: true,
    refutationRan: allIds }, 'the answer to "would Argus have certified HRC-001?"');

/* ---------------------------------------------------------------- *
 * P3 — PHASE 6 PROPAGATION. One upstream claim fatal, dependents clean.
 * The real run could not exercise this because every dependent was independently refuted.
 * ---------------------------------------------------------------- */
const depCount = new Map();
for (const c of claims) for (const d of c.dependsOn ?? []) depCount.set(d, (depCount.get(d) ?? 0) + 1);
const [mostDepended] = [...depCount.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

if (mostDepended) {
  const oneFatal = contradictions
    .filter((c) => c.claimId === mostDepended && c.fatal)
    .slice(0, 1);
  console.log(`\n  (most-depended-upon claim: ${mostDepended}, ${depCount.get(mostDepended)} dependents)`);
  run('P3', 'PHASE 6 — exactly one upstream claim fatal, all dependents otherwise clean',
    { claims, contradictions: oneFatal, epistemic: [], resolution, humanOverride: true,
      refutationRan: allIds }, 'REJECT with invalidated > 0');
} else {
  console.log('\nP3 — SKIPPED: no dependency edges in this record.');
}

/* ---------------------------------------------------------------- *
 * P4 — DISCRIMINATION. Can this real claim structure reach CERTIFIED at all?
 * Every failure condition removed one at a time until either CERTIFIED appears or the
 * blocking rule is named. This is the EB-17 question asked of the rule layer.
 * ---------------------------------------------------------------- */
const strengthened = claims.map((c) => ({
  ...c,
  // Give every claim the strongest honest provenance and confidence the enums allow.
  evidenceClass: 'primary-documentation',
  confidence: 'high'
}));

run('P4', 'DISCRIMINATION — same structure, every claim authoritative + high confidence, nothing contradicted',
  { claims: strengthened, contradictions: [], epistemic: [], resolution, humanOverride: true,
    refutationRan: allIds }, 'CERTIFIED if the rule layer can ever certify');

/* ---------------------------------------------------------------- *
 * P5 — is CERTIFIED reachable WITHOUT the human override? i.e. does a resolved
 * thread permanently bar certification regardless of claim quality?
 * ---------------------------------------------------------------- */
run('P5', 'resolved thread + otherwise perfect claims, no override',
  { claims: strengthened, contradictions: [], epistemic: [], resolution,
    refutationRan: allIds }, 'REJECT — resolution should dominate');

/* ---------------------------------------------------------------- */
console.log('\n' + '='.repeat(78));
console.log('SUMMARY');
console.log('='.repeat(78));
for (const r of results) {
  console.log(`  ${r.id.padEnd(4)} ${r.verdict.padEnd(10)} invalidated=${String(r.invalidated).padEnd(3)} ${r.question}`);
}
const verdicts = new Set(results.map((r) => r.verdict));
console.log(`\ndistinct verdicts produced: ${[...verdicts].join(', ')}`);
console.log(`replay reproduces the recorded verdict: ${reproduces ? 'YES' : 'NO'}`);
console.log('\nScope: one draft, rule layer only. Nothing here measures extraction or refutation.');
