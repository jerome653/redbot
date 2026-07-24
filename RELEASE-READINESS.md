# Release readiness — v0.1.0-alpha

**Date:** 2026-07-23
**Target:** `github.com/jerome653/redbot` ← `D:/AI/argus`
**Recommendation: DO NOT PUBLISH YET.** Four blockers, one of which is legal.

---

## Verdict

| | |
|---|---|
| **Recommended tag** | `v0.1.0-alpha.1` — not `v0.1.0-alpha` |
| **Recommended visibility** | **Public**, once the four blockers clear |
| **Confidence that the code is publishable** | **High** — no secrets, no machine paths, no third-party identities |
| **Confidence that the science is defensible** | **Low, and correctly so** — zero calibration-approved cases |
| **Confidence in the release mechanics** | **Medium** — no CI, no remote, stale CHANGELOG |

`v0.1.0-alpha.1` rather than `v0.1.0-alpha` because the CHANGELOG already reserves `[0.1.0-alpha]`
for a release that was planned with different contents. Starting at `.1` costs nothing and avoids a
tag whose notes disagree with what shipped.

---

## Blockers — 4

### B-1 · LICENSE grants nothing — **legal, absolute**

The current file says *"All rights are reserved… No permission is granted to use, copy, modify, or
distribute this software."* Publishing in that state means publishing source that no one may legally
use, fork or evaluate. Every other item is secondary to this one.

### B-2 · Employer name and private-repo commit hash in tracked content

`PUBLICATION-AUDIT.md` R-1 to R-4. Two of the four sit in files the extraction manifest covers, so
scrubbing them collides with the byte-identity claim. **Resolve the conflict deliberately** — option
A in that audit — rather than discovering it after the first clone reports DIVERGED.

### B-3 · Four broken links in argus, two in the README's own reading path

`README.md → ROADMAP.md` (missing), two `AGTC.md` references (never extracted), and one pointing
into gitignored `reports/`. A broken link in the first file a visitor opens is a cheap thing to fix
and an expensive first impression.

### B-4 · No CI

Nothing verifies a clone. Every gate figure in this project was measured on the author's machine.
Design below; not installed.

---

## Not blockers, but decide before tagging

| # | Decision | Recommendation |
|---|---|---|
| D-1 | Reviewer name `jerome` in the corpus (7 refs) | **Keep** — provenance of a human judgement; owner is already `jerome653` |
| D-2 | Third-party Reddit excerpts (2 threads, ~1 KB, no usernames) | **Keep**, and state the practice in the README |
| D-3 | `package.json` `"name": "argus"` vs public name `redbot` | Pick one and make everything agree |
| D-4 | `"private": true` | Correct if npm publication is not intended — confirm |
| D-5 | Does the operator console ship? | **No, not in this release.** It reads `data/`, `reports/` and the redbot CLI, none of which exist in an argus clone |

---

## License — recommendation: **Apache-2.0**

The placeholder states the actual requirement: *"whether attribution and modification terms should
require that a fork's verdicts are not presented as this project's verdicts."* That single sentence
decides it.

| | Non-endorsement | Change notices | Patent grant | Verdict |
|---|---|---|---|---|
| **Apache-2.0** | **yes** — §6 grants no trademark rights | **yes** — §4(b) requires modified files carry prominent notices | **yes**, with retaliation | **recommended** |
| BSD-3-Clause | yes — §3 non-endorsement | no | no | strong runner-up |
| MIT | no | no | no | **wrong fit here** |
| MPL-2.0 | limited | file-level reciprocity | yes | overkill unless reciprocity is wanted |

**Why Apache-2.0 specifically:**

1. **§6 (Trademarks)** grants no rights to the project's names or marks. A fork may use the code and
   may not present itself as this project — exactly the concern the placeholder raised.
2. **§4(b)** requires modified files to carry prominent notices of change. For an engine whose entire
   output is a *judgement*, a reader must be able to tell whether a verdict came from this engine or
   from someone's altered copy. MIT and BSD-3 cannot express that.
