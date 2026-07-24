# Information loss

**Phase 15 · 2026-07-23 · ENGINE FILES MODIFIED: 0**

How much diagnostic information the pipeline computes, and how much reaches the output.
**Measurement only — no implementation change is recommended.**

---

## The reduction

| | |
|---|---|
| **Input** | 57 claims, each carrying type, provenance, confidence, fatal count, dependency count |
| **Output** | 6 verdicts, **all identical** |

---

## Shannon entropy of what is computed

| Field | bits/claim | × 57 claims |
|---|---|---|
| Per-claim fatal count | 1.597 | **91.1 bits** |
| Provenance class | 2.670 | **152.2 bits** |
| Confidence | 0.997 | **56.9 bits** |
| **Total across these three fields** | | **~300 bits** |

## Shannon entropy of what is emitted

| | |
|---|---|
| Verdict distribution | REJECT × 6 |
| **Entropy** | **0.000 bits** |

A single-valued output carries no information by definition. **Every bit the pipeline computes is
discarded at the verdict.**

That is a property of this corpus, not a permanent property of the design — a corpus containing a
CERTIFIED result would have non-zero verdict entropy. But across every certification ever produced,
the figure is exactly zero.

---

## The claim-level signal that exists but does not survive

| Draft | claims carrying a fatal | verdict |
|---|---|---|
| #2 | **66.7 %** | REJECT |
| #3 | **26.3 %** | REJECT |
| #4 | **31.6 %** | REJECT |
| #5 | **71.4 %** | REJECT |

The claim-level rate varies across a **45-point range** — from 26.3 % to 71.4 %. That is a real,
measured, discriminating signal. Draft #3 is nearly three times cleaner than draft #5 by this
measure.

**The verdict column does not vary at all.**

A hypothetical claim-level metric — the proportion of claims surviving refutation — would separate
these four drafts into a clear ordering. The verdict places them in one bucket.

---

## Would a claim-level metric explain behaviour better?

**By the measurement: yes, and substantially.**

| Metric | distinct values across 4 drafts | range |
|---|---|---|
| Verdict | **1** | none |
| Claims carrying a fatal (%) | **4** | 26.3 – 71.4 |
| Fully clean claims (%) | **4** | 0.0 – 36.8 |
| Fatal contradictions per claim | **4** | 0.37 – 1.33 |
| Contradictions per claim | **4** | 1.11 – 2.68 |

Every claim-level metric tested separates all four drafts. The verdict separates none.

This is a statement about **explanatory power over observed data**, not a recommendation. Whether a
claim-level metric should *replace, supplement, or sit alongside* the verdict is a design question,
and it depends on facts this corpus does not contain — chiefly whether the claim-level rate correlates
with human judgement, which cannot be known until more than 3 of 57 claims are adjudicated.

**A metric that discriminates is not automatically a metric that is correct.** Draft #3 has the lowest
fatal rate; nothing establishes it is the best reply. It may simply be the one whose claims were
hardest to attack.

---

## What the discard costs operationally

The verdict answers "should this be published?" — and for that question, one bit is arguably the
right output. The loss matters for a different question: **"is the engine working?"**

For diagnosis, the 300 bits are the entire signal, and they are currently recoverable only by opening
`data/certifications.jsonl` directly or through the Certifications page. No aggregate view of them
existed until Phase 14 computed one by hand.

---

## Limits

- Entropy computed over three fields only; the records contain more structure (dependency graphs,
  contradiction text, source quotes) not reducible to a simple distribution.
- Entropy measures *variety*, not *usefulness*. High-entropy provenance labels are worth little if
  they are systematically inflated — and `PROVENANCE-AUDIT.md` measured 0/3 accuracy on the only
  labelled claims. **A field can carry many bits and still be wrong in all of them.**
- Verdict entropy is zero because n = 6 and all outcomes match. One CERTIFIED would change it to
  ~0.65 bits. Zero is a fact about this corpus, not a theorem about the design.
