# External validity

**Phase 15 · 2026-07-23 · ENGINE FILES MODIFIED: 0**

What the corpus can and cannot support. Every conclusion from Phases 14–15 is sorted into
**supported**, **unsupported**, or **speculative**.

---

## The corpus, measured

| Dimension | Value |
|---|---|
| Distinct drafts | **4** |
| Certification records | 6 (2 with zero claims) |
| Total claims | 57 |
| Contradictions | 119 |
| Contradiction kinds observed | **7 of 10** — `version-mismatch`, `scope-error`, `causal-error` never produced |
| Claim types observed | 9 |
| Subreddits | **1 — r/Wordpress** |
| Domain | WordPress / SEO / WooCommerce only |
| Human-labelled claims | **3** — 5.3 % of certification claims, 9.7 % of ground-truth corpus claims |
| Claims labelled **true** | **0** |
| Adjudicators | **1** |
| Verdicts other than REJECT | **0** |

---

## Supported — the evidence carries these

**S-1 · Threshold variants change no verdicts.**
Deterministic recomputation over recorded reasons; every variant tested gives 6/6 REJECT.
Confidence: **high**. This is arithmetic over complete data, not inference.

**S-2 · Rejections are overdetermined.**
Three of six certifications fire two or more independent reject-class rules; one fires four.
Counted directly from `reasons[]`. Confidence: **high**.

**S-3 · No draft achieves more than four consecutive clean claims.**
Directly measured: 4, 2, 2, 0. Requires no probability model. Confidence: **high**.

**S-4 · 73.7 % of claims fail; 100 % of drafts reaching the certifier fail.**
The amplification from claim to draft is measured, not modelled. Confidence: **high**.

**S-5 · Removing every reject-class rule still leaves CERTIFIED unreachable at n = 14.**
Because escalate-class rules also gate CERTIFIED. Recomputed clean rate 0.368 → P = 8.5 × 10⁻⁷.
Confidence: **high** for the mechanism; the probability inherits S-7's caveats.

**S-6 · The per-claim clean rate dominates claim count in determining P(CERTIFIED).**
∂(ln P)/∂p = 53.2 against ∂(ln P)/∂n = −1.335 — a ~40× ratio. Confidence: **high** (this is calculus
on the model, given the model).

**S-7 · Verdict entropy is 0.000 bits while claim-level metrics span a 45-point range.**
Confidence: **high** as a description of this corpus.

---

## Unsupported — claimed at some point, not carried by the evidence

**U-1 · "The certification bottleneck is the AND aggregation."**
False for 2 of 6 records, which never reached the certifier (`COUNTEREXAMPLES.md` CE-1). Correct
scope: *among certifications that reach the certifier*.

**U-2 · "The threshold is not the problem; the aggregation is."**
Rejected as a dichotomy. The aggregation is the exponent, the per-claim failure rate is the base;
they are not competing explanations (`SENSITIVITY-ANALYSIS.md`).

**U-3 · "Thresholds change nothing."**
Record #2 does flip under a threshold change — to ESCALATE (CE-2).

**U-4 · Any statement about precision, recall, or false-positive rate.**
Zero claims labelled true. Unmeasurable by construction, not merely unmeasured.

**U-5 · That the engine "over-rejects".**
Requires knowing a rejection was wrong. All three adjudicated claims were ruled **false**, and all
three received fatal contradictions — every verified rejection to date was **correct**.

**U-6 · That the corpus is "poor".**
Equally unsupported. Nothing distinguishes "these four replies genuinely contained errors" from
"the engine attacks everything". This was the phase's originating question and it remains open.

---

## Speculative — plausible, explicitly not established

**P-1 · Longer drafts have higher per-claim clean rates.**
corr(claims, fatal-ratio) = −0.959, but on n = 4. A single short draft drives it. Direction is
suggestive; magnitude is noise.

**P-2 · The three unobserved contradiction kinds indicate corpus narrowness rather than prompt gaps.**
Plausible — all four drafts are WordPress/SEO — but untestable without a draft from another domain.

**P-3 · A claim-level metric would better track human judgement.**
It discriminates better over observed data (`INFORMATION-LOSS.md`), but nothing links it to human
judgement at n = 3.

**P-4 · Provenance inflation is systematic.**
3/3 in one direction plus benchmark `provenance_correct: 0/9`. Consistent, small-n.

**P-5 · That claim failures are independent.**
χ² = 4.162 on 3 df, φ = 1.387 — not rejected, but the test has almost no power at 4 drafts.

---

## The dominant threat to validity

**Single-domain, single-adjudicator, zero positive labels.**

Every claim in this corpus concerns WordPress, SEO or WooCommerce. Every human label was produced by
one reviewer, on one draft, and every one returned `false`.

That combination means the corpus can demonstrate the engine catches bad claims — and can never,
in its current state, demonstrate anything about good ones. **The most important number in the
project has no denominator.**

---

## What the corpus would need

| To support | Requires |
|---|---|
| A false-positive rate | ≥1 claim a human rules **true** |
| A recall estimate | ≥20 labelled claims across ≥2 drafts |
| Domain generalisation | ≥1 draft outside WordPress/SEO |
| Independence testing with any power | ≥15 drafts |
| Adjudicator reliability | ≥2 independent reviewers on the same claims |
| Verdict entropy > 0 | one non-REJECT outcome on real input |

None of these is an engineering task.
