# 12. Final-phase assessment — 2026-07-23

Recomputed from `data/`, `npm test`, and the CLI. **Not from the other documents**, two of which
were carrying stale figures when this was written.

---

## 1 · Current system state

| | |
|---|---|
| **Architecture** | **FROZEN.** Argus, AGTC, benchmark, interactions, health, metrics, pipeline all unchanged |
| **Active experiment** | Ground Truth Corpus expansion — 1 of 2 cases labelled |
| **Production readiness** | **Internal testing only.** 0 of 5 pilot criteria met |
| **Tests** | 184/184, typecheck clean under `strict` |
| **Replies published, all time** | **0** |

### Frozen components

`src/argus/*` · `src/interactions.ts` (schema v1.0) · `ground-truth/schema.json` ·
`qa/benchmark/cases/*` (frozen artifacts) · Reputation Intelligence (parked, not built)

### Coverage, measured

| Surface | Coverage | Reading |
|---|---|---|
| **Corpus** | 2 cases · **1 ground-truth approved** · **0 calibration approved** | one draft's verdict is labelled; no draft's claims are fully adjudicated |
| **Benchmark** | 4 cases from 2 drafts · 4/4 pass · **verdict paths 2 of 6** | a regression suite, not an evaluation |
| **Calibration** | **0 qualifying claims** | the corpus gate excludes both cases |
| **Certification** | 4 records · 2 distinct drafts · **4/4 REJECT** | CERTIFIED and ESCALATE have never been produced in production |
| **Operator review** | **0 decisions** | `reviews.jsonl`, `regret.jsonl` both empty |
| **Observation** | 1 record (karma=1) · `interactions.jsonl` **empty** | the schema is frozen and unexercised |

### Two measurements that size the gap precisely

**15 of 23 declared history kinds have never been recorded once:** `login.fail`, `gap`,
`draft.declined`, `review`, `approve`, `reject`, `publish.attempt`, `publish.ok`, `publish.fail`,
`ratelimit`, `selector.miss`, `session.start`, `session.end`, `session.view`, `observe`.

**No publish gate has ever fired.** The 4 recorded `gate.block` entries all come from `certify`
and carry no gate names. Twenty gates, zero production firings.

---

## 2 · Evidence review — open items

| # | Status | Why still open | What closes it | Code? | Human? | ROI | Priority |
|---|---|---|---|---|---|---|---|
| **EB-01** | open | publish path never executed | one publish | no | **yes** | highest — unblocks 8 items | **1** |
| **EB-02** | open | accepted / removed / filtered indistinguishable | signed-out checkpoint after a publish | no | **yes** | highest | **1** |
| **EB-41** | open | cert #2's REJECT unverified | read the review package, rule on it | no | **yes** | high — 2nd calibration sample | **2** |
| **EB-17** | open | Argus has only ever rejected | certify a draft that is genuinely sound | no | yes | high — separates strict from broken | **3** |
| **EB-36** | open | refutation miss rate unmeasurable | a false claim that survives refutation | no | yes | medium — bounded by design | 6 |
| **EB-37** | **answered** | inflation is draft-dependent (E-48) | — | — | — | — | closed |
| **EB-38** | open | is ESCALATE sufficient for a false claim | operator behaviour on an escalated draft | no | yes | medium | 5 |
| **EB-39** | open | confidence not conditioned on provenance | 3rd certification to see if it recurs | no | yes | medium | 5 |
| **EB-40** | open | `refutationRan` not persisted | one field on `Certification` | **yes** | no | medium — replay fidelity | 4 |
| **EB-10…16** | open | approval rate, threshold fit, gate value | ~10 operator decisions | no | **yes** | high, but gated on EB-01 | 3 |
| **EB-19…25** | open | drift, stability, behaviour engine | weeks of operation | no | yes | low now | 7 |
| **EB-26…28** | open | cold start, 2nd operator, **no evidence backup** | a second machine; a backup mechanism | **yes** (28) | yes | **D-04 is catastrophic if it lands** | 4 |

**Not one open item is blocked on engineering.** Two require code at all (EB-40, EB-28), and
neither is on the critical path.

---

## 3 · Gap analysis — one category each

