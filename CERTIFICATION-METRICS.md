# Certification metrics

**Date:** 2026-07-23 · **Phase 12 — Operational Validation**
**Engine files modified: 0**

Every figure below is measured from files on disk. Where a metric cannot be computed without ground
truth that does not exist, it is reported as **unmeasurable**, not estimated.

---

## 1 · Verdict frequency

| Verdict | Records | Distinct drafts |
|---|---|---|
| CERTIFIED | **0** | 0 |
| ESCALATE | **0** | 0 |
| REJECT | **6** | 4 |

**Source:** `data/certifications.jsonl`. **Two new certifications were produced this phase**, both
REJECT, doubling the distinct-draft sample from 2 to 4.

| Record | Draft | Claims | Contradictions | Fatal | Verdict |
|---|---|---|---|---|---|
| 0 · 1 | `d_f11d8de68709_mrwj1koh` | 0 | 0 | 0 | REJECT |
| 2 | `d_f11d8de68709_mrwj1koh` | 12 | 32 | 16 | REJECT |
| 3 | `d_c9bd9366f6b9_mrwiupf2` | 19 | 21 | 8 | REJECT |
| **4 — Phase 12** | `d_ac82fb88ec9d_mrvwodeo` | 19 | **51** | 7 | **REJECT** |
| **5 — Phase 12** | `d_c14d9d8caa0e_mrw1nf9l` | 7 | 15 | 7 | **REJECT** |

Record 5 was chosen deliberately: at **308 characters** it is by far the shortest draft in the store,
and therefore the best candidate to produce a non-REJECT verdict if one is reachable at all. It was
rejected too.

### Why CERTIFIED has never occurred — a structural observation

A verdict is REJECT if **any single claim** carries a fatal contradiction. Measuring how many claims
per draft attract one:

| Draft | Claims | Claims carrying ≥1 fatal | Rate |
|---|---|---|---|
| `d_f11d8de68709_mrwj1koh` | 12 | 8 | **67 %** |
| `d_c9bd9366f6b9_mrwiupf2` | 19 | 5 | **26 %** |
| `d_ac82fb88ec9d_mrvwodeo` | 19 | 6 | **32 %** |
| `d_c14d9d8caa0e_mrw1nf9l` | 7 | 5 | **71 %** |

**Between a quarter and three-quarters of all claims attract a fatal contradiction, and one is enough
to reject.** For a draft of any substance, CERTIFIED requires *every* claim to survive. At an observed
per-claim fatal rate of 26–71 %, a 19-claim draft clearing all of them is vanishingly unlikely, and a
7-claim draft is not much better.

This explains the 0 % CERTIFIED rate mechanically, without appeal to ground truth. **It does not
establish that the engine is wrong** — those fatal contradictions may well be correct, and §3 shows
that on the only claims a human has checked, they were. But it does mean:

> The observed REJECT rate is not evidence that the drafts are bad. It is equally consistent with a
> fatal-contradiction threshold that almost nothing can pass.

Distinguishing those two requires labelled claims a human believes are **true** — see §8.

**CERTIFIED has never been produced on real input. Neither has ESCALATE.**

ESCALATE *has* been produced in the benchmark — case `HRC-001-B`, a deliberately perturbed variant
where the refutation pass is starved of evidence. So the code path is reachable; it has simply never
been reached by a real draft.

> **This is the single most important open question about the engine.** An engine that has only ever
> said no is not yet distinguishable from an engine that always says no. Until a real draft returns
> CERTIFIED — or until enough real drafts return REJECT *with independently verified justification* —
> the discriminating power of the verdict is unproven.

### Sample size is the limiting factor

n = 2 distinct drafts. Twelve drafts exist; ten are pending; eight have never been certified. The
reason all eight have not been run is measured in §5.

---

## 2 · Refutation recall on the adjudicated set

The only claims with a human ruling are the three adjudicated in HRC-001.

| Claim | Human ruling | Fatal contradiction raised? |
|---|---|---|
| c5 | **false** | yes (1 fatal of 3 contradictions) |
| c6 | **false** | yes (1 fatal of 3) |
| c7 | **false** | yes (1 fatal of 3) |

**Recall = 3/3. Zero false negatives on the adjudicated set.**

Every claim a human ruled false was caught. This is a real positive result and the strongest evidence
the project currently has that the refutation layer does something.

**n = 3.** Three claims from one draft is not a basis for a recall rate. It is a basis for *not yet
suspecting* systematic false negatives.

---

## 3 · Contradiction precision on the adjudicated set

Are the fatal contradictions *correct*, independent of whether they were raised?

| Claim | Argus fatal contradiction | Correct? |
|---|---|---|
| c5 | "MySQL does not silently insert an empty/truncated row when `max_allowed_packet` is exceeded. It raises ERROR 1153 (08S01)…" | **yes** |
| c6 | "Exceeding `max_allowed_packet` does not silently truncate a row — MySQL raises `ER_NET_PACKET_TOO_LARGE` (1153)…" | **yes** |
| c7 | "MySQL/MariaDB does not insert an empty or truncated row — it raises ERROR 1153 (08S01)…" | **yes** |

**Precision = 3/3 on fatal contradictions.**

All three independently reconstruct the same mechanism the human reviewer identified: error 1153,
SQLSTATE 08S01, connection aborted, not silent truncation. Two cite `primary-documentation` (MySQL
Server Error Message Reference); one cites `official-implementation`.

**The engine was right, for the right reason, on the founding failure case.**

---

## 4 · Provenance accuracy — the systematic defect

| Claim | Human expected | Argus declared | Correct? |
|---|---|---|---|
| c5 | `reasoned-inference` | `observed-runtime-behaviour` | ✗ inflated |
| c6 | `reasoned-inference` | `primary-documentation` | ✗ inflated |
| c7 | `reasoned-inference` | `official-implementation` | ✗ inflated |

