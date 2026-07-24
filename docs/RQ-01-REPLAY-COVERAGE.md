# RQ-01 — How much does the replay gate actually verify?

**Open Research · 2026-07-23 · ENGINE FILES MODIFIED: 0**

**Question:** `replay exit 0` appears in every phase report as a passing gate. What fraction of the
recorded corpus does it actually re-verify?

---

## Hypothesis

*Implicit in every prior report:* ARE-001 replay validates the deterministic verdict layer against
the certification corpus.

## Method

Read `qa/ARE-001-argus-replay.mjs` and ran it.

## Finding

```js
// qa/ARE-001-argus-replay.mjs:49-60
const richest = new Map();
for (const r of records) {
  const prev = richest.get(r.draftId);
  if (!prev || (r.claims ?? []).length > (prev.claims ?? []).length) richest.set(r.draftId, r);
}
const base = [...richest.values()].sort((a, b) => (b.claims ?? []).length - (a.claims ?? []).length)[0];
```

`richest` reduces 6 records to 4 (one per draft) — then `[0]` takes **the single largest**.

Confirmed by running it:

```
certification records on disk : 6
distinct drafts               : 4
replaying                     : d_c9bd9366f6b9_mrwiupf2
  claims 19 · contradictions 21 (fatal 8) · epistemic 9 · dep-edges 14
```

**Replay verifies exactly one certification record.**

| Scope | Covered | Share |
|---|---|---|
| Certification records | 1 of 6 | **16.7 %** |
| Distinct drafts | 1 of 4 | **25.0 %** |
| Claims | 19 of 57 | **33.3 %** |
| Verdict outcomes exercised | REJECT only | 1 of 3 |

## Interpretation

`replay exit 0` means *"the richest single record still replays to its recorded verdict."* It is a
**spot check**, not corpus-wide verification.

This is not a defect — the harness is named for a single experiment (ARE-001) and its own output
says *"Scope: one draft, rule layer only. Nothing here measures extraction or refutation."* The
finding is that **downstream reporting, including my own in Phases 9–15, cited "replay exit 0"
alongside "182/182" and "benchmark 4/4" as though the three carried comparable weight.** They do not.

## Confidence

**High.** Direct code read plus execution output. No sampling involved.

## Assumptions

- The record selected is stable across runs. Verified: identical stdout hash across 3 runs (RQ-05).

## Threats to validity

- None material. This is a direct measurement of program behaviour.

## Alternative explanations

- *"Replaying one record is sufficient because the verdict layer is deterministic and claim-count
  independent."* Partly true — but records 0/1 exercise `thread-resolved`, and record 2 exercises the
  `humanOverride` path (RQ-03), neither of which the replayed record touches. Those paths are
  replay-unverified.

## How to prove this wrong

Show that ARE-001 iterates over more than one record. It does not: `base` is a single object, and
every downstream computation in the file reads `base.claims`, `base.contradictions`,
`base.epistemic`.

## What this changes

Nothing about the engine. It changes how the gate should be *cited*: replay is 1-of-6 coverage, and
prior reports over-weighted it.
