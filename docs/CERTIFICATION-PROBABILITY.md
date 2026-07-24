# Certification probability

**Phase 15 · 2026-07-23 · ENGINE FILES MODIFIED: 0**

Monte Carlo estimate of P(CERTIFIED) as claim count grows, using observed claim statistics only. No
engine code was run. 200,000 trials per point, deterministic LCG seed.

---

## The model, and the assumption that could break it

CERTIFIED requires **every claim to trigger nothing** — no fatal contradiction, no missing provenance,
no invalidation, no epistemic issue. Observed pooled clean rate:

**p = 15 / 57 = 0.2632**

The naive model is `P = p^n`, which assumes **claims fail independently**. That assumption is the
weakest link in the Phase 14 argument, so it was tested rather than asserted.

### Independence test

| Draft | clean / claims | rate |
|---|---|---|
| #2 | 4 / 12 | 33.3 % |
| #3 | 4 / 19 | 21.1 % |
| #4 | 7 / 19 | 36.8 % |
| #5 | **0 / 7** | **0.0 %** |

| | |
|---|---|
| Observed clean per draft | 4, 4, 7, 0 |
| Expected under binomial | 3.16, 5.00, 5.00, 1.84 |
| χ² | 4.162 on 3 df |
| Dispersion ratio φ | **1.387** |

φ = 1.387 is mildly above 1, indicating slight clustering, but **is not significant at this sample
size**. Independence is *not* rejected.

**This test is very weak — four drafts, three degrees of freedom.** It is reported because the
assumption needed testing, not because it settles anything. Draft #5 at 0/7 is the point pulling φ
upward, and a single draft cannot establish overdispersion.

---

## Three models compared

Because independence could not be confirmed, two additional models were run:

- **Independent** — every claim clean with p = 0.2632.
- **Clustered** — draw a whole draft, then use *its* clean rate for all n claims. This is **maximal**
  clustering and deliberately favourable to the hypothesis being attacked.
- **Best case** — the best draft ever observed (#4, p = 0.368) applied uniformly.

| n claims | analytic pⁿ | MC independent | MC clustered | best case |
|---|---|---|---|---|
| 3 | 1.82 × 10⁻² | 1.83 × 10⁻² | 2.02 × 10⁻² | 5.00 × 10⁻² |
| 5 | 1.26 × 10⁻³ | 1.05 × 10⁻³ | 2.69 × 10⁻³ | 6.79 × 10⁻³ |
| 7 | 8.74 × 10⁻⁵ | 1.30 × 10⁻⁴ | **6.70 × 10⁻⁴** | 9.21 × 10⁻⁴ |
| 10 | 1.59 × 10⁻⁶ | 0 / 200 k | 0 / 200 k | 4.61 × 10⁻⁵ |
| 15 | 2.01 × 10⁻⁹ | 0 / 200 k | 0 / 200 k | 3.13 × 10⁻⁷ |
| 20 | 2.54 × 10⁻¹² | 0 / 200 k | 0 / 200 k | 2.12 × 10⁻⁹ |
| 25 | 3.20 × 10⁻¹⁵ | 0 / 200 k | 0 / 200 k | 1.44 × 10⁻¹¹ |

```
P(CERTIFIED), log scale
  1e-2  ██▌                     n=3
  1e-3  ██                      n=5
  1e-4  █▌                      n=7
  1e-6  █                       n=10
  1e-9  ▌                       n=15
 1e-12  ▏                       n=20
 1e-15  ·                       n=25
```

---

## What survives the attack

**Clustering helps, and not enough.** At n = 7 the clustered model gives 6.70 × 10⁻⁴ — roughly 8×
better than independent. At n ≥ 10 both models produced **zero certifications in 200,000 trials**.

**Even the best draft ever observed cannot certify at realistic length.** Draft #4 had the highest
clean rate ever recorded (36.8 %). Applied uniformly, a 15-claim draft still certifies with
probability 3 × 10⁻⁷.

**The observed mean draft is 14.25 claims.** At that size, every model agrees the probability is
between 10⁻⁹ and 10⁻⁷.

---

## Where CERTIFIED becomes plausible

| Target P(CERTIFIED) | max claims at p = 0.263 |
|---|---|
| 10 % | **1.7 claims** |
| 5 % | 2.2 claims |
| 1 % | 3.4 claims |

**A draft would need roughly two claims to have a one-in-ten chance of certifying.** The shortest
draft ever produced by this pipeline — 308 characters — yielded seven.

---

## Honest limits of this model

- **p = 0.2632 comes from 57 claims across 4 drafts in one subreddit.** It is a point estimate with
  no confidence interval worth quoting at this n.
- **The model assumes claim count and clean rate are independent.** Phase 14 measured
  corr(claims, fatal-ratio) = −0.959 on n = 4, which if real would mean longer drafts have *higher*
  clean rates — making the tail less brutal than modelled. n = 4 cannot support that correction, and
  applying it would be fitting noise.
- **200,000 trials cannot resolve probabilities below ~5 × 10⁻⁶.** The zeros in the table mean
  "below resolution", not "impossible". The analytic column covers that range.
- **This models the gate, not the truth.** It says nothing about whether the claims *deserved* to
  fail.
