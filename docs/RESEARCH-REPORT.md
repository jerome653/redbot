# Research report — Phase 15 falsification

**2026-07-23 · ENGINE FILES MODIFIED: 0**

**Hypothesis under test:** *"The certification bottleneck is the draft-level AND aggregation rather
than the contradiction thresholds."*

**Outcome: the hypothesis survives in restricted form. Three of its four components required
correction.** The attempt to break it succeeded partially, which is the useful result.

---

## 1 · Which findings are strongly supported?

| Finding | Evidence | Why it is strong |
|---|---|---|
| **Threshold variants change no verdicts** | ≥2, ≥3, ≥5 fatal, ratio >25 %, >50 % → all 6/6 REJECT | Deterministic recomputation over complete recorded data — not a sample |
| **Rejections are overdetermined** | 3 of 6 fire ≥2 independent reject-class rules; one fires 4 | Counted directly from `reasons[]` |
| **No draft achieves >4 consecutive clean claims** | 4, 2, 2, 0 | Direct measurement; **requires no probability model at all** |
| **73.7 % of claims fail → 100 % of drafts fail** | 42/57 claims, 4/4 drafts | The amplification is measured, not inferred |
| **Removing *every* reject-class rule still cannot reach CERTIFIED** | clean rate 0.368 → P(n=14) = 8.5 × 10⁻⁷ | Escalate-class rules also gate CERTIFIED (`certify.ts:218-231`) |
| **Per-claim clean rate dominates claim count ~40×** | ∂lnP/∂p = 53.2 vs ∂lnP/∂n = −1.335 | Calculus on the model |
| **Verdict entropy = 0.000 bits; claim-level metrics span 45 points** | 26.3 – 71.4 % fatal-carrying | Descriptive fact about this corpus |

**The single strongest item is the clean-run measurement.** It supports the aggregation argument
without any independence assumption, any Monte Carlo, or any model — no draft ever produced more than
four consecutive claims that triggered nothing, and CERTIFIED needs all of them.

---

## 2 · Which findings remain weak?

| Finding | Weakness |
|---|---|
| **"The bottleneck is the aggregation"** | **Falsified as stated.** Records #0 and #1 rejected via `thread-resolved` with zero claims — the certifier never ran. True only for the 4 records that reach it |
| **"The threshold is not the problem"** | **Falsified as a dichotomy.** The aggregation is the exponent; the per-claim failure rate is the base. `fatal-contradiction` alone drives p from 0.263 to 0.491 — a 6,200× change in P |
| **"Thresholds change nothing"** | Record #2 does flip, to ESCALATE |
| **P(CERTIFIED) point estimates** | p = 0.263 from 57 claims, 4 drafts, 1 subreddit. No meaningful confidence interval |
| **Independence of claim failures** | φ = 1.387, χ² = 4.162 on 3 df — not rejected, but the test has near-zero power at 4 drafts |
| **No complexity penalty** | r = −0.959 on n = 4. Ordering is clear, magnitude is noise |
| **Provenance inflation** | 3/3 one direction + benchmark 0/9. Consistent, tiny n |
| **Whether any rejection is correct** | 3 of 57 claims adjudicated, all ruled false. Every *verified* rejection was correct — from three examples |

---

## 3 · What evidence would overturn the aggregation hypothesis?

Stated in advance, so the hypothesis is falsifiable rather than merely plausible.

**O-1 — A draft reaching CERTIFIED or ESCALATE at n ≥ 10.**
The model puts this below 10⁻⁶. One occurrence would falsify the probability argument outright.

**O-2 — A per-claim clean rate above ~0.85 on a new corpus.**
At p = 0.848, P(CERTIFIED) at n = 14 reaches 10 %. If drafts from another domain clean at that rate,
the aggregation is not binding — the claim quality was.

**O-3 — Strong overdispersion at adequate n.**
If failures cluster hard (φ ≫ 1 across ≥15 drafts), some drafts would be near-uniformly clean and
`pⁿ` would badly understate P. The clustered Monte Carlo already shows an 8× effect at n = 7.

