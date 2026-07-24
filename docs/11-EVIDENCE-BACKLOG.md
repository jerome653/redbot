# 11. Evidence backlog

**The queue future work is drawn from.** Not a feature list — a list of things the project does
not know, ordered by what it would cost to find out and what it unblocks.

Opened 2026-07-23 under the operational-validation directive. It consolidates the unknowns
already recorded in [`08-EVIDENCE-INDEX`](08-EVIDENCE-INDEX.md) (N-01…N-17) and
[`05-RISK-REGISTER`](05-RISK-REGISTER.md) (R-01…R-20) into one ordered queue, and adds the
questions raised by preparing for the first publish.

## Rules for this file

1. **Hand-maintained.** Everything in `reports/` is generated from disk and must never be edited;
   this is judgement about what is missing, which no generator can produce.
2. An item closes when an **observation** closes it, not when someone is confident about it.
   Closing an item means moving it to `08-EVIDENCE-INDEX` with a date and a source.
3. **Prioritise from this file.** A proposal that does not close a backlog item is a new idea, and
   new ideas rank below every item here.
4. An item that cannot state *what would settle it* is not a backlog item, it is an opinion.

---

## Tier A — settled by ONE published interaction

One publish, four checkpoints, one review decision, one 24-hour reading. Nothing here needs
engineering; all of it needs a person at a terminal.

| # | Question | What would settle it | Blocks |
|---|---|---|---|
| EB-01 | Does the publish path work at all? Composer discovery, typing, submit, landed-confirmation, permalink capture — 104 lines, never executed | one publish | N-02, R-10 |
| EB-02 | Was the reply **accepted**, **removed**, or **silently filtered**? | signed-out checkpoint — the only vector that distinguishes filtered from live | N-03, N-04, R-07 |
| EB-03 | Did it receive engagement — votes, replies? | 1h / 24h / 7d checkpoints | N-01 |
| EB-04 | Was any **moderator action** taken? Any **correction** posted beneath it? | 24h / 7d checkpoints, read by eye | R-07 |
| EB-05 | **Did the certification match the outcome?** Argus's verdict versus what actually happened | join `certifications.jsonl` × `drafts.json` × `observations.jsonl` on `draftId` | R-02b |
| EB-06 | How long does a review actually take? | first decision at the prompt — instrumented 2026-07-23, **awaiting its first reading** | N-08 |
| EB-07 | What does a human change about a generated reply? | first `edited` decision — pre-edit text now preserved, awaiting first reading | N-08 |
| EB-08 | Would the operator have posted it **without** automation? Still stand behind it at 24h? | `redbot regret`, both questions | N-09 |
| EB-09 | Does a karma-1 account's first comment survive? | EB-01 + EB-02 together | R-07 |

**All nine are one sitting.** They are listed separately because they close separately: a publish
that lands but is never checked signed-out closes EB-01 and leaves EB-02 open.

---

## Tier B — needs several interactions (the 10-interaction release rule)

| # | Question | What would settle it |
|---|---|---|
| EB-10 | **Approval rate** — how often is a draft publishable with little or no editing? | ~10 decided drafts |
| EB-11 | Is the novelty threshold (70%) right? It has produced one probable false positive | operator decisions on overlapping drafts (N-10, R-13) |
| EB-12 | Is the opportunity floor (40) right? The 60% contribute rate is unvalidated | rejections coded `adds-nothing` (N-11) |
| EB-13 | **Which gates prevented genuine mistakes?** | `gate.block` events versus operator verdicts |
| EB-14 | **Which gates produced false positives?** | drafts blocked that the operator would have posted |
| EB-15 | **Which automated checks never influenced a decision?** — candidates for retirement | gate-firing counts across ~10 reviews |
| EB-16 | What does manual review repeatedly catch that no check does? | the `note` field across ~10 reviews |
| EB-17 | Argus's **false-positive rate** — does it ever return CERTIFIED? | certify a draft that is genuinely sound (N-06c, R-02b) |
| EB-18 | Do Rule 8 and dependency propagation ever change a real verdict? | a run where refutation is incomplete (N-06, N-06b) |

Tier B is the input to Priority 4 ("review the review"). It cannot start before Tier A.

---

## Tier C — needs operating time, not decisions

