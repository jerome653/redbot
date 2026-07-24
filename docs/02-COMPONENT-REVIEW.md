# 2. Component review

One verdict per subsystem: **keep**, **keep but rework**, **retire**, or **unproven — do not
extend**. Portability column answers a single question: could this run against GitHub issues or
a forum without change?

---

## Collection

### `browser.ts` — attach, never launch

**Why it exists.** Every Playwright-launched browser gets a Reddit block page (E-01). Attaching
to a Chrome the operator opened works.

**Evidence:** four-mode experiment, `read` 0 → 25 threads.

**Weaknesses.** Identity detection is Reddit-DOM-specific and was wrong three ways before it was
right. The block page arrives as HTTP 200, so detection is body-text matching that will drift.

**Unknowns.** Behaviour across a Chrome restart, a real session expiry, and a second profile —
all four blocked cases in the Phase 1 auth matrix.

**Verdict: keep.** The attach model is the single best decision in the project — it removed the
need for a device fleet, means redbot never handles a credential, and makes the session genuinely
the operator's.

**Portability:** the *pattern* is fully portable; the identity selectors are not.

### `reddit/scrape.ts`, `selectors.ts`, `thread-state.ts`

**Why:** something must turn pages into records.

**Weaknesses.** Entirely Reddit-shaped. Lock/archive selectors are **unverified** (N-07). Search
scope contamination was a real defect (DEFECT-03).

**Verdict: keep, but this is the Reddit adapter** — it should be behind an interface before any
second platform is considered.

**Portability:** none. By design.

### `behavior.ts` + `rand.ts`

**Why:** a flat delay range is a machine signature regardless of width; dwell should follow
content.

**Evidence:** 15 tests, seed-replay determinism, 46.7% of sessions read-only.

**Weaknesses.** **Never run live** (N-12). Every rate is declared; `readingWordsPerMinute` is a
provisional placeholder. It is the largest untested subsystem in the project.

**Verdict: unproven — do not extend.** It is well-built and completely unvalidated. Adding to it
before one live session would be building on an unmeasured foundation.

**Portability:** high. Dwell/scroll/session-shape logic is platform-neutral; only the scroll
mechanics touch a page.

---

## Decision

### `argus/resolution.ts` — Phase 7

**Why:** HRC-001-A. The only "is this finished?" signal was a model's opinion and it failed on an
explicit `UPDATE:`.

**Evidence:** E-22 / E-23 — returns `resolved: true` on the exact thread the model missed, 0
model calls, verbatim regression test.

**Weaknesses.** String matching misses novel phrasings. Depends on `thread.author` to attribute
OP replies.

**Verdict: keep — and it is the highest-value module per line in the system.** 121 lines that
stop the failure three layers of machinery missed.

**Portability: total.** "The asker said they're done" is universal. This should be the first
module extracted to a platform-neutral core.

### `gap.ts`

**Why:** establishing what a discussion lacks *before* drafting; a reply written first will
always find a justification.

