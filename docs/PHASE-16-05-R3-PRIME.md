# Phase 16 · 05 — R3′, the run on a reproducible build

**Run 2026-07-24 · ENGINE FILES MODIFIED: 0 (run against committed source `07bd842`)**

The pre-registered R3 is unrunnable — the build R1 and R2 executed on is not in git
(`PHASE-16-03-BUILD-REPRODUCIBILITY.md`). R3′ is the closest honest substitute: the same
command, on the build at commit **`07bd842`**, which anyone can rebuild from source forever.

**It is a cross-build comparison and is labelled as such throughout.** It is not R3 and does
not stand in for it. Its value is that it re-asks the determinism question on a build with a
known identity, which is the property the original experiment turned out to lack.

---

## Setup

| | |
|---|---|
| Source | commit `07bd842`, checked out in a git worktree |
| Build | `tsc` with `@types/node` + `playwright` present, clean typecheck |
| Engine surface vs Phase-16 build | `argus/certify · epistemic · extract · graph · pipeline · resolution · types` **byte-identical**; `argus/prompts`, `argus/reports`, `config` **differ** |
| Command | `certify d_f11d8de68709_mrwj1koh --override` |
| Draft | SHA-256 `97aaa1dd…4136` (unchanged) |
| Model | `claude-haiku-4-5-20251001`, `claude -p` CLI, no temperature control |
| Operator | `jerome` → `~/.claude` (declared, announced by the run) |

The extraction prompt (`argus/prompts.js`) **differs** from the R1/R2 build. So R3′ vs R1/R2 is
a cross-build measurement: any difference confounds a prompt change with sampling, exactly the
confound the protocol added R2 to remove for the within-build pair. That is why R3′ is reported
on its own terms and not merged into the R1/R2 alignment number.

---

## Result

| | R1 | R2 | **R3′** |
|---|---|---|---|
| Build | Phase-16 (uncommitted) | Phase-16 (uncommitted) | **`07bd842` (committed)** |
| `certifiedAt` | 21:34:35Z | 21:56:31Z | **2026-07-24T04:02:38Z** |
| Claims extracted | 12 | 16 | **15** |
| Refutation-eligible | 10 | 9 | **10** (5 not contradictable) |
| Contradictions · fatal | 35 · 10 | 25 · 11 | **26 · 9** |
| Reason instances · distinct kinds | 23 · 4 | 25 · 5 | **25 · 6** |
| Resolution | RESOLVED, 4 signals | RESOLVED, 4 signals | **RESOLVED, 4 signals — byte-identical** |
| Verdict | REJECT | REJECT | **REJECT** |

Rules fired in R3′: `fatal-contradiction` ×9, `overconfident-language` ×7, `no-provenance` ×4,
`invalidated-dependency` ×2, `falsifiable-claim-weak-evidence` ×1, `low-confidence-as-fact` ×2.
A **sixth** distinct rule kind — `no-provenance` and `low-confidence-as-fact` both appear here
and did not in R1/R2's rule set, while `falsifiable-claim-weak-evidence` collapsed from 7 to 1.
The verdict was identical and the reasoning behind it was different for a third time.

**The claim count is a third distinct value: 12, 16, 15.** Three runs of the same draft, three
extraction sizes, spanning two builds. On a *committed* build the sampler is still a sampler.

The resolution block reproduced byte-for-byte again — same four signals — now across a third
build. The deterministic layer has held on every run in the phase, without exception.

### The refutation independently re-found ERROR 1153, a third time

This is the result that matters most. R3′'s adversarial pass, told only to refute, produced
**four separate contradictions citing MySQL `ERROR 1153`** against the draft's central false
claim — with `official-implementation` and `primary-documentation` provenance:

> *"Exceeding max_allowed_packet during a mysqldump-style INSERT import is not silent. The
> server returns ERROR 1153 (08S01) … the row ends up MISSING, not present with an empty/blank
> value."* [official-implementation]

It also re-found the two defects the original human review missed and Argus's first run caught:
`mysqldump --extended-insert` batching (so "smaller settings restore fine" is false), and the
alternative explanation that a deliberate blanking is indistinguishable at the DB level from
truncation.

The false claim in HRC-001 has now been independently refuted with primary-documentation
evidence on **three separate runs across two builds**. Whatever varies in extraction, the thing
Argus exists to catch was caught every time.

---

## What R3′ can and cannot say

**Can:** the non-determinism of claim extraction is not an artefact of the specific uncommitted
build R1/R2 ran on. A build compiled fresh from committed source, on a different day, produced a
third claim count. Extraction variance is a property of the pipeline, not of one lost binary.

**Cannot:** it cannot be differenced against R1 or R2 to *quantify* the variance, because the
extraction prompt is not the same bytes. The clean within-build number remains R1 vs R2's
**6.3 %** (`PHASE-16-02`). R3′ corroborates the direction; it does not tighten the figure.

**Cannot:** it says nothing new about verdict stability. Like every run in the corpus it is a
REJECT, and `PHASE-16-04-VERDICT-AGREEMENT.md` explains why that agreement is close to
information-free — the corpus is 16 of 16 REJECT and no draft has approached a decision
boundary.

---

## The one thing R3′ settles cleanly

Before this run, "the build is gone" could have been read as "so the whole phase is suspect."
It is not. The **engine that makes the decisions** — `certify`, `extract`, `graph`, `epistemic`,
`resolution`, `types` — is byte-identical between the lost Phase-16 build and committed `07bd842`.
What differs is the two prompt/report/config files, none of which contains a verdict rule.

So the determinism finding stands on committed, inspectable code. The missing build changed the
*prompt text* the model saw, which is a reason R3 cannot be run as a controlled within-build
third sample — not a reason to doubt that extraction varies. R3′ demonstrates the variance on
code you can check out today.
