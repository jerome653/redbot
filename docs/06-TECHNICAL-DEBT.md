# 6. Technical debt

Grouped by how it got there. **Intentional** debt was a considered trade; **accidental** debt was
not noticed at the time; **temporary** debt has a defined end; **unknown** debt is where the
project cannot currently see.

Impact estimates are about future cost, not present pain.

---

## Intentional — taken knowingly

| # | Debt | Why it was accepted | Future impact |
|---|---|---|---|
| D-01 | **Two decision paths for one decision.** `analyze` → `analysis.json` (Phase 1) and `opportunity` → `assessments.json` (Phase 3) both exist; `gates.ts` accepts either | Phase 3 shipped without retiring Phase 1 so old drafts stayed judgeable under the rules they were written under | **High.** Already caused a real defect (E-17: every Phase-3 thread unpublishable). Two sources of truth for "is this thread worth replying to" will drift again |
| D-02 | **`select.ts` holds logic that outgrew it** — `isQuestionShaped`, `SHOWCASE`, `ANNOUNCEMENT_TAG`, `currentAgeHours`, `PILOT_SUBREDDITS` | Each was added where it was first needed | Medium. `gates.ts`, `opportunity.ts` and `reports.ts` all import from a module named for candidate ranking |
| D-03 | **Regex-based linting throughout** — disclosure, quality, competence, resolution | Deterministic, testable, and a model cannot argue with it. The mechanical-over-prompt rule is a deliberate architectural choice | Medium and permanent. Each list is only as wide as the last observed failure; four English-word false positives were found in competence alone (E-16) |
| D-04 | **Data files are not versioned or backed up** | `data/` must be gitignored (DEFECT-01) and there is no second machine | **High if it materialises.** All 31 proven observations live in files with no backup. Evidence loss would be unrecoverable |
| D-05 | **13 generated reports, 841 lines of generator** | The evidence campaign made reporting the deliverable | Medium. Every schema change touches them; disproportionate for 0 published interactions |
| D-06 | **The novelty false positive left unfixed** | N=1, and the review dataset that should calibrate it is empty | Low now, medium later. It silently costs good drafts until there is data |

## Accidental — not noticed at the time

| # | Debt | How it happened | Future impact |
|---|---|---|---|
| D-07 | **`Thread`, `Comment`, `Draft` are Reddit-shaped types used everywhere** | Written for Reddit before portability was a consideration | **High if a second platform is ever wanted.** ~6,400 lines of otherwise-portable code depend on Reddit-shaped types. There is no adapter seam |
| D-08 | **Deployment configuration living in source** — `PILOT_SUBREDDITS`, competence vocabulary, `expertise[]`, brand | Each was a constant when written and became configuration when operated | Medium. Every one has already required a code edit during normal operation |
| D-09 | **Derived values stored rather than derived** | `ageMinutes` was stamped at collection and read as current | Was **high** — a gate silently passed what it existed to stop (E-18). Fixed for age; the pattern may exist elsewhere |
| D-10 | **Measurements that never reach a log** | `probe-karma` printed to a terminal | Was medium — the health machine contradicted a real measurement. Fixed. The general risk remains wherever a command prints instead of records |
| D-11 | **Model self-assessment fields trusted as inputs** | `fillable`, `alreadyAnswered`, `headroom`, `evidenceClass` all began as trusted | **High, partially paid.** Each has failed at least once. Backstops exist for headroom (recomputed), resolution (deterministic) and unrefuted claims (Rule 8). `fillable` is still read and still 97% true |
| D-12 | **`reply.ts` at 323 lines does too much** | Grew with each phase: gates, behaviour, review capture, re-probe, publish | Medium. It is the highest-consequence file and the hardest to reason about |

## Temporary — with a defined end

| # | Debt | Ends when |
|---|---|---|
| D-13 | **The recorded credential exception** — operator `jerome` points at the machine-wide Claude config instead of a dedicated one | A dedicated login is created. Announced on every run by design, so it cannot go quiet |
| D-14 | **6 provisional operational limits** quoted nowhere as findings | Production observation replaces them. `redbot policy` prints the split every time |
| D-15 | **10 pending drafts**, several generated under superseded rules | They age out via the 24-hour stale-draft gate, or are decided at the prompt |
| D-16 | **`STATUS.md` describes the Phase 1 MVP** | Superseded in place with a pointer; should be retired once the architecture docs are the entry point |
| D-17 | **Two certifications, both REJECT** | A sound draft is certified and the CERTIFIED path is demonstrated (N-06c) |

## Unknown — where the project cannot see

| # | Blind spot | Why it is invisible |
|---|---|---|
| D-18 | **Everything about publishing.** 104 lines never executed | No publish has occurred. Selector correctness, submit behaviour, confirmation logic and permalink capture are all assumptions |
| D-19 | **Whether the thresholds are anywhere near right** | Novelty 70%, opportunity floor 40, confidence floor 70, contribute rate 60% — all declared. The only instrument that could calibrate them is an operator verdict, and there are none |
| D-20 | **Selector drift rate** | `selector.miss` has never fired, so its sensitivity is unmeasured. A partial break would degrade quality without failing |
| D-21 | **Refutation miss rate** | It caught the one false claim it was tested against. How often it *misses* cannot be known without a false claim that survives it |
| D-22 | **Long-run behaviour** | No session has run beyond a few minutes. Memory, session expiry, Chrome restart, cookie rotation all unobserved |
| D-23 | **Whether the behaviour engine resembles a person at all** | Every rate is declared. It has never run live, and no one has compared it to a real operator's traces |

---

## The debt that matters

Ranked by expected future cost:

1. **D-01 — two decision paths.** Already caused one production defect. It will cause another.
2. **D-18 / D-19 — the publish path and every threshold are unknown.** Not fixable by engineering;
   only by publishing once and recording one verdict.
3. **D-11 — model self-assessment as input.** The single most repeated failure pattern in the
   project, only partially paid down.
4. **D-04 — no backup of the evidence.** Cheap to fix, catastrophic if it lands.
5. **D-07 — no adapter seam.** Expensive, but only if a second platform is actually wanted.

Everything else is maintenance.