| Category | Items |
|---|---|
| **Bug** | *(none open)* |
| **Instrumentation** | EB-40 persist `refutationRan` · wire `probe-karma` into the CLI |
| **Calibration** | adjudicate HRC-001's 9 unreviewed claims · label CERT-002 |
| **Ground Truth** | certify drafts 3–10 and label each |
| **Corpus** | migration step 3 (drop inline `ground_truth` once every case has an entry) |
| **Documentation** | STATUS.md + PRODUCTION-READINESS.md stale figures **(fixed today)** · retire STATUS.md as an entry point |
| **Operator** | **publish one reply** · decide one draft at the prompt · 4 checkpoints · regret at 24h |
| **Release** | recompute the 5 pilot criteria after the first publish · replace or re-declare 6 provisional limits |
| **Future** | Reputation Intelligence · adapter seam · Veritas |
| **Waste** | **the Phase-1 triage path** (see §5) · `reports.ts` surface at 843 lines for 0 interactions |

---

## 4 · Production readiness — recomputed from evidence

The bar is this project's own, set in `PRODUCTION-READINESS.md` before it could be gamed.

| # | "Ready for a limited pilot" requires | Evidence | Met |
|---|---|---|---|
| 1 | one reply published, permalink captured | 0 publishes | **NO** |
| 2 | that reply observed at all 4 checkpoints incl. signed-out | 0 observations of a reply | **NO** |
| 3 | ≥3 behaviour sessions across ≥2 days | 0 `session.start` events | **NO** |
| 4 | 0 unexplained publish failures, 0 gate bypasses | vacuous — nothing has run | **unmeasurable** |
| 5 | 6 provisional limits measured or re-declared | 1 measured · 17 declared · 6 provisional | **NO** |

### Can redbot be released?

**No.**

**What blocks it, exactly:** a person has not published a reply. Everything in criteria 1–3
descends from that single act, and criterion 5 needs the operating data it produces.

### Blockers, recomputed — 3 → 1

| # | Blocker (as written) | Now |
|---|---|---|
| 1 | Operator Claude credentials | **RESOLVED.** The recorded exception was exercised end to end by a real `certify` run; `doctor` reports 0 failures |
| 2 | A fresh collection run — "0 of 45 threads eligible" | **RESOLVED on the surviving path.** 58 threads, 41 inside the 72h window, 10 fresh pending drafts. Still reads 0/45 on the retired path — which is §5 |
| 3 | A person at a real terminal | **STANDS. The only remaining blocker.** |

---

## 5 · Challenge — what should be deleted before anything is added

### D-01 · The Phase-1 triage path — **recommend deletion**

Ranked #1 in technical debt and #3 in the stop-building check. It is not theoretical; it is
observable today:

```
redbot select   →  "0 eligible of 45 analyzed"      reads analysis.json   (Phase 1, retired)
redbot draft    →  picks from 24 assessments         reads assessments.json (Phase 3, current)
```

**Two commands answer the same question from different data and disagree.** It has already
produced one silent defect (E-17: every thread on the newer path was unpublishable). `select`
also still reads two model self-assessments — `opp.confidence` for "expertise match" and
`opp.answerableWithoutPitch` for the no-pitch check — which is D-11, the project's most repeated
failure pattern, live in a command that is still run.

*Not deleted in this session:* the session's first rule is "assume the architecture is correct;
you are here to prove it." Deleting a decision path is a change to the architecture and should be
an explicit decision, not a side effect of an audit. It is Phase A, item 1.

### Stale documentation — **fixed today**

`STATUS.md` claimed 29/29 and 93/93 tests. `PRODUCTION-READINESS.md` claimed 134/134 in its
header and 93/93 in its reproduce block — self-inconsistent, and both wrong against 184/184. Both
now carry a correction banner pointing here.

### `probe-karma.ts` — not wired into the CLI

The only module never imported by anything. It is a standalone script, so it runs, but it is
absent from `redbot --help`. A measurement tool nobody can find is a measurement that will not be
taken. **Instrumentation, low cost, not urgent.**

### Report surface — watch, do not cut yet

`reports.ts` (558) + `argus/reports.ts` (285) = 843 lines generating 13 documents about 0
published interactions. Disproportionate, harmless today, and it is the evidence campaign's
deliverable. Flagged in D-05; revisit after the first ten interactions.

### Searched for and NOT found

