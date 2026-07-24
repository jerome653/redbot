# AGTC — the Argus Ground Truth Corpus

**The permanent dataset every future version of Argus is evaluated against.**

Not a benchmark. Not a regression suite. Those consume this. The corpus is the record of what
is **true** about a set of technical drafts, established independently of the system being
tested — so that a change to Argus can be judged by whether it agrees with reality, rather than
by whether it agrees with the last version of itself.

```
node ground-truth/build-corpus.mjs     # assemble cases (one-shot, skips existing)
node ground-truth/validate.mjs --fix   # validate + compute promotion status
node qa/benchmark/run.mjs              # replay everything, score only what the corpus approved
```

---

## Why it exists

Two certifications produced two different stories. HRC-001 assigned authoritative provenance to
**5 of 5** falsifiable claims, which disabled the rule meant to catch weakly-evidenced claims and
looked like a systematic bias. Certification #2 assigned it to **1 of 4**, and the rule fired
normally.

With n=2 and one of them unlabelled, neither story can be tested. Every further improvement to
Argus risks being fitted to a single anecdote — and a system tuned against its own outputs is
measuring itself.

## Two project-wide principles this corpus shares

> **Ground truth never originates from a language model.**
>
> **Never invent an aggregate before collecting its raw observations.**

The second is why the corpus stores per-claim labels rather than a per-case quality score, and
why [`OBSERVATION-SCHEMA.md`](OBSERVATION-SCHEMA.md) stores rendered comment text rather than a
"helpful contribution rate". An aggregate computed from stored rows can be recomputed when its
definition changes; an aggregate stored directly cannot — and every definition in this project is
going to change at least once, because none has been tested against real data.

The first is the one that protects the corpus from itself.

Sources must be official documentation, a specification, an RFC, vendor documentation, source
code, reproducible runtime behaviour, a primary observation, or qualified human review. The
validator rejects any source that names a model.

This is not pedantry. The pipeline that produced HRC-001 was fluent, specific, correctly hedged
and wrong. A model authoring its own answer key reproduces that failure one level up, where
nothing is left to catch it.

## What a case contains

Three kinds of field, kept strictly apart:

| | Origin | Examples |
|---|---|---|
| **Machine** | copied verbatim from `data/` | the draft, the thread, extracted claims, contradictions, the verdict Argus reached |
| **Human** | authored by a person, from external sources | the verdict, per-claim truth labels, expected provenance, cited sources |
| **Derived** | computed by `validate.mjs` | promotion status |

Full field list in [`ground-truth/schema.json`](ground-truth/schema.json); skeleton in
[`ground-truth/templates/case-template.json`](ground-truth/templates/case-template.json).

One field deserves note: **`refutation_ran`**. `certifications.jsonl` does not persist which
refutation calls completed, so a case cannot be faithfully replayed from the record alone — a
refutation that timed out and one that completed and found nothing are indistinguishable
afterwards, and they produce different verdicts. Each case records the list from its run output.
Measured on HRC-001: c2 and c3 timed out at 180s (E-26), so 10 of 12 completed.

## How a case graduates

```
Collected  →  Certified  →  Human review  →  Ground truth  →  Benchmark  →  Regression suite
```

No shortcuts. In particular a case cannot skip **Human review**: an unreviewed case may enter
the corpus, but it enters as `unlabelled` and stays regression-only.

| Stage | Produces | Gate to the next stage |
|---|---|---|
| **Collected** | a thread in `data/threads.json` | a draft exists |
| **Certified** | a record in `certifications.jsonl` | `redbot certify <draftId>` completed |
| **Human review** | a verdict + cited sources | a person read it and ruled |
| **Ground truth** | `status.ground_truth: approved` | validator passes the promotion rules |
| **Benchmark** | a replay case | corpus status is read at run time |
| **Regression suite** | a permanent guard | the case is frozen |

## Promotion rules

Two gates, because two different things are being claimed.

| Gate | Requires | Unlocks |
|---|---|---|
| **`ground_truth: approved`** | a human verdict (`correct` / `incorrect` / `partially-correct`), a named reviewer and date, at least one cited non-model source, and zero structural errors | the confusion matrix, verdict-path coverage, accuracy |
| **`calibration: approved`** | all of the above **and** every extracted claim individually adjudicated, each with an expected provenance | the provenance calibration table |

