# redbot — Production Evidence Campaign

**Opened:** 2026-07-23 · **Status:** architecture FROZEN · **Role:** validation, not engineering

The objective is to replace assumptions with evidence. Not to add features.

---

## The freeze, and what it permits

No new modules, engines, analyzers or scoring systems. **Every code change must cite a real
production observation**, recorded in this repo, in the commit or the comment that makes it.

Two changes were made on the day the freeze opened. Both cite observations, and both are
recorded here so the exception is visible rather than quiet:

| Change | Justifying observation |
|---|---|
| `[PROMO]`, `[OC]`, `[WIP]`, `[hiring]` added to the announcement filter | Fresh r/Wordpress collect, 2026-07-23: **3 of 15 threads were `[PROMO]`-tagged**. Each would have cost a model call to discover it was an advert. |
| "about to launch" / "a feedback about" added to the showcase filter | Same collect: *"A feedback about a search plugin i'm about to launch"* — the same thing without a tag. |
| `redbot regret` + the evidence log | Explicit operator instruction, not an engineering hunch. Neither introduces a scoring system: one asks a person two questions, the other joins logs that already exist. |
| `currentAgeHours()` — thread age measured now, not at collection | Thread `c14d9d8caa0e`, 2026-07-23: stored age **17.8h**, true age **28.3h**, corpus had sat 10.6h. The 72h `stale-thread` ceiling was being enforced against the stored number, so a thread collected at 70h and drafted a day later would publish as "70h" while actually ~95h. A gate that passes what it exists to stop, silently. |

Anything else waits for a case in the evidence log.

### Phase D classification of the age defect

| | |
|---|---|
| Reproduced | Yes — arithmetic on stored fields, two regression tests |
| Root cause | `ageMinutes` stamped once at collection; every consumer treated it as current |
| Severity | **Medium** — no wrong publish occurred (nothing has been published), but a gate could be defeated without any error |
| Fix belongs in | **implementation** — derived from `ageMinutes` + `collectedAt`, no new state |

Not speculative: the miscalculation was measured on a real thread before the change was made.

---

## Phase A — the first live reply

**Selection criteria**, all of which must hold:

- a genuine technical question
- an active discussion
- no existing complete answer
- the contribution clearly improves the thread
- it passes every gate

Selection is made from live data, not the stored corpus. On 2026-07-23 the stored corpus was
found to carry **frozen ages** — `ageMinutes` is stamped at collection time, so a thread
recorded as "18h old" was by then roughly 40h old. Selecting on that would have quietly
violated the "active discussion" criterion. Re-collect, then select.

**One reply. Not two.**

### What blocks it, and why that is not a bug

`redbot reply` refuses a non-interactive stdin. That refusal is the mechanism that makes every
published word attributable to a person, and it exists because DEFECT-08 was the case where
the approval gate failed open — a stray newline would have published.

An agent cannot satisfy it, and satisfying it on the operator's behalf would defeat its only
purpose. So the last step of Phase A is a human at a terminal:

    node dist/cli.js reply <draftId>

Everything before that step — collection, gap analysis, opportunity, drafting, and a live
run of all 19 gates against the real thread — is done in advance, so the remaining action is
a read and a keystroke.

## Phase B — observation

    node dist/cli.js observe --checkpoint immediate     # then at 1h, 24h, 7d

Two vectors per checkpoint: signed-in and signed-out. The signed-out one is the one that
matters — a comment can be visible to its author and invisible to everyone else, and checking
your own profile does not detect that.

**Recorded:** visible / not visible · any removal notice, verbatim · vote count if shown ·
number of replies underneath · the permalink.

**Not recorded:** why. Ranking, filtering, moderator intent and detection behaviour are not
observable from outside. `reply-absent-signed-out` is stored as exactly that, and never
upgraded into a claim about what Reddit did. An evidence log that contains one guess is no
longer trustworthy for the facts either.

## Phase C — operator review

Asked immediately after publishing, by `redbot regret`:

> **Would I still post this if automation were removed entirely?**

