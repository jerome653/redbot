/**
 * ONE-SHOT provenance tooling — generates benchmark cases from real certification records.
 *
 * Run once. The emitted case files are FROZEN ARTIFACTS from that point: hand-edit them, never
 * regenerate. A benchmark case whose expected values move when the pipeline moves measures
 * nothing.
 *
 * Why generate rather than hand-write: the `argus` block of each case is 12 claims, 32
 * contradictions and an 8-edge dependency graph, copied from `data/certifications.jsonl`.
 * Transcribing that by hand would introduce errors into the one artifact whose accuracy the
 * whole benchmark depends on.
 *
 * The `ground_truth` and `expected` blocks are NOT generated — they are authored below, by a
 * person, from external sources. That separation is the point: the machine supplies what the
 * machine did; a human supplies what is true.
 *
 * Run:  node qa/benchmark/make-cases.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CASES = join(HERE, 'cases');

const records = readFileSync(join(ROOT, 'data', 'certifications.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// The richest record for the draft — the --override run that reached claim extraction.
const rec = records
  .filter((r) => r.draftId === 'd_f11d8de68709_mrwj1koh')
  .sort((a, b) => (b.claims ?? []).length - (a.claims ?? []).length)[0];

if (!rec || !rec.claims?.length) {
  console.error('No claim-bearing certification record found. Nothing to generate.');
  process.exit(1);
}

const argus = {
  source_record: 'data/certifications.jsonl',
  certified_at: rec.certifiedAt,
  model: rec.model,
  claims: rec.claims,
  contradictions: rec.contradictions,
  epistemic: rec.epistemic,
  resolution: rec.resolution,
  recorded_verdict: rec.verdict,
  recorded_invalidated: (rec.invalidated ?? []).length
};

/* ------------------------------------------------------------------ *
 * HUMAN-AUTHORED GROUND TRUTH — not generated, not model-derived.
 *
 * Each entry cites where the truth comes from. Where the source was established by an earlier
 * investigation rather than re-checked today, that is stated, because "verified via search on
 * 2026-07-23" and "read in the MySQL manual today" are different strengths of evidence.
 * ------------------------------------------------------------------ */
const GROUND_TRUTH = {
  human_verdict: 'incorrect',
  verdict_author: 'jerome',
  verdict_date: '2026-07-23',
  verdict_record: 'reports/HRC-001-custom-css-updraft.md',

  sources: [
    {
      claim: 'Exceeding max_allowed_packet raises ERROR 1153 (08S01) and aborts the import; it does not silently insert an empty or truncated row',
      source: 'MySQL server error reference — ER_NET_PACKET_TOO_LARGE',
      source_type: 'primary-documentation',
      verification: 'established 2026-07-23 via independent web sources during HRC-001 certification; recorded as E-21. NOT re-read from the vendor manual today.'
    },
    {
      claim: 'wp_options.option_value is LONGTEXT, so column-width truncation cannot explain a blanked Custom CSS value',
      source: 'WordPress database schema',
      source_type: 'vendor-documentation',
      verification: 'established 2026-07-23, recorded as E-21.'
    },
    {
      claim: 'The thread was already resolved — the post body carries "UPDATE: ... it found all the CSS" and the original poster confirmed a fix beneath two comments',
      source: 'the thread itself, captured in data/threads.json',
      source_type: 'primary-observation',
      verification: 'deterministic string match, reproducible offline; recorded as E-22/E-23.'
    }
  ],

  /** Claims independently false on external evidence. */
  false_claims: ['c5', 'c6', 'c6b', 'c7', 'c8'],
  /** Claims not independently false, but resting on a false premise. */
  dependent_on_false: ['c9', 'c10', 'c11'],
  /** Claims with no evidence against them in this record. */
  unrefuted_claims: ['c1', 'c2', 'c3', 'c4'],

  /**
   * Provenance the model SHOULD have assigned. Where this disagrees with what it did assign,
   * the difference is the measurement — this is E-25/E-39 encoded as scoreable data.
   */
  expected_provenance: {
    c5: 'reasoned-inference',
    c6: 'reasoned-inference',
    c7: 'reasoned-inference'
  },

  /** Claims whose stated language outruns their evidence. */
  expected_epistemic: ['c9']
};

const COMMON = {
  thread_id: rec.threadId,
  draft_id: rec.draftId,
  question: 'Custom CSS missing after an UpdraftPlus restore — r/Wordpress',
  ground_truth: GROUND_TRUTH,
  argus
};

/* ------------------------------------------------------------------ *
 * The cases. Each isolates a failure class where the data allows it.
 * ------------------------------------------------------------------ */
