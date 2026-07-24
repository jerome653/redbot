# Calibration report v2

**Date:** 2026-07-23 · **Phase 12**
**Calibration approved: 0 of 2 cases. Unchanged from v1.**

---

## The headline, stated plainly

**I did not adjudicate HRC-001, and I will not.**

Phase 12 asked for the first calibration-approved case. Reaching it requires ruling on nine
outstanding claims — deciding whether each is *true*. That ruling is the answer key against which
this engine is scored.

If a language model writes that answer key, the engine is graded by the same class of system it is
meant to audit. Every measurement downstream — precision, recall, false-positive rate, whether
CERTIFIED is appropriate — inherits the grader's errors and correlates with them. The corpus would
still report `calibration approved: 1`, the dashboard would still turn that stage green, and the
number would mean nothing.

The project's own rule, stated in `AGTC.md` and reaffirmed in every phase since:

> Ground truth never originates from a language model.

A green pipeline stage bought by breaking that rule is worth less than an honest red one. **The
milestone is not blocked by capability. It is blocked by design, and the design is correct.**

---

## Current corpus state

| Case | Human verdict | Claims reviewed | Sources | Ground truth | Calibration |
|---|---|---|---|---|---|
| **HRC-001** | `incorrect` (jerome, 2026-07-23) | **3 of 12** | 3 attached | **approved** | pending |
| **CERT-002** | `unlabelled` | **0 of 19** | 0 attached | pending | pending |

`node ground-truth/validate.mjs` → exit 0 · 2 cases · 1 ground-truth approved · **0 calibration
approved** · 0 structural failures.

### What blocks each case

**HRC-001** — one blocker: `3 of 12 claims reviewed`. Everything else is done. The human verdict
exists, three sources are attached, ground truth is approved. **Nine claim rulings stand between this
case and the project's first calibration-approved case.**

**CERT-002** — four blockers: no human verdict, no sources attached, ground truth not approved,
0 of 19 claims reviewed. This case needs the full adjudication pass, not a finishing pass.

---

## What the three existing labels already bought

The three adjudicated claims are not merely progress toward a threshold; they produced findings.

| Measurement | Result | Reading |
|---|---|---|
| Refutation recall | **3 / 3** | every claim a human ruled false received a fatal contradiction |
| Contradiction precision | **3 / 3** | each fatal contradiction independently reconstructed error 1153 / SQLSTATE 08S01 — the same mechanism the reviewer identified |
| Provenance accuracy | **0 / 3** | every claim's evidence class was **inflated** |
| Epistemic accuracy | **0 / 3** | `confidence: high` where the reviewer expected `explicitly-uncertain` |

**Three claims were enough to find a systematic defect.** The engine reaches the correct verdict
through a provenance layer that is wrong in the same direction every time. The benchmark shows the
same shape at larger n: `provenance_correct: 0` of `provenance_declared: 9`.

That is a strong argument for finishing HRC-001: at n=3 the labels have already paid for themselves.

---

## The gap that nine more labels will not close

**Every adjudicated claim so far is false.** All three. And the reviewer's notes make clear the
remaining nine are drawn from the same failing draft.

A corpus composed entirely of false claims can demonstrate that the engine catches bad claims. **It
can never demonstrate that the engine leaves good ones alone.** There is no labelled true claim
anywhere in the corpus, so the false-positive rate is not merely unmeasured — it is *unmeasurable by
construction*.

This matters more than the count. The open question about this engine is not "does it catch errors" —
§2 above suggests it does. The open question is **"does it reject everything?"** Four real
certifications, four REJECTs, zero CERTIFIED, zero ESCALATE. A corpus of only-false claims cannot
distinguish a discriminating engine from an indiscriminate one.

### Recommendation for the adjudication round

1. **Finish HRC-001's nine claims** — cheapest path to the first calibration-approved case, and the
   provenance finding above already justifies it.
2. **Then deliberately adjudicate claims believed to be TRUE** — from a different draft, ideally one
   whose reply is sound. Without them there is no false-positive rate, and without a false-positive
   rate "always REJECT" cannot be ruled out.

Point 2 is the one that changes what can be claimed about the system. Point 1 only unblocks the
counter.

---

## What is ready for the human

`ground-truth/cases/HRC-001/ADJUDICATION-PACKET.md` — 317 lines, generated, current. Per claim it
carries the claim text, the source quote, Argus's declared provenance and confidence, every
contradiction raised against it, and a blank ruling block.

It renders in the dashboard: **Ground Truth → HRC-001 → ADJUDICATION-PACKET.md**, alongside the ring
showing 3/12, the four status badges and the `blocked_by` chips.

**Nothing further is required from the tooling.** The packet has been ready since Phase B. The
constraint is, and has always been, an hour of a qualified person's attention.

---

## Honest status

| | |
|---|---|
| Calibration approved | **0** — unchanged |
| Claims adjudicated | **3 of 31** across two cases |
| Blocking work that software can do | **none** |
| Blocking work that requires a human | **9 claims** (HRC-001) · **19 claims** (CERT-002) |
| Estimated human effort for HRC-001 | ~1 hour with the packet |

Phase 12's stated stopping condition — *"stop after the first calibration-approved case is
achieved"* — cannot be met by me. I have stopped at the boundary instead, with the measurements that
did not require crossing it, and with a clear statement of what the nine rulings would buy.
