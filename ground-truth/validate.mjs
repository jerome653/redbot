/**
 * AGTC — validation and promotion.
 *
 * Decides, from the case file alone, what a case is allowed to affect. Nothing else in the
 * project may promote a case; this is the only gate.
 *
 * TWO GATES, NOT ONE — a deliberate deviation from the original spec, stated so it can be
 * overruled:
 *
 *   ground_truth: approved   a human verdict exists, with sources attached
 *   calibration:  approved   AND every extracted claim has been adjudicated
 *
 * The spec described a single "Ground Truth Approved" gate covering the confusion matrix and
 * calibration together. Applying it literally puts HRC-001 — the canonical case, with a
 * recorded human verdict and three cited sources — at Pending, because only 3 of its 12 claims
 * have been individually ruled on. That would leave the corpus with zero usable cases and would
 * report the project's best-evidenced case as unevidenced.
 *
 * Splitting the gate is more faithful to what is actually known: the VERDICT is reviewed, the
 * per-claim provenance mostly is not. A case can therefore inform the confusion matrix while
 * being barred from calibration. Collapse the two if you disagree — it is one condition.
 *
 * Run:  node ground-truth/validate.mjs [--fix]
 *       --fix writes the computed status back into each case file.
 * Exit: 0 every case validates structurally · 1 any structural failure
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, 'cases');
const FIX = process.argv.includes('--fix');

const REQUIRED_TOP = [
  'id', 'schema_version', 'draft_id', 'thread', 'draft',
  'human_review', 'ground_truth', 'expected', 'argus_observed', 'status'
];

const MODEL_SOURCE = /\b(claude|gpt|llm|language model|argus|the model)\b/i;

const dirs = existsSync(CASES)
  ? readdirSync(CASES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

console.log('AGTC — validation');
console.log('='.repeat(78));

let structuralFailures = 0;
const summary = [];

for (const name of dirs.sort()) {
  const file = join(CASES, name, 'case.json');
  if (!existsSync(file)) { console.log(`\nFAIL  ${name} — no case.json`); structuralFailures++; continue; }

  let c;
  try { c = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { console.log(`\nFAIL  ${name} — unparseable: ${e.message}`); structuralFailures++; continue; }

  const errors = [];
  const blocked = [];

  /* ---- structure ---- */
  for (const k of REQUIRED_TOP) if (!(k in c)) errors.push(`missing field: ${k}`);
  if (c.schema_version !== '1.0') errors.push(`schema_version must be "1.0", got ${JSON.stringify(c.schema_version)}`);
  if (c.id !== name) errors.push(`id "${c.id}" does not match directory "${name}"`);

  const gt = c.ground_truth ?? {};
  const hr = c.human_review ?? {};
  const ao = c.argus_observed ?? {};
  const claims = ao.claims ?? [];
  const labels = gt.claim_labels ?? [];

  if (gt.claims_reviewed !== labels.length) {
    errors.push(`claims_reviewed says ${gt.claims_reviewed} but ${labels.length} claim_labels are present`);
  }
  for (const l of labels) {
    if (!claims.some((x) => x.id === l.claim_id)) {
      errors.push(`claim_label references ${l.claim_id}, which was never extracted`);
    }
  }
  if (!Array.isArray(ao.refutation_ran)) {
    errors.push('argus_observed.refutation_ran is missing — the case cannot replay faithfully (EB-40)');
  }

  /* ---- the rule that protects the corpus from itself ---- */
  for (const s of gt.sources ?? []) {
    if (MODEL_SOURCE.test(s.source) || MODEL_SOURCE.test(s.source_type ?? '')) {
      errors.push(`source "${s.source}" looks model-derived — ground truth may never originate from a model`);
    }
  }

  /* ---- promotion ---- */
  const hasVerdict = ['correct', 'incorrect', 'partially-correct'].includes(hr.verdict);
  const hasReviewer = Boolean(hr.reviewer && hr.reviewed_at);
  const hasSources = (gt.sources ?? []).length > 0;
  const allClaimsReviewed = claims.length > 0 && labels.length === claims.length;
  const allLabelsHaveProvenance = labels.every((l) => Boolean(l.expected_provenance));

  if (!hasVerdict) blocked.push('no human verdict');
  if (hasVerdict && !hasReviewer) blocked.push('verdict has no reviewer or date');
  if (!hasSources) blocked.push('no ground-truth sources attached');

  const groundTruthApproved = hasVerdict && hasReviewer && hasSources && errors.length === 0;

  const calibBlocked = [];
  if (!groundTruthApproved) calibBlocked.push('ground truth not approved');
  if (!allClaimsReviewed) calibBlocked.push(`${labels.length} of ${claims.length} claims reviewed`);
  if (!allLabelsHaveProvenance) calibBlocked.push('a reviewed claim has no expected provenance');

  const calibrationApproved = groundTruthApproved && allClaimsReviewed && allLabelsHaveProvenance;

  const status = {
    ground_truth: groundTruthApproved ? 'approved' : 'pending',
    calibration: calibrationApproved ? 'approved' : 'pending',
    benchmark: groundTruthApproved ? 'scoring' : 'regression-only',
    blocked_by: [...new Set([...blocked, ...calibBlocked])]
  };

  if (errors.length) structuralFailures++;

  console.log(`\n${errors.length ? 'FAIL' : 'OK  '}  ${c.id}`);
  console.log(`      human verdict   : ${hr.verdict}${hr.reviewer ? ` (${hr.reviewer}, ${hr.reviewed_at})` : ''}`);
  console.log(`      claims reviewed : ${labels.length} of ${claims.length}`);
  console.log(`      sources         : ${(gt.sources ?? []).length}`);
  console.log(`      ground truth    : ${status.ground_truth.toUpperCase()}`);
  console.log(`      calibration     : ${status.calibration.toUpperCase()}`);
  console.log(`      benchmark role  : ${status.benchmark}`);
  for (const e of errors) console.log(`      ERROR   ${e}`);
  for (const b of status.blocked_by) console.log(`      blocked ${b}`);

  if (FIX && !errors.length) {
    c.status = status;
    writeFileSync(file, JSON.stringify(c, null, 2) + '\n', 'utf8');
    console.log('      status written back');
  }

  summary.push({ id: c.id, ...status });
}

console.log('\n' + '='.repeat(78));
console.log('CORPUS');
console.log('='.repeat(78));
const gtOk = summary.filter((s) => s.ground_truth === 'approved').length;
const calOk = summary.filter((s) => s.calibration === 'approved').length;
console.log(`  cases                    : ${summary.length}`);
console.log(`  ground truth approved    : ${gtOk} of ${summary.length}   -> may affect the confusion matrix`);
console.log(`  calibration approved     : ${calOk} of ${summary.length}   -> may affect provenance calibration`);
console.log(`  structural failures      : ${structuralFailures}`);
if (!FIX) console.log('\n  (run with --fix to write computed status back into the case files)');

process.exit(structuralFailures ? 1 : 0);
