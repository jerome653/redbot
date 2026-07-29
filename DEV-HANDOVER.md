# Developer handover

Written 2026-07-24 for whoever picks this up next. It assumes you have read `README.md` and
know what redbot is for. This document is the parts a README should not carry: what is real,
what is scaffolding, where the traps are, and what I would do first.

---

## The one number that matters

**Zero replies have ever been published.** Not one. Every certification run on real input —
**16 of them, counted from `data/certifications.jsonl` on 2026-07-24** — returned REJECT.
Argus has never returned CERTIFIED, so its false-positive rate is unknown and currently
unmeasurable. Both accounts sit near zero karma.

Read every claim in this repository against that fact. The engine is well tested; it is not
proven. **371 tests at 2026-07-27 10:23** — counted from `node --test`'s own summary, not
remembered — say the code does what its source says. They say nothing about whether a published
reply would help anybody, because none exists.

*(Both numbers on this page were wrong before. The certification line said 17; the log said 16.
The test line said 229 and the command block said 194, neither of which had been run in days.
**Recount, do not quote:** the suite went 337 → 368 → 371 during the hour this paragraph was
written, so a test count here is a timestamp, not a fact about the project. The certification
count is the opposite kind of number — `data/certifications.jsonl` is gitignored and absent from
a fresh checkout, so 16 cannot be recounted from the repository at all, which is exactly why the
date is welded to it.)*

---

## What is real, what is scaffolding

| Area | State | Evidence |
|---|---|---|
| Collect · score · gap analysis · draft | **Real, exercised** | 58 threads, 24 assessed, 12 drafts on disk |
| Argus fact-checking | **Real, exercised** | 16 certifications; caught a false MySQL claim a human review missed |
| Safety linter, 20 publish gates | **Real, tested** | 371 tests (2026-07-27), fuzz suites pass |
| Domain profile (`data/domain.json`) | **Real, new 2026-07-24** | vocabulary out of source; 58/58 corpus threads score identically to the hardcoded tables |
| Argus Phase 10 citation check | **Wired, never fired on real input** | no draft has yet made a claim inside a corpus's jurisdiction |
| Search preview → commit | **Real, new 2026-07-24** | listing read without opening threads; picks are explicit |
| Account resolution (`REDBOT_ACCOUNT`) | **Real, new 2026-07-24** | resolves port + profile from `accounts.json` |
| Quiet hours + daily ceiling | **Real, new** | `src/window.ts`, 12 tests, fails closed |
| Product console | **Real** | 25/25 interface checks |
| Unattended loop (`auto`) | **Real, lightly run** | one cycle observed end to end |
| Console approval path | **Wired, never fired** | refusals tested; no publish has occurred |
| Publishing | **Never executed against Reddit** | `publishComment` has 0 successful runs |
| Outcome measurement | **Harness only** | 1 observation total, a karma reading |

Anything in the last three rows is code that compiles and has never done its job.

---

## Traps — each of these cost hours

**1. `data/` holds credentials next to evidence.** `data/chrome-profile*/` contains live Reddit
session cookies for signed-in accounts. The nested `.gitignore` is load-bearing. Before any
`git add`, run `git status` and confirm no `chrome-profile`, no `data/*.json`, no
`data/operators/`. This repository has never contained them; keep it that way.

**2. Never launch Chrome with Playwright.** Every Playwright-*launched* browser gets a Reddit
block page, served as **HTTP 200 with the block in the body** — a naive status check reads it
as success. redbot attaches over CDP to a Chrome a person started. That is why setup asks you
to open a browser yourself.

**3. `certifications.jsonl` records are samples, not properties.** The same draft certified
five times produced claim counts of 0, 0, 12, 12 and 16 on a byte-identical build. The verdict
was stable; nothing below it was — **two runs of an identical build on an identical draft
aligned at 6.3 %**, and evidence class was preserved on 0 of the aligned claims. Do not build a
feature that treats a single claim count, or a claim id, as a fact about a draft. See
`docs/PHASE-16-02-DETERMINISM.md` (and `docs/RQ-03-SAME-DRAFT-TRIPLE.md` for the earlier,
falsified version of the question).

**3b. The build that produced that measurement is not in git.** Only one commit exists and
`dist/` is untracked; `src/argus/prompts.ts` — a frozen file — differs between the Phase-16
fingerprint and `07bd842`, with no recorded exception. Nothing detected it; it surfaced only
when a later experiment needed the old build back. `doctor`'s build check verifies *freshness*,
not *identity*. Commit a `dist/` hash manifest with any run you intend to cite.
See `docs/PHASE-16-03-BUILD-REPRODUCIBILITY.md`.

