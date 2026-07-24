# 9. Roadmap — architectural milestones

Not features. Each milestone answers: why it exists · what evidence justifies it · dependencies ·
risks · success criteria.

**Ordering rule:** a milestone may not start while a cheaper milestone would produce evidence
that could change it. That rule alone reorders most of this list.

---

## M0 · First published interaction ⛔ **blocks everything below**

**Why.** 0 replies published, ever. Nine of seventeen evidence holes collapse to this one fact,
and every threshold in the system is calibrated against nothing.

**Evidence justifying it.** N-01 through N-09. The publish path (104 lines) has never executed.
`reviews.jsonl` and `regret.jsonl` are empty. The signed-out observation vector — the only check
that detects the failure mode ACCOUNT-WARMING describes — has never run.

**Dependencies.** A candidate draft that survives Argus. The staged one was correctly rejected by
both human certification and Argus.

**Risks.** Removal or silent filtering is *expected* at karma 1 — that is a data point, not a
failure. A suspension means stop.

**Success criteria.**
- one reply published, permalink captured
- observed at immediate / 1h / 24h / 7d, **including signed-out**
- one operator review record with a reason code
- one Human Regret reading at 24h

**Cost:** one command and a keystroke. **This is the highest-leverage work available and it is
not engineering.**

---

## M1 · Argus discriminates, not just rejects

**Why.** Both real verdicts are REJECT. A certification engine that has never certified anything
has not been shown to discriminate; the false-positive rate is unknown.

**Evidence.** E-32 (REJECT on 16 fatal contradictions — genuinely good), N-06c (never returned
CERTIFIED), N-06 (Rule 8 never fired), N-06b (dependency propagation never exercised).

**Dependencies.** A draft that is actually sound. May require drafting against a thread where the
answer is a matter of documented fact rather than diagnosis.

**Risks.** If Argus rejects a sound draft, the rules are too strict and the cost is invisible —
good replies never reach a human. That failure mode leaves no trace, which is what makes it
dangerous.

**Success criteria.** At least one CERTIFIED and one ESCALATE on real drafts, each reviewed by a
human who agrees with the verdict.

---

## M2 · Independent evidence verification

**Why.** Provenance is self-declared and was inflated on the first real run (E-25): the model
claimed `official-implementation` for a false claim. Refutation caught it (E-35), but refutation
is also a model.

**Evidence.** E-25, E-35, R-03, D-21. Two model-driven layers, neither externally grounded.

**Dependencies.** M1 — knowing Argus's false-positive rate first, because adding a stricter check
to an already-over-strict engine compounds the invisible failure in M1's risk.

**Risks.** Web verification introduces latency, flakiness and a new trust problem (a search result
is not a specification). It could easily make things worse.

**Success criteria.** For a claim class where documentation exists, provenance is confirmed
against a real source rather than asserted — and the verification demonstrably changes at least
one verdict that would otherwise have been wrong.

---

## M3 · Threshold calibration from operator data

**Why.** Novelty 70%, opportunity floor 40, confidence floor 70, contribute rate 60% — every one
declared. One novelty block has already been judged a false positive by a human.

**Evidence.** N-08, N-10, N-11, D-19, and the open novelty false positive.

**Dependencies.** **M0, repeated.** Needs a body of operator decisions — the release rule's ten
interactions is the stated bar.

**Risks.** Calibrating on a small sample is worse than not calibrating: it converts an honest
guess into a false measurement.

**Success criteria.** Ten reviewed interactions; at least one threshold moved *because* the data
said so, with the before/after recorded.

---

## M4 · Configuration extracted from code

**Why.** `PILOT_SUBREDDITS`, the competence vocabulary, `expertise[]` and the brand are
deployment facts sitting in source. Every one has already required a code edit during normal
operation.

**Evidence.** D-08, and section 4's finding that ~640 lines are configuration wearing code's
clothes.

**Dependencies.** None. This is the only milestone here with no prerequisite.

**Risks.** Very low. Mechanical.

**Success criteria.** Changing the target subreddits or the competence vocabulary requires editing
data, not TypeScript.

---

## M5 · Adapter seam (`Discussion` / `Publisher` / `Identity`)

**Why.** ~68% of the codebase is already platform-neutral, but `Thread`, `Comment` and `Draft` are
Reddit-shaped types used everywhere, and the pipeline calls `reddit/scrape.ts` directly.

**Evidence.** Section 4's measurement: 12% Reddit-specific, 68% general, no seam.

**Dependencies.** **A real second platform being wanted.** There is none in view.

**Risks.** Doing this now is architecture for an unevidenced future — precisely what the
engineering rules forbid. An interface designed against one implementation is usually wrong.

**Success criteria.** *Not started until a second adapter is actually requested.* Listed here so
the debt is visible, not so it gets built.

---

## M6 · Evidence durability

**Why.** All 31 proven observations live in gitignored files on one machine with no backup.

**Evidence.** D-04. The `data/` directory cannot be committed (DEFECT-01) and has no alternative.

**Dependencies.** None.

**Risks.** Any backup mechanism must not reintroduce the credential-leak risk that made `data/`
gitignored in the first place. That constraint is the whole problem.

**Success criteria.** The append-only evidence logs survive a machine loss, without session
cookies or credentials leaving the machine.

---

## Explicitly NOT on the roadmap

Each of these would be momentum, not evidence.

| Not doing | Why |
|---|---|
| **Veritas**, or any further certification layer | Argus has two real runs. A second truth system before the first is calibrated is building on an unmeasured foundation |
| More Reddit features | The system already reads, ranks, drafts and gates more than it has ever published |
| Scheduling / automation / dashboards | Nothing runs unattended, and the human boundary is the product |
| Multi-account or fleet work | The release rule is explicit: not until the single-account pilot produces evidence |
| Prompt improvements | Every fix that held was mechanical; every prompt revision that was tried did not |
| Behaviour-engine expansion | 0 live sessions. Extending an unvalidated model is the definition of momentum |

---

## The ordering, stated plainly

**M0 → M1 → (M2, M3) → M4 → M6**, with **M5 parked indefinitely.**

M4 and M6 are cheap and independent and could happen at any point. Everything else waits on
M0, because until something is published, this project is a very well-tested hypothesis.
