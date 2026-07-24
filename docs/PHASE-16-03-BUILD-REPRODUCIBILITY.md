# Phase 16 · 03 — The build R1 and R2 ran on is not in git

**Finding: R3 as pre-registered cannot be run, by anyone, ever. The engine bytes that produced
R1 and R2 were never committed.**

**Measured 2026-07-24 · ENGINE FILES MODIFIED: 0**

---

## How this surfaced

The pre-registration's stopping rule fired (R1 vs R2 aligned at 6.3 %), so R3 was owed. The
same pre-registration also fixed the condition under which any Phase-16 result stands:

> 79 compiled `.js` files hashed to `build-fingerprint-pre.txt` (manifest SHA-256
> `2f0de768…ba23`). Re-hashed after the last run; **if the manifest hash changes, every result
> in this phase is void.**

So before running R3, the frozen build had to be reconstructed. `Projects/redbot/` has exactly
one commit — `07bd842`, "redbot v1". A worktree was created at that commit and compiled with
the same TypeScript from the same `node_modules`.

**It does not reproduce the Phase-16 build.**

---

## The comparison

`dist/` is not tracked (`.gitignore`), so the build was recreated with a clean typecheck —
`@types/node` and `playwright` present, tsc exiting silently — to rule out an emit difference
caused by unresolved types.

| | |
|---|---|
| Files identical to the Phase-16 manifest | **67** |
| Files differing | **11** |
| Present in Phase-16 build, absent at `07bd842` | 1 (`dist/commands/analyze.js`) |
| Present at `07bd842`, absent from Phase-16 build | 3 (`dist/commands/auto.js`, `dist/window.js`, `dist/test/window.test.js`) |

Restricted to the surface the pre-registration holds constant:

| module | |
|---|---|
| `argus/certify.js` · `epistemic` · `extract` · `graph` · `pipeline` · `resolution` · `types` | same |
| `competence.js` · `gap.js` · `opportunity.js` · `policy.js` · `prompts.js` · `llm.js` · `store.js` | same |
| **`argus/prompts.js`** | **DIFFERS** |
| **`argus/reports.js`** | **DIFFERS** |
| **`config.js`** | **DIFFERS** |

The verdict rules, the extraction code, the graph and the resolution detector are all
byte-identical to the build R1 and R2 ran on. **`argus/prompts.js` is not** — and that file is
the literal text sent to the model for claim extraction and for adversarial refutation.

---

## Why that specific file makes R3 impossible

R1 vs R2 measured one thing: **the same prompt, sampled twice.** A third run against a
different prompt measures the prompt change and the sampling together, with no way to
separate them. That is precisely the confound the protocol added R2 to eliminate — reproducing
it as R3 would undo the only controlled comparison in the phase.

So the honest statement is not "R3 was not run yet". It is:

> **R3, as pre-registered, is unrunnable.** The build is gone. It existed only in a working
> tree between 2026-07-24 05:15 and the commit later that day, and the changes made in that
> window were committed together with everything else.

---

## The second finding, which is the more serious one

`src/argus/prompts.ts` is **inside the engine freeze** (`ENGINE-FREEZE.md`: *"`src/argus/prompts.ts`
— extraction and contradiction prompts"*). It changed between the Phase-16 fingerprint and the
commit, and there is **no recorded exception for it**, because until 2026-07-24 the freeze
document had nowhere to record one.

The change is not recoverable and not attributable — one commit, no intermediate history, and
`dist/` untracked. What can be stated:

- The frozen surface moved without a written exception.
- Nothing detected it. Not the test suite, not the benchmark, not `doctor` (which checks build
  *freshness*, i.e. that `dist/` is newer than `src/` — not that either matches anything).
- It was found only because a later experiment needed the old build back.

`ENGINE-FREEZE.md` now carries a **Recorded exceptions** section. That is the process fix. It
does not recover this one.

---

## What was run instead

**R3′** — the same command, on the build at commit `07bd842`, which is reproducible from git
forever. Reported in `PHASE-16-05-R3-PRIME.md` and labelled **cross-build** throughout. It is
not the missing R3 and does not stand in for it.

Its value is different and worth having: it re-opens the determinism question on a build
anyone can rebuild, which is the property the original experiment turned out to lack. R3′ ran
2026-07-24 and returned REJECT with a **third** distinct claim count (15), re-finding ERROR
1153 with primary-documentation evidence. Full result in `PHASE-16-05-R3-PRIME.md`.

---

## What should change

1. **Track the fingerprint, not just the source.** A manifest of `dist/` hashes committed
   alongside any run that will be cited later. Cheap, and it turns "the build is gone" into
   "the build differs, here is how".
2. **Commit before an experiment, not after.** Any run whose result will be quoted needs a
   commit hash attached at the time it runs.
3. **`doctor` should compare, not just date-check.** "Compiled output is newer than every
   source file" passes happily on a build nobody can identify.

None of these are in place. They are recorded in `PHASE-16-06-IMPLICATIONS.md` with the rest
of the follow-on work, unbuilt and marked as such.
