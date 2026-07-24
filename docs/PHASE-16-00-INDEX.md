# Phase 16 — extraction determinism · index

Six documents. Read in order; each assumes the one before it.

| # | Document | One line |
|---|---|---|
| 01 | [PROTOCOL](PHASE-16-01-PROTOCOL.md) | The pre-registration, verbatim — method fixed before any result was seen |
| 02 | [DETERMINISM](PHASE-16-02-DETERMINISM.md) | **The finding: two identical runs of an identical build aligned at 6.3 %** |
| 03 | [BUILD-REPRODUCIBILITY](PHASE-16-03-BUILD-REPRODUCIBILITY.md) | The build R1/R2 ran on is not in git; a frozen file changed with no recorded exception |
| 04 | [VERDICT-AGREEMENT](PHASE-16-04-VERDICT-AGREEMENT.md) | Why "both said REJECT" proves almost nothing — the corpus is 16/16 REJECT |
| 05 | [R3-PRIME](PHASE-16-05-R3-PRIME.md) | The run on committed `07bd842`: a third claim count (15), and ERROR 1153 re-found a third time |
| 06 | [IMPLICATIONS](PHASE-16-06-IMPLICATIONS.md) | What the finding invalidates, what it leaves standing, what would move it |

## The phase in five sentences

Argus's deterministic layers (resolution, graph, verdict rules) are byte-stable — resolution
detection reproduced identically across four runs and three builds. Its **model layer is not**:
the same draft, on a byte-identical build, produced claim counts of 12 and 16 and aligned at
6.3 %, with evidence class preserved on zero of the matched claims. This invalidates the error
bars — never stated — on every distribution that pools claims across certification records
(Phases 14–15). It does **not** license changing extraction: the engine is frozen, the finding
is n=1, and four previous attempts to fix model self-assessment by revising prompts all drifted.
The one thing that held through all of it is the thing Argus is for — the false ERROR 1153 claim
from HRC-001 was independently re-refuted with primary-documentation evidence on every single
run.

## What is NOT resolved, and is the actual blocker

Whether extraction variance can flip a **verdict** is unknown, because every certification ever
run is deep inside REJECT and no draft has approached a decision boundary. Argus's
false-positive rate is unknown, because it has returned CERTIFIED zero times. Both collapse to
the same Tier-0 blocker as everything else in this project: **nothing has been published, and no
draft has ever been good enough to test the interesting part of the machine.**

## Provenance

- Pre-registration, R1, R2, and the comparison harness: authored 2026-07-23, preserved in the
  session scratchpad (`p16/`).
- R3′: run 2026-07-24 against a git worktree at commit `07bd842`, built with a clean typecheck.
  Its certification was written to the worktree's own `data/`, never to the live corpus — which
  is why the main repo's log is still 16 records.
- Engine files modified across the entire phase: **0**.