No duplicate evidence stores. No unnecessary abstraction layers. No overfitted HRC-001 logic in
production code — every HRC-001-derived rule (`thread-resolved`, Rule 8, the `SHOWCASE` and
`ANNOUNCEMENT_TAG` lists) is a general check that cites HRC-001 as its origin, which is the
documented convention rather than overfitting. One genuine near-miss: `qa/benchmark/cases/`
holds 3 of 4 cases derived from a single draft, and the benchmark says so in its own output.

---

## 6 · Work plan

### Phase A — Retire the duplicate decision path

**Deliverables** — delete `commands/analyze.ts`, `analyzeBatchPrompt`, `saveOpportunities`; port
`select.ts` to `OpportunityAssessment`; make `gates.ts` accept one authority; keep
`loadOpportunities` as a read-only accessor so `analysis.json` stays readable as evidence.
**Evidence produced** — one decision path; `select` and `draft` agree by construction.
**Tests** — existing gates/select suites updated; a test asserting `analysis.json` is never
written. **Stop condition** — 184+ tests green, `select` and `draft` return the same candidate
set. **Success** — D-01 closed, D-11 surface reduced by 2 fields.
**Backlog closed** — D-01. **Risk reduced** — the drift that already caused E-17.

### Phase B — Ground truth expansion

**Deliverables** — certify drafts 3–6; label each in AGTC; adjudicate HRC-001's 9 unreviewed
claims. **Evidence produced** — the first calibration-approved case; 4+ corpus cases.
**Tests** — `validate.mjs` exit 0 with ≥1 calibration-approved. **Stop condition** — 5 labelled
cases, or a certification returns CERTIFIED/ESCALATE (either is a finding). **Success** —
calibration coverage > 0; EB-17, EB-37, EB-39 gain samples.

### Phase C — Operator validation *(requires a human; nothing else unblocks it)*

**Deliverables** — decide one draft at the prompt; publish one reply; 4 checkpoints incl.
signed-out; regret at 24h. **Evidence produced** — first `interactions.jsonl` rows; first review
record with timing and edit distance; first outcome. **Stop condition** — one full lifecycle
recorded, whatever the outcome. **Success** — EB-01, EB-02, EB-06, EB-07 close; pilot criteria
1–2 become measurable.

### Phase D — Release readiness

**Deliverables** — recompute the 5 criteria; measure or re-declare the 6 provisional limits;
first `redbot metrics` run with non-zero denominators. **Stop condition** — every criterion
answered yes/no from evidence. **Success** — a defensible release verdict.

### Phase E — Documentation freeze

**Deliverables** — retire `STATUS.md` as an entry point; corpus migration step 3; single current
entry point. **Stop condition** — no document states a figure contradicted by `data/`.

### Phase F — Version 1.0

**Stop condition** — 10 reviewed interactions per the release rule, criteria 1–5 met, corpus with
≥1 example of every verdict path. **Not before.**

---

## 7 · Task evaluation — the eight questions, applied

| Task | Closes | Code? | Same evidence without code? | Reversible | Verdict |
|---|---|---|---|---|---|
| Retire Phase-1 path | D-01 | yes | no | yes — files preserved | **DO, Phase A** |
| Persist `refutationRan` | EB-40 | yes (1 field) | no | yes | **DO, with Phase A** |
| Back up `data/` | EB-28 / D-04 | yes | no — no manual equivalent | yes | **DO, Phase A** |
| Wire `probe-karma` into CLI | instrumentation | yes (1 line) | yes — run the script | yes | **defer** |
| Label CERT-002 | EB-41 | **no** | n/a — human only | yes | **DO, Phase B** |
| Adjudicate HRC-001's 9 claims | calibration | **no** | n/a — human only | yes | **DO, Phase B** |
| Publish one reply | EB-01/02 | **no** | n/a — human only | **no** | **DO, Phase C** |
| Any Reputation Intelligence work | nothing | yes | n/a | — | **WAIT** — every metric divides by zero |
| Adapter seam | nothing | yes | n/a | — | **WAIT** — no second platform exists |

---

## 8 · The honest summary

The instrument is finished and the readings are absent. Every remaining uncertainty of
consequence is closed by **a person spending an hour**, not by an engineer spending a week.

The one exception worth engineering time is deleting something: the Phase-1 triage path, which
is the highest-ranked debt in the project, is demonstrably producing two different answers to one
question today, and carries two of the model-self-assessment fields that have failed four times.

**Delete before adding.**
