# Operator log — Phase 12

**Date:** 2026-07-23 · **Mode:** operational validation, not construction
**Engine files modified: 0** · No UI changes · No release engineering

A chronological record of using redbot as an operator. Friction is catalogued separately in
`USABILITY-LOG.md`; measurements in `CERTIFICATION-METRICS.md`; corpus state in
`CALIBRATION-REPORT-V2.md`.

---

## The decision that shaped this phase

Phase 12's stated goal was the first calibration-approved case, via adjudicating HRC-001's nine
outstanding claims.

**I did not adjudicate them.** Ruling on whether a claim is true is the answer key this engine is
scored against; a model writing that key makes the engine its own examiner and silently corrupts
every downstream metric. `AGTC.md` forbids it and every prior phase has upheld it.

So the phase ran as: *everything an operator can legitimately do, plus the highest-value experiment
that does not require ground truth* — **run real certifications and find out whether anything other
than REJECT ever comes out.** That question needs no labels and attacks the largest open risk in the
project.

Full reasoning: `CALIBRATION-REPORT-V2.md`.

---

## Session

### 1 · Establish the operating surface

Started the dashboard (`--port 7900`, `REDBOT_OPERATOR=jerome`) and worked from it.

State on arrival: engine **FROZEN**, validation **PASSING**, corpus **PARTIAL** (1/2 ground truth
approved, 0 calibrated), publication **BLOCKED** (0/8 checks). Pipeline blocked at calibration.
4 certification records, 2 distinct drafts, 12 drafts, 10 pending, **0 published**.

`doctor` — **11 pass · 4 warn · 0 fail**, exit 0. The `llm operator` check resolved
(`cli · operator "jerome"`), so certification was viable.

### 2 · Choose work — first friction

Question: *which drafts have never been certified?* The dashboard shows `12 drafts · 10 pending` and
`4 records · 2 certified drafts` but never *which*. Answering it took a Node one-liner joining
`data/drafts.json` against `data/certifications.jsonl`.

Result: **8 uncertified pending drafts.** → **F-6**.

Then: certification cannot be started from the dashboard — `certify` is deliberately absent from the
allowlist, so I dropped to a terminal and hand-typed a draft ID copied off the Certifications page.
→ **F-2**. The exclusion is correct; the dead end is the problem.

### 3 · First real certification — and the phase's most useful finding

```
node dist/cli.js certify d_ac82fb88ec9d_mrvwodeo
```

It printed its heading and then **nothing**. My 600-second timeout killed it — except it had not
failed; it was working. → **F-3**, and the first ten minutes of the phase were spent on a
self-inflicted wound.

Restarted in the background. Still silent. To establish it was alive rather than hung I had to:

1. `tail data/trace.jsonl` → `argus.extract` 92 s, `argus.claims` count **19**, then silence.
2. Inspect the Windows process table → `claude.exe -p --model claude-sonnet…` alive, near-zero CPU,
   blocked on model I/O.

Two levels below the interface an operator is supposed to use. → **F-1**.

The run continued past **35 minutes** — beyond every previously observed duration.

### 4 · Throughput, measured for the first time

Reconstructed from `data/trace.jsonl` across all historical gate runs:

| Run | Claims | Extraction | Refutation → verdict | Total |
|---|---|---|---|---|
| `51154847` | 7 | 64 s | 7.6 min | **8.7 min** |
| `82c9e2ba` | 12 | 113 s | 22.8 min | **24.7 min** |
| `e5a8e166` | 19 | 152 s | 12.4 min | **14.9 min** |
| `de80382f` | 19 | 92 s | 25.5 min | **27.1 min** |

**Certification costs 9-27 minutes per draft and does not scale with claim count** — 7/12/19/19
claims map to 8.7/24.7/14.9/27.1 minutes, which is not a trend. The refutation loop is **85-95%**
of it, and runtime cannot be predicted from the draft.

Consequence: certifying the eight remaining drafts is **2–3.5 hours of wall clock**. That reframes
"run new real certifications" from a task into a budget, and it was invisible before this phase
because nobody had timed it.

### 5 · Two real certifications — the phase's substantive result

The first landed after **27.1 minutes**: `d_ac82fb88ec9d_mrvwodeo`, 19 claims, **51 contradictions**
(more than double the density of the previous 19-claim draft), 7 fatal → **REJECT**.

For the second I deliberately picked `d_c14d9d8caa0e_mrw1nf9l` — **308 characters, the shortest draft
in the store**, and therefore the best available candidate to produce a non-REJECT verdict if one is
reachable at all. It completed in **8.7 minutes**: 7 claims, 15 contradictions, 7 fatal → **REJECT**.

**4 distinct drafts. 6 records. 100 % REJECT. CERTIFIED and ESCALATE have still never occurred on
real input.**

