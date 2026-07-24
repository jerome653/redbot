# Sensitivity analysis

**Phase 15 · 2026-07-23 · ENGINE FILES MODIFIED: 0**

AND-aggregation held fixed. One variable moved at a time. **This section produced the strongest
challenge to Phase 14's framing.**

Baseline: n = 14 claims (observed mean 14.25), per-claim clean rate p = 0.263 → P = 7.6 × 10⁻⁹.

---

## (a) Vary claim count, p fixed at 0.263

| n | P(CERTIFIED) | vs baseline |
|---|---|---|
| 3 | 1.82 × 10⁻² | ×2.4 × 10⁶ |
| 5 | 1.26 × 10⁻³ | ×1.7 × 10⁵ |
| 7 | 8.74 × 10⁻⁵ | ×1.1 × 10⁴ |
| 10 | 1.59 × 10⁻⁶ | ×2.1 × 10² |
| **14** | **7.64 × 10⁻⁹** | ×1 |
| 20 | 2.54 × 10⁻¹² | ×3.3 × 10⁻⁴ |

## (b) Vary per-claim clean rate, n fixed at 14

| p | P(CERTIFIED) |
|---|---|
| **0.263 (observed)** | 7.6 × 10⁻⁹ |
| 0.400 | 2.7 × 10⁻⁶ |
| 0.500 | 6.1 × 10⁻⁵ |
| 0.600 | 7.8 × 10⁻⁴ |
| 0.700 | 6.8 × 10⁻³ |
| 0.800 | 4.4 × 10⁻² |
| 0.900 | 2.3 × 10⁻¹ |
| 0.950 | 4.9 × 10⁻¹ |

## (c) What would be required

For P(CERTIFIED) ≥ 10 % at n = 14:

**p must reach 0.848 — the per-claim failure rate must fall from 73.7 % to 15.2 %.**

---

## (d) Which variable dominates — the decisive comparison

| Derivative at n = 14, p = 0.263 | value | reading |
|---|---|---|
| ∂(ln P)/∂n | **−1.335** | one extra claim multiplies P by 0.263 |
| ∂(ln P)/∂p | **+53.2** | +0.01 absolute in p multiplies P by 1.686 |

**The per-claim clean rate dominates claim count by roughly 40×.**

A one-point improvement in per-claim clean rate is worth about **0.39 fewer claims** — put the other
way, raising p by a single percentage point buys more than removing two-fifths of a claim, and the
effect compounds.

### This is a partial falsification of Phase 14

Phase 14 concluded: *"The threshold is not the problem; the aggregation is."*

That framing is **wrong as a dichotomy**. The correct statement:

> AND-aggregation makes P(CERTIFIED) **exponentially sensitive** to the per-claim failure rate. The
> aggregation is the amplifier; the per-claim failure rate is the signal being amplified. Asking
> which one is "the problem" is malformed — the exponent and the base are not competing explanations.

Phase 14 was right that *threshold variants* change no verdicts, and right that the aggregation makes
CERTIFIED unreachable. It was wrong to present these as evidence that per-claim failure rates do not
matter. They matter more than anything else, precisely *because* of the aggregation.

---

## (e) Which trigger dominates the per-claim rate?

Removing each per-claim trigger in turn, recomputing p, and re-deriving P at n = 14:

| Trigger removed | new p | P(n = 14) | improvement |
|---|---|---|---|
| *(baseline)* | 0.263 | 7.6 × 10⁻⁹ | — |
| **`fatal-contradiction`** | **0.491** | **4.8 × 10⁻⁵** | **×6,200** |
| `overconfident-language` (escalate-class) | 0.368 | 8.5 × 10⁻⁷ | ×111 |
| `invalidated-dependency` | 0.351 | 4.3 × 10⁻⁷ | ×56 |
| `no-provenance` | 0.263 | 7.6 × 10⁻⁹ | ×1 — none |
| `overconfident-language` (reject-class) | 0.263 | 7.6 × 10⁻⁹ | ×1 — none |
| **ALL reject-class rules** | **0.368** | **8.5 × 10⁻⁷** | **×111** |

Three findings:

**1. `fatal-contradiction` is by far the dominant per-claim trigger** — removing it improves P by
6,200×. It affects 24 of 57 claims, more than any other rule.

**2. `no-provenance` and reject-class `overconfident-language` change nothing** — every claim they
touch is already failing for another reason. They are entirely redundant at the per-claim level.

**3. The decisive result — removing ALL reject-class rules still leaves P = 8.5 × 10⁻⁷.**

That third finding is the one that saves the aggregation hypothesis. Even with every REJECT rule
deleted from the engine, CERTIFIED remains unreachable at n = 14, because **ESCALATE-class rules also
block CERTIFIED**. `certify.ts` returns CERTIFIED only when *both* buckets are empty.

No amount of reject-rule tuning reaches CERTIFIED. That is an aggregation property, not a threshold
property, and it survives the strongest attack available in this data.

---

## Summary

| Claim | Status after sensitivity analysis |
|---|---|
| Threshold *variants* change no verdicts | **Confirmed** |
| Aggregation makes CERTIFIED unreachable | **Confirmed** — holds even with all reject rules removed |
| "The threshold is not the problem; the aggregation is" | **Rejected as a dichotomy** — the per-claim rate dominates P by 40× over claim count, and `fatal-contradiction` dominates that rate |
| `no-provenance` is doing work | **Rejected** — fully redundant; removing it changes nothing |

---

## Limits

- p = 0.263 rests on 57 claims from 4 drafts in one subreddit.
- Removing a trigger is simulated by ignoring it in the per-claim reason set. The real engine would
  also re-seed `propagateFailure`, so the `fatal-contradiction` row **understates** the improvement —
  removing fatal contradictions would also remove some invalidations.
- Elasticities are local to n = 14, p = 0.263 and do not extrapolate far.
