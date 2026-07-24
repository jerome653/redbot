# Documentation audit

**Date:** 2026-07-23
**Scope:** 10 markdown files in `D:/AI/argus` · 76 in `D:/AI/Clients/SGEN/Projects/redbot`
**Method:** automated reference resolution + claim cross-check
**Files modified by this audit: 0**

---

## Method note — the first result was wrong

The initial reference checker resolved every relative link against the repository root and reported
**54 broken references in redbot**. That was a checker defect: markdown links resolve against the
*containing file*, so `docs/11-EVIDENCE-BACKLOG.md → 08-EVIDENCE-INDEX.md` is correct and was being
flagged as broken.

Corrected, and separating genuinely-unresolvable references from prose abbreviations
(`argus/graph.ts` meaning `src/argus/graph.ts`):

| Repository | Genuinely broken | Abbreviated (cosmetic) |
|---|---|---|
| argus | **4** | 4 |
| redbot | **7** | 33 |

The 33 abbreviated paths are readable shorthand in prose and are **not** defects. They are listed
last for completeness, not for action.

---

## argus — 4 broken references, all publication-visible

| File | Reference | Problem |
|---|---|---|
| `README.md:64` | `[ROADMAP.md](ROADMAP.md)` | **file does not exist.** A broken link in the README of a public repository, in a sentence explaining what is deliberately not built |
| `ground-truth/README.md` | `../AGTC.md` | `AGTC.md` was never extracted into argus — it lives only in redbot |
| `qa/benchmark/README.md` | `../../AGTC.md` | same |
| `qa/benchmark/README.md` | `reports/HRC-001-custom-css-updraft.md` | `reports/*` is **gitignored**, so this can never resolve in a clone |

**Assessment:** all four are pre-publication blockers of the cheap kind. Either create `ROADMAP.md`
and port `AGTC.md`, or rewrite the four sentences. The `reports/` reference is the interesting one —
it points at a file the `.gitignore` guarantees will never exist for a reader, which is a category of
error worth checking for elsewhere.

---

## argus — content accuracy

### A-1 · CHANGELOG describes committed work as future — **stale**

```
### Notes
- No engine code is present yet. The certification engine, benchmark, replay harness and
  ground-truth corpus arrive in `c2`–`c3` …
```

`c2` (`b10b68c`) and `c3` (`fc7ee64`) are both committed. The engine *is* present. The `[Unreleased]`
section still lists only the `c1` scaffold under **Added**.

### A-2 · The 182 figure is not argus's number — **misleading**

`CHANGELOG.md` states *"The frozen baseline at time of extraction: 182/182 tests."* True of redbot.
**Argus's own suite is 37/37** — it contains `src/test/argus.test.ts` and `src/test/llm-json.test.ts`
only. A reader will not make that distinction unaided.

Measured just now in `D:/AI/argus`: `npm test` → **tests 37 · pass 37 · fail 0**; typecheck clean;
corpus exit 0; benchmark exit 0.

### A-3 · SECURITY.md has no reporting address — **acknowledged placeholder**

Self-declared: *"Placeholder — a reporting address is added before v0.1.0-alpha."* The technical
content beneath it is accurate and unusually specific.

### A-4 · LICENSE is a placeholder that grants nothing — **blocking**

*"All rights are reserved… No permission is granted to use, copy, modify, or distribute."*
Publishing in this state means publishing source that nobody may legally use. See
`RELEASE-READINESS.md` §License.

---

## redbot — 7 broken references

| File | Reference | Verdict |
|---|---|---|
| `docs/07-MODULE-MATURITY.md` | `commands/analyze.ts` | **obsolete — file does not exist.** `src/commands/` contains backup · certify · doctor · draft · history · login · observe · opportunity · read · regret · reply · search · session · status. There is no `analyze.ts` |
| `docs/11-EVIDENCE-BACKLOG.md` | `commands/analyze.ts` | same |
| `docs/12-FINAL-PHASE-ASSESSMENT.md` | `commands/analyze.ts` | same |
| `ARGUS-PUBLICATION-PLAN.md` | `docs/EVIDENCE-INDEX.md` | wrong name — the file is `docs/08-EVIDENCE-INDEX.md` |
| `FINAL-OPERATOR-REPORT.md` | `CERT-002/LABELLING-WORKSHEET.md` | abbreviated; full path is `ground-truth/cases/CERT-002/…` — **mine, from Phase 9; fixed in this pass** |
| `FINAL-OPERATOR-REPORT.md` | `HRC-001/ADJUDICATION-PACKET.md` | same — **fixed in this pass** |
| `_superseded/plan-docs/Requirements/10-MVP-BOUNDARY.md` | `engineering/WORKFLOW-SCHEMA.md` | inside `_superseded/`; no action |

**`commands/analyze.ts` appearing in three separate architecture documents** is the most substantive
documentation defect found. Three docs describe a module that does not exist, which means at least
one of them was written from a plan rather than from the tree, and the other two inherited it.

---

## redbot — contradictions between documents

### C-1 · Test count: 169 vs 182

