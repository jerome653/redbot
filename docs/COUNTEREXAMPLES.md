# Counterexamples

**Phase 15 · 2026-07-23 · ENGINE FILES MODIFIED: 0**

Every certification searched for evidence *against* the Phase 14 aggregation hypothesis. Findings are
listed whether or not they favour the hypothesis.

---

## CE-1 — Two rejections never involve aggregation at all

**Records #0 and #1.** Both rejected by `thread-resolved` with **zero claims extracted**.

The pipeline determined the discussion was already finished, and the certification layer never ran.
There was no claim set, therefore no AND-gate, therefore no aggregation.

**This is a genuine counterexample.** Any statement of the form *"the certification bottleneck is the
AND aggregation"* is false for **2 of 6 records — 33 %**.

Phase 14 noted these records existed but still headlined an unqualified claim. The correct scope is:
*among certifications that reach the certifier*, the bottleneck is the aggregation. Two of six do
not reach it.

## CE-2 — One draft's verdict does change under threshold simulation

**Record #2.** `fatal-contradiction` is its **only** reject-class cause. No `no-provenance`, no
`invalidated-dependency`, no reject-class `overconfident-language`.

Disable or raise the fatal threshold and this record moves — to ESCALATE, not CERTIFIED, because it
retains an escalate-class reason.

**This is a real, if narrow, counterexample to "thresholds change nothing".** Thresholds change
exactly one verdict in six, and never to CERTIFIED.

## CE-3 — Long drafts survive *better*, not worse

| Draft | claims | claims carrying a fatal |
|---|---|---|
| #5 | **7** | **71.4 %** |
| #2 | 12 | 66.7 % |
| #4 | 19 | 31.6 % |
| #3 | 19 | **26.3 %** |

The two 19-claim drafts have the **lowest** failure density; the 7-claim draft has the highest.

This counts *against* any "long replies are punished" theory, and it also weakens the pessimistic
reading of the probability model: if longer drafts genuinely have higher per-claim clean rates, the
`pⁿ` curve overstates how bad the tail is. **n = 4 cannot establish that**, and correcting for it
would be fitting noise — but it is the strongest available evidence against the model's pessimism and
is recorded as such.

## CE-4 — `no-provenance` does no independent work

Removing `no-provenance` from the per-claim reason set changes the clean rate by **exactly zero**
(p stays 0.263). All 3 claims it touches already fail for another reason.

A rule that fires 3 times and never independently determines an outcome is not part of the
bottleneck. Phase 14's rejection analysis listed it among the reject-class causes without noting it
is fully redundant here.

## CE-5 — Reject-class `overconfident-language` is also redundant

Same result: removing it leaves p at 0.263. All 8 claims it touches are already failing.

Note this does **not** make it redundant at the *draft* level — `THRESHOLD-SIMULATION.md` showed
records #4 and #5 reject on it once fatal contradictions are removed. It is redundant for the clean
rate, load-bearing for the verdict. Both are true and they are not in conflict.

---

## Searches that found nothing

**Q: Does any draft have a long clean run?**

| Draft | longest consecutive clean claims |
|---|---|
| #2 | 4 of 12 |
| #3 | 2 of 19 |
| #4 | 2 of 19 |
| #5 | **0 of 7** |

No draft ever managed more than four consecutive clean claims. This is direct, non-probabilistic
evidence for the AND-gate argument — it does not rely on the independence assumption at all.

**Q: Any single-claim draft that could certify trivially?** None exist. The pipeline has never
produced a draft with fewer than 7 claims.

**Q: Any certification with zero fatal contradictions?** Only #0 and #1, which had zero claims.

**Q: Any draft where a fatal contradiction was the *only* per-claim trigger, such that a threshold
change would clean it?** Record #2 at draft level (CE-2), but even there 8 of 12 claims carry a fatal,
so the clean rate would rise to 8/12 — still not close to certifying.

---

## Net effect on the hypothesis

| Hypothesis component | Verdict |
|---|---|
| "AND aggregation is *the* bottleneck" | **Falsified as stated** — CE-1, 2 of 6 records never reach it |
| "Thresholds change nothing" | **Falsified as stated** — CE-2, one verdict does move |
| "Aggregation makes CERTIFIED unreachable for drafts that reach the certifier" | **Survives** — no counterexample found; reinforced by clean-run data and by ESCALATE-class gating |
| "The threshold is not the problem, the aggregation is" | **Falsified as a dichotomy** — see `SENSITIVITY-ANALYSIS.md` |

Three of four components required correction. The core survives in restricted form.
