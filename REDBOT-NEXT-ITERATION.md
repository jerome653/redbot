# REDBOT — next iteration

Prioritised engineering work only. No implementation, no code, no features.

**Baseline:** 2026-07-23 · 55 modules · 9,462 lines · 169 tests · **0 replies published**
**Full review:** [`docs/`](docs/) — architecture · components · lessons · portability · risks ·
debt · maturity · evidence · roadmap · stop-building check

**Prioritisation rule:** by evidence, not enthusiasm. An item ranks by how much it would change
what we *know*, divided by what it costs. Anything that adds capability without adding knowledge
ranks below everything that adds knowledge.

---

## Tier 0 — blocks everything

### 0.1 · Publish one reply and record its outcome
**Not engineering.** One command, one keystroke, four observations.

**Justification:** N-01…N-09. Nine of seventeen evidence holes are the same hole. Every threshold
in the system — novelty 70%, opportunity floor 40, confidence floor 70, contribute rate 60% — is
declared and calibrated against nothing. The publish path (104 lines) has never executed.

**Until this happens, every item below is speculative**, including the ones that look like pure
engineering. There is no substitute and no cheaper source of the same evidence.

**Done when:** permalink captured · four checkpoints including **signed-out** · one review record
with a reason code · one Human Regret reading at 24h.

---

## Tier 1 — highest leverage, cheap, unblocked

### 1.1 · Audit every model self-assessment field against one rule
**Evidence:** D-11, and four separate failures — `fillable` 97% true (E-14), `alreadyAnswered`
missed an explicit UPDATE (E-22), `headroom` disagreed with its own gaps twice, `evidenceClass`
inflated to `official-implementation` for a false claim (E-25).

The rule was discovered four times and applied three times, locally. **`fillable` is still read
and still meaningless.** This is a single audit pass over every field where a model grades its own
output, applying: *ask for observations, compute verdicts in code.*

**Why now:** it is the most repeated failure pattern in the project's history and the only one
that has recurred after being "fixed".

### 1.2 · Retire one of the two decision paths
**Evidence:** D-01, E-17. `analyze`/`analysis.json` and `opportunity`/`assessments.json` both
answer "is this thread worth replying to", and `gates.ts` accepts either. This already caused a
defect where every thread on the newer path was silently unpublishable.

**Why now:** it has already failed once, invisibly. Two sources of truth for one decision drift by
default, and the second failure will be harder to see than the first.

### 1.3 · Back up the evidence without leaking credentials
**Evidence:** D-04. Thirty-one proven observations, every defect trace, all telemetry — gitignored,
one machine, no backup. The gitignore is correct (DEFECT-01) and there is no alternative.

**Why now:** cheap, unblocked, and the loss is unrecoverable. The design's entire justification is
traceable to these files.

**Constraint that makes it non-trivial:** any mechanism must move the append-only evidence logs
without moving session cookies or credentials.

### 1.4 · Move deployment configuration out of source
**Evidence:** D-08, section 4. `PILOT_SUBREDDITS`, the competence vocabulary, `expertise[]` and the
brand are ~640 lines describing *a WordPress consultancy on Reddit* rather than a system. Every one
has already required a code edit during normal operation.

**Why now:** no dependencies, mechanical, and it is the only portability work justified today.

---

## Tier 2 — needs Tier 0 evidence first

### 2.1 · Establish Argus's false-positive rate
**Evidence:** N-06c, R-02b. Both real verdicts are REJECT. A certification engine that has never
certified anything has not been shown to discriminate.

**The failure mode this addresses is invisible:** a truth layer that rejects sound replies leaves
no trace. Nothing in the system would report it.

**Blocked by:** needing a draft that is genuinely sound — which needs threads that are still open,
which is Tier 0's collection loop.

### 2.2 · Exercise the unexercised verdict paths
**Evidence:** N-06 (Rule 8 never fired), N-06b (dependency propagation never ran — `invalidated: 0`
because every downstream claim was independently refuted).

Both are correct code with zero production exposure. They are the parts of Argus that would matter
when refutation is *incomplete*, which is exactly the case Rule 8 exists for.

### 2.3 · Calibrate one threshold against operator data
**Evidence:** N-10, N-11, D-19, and the open novelty false positive — a good draft blocked at
88%/80% overlap because it referenced thread facts to build on them.

**Blocked by:** ten reviewed interactions, per the release rule. Calibrating on fewer converts an
honest guess into a false measurement.

---

## Tier 3 — justified, not yet

### 3.1 · Independent evidence verification
**Evidence:** E-25, E-35, R-03, D-21. Provenance is self-declared and was inflated. Refutation
caught it — but refutation is also a model, and its miss rate is unmeasurable without a false
claim that survives it.

**Deliberately after 2.1.** Adding a stricter check to an engine whose over-strictness is unmeasured
compounds an invisible failure. Verification also introduces its own trust problem: a search result
is not a specification.

### 3.2 · Validate the behaviour engine, or stop maintaining it
**Evidence:** N-12, N-13. 346 lines, 15 tests, **0 live sessions**. Every rate declared; reading
speed a placeholder.

This is a genuine fork: run it live and measure it, or acknowledge it as unvalidated and freeze it.
What should not continue is extending it — that is the clearest case of effort spent where no
evidence exists to spend it against.

---

## Explicitly not next

| | Why |
|---|---|
| **Veritas or any further certification layer** | Argus has two real runs and an unknown false-positive rate. A second truth system before the first is calibrated is building on an unmeasured foundation |
| **The adapter seam (`Discussion`/`Publisher`/`Identity`)** | ~68% of the code is already platform-neutral, but there is no second platform in view. An interface designed against one implementation is usually wrong. Parked until a second adapter is actually wanted |
| **More Reddit features** | The system reads, ranks, drafts and gates far more than it has ever published |
| **Scheduling, automation, dashboards, multi-account** | Nothing runs unattended; the human boundary is the product; the release rule forbids fleet work before the single-account pilot produces evidence |
| **Prompt improvements** | Every fix that held was mechanical. Every prompt revision tried for DEFECT-07 and DEFECT-12 did not hold |
| **Reducing the report surface** | 841 lines is disproportionate but harmless. Watch it; do not spend the iteration on it |

---

## The one-line summary

**Publish once, record one human verdict, then audit the model-self-assessment pattern and retire
the duplicate decision path.**

Everything else in this document is either waiting on that evidence or is cheap maintenance that
can happen alongside it.

The project built the hard half first — deciding whether a contribution deserves to exist — and
did it well. The easy half, actually making one and learning from it, is undone, and no further
building substitutes for it.
