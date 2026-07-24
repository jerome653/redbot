# The Argus benchmark

**The project's primary quality artifact.** It replaces the claim *"Argus passes 175 tests"* —
which measures whether the code does what its author expected — with a claim about whether Argus
reaches the right verdict, for the right reasons, on representative cases with known answers.

Unit tests grow with the codebase. This grows with the **evidence**.

```
node qa/benchmark/run.mjs [--verbose]
```

Exit 0 if every case passes. No model calls, no network, no credentials, no clock dependence.

---

## What a PASS means

Not "the verdict was right." **"The verdict was right for the required reasons."**

Every case declares `rules_required`. A case that reaches REJECT without firing them is reported
as a FAIL even though the verdict is unchanged, because the next change to Argus would then be
free to break the rule that was actually doing the work.

This is the discipline HRC-001 taught, generalised: a correct output produced by the wrong
mechanism is not a correct system.

## HRC-001 is not "the bad draft" any more

It is **Benchmark Case #1**. The goal is no longer *don't publish it*. The goal is: every future
change to Argus must continue to reject it, for the correct reasons, forever.

## Two modes

| Mode | What it does | Needs | Status |
|---|---|---|---|
| **replay** | Feeds each case's recorded Argus output through the deterministic verdict layer and scores it against ground truth | nothing | **built** |
| **live** | Re-runs `candidate_reply` through extraction → provenance → refutation to regenerate the `argus` block, then scores | operator Claude credentials | **not built** |

Replay is not a lesser mode. Because a case records *what the model produced*, extraction,
provenance, refutation and propagation are all scoreable offline — the recorded output is the
thing being graded. Live mode matters only for detecting drift when the model or prompts change.

Live mode is deliberately absent rather than written untested.

## Case schema

Cases are JSON (not YAML) to keep the project's zero-runtime-dependency property. The shape is
what matters; say the word and it converts.

```
id                     HRC-001
title, notes           human-readable
failure_class          one of the registry below
provenance             recorded-run | derived-perturbation
question               what was asked
thread_id, draft_id    traceability to data/

ground_truth           AUTHORED BY A HUMAN — never model-derived
  human_verdict        correct | incorrect | partially-correct
  verdict_author/date  who decided, when
  sources[]            claim + source + source_type + verification
                       (verification states whether it was checked today or inherited)
  false_claims[]       independently false on external evidence
  dependent_on_false[] not false themselves, but resting on a false premise
  unrefuted_claims[]   nothing found against them
  expected_provenance  what the evidence class SHOULD have been, per claim
  expected_epistemic[] claims whose language outruns their evidence

argus                  GENERATED — copied verbatim from data/certifications.jsonl
  claims, contradictions, epistemic, resolution, recorded_verdict

input                  how to drive certify(): human_override, refutation_ran, drop_contradictions
expected
  verdict_in[]         allowed verdicts
  rules_required[]     must ALL fire
  rules_forbidden[]    must NOT fire
```

**The separation is the point: the machine supplies what the machine did; a human supplies what
is true.** `make-cases.mjs` generates the `argus` block so 12 claims and 32 contradictions are
not transcribed by hand; it never generates `ground_truth`.

Cases are **frozen** once written. `make-cases.mjs` skips any case that already exists. A case
whose expected values move when the pipeline moves measures nothing.

## Failure-class registry

| Class | Covered | Case |
|---|---|---|
| false technical claim | **yes** | HRC-001-A |
| already-solved thread | **yes** | HRC-001 |
| false claim with refutation unavailable | **yes** | HRC-001-B |
| **correct answer wrongly rejected** (false positive) | no | — |
| true answer with weak evidence | no | — |
| speculative recommendation presented as fact | no | — |
| outdated advice | no | — |
| incorrect official citation | no | — |
| hallucinated API behaviour | no | — |
| upstream false, downstream clean (propagation) | no | — |

**3 of 10 classes, all from one draft.** The most important gap is the false-positive class:
Argus has never been shown to certify something it should certify, so the benchmark cannot yet
distinguish "strict" from "broken". Propagation is a close second — ARE-001 proved it fires, but
no *case* guards it.

## The milestone is not "10 cases"

It is: **at least one confirmed example of every verdict path.**

```
correct-CERTIFIED   correct-ESCALATE   correct-REJECT
false-CERTIFIED     false-ESCALATE     false-REJECT
```

Currently **2 of 6**. The appropriate verdict is *derived* from the human verdict
(`incorrect → REJECT`, `correct → CERTIFIED`, `partially-correct → ESCALATE`) so frozen cases
need no edit as the taxonomy grows.

Until `correct-CERTIFIED` exists, no statement about Argus's behaviour is meaningful: everything
it has ever seen, it rejected. Strictness and brokenness look identical from here.

## Passing is not the same as being right

