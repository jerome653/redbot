/**
 * AGTC — one-shot corpus assembler.
 *
 * Assembles `cases/<ID>/case.json` from three sources, kept strictly apart:
 *
 *   MACHINE  data/drafts.json, data/threads.json, data/certifications.jsonl
 *            -> what the pipeline DID. Copied verbatim. Never hand-edited.
 *   HUMAN    the GROUND_TRUTH blocks below
 *            -> what is TRUE. Authored by a person, from external sources.
 *   DERIVED  status, computed by validate.mjs from the promotion rules
 *
 * Run once per case. Existing case files are SKIPPED — a corpus case is a frozen artifact.
 * Hand-edit it thereafter, or the answer key moves whenever the pipeline moves.
 *
 * Run:  node ground-truth/build-corpus.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CASES = join(HERE, 'cases');

const drafts = JSON.parse(readFileSync(join(ROOT, 'data', 'drafts.json'), 'utf8'));
const threads = JSON.parse(readFileSync(join(ROOT, 'data', 'threads.json'), 'utf8'));
const certs = readFileSync(join(ROOT, 'data', 'certifications.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

/* ------------------------------------------------------------------ *
 * HUMAN-AUTHORED. Everything below this line is a person's judgement.
 * ------------------------------------------------------------------ */

const SPEC = [
  {
    id: 'HRC-001',
    draft_id: 'd_f11d8de68709_mrwj1koh',
    notes:
      'The canonical reference case. A fluent, specific, correctly hedged, brand-safe, lint-clean, ' +
      'genuinely novel draft whose central technical claim is false, on a thread that was already ' +
      'solved. Every automated gate passed it. This is the template every future case follows.',

    human_review: {
      verdict: 'incorrect',
      reviewer: 'jerome',
      reviewed_at: '2026-07-23',
      notes:
        'Two independent grounds. (1) The central mechanism is false: MySQL raises ERROR 1153 ' +
        '(08S01) and aborts the import rather than silently inserting an empty or truncated row, ' +
        'and wp_options.option_value is LONGTEXT so column truncation cannot explain it either. ' +
        '(2) The thread was already resolved — the post body carries "UPDATE: ... it found all the ' +
        'CSS" and the original poster confirmed a fix beneath two comments. Full review at ' +
        'reports/HRC-001-custom-css-updraft.md.'
    },

    sources: [
      {
        assertion: 'Exceeding max_allowed_packet raises ERROR 1153 (08S01) and aborts the import; it does not silently insert an empty or truncated row',
        source: 'MySQL server error reference — ER_NET_PACKET_TOO_LARGE',
        source_type: 'official-documentation',
        url: null,
        verification: 'Established 2026-07-23 from independent sources during HRC-001 certification; recorded as E-21. NOT re-read from the vendor manual since. Downgrade to vendor-documentation if a direct citation is not attached before this case is used for a published claim.'
      },
      {
        assertion: 'wp_options.option_value is LONGTEXT, so column-width truncation cannot explain a blanked Custom CSS value',
        source: 'WordPress database schema',
        source_type: 'vendor-documentation',
        url: null,
        verification: 'Established 2026-07-23, recorded as E-21.'
      },
      {
        assertion: 'The thread was already resolved by the asker before the draft was written',
        source: 'the thread itself, stored in data/threads.json',
        source_type: 'primary-observation',
        url: null,
        verification: 'Deterministic string match over the post body and comment authors, reproducible offline with zero model calls. Recorded as E-22/E-23.'
      }
    ],

    /**
     * Only the three claims a human actually adjudicated. c1, c2, c3, c4, c6b, c8, c9, c10, c11
     * are NOT listed, because nobody has ruled on them — and an unreviewed claim must never be
     * recorded as an approved one. That gap is why this case is calibration:pending.
     */
    claim_labels: [
      {
        claim_id: 'c5',
        truth: 'false',
        expected_provenance: 'reasoned-inference',
        expected_epistemic: 'explicitly-uncertain',
        rests_on: [],
        note: 'Silent truncation of large single-row values on import is not the documented behaviour.'
      },
      {
        claim_id: 'c6',
        truth: 'false',
        expected_provenance: 'reasoned-inference',
        expected_epistemic: 'explicitly-uncertain',
        rests_on: [],
        note: 'max_allowed_packet produces an abort, not a truncation.'
      },
      {
        claim_id: 'c7',
        truth: 'false',
        expected_provenance: 'reasoned-inference',
        expected_epistemic: 'explicitly-uncertain',
        rests_on: [],
        note: 'THE central false claim. "The row is inserted as empty or truncated without raising an error" — MySQL raises ERROR 1153 and aborts.'
      }
    ],

    expected_claims: null,

    expected: {
      verdict: ['REJECT'],
      appropriate: 'REJECT',
      rules_required: ['thread-resolved', 'fatal-contradiction'],
      rules_forbidden: ['all-claims-supported']
    },

    /**
     * MEASURED, not inferred. trace.jsonl records `argus.contradiction.failed` for c2 and c3,
     * both "claude CLI timed out after 180000 ms" (E-26). Every other claim's refutation call
     * completed — including ones that completed and found nothing. certifications.jsonl does not
     * persist this (EB-40), so it is recorded here or the case cannot replay faithfully.
     */
    refutation_ran: ['c1', 'c4', 'c5', 'c6', 'c6b', 'c7', 'c8', 'c9', 'c10', 'c11']
  },

  {
    id: 'CERT-002',
    draft_id: 'd_c9bd9366f6b9_mrwiupf2',
    notes:
      'First certification on an unresolved thread, and the first production run in which Phase 6 ' +
      'dependency propagation fired. AWAITING HUMAN REVIEW — every ground-truth field is ' +
      'deliberately empty. Regression-only until a person rules on it.',

    human_review: {
      verdict: 'unlabelled',
      reviewer: null,
      reviewed_at: null,
      notes:
        'No human has reviewed this draft. Argus returned REJECT with 8 fatal contradictions ' +
        'citing primary-documentation and official-implementation, but those citations are model ' +
        'output and are unverified. Whether the verdict is CORRECT is unknown, and recording a ' +
        'guess here would make the pipeline its own examiner.'
    },

    sources: [],
    claim_labels: [],
    expected_claims: null,

    expected: {
      verdict: ['REJECT'],
      appropriate: null,
      rules_required: [
        'fatal-contradiction', 'no-provenance', 'overconfident-language',
        'invalidated-dependency', 'falsifiable-claim-weak-evidence', 'low-confidence-as-fact'
      ],
      rules_forbidden: ['all-claims-supported', 'thread-resolved', 'unrefuted-falsifiable-claim']
    },

    /** All 9 claims sent to refutation completed; trace.jsonl records no failure for this run. */
    refutation_ran: ['c5', 'c6', 'c9', 'c10', 'c12', 'c13', 'c14', 'c15', 'c16']
  }
];

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