const cases = [
  {
    id: 'HRC-001',
    title: 'Already-solved thread, plus a false technical claim',
    failure_class: 'already-solved-thread',
    secondary_failure_class: 'false-technical-claim',
    provenance: 'recorded-run',
    notes:
      'The full real certification, no override. Both failure classes are live at once. This is ' +
      'the case that guards "reject for the correct REASONS" — a future Argus that rejects it ' +
      'without firing thread-resolved has regressed even though the verdict is unchanged.',
    input: { human_override: false, refutation_ran: 'infer' },
    expected: {
      verdict_in: ['REJECT'],
      rules_required: ['thread-resolved', 'fatal-contradiction'],
      rules_forbidden: []
    },
    ...COMMON
  },
  {
    id: 'HRC-001-A',
    title: 'False technical claim, isolated by overriding the resolution block',
    failure_class: 'false-technical-claim',
    provenance: 'recorded-run',
    notes:
      'Resolution suppressed so the claim layer is what is under test. This is the case that ' +
      'proves refutation catches the max_allowed_packet falsehood.',
    input: { human_override: true, refutation_ran: 'infer' },
    expected: {
      verdict_in: ['REJECT'],
      rules_required: ['fatal-contradiction'],
      rules_forbidden: ['all-claims-supported']
    },
    ...COMMON
  },
  {
    id: 'HRC-001-B',
    title: 'The same false draft, with the refutation pass contributing nothing',
    failure_class: 'false-technical-claim-refutation-unavailable',
    provenance: 'derived-perturbation',
    notes:
      'DERIVED, not recorded: contradictions removed and every claim marked as successfully ' +
      'refuted, so Rule 8 cannot fire. Epistemic issues are RETAINED, because Phase 8 compares ' +
      'claim language against provenance and never consults contradictions. ' +
      'This encodes E-40 as a permanent guard: whatever else changes, this draft must never ' +
      'certify. Justified by E-26 — refutation already timed out on 2 of 12 claims in the real run.',
    input: { human_override: true, refutation_ran: 'all', drop_contradictions: true },
    expected: {
      verdict_in: ['REJECT', 'ESCALATE'],
      verdict_observed_2026_07_23: 'ESCALATE',
      rules_required: [],
      rules_forbidden: ['all-claims-supported'],
      note: 'REJECT would be an improvement over the observed ESCALATE, so both pass. CERTIFIED is the regression.'
    },
    ...COMMON
  }
];

/* ------------------------------------------------------------------ *
 * Certification #2 — d_c9bd9366f6b9_mrwiupf2, "Google not indexing website"
 *
 * The first certification on an UNRESOLVED thread, so the first to exercise the claim path
 * without --override. 19 claims, 21 contradictions (8 fatal), 9 epistemic issues, 6 invalidated.
 *
 * ⚠ GROUND TRUTH IS DELIBERATELY ABSENT. No human has reviewed this draft. `human_verdict` is
 * `unlabelled`, and the case is `regression-only`: it asserts that Argus keeps producing the
 * SAME verdict for the SAME reasons, and asserts nothing about whether that verdict is right.
 * Fabricating an answer key from the model's own contradictions would make the pipeline its own
 * examiner — the HRC-001 failure one level up.
 *
 * Consequences of being unlabelled, both automatic:
 *   - excluded from verdict-path coverage (no appropriate verdict can be derived)
 *   - excluded from provenance calibration (no expected class to compare against)
 *
 * `refutation_ran` is listed explicitly rather than inferred. Measured this session: inferring
 * it from the attacked set fires Rule 8 on c13, which the production run did not, because c13's
 * refutation completed and returned nothing. The list below is the 9 claims the run reported
 * sending to refutation.
 * ------------------------------------------------------------------ */
const rec2 = records
  .filter((r) => r.draftId === 'd_c9bd9366f6b9_mrwiupf2')
  .sort((a, b) => (b.claims ?? []).length - (a.claims ?? []).length)[0];

if (rec2?.claims?.length) {
  cases.push({
    id: 'CERT-002',
    title: 'Google not indexing website — unresolved thread, full claim path',
    failure_class: 'unlabelled-regression-baseline',
    provenance: 'recorded-run',
    case_type: 'regression-only',
    notes:
      'First certification on an unresolved thread and the first production run in which Phase 6 ' +
      'dependency propagation fired (6 invalidated). Correctness UNKNOWN — no human review exists. ' +
      'This case detects change, not error.',
    thread_id: rec2.threadId,
    draft_id: rec2.draftId,
    question: 'Google not indexing website — r/Wordpress',
    ground_truth: {
      human_verdict: 'unlabelled',
      verdict_author: null,
      verdict_date: null,
      note:
        'No human has reviewed this draft. Until one does, this case cannot contribute to ' +
        'verdict-path coverage, calibration, or any claim about whether Argus was right.',
      sources: [],
      false_claims: [],
      dependent_on_false: [],
      unrefuted_claims: [],
      expected_provenance: {},
      expected_epistemic: []
    },
    argus: {
      source_record: 'data/certifications.jsonl',
      certified_at: rec2.certifiedAt,
      model: rec2.model,
      claims: rec2.claims,
      contradictions: rec2.contradictions,
      epistemic: rec2.epistemic,
      resolution: rec2.resolution,
      recorded_verdict: rec2.verdict,
      recorded_invalidated: (rec2.invalidated ?? []).length
    },
    input: {
      human_override: false,
      refutation_ran: ['c5', 'c6', 'c9', 'c10', 'c12', 'c13', 'c14', 'c15', 'c16']
    },
    expected: {
      verdict_in: ['REJECT'],
      rules_required: [
        'fatal-contradiction', 'no-provenance', 'overconfident-language',
        'invalidated-dependency', 'falsifiable-claim-weak-evidence', 'low-confidence-as-fact'
      ],
      rules_forbidden: ['all-claims-supported', 'thread-resolved', 'unrefuted-falsifiable-claim']
    }
  });
}

if (!existsSync(CASES)) mkdirSync(CASES, { recursive: true });

for (const c of cases) {
  const path = join(CASES, `${c.id}.json`);
  if (existsSync(path)) {
    console.log(`SKIP  ${c.id} — already exists. Cases are frozen; hand-edit, do not regenerate.`);
    continue;
  }
  writeFileSync(path, JSON.stringify(c, null, 2) + '\n', 'utf8');
  console.log(`WROTE ${c.id}  (${c.failure_class})`);
}

console.log(`\n${cases.length} case(s) considered. Source record: ${rec.certifiedAt}, ${rec.claims.length} claims.`);