Measuring *why*, which needs no ground truth: a verdict is REJECT if **any one claim** carries a fatal
contradiction, and across the four drafts **26–71 % of claims attract one**.

| Draft | Claims | Claims with ≥1 fatal |
|---|---|---|
| `d_f11d8de68709_mrwj1koh` | 12 | 8 — 67 % |
| `d_c9bd9366f6b9_mrwiupf2` | 19 | 5 — 26 % |
| `d_ac82fb88ec9d_mrvwodeo` | 19 | 6 — 32 % |
| `d_c14d9d8caa0e_mrw1nf9l` | 7 | 5 — 71 % |

CERTIFIED requires *every* claim to survive. At those rates a 19-claim draft clearing all of them is
vanishingly unlikely — which explains the 0 % CERTIFIED rate mechanically.

**This does not show the engine is wrong.** Those contradictions may be correct; on the three claims a
human has checked, they were. But it means the REJECT rate is *not* evidence the drafts are bad — it
is equally consistent with a threshold almost nothing can pass. Separating those two requires
labelled claims a human believes are **true**, and none exist.

### 6 · Measure what the existing labels support

While the certification ran, I measured everything the three human-adjudicated HRC-001 claims permit.

**Refutation recall — 3/3.** Every claim the reviewer ruled false received a fatal contradiction.
Zero false negatives on the adjudicated set.

**Contradiction precision — 3/3.** All three fatal contradictions independently reconstruct error
1153 / SQLSTATE 08S01 and the connection abort — the same mechanism the reviewer identified. Two cite
primary MySQL documentation.

**Provenance accuracy — 0/3, inflated every time:**

| Claim | Human expected | Argus declared |
|---|---|---|
| c5 | `reasoned-inference` | `observed-runtime-behaviour` |
| c6 | `reasoned-inference` | `primary-documentation` |
| c7 | `reasoned-inference` | `official-implementation` |

**Epistemic accuracy — 0/3.** `confidence: high` where the reviewer expected `explicitly-uncertain`.

**The engine reaches the right verdict through a provenance layer that is wrong every time.** The
benchmark independently reports the same shape: `provenance_correct: 0` of `provenance_declared: 9`.
Under the freeze policy — *"a case reaches the right verdict for the wrong reasons"* — this is the
admissible category of unfreeze evidence. It is not yet sufficient: n=3, one draft, one adjudicator.

### 7 · Corpus data-quality note

`ground_truth.expected_claims` is **null in both cases**. The dashboard's fallback to
`argus_observed.claims.length` produces the correct 12 and 19, matching each case's `blocked_by`
string — but that fallback is silently load-bearing. → **F-5**. Populating the field is a corpus
edit and therefore frozen.

---

## What the dashboard got right

Recorded deliberately, because the un-annoying parts are evidence too:

- **Reading a certification** never once required the raw JSONL. Fired rules in order, the dependency
  graph, per-claim provenance — all answered from the page.
- **Search** filtered 49 rows to 7 on `wayback` and was the fastest route to "what did it say about
  the Wayback claims".
- **Validation** — one click, six gates, 4.1 s, exit codes visible. Zero friction.
- **Empty states** — `reviews.jsonl` explaining *why* it is absent prevented a wasted investigation.
- **`blocked_by` as chips** answered "why is this case not promoted" instantly, with no digging.

The dashboard was a good place to *read* from all session. Its weakness is that it cannot show work
in flight (**F-1/F-4**) or tell you what to do next (**F-2/F-6**).

---

## Deliverables

| File | Contents |
|---|---|
| `OPERATOR-LOG.md` | this record |
| `USABILITY-LOG.md` | 6 friction points — severity, frequency, root cause, fix, cost |
| `CERTIFICATION-METRICS.md` | verdict frequency, recall, precision, provenance, throughput, what is unmeasurable |
| `CALIBRATION-REPORT-V2.md` | corpus state, why calibration is still 0, what nine rulings would buy |

---

## Status at stop

| | |
|---|---|
| Engine files modified | **0** |
| Tests | **182/182** |
| Benchmark · corpus · replay | exit 0 · 0 · 0 |
| Extraction verification | 39 verified · 0 deviated |
| Calibration approved | **0** — unchanged, and not mine to change |
| Certifications completed | **2** — both REJECT · 27.1 min and 8.7 min |
| Distinct drafts certified | 2 → **4** |
| Friction points recorded | 6 |
| Fixes implemented | **0** — by instruction |

Phase 12's stopping condition was *"stop after the first calibration-approved case is achieved."*
That case requires a human ruling on nine claims. I stopped at that boundary with the measurements
that did not require crossing it.

**The one thing worth carrying forward:** finishing HRC-001 unblocks the counter, but it will not
produce a false-positive rate, because every adjudicated claim so far is *false*. To learn whether
this engine rejects everything, the next round must include claims a human believes are **true**.