**HRC-001-B PASSES the regression suite and is simultaneously a `false-ESCALATE`.** Its
`verdict_in` accepts ESCALATE because that is not a *regression* against the observed baseline —
but ground truth says the draft is incorrect, so the appropriate verdict is REJECT.

Both readings are correct and they are kept separate on purpose. The suite answers *"did Argus
get worse?"*; the path taxonomy answers *"is Argus right?"*. Collapsing them would hide exactly
the gap E-40 identified.

## The corpus decides what counts

Since 2026-07-23 the benchmark is **downstream of the Argus Ground Truth Corpus**
([`../../AGTC.md`](../../AGTC.md)). It **replays everything and scores only what the corpus has
approved**:

- draft not `ground_truth: approved` → replayed for regression, excluded from the confusion
  matrix, verdict paths and refutation metrics;
- draft not `calibration: approved` → excluded from the calibration table, with the reason
  printed;
- the corpus **overrides** any inline `ground_truth` a case file carries.

The immediate effect is that the calibration table is now **empty**, and that is correct. It was
reporting *"0 of 3 correct, 3 of 3 inflated"* from HRC-001 — a case that adjudicates 3 of its 12
claims, which is below the corpus's bar for calibration. The number was real but the sample was
not qualified, and the corpus says so instead of continuing to print it.

## Current results — 2026-07-23

```
4/4 passed              4 cases from 2 drafts, 1 unlabelled
verdict paths           2/6 covered — no correct-CERTIFIED
provenance calibration  EXCLUDED — 0 of 2 corpus cases are calibration-approved
refutation              TP 10  FN 5  FP 0   [per labelled scenario, 3 of 4 scored]
epistemic               3/3
propagation             6 invalidated (first production firing, CERT-002)
```

**Denominators differ on purpose.** Provenance is a property of the *draft* — the three cases
share one, so reporting `0/9` would present one draft as a sample of nine. Refutation is a
property of the *scenario*, and HRC-001-B genuinely runs with no contradictions. The runner
labels which is which on every line.

### Calibration is the result to watch

| claim | type | expected | assigned | dir |
|---|---|---|---|---|
| c5 | protocol-behaviour | reasoned-inference | observed-runtime-behaviour | **+1** |
| c6 | platform-behaviour | reasoned-inference | primary-documentation | **+1** |
| c7 | protocol-behaviour | reasoned-inference | official-implementation | **+1** |

**3 of 3 inflated, 0 deflated.** The error has a *direction*, not just a magnitude — the model
never under-claims. That is a different and more serious finding than "provenance is
inaccurate", because a unidirectional bias defeats Rule 4 systematically rather than randomly.

**It is 3 claims from 1 draft.** One more certified draft doubles the evidence and answers the
open question: is this a property of this draft, or a bias of the extraction stage?

### The three hypotheses this benchmark must separate

1. **Extraction correct, provenance biased** — the claims are right, the classes are inflated.
2. **Extraction wrong** — provenance is attached to claims that were mis-decomposed.
3. **Taxonomy too coarse** — the classes cannot express the distinction that matters.

Only (1) is currently measurable. Separating (2) requires a **human-authored expected claim
list** per case, which no case has: `reports/HRC-001-custom-css-updraft.md` is a prose review,
not a structured decomposition, and inventing one would put a model's judgement into the answer
key. Separating (3) requires cases where the right answer is *unexpressible* in the current
enum — which cannot be recognised until more drafts have been certified.

**Provenance 0/9 is the headline.** Every claim where ground truth declares what the evidence
class should have been got a stronger class than the evidence supports — `observed-runtime-behaviour`,
`primary-documentation` and `official-implementation` for claims that are reasoned inference.
That is E-25/E-39 as a standing measurement rather than an anecdote, and it is why Rule 4
("falsifiable claim on weak evidence → ESCALATE") never fires on this draft.

The **FN 5** in HRC-001-B is the other number worth watching: with refutation contributing
nothing, all five false claims go unchallenged and the draft still only reaches ESCALATE.

## Adding a case

1. Get a real certification into `data/certifications.jsonl` (`redbot certify <draftId>`).
2. Add a block to `make-cases.mjs` describing the case, and author `ground_truth` **from
   external sources**, recording where each came from and whether it was verified now or
   inherited from an earlier investigation.
3. Run `node qa/benchmark/make-cases.mjs` — it writes only cases that do not yet exist.
4. Run the benchmark. If a new case fails, that is a finding, not a bug in the case.

**Ground truth must not come from a language model.** The pipeline that produced HRC-001 was
fluent, specific and wrong; a model authoring its own answer key reproduces exactly that failure
one level up. Anchor to documented error codes, specifications, vendor documentation, or a human
expert — and record the anchor.

## What this does not measure

- **Nothing about real-world outcomes.** No reply has been published.
- **No population rates.** 3 cases from 1 draft. Every number here is a count with its
  denominator shown, deliberately.
- **Nothing about extraction quality** — no case declares an expected claim list, so precision
  and recall are unscored rather than guessed.
