# 1. Current architecture

**Baseline date:** 2026-07-23 · **Source:** 55 modules, 9,462 lines (excluding tests) ·
**Tests:** 169 passing across 12 files, 1,670 lines · **Replies published: 0**

This is the system as it exists, not as it was designed. Where a module does something other
than what its name suggests, the difference is stated.

---

## The pipeline

```
                        ┌──────────────────────────────────────────┐
                        │  OPERATOR'S CHROME  (attach, never launch)│
                        └────────────────────┬─────────────────────┘
                                             │ CDP
   ┌─────────────┐                           ▼
   │  session    │──────────────────►  browser.ts ──► reddit/scrape.ts
   │  behaviour  │                           │             │
   │  engine     │                           │             ▼
   └─────────────┘                           │        threads.json  (58)
                                             │             │
                                             │             ▼
                                    ╔════════╧═════════════════════════╗
                                    ║  PHASE 7  resolution detection   ║ ◄── DETERMINISTIC
                                    ║  (argus/resolution.ts)           ║     runs FIRST
                                    ╚════════╤═════════════════════════╝
                                             │ resolved → STOP
                                             ▼
                                        gap.ts  ──► gaps.json (24)
                                             │      "what is missing"
                                             ▼
                                     opportunity.ts ──► assessments.json (24)
                                             │      contribute | skip   ◄── DETERMINISTIC
                                             ▼
                                     commands/draft.ts ──► drafts.json (12)
                                             │      may DECLINE
                                             ▼
                          ┌──────────────────┴──────────────────┐
                          ▼                  ▼                  ▼
                   disclosure.ts        quality.ts         novelty.ts
                   (safety linter)     (craft gate)      (restatement)
                          └──────────────────┬──────────────────┘
                                             ▼
                                    ╔════════════════════════════════╗
                                    ║  ARGUS — truth certification   ║
                                    ║  claims → evidence → refute    ║
                                    ║  → graph → epistemic → verdict ║
                                    ║  CERTIFIED | ESCALATE | REJECT ║
                                    ╚════════╤═══════════════════════╝
                                             ▼
                                        gates.ts  (20 fail-closed gates)
                                             ▼
                                    ╔════════════════════════════════╗
                                    ║   HUMAN REVIEW  (mandatory)    ║
                                    ║   ask.ts — refuses non-TTY     ║
                                    ╚════════╤═══════════════════════╝
                                             ▼
                                      reddit/post.ts  ── the only write path
                                             ▼
                                   observe.ts → observations.jsonl
                                   regret.ts  → regret.jsonl
```

**Cross-cutting:** `trace.ts` (engineering telemetry, 299 events) · `log.ts` + `history.jsonl`
(account activity record, 50 entries) · `policy.ts` (24 operational limits with provenance) ·
`health.ts` (account state machine) · `doctor.ts` (install health).

---

## Module reference

### Collection layer

| | |
|---|---|
| **`browser.ts`** | |
| Purpose | Attach to the operator's Chrome over CDP. Establish identity. Detect blocks and rate limits. |
| Inputs | `REDBOT_CDP` endpoint (default `127.0.0.1:9222`) |
| Outputs | `Session` (browser, context, own tab), `Identity` |
| Depends on | playwright, `config.ts` |
| Failure modes | No debuggable Chrome → refuses with the exact launch command. Reddit block page arrives as **HTTP 200 with the block in the body**, so a status check reads it as success. Identity read races page hydration — polled, not read once. |
| Evidence | Measured 2026-07-22: all four Playwright-*launched* modes get a block page; attaching works. `read` went 0 → 25 threads. `certification/evidence/2026-07-22-reddit-access.md` |

| | |
|---|---|
| **`reddit/scrape.ts`** · **`selectors.ts`** · **`thread-state.ts`** | |
| Purpose | Collect listings and threads; probe live thread state before publishing. |
| Inputs | Page, subreddit or permalink |
| Outputs | `Thread[]`, `ThreadState` |
| Failure modes | Selector drift (one file, by design). Search scope contamination (DEFECT-03). Lock/archive selectors are **unverified** — no locked thread has ever been opened, so `probeThreadState` fails closed with `unknown[]`. |
| Evidence | 58 threads collected across 4 subreddits. DEFECT-03 reproduced and fixed. |

