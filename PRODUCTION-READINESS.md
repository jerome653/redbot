# redbot — Production Readiness Report

**Date:** 2026-07-23 · **Phase:** 3 (product validation) · **Build:** TypeScript strict, 0 errors
**Tests:** 184/184 pass · **Leakage fuzz:** 31/31 blocked, 10/10 must-pass
**Replies published to Reddit, all time: 0**

> **Superseded in part, 2026-07-23 (later the same day).** The test figures below were written
> at 134 and at 93 in different sections; both are stale — the suite is **184/184**. Blocker 1
> ("operator Claude credentials") is **RESOLVED**: the recorded exception in
> `data/operators/operators.json` was exercised end to end by a real `redbot certify` run, and
> `doctor` reports 0 failures. Blocker 3 (a person at a terminal) still stands and is now the
> only one. Current state, recomputed from evidence rather than from this document:
> [`docs/12-FINAL-PHASE-ASSESSMENT.md`](docs/12-FINAL-PHASE-ASSESSMENT.md).

Phase 3 detail: [PHASE-3.md](PHASE-3.md) · generated results: [reports/](reports/)

---

## What Phase 3 changed about this report

Phase 2 could say the machinery was safe. It could not say whether redbot finds discussions
worth replying to, because nothing measured contribution. Phase 3 measured it, on the real
corpus, and the answer is **yes for finding gaps, with three defects fixed along the way**:

| | |
|---|---|
| Threads collected | 45 |
| Survive the mechanical prefilter | 15 |
| Gap-analyzed (one model call each) | 16 |
| **Assessed worth contributing to** | **9** (60% of assessed) |
| Drafted under the Phase 3 contract | 1 |
| Passed linter + novelty + craft | 1 of 1 |
| **Decided by a person** | **0** |
| **Published** | **0** |

The gaps found are specific and checkable — *"GA4 bot-filter toggle doesn't exist as claimed in
comment 1"*, *"asker lists 'PHP or Liquid' but Shopify doesn't support PHP"*, *"nobody asked
which widget type, WordPress version, or active theme"*. That is the capability the phase set
out to demonstrate, and it demonstrates it.

What it does **not** yet demonstrate is the second half of the success criterion — "replies a
human is willing to publish with little or no editing" — because **no draft has been decided by
a person**. The review dataset is built, wired and empty. Every rate derived from it reads
`no data (0 samples)` and must not be quoted as anything else.

---

## Recommendation

> ### Ready for internal testing only.

Not "ready for a limited single-account production pilot", and the distinction is the whole
report. Every gate the pilot needs now exists and is tested, but three of the criteria that
would justify a production pilot have a sample size of zero:

| Criterion | Evidence | Verdict |
|---|---|---|
| A reply publishes successfully | 0 attempts, 0 successes | **unproven** |
| A published reply survives moderation | 0 observations | **unproven** |
| The system runs across multiple days without degrading | 0 behaviour-engine sessions recorded | **unproven** |

A recommendation of "ready for a pilot" would be predicting those three, not reporting them.
The pilot is the experiment that produces them, and it is the correct next step — but it runs
as an internal test with a person at the terminal, not as a production posture.