**4. Model self-assessment as an input has failed four times.** `fillable` came back true 97%
of the time. `alreadyAnswered` missed an explicit `UPDATE:` resolution. `headroom` disagreed
with its own gaps. `evidenceClass` inflated provenance. Every fix that held checked a fact the
model does not control; every prompt revision drifted. **Ask the model for observations,
compute verdicts in code.**

**5. The build can be stale and nothing will tell you.** `dist/` is what runs. `npm run build`
after any `src/` change, and `node dist/cli.js doctor` reports build freshness.

**6. Two servers, two jobs.** `tools/operator/` (port 7901) is the engineering instrument —
benchmark, replay, raw files. `tools/product/` (port 7902) is what an operator uses. They read
the same data and neither writes to the other's surface.

---

## Architecture in one page

```
read/search ──> threads.json
                    │
                    ├─ gap.ts ──────> gaps.json          what the thread already contains
                    └─ opportunity.ts > assessments.json  contribute or skip (mechanical)
                                            │
                                       draft.ts ────────> drafts.json
                                            │
                                       argus/ ──────────> certifications.jsonl
                                            │             CERTIFIED | ESCALATE | REJECT
                                            │
                                       gates.ts (20)      refuses before anyone is asked
                                            │
                                       reply.ts ────────> Reddit   ← the only write path
```

**The inversion that matters:** the model produces *structure*; code makes every *decision*.
Claim extraction and contradiction search are model calls. Resolution detection, the dependency
graph, epistemic calibration and the verdict rules are deterministic. That split is the response
to HRC-001, where fluent model output was trusted end to end.

**Engine freeze.** `ENGINE-FREEZE.md` lists what may not change without benchmark evidence or
human calibration — the certification modules, `policy.ts`, the corpus contract. `config.ts`,
`browser.ts`, `ask.ts`, `log.ts` and everything under `tools/` are **not** frozen; that is why
the account and approval work was possible without unfreezing anything.

---

## What I would do first, in order

1. **Publish one reply and record what happens to it.** Not engineering. It is the only thing
   that converts this from a well-tested program into a measured one, and every open question
   below is downstream of it.
2. **Audit every model-self-assessment field** under one rule (ask for observations, compute in
   code). `fillable` is still read and still meaningless.
3. **Retire one of the two decision paths.** `analyze`/`analysis.json` and
   `opportunity`/`assessments.json` both answer "is this thread worth answering". Having both
   already caused a silent unpublishable defect.
4. **Search-first thread selection.** Run a search, look at what comes back, choose what enters
   the corpus. Currently `search` commits all 15 results; a preview step is needed.
5. **Responsive pass on the console.** Widths have been measured at 430/820/1280/1600 with no
   overflow. That is a rendering check, not a device pass, and should not be reported as one.

**Explicitly not next:** a second truth layer, an adapter seam for other platforms, posting new
threads, or unattended publishing. The first three are speculative until item 1 exists. The
fourth removes the only safeguard that has ever worked.

---

## Things that are true and uncomfortable

- **Argus has never returned CERTIFIED on real input.** An engine that has only ever said no is
  not yet distinguishable from one that always says no. Its false-positive rate is unknown
  because no claim has been labelled true by a human.
- **The Reddit lane is months from a return.** Both accounts need roughly six weeks of
  hand-written comments before a reply reliably survives. No software shortens that.
- **The fact-checker is the asset, and it is not Reddit-specific.** It caught a false claim that
  careful human review missed. Pointed at any published technical content, it does the same job
  with no account risk at all. That is worth considering before more is invested here.

---

## Running the gates

```powershell
npm test                              # 371 on 2026-07-27 — it prints its own total, use that
npx tsc --noEmit                      # typecheck, strict
node dist/cli.js doctor               # install health
node qa/benchmark/run.mjs             # certification regression
node qa/ARE-001-argus-replay.mjs      # deterministic replay
node ground-truth/validate.mjs        # corpus contract
node qa/phase4-fuzz.mjs               # linter fuzz
node tools/operator/qa-console.mjs --port 7901   # 90 console checks
```

All of these exited 0 on 2026-07-24. `qa-console.mjs` had 3 known failures at that date: a
stale certification count, a select-count assertion, and a queue command check.
