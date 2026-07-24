# Confidence audit

**Phase 14 · 2026-07-23 · ENGINE FILES MODIFIED: 0**
Source: `confidence` on all 57 claims in `data/certifications.jsonl`; human expectations from
`ground-truth/cases/HRC-001/case.json`.

---

## Declared confidence — all 57 claims

| Confidence | count | share | engine treatment |
|---|---|---|---|
| `high` | **39** | **68.4 %** | — |
| `medium` | 17 | 29.8 % | — |
| `unknown` | 1 | 1.8 % | `CANNOT_STATE_AS_FACT` → `low-confidence-as-fact` |
| `low` | **0** | **0 %** | `CANNOT_STATE_AS_FACT` |

**`low` has never been declared. Not once, across 57 claims.**

The field admits four values and uses two of them for 98.2 % of claims. In practice confidence is
binary: high or medium.

This has a direct consequence. `low-confidence-as-fact` — an ESCALATE-class rule — fires only on
`low` or `unknown`. With `low` never produced and `unknown` appearing once, **the rule fired exactly
once across the entire corpus**. It is very nearly dead code, not because it is wrong but because
nothing upstream ever produces its trigger.

---

## Confidence against provenance strength

| Confidence | Provenance | claims | share |
|---|---|---|---|
| `high` | weak | **23** | **40.4 %** |
| `medium` | weak | 17 | 29.8 % |
| `high` | authoritative | 14 | 24.6 % |
| `high` | none | 2 | 3.5 % |
| `unknown` | none | 1 | 1.8 % |

**The largest single group is high confidence on non-authoritative evidence — 23 of 57 claims.**

Of the 39 claims declaring `high`, only 14 (35.9 %) rest on authoritative provenance. The other 25
assert high confidence on reasoned inference, operator experience, community knowledge, widely
accepted practice — or on nothing at all.

That is the pattern `overconfident-language` exists to catch, and it fired 24 times. It is the
second most frequent rule in the corpus.

---

## Against human verification

Three claims carry a human ruling — the only ones that do.

| Claim | Human expected epistemic state | Argus declared confidence | Human truth |
|---|---|---|---|
| c5 | `explicitly-uncertain` | `high` | **false** |
| c6 | `explicitly-uncertain` | `high` | **false** |
| c7 | `explicitly-uncertain` | `high` | **false** |

**Confidence accuracy: 0 / 3.**

Every claim a human judged should have been hedged was declared with high confidence. All three were
also factually false — the reviewer's note on c7 records it as *"THE central false claim"*.

The pattern is coherent with the provenance finding in `PROVENANCE-AUDIT.md`: on the same three
claims, provenance was inflated 3/3 and confidence was inflated 3/3. **The two fields move together
in the same direction**, which is what one would expect if both are produced by the same pass with no
independent check.

---

## Did the engine catch it anyway?

Yes — but not through the confidence field.

`overconfident-language` fired on all three claims. That rule reads the **epistemic** analysis
(`languageCertainty` versus `supportedCertainty`), not the `confidence` field. The epistemic layer
independently detected that the language outran the evidence, and the benchmark records
`epistemic_hit: 3` of `epistemic_expected: 3` — perfect on the labelled set.

So the picture is:

| Layer | on the 3 labelled claims |
|---|---|
| `confidence` field | **0/3** — declared high where hedging was expected |
| epistemic analysis | **3/3** — correctly identified the overconfidence |
| refutation | **3/3** — fatal contradiction on every one |

**The confidence field is the weakest of the three signals, and the only one that has never been
right.** The engine reaches correct conclusions despite it, via two independent layers that do not
depend on it.

---

## What cannot be concluded

- **No accuracy rate.** 3 of 57 claims labelled is 5.3 % coverage. 0/3 is a direction, not a rate.
- **`low` being unused may be correct.** If no claim in these four drafts genuinely warranted low
  confidence, its absence is accurate rather than a defect. Nothing here distinguishes "the field is
  never used" from "the field is never warranted" — that requires a draft containing genuinely
  speculative claims.
- **No labelled claim exists where Argus declared `medium`.** All three labelled examples are `high`.
  Whether `medium` is used accurately is entirely unmeasured.

**What would settle it:** human epistemic labels on a draft containing a deliberate mix — some
hedged claims, some asserted, some speculative — so that under-confidence and correct confidence
become observable, not just over-confidence.
