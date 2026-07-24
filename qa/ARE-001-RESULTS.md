# ARE-001 — Argus Replay Experiment · Results

**Date:** 2026-07-23 · **Environment:** local, no network, no model calls, no operator credentials
**Harness:** `qa/ARE-001-argus-replay.mjs` · **Reproduce:** `node qa/ARE-001-argus-replay.mjs`
**Subject:** `d_f11d8de68709_mrwj1koh` — the HRC-001 draft, the only real certification on disk

**Scope, stated first because it bounds every number below.** This replays Argus's
**deterministic verdict layer** over one recorded claim structure under perturbation. It does
not exercise extraction, classification, provenance assignment or refutation — all model work.
**n = 1 draft.** Nothing here is a false-positive rate.

---

## Why this experiment and not another

The campaign was blocked on an operator action. This is the highest-value measurement that
needs no operator, no browser, no Reddit and no credentials, because Argus's rule layer is a
pure function over structure already on disk.

It was justified by an observation, not a hunch: **E-26** — refutation hit the 180s CLI timeout
on claims c2 and c3 during the real run. Incomplete refutation is a thing that has already
happened, and Rule 8 exists for it and had never fired.

---

## Measured results

| # | Perturbation | Verdict | Invalidated | Rules fired |
|---|---|---|---|---|
| P0 | exact recorded input | REJECT | 0 | `thread-resolved`, `fatal-contradiction`×16, `overconfident-language`, `unrefuted-falsifiable-claim` |
| P1 | human override of resolution | REJECT | 0 | `fatal-contradiction`×16, `overconfident-language`, `unrefuted-falsifiable-claim` |
| P2 | refutation completed for **no** claim | **ESCALATE** | 0 | `unrefuted-falsifiable-claim`×5 |
| P2b | refutation ran, found nothing, epistemic also cleared | **CERTIFIED** | 0 | `all-claims-supported` |
| P2c | refutation ran, found nothing, **real epistemic retained** | **ESCALATE** | 0 | `overconfident-language`×1 |
| P3 | one upstream claim fatal, dependents clean | REJECT | **3** | `fatal-contradiction`, `invalidated-dependency`×3 |
| P4 | all claims authoritative + high confidence, nothing contradicted | **CERTIFIED** | 0 | `all-claims-supported` |
| P5 | perfect claims, resolved thread, no override | REJECT | 0 | `thread-resolved` |

**M1 — the replay reproduces the record.** P0 returns REJECT with `invalidated: 0`, matching
the stored certification exactly. Every result below rests on this. *Confidence: high.*

**M2 — all three verdicts are reachable from real structure.** REJECT, ESCALATE and CERTIFIED
were all produced. Before today only REJECT had ever been observed. *Confidence: high, for the
rule layer only.*

**M3 — Rule 8 fires.** P2 escalates with 5 unrefuted falsifiable claims. Previously unexercised
(N-06). *Confidence: high.*

**M4 — Phase 6 propagation fires.** P3 invalidates c9, c10 and c11, each reported as *dead
because c5 failed*. Previously unexercised (N-06b), because in the real run every dependent was
independently refuted. The real 8-edge graph reproduces the A→C→D shape that `graph.ts`
documents from HRC-001. *Confidence: high.*

**M5 — Rule 4's trigger surface on this draft is zero.** All **5 of 5** falsifiable claims were
assigned AUTHORITATIVE provenance by the model:

| Claim | Type | Provenance | Confidence |
|---|---|---|---|
| c3 | implementation-detail | framework-documentation | high |
| c4 | implementation-detail | framework-documentation | high |
| **c5** | protocol-behaviour | observed-runtime-behaviour | high |
| c6 | platform-behaviour | primary-documentation | high |
| **c7** | protocol-behaviour | official-implementation | high |

Rule 4 escalates a falsifiable claim resting on *non*-authoritative evidence. No falsifiable
claim on this draft rests on non-authoritative evidence, so **Rule 4 cannot fire here at all.**
c5 and c7 are the claims carrying the false `max_allowed_packet` assertion. *Confidence: high
for this draft; n = 1.*

**M6 — one rule separated the known-false draft from CERTIFIED.** P2c is the faithful
"refutation returned empty" case. Verdict: ESCALATE, on a single `overconfident-language`
issue against **c9** — a *recommendation* that rests on c5 and c7. Because c9 is not a
falsifiable type, Rule 5 routes it to ESCALATE rather than REJECT. The false claims themselves
triggered **no rule whatsoever**. *Confidence: high for this draft; n = 1.*

---

## Observation → explanations, per Principle 3

**Observation.** With refutation contributing nothing, the known-false HRC-001 draft reaches
ESCALATE rather than REJECT, and the margin is one epistemic issue on a downstream claim.

**Possible explanations**

1. *Argus's real defence against HRC-001 was the adversarial refutation pass, not the
   deterministic rules.*
2. *The deterministic rules are adequate and P2c is unrepresentative — a contrived scenario.*
3. *Provenance inflation is severe enough to disable Rule 4 generally.*

**Evidence supporting (1).** The recorded run rejected on 16 fatal contradictions, all from
refutation (E-32/E-33). Remove them and no rule fires on c5 or c7. Refutation independently
found `ERROR 1153` (E-33) and three defects human review missed (E-34).

**Evidence supporting (3).** M5: 5/5 falsifiable claims authoritative. E-25 previously recorded
inflation on two claims; this measures it as total on the falsifiable set.

**Evidence against (2).** E-26 makes the scenario non-contrived — refutation already failed on
2 of 12 claims in the only real run. A pass that fails on 17% of claims is not hypothetical.

**Evidence against (1) being fatal.** The fail-closed path is wired correctly: `pipeline.ts:140`
adds a claim to `refutationRan` only on success, omits it on catch (`:144`) and passes the set
to `certify` (`:164`). A **timed-out** refutation therefore triggers Rule 8 and escalates. The
gap is narrower than P2c alone suggests.

**Unknowns**

- A refutation that *succeeds and returns zero contradictions* is indistinguishable from one
  that genuinely found nothing. Both mark the claim as attacked. **Unmeasured: how often
  refutation returns empty on a claim that is actually wrong.** This is the miss rate, and it
  cannot be measured without a false claim that survives refutation.
- Whether 5/5 authoritative provenance generalises beyond this draft. n = 1.
- Whether ESCALATE is a *sufficient* outcome for a false claim. It puts a human in front of it,
  which is the design — but it does not say "this is wrong", it says "someone should check".

---

## What this does NOT establish

- Not a false-positive rate. P4 shows CERTIFIED is *reachable*; it does not show Argus certifies
  sound real drafts, because the P4 input was synthesised by overwriting provenance.
- Nothing about extraction, classification or refutation quality.
- Nothing about any draft other than this one.

## Reproduction

```
node qa/ARE-001-argus-replay.mjs
```

Deterministic: no model, no network, no clock dependence. Reads `data/certifications.jsonl`
read-only and writes nothing.