3. **Patent grant and retaliation** — the certification pipeline is a method. A permissive licence
   with no patent clause leaves that ambiguous for any organisation whose lawyers look.
4. It is the default for research tooling and passes corporate review without escalation.

**MIT is the wrong choice here** despite being the reflexive pick: it has neither non-endorsement nor
change-notice, which are the two properties this project actually asked for.

### Installing it — do not hand-type the text

I have not written the LICENSE file. A licence reproduced from memory with one altered word is a
genuine hazard, and the choice is yours to ratify.

```
1. Copy the canonical text verbatim from  https://www.apache.org/licenses/LICENSE-2.0.txt
   (or the SPDX registry). Do not retype it, do not summarise it, do not reformat it.
2. Save as LICENSE, replacing the placeholder.
3. Fill the appendix boilerplate: [yyyy] → 2026, [name of copyright owner] → your legal name or entity.
4. package.json:  "license": "Apache-2.0"
5. Optional: add a NOTICE file — Apache-2.0 §4(d) propagates it if present.
6. Update CHANGELOG under [Unreleased] → Added: "Apache-2.0 licence".
```

---

## GitHub readiness checklist

| File | State | Action |
|---|---|---|
| `README.md` | present, 102 lines, good | fix the `ROADMAP.md` link |
| `LICENSE` | **placeholder** | **B-1 — replace** |
| `SECURITY.md` | present, 58 lines; technically strong | add a reporting address (self-flagged) |
| `CONTRIBUTING.md` | present, 71 lines | verify it states the freeze policy |
| `CHANGELOG.md` | present but **stale** | c2/c3 committed but listed as future; state 37 vs 182 |
| `CODE_OF_CONDUCT.md` | **absent** | add Contributor Covenant 2.1, or state intentional absence |
| `.github/ISSUE_TEMPLATE/` | **absent** | recommended — a bug report template that demands the failing case |
| `.github/PULL_REQUEST_TEMPLATE.md` | **absent** | recommended — must require the freeze checklist |
| `.github/dependabot.yml` | **absent** | low value: 2 devDependencies, no runtime deps. **Intentional absence is defensible** |
| `.github/workflows/` | `.gitkeep` only | **B-4 — add `ci.yml`** |
| `.gitignore` | present, excellent | none |
| `.gitattributes` | present, `* -text` with reasoning | none |

**On absences that are correct:** dependabot for two dev-only dependencies is noise. Say so in
CONTRIBUTING rather than leaving it looking forgotten.

**PR template matters more than usual here.** The engine is frozen; a PR that edits `src/argus/`
must be rejected unless it carries benchmark evidence or human calibration. The template is where
that rule is enforced socially before CI enforces it mechanically.

---

## CI design

Five gates. **Not installed** — this is the design, ready to commit.

### The replay problem, and why the workflow must handle it rather than replay

`qa/ARE-001-argus-replay.mjs:40` does `process.exit(1)` when `data/certifications.jsonl` is absent.
`data/*` is gitignored, so **a fresh clone has no operational data and replay exits 1**. Measured in
`D:/AI/argus`: `replay exit=1`, message *"No certifications.jsonl on disk. Nothing to replay."*

Changing that exit code would be an engine change and is forbidden. **The workflow guards instead** —
it checks for the file and skips the step, reporting the skip rather than hiding it.

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  gates:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: ['20', '22']

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm

      - run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Tests
        run: npm test

      - name: Corpus validation
        run: node ground-truth/validate.mjs

      - name: Benchmark
        run: node qa/benchmark/run.mjs

      - name: Extraction verification
        run: node tools/verify-extraction.mjs

      # Replay needs operational data, which is gitignored and absent from a clone.
      # It exits 1 in that state by design, so the guard lives here rather than in
      # the harness -- the engine is frozen and must not be edited to suit CI.
      - name: Replay (ARE-001)
        run: |
          if [ -f data/certifications.jsonl ]; then
            node qa/ARE-001-argus-replay.mjs
          else
            echo "SKIPPED - no data/certifications.jsonl in a clean clone."
            echo "Replay requires a real certification record; data/ is gitignored."
          fi
