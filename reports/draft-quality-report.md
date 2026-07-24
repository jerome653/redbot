# Draft Quality Report

**Generated:** 2026-07-23 · **Drafts on record:** 12

## The contract

Every Phase 3 draft must state three things before it is shown to anyone:

1. **why this thread is worth replying to**
2. **what new information the reply contributes**
3. **why the reply is better than remaining silent**

The model may decline. Declining is recorded as `draft.declined` and is a correct outcome —
a thread with nothing to add should produce no draft.

The third statement is not taken on trust. `whatNew` and the body are both tested against the
claims the gap analyzer extracted **before** the draft existed. Overlap at or above
**70%** of a claim's content words marks the draft a restatement and blocks publishing.

> The overlap test is a **proxy** and is labelled as one everywhere it appears. It compares
> content words. Two sentences can share vocabulary and mean opposite things. What it reliably
> catches is a reply walking back over the thread's own ground in the thread's own words.

## Totals

| | |
|---|---|
| Drafts | 12 |
| Carrying a stated contribution | 3 (3/12 (25%)) |
| Clean against the safety linter | 12 (12/12 (100%)) |
| Flagged as restating the thread | 1 (1/12 (8%)) |

## Operator verdicts

| | |
|---|---|
| Decided | 0 |
| Approved as written | 0 |
| Approved after editing | 0 |
| Rejected | 0 |
| **Publishable rate** (approved + edited) | no data (0 samples) |
| **As-written rate** (no editing at all) | no data (0 samples) |
| Mean text retained through an edit | no data (0 samples) |

> **No draft has been decided at the Phase 3 prompt yet.** The success criterion "replies a
> human is willing to publish with little or no editing" is therefore **unmeasured**, and no
> figure in this section should be quoted as if it were.

## Per-draft

| Draft | Status | Words | Specificity | Hedges | Craft blocks | Lint | Novelty | Contribution |
|---|---|---|---|---|---|---|---|---|
| `d_ac82fb88ec9d_mrv` | pending | 177 | 21 (1t) | 1 | 0 | 0 | — | no |
| `d_b5a8b0185c8d_mrv` | pending | 187 | 23 (0t) | 1 | 0 | 0 | — | no |
| `d_cff7a2fef080_mrv` | pending | 279 | 28 (1t) | 1 | 0 | 0 | — | no |
| `d_caf810a0f003_mrv` | rejected | 342 | 46 (0t) | 1 | 0 | 0 | — | no |
| `d_2fc9b9ee57cc_mrw` | pending | 275 | 10 (0t) | 1 | 0 | 0 | — | no |
| `d_f0d72e0a6fce_mrw` | pending | 256 | 8 (0t) | 2 | 0 | 0 | — | no |
| `d_c14d9d8caa0e_mrw` | pending | 45 | 13 (0t) | 1 | 0 | 0 | — | no |
| `d_33d71cad1566_mrw` | pending | 263 | 15 (0t) | 3 | 0 | 0 | — | no |
| `d_7e004a295811_mrw` | rejected | 244 | 2 (0t) | 2 | 1 | 0 | — | no |
| `d_4a45dca4edf4_mrw` | pending | 226 | 3 (0t) | 1 | 0 | 0 | 0 | yes |
| `d_c9bd9366f6b9_mrw` | pending | 251 | 22 (1t) | 1 | 0 | 0 | 2 | yes |
| `d_f11d8de68709_mrw` | pending | 171 | 9 (0t) | 2 | 0 | 0 | 0 | yes |