| | |
|---|---|
| **`behavior.ts`** + **`rand.ts`** | |
| Purpose | Shape reading as a person reads: dwell scaled to content, partial scroll, idle, abandon, weighted navigation, session budgets. |
| Inputs | Thread, seeded PRNG |
| Outputs | Timing/scroll plans, `SessionPlan` |
| Failure modes | Every rate in it is **declared, not measured**. `readingWordsPerMinute` is a placeholder. |
| Evidence | 15 tests including seed-replay determinism. 46.7% of sessions permit a reply (measured over 1,000 seeds). **Never exercised in a live session** — 0 `session.start` events. |

### Decision layer

| | |
|---|---|
| **`argus/resolution.ts`** — Phase 7 | |
| Purpose | Detect that the asker already declared their problem solved. Deterministic. Runs before everything. |
| Inputs | `Thread` (body + comment authors) |
| Outputs | `ResolutionVerdict` with matched text and whether the signal came from the OP |
| Failure modes | String matching — a novel phrasing of "solved" is missed. Requires `thread.author` to attribute OP replies. |
| Evidence | **HRC-001-A**: the model-based `alreadyAnswered` returned false on a thread whose body said `UPDATE: … it found all the CSS`. This module returns `resolved: true` on the same input, 4 signals, 0 model calls. Regression test uses the verbatim thread. |

| | |
|---|---|
| **`gap.ts`** | |
| Purpose | Establish what a discussion already contains (`covered[]`) and what it is missing, **before** drafting. |
| Inputs | Thread + comments |
| Outputs | `GapAnalysis` — question, covered claims, typed gaps, `alreadyAnswered`, headroom |
| Failure modes | `fillable` was true for **65 of 67 gaps (97%)** on the first real run — the flag does no filtering. `alreadyAnswered` missed an explicit UPDATE. Model-declared headroom disagreed with its own gaps twice in 16 analyses. |
| Evidence | 24 analyses on record. Headroom is recomputed locally from the structured gaps; disagreements logged as `headroom.corrected`. |

| | |
|---|---|
| **`opportunity.ts`** + **`competence.ts`** + **`select.ts`** | |
| Purpose | Decide contribute-or-skip, mechanically, from the gap analysis. Reject threads outside declared competence, stale threads, announcements and showcases. |
| Outputs | `OpportunityAssessment` — verdict, score, contribution thesis, reasons |
| Failure modes | Competence is a **vocabulary proxy**; it cannot tell whether an answer would be correct. Scores saturated at 100 before DEFECT-14. |
| Evidence | 9 of 15 assessed threads cleared the floor; scores spread 100 → 47 after the coverage penalty. Competence filter: all 9 r/Wordpress threads in scope, 4 of 5 r/webdev out. |

### Generation layer

| | |
|---|---|
| **`commands/draft.ts`** + **`prompts.ts`** + **`llm.ts`** | |
| Purpose | Generate a reply against an established gap, under a contract: state why-this-thread, what-is-new, why-not-silent — or decline. |
| Failure modes | `claude -p` inherits the working directory as agent context — **DEFECT-06**, which put a local Windows path into a draft. Fixed by running in an empty scratch dir plus `--permission-mode`. Per-operator auth refuses by design; the current operator entry is a **recorded exception** pointing at the machine-wide config. |
| Evidence | 12 drafts. 1 generated under the Phase 3 contract. 0 declines observed so far. |

### Verification layer

| | |
|---|---|
| **`disclosure.ts`** — safety linter | |
| Purpose | Block anything that would expose the operator or employer: agent leakage, brand mentions, fabricated experience, engagement bait, sales register, prompt echo. |
| Failure modes | Regex-based. Caught a real leak only after **DEFECT-10** widened it from line 1 to the opening block. |
| Evidence | 31/31 adversarial leakage cases blocked, 10/10 must-pass. Two production leaks caught retrospectively (DEFECT-06, DEFECT-10). |

| | |
|---|---|
| **`quality.ts`** — craft gate | |
| Purpose | Clichés, specificity against the thread, register, length, false certainty relative to triage confidence. |
| Failure modes | **Rewards confident prose.** HRC-001 scored well here while being wrong. Measures proxies for quality, never truth. |
| Evidence | 10 tests. Tokenizer bug found and fixed (trailing punctuation split `admin-ajax.php.` from `admin-ajax.php`). |

