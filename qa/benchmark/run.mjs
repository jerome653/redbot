/**
 * The Argus benchmark runner.
 *
 * Executes every frozen case in `cases/` through Argus's deterministic verdict layer and
 * reports a confusion matrix plus per-stage metrics against human-authored ground truth.
 *
 * REPLAY MODE (this file). No model calls, no network, no credentials, no clock dependence.
 * Each case carries what the model actually produced, so extraction, provenance, refutation and
 * propagation are all scoreable offline — the recorded output is the thing being graded.
 *
 * LIVE MODE (not built). Re-running `candidate_reply` through extraction and refutation to
 * regenerate the `argus` block requires operator credentials and cannot be verified today.
 * Deliberately absent rather than written untested.
 *
 * WHAT A PASS MEANS. Not "the verdict was right" — "the verdict was right FOR THE REQUIRED
 * REASONS". A case that reaches REJECT without firing its required rules is a regression, and
 * is reported as one.
 *
 * Run:  node qa/benchmark/run.mjs [--verbose]
 * Exit: 0 all cases pass · 1 any case fails
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { certify } from '../../dist/argus/certify.js';
import { EVIDENCE_CLASSES, AUTHORITATIVE, NO_PROVENANCE } from '../../dist/argus/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, 'cases');

/* ------------------------------------------------------------------ *
 * AGTC promotion gate
 *
 * The Ground Truth Corpus is the only authority on whether a case may affect scoring. The
 * benchmark REPLAYS everything and SCORES only what the corpus has approved — so a case whose
 * ground truth is still pending is exercised for regression, and contributes nothing to the
 * confusion matrix or the calibration table.
 *
 * Without this, "provenance 0/3 inflated" would keep being reported from a case that reviews
 * 3 of its 12 claims — a number below the corpus's own bar for calibration.
 * ------------------------------------------------------------------ */
const AGTC = join(HERE, '..', '..', 'ground-truth', 'cases');
const corpus = new Map();   // draft_id -> status
if (existsSync(AGTC)) {
  for (const d of readdirSync(AGTC, { withFileTypes: true }).filter((x) => x.isDirectory())) {
    const f = join(AGTC, d.name, 'case.json');
    if (!existsSync(f)) continue;
    try {
      const c = JSON.parse(readFileSync(f, 'utf8'));
      corpus.set(c.draft_id, { id: c.id, ...c.status });
    } catch { /* a malformed case is validate.mjs's problem, not the benchmark's */ }
  }
}
const corpusFor = (draftId) => corpus.get(draftId) ?? null;
const VERBOSE = process.argv.includes('--verbose');
const VERDICTS = ['CERTIFIED', 'ESCALATE', 'REJECT'];

/* ------------------------------------------------------------------ *
 * Provenance calibration scales
 *
 * Two scales, because they answer different questions and one of them is honest arithmetic
 * while the other is not quite.
 *
 * TIER (primary) — three semantic bands the rules actually branch on:
 *     3 authoritative · 2 supportive · 1 no provenance
 *   A tier delta means something: +1 is "claimed support the evidence does not give",
 *   +2 is "claimed authority for something with no provenance at all".
 *
 * ORDINAL (secondary) — position within EVIDENCE_CLASSES, which is declared strongest-first.
 *   Reported because it is finer, but it is an ORDINAL scale: the distance from
 *   `primary-documentation` to `official-implementation` is not one "unit" of anything. Means
 *   over it are indicative, not measurements, and are labelled as such.
 * ------------------------------------------------------------------ */
const tierOf = (cls) => (AUTHORITATIVE.has(cls) ? 3 : NO_PROVENANCE.has(cls) ? 1 : 2);
const rankOf = (cls) => {
  const i = EVIDENCE_CLASSES.indexOf(cls);
  return i === -1 ? EVIDENCE_CLASSES.length : i;   // unknown class sorts weakest
};

const cases = readdirSync(CASES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(CASES, f), 'utf8')))
  .sort((a, b) => a.id.localeCompare(b.id));