**Evidence:** 24 analyses; gaps are specific and checkable ("GA4 bot-filter toggle doesn't exist
as claimed in comment 1").

**Weaknesses.** `fillable` was true for **97%** of gaps (E-14) — the flag does no work.
`alreadyAnswered` missed an explicit resolution. Model-declared headroom disagreed with its own
gaps twice in 16.

**Verdict: keep but rework.** The gap *extraction* is genuinely good and is the strongest
model-driven component. The gap *self-assessment* fields (`fillable`, `alreadyAnswered`) have
each failed and both are now backstopped by deterministic checks. The pattern to generalise:
**ask the model for observations, never for verdicts.**

**Portability:** high — "what is this discussion missing" is not Reddit-specific.

### `opportunity.ts`, `competence.ts`, `select.ts`

**Why:** contribute-or-skip must be mechanical, and a system that finds an opportunity everywhere
has found none.

**Evidence:** scores now spread 100 → 47 after DEFECT-14; competence keeps 9/9 r/Wordpress and
rejects 4/5 r/webdev.

**Weaknesses.** Competence is a vocabulary proxy with hand-tuned regexes, discovered by printing
match traces. The 40/100 floor and the 60% contribute rate are **unvalidated against human
judgement** (N-11). `select.ts` now holds question-shape logic that arguably belongs elsewhere.

**Verdict: keep.** But every threshold here is declared and the calibration data does not exist.

**Portability:** medium. Scoring is neutral; `PILOT_SUBREDDITS` and the WordPress vocabulary are
deployment configuration masquerading as code.

---

## Generation

### `commands/draft.ts`, `prompts.ts`, `llm.ts`

**Why:** something must write the reply, under a contract that forces it to state what it adds
and permits it to decline.

**Weaknesses.** The contract has produced exactly **one** draft; 0 declines have been observed,
so "the model may decline" is an untested affordance. `llm.ts` carries hard-won subprocess
isolation (DEFECT-06) and stream handling (DEFECT-09) that is easy to regress.

**Verdict: keep.** But note the inversion: this is the component the project is *named* after and
it is now the least architecturally interesting one. Everything valuable that has been learned is
about deciding whether to draft, and judging what was drafted.

**Portability:** the prompts are WordPress/Reddit-flavoured; the contract shape is universal.

---

## Verification

### `disclosure.ts` — safety linter

**Evidence:** 31/31 adversarial blocks, 10/10 must-pass; caught two real leaks retrospectively.

**Weaknesses.** Regex-based and only as wide as the last failure. Widened twice after live leaks.

**Verdict: keep.** It does exactly one job — protecting the operator from exposure — and does it
well. It should never be asked to judge correctness; conflating the two is how HRC-001 happened.

**Portability: high.** Agent-leakage, brand and fabricated-experience checks are platform-neutral.

### `quality.ts` — craft gate

**Weaknesses.** **It rewards confident prose.** HRC-001 scored well here. Specificity and hedge
counts are proxies that a wrong answer can satisfy perfectly.

**Verdict: keep, with its scope explicitly narrowed in documentation.** It measures readability
and register. It must never be cited as evidence of correctness — that misreading is precisely
what Argus exists to correct.

**Portability: total.**

### `novelty.ts`

**Weaknesses.** One probable **false positive** in one production use (blocked a correct draft
that referenced thread facts to build on them). Threshold declared, never fitted (N-10).

**Verdict: keep but rework — blocked on operator data.** It cannot be tuned without the review
dataset, and the review dataset is empty. This is the clearest case where further engineering is
pointless until evidence exists.

**Portability: total.**

### `argus/*` — truth certification

**Why:** HRC-001 proved no text-level proxy measures truth.

**Evidence:** 27 tests; the acceptance criterion is met via Phase 7 (E-23); extraction produces
correctly-typed atomic claims (E-24).

**Weaknesses.** **Provenance is self-declared and was inflated on its first real run** (E-25) —
the model claimed `official-implementation` for a false claim. Refutation is slow and was
best-effort until Rule 8 (E-26). **The claim path has never completed end to end** (N-05).

**Verdict: keep — it is the most important layer — but it is `experimental`, not validated.**
The deterministic half (resolution, graph, epistemic, verdict) is solid and tested. The
model-driven half has one partial run and a known inflation problem.

**Portability: total, and it is the most valuable thing here.** Claims, provenance classes,
contradiction, dependency graphs and epistemic calibration have nothing to do with Reddit.

### `gates.ts` — 20 fail-closed gates

**Weaknesses.** Required the Phase-1 triage record until today, making the whole Phase-3 path
unpublishable (E-17) — an integration gap invisible to a green suite. Several gates
(`locked`, `archived`, rate-limit cooldown) have **never fired**.

**Verdict: keep.** "Ambiguity resolves to silence" is the right rule and it is implemented
consistently.

**Portability:** the *framework* is portable; roughly half the individual gates are Reddit-shaped.

---

## Human layer

### `ask.ts`, `commands/reply.ts`, `review.ts`, `regret.ts`

**Why:** the boundary the whole project now rests on — the human is accountable for the published
statement.

**Evidence:** DEFECT-08 regressions including one that reads the call site; two independent layers
now refuse agent publication (E-31).

**Weaknesses.** **`reviews.jsonl` and `regret.jsonl` are both empty.** The entire calibration
strategy depends on data that does not exist yet.

**Verdict: keep — and this is the project's bottleneck, not its risk.** Everything else is
waiting on it.

**Portability: total.**

---

## Observation and diagnosis

| Module | Verdict | Note |
|---|---|---|
| `observe.ts` | keep — **unproven** | Signed-out vector never executed (N-04); it is the only check that detects the failure mode that matters |
| `health.ts` | keep | 14 tests, correct state machine; most states unreachable without production |
| `doctor.ts` | keep | Build-staleness check earns its place on its own |
| `trace.ts` / `insights.ts` / `metrics.ts` | keep | 299 events; already produced three findings |
| `reports.ts` / `argus/reports.ts` | keep, watch size | 841 lines of report generation across two modules — the largest non-obvious surface in the codebase |
| `policy.ts` | keep | Provenance tagging is one of the best conventions here |

---

## Two structural observations

**1. The centre of gravity moved and the code has not.** The project is named for drafting, but
drafting is now one module among fifteen that decide *whether* to draft and *whether to trust*
the result. The directory layout still implies a Reddit bot with some checks bolted on; the
system is actually a contribution-certification engine with a Reddit adapter.

**2. Report generation is disproportionate.** `reports.ts` (557) + `argus/reports.ts` (284) =
841 lines, ~9% of the codebase, generating 13 documents — for a system with **zero** published
interactions. That is defensible for an evidence campaign and would be indefensible for anything
else. It should be watched, not cut.
