# Calibration report v3 — executive

**Phase 14 · 2026-07-23 · ENGINE FILES MODIFIED: 0**
Evidence: `CERTIFICATION-DISTRIBUTION.md` · `REJECTION-ANALYSIS.md` ·
`CONTRADICTION-DISTRIBUTION.md` · `THRESHOLD-SIMULATION.md` · `PROVENANCE-AUDIT.md` ·
`CONFIDENCE-AUDIT.md` · `POSITIVE-CANDIDATES.md`

---

## The question

> Can Argus currently distinguish good replies from bad replies — or does it currently distinguish
> complex replies from simple ones?

**Neither.** The data supports a third answer that was not on the list, and it is more useful than
either.

---

## Answer 1 — it is not punishing complexity

The obvious hypothesis is that longer replies attract more contradictions and therefore reject more
readily. **The data contradicts this, and not weakly:**

| Correlation over the 4 substantive certifications | r |
|---|---|
| claims × contradictions | +0.581 |
| claims × fatal contradictions | −0.203 |
| **claims × fatal-claim ratio** | **−0.959** |

| Draft | claims | claims carrying a fatal |
|---|---|---|
| `d_c14d9d8caa0e` | **7** | **71.4 %** |
| `d_f11d8de68709` | 12 | 66.7 % |
| `d_ac82fb88ec9d` | 19 | 31.6 % |
| `d_c9bd9366f6b9` | 19 | **26.3 %** |

**The shortest draft had the highest failure density; the two longest had the lowest.**

If Argus were a complexity penalty, this ordering would be reversed. It is not.

*Caveat, stated plainly:* r = −0.959 on n = 4 is not a robust estimate. Four points can produce a
near-perfect correlation by accident, and the ordering above rests on a single short draft. The
finding that survives is the weaker, safer one: **there is no evidence of a complexity penalty, and
the raw ordering runs against it.**

---

## Answer 2 — it is not distinguishing good from bad either, because it never says yes

| | |
|---|---|
| Drafts certified | **0 of 4** |
| Drafts escalated | **0 of 4** |
| Drafts rejected | **4 of 4** (6 of 6 records) |

A classifier that emits one label carries no information about its input. On draft-level output
alone, Argus is indistinguishable from a function that returns REJECT.

---

## Answer 3 — the real finding: it discriminates at claim level and destroys it at draft level

**Argus separates claims well. The aggregation then throws that away.**

| Level | discrimination |
|---|---|
| Claim — no fatal contradiction | **33 of 57 — 57.9 %** |
| Claim — triggers nothing at all | **15 of 57 — 26.3 %** |
| **Draft — clean** | **0 of 4 — 0 %** |

Nearly six claims in ten survive refutation untouched. The engine is plainly not attacking
everything. But a draft verdict is a logical **AND** across every claim: `certify.ts` returns REJECT
if *any* reject-class reason exists, with no threshold, count or ratio.

With a per-claim clean rate of 26.3 %:

| Draft size | P(all claims clean) → CERTIFIED |
|---|---|
| 7 claims | 8.7 × 10⁻⁵ |
| **14 claims — observed mean** | **7.6 × 10⁻⁹** |
| 19 claims | 9.6 × 10⁻¹² |

**At the observed mean draft size, roughly one draft in 130 million would certify.**

CERTIFIED is not rare. It is **structurally unreachable** for any reply of realistic length. That is
a property of the aggregation, not of the corpus and not of any threshold.

---

## Is the rejection threshold appropriate? — the data-backed recommendation

**The threshold is not the problem, and tuning it would be wasted work.**

Every simulated alternative produces an identical outcome:

| Simulated rule | CERTIFIED | ESCALATE | REJECT |
|---|---|---|---|
| current (≥1 fatal) | 0 | 0 | 6 |
| ≥2 / ≥3 / ≥5 fatal | 0 | 0 | 6 |
| fatal ratio > 25 % / > 50 % | 0 | 0 | 6 |
| **fatal rule deleted outright** | **0** | **1** | **5** |

Rejections are **overdetermined**: three of six certifications fire two or more independent
reject-class rules. Deleting the fatal-contradiction rule entirely — the most aggressive intervention
available — moves one verdict, to ESCALATE, never to CERTIFIED. Propagation was recomputed rather
than assumed; the result held.

