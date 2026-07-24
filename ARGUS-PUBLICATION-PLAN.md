# Argus publication plan — 2026-07-23

**Plan only. No code written. No engine file touched.**

---

## 0 · The finding that shapes everything

Phase 1 says *"move only platform-neutral components."* Measured, that is not possible.

**Argus's transitive dependency closure is 17 production files. Twelve of them carry Reddit
coupling:**

| File | Coupling |
|---|---|
| `src/types.ts` | `Thread`, `Comment`, `Draft` — the input contract |
| `src/store.ts` | persists `Thread` / `Draft` |
| `src/argus/pipeline.ts` · `reports.ts` · `commands/certify.ts` | take `Thread` + `Draft` |
| `src/argus/resolution.ts` | imports `Thread` directly |
| `src/config.ts` | `redditBase`, browser CDP, pacing, `expertise`, `brand.org` |
| `src/argus/prompts.ts` · `llm.ts` · `log.ts` · `trace.ts` · `backup.ts` | Reddit literals |

This is **D-07**, recorded in the technical-debt register months ago: *"`Thread`, `Comment`,
`Draft` are Reddit-shaped types used everywhere. There is no adapter seam."* `docs/09` parked the
seam deliberately — *"an interface designed against one implementation is usually wrong."*

### Three ways forward, and the recommendation

| | Approach | Verdict |
|---|---|---|
| **A** | Publish Argus **with its Reddit-shaped input contract**, unchanged, and say so plainly | **RECOMMENDED** |
| B | Build the adapter seam first | **Forbidden** — engine change, and `docs/09` parked it for a reason |
| C | Do not publish until a second platform exists | Defers indefinitely |

**Option A costs nothing scientifically and is honest.** The README states: *Argus's input contract
is currently discussion-shaped and named for its first consumer. The adapter seam is future work
(D-07).* A reader can still use it — the contract is three plain interfaces — and the project's
credibility rests on saying true things about itself.

**One thing A does require, and it is not an engine change:** `config.ts` is copied as a **subset**
containing only what Argus imports (`llm`, `paths`, operator resolution). `redditBase`, `browser`,
`pacing`, `budget`, `limits`, `expertise` and `brand.org` are **not copied**, because Argus never
reads them. Subsetting what moves is not editing what exists — redbot's `config.ts` is untouched.

---

## 1 · Publication plan

| Phase | Deliverable | Engine risk |
|---|---|---|
| **1** | Boundary fixed per Option A; config subset defined | none |
| **2** | Scrub: handles, employer, paths, historical identifiers | none |
| **3** | Repo structure + README, LICENSE, SECURITY, CONTRIBUTING, CHANGELOG, ROADMAP | none |
| **4** | CI: install → typecheck → test → benchmark → replay → corpus validate | none |
| **5** | Docker — **engine-only image**, see Risks | none |
| **6** | Adjudication UI — thin editor over `ground-truth/cases/*/case.json` | none |
| **7** | `v0.1.0-alpha` release checklist. **Not tagged automatically** | none |

**Gate on every phase:** `npm test` 182/182 · benchmark exit 0 · ARE-001 exit 0 · corpus validate
exit 0. Any drift stops the phase.

---

## 2 · Repository tree

```
argus/
  README.md                 what it is · what it is not · the Reddit-shaped contract, stated
  LICENSE
  SECURITY.md               no network egress except the model provider; data/ never ships
  CONTRIBUTING.md           the freeze policy is the contribution policy
  CHANGELOG.md              starts at v0.1.0-alpha
  ROADMAP.md                D-07 adapter seam · calibration · what is deliberately absent
  ENGINE-FREEZE.md          copied verbatim — the baseline

  src/
    argus/                  certify · extract · graph · epistemic · pipeline · prompts
                            reports · resolution · types            (9 files, VERBATIM)
    llm.ts  log.ts  trace.ts  store.ts  types.ts  backup.ts          (verbatim)
    config.ts                                                        (SUBSET — see §0)
    commands/certify.ts                                              (verbatim)
    test/argus.test.ts  test/llm-json.test.ts                        (verbatim)

  benchmark/                run.mjs · make-cases.mjs · cases/*.json · README
  replay/                   ARE-001-argus-replay.mjs · ARE-001-RESULTS.md
  ground-truth/             schema.json · build-corpus.mjs · validate.mjs
                            make-worksheet.mjs · make-adjudication-packet.mjs
                            cases/HRC-001/ · cases/CERT-002/
  tools/adjudicate/         the Phase-6 UI

  docs/
    ARCHITECTURE.md         from ARGUS.md
    CORPUS.md               from AGTC.md
    CALIBRATION-V1.md       from docs/13
    EVIDENCE-INDEX.md       FILTERED SUBSET — labelled as such
    LESSONS.md              the Argus-relevant half of docs/03

  examples/                 one worked certification, end to end
  .github/workflows/ci.yml
  Dockerfile  docker-compose.yml
```

---

## 3 · Files requiring scrub

| Target | Occurrences | Action |
|---|---|---|
| **Employer name** | 179 across 33 files | Most live in files that do **not** move. Inside the Argus set: `config.ts` (`brand.org`) is dropped by the subset; remaining hits are prose in docs → replace with "the operator's employer" |
| **Reddit account handles** | 25 across 13 files | Inside the Argus set: `reports/HRC-001-*`, `docs/08`. Replace with `account-a` / `account-b`. `src/test/gates.test.ts` does **not** move |
| **Operator name / paths** | 91 across 34 files | 2 of the top 3 concentrations are in `_superseded/`, which does not move. `config.ts` help text → parameterised in the subset |
| **`reddit_session`** | 11 | **False positive** — the cookie *name* in DEFECT-01 write-ups and in `backup.ts`'s own secret-scanner pattern. No cookie value exists. **Keep**; it is evidence |
| **Absolute paths** | 2 | `config.ts` help text (subset) · `data/operators/` (never ships) |
| **Secrets** | **0** | No API key, token, cookie value or private key found anywhere |

