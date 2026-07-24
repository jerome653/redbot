# Contradiction distribution

**Phase 14 · 2026-07-23 · ENGINE FILES MODIFIED: 0**
Source: `data/certifications.jsonl` — 119 contradictions across 57 claims in 4 substantive
certifications.

---

## Fatal contradictions per claim

| Fatal count | claims | share |
|---|---|---|
| **0** | **33** | **57.9 %** |
| 1 | 14 | 24.6 % |
| 2 | 7 | 12.3 % |
| 3+ | 3 | 5.3 % |

**Nearly six claims in ten attract no fatal contradiction at all.**

This is the most important number in the phase. The engine is *not* indiscriminate at the claim
level — the majority of claims survive refutation cleanly. Every draft still rejects, because a
draft needs only one failing claim. See `CALIBRATION-REPORT-V3.md` for what follows from that.

---

## Contradiction kinds

| Kind | count | share | fatal | fatal rate within kind |
|---|---|---|---|---|
| `configuration-dependency` | 35 | 29.4 % | 2 | **5.7 %** |
| `counterexample` | 23 | 19.3 % | 18 | **78.3 %** |
| `known-exception` | 20 | 16.8 % | 7 | 35.0 % |
| `alternative-explanation` | 18 | 15.1 % | 7 | 38.9 % |
| `edge-case` | 14 | 11.8 % | 2 | 14.3 % |
| `version-difference` | 5 | 4.2 % | 1 | 20.0 % |
| `contradictory-documentation` | 4 | 3.4 % | 1 | 25.0 % |

### The dominant kind is nearly harmless; the lethal kind is a minority

`configuration-dependency` is the **most common** kind (29.4 %) and the **least lethal** (5.7 %
fatal). `counterexample` is only 19.3 % of contradictions but carries **78.3 %** of its own kind to
fatal — and accounts for **18 of the 38 fatal contradictions**, nearly half.

Ranked by contribution to actual rejections:

| Kind | fatal contributed | share of all fatal |
|---|---|---|
| `counterexample` | 18 | **47.4 %** |
| `known-exception` | 7 | 18.4 % |
| `alternative-explanation` | 7 | 18.4 % |
| `configuration-dependency` | 2 | 5.3 % |
| `edge-case` | 2 | 5.3 % |
| `version-difference` | 1 | 2.6 % |
| `contradictory-documentation` | 1 | 2.6 % |

**A counterexample is the mechanism by which this engine rejects.** Everything else is mostly
commentary — 51 of 119 contradictions (43 %) are `configuration-dependency` or `edge-case`, and
together they produce 4 fatal findings.

---

## Kinds that co-occur on the same claim

| Pair | claims |
|---|---|
| `configuration-dependency` + `known-exception` | 14 |
| `alternative-explanation` + `configuration-dependency` | 13 |
| `alternative-explanation` + `counterexample` | 13 |
| `configuration-dependency` + `counterexample` | 12 |
| `configuration-dependency` + `edge-case` | 11 |
| `edge-case` + `known-exception` | 6 |
| `counterexample` + `edge-case` | 6 |
| `alternative-explanation` + `known-exception` | 6 |
| `alternative-explanation` + `edge-case` | 5 |
| `counterexample` + `known-exception` | 5 |

`configuration-dependency` appears in the top five pairs, in every case as the passenger: it attaches
to claims that already have something else wrong with them. It is a near-constant background,
present alongside almost everything, and it decides almost nothing.

---

## Kinds never observed

`version-mismatch` · `scope-error` · `causal-error`

Three of the ten kinds the schema admits have **never been produced** across 119 contradictions.

Two readings are available and this data cannot separate them:

1. The corpus contains no claims of the shape that would trigger them — plausible, since all four
   drafts are WordPress/SEO advice rather than, say, protocol or API specification work.
2. The refutation prompt does not reliably reach for them.

Distinguishing these requires drafts from a different domain, which is a corpus question rather than
an engine question.

---

## Contradiction density per certification

| # | claims | contradictions | per claim | fatal | fatal per claim |
|---|---|---|---|---|---|
| 2 | 12 | 32 | 2.67 | 16 | **1.33** |
| 3 | 19 | 21 | **1.11** | 8 | 0.42 |
| 4 | 19 | 51 | 2.68 | 7 | **0.37** |
| 5 | 7 | 15 | 2.14 | 7 | 1.00 |

Record 4 generated the most contradictions in absolute terms (51) and had the **lowest fatal rate per
claim** (0.37). Record 2 generated fewer (32) with nearly four times the lethality (1.33).

**Contradiction volume does not predict rejection severity.** The refutation pass produces roughly
1–2.7 observations per claim regardless of outcome; what varies is how many are judged fatal.

---

## Method

Contradictions counted from each record's `contradictions[]`. "Fatal" is `fatal === true` as recorded
by the engine — this document does not re-derive fatality, it counts it. Co-occurrence pairs are
computed per claim id: for each claim, the distinct kinds attached to it, taken pairwise. Kinds never
observed are checked against the set appearing anywhere in the corpus, so a kind absent from the
schema and absent from the data would not be distinguished — the listed three are documented kinds
with zero occurrences.
