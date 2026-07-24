# Certification distribution

**Phase 14 · 2026-07-23 · ENGINE FILES MODIFIED: 0**
Source: `data/certifications.jsonl` (6 records) · `data/trace.jsonl` (runtimes) — read only.

---

## Per certification

| # | draft | verdict | claims | contradictions | fatal | claims carrying a fatal | epistemic | invalidated | max depth | runtime |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `d_f11d8de68709` | REJECT | **0** | 0 | 0 | 0 | 0 | 0 | 0 | — |
| 1 | `d_f11d8de68709` | REJECT | **0** | 0 | 0 | 0 | 0 | 0 | 0 | 1479 s |
| 2 | `d_f11d8de68709` | REJECT | 12 | 32 | 16 | 8 — **66.7 %** | 1 | 0 | 2 | — |
| 3 | `d_c9bd9366f6b9` | REJECT | 19 | 21 | 8 | 5 — **26.3 %** | 9 | 6 | 3 | 894 s |
| 4 | `d_ac82fb88ec9d` | REJECT | 19 | 51 | 7 | 6 — **31.6 %** | 9 | 1 | 1 | 1623 s |
| 5 | `d_c14d9d8caa0e` | REJECT | 7 | 15 | 7 | 5 — **71.4 %** | 5 | 2 | 1 | 521 s |

Records 0 and 1 extracted **zero claims** and were rejected by `thread-resolved` before extraction
mattered. They are excluded from the aggregates below, which cover the four substantive
certifications.

---

## Aggregates — n = 4

| Measure | mean | median | min | max |
|---|---|---|---|---|
| Claims | 14.25 | 15.5 | 7 | 19 |
| Contradictions | 29.75 | 26.5 | 15 | 51 |
| Fatal contradictions | 9.5 | 7.5 | 7 | 16 |
| Claims carrying a fatal | 6.0 | 5.5 | 5 | 8 |
| **Fatal-claim ratio** | **49.0 %** | **49.2 %** | **26.3 %** | **71.4 %** |
| Epistemic issues | 6.0 | 7 | 1 | 9 |
| Invalidated claims | 2.25 | 1.5 | 0 | 6 |
| Max dependency depth | 1.75 | 1.5 | 1 | 3 |
| Runtime (s) | 1012 | 1187 | 521 | 1623 |

Runtime excludes records with no trace join; across the three timed substantive runs the range is
**8.7 – 27.1 minutes**.

---

## Histograms

**Claims per certification**

```
 6-10   █                1
11-15   █                1
16-20   ██               2
```

**Fatal contradictions per certification**

```
 6-10   ███              3
 11+    █                1
```

**Contradictions per claim**

```
#3   1.11 /claim   ██
#5   2.14 /claim   ████
#2   2.67 /claim   █████
#4   2.68 /claim   █████
```

---

## Provenance distribution — all 57 claims

| Evidence class | count | share | class |
|---|---|---|---|
| `reasoned-inference` | 16 | 28.1 % | non-authoritative |
| `operator-experience` | 12 | 21.1 % | non-authoritative |
| `widely-accepted-practice` | 10 | 17.5 % | non-authoritative |
| `framework-documentation` | 9 | 15.8 % | **authoritative** |
| `observed-runtime-behaviour` | 3 | 5.3 % | **authoritative** |
| `unknown` | 3 | 5.3 % | **no provenance → reject** |
| `community-knowledge` | 2 | 3.5 % | non-authoritative |
| `primary-documentation` | 1 | 1.8 % | **authoritative** |
| `official-implementation` | 1 | 1.8 % | **authoritative** |

**Authoritative 14 (24.6 %) · no provenance 3 (5.3 %) · everything else 40 (70.2 %).**

Three-quarters of all claims rest on evidence the engine does not treat as authoritative.

---

## Confidence distribution — all 57 claims

| Confidence | count | share |
|---|---|---|
| `high` | 39 | **68.4 %** |
| `medium` | 17 | 29.8 % |
| `unknown` | 1 | 1.8 % |
| `low` | 0 | 0 % |

**`low` is never declared.** Confidence is a two-value field in practice.

### Cross-tab — confidence against provenance strength

| | count |
|---|---|
| high / weak provenance | **23** |
| medium / weak | 17 |
| high / authoritative | 14 |
| high / none | 2 |
| unknown / none | 1 |

**23 of 57 claims (40 %) assert high confidence on non-authoritative evidence** — the single largest
cell in the table.

---

## Dependency depth

| Depth | certifications |
|---|---|
| 1 | #4, #5 |
| 2 | #2 |
| 3 | #3 |

Argument structures are shallow. The deepest chain observed is three levels, in the record with the
most invalidated claims (6).

---

## Outliers

- **#4 — 51 contradictions on 19 claims (2.68/claim)** but only 7 fatal. High generation, low
  lethality.
- **#3 — 21 contradictions on 19 claims (1.11/claim)**, the lowest density, yet 6 invalidated claims:
  the only record where dependency propagation did significant work.
- **#2 — 16 fatal on 12 claims**, the highest fatal density observed (1.33 fatal/claim).
- **#5 — 7 claims, 71.4 % fatal-carrying**, the *smallest* draft with the *highest* fatal ratio.
- **#0 and #1 — 0 claims.** Rejected by `thread-resolved`; the extraction and refutation layers never
  had a say. Record #1 nonetheless consumed 1479 s.

---

## Method

Counts read directly from each record's `claims`, `contradictions`, `epistemic`, `invalidated` and
`reasons` arrays. Fatal = `contradictions[].fatal === true`. "Claims carrying a fatal" counts
*distinct* `claimId`s, which is the quantity the verdict actually depends on — several claims attract
more than one fatal contradiction. Dependency depth computed from `dependsOn` with cycle guarding.
Runtimes joined from `data/trace.jsonl` by `runId`, first gate event to `argus.verdict`.