**Recommendation: change no threshold.** The binding constraint is the AND-aggregation across claims,
and changing that is a design decision requiring calibration data that does not exist. Adjusting a
number now would be tuning against four drafts in one domain with three labelled claims.

---

## Two defects that are separately evidenced

**Provenance inflation — 0/3 correct, all in the same direction.** Every labelled claim was promoted
across the authoritative boundary (`reasoned-inference` → `primary-documentation` /
`official-implementation` / `observed-runtime-behaviour`). The benchmark independently reports
`provenance_correct: 0` of 9. Inflation makes the engine *more permissive*, since three rules read
provenance to decide whether evidence is weak.

**Confidence is a two-value field.** `low` has never been declared, across 57 claims; `high` accounts
for 68.4 %, and 23 of 57 claims (40 %) assert high confidence on non-authoritative evidence. The
`low-confidence-as-fact` rule fired once in the entire corpus.

Both are "right verdict, wrong reasons" — the admissible unfreeze category in `ENGINE-FREEZE.md`.
Neither is yet sufficient: n = 3 labelled claims, one draft, one adjudicator.

---

## Confidence in these conclusions

| Conclusion | Confidence | Basis |
|---|---|---|
| Threshold tuning would not change outcomes | **High** | Deterministic recomputation over recorded reasons; propagation modelled; every variant identical |
| Rejections are overdetermined | **High** | Directly counted from `reasons[]` — 3 of 6 have ≥2 independent causes |
| CERTIFIED is structurally unreachable at realistic lengths | **High** for the mechanism, **Medium** for the exact figure | AND-aggregation read from source; the 26.3 % rate is n = 57 claims from one domain |
| The engine discriminates at claim level | **Medium-High** | 57.9 % of claims carry no fatal contradiction — but "not attacked" ≠ "correct" |
| No complexity penalty | **Medium** | Ordering is clear and runs against the hypothesis; r = −0.959 on n = 4 is not robust |
| Provenance is systematically inflated | **Medium** | 3/3 in one direction plus an independent benchmark counter at 0/9 — small n, consistent signal |
| Whether any rejection is *correct* | **None** | Requires human adjudication; 3 of 57 claims have it, all ruled false |

---

## Limitations

- **n = 4 distinct drafts, 6 records, 57 claims, one domain** (WordPress/SEO). Nothing here
  generalises to other subject matter.
- **3 of 57 claims are human-labelled — 5.3 % coverage.** All three were ruled false.
- **No labelled true claim exists**, so the false-positive rate is unmeasurable by construction.
- **Two of six records extracted zero claims** and were rejected by `thread-resolved` before the
  certification layer ran. They are evidence about the pre-filter, not the engine.
- **This analysis counts what the engine recorded.** It does not verify that any contradiction is
  factually correct — citation fidelity was measured separately and by hand at 4 full / 4 partial /
  4 unsupported / 1 unverifiable on n = 13.
- **All simulations are arithmetic over stored observations.** They cannot model how a differently
  prompted refutation pass would behave.

---

## Evidence still missing, in priority order

1. **A claim a human rules TRUE.** The single highest-value missing datum. Without one, precision,
   recall and false-positive rate all remain uncomputable, and "always REJECT" cannot be
   distinguished from a working detector. `POSITIVE-CANDIDATES.md` lists 11 candidates the engine
   itself declined to attack, ranked for adjudication.
2. **The 9 remaining HRC-001 claims.** Completes the first calibration-approved case and lifts
   labelled coverage from 5.3 % to ~21 %.
3. **A draft from a different domain.** Three contradiction kinds — `version-mismatch`, `scope-error`,
   `causal-error` — have never been produced. Whether that is the corpus or the prompt is currently
   undecidable.
4. **Provenance labels on a mixed-evidence draft**, so under-declaration becomes observable rather
   than only over-declaration.
5. **More certifications.** Four drafts is not a distribution. Each costs 9–27 minutes of wall clock.

---

## The one-line answer

**Argus discriminates between claims and does not discriminate between drafts, because a single
failing claim rejects the whole reply — and at the observed per-claim failure rate, no reply of
realistic length can survive that gate. The threshold is not the problem; the aggregation is. And
whether any individual rejection is correct remains unknown, because every claim a human has ever
labelled was false.**
