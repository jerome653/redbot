# RQ-02 — How much of the benchmark is independent of the engine it tests?

**Open Research · 2026-07-23 · ENGINE FILES MODIFIED: 0**

**Question:** `benchmark 4/4` is the most-cited gate in this project. How many of its assertions are
derived from human judgement, and how many are copied from what the engine already did?

---

## Hypothesis

*Null:* benchmark expectations encode independent correctness criteria.

## Method

Read `qa/benchmark/make-cases.mjs` and each of the four case files; classified every assertion by the
source of its expected value.

## Finding — quantified for the first time

`make-cases.mjs:27` reads `data/certifications.jsonl` and copies engine output into the cases.
Provenance is self-declared per case:

| Case | provenance | human verdict | `verdict_in` backed by a human? | `rules_required` |
|---|---|---|---|---|
| HRC-001 | `recorded-run` | `incorrect` | **yes** | 2 — recorded |
| HRC-001-A | `recorded-run` | `incorrect` | **yes** | 1 — recorded |
| HRC-001-B | `derived-perturbation` | `incorrect` | **yes** | 0 |
| CERT-002 | `recorded-run` | **`unlabelled`** | **no** | 6 — recorded |

| Assertion class | human-backed | total |
|---|---|---|
| Verdict (`verdict_in`) | **3** | 4 |
| Rules (`rules_required`) | **0** | **9** |

**Every one of the nine rule assertions is copied from what the engine did.** No human ever
determined that `no-provenance` *should* fire on CERT-002 c8 — only that it *did*.

## Interpretation

The benchmark is a **regression** suite: it detects change from a recorded baseline. It is not a
**correctness** suite: it cannot detect that the baseline was wrong.

`benchmark 4/4` means *"the engine behaves as it behaved on 2026-07-22/23"* — a genuinely useful
property under a freeze, and a much weaker one than the phrase suggests.

**CERT-002 is the weakest case**: no human verdict at all, yet it carries 6 of the 9 rule assertions.
Its expectations are entirely self-referential.

## Is this already known?

**Partly.** `qa/benchmark/README.md` uses the word "regression" and line 125 states that HRC-001-B
"PASSES the regression suite and is simultaneously a `false-ESCALATE`" — an explicit acknowledgement
that passing ≠ correct. Line 139 excludes non-approved drafts from the confusion matrix.

**What was not documented is the ratio.** No prior document states that 0 of 9 rule assertions have
human backing, or that CERT-002 contributes two-thirds of them with no human verdict.

## Confidence

**High** for the counts — direct file reads, complete enumeration, n = 4 cases.
**Medium** for the interpretation, since "human-backed verdict" is a coarse proxy: HRC-001's human
verdict is `incorrect`, which supports REJECT but does not independently confirm *which* rules
should fire.

## Assumptions

- `ground_truth.human_verdict !== 'unlabelled'` is taken as human backing for the verdict.
- Rule expectations are treated as unbacked unless a human explicitly ruled on the rule. No case
  contains such a field.

## Threats to validity

- Four cases is the entire population, so there is no sampling error — but also no generalisation
  beyond this suite.
- A rule assertion copied from the engine could still be *correct*. This measures provenance, not
  truth.

## Alternative explanations

- *"Recorded-run provenance is appropriate for a frozen engine."* Reasonable — under a freeze, a
  regression suite is exactly what you want. The finding is not that the design is wrong, but that
  the gate's evidentiary weight has been overstated in reporting, including mine.

## How to prove this wrong

Produce a benchmark case whose `rules_required` was written by a human *before* observing engine
output. None currently exists.

## What this changes

Nothing about the engine. It bounds what `benchmark 4/4` can be cited for: change detection, not
correctness.