| # | Question | What would settle it |
|---|---|---|
| EB-19 | **Selector drift rate.** `selector.miss` has never fired, so its sensitivity is unknown | weeks of operation (N-14, R-08) |
| EB-20 | Is the rate-limit envelope (9.5 loads/min) still right? Measured once, months ago | a second sustained run |
| EB-21 | Long-run stability — 2h / 6h / overnight | one long session (N-15) |
| EB-22 | The **behaviour engine has never run live** — 0 `session.start` events; every rate in it is declared and reading speed is a placeholder | `redbot session` (N-12, N-13) |
| EB-23 | Lock/archive detection — no locked thread has ever been opened | open one (N-07, R-18) |
| EB-24 | Moderation behaviour over repeated posting; whether account warming works as ACCOUNT-WARMING predicts | weeks, several replies |
| EB-25 | The DEFECT-03 search-scope fix has **never been exercised in production** — `search` has not run live since | one live `search` |

---

## Tier D — environment and continuity

| # | Question | What would settle it |
|---|---|---|
| EB-26 | Cold start on a clean machine | a second machine (N-16) |
| EB-27 | A second operator running it | a second operator (R-12) |
| EB-28 | `data/` is untracked, unbacked-up, one machine. Evidence loss would be unrecoverable | a backup mechanism that moves append-only logs without moving cookies (R-20) |

---

## Open questions raised by preparing the first publish (2026-07-23)

| # | Question | Status |
|---|---|---|
| EB-29 | **`reply` does not consult `certifications.jsonl`.** A draft Argus REJECTs can reach the approval prompt; the gates do not know Argus exists | **Open — deliberately unbuilt.** Wiring it is architecture, and the directive is measurement. Note that keeping the verdict *out* of the prompt is also what makes EB-05 measurable: if the operator sees the machine verdict, human/machine agreement can no longer be observed independently |
| EB-30 | `redbot reply` with no argument picks the **last** pending draft, which is currently the known-false HRC-001 draft | **Open.** No code change made. Mitigation is operational: reject it at the prompt (which is the intended action anyway — see below) or pass an explicit `draftId` |
| EB-31 | 10 pending drafts predate the current filters. How many would today's pipeline still produce? | Open — re-running `opportunity` over the corpus would answer it |

---

## Instrument limitations — found by audit, 2026-07-23

Evidence Campaign 001 opened with an audit of the instruments *before* the first observation,
because a first datapoint taken with a broken instrument cannot be retaken.

**No code was written for any of these.** Each is recorded with whether the evidence is
recoverable by hand, because recoverable-by-hand means the instrument can wait for evidence that
it needs improving. That evidence would be a campaign where the manual step was skipped or got it
wrong.

| # | Limitation | Recoverable? | Manual procedure for this campaign |
|---|---|---|---|
| ~~EB-32~~ | ~~`observe` records the count of child replies, never their text~~ | **CLOSED 2026-07-23** | `replies[].body` is now captured verbatim and untruncated per checkpoint, per vector. See [`OBSERVATION-SCHEMA.md`](../OBSERVATION-SCHEMA.md) |
| ~~EB-33~~ | ~~Time to first interaction is not derivable~~ | **CLOSED 2026-07-23** | `replies[].renderedAge` keeps Reddit's own string; `replies[].timestamp` the machine-readable form where the markup carries one |
| EB-34 | The presence check falls back to matching **the first 60 characters of the body**. If our reply is removed and another commenter *quotes* it, the quotation can satisfy the match and the comment reads as `present` | **Yes**, by eye | The first sighting must be corroborated manually. Do not let the automated `visible / NOT VISIBLE` line stand alone for EB-02, which is the highest-value item in Tier A |
| EB-35 | `certifications.jsonl` currently holds **3 records for 1 draft** — the same draft certified three times (two resolution-only, one `--override`). Statistics that count *records* rather than *distinct drafts* will report a 3× REJECT rate | n/a — a rule for reading, not a defect | Priority C statistics count **distinct drafts**, and take the **most recent** certification per draft |

## Verified sound, 2026-07-23

- **The Argus join works.** `certifications.jsonl` carries `draftId`, `verdict`, `claims[]`,
  `contradictions[]`, `epistemic[]`, `resolution`, `certifiedAt`, `model`; the one `draftId`
  present joins to `drafts.json`. Priority C (certification vs human decision) needs **no new
  storage** — only the join.
- **Unknown is distinguishable from unmeasured.** `observe` always records a visibility
  observation per checkpoint, so an absent score means "Reddit did not expose one", not "the
  checkpoint never ran".
- **`observe` refuses to interpret.** It records rendered notices verbatim and never writes
  "shadowbanned" or "filtered". Filtering is derived at analysis time from
  visible-signed-in + absent-signed-out. That separation is correct and must be preserved.

## Phase A — 2026-07-23

