# Phase 16 · 06 — What depends on extraction being stable

**ENGINE FILES MODIFIED: 0.** This document changes nothing. It lists what the 6.3 % alignment
finding invalidates, what it leaves standing, and what would have to be measured to move any
of it.

---

## Invalidated: anything that pools claims across records

Phases 14–15 build distributions by pooling claims from every certification record as though
each were an independent observation of the same underlying process. `docs/CERTIFICATION-DISTRIBUTION.md`,
`docs/PROVENANCE-AUDIT.md`, `docs/CONFIDENCE-AUDIT.md` and `docs/CONTRADICTION-DISTRIBUTION.md`
all rest on that.

They do not. The corpus contains **16 records over 12 drafts**, and the repeated drafts are
repeated *samples of the same input*. Pooling them measures the sampler as much as it measures
the drafts, and the sampler moves:

| across two runs of one draft | |
|---|---|
| evidence class preserved on aligned claims | **0 of 1** |
| claim type distribution | 6 categories vs 5, none matching in count |
| confidence distribution | 7 high / 5 medium → 12 high / 4 medium |

A provenance distribution computed over that corpus is describing, in part, how the model
happened to label things on the days those runs happened.

**This does not make the distributions wrong. It makes their error bars unknown**, and none of
those documents states an error bar. Each should carry a pointer to this finding. That is a
documentation change, not a re-analysis — a re-analysis needs repeated runs across *many*
drafts, which do not exist.

---

## Left standing: the deterministic layers

Phase 7 resolution detection was byte-identical across four runs spanning two builds and two
days, including the same four signals with the same matched strings.

Everything built on the deterministic path — resolution, the dependency graph mechanics, the
epistemic comparison, the verdict rules themselves — is reproducible given its inputs. The
architecture's central bet (*the model produces structure, code makes every decision*) is
holding on the code side.

What Phase 16 shows is that **the inputs to those deterministic rules are not stable**, so
determinism of the rules does not confer determinism on the output.

---

## Left standing, but narrower than it looked

`ARE-001-argus-replay.mjs` replays a stored certification through the verdict rules and
reproduces the verdict. That is a real regression test and it still passes.

Its scope is now clearer than it was: it proves the **rules** are deterministic given a claim
set. It says nothing about whether the same draft produces the same claim set — which is the
step Phase 16 measured, and the step that moved.

---

## The thing this does NOT license

**It does not license changing extraction.** Specifically not:

- rewriting the extraction prompt to be "more consistent" — four separate defects
  (`fillable`, `alreadyAnswered`, `headroom`, `evidenceClass`) were prompt-revised and every
  revision drifted; the fixes that held checked facts the model does not control;
- adding a second extraction pass and reconciling them — that is a model adjudicating a model;
- setting a temperature — the provider is the `claude -p` CLI, which **exposes no temperature
  control**. Switching to the API to gain one would change the provider path, which is a
  larger change than the problem, on n=1.

The engine freeze applies. This finding is a measurement, not a defect report, and
`ENGINE-FREEZE.md` is explicit that a finding at n=1 is not grounds.

---

## What would actually move this

In order of value, none of them built:

**1. Repeat the measurement on drafts near a decision boundary.** Every certification so far is
deep inside REJECT. The question that matters is not "does the claim set move" — it does — but
"does the claim set move enough to flip a verdict". That needs a draft where a verdict could
go either way, and the corpus has none. Blocked on the same thing everything else is blocked
on: a draft good enough to be near the line.

**2. Commit a `dist/` fingerprint with any run that will be cited.** Phase 16's own build is
gone (`PHASE-16-03`). This is cheap, mechanical, and prevents the next experiment being
unreproducible in the same way.

**3. Make `doctor` verify the build, not just date it.** "Compiled output is newer than every
source file" passes on a build nobody can identify.

**4. Stop treating claim ids as stable across runs.** `c11` in one run is not `c11` in the
next. Nothing consumes them across runs today; the review package prints them, and two
packages read side by side would mislead.

---

## The honest summary

Extraction is a sampler. It was being read as a parser.

Every number in this repo that was computed by pooling claims across certification records
inherits that, and none of them says so. The deterministic half of the engine is doing exactly
what it was built to do; the measurement it is fed is noisier than the pipeline's own reports
imply.

The verdict has never changed. The verdict has also never been anything but REJECT — see
`PHASE-16-04-VERDICT-AGREEMENT.md` before drawing comfort from that.
