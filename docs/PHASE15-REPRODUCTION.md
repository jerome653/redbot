# Phase 15 — independent reproduction

**Phase 15 · 2026-07-23 · ENGINE FILES MODIFIED: 0**

Every Phase 14 statistic recomputed from `data/certifications.jsonl` and `data/trace.jsonl` by a
**deliberately different method**, then compared.

**Method difference (this matters — a copy would prove nothing):** Phase 14 computed independent
tallies per quantity. Phase 15 rebuilds a single per-claim record carrying an explicit *set of
failure reasons*, then derives every aggregate from that one structure. The two share no code path.
A discrepancy would mean one of them mis-classifies claims.

---

## Reproduction table

| Statistic | Phase 14 | Phase 15 | Match |
|---|---|---|---|
| Total claims | 57 | **57** | ✅ |
| Claims with no fatal contradiction | 33 — 57.9 % | **33 — 57.9 %** | ✅ |
| Claims triggering nothing at all | 15 — 26.3 % | **15 — 26.3 %** | ✅ |
| Fatal-per-claim histogram | 33 / 14 / 7 / 3 | **33 / 14 / 7 / 3** | ✅ |
| Fatal contradictions | 38 | **38** | ✅ |
| Distinct claims carrying a fatal | 24 — 42.1 % | **24 — 42.1 %** | ✅ |
| Epistemic-issue claims | 24 — 42.1 % | **24 — 42.1 %** | ✅ |
| Invalidated claims | 9 — 15.8 % | **9 — 15.8 %** | ✅ |
| No-provenance claims | 3 — 5.3 % | **3 — 5.3 %** | ✅ |
| `overconfident-language` on falsifiable types | 8 — 14.0 % | **8 — 14.0 %** | ✅ |
| Rule firings | fatal 38 · oc 24 · inval 9 · fcwe 7 · noprov 3 · resolved 2 · lcaf 1 | **identical** | ✅ |
| Runtimes (s) | 521 / 894 / 1479 / 1623 | **521 / 894 / 1479 / 1623** | ✅ |
| Per-draft fatal-carrying rate | 66.7 / 26.3 / 31.6 / 71.4 % | **66.7 / 26.3 / 31.6 / 71.4 %** | ✅ |

**No mismatches.** Every Phase 14 figure reproduces exactly.

---

## One quantity Phase 14 did not report

| Statistic | Phase 15 |
|---|---|
| Claims with **zero contradictions of any kind** | **20 — 35.1 %** |

Phase 14's `POSITIVE-CANDIDATES.md` reported **11** claims as having "zero contradictions, zero
epistemic issues, not invalidated". Phase 15 finds **20** with zero contradictions *before* the other
two filters are applied. The two are consistent — 20 have no contradiction; of those, 11 also have no
epistemic issue and are not invalidated.

Recorded because the difference is easy to misread as a contradiction between the phases. It is not.

---

## Per-certification reproduction

| # | claims | contradictions | fatal | fatal-carrying | epistemic | invalidated | fully clean |
|---|---|---|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | 12 | 32 | 16 | 8 — 66.7 % | 1 | 0 | **4** |
| 3 | 19 | 21 | 8 | 5 — 26.3 % | 9 | 6 | **4** |
| 4 | 19 | 51 | 7 | 6 — 31.6 % | 9 | 1 | **7** |
| 5 | 7 | 15 | 7 | 5 — 71.4 % | 5 | 2 | **0** |

The `fully clean` column is new. It is the quantity the CERTIFIED probability actually depends on,
and it shows **draft #5 has zero clean claims** — every one of its seven claims triggers something.

---

## Threshold simulation — re-verified

Recomputed independently, same result:

| Simulated rule | CERTIFIED | ESCALATE | REJECT |
|---|---|---|---|
| current (≥1 fatal) | 0 | 0 | 6 |
| ≥2 / ≥3 / ≥5 fatal | 0 | 0 | 6 |
| ratio > 25 % / > 50 % | 0 | 0 | 6 |
| fatal rule deleted | 0 | 1 | 5 |

---

## Verdict on reproduction

**Phase 14's arithmetic is sound.** No figure required correction.

Whether Phase 14's *interpretation* was sound is a separate question, and Phase 15 answers it
differently — see `RESEARCH-REPORT.md`. Reproducing a number confirms the number, not the conclusion
drawn from it.