The single action that changes this verdict is in [Blocking the pilot](#blocking-the-pilot).

---

## Verified — capabilities demonstrated with evidence

Everything in this table was executed and produced the stated output. Nothing is here on the
strength of the code alone.

| # | Capability | Evidence | Where |
|---|---|---|---|
| 1 | Attach to the operator's Chrome, detect signed-in state | 2 accounts detected by name via `shreddit-app[user-logged-in]` + header link | `data/history.jsonl` |
| 2 | Reuse the session without handling a credential | redbot stores no password and no session file | `.gitignore`, `src/browser.ts` |
| 3 | Browse a subreddit and collect threads | 45 threads across r/WordPress, r/webdev, r/Wordpress_Help | `data/threads.json` |
| 4 | Search Reddit | ran after the DEFECT-03 scope fix | `data/history.jsonl` |
| 5 | Score threads against declared competence | 45/45 scored, 0 failed, 9 marked worthwhile | `data/analysis.json` |
| 6 | Generate a reply, linted | 9 drafts, 7 lint-clean | `data/drafts.json` |
| 7 | Refuse to publish without a human | non-interactive stdin throws `NoTerminalError` | `src/ask.ts` + 4 regression tests |
| 8 | Complete local log | every command appends to `data/history.jsonl` | `redbot history` |
| 9 | **Behaviour engine** — variable dwell, partial scroll, idle, abandon, weighted navigation | 15 tests incl. seed-replay determinism | `src/behavior.ts`, `src/test/behavior.test.ts` |
| 10 | **Account health** — 4 states from recorded facts, blocks posting in Cooldown/Stop | 14 tests across every transition | `src/health.ts`, `src/test/health.test.ts` |
| 11 | **Craft gate** — clichés, specificity, register, false certainty | 10 tests | `src/quality.ts`, `src/test/quality.test.ts` |
| 12 | **Safety gates** — 18 refusal conditions, all fail closed | 13 tests | `src/gates.ts`, `src/test/gates.test.ts` |
| 13 | **Pilot selection** — per-criterion verdicts, proxies labelled | 11 tests | `src/select.ts`, `src/test/select.test.ts` |

Reproduce:

```
npm test                 93/93
node qa/phase4-fuzz.mjs  31/31 blocked, 10/10 must-pass
node dist/cli.js policy  24 limits, 6 still provisional
node dist/cli.js select  ranks the collected threads against the pilot criteria
node dist/cli.js health  account state and every counter behind it
node dist/cli.js metrics reliability figures with their denominators
```

---

## Defects found in Phase 3

All three were found by running the engine on the real corpus and reading what it produced —
not by the test suite, which passed throughout.

### DEFECT-13 — showcase posts read as technical questions · MEDIUM · fixed

*"Redesigning my AI company's site, would appreciate honest feedback"* scored **90/100** and was
assessed `contribute`. It is someone presenting work and inviting opinion; answering it with a
diagnosis is the wrong register for the room. Same class as DEFECT-12, caught the same way —
a mechanical title check (`SHOWCASE` in `src/select.ts`), not a prompt revision. Anchored to
"my <thing>" so *"any feedback on why this errors?"* still passes.

### DEFECT-14 — the opportunity score saturated · HIGH · fixed

**7 of 14 threads scored exactly 100.** The bands are additive and almost every thread carries
at least two high-band gap kinds, so the engine excluded bad candidates but could not rank the
good ones — the ordering among passing threads was near-arbitrary.

The fix used signal already being collected and thrown away: `covered`, the number of claims
already on the thread, which ranged 1–12. A thread carrying 12 claims has far less room than
one carrying 1, whatever its gap kinds. Scores now spread **100 → 47** across the passing set.

### DEFECT-15 — the competence filter did nothing · HIGH · fixed

The gap analyzer marks each gap `fillable`, meaning "someone with our declared competence could
close this". Measured on the first real run: **65 of 67 gaps came back fillable — 97%.**

Threads marked fillable against a WordPress-only competence list included Shopify Liquid
architecture, an unspecified "MCP-Server", generic webhook de-duplication, and
*"Vue/Nuxt + Laravel API deployment"* — which scored **92/100** and was assessed `contribute`.

A flag that is true 97% of the time is not a filter, and it cannot be fixed by rewording the
prompt. Competence is now checked against the thread's own vocabulary (`src/competence.ts`),
which the model does not control. Building it surfaced four English-word false positives, each
found by printing what actually matched rather than by guessing:

| Text in the thread | Matched | Wrongly read as |
|---|---|---|
| "solid colors via **theme** tokens" | `theme` | a WordPress theme |
| "the best **compromise**" | `compromise` | a security incident |
| "the rendering **order**" | `order` | an e-commerce order |
| one shared word ("cache") carrying a whole thread | — | in-scope |

A further rule came out of the re-run: every declared area is WordPress-centric, so generic
infrastructure vocabulary only counts as ours when the thread also has a WordPress anchor.
Result: all 9 r/Wordpress threads in scope, 4 of 5 r/webdev threads correctly out.

> **The competence check is a proxy and is labelled as one at every point of use.** It cannot
> tell whether an answer would be correct. It catches the case observed here — a thread whose
> subject never touches the declared stack.

## Defects found in Phase 2

Both were found by running the new gates against the queue that Phase 1 left behind — the
drafts that were sitting "lint-clean and ready to post".

### DEFECT-11 — three pending drafts targeted threads seven to eight years old · HIGH · fixed

`read` pulls from a subreddit's hot feed. On a low-traffic sub that feed surfaces very old
posts, and nothing in the pipeline looked at age. Measured on the pending queue:

| Draft target | Thread age |
|---|---|
| Questions about adding a music player / plugin | **62,975 h** (~7.2 years) |
| Dying for a solution! Tried everything but contact form is not functioning | **70,180 h** (~8.0 years) |
| Need help with design problems on my WordPress site! | **70,627 h** (~8.1 years) |

Three of the seven "ready" drafts would have been necro-posts on dead threads. Fixed by the
`stale-thread` gate (72 h ceiling, `policy.maxThreadAgeHoursToPublish`) and the recency
criterion in `select`. Regression test: `select.test.ts` "a thread from years ago fails on
recency".

### DEFECT-12 — triage scored a guide as a question · HIGH · fixed

The highest-ranked pilot candidate was:

> `[Guide] Complete cleanup and securing of WordPress after REST Batch API (wp2shell) attack`
> — priority **72**, confidence **90**

GATE A of the analyze rubric puts a guide at priority 5. The model did not apply it and wrote
a rationale for the score it had already chosen ("engineers can verify completeness and
suggest additional hardening steps"). This is the DEFECT-07 class — an underspecified rubric
producing a confident wrong band — surfacing on a specific thread.

Fixed mechanically rather than with another prompt revision: `isQuestionShaped()` rejects
announcement-tagged titles and titles that ask nothing, and it is wired into **both** `select`
and the publish gates so a bad score cannot be inherited. A prompt is a request; a bracket tag
in a title is a fact about a string.

**Consequence:** with both fixes applied, **0 of 45 collected threads are eligible for the
pilot.** That is the correct outcome, not a regression — the one previously-eligible candidate
was a guide, and three others were nearly a decade old.

---

## Measured results

From `redbot metrics` on the current log (window 2026-07-22, one day):

| Metric | Value | Note |
|---|---|---|
| Sessions started / completed | 0 / 0 | behaviour engine shipped today; never run live |
| Session success rate | **no data (0 samples)** | |
| Average session duration | **no data** | |
| Drafts generated | 9 (9 lint-clean at rest) | |
| Draft approval rate | 0/2 (0%) | only 2 drafts were ever decided, both rejected |
| Publish attempts / successes | 0 / 0 | |
| Publish success rate | **no data (0 samples)** | |
| Blocked by gates | 0 | gates did not exist during the logged window |
| Page loads | 127 | |
| 429s recorded | 0 | see caveat below |
| Selector misses | 0 | the `selector.miss` kind is new; nothing has been recorded through it |
| Browser crashes | 0 | |
| Errors | 3 | |
| Login successes / failures | 8 / 0 | |
| Longest clean login run | 1 day | the log is only one day long |

**Caveat on the 429 count.** DEFECT-02 was a real, observed HTTP 429 on 2026-07-22. It reads
as 0 here because the `ratelimit` history kind was added today, so that event was never
recorded under it. The measured envelope (9.5 page loads/min) stands on the original evidence
in `qa/evidence/`; the counter starts from now.

---

## Remaining risks

### Open defects

**DEFECT-07 — ranking instability, bounded not closed.** Average score spread was reduced
19.2 → 6.7 by rewriting triage into mechanical gates, and 3 of 6 threads now score identically
across runs. Two borderline threads still flip in and out of the queue. DEFECT-12 shows the
same root cause can produce a confidently wrong band, not just a wobbling one.

### Operational limitations

- **Publishing has never been exercised against Reddit.** The composer selectors, the submit
  click, the landed-confirmation check and the comment-permalink capture are all unproven
  against a live thread.
- **The signed-out observation vector is untested.** `observe` opens an incognito context over
  CDP and verifies it is logged out; if that fails it reports UNAVAILABLE rather than
  substituting the signed-in result. Which branch happens in practice is unknown.
- **Both accounts sit at karma 1** and have posted nothing. ACCOUNT-WARMING Stage 1 has not
  started. Health correctly reports `Caution` for an unmeasured account.
- **Lock and archive detection is unverified.** No locked or archived thread has been opened,
  so `probeThreadState` fails closed by design and returns `unknown` rather than a false clear.
- **6 of 24 operational limits are provisional placeholders** — `redbot policy` prints exactly
  which. They must not be quoted as findings; replacing them is what the pilot is for.

### Unknowns requiring more testing

| Unknown | What would settle it |
|---|---|
| Does a reply from a karma-1 account survive? | Part E + the 1 h / 24 h / 7 d checkpoints |
| Is a reply visible to signed-out readers? | The signed-out vector at each checkpoint |
| Does the session hold up over hours? | Part G, multiple sessions across different days |
| How often do Reddit selectors drift? | `selector.miss` counts over weeks |
| What is the real draft approval rate? | N ≫ 9 decided drafts |
| Is the reply technically correct? | A person. No mechanical check can answer this |

---

## Blocking the pilot

Three things, in order. None can be worked around from inside redbot.

1. **Operator Claude credentials** — `analyze` and `draft` refuse without them, by design.
   The recorded exception in `data/operators/operators.json` points operator `jerome` at the
   machine's own Claude config; the dedicated directory exists but is empty.
2. **A fresh collection run.** Zero of the 45 threads on disk are eligible after DEFECT-11 and
   DEFECT-12. `redbot session --kind medium --sub wordpress` then `analyze` then `select`.
3. **A person at a real terminal.** `reply` refuses non-interactive stdin, and that refusal is
   load-bearing — it is what makes every published word attributable to a human approval.

---

## Phase 3 unknowns

| Unknown | What would settle it |
|---|---|
| Would a person publish these drafts as written? | Decide drafts at `redbot reply` — the review dataset then answers it |
| Is the 70% novelty threshold right? | Re-fit against approved/rejected drafts once the dataset has records |
| Is a 60% contribute rate correct, or still too generous? | Operator rejections coded `adds-nothing` would say it is too generous |
| Does the competence proxy reject real WordPress questions? | Rejections coded `off-topic` on threads it passed, and a manual read of what it dropped |
| Is the drafting model technically correct on these topics? | A person who knows the subject. No mechanical check can answer this |

One marginal case is left standing deliberately: *"For a small tool site, would you avoid
client-side rendering"* (r/webdev) passes competence on performance + hosting. It is an
architecture question rather than a WordPress one. It sits below the draft threshold in
practice, and the human gate is the backstop, but it is named here rather than tuned away.

## What "ready for a limited pilot" would require

Stated now so the bar cannot move later:

- one reply published successfully, with its permalink captured;
- that reply observed at all four checkpoints, **including signed-out**, with the results
  recorded whatever they are;
- at least three behaviour-engine sessions across at least two different days, with
  `session.start`/`session.end` pairs and no unexplained failures;
- 0 unexplained publish failures and 0 gate bypasses;
- the 6 provisional limits either measured or explicitly re-declared with a reason.

Until then the honest position is the one at the top of this report.