**Evidence is never altered.** `docs/EVIDENCE-INDEX.md` ships as a **filtered subset** — Argus
entries only — and says so in its header. The complete index stays private and unmodified.

---

## 4 · Files remaining private

Everything Reddit-operational, plus everything that made the earlier publication scan
uncomfortable:

- `src/reddit/*` · `browser.ts` · `behavior.ts` · `pacing.ts` · `rand.ts` · `ask.ts`
- `commands/`: read, search, reply, observe, session, login, draft, opportunity, regret, status, doctor, history, backup
- `gates.ts` · `health.ts` · `disclosure.ts` · `quality.ts` · `novelty.ts` · `select.ts` · `competence.ts` · `gap.ts` · `opportunity.ts` · `policy.ts` · `metrics.ts` · `insights.ts` · `review.ts` · `interactions.ts` · `prompts.ts` · `reports.ts` · `probe-karma.ts`
- **`ACCOUNT-WARMING.md`** · **`MULTI-ACCOUNT-RISK.md`** — the two documents that drove the Argus-only decision
- `WHY-NO-ANDROID.md` · `PHASE-*.md` · `STATUS.md` · `PRODUCTION-READINESS.md` · `EVIDENCE-CAMPAIGN.md` · `OBSERVATION-SCHEMA.md` · `PUBLICATION-READINESS.md`
- `data/` · `_superseded/` · `design/` · `certification/` · `qa/QA-REPORT.md`
- redbot's own `README.md`

---

## 5 · Estimated effort

| Phase | Sessions |
|---|---|
| 1 · boundary + config subset + green validation in the new tree | 1 |
| 2 · scrub | 0.5 |
| 3 · structure + six documents | 1 |
| 4 · CI | 0.5 |
| 5 · Docker (engine-only) | 0.5 |
| 6 · adjudication UI | 1–2 |
| 7 · release checklist | 0.5 |
| **Total** | **5–6 sessions** |

Phase 6 is the widest range: a thin single-page editor is one session; the standing multi-viewport
QA by-law applies to any UI and adds a pass.

---

## 6 · Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Copy drifts from the frozen baseline** — two divergent copies of a "frozen" engine | **high** | Copy verbatim; CI runs the same four gates; `ENGINE-FREEZE.md` ships with it. Any divergence is a CI failure, not a review question |
| R2 | **Docker cannot run the whole system** — the architecture is *attach to a Chrome a person opened*; a container cannot reach the operator's browser | medium | Ship an **engine-only** image: `certify`, benchmark, replay, corpus validate. Say plainly in the README that collection and publishing are host-side. Partly closes **N-16** (cold start, never attempted) |
| R3 | **Filtered evidence index reads as cherry-picking** | medium | Header states it is a subset, names the exclusion rule, and points at the private complete index |
| R4 | **"Platform-neutral engine" overclaims** given `Thread`/`Draft` | medium | README states the contract is discussion-shaped and names D-07 as open. Honesty here is cheaper than a rename |
| R5 | **Publication invites forks that remove the human boundary** | medium | Argus-only removes the poster entirely. A certification engine has no TTY gate to delete |
| R6 | **Corpus ships with 0 calibration-approved cases** | low | Correct and stated. `v0.1.0-**alpha**` is the honest tag |
| R7 | **Scrub misses an identifier** | low | Re-run the scan as a CI step and as the final pre-tag gate |

---

## 7 · Exact commit plan

Each commit is independently revertible; each ends with the four gates green.

```
c1  chore: initialise argus repository skeleton
      LICENSE, .gitignore, package.json, tsconfig.json
      .gitignore MUST exclude data/ before anything else lands

c2  feat: import frozen certification engine (verbatim)
      src/argus/*, llm, log, trace, store, types, backup, commands/certify
      src/config.ts as the Argus subset
      GATE: npm test green

c3  feat: import benchmark, replay harness and ground-truth corpus
      benchmark/, replay/, ground-truth/
      GATE: benchmark 0 · ARE-001 0 · validate 0

c4  docs: architecture, corpus, calibration, lessons, filtered evidence index
      + ENGINE-FREEZE.md verbatim

c5  chore: publication scrub
      handles -> account-a/b · employer -> generic · paths parameterised
      GATE: scan reports 0 identifiers

c6  docs: README, SECURITY, CONTRIBUTING, CHANGELOG, ROADMAP

c7  ci: validation workflow
      install -> typecheck -> test -> benchmark -> replay -> validate -> scrub scan

c8  build: engine-only Dockerfile + compose

c9  feat: adjudication UI (thin editor, no inference)

c10 docs: v0.1.0-alpha release checklist
      TAG NOT APPLIED — human action
```

**c1 before c2 is not cosmetic.** `.gitignore` must exclude `data/` before a single source file
lands. DEFECT-01 was 4.6 GB of Chrome profile with live session cookies one `git add -A` from a
commit, in this very project.

---

## What I did not do

No repository created. No file moved, renamed, redacted or deleted. No engine file touched —
verified: 0 files under `src/` modified. The plan is reversible in full because none of it has
happened.

**One decision is still open and it is yours:** Option A publishes an engine whose input types are
named for Reddit. If that is unacceptable for the public artifact, the alternative is not a rename
— it is deferring publication until the adapter seam is justified by a second consumer.