| Item | Status | Evidence |
|---|---|---|
| **D-01** duplicate decision path | **CLOSED** | `commands/analyze.ts` archived out of the build; `analyzeBatchPrompt`, `Opportunity`, `loadOpportunities`, `saveOpportunities`, `minScoreToPublish`, `minConfidenceToPublish` and the `false-certainty` gate all deleted. `select` and `draft` now read one dataset. **Behavioural proof: `select` went from "0 eligible of 45 analyzed" to "7 eligible of 24 assessed"** — the retired path was masking every eligible candidate |
| **EB-40** `refutationRan` not persisted | **CLOSED** | Optional field on `Certification`, written by `pipeline.ts` from the set the verdict was computed against. Additive; the 4 pre-existing records read `undefined` = "not recorded", never "ran for nothing" |
| **EB-28 / D-04** no evidence backup | **CLOSED** | `redbot backup` — allowlist of 12 files, secret scan that aborts the whole run, sha256 manifest, timestamped snapshots under `~/redbot-evidence-backups`, outside the working tree. Automatic after `certify` and after a successful publish. `doctor` reports snapshot age. First snapshot verified: 9 files, every hash matches |

**Two model self-assessments removed from live decisions**: `opp.confidence` (expertise match) and
`opp.answerableWithoutPitch` (no-pitch check), both replaced by mechanical checks on the thread
itself. D-11's surface is reduced, not eliminated — `fillable` remains.

## Closure log

| Date | Item | Reduced or closed by | Now recorded at |
|---|---|---|---|
| 2026-07-23 | **EB-18** *(Rule 8 · dependency propagation never fired)* — **REDUCED, not closed.** Both fire correctly on real recorded structure. Still unexercised **in production** | ARE-001, perturbations P2 and P3 | E-38 · `qa/ARE-001-RESULTS.md` |
| 2026-07-23 | **EB-17** *(does Argus ever return CERTIFIED?)* — **REDUCED, not closed.** CERTIFIED is reachable from real structure, so the rule layer discriminates. The pipeline has still never certified a real draft, and the P4 input was synthesised | ARE-001, P4 | E-37 |

**Neither closes.** The rule layer is a pure function; production behaviour depends on
extraction, provenance assignment and refutation, none of which this touched.

### Certification #2, 2026-07-23 — `d_c9bd9366f6b9_mrwiupf2`

| Item | Status | Why |
|---|---|---|
| **EB-37** *(does 5/5 authoritative provenance generalise?)* | **ANSWERED — no** | E-48. Cert #2 assigned 1 of 4 falsifiable claims an authoritative class, and `unknown` to three claims overall. The HRC-001 pattern was draft-specific |
| **N-06b** *(dependency propagation never exercised)* | **CLOSED** | E-50. Fired in production, 6 claims invalidated across 3 distinct upstream failures |
| **EB-36** *(refutation miss rate)* | **REDUCED** | E-51. First real instance of refutation completing and returning nothing (c13). Miss rate still unmeasured — c13's correctness is unknown |
| **EB-17** *(does Argus ever CERTIFY?)* | **UNCHANGED** | Both certified drafts REJECT. 2 for 2 |
| **EB-38** *(is ESCALATE sufficient for a false claim?)* | **UNCHANGED** | Cert #2 never reached ESCALATE |

**New, raised by cert #2**

| # | Question | Why it matters |
|---|---|---|
| EB-39 | **Confidence is not conditioned on provenance** — `unknown` provenance with `high` confidence (c12, c17) | E-52. The two fields are assigned independently, so confidence carries no information about whether the model can source the claim. Contained today by Rules 3/5/6, all of which fired |
| EB-40 | **`refutationRan` is not persisted**, so a certification cannot be faithfully replayed from its own record | E-53. The benchmark's core promise is that it replays production. It does — but only because cases now declare the list by hand |
| EB-41 | **Is cert #2's REJECT correct?** 8 fatal contradictions cite primary-documentation and official-implementation, all unverified | Without a human verdict the case is regression-only and contributes nothing to path coverage or calibration |

### Raised by ARE-001, 2026-07-23

| # | Question | Why it matters |
|---|---|---|
| EB-36 | **Refutation's miss rate.** A pass that succeeds and returns zero contradictions is indistinguishable from one that genuinely found nothing — both mark the claim attacked | E-40: with refutation contributing nothing, the known-false draft reaches only ESCALATE. Argus's measured defence against HRC-001 came from refutation, not from the deterministic rules |
| EB-37 | **Does 5/5 authoritative provenance generalise?** If falsifiable claims are routinely assigned authoritative provenance, Rule 4 is dead code in practice | E-39. Measured on n=1. Any second certified draft answers it |
| EB-38 | **Is ESCALATE sufficient for a false claim?** It routes to a human, which is the design — but it says "someone should check", not "this is wrong" | E-40. Answerable only from operator behaviour on escalated drafts |
