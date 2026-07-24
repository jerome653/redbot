# Phase 16 · 04 — What verdict agreement proves (almost nothing)

**Measured 2026-07-24 from `data/certifications.jsonl` · ENGINE FILES MODIFIED: 0**

The easiest wrong conclusion to draw from Phase 16 is: *"the claims moved around, but the
verdict was REJECT both times, so the system is stable where it counts."*

This document exists to close that off, because it is the reading that would let the phase's
actual finding be filed and forgotten.

---

## The corpus

| | |
|---|---|
| Certification records on disk | **16** |
| Distinct drafts certified | 12 |
| REJECT | **16** |
| ESCALATE | 0 |
| **CERTIFIED** | **0** |

**Argus has never returned CERTIFIED on real input.** Not once, on any draft, in any run.

---

## Why agreement carries no information here

If a process returns one value with probability 1, two draws from it agree with probability 1
— regardless of what happens inside. A thermometer stuck at 20 °C is perfectly reproducible.

Concretely: for R1 and R2 to have disagreed on the verdict, one of them would have had to find
**zero** fatal contradictions, **zero** unsupported claims, **zero** invalidated dependencies
and **zero** overconfident falsifiable claims. R1 found 10 fatal contradictions; R2 found 11.
The draft is not close to the boundary — it is deep inside REJECT territory, and both samples
landed deep inside it.

The measurement that would carry information is a draft near a decision boundary, sampled
twice. **No such draft exists in the corpus**, because no draft has ever come near one.

---

## What the rules-fired data does show

| rule | R1 | R2 |
|---|---|---|
| `fatal-contradiction` | 10 | 11 |
| `overconfident-language` | 4 | 5 |
| `invalidated-dependency` | 2 | 4 |
| `falsifiable-claim-weak-evidence` | 7 | 3 |
| `unrefuted-falsifiable-claim` | — | **1** |
| **distinct kinds** | **4** | **5** |

Every individual count moved. `falsifiable-claim-weak-evidence` more than halved. A fifth rule
appeared in one run and not the other. **The reasoning behind the verdict was different both
times; only the label was the same.**

That matters directly for the review package: an operator reads the reasons, not the enum.
Two runs would hand the same person materially different accounts of what is wrong with the
same reply.

---

## The corpus-wide rule distribution

Across all 16 records:

| rule | instances |
|---|---|
| `fatal-contradiction` | 117 |
| `overconfident-language` | 101 |
| `invalidated-dependency` | 25 |
| `falsifiable-claim-weak-evidence` | 24 |
| `no-provenance` | 12 |
| `unrefuted-falsifiable-claim` | 4 |
| `low-confidence-as-fact` | 3 |
| `thread-resolved` | 3 |

Read carefully: this is **not** a population estimate of how often drafts contain fatal
contradictions. It is dominated by repeated certifications of the same two drafts. It is
included so nobody has to recompute it, and it should not be quoted as a rate.

---

## The consequence for Argus's own claims

Argus's **false-positive rate is unknown and currently unmeasurable.** A truth layer that
rejects sound replies would leave no trace — the reply is simply never sent, and no record is
created saying "a good reply was stopped here". With 0 CERTIFIED outcomes, there is no
evidence distinguishing:

- a certification engine correctly rejecting 16 flawed drafts, from
- a certification engine that rejects nearly everything.

The one human ruling available (HRC-001) went Argus's way and then some: the adversarial pass
independently found the `ERROR 1153` refutation that a person found, **and three defects the
human review missed.** That is real, and it is n=1.

**The measurement that resolves this is a draft that comes back CERTIFIED and is then judged by
a person.** Until one exists, "Argus works" is a hypothesis with one supporting case.

---

## Stated plainly

- Verdict agreement across R1/R2: **true, and uninformative.**
- Claim-level agreement across R1/R2: **6.3 %.**
- Whether Argus can clear a good reply: **never observed.**