Anything short of a gate is `pending`, and `blocked_by` names precisely what is missing.

> **Deviation from the original specification, stated so it can be overruled.** The spec
> described a single "Ground Truth Approved" gate covering the confusion matrix and calibration
> together. Applied literally, HRC-001 — the canonical case, with a recorded human verdict and
> three cited sources — would be Pending, because only 3 of its 12 claims have been individually
> ruled on. The corpus would report its best-evidenced case as unevidenced. Splitting the gate
> says what is actually known: the verdict is reviewed, the per-claim provenance mostly is not.
> Collapse the two if you disagree; it is one condition in `validate.mjs`.

## Current state — 2026-07-23

| Case | Human verdict | Claims reviewed | Sources | Ground truth | Calibration | Benchmark role |
|---|---|---|---|---|---|---|
| **HRC-001** | `incorrect` (jerome) | 3 of 12 | 3 | **approved** | pending | scoring |
| **CERT-002** | `unlabelled` | 0 of 19 | 0 | pending | pending | regression-only |

**1 of 2 ground-truth approved. 0 of 2 calibration-approved.**

That second figure is the corpus's first real finding. The provenance calibration reported in
earlier sessions — *"0 of 3 correct, 3 of 3 inflated, mean tier delta +1.00"* — comes from a case
that adjudicates 3 of its 12 claims. It is now excluded from calibration until the remaining nine
are reviewed. The benchmark says so out loud rather than continuing to print the number.

## Benchmark integration

The benchmark **replays everything and scores only what the corpus approved**:

- a case whose draft is not `ground_truth: approved` is exercised for regression and contributes
  nothing to the confusion matrix, verdict paths, or refutation metrics;
- a case whose draft is not `calibration: approved` is excluded from the calibration table, with
  the reason printed;
- the corpus **overrides** any inline ground truth a benchmark case carries.

The order matters: replay first, score second. A pending case still guards against regression,
which is most of a benchmark's day-to-day value.

## Migration plan

The benchmark predates the corpus and carries its own inline `ground_truth` blocks.

1. **Done** — the corpus is authoritative at run time. `qa/benchmark/run.mjs` reads
   `ground-truth/cases/*/case.json` and gates scoring on it. Inline ground truth is now a
   fallback for cases with no corpus entry.
2. **Next, when a third draft is certified** — build its corpus case first, and create the
   benchmark case from it rather than alongside it.
3. **Once every benchmark case has a corpus entry** — delete the inline `ground_truth` blocks
   from `qa/benchmark/cases/*.json`, leaving them holding only recorded Argus output plus
   `expected`. One answer key, one place.

Not done yet, deliberately: step 3 removes a working fallback for no measured benefit while
there are two cases.

## Adding a case

1. `redbot certify <draftId>` — a real run, no synthetic input.
2. Add a block to `ground-truth/build-corpus.mjs`: the machine half is pulled automatically; you
   author `human_review`, `sources`, `claim_labels`, `expected` and `refutation_ran`.
3. `node ground-truth/build-corpus.mjs` — writes only cases that do not exist.
4. `node ground-truth/validate.mjs --fix` — computes and records promotion status.
5. `node qa/benchmark/run.mjs` — if a new case fails, that is a finding about Argus, not a bug
   in the case.

**Author the ground truth before looking at Argus's verdict where you can.** Reading the verdict
first primes you to check whether it *sounds* right rather than whether it *is* right — the same
reason the Argus review package shows the draft last.

## What the corpus still cannot capture

- **Whether a reply helps a real person.** Correctness is not usefulness, and no document
  settles it. Only the thread does.
- **Extraction quality.** Scoring precision and recall needs a human-authored decomposition of
  what *should* have been extracted. No case has one; `expected_claims` is `null` in both, rather
  than filled with a guess.
- **Refutation's miss rate.** A refutation that completes and finds nothing is indistinguishable
  from one that had nothing to find. Measuring it needs a false claim that survives refutation —
  by definition, one nobody has caught yet.
- **Anything about outcomes.** 0 replies published, 0 operator decisions, 1 observation.