| | |
|---|---|
| **`novelty.ts`** | |
| Purpose | Test the draft's own "what is new" claim against `covered[]` captured before the draft existed. |
| Failure modes | **Open false positive**: blocked a good draft at 88%/80% overlap because it *referenced* thread facts to build on them. Cannot distinguish restating X from referring to X while adding Y. Threshold 70% is declared, not fitted. |
| Evidence | 11 tests. One production block, judged a false positive by human review, filed unfixed. |

| | |
|---|---|
| **`argus/*`** — truth certification | |
| Purpose | Decide whether a reply *deserves to exist*: decompose to atomic claims, classify, demand provenance, attack each claim, model dependencies, compare language to evidence, emit one of three verdicts. |
| Inputs | Draft body + thread |
| Outputs | `Certification` → `certifications.jsonl`, operator review package |
| Depends on | `llm.ts` (extraction + refutation only), everything else deterministic |
| Failure modes | **Provenance is self-declared and inflatable** — the model claimed `official-implementation` for the known-false claim. Refutation timed out twice at 180 s on its first real run. Rule 8 now escalates any unrefuted falsifiable claim. |
| Evidence | 27 tests. HRC-001 draft → REJECT on `thread-resolved`, 0 model calls. **The claim path has never completed end to end.** |

| | |
|---|---|
| **`gates.ts`** — 20 fail-closed publish gates | |
| Purpose | Last mechanical check before a human is asked. Runs twice: before the prompt and against a re-probed page before submit. |
| Failure modes | Every gate measures state, identity, health, duplication or shape. **None evaluates a technical claim.** Required the Phase-1 triage record until 2026-07-23, which made every Phase-3 thread unpublishable. |
| Evidence | 20 tests. First live pre-flight exposed the pipeline-join defect. |

### Human layer

| | |
|---|---|
| **`ask.ts`** + **`commands/reply.ts`** + **`review.ts`** + **`regret.ts`** | |
| Purpose | Mandatory human approval; capture a structured reason for every decision; ask the two questions only a person can answer. |
| Failure modes | **DEFECT-08** — `choose()` returned `options[0]` for unrecognised input, so a stray newline meant "approve, and post". Now the safe answer is a required argument and non-interactive stdin throws. |
| Evidence | 4 regression tests, one of which reads `reply.ts` to catch a positional default being reintroduced. **Review and regret datasets are both empty — 0 records.** |

### Observation and diagnosis

| Module | Purpose | State |
|---|---|---|
| `observe.ts` | Signed-in + signed-out checkpoints at immediate/1h/24h/7d | 1 observation (a karma reading). Signed-out vector **never exercised**. |
| `health.ts` | Account state machine: Healthy/Caution/Cooldown/Stop | 14 tests. Currently `Caution` — karma 1, measured. |
| `doctor.ts` | Install health: build staleness, secrets, data integrity, debt | 13 checks. Catches source-newer-than-dist. |
| `metrics.ts` · `insights.ts` · `trace.ts` | Reliability metrics, funnel loss attribution, engineering telemetry | 299 trace events, 8 runs. |
| `reports.ts` · `argus/reports.ts` | 13 generated documents | All regenerated from disk; none hand-edited. |

---

## Two logs, deliberately separate

| | |
|---|---|
| `history.jsonl` | what the **account** did to Reddit — feeds health and reliability metrics |
| `trace.jsonl` | why the **pipeline** decided what it did — stage timings, drop reasons |

Merging them would inflate the counters that answer for account behaviour with events that never
touched Reddit. A stage timing is not an action.

## Data stores

| File | Records | Append-only |
|---|---|---|
| `threads.json` | 58 | no (upsert) |
| `analysis.json` | 45 | no |
| `gaps.json` | 24 | no |
| `assessments.json` | 24 | no |
| `drafts.json` | 12 (10 pending, 2 rejected) | no |
| `history.jsonl` | 50 | **yes** |
| `trace.jsonl` | 299 | **yes** |
| `observations.jsonl` | 1 | **yes** |
| `reviews.jsonl` | **0** | **yes** |
| `regret.jsonl` | **0** | **yes** |
| `certifications.jsonl` | 2 | **yes** |

All gitignored. The project is untracked in the parent repo by design (DEFECT-01).
