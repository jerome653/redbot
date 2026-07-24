# Phase 3 — product validation

The question Phase 3 asks is not "can it post" but **"can it repeatedly find discussions where
a knowledgeable person can add something worth reading"**. Automation was never the metric.

Results live in [reports/](reports/), regenerated from the data files by `redbot report`.
Status and the recommendation live in [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md).

---

## The ordering change that defines this phase

Phase 2 asked "is this thread worth replying to?" and answered from the title, the score and
the age. Phase 3 asks "**what is this discussion missing?**" and answers from the comments —
before a draft exists.

That ordering is the whole design. A reply written first and justified afterwards will always
find a justification; a gap established first can come back empty, and "this thread is already
answered" becomes a result rather than a failure.

```
collect → gap analysis → opportunity → draft (may decline) → novelty check → gates → human → publish → observe
             ▲                                     ▲
             │                                     │
    what is already said            tested against what was already said
```

## Knowledge Gap Analyzer · `src/gap.ts`

One model call per thread, reading the comments rather than the title. Returns:

- `question` — what the asker actually needs to know
- `covered[]` — every distinct claim already made. This becomes the **do-not-repeat list**
- `gaps[]` — each one `unanswered` · `partial` · `incorrect` · `unverified` ·
  `missing-diagnostic`, each marked fillable or not from the declared competence
- `alreadyAnswered` — an explicitly allowed, normal outcome
- `headroom` 0–100

**The headroom the model returns is discarded and recomputed locally** from the gaps it just
listed. Same reasoning as DEFECT-12: a band a model is asked to compute is a band it can skip.
Every disagreement is logged as `headroom.corrected`, which makes "the model is not applying
its own rubric" a countable event instead of an impression.

## Opportunity Engine · `src/opportunity.ts`

Mechanical over the gap analysis — no second model call, no free-choice score.

| Band | Points | Why |
|---|---|---|
| a fillable `incorrect` or `missing-diagnostic` gap | +45 | a wrong claim left standing sends the asker backwards |
| a fillable `unanswered` gap | +40 | they are left where they started |
| a fillable `partial` or `unverified` gap | +20 | the answer stops short |
| no technical content in the comments at all | +15 | the field is open |
| more than one kind of gap | +10 | the thread is genuinely underserved |

Capped at 100. `alreadyAnswered` caps the whole thing at 15. A thread that asks nothing, or is
past the 72 h ceiling, is capped below the floor regardless of its gaps.

**Floor: 40** — exactly one fillable `unanswered` gap and nothing else. That is the minimum
case that still describes a real contribution: someone asked, nobody answered that part, and
we can.

> The first version of this engine scored the same evidence twice, under two rankings that
> disagreed — the headroom bands ranked an uncorrected wrong claim *below* an unanswered
> question while the kind weights ranked it above. The tests caught it. The score is now the
> headroom plus a breadth bonus, and the kind weights only choose which gap the thesis is
> written from.

## The draft contract · `src/prompts.ts`, `src/commands/draft.ts`

Every draft must state, before the body:

1. **why this thread is worth replying to**
2. **what new information the reply contributes**
3. **why the reply is better than remaining silent**

The model may set `contribute: false` and write nothing. That is recorded as `draft.declined`
and is a correct outcome — it is the drafting stage agreeing that silence is better.

## Novelty check · `src/novelty.ts`

The draft's own account of what it adds is **not evidence**. Both `whatNew` and the body are
tested against `covered`, which was extracted before the draft existed. Overlap at or above
**70%** of a claim's content words marks a restatement and blocks publishing.

> This is a **proxy**, labelled as one at every point of use. It compares content words: two
> sentences can share vocabulary and mean opposite things. What it reliably catches is a reply
> walking back over the thread's own ground in the thread's own words. The 70% threshold is
> declared, not measured — re-fitting it against operator judgement is one of the review
> dataset's jobs.

## Operator Review Dataset · `src/review.ts` → `data/reviews.jsonl`

Every decision at the approval prompt, with a fixed reason code and a free-text note. Snapshots
the craft metrics, the gate results, the novelty result and the draft's own thesis **at decision
time**, so changing a threshold later cannot rewrite the history of what a person was looking at.

Rejection codes point at a stage: `already-covered` indicts the gap analyzer's extraction,
`inaccurate` indicts the drafting model, `tone` indicts the craft gate.

---

## Deep logging and health checks

Added on request during this phase. Three separate things, deliberately not merged:

| Command | Question | Source |
|---|---|---|
| `redbot doctor` | is the **install** sound? | build freshness, auth, data integrity, secrets, staleness |
| `redbot insights` | where is the **pipeline** losing candidates? | `data/trace.jsonl` + the data files |
| `redbot health` | is the **account** sound? | `data/history.jsonl` + `data/observations.jsonl` |

**Two logs, two jobs.** `history.jsonl` is the account's activity record — what redbot did to
Reddit — and it feeds the health machine and the reliability metrics. `trace.jsonl` is
engineering telemetry: stage timings, drop reasons, decision traces. Pouring telemetry into the
account record would inflate the counters that answer for the account's behaviour with events
that never touched Reddit.

`doctor` earns its place on one check in particular: **build freshness**. It compares the
newest source mtime against the newest compiled mtime and FAILs if source is newer. Running
yesterday's compiled code against today's source is the failure mode that survives a green
test suite.

`insights` maps each loss back to the component that caused it, because a funnel that only
says "most threads are rejected" is not actionable:

| Where candidates are lost | What it indicts |
|---|---|
| dropped at the prefilter | the collector — wrong subreddits or wrong sort |
| no fillable gap | the competence list, or the subreddit match |
| already answered | arrival time — collect more often, not more widely |
| model declined | the Opportunity Engine, passing threads the drafter won't take |
| novelty blocked | the drafting prompt ignoring the do-not-repeat list |
| rejected `already-covered` | the gap analyzer's claim extraction |
| rejected `inaccurate` | the drafting model on that topic |

Every signal carries its denominator, so a signal over a sample of two reads as a hint.

---

## Commands added

```
redbot opportunity [--force] [--limit N]   gap analysis + contribute-or-skip
redbot review                              operator decisions, by reason
redbot report                              regenerate every report in reports/
redbot doctor                              install health; exit 1 on any FAIL
redbot insights                            funnel, improvement signals, stage timings
```

`REDBOT_TRACE=off` disables telemetry. It is on by default — a telemetry file that has to be
switched on is a telemetry file that is empty on the day you need it.
