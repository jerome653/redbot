# Account warming — getting two 1-karma accounts to useful standing

**Measured 2026-07-22:** `docs-architect` and `jrum_sgen` are both at **1 karma** (the point
every account starts with). Neither has posted anything.

This matters more than it sounds. A 1-karma account is the profile of a spam bot, and both
Reddit's automated filters and human moderators treat it that way. The constraint is not a
rule you can read — it is a set of automatic behaviours that a new account trips.

---

## What a new account actually runs into

| Obstacle | What happens | How long it lasts |
|---|---|---|
| Subreddit karma minimums | Comment is removed on arrival, often silently | Until the threshold is met |
| Account-age minimums | Same, regardless of karma | Typically 7–30 days |
| Crowd Control | Comment is collapsed by default for people not subscribed | Until the account has history in that sub |
| Reddit's spam filter | Comment goes to the mod queue instead of the thread | Eases as the account builds normal history |
| Rate limiting on new accounts | Roughly one comment every 5–10 minutes | Eases with karma |

The failure mode to watch for is the quiet one: **the comment posts successfully, is visible to
you while signed in, and is invisible to everyone else.** Checking your own profile does not
detect this. Signed-out verification does.

---

## The plan

### Stage 1 — weeks 1–2 · establish that a person is here

Target: **50–100 comment karma each**, no links of any kind.

- **2–4 comments a day, maximum.** More looks like a campaign.
- Answer questions you can genuinely answer, in threads under two hours old — early comments
  in a young thread get read, late comments in an old thread do not.
- Deliberately comment in a few subreddits **outside** the work topic. An account whose entire
  history is WordPress support reads as a marketing asset; an account that also talks about
  something it likes reads as a person.
- **Zero links. Zero product names. Zero company mention.** Even a helpful link this early
  gets filtered and teaches the filter something about the account.
- Verify every one of the first ten comments in a signed-out window. Removals at this stage
  are normal and are information, not failure.

### Stage 2 — weeks 3–6 · become a known name in two subreddits

Target: **300–500 karma each**, several comments with visible upvotes.

- Narrow to two or three subreddits and appear regularly rather than everywhere occasionally.
- Prioritise threads with **few existing answers** — a good reply to an unanswered question
  earns far more than the tenth reply to a popular one.
- Answer follow-up questions on your own comments. Reddit rewards a thread you stayed in.
- Read each subreddit's rules directly. r/WordPress rule 1 is "No promotions of products or
  services", and it is enforced.

### Stage 3 — week 7 onward · normal operation

At this point the accounts clear most automatic filters and redbot's normal loop applies:
read, rank, draft, approve, post.

- Still no unprompted promotion. If someone asks what you use, answering honestly with a
  disclosure is fine — that is a reply to a question, not an advertisement.
- Keep the daily ceiling low. Four comments a day from an established account is plenty.

---

## Rules that do not relax at any stage

- **The two accounts never touch.** Not the same thread, not the same post, no replies to each
  other, no votes on each other. This is the single behaviour that turns two accounts into
  detectable vote manipulation, and Reddit bans for it across the whole network.
- **No voting at all.** redbot cannot vote — there is no code path for it.
- **If an account is suspended, stop.** Do not create a replacement. A replacement account
  from the same machine and network is ban evasion and escalates a single suspension into a
  permanent one.
- **Different subreddits where possible.** Overlap is allowed; simultaneous presence in the
  same thread is not.

---

## What redbot does and does not help with here

**Helps:** finding threads worth answering, drafting a substantive reply, keeping the pace
below the rate limit, refusing to post anything promotional, and logging what happened so
removals are visible.

**Does not help:** the waiting. Karma accrues from other people finding the comments useful,
and no amount of automation shortens that. Stage 1 is genuinely two weeks of a person
approving a handful of good answers a day.

---

## How to tell it is working

| Signal | Meaning |
|---|---|
| Comments still visible signed-out after 24h | Clearing the spam filter |
| Any upvotes at all | Real people are reading |
| Someone replies to a comment | The account reads as a person |
| Comments consistently removed | Stop. The subreddit has a threshold not yet met |
| Account suspended | Stop entirely. Do not create another |

Record the first ten comments per account with a signed-out check at 1 hour and 24 hours.
That table is the evidence for whether Stage 2 should begin.
