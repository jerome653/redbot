# RQ-04 — When a claim attracts several contradictions, are they distinct evidence?

**Open Research · 2026-07-23 · ENGINE FILES MODIFIED: 0**

**Question:** 37 claims carry more than one contradiction; some carry five. If those contradictions
restate each other, the apparent weight of evidence against a claim is inflated, and the fatal counts
in Phases 14–15 overstate the case against every rejected draft.

Nobody had tested this.

---

## Hypothesis

*H:* the refutation pass generates redundant contradictions — near-restatements that inflate apparent
evidence without adding information.

If true, this would be a **defect**: `fatal-contradiction` fires per contradiction, and Phase 14
counted 38 fatal contradictions across 24 claims. Redundancy would mean the real evidence base is
smaller than the counts suggest.

## Method

For every claim with ≥2 contradictions, compared each pair by **Jaccard similarity over lowercase
alphabetic tokens of length ≥4** drawn from the `statement` field. 144 pairs across 37 claims.

## Finding — hypothesis FALSIFIED

| Metric | Value |
|---|---|
| Claims with >1 contradiction | 37 |
| Pairs compared | 144 |
| **Mean Jaccard similarity** | **0.080** |
| Pairs > 0.5 | **0** |
| Pairs 0.3 – 0.5 | **0** |
| Pairs 0.15 – 0.3 | 5 |
| Pairs < 0.15 | **139 — 96.5 %** |

**No pair exceeded 0.3 similarity.** The contradictions are lexically distinct.

### The four most similar pairs, inspected by hand

| sim | claim | kinds | verdict on distinctness |
|---|---|---|---|
| 0.237 | c11 | counterexample vs known-exception | **distinct mechanisms** — packet-limit *abort* (ERROR 1153) vs non-strict-mode *column truncation*. Two different MySQL behaviours |
| 0.208 | c14 | counterexample vs counterexample | **distinct tools** — GSC URL Inspection live-fetch vs Screaming Frog parsing X-Robots-Tag |
| 0.200 | c8 | counterexample vs counterexample | **distinct layers** — `mysql` CLI abort-on-error vs `mysqldump --extended-insert` packet sizing |
| 0.179 | c5 | alternative-explanation vs counterexample | **distinct arguments** — violation *type* vs violation *duration* |

Even the highest-similarity pairs make genuinely different arguments. The shared tokens are domain
vocabulary (`mysql`, `packet`, `truncation`), not shared reasoning.

### Repeated kinds are not repeated content

11 of 37 multi-contradiction claims (29.7 %) carry two contradictions of the *same kind*. That looked
like a redundancy signal, and inspection shows it is not: c14's two `counterexample` entries cite
different tools, c8's cite different layers of the stack.

**Kind repetition is not evidence duplication.**

## Interpretation

The refutation pass produces 1.11–2.68 contradictions per claim, and they are substantively
different attacks. The evidence counts in Phases 14–15 are **not** inflated by duplication.

This is a positive result for the engine and it narrows the space of explanations for the 100 %
rejection rate: the drafts are not being rejected by the same objection counted repeatedly.

## Confidence

**Medium-high.**

The measurement is complete (all 144 pairs, no sampling) and the result is unambiguous at the lexical
level. Confidence is capped below "high" because **Jaccard token overlap is a weak proxy for semantic
distinctness** — two statements can share almost no vocabulary and still make the same point.

The hand-inspection of the top four pairs mitigates this, but four is not 144.

## Assumptions

- Token overlap correlates with semantic overlap. Weakly true; the direction (near-zero overlap) is
  more reliable than the magnitude.
- The `statement` field carries the substance of a contradiction. Verified by reading samples.

## Threats to validity

- **The proxy is lexical, not semantic.** A model-based similarity check would be stronger, and
  would require a model call — introducing exactly the kind of unverified judgement this project
  avoids in measurement.
- Single domain: MySQL/WordPress/SEO vocabulary is unusually rich in distinguishing terms
  (error codes, tool names), which may inflate apparent distinctness relative to a vaguer domain.
- n = 4 drafts.

## Alternative explanations

- *Low overlap because contradictions are verbose and share little vocabulary by chance.* Possible,
  but the hand-inspection found substantive distinctness in all four checked pairs, which is not what
  chance would predict.

## How to prove this wrong

Take the 37 multi-contradiction claims and have a human judge, for each pair, whether the two
contradictions make the same point. If a material fraction do, the lexical proxy is misleading and
the fatal counts are inflated. **This has not been done** and is a legitimate small adjudication task
— roughly 144 pairwise judgements, or a sampled subset.