If no, classified as: `technical` · `writing` · `opportunity` · `timing` · `safety` ·
`confidence`.

## Phase C+ — Human Regret

Asked 24 hours later, after the operator has seen how the reply landed:

> **Would you still be comfortable having your name attached to this reply today?**
>
> 1. Yes, unchanged 2. Yes, but I'd edit it 3. No, I'd delete it

Every other quality signal in this repo — the linter, the craft gate, the novelty check, the
opportunity score — is a proxy for this question, and each is graded at the moment of writing,
before the reply has met the thread. This one is graded after. When they disagree, this one is
right and the proxy needs re-fitting.

The **stand-behind rate** is `unchanged / asked`. It is reported with its denominator and reads
`no data (0 samples)` until there is data.

## Phase D — failure analysis

Anything unexpected: reproduce → root cause → severity → and decide where the fix belongs:

| Belongs in | Meaning |
|---|---|
| implementation | the code did the wrong thing |
| policy | the code did what it was told and the rule was wrong |
| documentation | the behaviour was right and unexplained |
| operations | nothing was wrong; the run was conducted badly |

No speculative fixes. A fix with no observation behind it is a new assumption wearing the
clothes of a repair.

## Phase E — the evidence log

`reports/evidence-log.md`, regenerated by `redbot report`. One case per interaction: thread ·
why selected · identified gap · reply · outcome · observations · lessons.

It **stores nothing of its own** — every field is joined from logs that are only ever appended
to. It therefore cannot invent a case, and a regenerated file cannot disagree with what
happened.

A case is created when a person **decides** on a draft, not when one is published: a rejection
with a reason is evidence about the pipeline, and often better evidence than an acceptance.

---

## Human Representation Certification (HRC)

Added 2026-07-23, before the first publish. The standard:

> **Would an experienced engineer knowingly post this from their own Reddit account?**

Six phases — reply audit · counter-review · moderator review · reputation review · publish
readiness · post-publication learning. One recommendation only: *publish unchanged* ·
*publish after specific edits* · *reject*.

The first certification, [HRC-001](reports/HRC-001-custom-css-updraft.md), **rejected** the
staged draft on two independent grounds: a false claim about MySQL `max_allowed_packet`
behaviour, and a thread the asker had already marked solved.

It also established the boundary this project now designs around:

| Gate | What it measures | What it cannot measure |
|---|---|---|
| safety linter | leakage, brand, fabricated experience | truth |
| craft gate | specificity, hedging, register, length | truth |
| novelty check | difference from what was said | truth |
| opportunity engine | whether a gap exists | whether we can fill it correctly |
| 20 safety gates | state, identity, health, duplication | truth |

Every automated gate passed a confidently wrong reply. **Correctness is not measurable from text
alone**, which is why the human review is load-bearing rather than ceremonial — and why redbot is
positioned as a human-in-the-loop contribution assistant rather than a Reddit automation tool.

## Release rule

> No additional infrastructure work begins until **ten** real interactions have been completed
> and reviewed.

The count lives at the top of the evidence log and is computed, not asserted. At ten, the
retrospective answers, using production evidence only:

1. Which modules actually prevented failures?
2. Which modules were never exercised?
3. Which assumptions were wrong?
4. Which operational policies should change?

Until then every proposal must cite a case number.

### Standing prediction, recorded now so it can be wrong

Written before the evidence exists, so that the retrospective can check it rather than
rationalise it:

- **Expected to have earned its place:** the novelty check and the gap analyzer's `covered`
  list — they are the only things standing between a draft and a restatement.
- **Expected never to have fired:** `locked`, `archived`, the rate-limit cooldown, and most of
  the health state machine. They are cheap insurance against events that may not occur in ten
  interactions.
- **Most likely wrong assumption:** that a 60% contribute rate is the right bar. If operators
  reject drafts as `adds-nothing`, the opportunity floor is too low and the gap analyzer is
  too generous about what counts as a gap.
- **Most likely operational change:** collecting more often rather than more widely — 
  `already answered` is expected to be the most common reason a thread is skipped.