/** Build the certify() input a case describes. */
function inputFor(c) {
  const a = c.argus;
  const claims = a.claims;
  const contradictions = c.input.drop_contradictions ? [] : a.contradictions;
  const allIds = new Set(claims.map((x) => x.id));

  const input = {
    claims,
    contradictions,
    epistemic: a.epistemic,
    resolution: a.resolution,
    humanOverride: Boolean(c.input.human_override)
  };
  if (c.input.refutation_ran === 'all') input.refutationRan = allIds;
  else if (c.input.refutation_ran === 'none') input.refutationRan = new Set();
  else if (Array.isArray(c.input.refutation_ran)) input.refutationRan = new Set(c.input.refutation_ran);
  // 'infer' leaves it undefined, which makes certify() derive it from the attacked set.
  //
  // MEASURED 2026-07-23 — 'infer' is NOT faithful when refutation succeeded and found nothing.
  // Replaying cert #2 with 'infer' fired `unrefuted-falsifiable-claim` on c13, which the
  // production run did NOT fire: c13's refutation call completed and returned zero
  // contradictions, so production had it in refutationRan while the attacked-set inference
  // does not. `certifications.jsonl` does not persist refutationRan, so the distinction cannot
  // be recovered from the record. Cases must declare the list explicitly to replay faithfully.
  return input;
}

const rulesOf = (r) => r.reasons.map((x) => x.rule);

/* ------------------------------------------------------------------ *
 * Per-stage scoring against ground truth
 * ------------------------------------------------------------------ */