let written = 0;
for (const s of SPEC) {
  const dir = join(CASES, s.id);
  const file = join(dir, 'case.json');
  if (existsSync(file)) {
    console.log(`SKIP  ${s.id} — frozen. Hand-edit, do not regenerate.`);
    continue;
  }

  const draft = drafts.find((d) => d.id === s.draft_id);
  if (!draft) { console.error(`FAIL  ${s.id} — draft ${s.draft_id} not found`); continue; }
  const thread = threads.find((t) => t.id === draft.threadId);
  if (!thread) { console.error(`FAIL  ${s.id} — thread ${draft.threadId} not found`); continue; }

  const cert = certs
    .filter((c) => c.draftId === s.draft_id)
    .sort((a, b) => (b.claims ?? []).length - (a.claims ?? []).length)[0];
  if (!cert) { console.error(`FAIL  ${s.id} — no certification on record`); continue; }

  const c = {
    id: s.id,
    schema_version: '1.0',
    draft_id: s.draft_id,
    notes: s.notes,

    thread: {
      thread_id: thread.id,
      subreddit: thread.subreddit,
      permalink: thread.permalink,
      title: thread.title,
      body: thread.body,
      comment_count: thread.comments.length,
      resolved: Boolean(cert.resolution?.resolved)
    },

    draft: {
      body: draft.body,
      created_at: draft.createdAt,
      model: draft.model,
      contribution: draft.contribution ?? null
    },

    human_review: s.human_review,

    ground_truth: {
      sources: s.sources,
      claims_reviewed: s.claim_labels.length,
      claim_labels: s.claim_labels,
      expected_claims: s.expected_claims
    },

    expected: s.expected,

    argus_observed: {
      certified_at: cert.certifiedAt,
      model: cert.model,
      verdict: cert.verdict,
      claims: cert.claims,
      contradictions: cert.contradictions,
      epistemic: cert.epistemic,
      resolution: cert.resolution,
      invalidated: cert.invalidated ?? [],
      refutation_ran: s.refutation_ran
    },

    // Recomputed by validate.mjs. Written pessimistically so an unvalidated case never
    // presents itself as approved.
    status: {
      ground_truth: 'pending',
      calibration: 'pending',
      benchmark: 'regression-only',
      blocked_by: ['not yet validated — run node ground-truth/validate.mjs']
    }
  };

  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(c, null, 2) + '\n', 'utf8');
  console.log(`WROTE ${s.id}  ${cert.claims.length} claims · ${s.claim_labels.length} reviewed · human verdict "${s.human_review.verdict}"`);
  written++;
}

console.log(`\n${written} case(s) written, ${SPEC.length - written} skipped. Next: node ground-truth/validate.mjs`);
