# Phase 2 — human operator certification

What was built, what it refuses to do, and how to run the parts that need a person or a clock.

Status and the recommendation live in [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md).

---

## Part A — behaviour engine · `src/behavior.ts`, `src/rand.ts`, `src/policy.ts`

Replaces one flat delay range with behaviour shaped by what is on screen.

| Requirement | How |
|---|---|
| Variable dwell by thread length | `dwellMsFor()` — word count × coverage ÷ reading rate, coverage falls as threads get longer |
| Read comments before replying | `viewThread(..., { thorough: true })`, run by `reply` before the approval prompt |
| Realistic scroll depth | `scrollPlan()` — partial depth, variable step size, ~14% of steps scroll back up |
| Pauses without interaction | `policy.idlePauseRate` (18% of thread views) |
| No perfectly regular timing | `skewedDelay()` — bell-ish body with a heavy tail, never uniform |
| Return to the subreddit, open another thread first, abandon | `nextMove()` — weighted, weights shift as the budget drains |
| Short (5–10 min) and medium (15–30 min) sessions | `planSession()` |
| Session termination without posting | `plan.mayReply`, decided **before** anything is read; measured over 1,000 seeds at 46.7% of sessions permitting a reply |

Every random draw goes through a seeded PRNG, so a session replays exactly:
`REDBOT_SEED=<seed> redbot session`. The seed is printed at session start and logged.

**This is not detection evasion.** Nothing spoofs a fingerprint or defeats a bot check — the
browser is the operator's own, signed in by them, and a reply needs their keystroke. Slower,
partial, often-no-action reading is gentler on the site and leaves room to change your mind.

## Part B — account health · `src/health.ts`

Four states from two append-only logs. `Healthy` and `Caution` may publish; `Cooldown` and
`Stop` may not.

| State | Triggered by |
|---|---|
| **Stop** | a suspension notice · ≥2 observed removals in 30 d · ≥2 login failures in 24 h |
| **Cooldown** | a 429 (30 min) · an observed removal (24 h) · the daily reply ceiling · reply spacing |
| **Caution** | karma below 10 or never measured · account under 7 days · a reply not visible signed out |
| **Healthy** | no counter near a threshold |

Tracked: reads, searches and replies today; average session and dwell; 429s; login failures;
observed removals; observed signed-out absences; account age; karma.

**Observed, never inferred.** A comment that a logged-out browser did not render is recorded as
`reply-absent-signed-out` — not as "shadowbanned", "filtered" or "automod". The state machine
reacts to the observation; nothing in the codebase claims a cause it cannot see.

`redbot health` prints the state and every counter behind it.

## Part C — reply quality · `src/quality.ts`

The craft gate, separate from the safety linter in `src/disclosure.ts`.

Blocks: AI-register clichés (21 phrases) · a reply sharing no specific vocabulary with its
thread · under 25 or over 500 words · stated certainty when triage confidence was below 70.
Warns: padding · no second person · markdown headings · bold-heavy · uniform sentence rhythm.

It also returns a `humanChecklist` — technical correctness and "does this answer what was
actually asked" are not decidable by regex, so they are printed at the approval prompt as open
questions rather than silently implied to be handled.

## Part D — safety gates · `src/gates.ts`

One pure function, 18 distinct refusal conditions, every one failing closed. Run twice: before the human
is asked, and again against a freshly probed page immediately before the submit.

`linter` · `quality:*` · `identity` (unestablished / logged out / unnamed / wrong account) ·
`triage` · `confidence` · `priority` · `promotion` · `not-a-question` · `stale-thread` ·
`stale-draft` · `thread-state` (unprobed) · `locked` · `archived` · `duplicate` (page and
drafts file) · `no-composer` · `unknown-state` · `unexpected-ui` · `health`.

Unknown is not permission: a probe that cannot establish a fact blocks.

---

## Part E — the production experiment

Selection is mechanical and explainable: `redbot select` prints a per-criterion verdict for
every analyzed thread and labels the two proxies as proxies.

```
node dist/cli.js session --kind medium --sub wordpress   # collect, human-shaped, reads only
node dist/cli.js analyze
node dist/cli.js select                                  # per-criterion, picks one
node dist/cli.js draft <threadId>
node dist/cli.js reply <draftId>                         # REAL TERMINAL — gates, then a keystroke
node dist/cli.js observe --checkpoint immediate
```

`reply` will refuse a pipe, a file or a runner. That refusal is the mechanism that makes every
published word attributable to a person.

**Current position: 0 of 45 collected threads are eligible** after DEFECT-11 and DEFECT-12.
A fresh collection run is required. See PRODUCTION-READINESS.md → Blocking the pilot.

## Part F — observation

```
node dist/cli.js observe                        # every published reply, checkpoint by elapsed time
node dist/cli.js observe <draftId> --checkpoint 24h
```

Two vectors per checkpoint. Signed-in answers "is it there for the author"; signed-out answers
"is it there for everyone else" — the second is the one that matters, and the failure mode
ACCOUNT-WARMING describes is visible only from it. If a logged-out context cannot be opened,
the check is reported UNAVAILABLE; the signed-in result is never substituted for it.

Records presence, any removal notice verbatim, score and child-reply count, to
`data/observations.jsonl`. Facts only.

## Part G — reliability

```
node dist/cli.js metrics [--json]
```

Session success rate · draft approval rate · publish success rate · 429s per 100 page loads ·
selector misses · browser crashes · login persistence · average session duration.

Rates print with their denominator and read `no data (0 samples)` when empty — a 1/1 is never
rendered as 100%.

## Part H — release report

[PRODUCTION-READINESS.md](PRODUCTION-READINESS.md).

---

## Operational limits

`redbot policy` prints all 24 with provenance:

- **measured** — from a recorded observation, with the evidence path (currently 1)
- **declared** — a rule we chose (17)
- **provisional** — a safe placeholder, not a finding (6)

Phase 2's principle is that a limit must be measured before it becomes policy. Most have not
been, so rather than pretending otherwise, each one carries its status and the report lists the
placeholders as unknowns.