**O-4 — Human adjudication ruling most fatal contradictions wrong.**
Then the per-claim failure rate is inflated by a faulty refutation pass, and the bottleneck is
refutation quality, not aggregation.

**O-5 — A short draft (≤5 claims) that still rejects on every claim.**
Would show failure is not diluted by length and the gate is not the issue.

**None of O-1 to O-5 is observed. All are checkable.**

---

## 4 · What single experiment would most reduce uncertainty?

**Adjudicate the 11 candidate claims in `POSITIVE-CANDIDATES.md`, beginning with `#2 c3`.**

These are the claims the engine *declined to attack* — zero contradictions, zero epistemic issues, not
invalidated. Ruling on them resolves more open questions per unit of effort than any other action:

| Outcome | What it establishes |
|---|---|
| Most ruled **true** | The engine's per-claim discrimination is real → the aggregation is confirmed as the binding constraint, and the corpus is not "poor" |
| Several ruled **false** | **False negatives** — the refutation pass misses real errors, and the bottleneck is refutation quality, not aggregation. **This would overturn the hypothesis** (O-4) |
| Mixed | Yields the project's first false-positive *and* false-negative signal simultaneously |

**Every outcome is informative, and one of them falsifies the hypothesis.** That is what makes it the
right experiment rather than merely a useful one.

It also produces the corpus's first claim ruled **true** — the missing denominator behind every
uncomputable metric.

**Cost:** roughly one hour with the existing packet. **Second priority:** finish HRC-001's nine
remaining claims, lifting labelled coverage from 5.3 % to ~21 %.

---

## 5 · Should the engine remain frozen?

**Yes. Unambiguously.**

`ENGINE-FREEZE.md` admits two grounds for unfreezing: benchmark evidence, or human calibration. Two
candidate defects exist — provenance inflation (0/3) and confidence never declaring `low` (0/57).
Both are real signals. **Neither meets the bar**, because both rest on three labelled claims from one
draft adjudicated by one person.

Four further reasons, each independently sufficient:

**Nothing has been shown to be wrong.** Every verified rejection was correct. Three claims were ruled
false; all three received fatal contradictions; all three contradictions correctly identified error
1153. Changing an engine whose only verified outputs are right would be changing it on a hunch.

**The obvious change would not work.** Threshold tuning was simulated exhaustively — zero effect. A
change made now would most likely be the one this analysis has already shown to be useless.

**The correct change is unknown.** The aggregation is the binding constraint for drafts that reach the
certifier, but what should replace it depends on whether the claim-level signal tracks human
judgement — measurable only with adjudication data that does not exist.

**Phase 15 corrected Phase 15's own inputs.** Three of four components of a confidently-stated
hypothesis needed revision after one round of adversarial checking. That is exactly the reliability
level at which freezing is the right policy.

---

## Restated hypothesis

The original wording does not survive. What the evidence supports:

> **Among certifications that reach the certifier, CERTIFIED is unreachable at realistic draft
> lengths, because the draft verdict is a logical AND across claims and the observed per-claim clean
> rate is 26.3 %. The aggregation is the mechanism that converts a 73.7 % per-claim failure rate into
> a 100 % draft failure rate; the per-claim failure rate — dominated by `fatal-contradiction` — is
> what that mechanism amplifies. Threshold variants cannot reach CERTIFIED, and neither can deleting
> every reject-class rule. Whether the 73.7 % is *correct* is unknown: 3 of 57 claims have been
> adjudicated, all were ruled false, and the engine was right about all three.**

---

## Phase 15 status

| Gate | Result |
|---|---|
| Engine files modified | **0** |
| Tests | **182/182** |
| Benchmark · corpus · replay | exit 0 · 0 · 0 |
| Extraction verification | unchanged — 39 verified, 0 deviated |
| Behavioural changes | none |
| Threshold changes | none |
| Aggregation changes | none |
