# 13. Calibration Report v1 — 2026-07-23

**What this is:** the first measurement of Argus against human judgement. It uses only judgement
already on record — Jerome's HRC-001 review of 2026-07-23 — and computes nothing that its
denominators do not support.

**What this is not:** a rate. One case is labelled, three of its twelve claims are adjudicated,
and the second case has no labels at all. Every number below carries its denominator.

---

## Corpus state

| Case | Human verdict | Claims extracted | Claims adjudicated | Calibration-approved |
|---|---|---|---|---|
| **HRC-001** | `incorrect` (jerome, 2026-07-23) | 12 | **3** | no — 3 of 12 |
| **CERT-002** | `unlabelled` | 19 | **0** | no |

---

## Computable

### Verdict agreement — 1 of 1

Human verdict `incorrect` → appropriate verdict REJECT. Argus returned **REJECT**. **Agree.**

n = 1. One agreement is not an agreement rate.

### Contradiction agreement — 3 of 3, zero false negatives on the labelled set

| Claim | Human | Argus provenance | Fatal contradiction? |
|---|---|---|---|
| c5 | **false** | `observed-runtime-behaviour` | **YES** |
| c6 | **false** | `primary-documentation` | **YES** |
| c7 | **false** | `official-implementation` | **YES** |

**Every claim a human labelled false received a fatal contradiction. False negatives on the
adjudicated set: 0 of 3.**

This is the first positive measurement of Argus's output quality in the project's history. It is
also three claims from one draft.

### Provenance agreement — 0 of 3

Every adjudicated claim was assigned a class stronger than the human ruled appropriate, and every
one of them was assigned an **authoritative** class. All three claims are false. A false claim
cannot rest on primary documentation.

Direction is uniform: inflation, never deflation. Consistent with E-44.

---

## Not computable, and precisely why

| Measure | Blocked by |
|---|---|
| Extraction precision / recall | No `expected_claims` list has been authored for any case. The denominator does not exist |
| False positives | 9 of 12 HRC-001 claims are unadjudicated — a fatal contradiction on an unlabelled claim cannot be scored right or wrong |
| Contradiction agreement, full | 3 of 12 claims labelled |
| Evidence-class agreement, full | same |
| Any cross-case rate | 1 labelled case; CERT-002 has 0 labels |
| Verdict agreement rate | 1 case. A rate needs a denominator worth quoting |

Per the phase rules, **no precision or recall is computed anywhere in this report.**

---

## Disagreements — exactly one attribution each

| # | Disagreement | Attribution |
|---|---|---|
| 1 | Provenance: Argus assigned authoritative classes to three claims a human ruled false | **Argus was wrong.** A false claim cannot rest on primary documentation; the assignment is unsupportable regardless of taxonomy reading |
| 2 | CERT-002 #4 — cited Manual Actions report does not distinguish deindexing from ranking suppression | **Argus was wrong** — on the citation. The proposition may still be true |
| 3 | CERT-002 #8 — cited site-move guidance says the opposite of the claim | **Argus was wrong** |
| 4 | CERT-002 #20, #21 — cited pages do not contain the claimed statements | **Argus was wrong** — on the citation, in both cases |
| 5 | CERT-002 #7 — quoted only one limb of a two-limb definition, and the omitted limb cuts against its conclusion | **Argus was wrong** |
| 6 | CERT-002 #17 — "Google does not ingest archive.org data as a ranking signal" | **Evidence insufficient.** A negative claim; documentation cannot establish an absence |
| 7 | CERT-002 #6 and #8 attack the same claim with incompatible propositions; only #6 flagged fatal | **Specification is ambiguous.** Nothing in the architecture states that contradictions against one claim must be mutually consistent, so this is not yet a defect against a stated requirement |

---

## Defect candidates

Supported by calibration. **No fixes. No recommendations.**

### DC-01 · Provenance inflation on falsifiable claims

- **Observed** — authoritative evidence classes (`observed-runtime-behaviour`,
  `primary-documentation`, `official-implementation`) assigned to three claims a human ruled false.
- **Expected** — a false claim does not have authoritative documentary support; the class should be
  `reasoned-inference` or weaker.
- **Evidence** — this report, provenance agreement 0 of 3; E-39, E-42, E-44.
- **Affected** — HRC-001 c5, c6, c7. In CERT-002, 1 of 4 falsifiable claims took an authoritative
  class, so the pattern did **not** reproduce there (E-48).
- **Frequency** — 3 of 3 adjudicated claims, in 1 of 2 cases.
- **Confidence** — high for HRC-001; **not established as general**.

### DC-02 · Unfaithful citations in the refutation pass

- **Observed** — 4 of 13 checked Tier-1 citations do not support the proposition they were cited
  for; one states the opposite.
- **Expected** — a cited source supports the cited proposition.
- **Evidence** — E-62, E-63, E-65; scorecard in the CERT-002 worksheet, every result quoted with a URL.
- **Affected** — CERT-002 #4, #8, #20, #21. #4 is one of the 8 fatal contradictions that produced
  the REJECT.
- **Frequency** — 4 of 13 Tier-1 checked; only 3 of 8 fatal contradictions rest on a fully faithful citation.
- **Confidence** — high for this certification; **one draft, one run**.

---

## The tension worth recording

On the only evidence that exists, Argus **caught every claim a human labelled false** — and
roughly a third of its Tier-1 citations do not support what they were cited for, with only 3 of 8
fatal citations fully faithful.

**Right answers, unreliable reasoning.** Both statements are measured, and neither cancels the
other. Whether the verdict was right *because of* the reasoning or *despite* it cannot be
determined from one case, and this report does not guess.

---

## What would move these numbers

Nothing in this report can be improved by engineering. Each line is blocked on a human decision:

1. **Label CERT-002** — 19 claims, worksheet complete with verified sources and the fidelity scorecard.
2. **Adjudicate HRC-001's 9 remaining claims** — converts provenance from 0/3 to 0-or-more/12, and
   makes false positives computable for the first time.
3. **Author an `expected_claims` list for either case** — the only thing that unblocks extraction
   precision and recall.