function scoreStages(c, result, effectiveInput) {
  const gt = c.ground_truth;
  const a = c.argus;
  /**
   * Score refutation against the contradictions the case ACTUALLY ran with, not the ones the
   * record happens to contain.
   *
   * Found by running this: HRC-001-B drops all contradictions to simulate a silent refutation
   * failure, and the first version of this function read `a.contradictions` anyway — reporting
   * "TP 5" for the one scenario in which refutation caught nothing at all. A metric that reads
   * different data from the thing it is measuring is worse than no metric.
   */
  const fatalBy = new Set(effectiveInput.contradictions.filter((x) => x.fatal).map((x) => x.claimId));

  /**
   * An UNLABELLED case has no answer key, so refutation cannot be scored against it.
   *
   * Measured this session: scoring CERT-002 anyway reported `FP 5` — five fatal contradictions
   * on claims that appear in neither `false_claims` nor `dependent_on_false`, because both
   * lists are empty by design. Those are not false positives; they are unjudged. Reporting them
   * as FP would manufacture a defect out of missing ground truth, which is the opposite of what
   * this benchmark is for.
   */
  // The corpus overrides the case's inline ground truth. A case whose draft is not
  // ground-truth-approved is replayed but never scored, whatever the case file claims.
  const agtc = corpusFor(c.draft_id);
  if (gt.human_verdict === 'unlabelled' || (agtc && agtc.ground_truth !== 'approved')) {
    return {
      unscored: true,
      refutation: { tp: 0, fn: 0, fp: 0, fnIds: [], fpIds: [] },
      provenance: { correct: 0, declared: 0, wrong: [] },
      epistemic: { hit: 0, expected: 0, extra: 0 },
      propagation: { invalidated: result.invalidated.length, ids: result.invalidated.map((i) => i.claimId) },
      extraction: { claims: a.claims.length, declared_truth: 0 }
    };
  }
  const known = new Set([...(gt.false_claims ?? []), ...(gt.dependent_on_false ?? [])]);

  /* refutation — did a fatal contradiction land on each independently-false claim? */
  const tp = (gt.false_claims ?? []).filter((id) => fatalBy.has(id));
  const fn = (gt.false_claims ?? []).filter((id) => !fatalBy.has(id));
  const fp = [...fatalBy].filter((id) => !known.has(id));

  /* provenance — where ground truth declares what the class should have been */
  const provEntries = Object.entries(gt.expected_provenance ?? {});
  const provCorrect = provEntries.filter(([id, want]) => {
    const claim = a.claims.find((x) => x.id === id);
    return claim && claim.evidenceClass === want;
  });

  /* epistemic — did Phase 8 flag the claims ground truth says outrun their evidence? */
  const epiActual = new Set(a.epistemic.map((e) => e.claimId));
  const epiExpected = gt.expected_epistemic ?? [];
  const epiHit = epiExpected.filter((id) => epiActual.has(id));
  const epiExtra = [...epiActual].filter((id) => !epiExpected.includes(id));

  /* propagation — recomputed by certify() this run */
  const invalidated = result.invalidated.map((i) => i.claimId);

  return {
    refutation: { tp: tp.length, fn: fn.length, fp: fp.length, fnIds: fn, fpIds: fp },
    provenance: { correct: provCorrect.length, declared: provEntries.length,
                  wrong: provEntries.filter(([id]) => !provCorrect.some(([c2]) => c2 === id)).map(([id, want]) => {
                    const claim = a.claims.find((x) => x.id === id);
                    return `${id}: declared ${claim?.evidenceClass}, should be ${want}`;
                  }) },
    epistemic: { hit: epiHit.length, expected: epiExpected.length, extra: epiExtra.length },
    propagation: { invalidated: invalidated.length, ids: invalidated },
    extraction: { claims: a.claims.length, declared_truth: (gt.false_claims ?? []).length + (gt.unrefuted_claims ?? []).length + (gt.dependent_on_false ?? []).length }
  };
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */
console.log('ARGUS BENCHMARK');
console.log('='.repeat(78));
console.log(`cases: ${cases.length}   mode: replay (no model calls, no network)`);
console.log('='.repeat(78));

const matrix = new Map();          // `${expected}|${actual}` -> count
const rows = [];
let failures = 0;

for (const c of cases) {
  const effectiveInput = inputFor(c);
  const result = certify(effectiveInput);
  const fired = rulesOf(result);
  const exp = c.expected;

  const verdictOk = (exp.verdict_in ?? [exp.verdict]).includes(result.verdict);
  const missing = (exp.rules_required ?? []).filter((r) => !fired.includes(r));
  const forbidden = (exp.rules_forbidden ?? []).filter((r) => fired.includes(r));
  const pass = verdictOk && !missing.length && !forbidden.length;
  if (!pass) failures++;

  /**
   * Canonical expectation for the matrix. Where a case declares an observed baseline, that is
   * the honest expectation — otherwise a case that legitimately allows two verdicts renders as
   * a miss in the matrix while passing, which reads as a failure that is not there.
   */
  const canonical = exp.verdict_observed_2026_07_23 ?? (exp.verdict_in ?? [exp.verdict])[0];
  const key = `${canonical}|${result.verdict}`;
  matrix.set(key, (matrix.get(key) ?? 0) + 1);

  const stages = scoreStages(c, result, effectiveInput);
  rows.push({ c, result, fired, pass, missing, forbidden, stages });

  console.log(`\n${pass ? 'PASS' : 'FAIL'}  ${c.id}  [${c.failure_class}]`);
  console.log(`      ${c.title}`);
  console.log(`      provenance : ${c.provenance}`);
  console.log(`      verdict    : ${result.verdict}   expected ${(exp.verdict_in ?? [exp.verdict]).join(' or ')}`);
  if (exp.verdict_observed_2026_07_23 && result.verdict !== exp.verdict_observed_2026_07_23) {
    console.log(`      CHANGED    : baseline was ${exp.verdict_observed_2026_07_23}, now ${result.verdict}`);
  }
  console.log(`      rules      : ${[...new Set(fired)].join(', ') || '(none)'}`);
  if (missing.length) console.log(`      MISSING    : ${missing.join(', ')}  ← right answer, wrong reasons`);
  if (forbidden.length) console.log(`      FORBIDDEN  : ${forbidden.join(', ')}`);
  if (VERBOSE) {
    console.log(`      refutation : TP ${stages.refutation.tp}  FN ${stages.refutation.fn}  FP ${stages.refutation.fp}`);
    if (stages.refutation.fnIds.length) console.log(`                   missed: ${stages.refutation.fnIds.join(', ')}`);
    console.log(`      provenance : ${stages.provenance.correct}/${stages.provenance.declared} correct`);
    for (const w of stages.provenance.wrong) console.log(`                   ${w}`);
    console.log(`      epistemic  : ${stages.epistemic.hit}/${stages.epistemic.expected} expected flagged, ${stages.epistemic.extra} extra`);
    console.log(`      propagation: ${stages.propagation.invalidated} invalidated ${stages.propagation.ids.length ? `(${stages.propagation.ids.join(', ')})` : ''}`);
  }
}

/* ------------------------------------------------------------------ *
 * PROVENANCE CALIBRATION
 *
 * Deduplicated by (draft, claim). Three cases here share one draft, so counting every case
 * would report the same three claims nine times and treat one draft as a sample of nine.
 * Same rule as EB-35: count distinct subjects, not records.
 * ------------------------------------------------------------------ */
const calib = new Map();          // `${draft}|${claimId}` -> row
const calibBlocked = [];
for (const r of rows) {
  const gt = r.c.ground_truth;
  const agtc = corpusFor(r.c.draft_id);
  if (agtc && agtc.calibration !== 'approved') {
    if (!calibBlocked.some((b) => b.draft === r.c.draft_id)) {
      calibBlocked.push({ draft: r.c.draft_id, id: agtc.id, why: (agtc.blocked_by ?? []).join('; ') });
    }
    continue;
  }
  for (const [id, expected] of Object.entries(gt.expected_provenance ?? {})) {
    const key = `${r.c.draft_id}|${id}`;
    if (calib.has(key)) continue;
    const claim = r.c.argus.claims.find((x) => x.id === id);
    if (!claim) continue;
    calib.set(key, {
      draft: r.c.draft_id, id, type: claim.type,
      expected, assigned: claim.evidenceClass,
      tierDelta: tierOf(claim.evidenceClass) - tierOf(expected),
      rankDelta: rankOf(expected) - rankOf(claim.evidenceClass)   // + means assigned is stronger
    });
  }
}

const cal = [...calib.values()];
console.log('\n' + '='.repeat(78));
console.log('PROVENANCE CALIBRATION — direction, not just accuracy');
console.log('='.repeat(78));

for (const b of calibBlocked) {
  console.log(`  EXCLUDED by the corpus: ${b.id} — ${b.why}`);
}
if (!cal.length) {
  console.log(`  ${calibBlocked.length ? 'No corpus case is calibration-approved.' : 'No case declares an expected provenance.'} Nothing to calibrate.`);
  console.log('  This is the honest state, not a missing feature: calibration requires every');
  console.log('  extracted claim to have been adjudicated by a person.');
} else {
  console.log(`  distinct (draft, claim) pairs with a declared expectation: ${cal.length}`);
  console.log(`  distinct drafts: ${new Set(cal.map((x) => x.draft)).size}\n`);
  console.log(`  ${'claim'.padEnd(6)}${'type'.padEnd(22)}${'expected'.padEnd(22)}${'assigned'.padEnd(28)}dir`);
  for (const x of cal) {
    const dir = x.tierDelta > 0 ? `+${x.tierDelta}` : x.tierDelta < 0 ? String(x.tierDelta) : '0';
    console.log(`  ${x.id.padEnd(6)}${x.type.padEnd(22)}${x.expected.padEnd(22)}${x.assigned.padEnd(28)}${dir}`);
  }

  const inflated = cal.filter((x) => x.tierDelta > 0);
  const deflated = cal.filter((x) => x.tierDelta < 0);
  const exact = cal.filter((x) => x.tierDelta === 0 && x.expected === x.assigned);
  const meanTier = cal.reduce((s, x) => s + x.tierDelta, 0) / cal.length;
  const meanRank = cal.reduce((s, x) => s + x.rankDelta, 0) / cal.length;

  console.log(`\n  inflated (assigned stronger) : ${inflated.length}/${cal.length}`);
  console.log(`  deflated (assigned weaker)   : ${deflated.length}/${cal.length}`);
  console.log(`  exact match                  : ${exact.length}/${cal.length}`);
  console.log(`  mean tier delta              : ${meanTier >= 0 ? '+' : ''}${meanTier.toFixed(2)}  (bands: 3 authoritative / 2 supportive / 1 none)`);
  console.log(`  mean ordinal delta           : ${meanRank >= 0 ? '+' : ''}${meanRank.toFixed(2)}  (ORDINAL scale — indicative, not a measurement)`);

  const byType = new Map();
  for (const x of cal) {
    const v = byType.get(x.type) ?? { n: 0, inflated: 0, sum: 0 };
    v.n++; v.sum += x.tierDelta; if (x.tierDelta > 0) v.inflated++;
    byType.set(x.type, v);
  }
  console.log('\n  by claim type:');
  for (const [t, v] of [...byType.entries()].sort()) {
    console.log(`    ${t.padEnd(22)} ${v.inflated}/${v.n} inflated, mean tier delta ${(v.sum / v.n) >= 0 ? '+' : ''}${(v.sum / v.n).toFixed(2)}`);
  }
  console.log(`\n  READ WITH CARE: ${cal.length} claims from ${new Set(cal.map((x) => x.draft)).size} draft. This measures a`);
  console.log('  direction, not a rate. One more certified draft doubles the evidence.');
}

/* ------------------------------------------------------------------ *
 * VERDICT-PATH COVERAGE — the milestone that matters more than case count
 *
 * The appropriate verdict is derived from the human verdict, not declared per case, so frozen
 * cases need no edit: incorrect -> REJECT · correct -> CERTIFIED · partially-correct -> ESCALATE.
 * ------------------------------------------------------------------ */
const APPROPRIATE = { incorrect: 'REJECT', correct: 'CERTIFIED', 'partially-correct': 'ESCALATE' };
const paths = new Map();
for (const r of rows) {
  const want = APPROPRIATE[r.c.ground_truth.human_verdict];
  if (!want) continue;
  const got = r.result.verdict;
  const label = got === want ? `correct-${got}` : `false-${got}`;
  const v = paths.get(label) ?? [];
  v.push(r.c.id);
  paths.set(label, v);
}

const ALL_PATHS = [
  'correct-CERTIFIED', 'correct-ESCALATE', 'correct-REJECT',
  'false-CERTIFIED', 'false-ESCALATE', 'false-REJECT'
];
console.log('\n' + '='.repeat(78));
console.log('VERDICT-PATH COVERAGE');
console.log('='.repeat(78));
console.log('  Milestone: at least one confirmed example of every path.\n');
let covered = 0;
for (const p of ALL_PATHS) {
  const hits = paths.get(p) ?? [];
  if (hits.length) covered++;
  console.log(`  ${hits.length ? 'YES' : ' - '}  ${p.padEnd(20)} ${hits.join(', ') || '(no case)'}`);
}
console.log(`\n  ${covered}/6 paths covered.`);
if (!paths.get('correct-CERTIFIED')) {
  console.log('  Until correct-CERTIFIED exists, the benchmark cannot distinguish a strict');
  console.log('  engine from a broken one — everything it has ever seen, it rejected.');
}

/* ---------------- confusion matrix ---------------- */
console.log('\n' + '='.repeat(78));
console.log('CONFUSION MATRIX — expected (rows) × actual (columns)');
console.log('='.repeat(78));
console.log(`${''.padEnd(12)}${VERDICTS.map((v) => v.padEnd(11)).join('')}`);
for (const e of VERDICTS) {
  const cells = VERDICTS.map((a) => String(matrix.get(`${e}|${a}`) ?? 0).padEnd(11));
  console.log(`${e.padEnd(12)}${cells.join('')}`);
}

/* ---------------- per-stage totals ---------------- */
const sum = (f) => rows.reduce((n, r) => n + f(r.stages), 0);
console.log('\n' + '='.repeat(78));
console.log('PER-STAGE METRICS');
console.log('='.repeat(78));
console.log('Counts, never bare rates — the denominator is always shown because n is small.\n');

const tp = sum((s) => s.refutation.tp), fn = sum((s) => s.refutation.fn), fp = sum((s) => s.refutation.fp);
const provC = sum((s) => s.provenance.correct), provD = sum((s) => s.provenance.declared);
const epiH = sum((s) => s.epistemic.hit), epiE = sum((s) => s.epistemic.expected);

/**
 * Denominators differ on purpose, and the difference is not cosmetic.
 *
 * Provenance is a property of the DRAFT — the three cases here share one draft, so the same
 * three claims carry the same three classes in all of them. Reporting 0/9 would present one
 * draft as a sample of nine (the EB-35 hazard, in this runner's own output).
 *
 * Refutation is a property of the SCENARIO — HRC-001-B deliberately runs with no contradictions,
 * so its refutation result genuinely differs from the other two. Per-case is correct there.
 */
const calCorrect = cal.filter((x) => x.expected === x.assigned).length;
console.log(`  Claim extraction     ${sum((s) => s.extraction.claims)} claim-instances over ${cases.length} case(s) — precision/recall NOT scored: no case declares an expected claim list`);
console.log(`  Provenance accuracy  ${calCorrect}/${cal.length} correct  [per DISTINCT claim, ${new Set(cal.map((x) => x.draft)).size} draft(s)]`);
const scored = rows.filter((r) => !r.stages.unscored).length;
console.log(`  Refutation           TP ${tp}  FN ${fn}  FP ${fp}  [per LABELLED case-scenario, ${scored} of ${cases.length} scored]`);
console.log(`  Dependency propagation  ${sum((s) => s.propagation.invalidated)} claim(s) invalidated across all cases`);
console.log(`  Epistemic            ${epiH}/${epiE} expected issues flagged`);
console.log(`  Final verdict        ${cases.length - failures}/${cases.length} cases correct for the required reasons`);

/* ---------------- failure classes ---------------- */
const byClass = new Map();
for (const r of rows) {
  const k = r.c.failure_class;
  const v = byClass.get(k) ?? { pass: 0, total: 0 };
  v.total++; if (r.pass) v.pass++;
  byClass.set(k, v);
}
console.log('\nBY FAILURE CLASS');
for (const [k, v] of [...byClass.entries()].sort()) console.log(`  ${String(v.pass + '/' + v.total).padEnd(6)} ${k}`);

console.log('\n' + '='.repeat(78));
console.log(`RESULT: ${cases.length - failures}/${cases.length} passed, ${failures} failed`);
const draftCount = new Set(cases.map((c) => c.draft_id)).size;
const unlabelled = rows.filter((r) => r.stages.unscored).length;
console.log(`\nSCOPE: ${cases.length} case(s) from ${draftCount} draft(s); ${unlabelled} unlabelled (no human verdict,`);
console.log('regression-only). Nothing here is a population rate. The benchmark is a regression');
console.log('suite until it covers many drafts and many failure classes.');

/* ---------------- machine-readable summary ---------------- */
const summary = {
  generated_from: 'qa/benchmark/run.mjs',
  mode: 'replay',
  cases: cases.length,
  passed: cases.length - failures,
  failed: failures,
  distinct_drafts: [...new Set(cases.map((c) => c.draft_id))].length,
  failure_classes: Object.fromEntries(byClass),
  stages: {
    provenance_correct: provC, provenance_declared: provD,
    refutation_tp: tp, refutation_fn: fn, refutation_fp: fp,
    epistemic_hit: epiH, epistemic_expected: epiE,
    propagated: sum((s) => s.propagation.invalidated)
  },
  calibration: {
    distinct_claims: cal.length,
    distinct_drafts: new Set(cal.map((x) => x.draft)).size,
    inflated: cal.filter((x) => x.tierDelta > 0).length,
    deflated: cal.filter((x) => x.tierDelta < 0).length,
    mean_tier_delta: cal.length ? Number((cal.reduce((s, x) => s + x.tierDelta, 0) / cal.length).toFixed(3)) : null,
    rows: cal
  },
  verdict_paths: { covered: covered, of: ALL_PATHS.length, byPath: Object.fromEntries(paths) },
  confusion: Object.fromEntries(matrix)
};
writeFileSync(join(HERE, 'last-run.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log('\nMachine-readable summary: qa/benchmark/last-run.json');

process.exit(failures ? 1 : 0);
