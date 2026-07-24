# Engine freeze — v0.9-engine-freeze · 2026-07-23

## Policy

**The certification engine is frozen.**

No changes to scoring, reasoning, replay, rule execution, contradiction generation, provenance
assignment, certification logic, or thresholds — **except for defects demonstrated through
benchmark evidence or human calibration.**

### Frozen surface

| Module | What is frozen |
|---|---|
| `src/argus/certify.ts` | all 12 verdict rules and their ordering |
| `src/argus/extract.ts` | claim extraction, enum coercion |
| `src/argus/graph.ts` | dependency propagation, cycle detection |
| `src/argus/epistemic.ts` | Phase 8 calibration |
| `src/argus/resolution.ts` | deterministic resolution detection |
| `src/argus/prompts.ts` | extraction and contradiction prompts |
| `src/argus/types.ts` | claim types, evidence classes, confidence levels |
| `src/opportunity.ts`, `src/gap.ts`, `src/competence.ts` | the decision path |
| `src/policy.ts` | every threshold |
| `src/interactions.ts` | observation schema v1.0 |
| `ground-truth/schema.json` | corpus case contract |
| `qa/benchmark/cases/*.json` | frozen artifacts, already |

### What unfreezing requires

One of exactly two things:

1. **Benchmark evidence** — a case in `qa/benchmark/` fails, or reproduces the wrong verdict for
   the wrong reasons.
2. **Human calibration** — an adjudicated corpus case shows the engine disagreeing with a human
   ruling in a way attributable to the engine rather than to the specification or to insufficient
   evidence.

A model's opinion that something could be better is **not** grounds. Neither is a finding at n=1.

### Why this is being written down now

Two defect candidates exist (DC-01 provenance inflation, DC-02 unfaithful citations). Both are
real, both are measured, and **neither justifies a change**: DC-01 rests on 3 claims in 1 case and
already failed to reproduce in the second; DC-02 rests on 13 checked citations from 1
certification. The temptation to act on them is exactly what this policy exists to resist.

The engine has also just been shown, on the only human judgement available, to catch **3 of 3**
claims a person ruled false. Changing rules now would discard the only baseline against which any
future change could be measured.

---

## Immutable research baseline

Everything below is measured from disk on 2026-07-23. It is the reference point for every
future comparison.

### Architecture

| | |
|---|---|
| Version | `v0.9-engine-freeze` |
| Source | **78 TypeScript files · 12,549 lines** |
| Dependencies | `playwright` only (dev: `typescript`, `@types/node`) |
| Tests | **182 / 182** |
| Typecheck | clean under `strict` |
| Benchmark | exit 0 — 4 cases from 2 drafts |
| ARE-001 replay | exit 0 — deterministic |
| Corpus validation | exit 0 |
| `doctor` | **12 pass · 3 warn · 0 fail** |
| Docs | 13 architecture/evidence documents |

### Replay

- **Verdict replay: deterministic.** 4 of 4 records reproduce their verdict.
- **Reason replay: bounded, 0 of 4 exact.** Decomposed into three named causes — harness artifact
  (runs #1–2), genuine Rule-8 drift (run #3), pre-EB-40 field gap (run #4, resolved).

### Corpus and ground truth

| | |
|---|---|
| Corpus cases | 2 |
| Ground-truth approved | **1** (HRC-001) |
| Calibration approved | **0** |
| HRC-001 adjudicated | **3 of 12** claims |
| CERT-002 adjudicated | **0 of 19** claims |
| Primary sources verified | 3 (MySQL manual ×2 pages, WordPress `schema.php`) |

### Calibration — v1

| Measure | Value |
|---|---|
| Verdict agreement | **1 of 1** |
| Contradiction agreement | **3 of 3** — zero false negatives on the adjudicated set |
| Provenance agreement | **0 of 3** — uniformly inflated |
| Citation fidelity (Tier-1) | **FULL 4 · PARTIAL 4 · NONE 4 · UNVERIFIABLE 1** (n=13) |
| Fatal contradictions with faithful citations | **3 of 8** |
| Extraction precision / recall | **not computable** — no `expected_claims` authored |
| False positives | **not computable** — 9 of 12 claims unadjudicated |

### Production

**Zero.** 0 published · 0 operator decisions · 0 regret readings · 0 interaction rows ·
1 observation (a karma reading). 58 threads collected, 12 drafts, 10 pending.
**Pilot readiness: 0 of 5.**

### Evidence

**72 proven observations (E-01…E-70+), 19 explicit holes (N-01…N-17).** Index:
[`docs/08-EVIDENCE-INDEX.md`](docs/08-EVIDENCE-INDEX.md).

### Known defect candidates

| | Observed | Frequency | Confidence |
|---|---|---|---|
| **DC-01** provenance inflation | authoritative classes on 3 claims ruled false | 3 of 3 adjudicated, 1 of 2 cases; **did not reproduce in CERT-002** | high for HRC-001, not general |
| **DC-02** unfaithful citations | 4 of 13 Tier-1 citations unsupported, 1 states the opposite | only 3 of 8 fatal citations faithful | high for this certification, 1 draft |

Neither is actionable under the freeze policy.

### Open questions

1. Is any Argus verdict correct? — 4 runs, 4 REJECTs, 0 verified.
2. Does provenance inflation generalise? — 1 case.
3. Can Argus produce a correct CERTIFIED or ESCALATE? — never produced either in production.
4. Extraction precision / recall — no expected-claims list exists anywhere.
5. Refutation miss rate — unbounded by construction.
6. Does the publish path work? — 104 lines, 0 executions.

### Decision log — the choices that shaped this

| Decision | Because |
|---|---|
| Attach, never launch | every Playwright-launched browser got a Reddit block page, served as HTTP 200 |
| Ambiguity resolves to silence | DEFECT-08: the approval gate failed *open* |
| Mechanical over prompt | every fix that held checked a fact the model does not control; every prompt revision drifted |
| Model produces structure, code makes decisions | HRC-001 — fluent output trusted end to end |
| Ask for observations, compute verdicts in code | model self-assessment failed 4× (`fillable`, `alreadyAnswered`, `headroom`, `evidenceClass`) |
| One decision path | D-01 — two stages answering one question drifted and silently blocked publishing |
| Ground truth never from a model | a model authoring its own answer key reproduces HRC-001 one level up |
| Never invent an aggregate before its raw observations | an aggregate computed from rows can be recomputed; one stored directly cannot |
| Human review is architecture, not a safeguard | no text-level check measures truth, and none can |

### Research timeline

Collector and access model → safety linter → behaviour and health engines → 20 publish gates →
gap analysis and opportunity engine → **HRC-001** → Argus → benchmark → AGTC → observation schema
freeze → D-01 retirement → citation-fidelity campaign → Calibration Report v1 → **engine freeze**.

---

## What is NOT frozen

Evidence collection. Corpus growth. Human adjudication. Retrieval. Replay experiments.
Documentation.

The engine is frozen so that everything measured against it stays comparable.
