# Phase 16 · 01 — Protocol

**Open Research · run 2026-07-23/24 · written up 2026-07-24 · ENGINE FILES MODIFIED: 0**

This document preserves the pre-registration exactly as it was written, before any result was
read. It is first in the series on purpose: a method chosen after seeing the numbers is not a
method, and the only defence against that is a record of what was decided in advance.

---

## The question

`redbot certify` puts a draft through twelve phases. Four of them are deterministic code
(resolution detection, dependency graph, epistemic calibration, verdict rules) and the rest go
through a model. **Is the whole thing reproducible?**

Everything downstream depends on the answer. Phases 14–15 pool claims across certification
records as though each were an independent observation of the same underlying process. If two
runs of the same draft do not produce the same claims, that pooling is measuring the sampler,
not the drafts.

---

## Why the protocol was extended by one run

The task as posed was: re-run `certify --override d_f11d8de68709`, compare against
Certification Record #2, hold everything else constant. Executed as written, the only
comparison available is **R1 vs Record #2**, and that comparison is confounded — measured, not
suspected:

| Change | Evidence | Direction |
|---|---|---|
| Refutation narrowed to `FALSIFIABLE_TYPES ∪ {inference, best-practice}` | `src/argus/pipeline.ts`, comment dated 2026-07-23 citing *this draft's* 180 s timeouts | fewer refutation calls → fewer contradictions, independent of the model |
| `refutationRan` now persisted (EB-40) | `docs/11-EVIDENCE-BACKLOG.md` CLOSED; field absent from Record #2's key list | schema differs |
| Rule 8 `unrefuted-falsifiable-claim` postdates the record | `docs/08-EVIDENCE-INDEX.md` E-57 | rule set differs |

Record #2 was written 2026-07-22T21:19:56Z. Every file in `src/argus/` has an mtime after that
instant. A difference between R1 and Record #2 therefore **cannot be attributed to the model**
without further evidence.

So one more run was added: **R2, identical command, identical build.** R1 vs R2 is the clean
determinism measurement; R1/R2 vs Record #2 is reported separately and labelled confounded.
That is the minimum change that makes the experiment controlled rather than merely repeated.

---

## Stopping rule — fixed in advance

- **Run R2 unconditionally.**
- **Run R3 only if** R1 vs R2 claim alignment < 100 %, *or* the verdict differs, *or*
  fatal-contradiction counts differ by more than 25 %.
  Rationale: if the pair already disagrees, a third run is needed to say whether the
  disagreement is typical or an outlier. If the pair agrees, a third run buys a tightened
  bound on an interval that is already narrow, at the same cost.
- **No run is discarded for any reason.** Every certification written to
  `data/certifications.jsonl` is reported, including failures, timeouts and partial runs.

> The stopping rule **fired**. R1 vs R2 aligned at 6.3 %. See `PHASE-16-02-DETERMINISM.md`,
> and `PHASE-16-03-BUILD-REPRODUCIBILITY.md` for why R3 as specified turned out to be
> impossible to run.

---

## Measurement decisions fixed in advance

- **Claim alignment:** normalised token Jaccard. Tokens lower-cased, non-alphanumerics
  stripped, tokens of ≤ 2 characters dropped. **same ≥ 0.75**, **related ≥ 0.35**. Greedy
  highest-similarity matching, each claim used once.
- **Contradiction matching:** the same metric within an aligned claim pair; **≥ 0.35** counts
  as the same contradiction.
- Thresholds are arbitrary but declared here, before use, and every table reports the raw
  similarity so a reader can apply a different threshold.
- **"Identical" always means byte-identical.** "Cosmetic" means differing only in wording with
  the same referent and the same enum fields. Anything else is "semantic".

---

## Harness control

Before R1 finished, `compare.mjs` was run on Records #0 vs #1 — two executions of the
deterministic pre-filter path, fifteen minutes apart. Result: verdict, reasons, resolution
block and rule order all byte-identical.

**The harness reports identity where identity exists.** Without this control, a harness that
simply never returns "same" would produce the same headline.

---

## Input identity check

The draft body is unchanged since Record #2: **12 of 12** Record-#2 `sourceQuote` values appear
verbatim in the current `drafts.json` body after normalising quote characters (11 of 12 before
normalising — c4's inner `"…"` was rendered `'…'` by the model).

- Draft body SHA-256 `97aaa1dd…4136`
- `createdAt` 2026-07-22T20:20:36Z, i.e. before Record #2
- Thread title and body unchanged, 7 comments

## Engine fingerprint

79 compiled `.js` files hashed before the first run; manifest SHA-256 `2f0de768…ba23`.
Re-hashed after the last run — **unchanged**, so R1 and R2 ran on the same bytes.

> The rule attached to that fingerprint was: *if the manifest hash changes, every result in
> this phase is void.* That rule is what makes `PHASE-16-03` a finding rather than a
> footnote.

---

## What this protocol cannot establish

One draft. One model (`claude-haiku-4-5-20251001`). One provider path (`claude -p`, the CLI,
which exposes **no temperature control** — so this is sampling at whatever the CLI default is).
Two runs, plus one confounded historical record.

Nothing here estimates a rate. It establishes existence: whether two identical runs can
disagree, and by how much on this instance.
