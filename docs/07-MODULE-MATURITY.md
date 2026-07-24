# 7. Module maturity

One status per module. **Every status cites evidence.** A module with tests but no production
exposure is `Experimental`, not `Validated` — tests demonstrate that code does what its author
expected, which is a different claim.

| Status | Meaning |
|---|---|
| **Prototype** | works once, no tests, no production use |
| **Experimental** | tested, but never exercised against production reality |
| **Validated** | exercised in production; behaviour observed and matched expectation |
| **Production Candidate** | validated, and has survived a failure it was built to catch |
| **Production Ready** | validated over repeated use, with known failure modes and measured limits |
| **Unsupported** | present, not maintained, not to be extended |

**No module in this project is Production Ready.** That status requires repeated use and measured
limits; the system has 1 measured limit and 0 published interactions.

---

## Production Candidate

| Module | Evidence |
|---|---|
| **`argus/resolution.ts`** | Returns `resolved: true`, 4 signals, on the exact thread the model-based check missed (E-22/E-23). Caught the failure it was built for, on real data, deterministically. Regression test uses the verbatim thread. |
| **`disclosure.ts`** | 31/31 adversarial leakage classes blocked, 10/10 must-pass (E-10). Caught two real leaks in production drafts (DEFECT-06, DEFECT-10) — both after being widened by the leak, which is the honest caveat. |
| **`ask.ts`** | DEFECT-08 was a live fail-open; the fix is backed by 4 regressions, one of which reads the call site. Two independent layers now refuse agent publication (E-31). |
| **`browser.ts`** (attach model) | The four-mode experiment (E-01) and 58 threads collected. Identity detection was wrong three ways and is now right, with the dead ends recorded. |

## Validated

| Module | Evidence |
|---|---|
| **`argus/extract.ts` + `prompts.ts`** | Produced 12 correctly-typed atomic claims with 8 dependency edges from a real draft (E-24, E-36). |
| **`argus/certify.ts`** | Both real verdicts correct: REJECT via `thread-resolved`, REJECT via 16 fatal contradictions (E-23, E-32). ⚠️ **Has never returned CERTIFIED or ESCALATE on real input** — see N-06c. |
| **contradiction pass** (`findContradictions`) | Independently found `ERROR 1153` citing primary documentation, and three defects human review missed (E-33, E-34). Also observed timing out twice (E-26). |
| **`gap.ts`** (extraction only) | 24 analyses producing specific, checkable gaps. Its *self-assessment* fields are Experimental at best — `fillable` was 97% true (E-14), `alreadyAnswered` missed an explicit UPDATE (E-22). |
| **`opportunity.ts` + `competence.ts`** | Saturation found and fixed with observed spread 100→47 (E-13); competence filter validated against 14 real threads with 4 false positives found and removed (E-16). |
| **`gates.ts`** | 20 gates; the first live pre-flight exposed a real integration defect (E-17), which is the framework working. Several individual gates never fired. |
| **`reddit/scrape.ts`** | 58 threads, 4 subreddits, DEFECT-03 and DEFECT-04 found and fixed in production use. |
| **`llm.ts`** | Carries two production-hardened fixes: subprocess isolation (DEFECT-06) and dual-stream error reading (DEFECT-09). |
| **`policy.ts`** | The provenance convention has held across 24 limits and repeatedly prevented a placeholder being quoted as a finding. |
| **`trace.ts` + `insights.ts`** | 299 events over 8 runs; directly produced three findings (saturation, refutation timeouts, provenance inflation). |

## Experimental — tested, never exercised in production

| Module | Why not Validated |
|---|---|
| **`behavior.ts` + `rand.ts`** | 15 tests, seed-replay proven — **0 live sessions** (N-12). Every rate in it is declared; reading speed is a provisional placeholder. The largest untested subsystem here. |
| **`reddit/post.ts`** | **Never executed.** Composer discovery, typing, submit, landed-confirmation, permalink capture — 104 lines, the highest-consequence code in the project, zero production exposure (N-02). |
| **`commands/observe.ts`** | 1 observation recorded (a karma reading). The **signed-out vector has never run** (N-04) — and it is the only check that detects the failure mode that matters. |
| **`review.ts`** | Wired into every decision path; **`reviews.jsonl` is empty** (N-08). |
| **`regret.ts`** | The metric judged most important in the project; **`regret.jsonl` is empty** (N-09). |
| **`health.ts`** | 14 tests covering every transition. In production it has only ever reported `Caution` — Cooldown and Stop are unreachable without a published reply. |
| **`argus/graph.ts`** | Correct and tested. In the one real run, `invalidated: 0` because every downstream claim was independently refuted — right answer, propagation path unexercised (N-06b). |
| **`argus/epistemic.ts`** | Fired once in production (`overconfident-language` on c9). One data point. |
| **`novelty.ts`** | Fired once in production and the block was judged a **false positive** by human review. Threshold unfitted (N-10). |
| **`quality.ts`** | Runs on every draft, but its scope is *readability*, and it passed HRC-001. It has never been shown to catch something that mattered. |
| **`metrics.ts`** | Computes correctly over a dataset that is almost entirely empty. |
| **`reddit/thread-state.ts`** | Lock/archive selectors **unverified** — no locked thread has ever been opened (N-07). Fails closed, which is safe and unproven. |
| **`commands/session.ts`** | 0 `session.start` events. |
| **`doctor.ts`** | 13 checks, run repeatedly, caught the operator env-var gap. The build-staleness check has never actually fired on a stale build. |
| **`reports.ts` + `argus/reports.ts`** | 841 lines generating 13 documents. Correct output, but read by one person on a dataset with no published interactions. |

## Prototype

| Module | Why |
|---|---|
| **`probe-karma.ts`** | Works, records now, no tests. Parses a profile page with regexes; `cakeDay`/`joined` returned null on the one real run, so account age is still unmeasured. |
| **`commands/analyze.ts`** | The Phase-1 triage path, superseded in practice by `opportunity`. Still referenced by gates as an alternative. |

## Unsupported

| Module | Why |
|---|---|
| **`commands/analyze.ts`** *(dual-listed)* | Phase 3 replaced its role. It still writes `analysis.json`, which `gates.ts` accepts as an alternative to an assessment. Two decision paths for one decision — see technical debt. |
| **`commands/search.ts`** | Built, wired, and **never run live** (N-14 adjacent). Shares the verified `read` code path but its scope-fix (DEFECT-03) has never been exercised in production. |

---

## The distribution is the finding

- **4 Production Candidate** — all four are *defensive* modules that caught a real failure.
- **11 Validated** — mostly decision and analysis layers exercised on 58 real threads.
- **16 Experimental** — including every module that touches publishing, observing, or recording
  human judgement.
- **0 Production Ready.**

Every module on the **input** side has production exposure. Every module on the **output** side —
post, observe, review, regret — has none. The system has been thoroughly exercised at reading and
deciding, and not at all at acting and learning.

That is the shape of a project with zero published interactions, and no amount of further building
changes it.
