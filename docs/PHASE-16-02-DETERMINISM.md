# Phase 16 · 02 — Is claim extraction deterministic?

**Finding: NO. Two runs of a byte-identical build on a byte-identical draft aligned at 6.3 %.**

**Open Research · ENGINE FILES MODIFIED: 0**

Method, thresholds and controls were fixed in advance — see `PHASE-16-01-PROTOCOL.md`.

---

## The two runs

Same command (`certify d_f11d8de68709_mrwj1koh --override`), same build (manifest
`2f0de768…ba23`), same draft (SHA-256 `97aaa1dd…4136`), same model
(`claude-haiku-4-5-20251001`), 22 minutes apart.

| | R1 | R2 |
|---|---|---|
| `certifiedAt` | 21:34:35Z | 21:56:31Z |
| Claims extracted | **12** | **16** |
| Graph nodes / edges | 12 / 8 | 16 / 14 |
| Max dependency depth | 3 | 4 |
| Roots | 7 | 8 |
| Contradictions | 35 | 25 |
| — of which fatal | 10 | 11 |
| Claims actually attacked | 10 | 9 |
| Epistemic issues | 4 | 6 |
| Rules fired (instances) | 23 | 25 |
| Distinct rule kinds | 4 | **5** |
| Verdict | REJECT | REJECT |
| Resolution block | **byte-identical** | **byte-identical** |

---

## The headline number

Under the pre-registered metric — normalised token Jaccard, `same ≥ 0.75`, greedy matching:

| | |
|---|---|
| Claims aligned as **the same claim** | **1** |
| Claims aligned as **related** (0.35–0.75) | 5 |
| **Alignment** | **6.3 %** |
| Claims present in R1 with no counterpart in R2 | 11 |
| Claims present in R2 with no counterpart in R1 | 15 |

The single aligned pair, and the whole of the agreement between the two runs:

> R1 c1 — *"Custom CSS and Additional CSS are stored in different database locations within WordPress"*
> R2 c1 — *"Custom CSS and Additional CSS are stored in different locations in WordPress"*
> similarity **0.818**

And even that pair does not agree on its own metadata:

| | R1 c1 | R2 c1 |
|---|---|---|
| type | implementation-detail | implementation-detail |
| **evidenceClass** | community-knowledge | **framework-documentation** |
| **confidence** | medium | **high** |

**Evidence class was preserved on 0 of the aligned pairs.** The same sentence, from the same
draft, on the same build, was attributed to community folklore in one run and to framework
documentation in the next. Provenance is self-declared, and this is what self-declaration is
worth on repeat measurement.

---

## Nearly-the-same claims that the metric separated

Three pairs sit in the "related" band and are worth reading, because they show the
disagreement is not always about *content*:

| R1 | R2 | sim | |
|---|---|---|---|
| c9 | c10 | 0.65 | *"When row data exceeds size limits during SQL import, MySQL inserts the row as empty or truncated…"* vs *"When data exceeds size limits, the row inserts as empty or truncated…"* |
| c4 | c4 | 0.643 | *"…stored as a single row in wp_options or postmeta"* vs *"…stored as a single row in wp_options"* |
| c12 | c16 | 0.5 | both about raising the host's `max_allowed_packet` |

The first pair is the **false claim** at the centre of HRC-001 — the one MySQL `ERROR 1153`
refutes. Both runs found it. That is the system working.

---

## What changed structurally

Claim ids are positional (`c1`, `c2`, …), so **the ids are not stable identifiers** across
runs. R2's `c11` is not R1's `c11`. The dependency graph therefore differs wholesale:

| | R1 | R2 |
|---|---|---|
| Invalidated by dependency failure | c10 ← c6, c12 ← c11 | c2 ← c1, c11 ← c7, c15 ← c8, c16 ← c8 |
| Count | 2 | 4 |

Any downstream artefact that refers to a claim by id, across runs, is referring to different
claims. Nothing currently does — but the review package prints ids, and a person reading two
review packages side by side would be misled.

---

## A rule that appears and vanishes on sampling alone

`unrefuted-falsifiable-claim` (Rule 8) fired in **R2** and not in **R1**.

Nothing about the rule changed; nothing about the input changed. R2's extraction produced a
falsifiable claim whose refutation did not complete, and R1's did not. **A verdict rule's
participation is a function of the sample.** It happens that Rule 8 escalates and the verdict
was already REJECT, so nothing visible followed — on this draft.

---

## What held perfectly

The deterministic layers did exactly what they are supposed to.

**Phase 7 resolution detection was byte-identical across all four runs** — R1, R2, Record #1
and Record #2 — including the same four signals with the same matched strings and the same
detail text, spanning two days and two builds.

That is the design working as intended: the model produces structure, code makes decisions,
and the parts made of code do not move. It is also the reason the harness control matters —
identity was reported where identity existed.

---

## Verdict agreement is not evidence of stability

Both runs returned REJECT. That agreement carries close to no information, and
`PHASE-16-04-VERDICT-AGREEMENT.md` sets out why: **every certification in the corpus is a
REJECT (16 of 16).** A system that always returns one answer agrees with itself perfectly and
tells you nothing by doing so.

---

## Scope

One draft, two runs, one model, one provider path. `claude -p` exposes **no temperature
control**, so this is sampling at the CLI's default — not a tuned or worst-case setting.

This does not estimate how often extraction disagrees. It establishes that it does, on an
identical build and an identical input, at a magnitude large enough to matter.