```

**Design notes:**

- **`npm ci`, not `npm install`** — CI must fail on a lockfile that disagrees with `package.json`.
- **Node 20 and 22** — `engines` declares `>=20`; a claim nobody tests is a guess.
- **`fail-fast: false`** — when one Node version breaks, you want to know whether the other did too.
- **`permissions: contents: read`** — least privilege by default.
- **Extraction verification runs in CI**, which is the only way the byte-identity claim becomes
  continuously true rather than true-once-on-a-laptop.
- **No coverage gate.** Coverage thresholds on 37 tests would measure nothing and invite gaming.

### What CI will report on day one

| Gate | Expected on a clean clone |
|---|---|
| typecheck | pass |
| tests | **37/37** — argus's own suite, *not* redbot's 182 |
| corpus | exit 0 |
| benchmark | exit 0 — 4 cases, 4 passed |
| extraction | exit 0 — 39 verified, 0 deviated |
| replay | **SKIPPED**, with the reason printed |

---

## Known risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R-1 | **Zero calibration-approved corpus cases.** The engine has never been shown to agree with a human on a full case | **High** — this is the scientific gap, not an engineering one | Already disclosed in README and CHANGELOG. Do not soften it |
| R-2 | **Every real verdict is REJECT.** `CERTIFIED` and `ESCALATE` have never been produced on live input | **High** | An engine that has only ever said no is indistinguishable from one that always says no. State it |
| R-3 | Citation fidelity 4 full / 4 partial / 4 unsupported / 1 unverifiable (n=13) | **Medium** | Disclosed. It means contradictions the engine cites are right about half the time |
| R-4 | Scrubbing R-1/R-3/R-4 breaks the extraction manifest | **Medium** | `PUBLICATION-AUDIT.md` option A: scrub upstream, re-extract, regenerate |
| R-5 | Public repo named `redbot` containing a package named `argus` | **Low** | D-3 |
| R-6 | Third-party Reddit content redistributed under whatever LICENSE grants | **Low** | Short excerpts, no usernames, permalinked. State the practice and honour removal requests |
| R-7 | 37 vs 182 test counts read as the same number | **Low** | Fix the CHANGELOG sentence |

**R-1 and R-2 together are the honest headline.** The engineering is sound and the science is
unvalidated, and the release notes should say so in the first paragraph rather than the appendix. A
reader who discovers it themselves will trust nothing else in the repository.

---

## Ordered path to first release

```
 1. Ratify Apache-2.0; install canonical text; set package.json license      [B-1]
 2. Scrub R-2 (manifest provenance) — breaks nothing                         [B-2]
 3. Decide the scrub-vs-verify option for R-1/R-3/R-4; execute upstream      [B-2]
 4. Fix 4 broken links; port or drop AGTC.md                                 [B-3]
 5. Refresh CHANGELOG: c2/c3 as shipped; state 37/37 and 182/182 separately  [B-3]
 6. Add ci.yml, CODE_OF_CONDUCT, PR template, issue template                 [B-4]
 7. Resolve D-3 / D-4 naming and npm intent
 8. Push CI to a branch and let it run BEFORE configuring the public remote
 9. Configure remote, push main
10. Tag v0.1.0-alpha.1 with R-1/R-2/R-3 stated in the notes
```

Steps 1–7 are local. **Step 8 before step 9** — the first CI run should happen where a failure is
private.

---

## What this phase deliberately did not do

No remote configured · nothing pushed · no release created · no engine, benchmark, corpus, replay or
extraction code changed · LICENSE not written, because the choice is yours to ratify and the text
must be copied from the authoritative source rather than reproduced from memory.

---

## The one thing that is not on this list

Every blocker above is mechanical and could be cleared in an afternoon. **The adjudications cannot.**

Nine claims on HRC-001 and nineteen on CERT-002 need a human ruling, and no amount of release
engineering substitutes for them. The repository can ship without them — with R-1 and R-2 stated
plainly — but it ships as *a well-built engine of unproven accuracy*, and that is the honest
description until someone sits down with the adjudication packet.