| Claim | Location |
|---|---|
| **169 tests** | `REDBOT-NEXT-ITERATION.md:5`, `docs/03-LESSONS-LEARNED.md:295`, `docs/08-EVIDENCE-INDEX.md:47` (E-30) |
| **182 tests** | `ENGINE-FREEZE.md:65`, `RUNTIME-AUDIT.md:25`, `ARGUS-PUBLICATION-PLAN.md:59`, `FINAL-OPERATOR-REPORT.md`, `OPERATOR-CONSOLE.md` |

**182 is current** — re-measured this session. The 169 figures are historical and were accurate when
written. `docs/08-EVIDENCE-INDEX.md` is the one that matters: it is an *evidence index*, and E-30
records a measurement. An evidence register carrying a superseded number is worse than prose doing
the same, because its whole purpose is to be citable.

**Recommendation:** date-stamp E-30 as `169 (2026-07-23, superseded by 182 same day)` rather than
overwriting. The count changed because tests were added, which is information, not an error.

### C-2 · "No interface exists" — resolved this session

`RUNTIME-AUDIT.md` originally asserted no UI, no HTTP server, and no exposed API. All three became
false when the operator console shipped. **Already corrected in Phase 9** with dated amendments in
§3, §4 and §6, and a new §11 — the original text was left in place beneath each amendment, so the
document still records what was true on the day it was written.

No other document made those claims. Verified by grep across all 76 files.

---

## redbot — duplicates and overlap

| Documents | Relationship | Recommendation |
|---|---|---|
| `PUBLICATION-READINESS.md` (99 lines) · `ARGUS-PUBLICATION-PLAN.md` (220) · this audit · `RELEASE-READINESS.md` | four documents on publication, written at different phases | **Consolidate to two:** `RELEASE-READINESS.md` as the live checklist, the older pair marked superseded with a pointer. They are not contradictory — they are sequential — but four entry points to one question is three too many |
| `PHASE-2.md` · `PHASE-3.md` · `PHASE-A-BRIEF.md` · `EVIDENCE-CAMPAIGN.md` | phase briefs, all complete | **Move to `_superseded/`** or add a completion banner. They read as active plans |
| `docs/12-FINAL-PHASE-ASSESSMENT.md` · `REDBOT-NEXT-ITERATION.md` · `docs/09-ROADMAP.md` | three forward-looking documents | Not duplicates — different horizons — but they should cross-reference each other, and currently do not |
| `OPERATOR-CONSOLE.md` · `FINAL-OPERATOR-REPORT.md` | Phase 9 output | Intentional: one is reference, one is the report. Keep both |
| `ACCOUNT-WARMING.md` · `MULTI-ACCOUNT-RISK.md` · `WHY-NO-ANDROID.md` | decision records for paths **not** taken | Keep. Documents explaining why something was refused are the ones most likely to be re-litigated |

---

## Documents verified accurate — no action

`ENGINE-FREEZE.md` · `AGTC.md` · `ARGUS.md` · `OBSERVATION-SCHEMA.md` · `README.md` ·
`docs/01`–`06`, `09`, `10`, `13` · `STATUS.md` · `PRODUCTION-READINESS.md` ·
argus `README.md` (apart from the ROADMAP link) · `CONTRIBUTING.md` · `docs/EXTRACTION-BASELINE.md`
(apart from the employer references in `PUBLICATION-AUDIT.md` R-2) · `qa/ARE-001-RESULTS.md` ·
`qa/benchmark/README.md` (apart from two broken links).

---

## Abbreviated paths — cosmetic, listed for completeness

33 occurrences across 8 redbot documents and 1 argus document, all of the form `argus/graph.ts` for
`src/argus/graph.ts` or `commands/reply.ts` for `src/commands/reply.ts`.

`docs/01-CURRENT-ARCHITECTURE.md` · `docs/02-COMPONENT-REVIEW.md` · `docs/04-REDDIT-VS-PLATFORM.md` ·
`docs/05-RISK-REGISTER.md` · `docs/07-MODULE-MATURITY.md` · `docs/09-ROADMAP.md` ·
`docs/12-FINAL-PHASE-ASSESSMENT.md` · `ARGUS-PUBLICATION-PLAN.md` · `docs/EXTRACTION-BASELINE.md`

**No action recommended.** They are unambiguous in context and expanding them would add noise. Noted
so that a future automated link check does not rediscover them as findings.

---

## Priority order

**Before publication:**
1. argus LICENSE — blocking (`RELEASE-READINESS.md`)
2. argus README `ROADMAP.md` link — broken link in the first file anyone reads
3. argus `AGTC.md` references ×2 — port the file or rewrite the sentences
4. argus `reports/` reference — points at a gitignored path
5. argus CHANGELOG — c2/c3 stale, and 37 vs 182 stated

**Before the next engineering phase:**
6. `commands/analyze.ts` in three architecture docs
7. E-30 test count in the evidence index
8. `docs/EVIDENCE-INDEX.md` → `docs/08-EVIDENCE-INDEX.md`

**Housekeeping, any time:**
9. Consolidate the four publication documents to two
10. Banner or archive the four completed phase briefs
