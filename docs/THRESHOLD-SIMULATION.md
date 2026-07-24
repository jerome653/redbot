# Threshold simulation

**Phase 14 · 2026-07-23 · ENGINE FILES MODIFIED: 0**

**No engine code was changed, executed differently, or re-run.** Every verdict below is recomputed
arithmetically from the reasons already recorded in `data/certifications.jsonl`, using the bucket
logic read from `src/argus/certify.ts`. This is a paper exercise over stored observations.

---

## Result

| Simulated rule | CERTIFIED | ESCALATE | REJECT |
|---|---|---|---|
| **current — ≥1 fatal** | 0 | 0 | **6** |
| ≥2 fatal | 0 | 0 | **6** |
| ≥3 fatal | 0 | 0 | **6** |
| ≥5 fatal | 0 | 0 | **6** |
| fatal-claim ratio > 25 % | 0 | 0 | **6** |
| fatal-claim ratio > 50 % | 0 | 0 | **6** |
| **fatal rule disabled entirely** | **0** | **1** | **5** |

**Every proposed threshold produces exactly the same outcome as the current one.**

Not "similar" — identical. Six rejections, zero certifications, under every variant tested.

---

## Why the thresholds do not matter

`certify.ts` returns REJECT if **any** reject-class reason exists. Loosening the fatal threshold only
suppresses the `fatal-contradiction` reasons; it does nothing to the others, which fire independently:

| # | Reject-class rules | Survives a fatal-threshold change? |
|---|---|---|
| 0 | `thread-resolved` | yes — fatal rule never involved |
| 1 | `thread-resolved` | yes — fatal rule never involved |
| 2 | `fatal-contradiction` only | **no — this is the only one that would flip** |
| 3 | `fatal-contradiction`, `no-provenance`, `invalidated-dependency`, `overconfident-language`(falsifiable) | yes — three other causes |
| 4 | `fatal-contradiction`, `invalidated-dependency`, `overconfident-language`(falsifiable) | yes — two other causes |
| 5 | `fatal-contradiction`, `invalidated-dependency`, `overconfident-language`(falsifiable) | yes — two other causes |

Even the most aggressive intervention — **deleting the fatal-contradiction rule outright** — moves a
single certification, and it moves to **ESCALATE, not CERTIFIED**, because record 2 still carries an
`overconfident-language` reason.

**Zero CERTIFIED under every simulation.**

---

## What would actually be required

CERTIFIED demands an empty reject bucket *and* an empty escalate bucket. Per-claim trigger rates
across the 57 claims:

| Trigger | claims | rate |
|---|---|---|
| carries a fatal contradiction | 24 | 42.1 % |
| has an epistemic issue | 24 | 42.1 % |
| invalidated by a dependency | 9 | 15.8 % |
| `overconfident-language` on a falsifiable type | 8 | 14.0 % |
| no provenance (`unknown` / `unsupported`) | 3 | 5.3 % |
| **triggers nothing at all** | **15** | **26.3 %** |

Because CERTIFIED requires *every* claim to be clean, and the observed per-claim clean rate is
**26.3 %**:

| Draft size | P(all claims clean) |
|---|---|
| 7 claims | 8.7 × 10⁻⁵ |
| 12 claims | 1.1 × 10⁻⁷ |
| 14 claims (observed mean) | **7.6 × 10⁻⁹** |
| 19 claims | 9.6 × 10⁻¹² |

At the observed mean draft size you would expect to certify roughly **one draft in 130 million**.

**CERTIFIED is not rare. It is structurally unreachable at realistic draft lengths**, and no fatal
threshold changes that, because the fatal rule is one of five independent ways for a claim to fail.

---

## The lever that would move the outcome

Not a threshold — the **aggregation**. Currently the draft verdict is a logical AND across claims:
one bad claim rejects the whole reply.

Alternatives exist and none of them is proposed here as a change:

- **Per-claim verdicts surfaced separately**, with the draft verdict as a summary rather than a gate
- **A proportion rule** — reject when more than *k* % of claims fail, rather than when any does
- **Severity weighting** — `counterexample` carries 47 % of all fatal findings while
  `configuration-dependency` carries 5 %; treating them identically is a choice, not a necessity

**This document recommends none of them.** It establishes only that the *threshold* is not the
binding constraint, so tuning it would be wasted effort. What the binding constraint should be is a
design question requiring human calibration data that does not yet exist.

---

## Simulation method, and its limits

For each record: read `reasons[]`, classify each rule into the reject/escalate buckets read from
`certify.ts`, then recompute the verdict under the modified fatal predicate while leaving every other
rule untouched. `overconfident-language` is resolved per claim by checking whether the claim's `type`
is in `FALSIFIABLE_TYPES`.

### Propagation was modelled, not assumed

`invalidated-dependency` is **derived**, not independent: `certify.ts:204` seeds its failure set from
fatal contradictions *and* unsupported claims. A naive simulation that leaves those reasons in place
while suppressing the fatal rule would overstate how much rejection survives.

So the disabled-fatal case was re-run with propagation recomputed from scratch — seeding only from
`NO_PROVENANCE` non-opinion claims, then walking `dependsOn` to fixpoint:

| # | Reject causes with the fatal rule fully disabled |
|---|---|
| 0 | `thread-resolved` — never involved the fatal rule |
| 1 | `thread-resolved` — never involved the fatal rule |
| 2 | **none → ESCALATE** |
| 3 | `no-provenance` ×3, `invalidated-dependency` ×3 (still seeded by the unsupported claims), `overconfident-language`/falsifiable ×3 |
| 4 | `overconfident-language`/falsifiable ×3 — **its `invalidated-dependency` does disappear** |
| 5 | `overconfident-language`/falsifiable ×2 — **its `invalidated-dependency` does disappear** |

Records 4 and 5 lose their propagation reasons exactly as suspected, and reject anyway on
`overconfident-language` over falsifiable claim types. **The result is unchanged: 5 REJECT,
1 ESCALATE, 0 CERTIFIED.**

**Remaining limits, stated plainly:**

- **n = 6 records, 4 distinct drafts, one domain (WordPress/SEO).** These proportions are not
  population estimates.
- The simulation reuses each record's stored contradictions and epistemic issues. It cannot model how
  a *differently prompted* refutation pass would behave — only how the recorded observations would be
  scored under different rules.
- Whether any of these rejections is *correct* is not addressed here and cannot be, without human
  labels. A threshold that produces the right verdicts for the wrong reasons is still wrong.