**Provenance accuracy = 0/3. Every error is in the same direction: inflation.**

The benchmark reports the same shape at larger n: `provenance_correct: 0` against
`provenance_declared: 9`.

### Epistemic accuracy

| Claim | Human expected | Argus recorded |
|---|---|---|
| c5 · c6 · c7 | `explicitly-uncertain` | `confidence: high` |

**0/3.** The draft asserted with high confidence what a human judged should have been hedged, and the
engine recorded the high confidence as declared rather than as a defect at the provenance layer. The
`overconfident-language` rule *did* fire separately, which is how the verdict still landed correctly.

### What this combination means

**The engine reaches the right verdict through a provenance layer that is wrong every time.** It is
right about *whether* to reject and wrong about *why the evidence is what it is*.

That is a specific, actionable finding — and it is exactly the failure mode the benchmark was built
to catch: a case that reaches the right verdict for the wrong reasons. It matters because provenance
is not decoration; `no-provenance` and `falsifiable-claim-weak-evidence` are rules that fire *on* it.

**This is evidence that would justify unfreezing** — under the freeze policy, "a case reaches the
right verdict for the wrong reasons" is one of the two admissible grounds. It is not yet sufficient:
n = 3, from one draft, adjudicated by one person.

---

## 5 · Throughput — measured for the first time

From `data/trace.jsonl`, wall-clock between the first gate event and `argus.verdict`:

| Run | Claims | Extraction | Refutation → verdict | Total |
|---|---|---|---|---|
| `51154847` — Phase 12 | 7 | 64 s | 7.6 min | **8.7 min** |
| `82c9e2ba` | 12 | 113 s | 22.8 min | **24.7 min** |
| `e5a8e166` | 19 | 152 s | 12.4 min | **14.9 min** |
| `de80382f` — Phase 12 | 19 | 92 s | 25.5 min | **27.1 min** |

**Certification takes 9–27 minutes per draft, and duration does not scale with claim count.** The
12-claim run (24.7 min) took *longer* than one 19-claim run (14.9 min) and less than another
(27.1 min). The 7-claim run was fastest at 8.7 min, but 7 → 12 → 19 → 19 claims maps to
8.7 → 24.7 → 14.9 → 27.1 minutes, which is not a trend.

The variance is per-claim model latency, not volume, so **runtime cannot be predicted from the
draft** — which is precisely why a fixed timeout is dangerous (F-3).

### Consequences

- Certifying the eight remaining drafts costs **2–3.5 hours of wall clock**.
- Any wrapper with a 10-minute timeout **kills a valid certification**. This tool's default did
  exactly that on the first attempt.
- Extraction is 1.5–2.5 minutes; **the refutation loop is 85–95% of the total**.

This is the largest operational constraint in the system and it was invisible before this phase,
because nobody had timed it.

---

## 6 · Citation fidelity

Carried forward from the Phase-D measurement (n = 13 Tier-1 contradictions), unchanged this phase:

| Fidelity | Count |
|---|---|
| FULL — cited document supports the statement | 4 |
| PARTIAL — supports part of it | 4 |
| NONE — does not support it | 4 |
| UNVERIFIABLE | 1 |

**Only 3 of 8 fatal contradictions rest on a fully faithful citation.**

Note the tension with §3: on the three adjudicated claims the fatal contradictions were *correct*.
Being correct and citing faithfully are different properties, and the engine currently scores much
better on the first than the second.

---

## 7 · Benchmark stage counters

From `qa/benchmark/last-run.json`, 4 cases, 4 passed:

| Counter | Value | Reading |
|---|---|---|
| `provenance_correct` / `provenance_declared` | **0 / 9** | consistent with §4 — provenance is wrong at every observation |
| `refutation_tp` | 10 | true positives |
| `refutation_fn` | 5 | **false negatives — claims that should have been refuted and were not** |
| `refutation_fp` | 0 | no false positives |
| `epistemic_hit` / `epistemic_expected` | 3 / 3 | epistemic detection matches expectation |
| `propagated` | 6 | invalidation propagated through dependencies |
| confusion | `REJECT\|REJECT: 3`, `ESCALATE\|ESCALATE: 1` | no verdict disagreements |

`refutation_fn: 5` and §2's `3/3 recall` are **not in conflict** — §2 covers only the three claims a
human adjudicated; the benchmark's 5 false negatives are against the full expected-claim spec, most
of which is not human-adjudicated. The honest reading: recall is good on the small verified subset
and unmeasured elsewhere.

---

## 8 · What remains unmeasurable, and why

| Metric | Status | Blocker |
|---|---|---|
| Overall precision | **unmeasurable** | needs per-claim truth labels; 3 of 31 claims across 2 cases are labelled |
| Overall recall | **unmeasurable** | same |
| False-positive rate | **unmeasurable** | needs a claim a human ruled *true* that Argus refuted. **No such labelled claim exists** — all 3 adjudicated claims are false |
| CERTIFIED appropriateness | **unmeasurable** | CERTIFIED has never occurred on real input |
| Calibration | **0 approved** | requires human adjudication — see `CALIBRATION-REPORT-V2.md` |

**The false-positive rate is the most important missing number.** Every adjudicated claim so far is
false, so the corpus can currently only demonstrate that the engine catches bad claims — never that
it leaves good ones alone. A corpus of only-false claims cannot distinguish a good detector from a
detector that rejects everything.

**Recommendation for the next adjudication round:** deliberately include claims the reviewer believes
are **true**. Without them, no amount of additional labelling will produce a false-positive rate, and
that is the number that would settle whether REJECT-always is a defect.
