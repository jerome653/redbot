# SGEN Reddit Bot — Scope (working draft)

**Status:** DRAFT — nothing approved, nothing built.
**Date:** 2026-07-22
**Owner:** Jerome (SGEN)
**Origin:** Appilot teardown → `Projects/appilot-analysis/` (report §19 = vendor guide reconciliation)

Nothing in this document is a decision. It is the set of things that must be decided,
each with its cost, its consequence, and a recommendation. Decisions get recorded in §9
with a date and a name against them.

---

## 1. What problem are we actually solving

Stated plainly, because everything downstream depends on getting this line right:

> **SGEN wants people who have the problem SGEN solves to find out that SGEN exists,
> from a source they trust, at the moment they have the problem.**

Reddit is one channel where that audience talks about the problem in public, in detail,
with intent. That is the whole reason this is interesting.

Three distinct capabilities hide inside that sentence, and they have very different
costs and risks. Scoping them separately is the single most important thing in this doc.

| # | Capability | What it does | Value | Risk |
|---|---|---|---|---|
| **A** | **Listening** | Find threads where SGEN's problem space is being discussed. Score them. Alert. | High, immediate | ~Zero |
| **B** | **Drafting** | Generate a good reply to a qualified thread | High | ~Zero (nothing is published) |
| **C** | **Publishing** | Put the reply on Reddit under an account | The point, or the problem — depends entirely on §4 | High |

A and B have no meaningful downside. C is where every hard question lives.

---

## 2. Goals / non-goals

**Goals**
- Surface high-intent conversations in SGEN's problem space, ranked, within minutes
- Produce a reply draft good enough that a human edits rather than rewrites
- Keep a record: what we saw, what we said, what happened
- Track brand mentions and their sentiment, with a link back to the thread
- Be cheap to run and cheap to stop

**Non-goals (v1)**
- Any platform other than Reddit
- Owning a fleet of Android phones
- Volume. This is not a spam tool; 5 excellent replies beat 200 mediocre ones
- MOE integration (deliberately deferred — build standalone, integrate later)

**Explicit non-goal, stated once:** automated voting. Reddit's Content Policy names
programmatic voting directly, with an escalating ban ladder, and their detection
cross-references IP, login timing and vote timing. It is the fastest known way to lose
every account at once. **Recorded as open decision D-3 — Jerome's call, not mine.**
My position is on the record and I will not raise it again.

---

## 3. The access problem — read this before anything else

This is the real constraint, and it is procurement, not engineering.

| Fact | Verified 2026-07-22 |
|---|---|
| Reddit API free tier | 100 requests/min, OAuth — **non-commercial use only** |
| Self-serve API signup | **Closed** since late 2025 (Responsible Builder Policy). Manual approval, 2–4 weeks |
| Unauthenticated `.json` endpoints | **403 since May 2026** |
| Commercial tier | ~$0.24 / 1,000 calls, **$12,000/year minimum**, manual approval |
| Data API Terms | last revised 2026-07-20 |

**Consequence:** SGEN using this for marketing is commercial use. That means the paid tier,
an approval conversation, and a 2–4 week wait — *before any of this can touch live data*.

Four ways forward, and the choice shapes the timeline more than any code decision:

| Option | Time to live data | Cost | Notes |
|---|---|---|---|
| **1. Apply for Reddit commercial API** | 2–4 weeks, uncertain | $12k/yr min | Clean. Approval not guaranteed for this use case |
| **2. Licensed aggregator** (they hold the Reddit licence) | days | ~$100–500/mo typical | Read-only. Cannot post. Fine for A + B |
| **3. Free tier, non-commercial** | 2–4 weeks | $0 | **Terms say non-commercial. This use is commercial. Not a real option** |
| **4. Scraping** | now | $0 | Breaches their terms, 403s already deployed, breaks constantly. Not recommended |

**Recommendation: Option 2 for capability A+B now, Option 1 in parallel if C is wanted.**
Aggregators give listening + drafting inside a week for pocket change. The API application
runs in the background and only matters if publishing is approved.

---

## 4. The publishing decision — the fork that changes everything

Everything above this line is uncontroversial. Everything below depends on one choice.

### Option C1 — Human posts (no automation past the draft)
Scout finds → AI drafts → **a person edits and posts from their own named account,
disclosing they work at SGEN.**

- Build: ~3–4 weeks · Run: ~$100–600/mo · Ongoing maintenance: near zero
- No account farm, no bans, no API write access needed, no FTC exposure
- Ceiling: however many replies a human will write per day. Realistically 3–10
- On r/WordPress specifically, a named SGEN engineer answering well outperforms an
  anonymous stranger. Being upfront is an advantage there, not a tax

### Option C2 — Auto-post from real accounts, human approves first
Same, but approved drafts are posted by the system via the Reddit API.

- Build: ~6–8 weeks (adds account manager, token refresh, delay queue, rate ledger,
  failure handling, audit log) · Run: $12k/yr API + ops
- Needs: commercial API write approval, one Reddit account per posting identity with
  enough age/karma to post in the target subreddits
- **Accounts are the bottleneck, not the code.** Big subreddits gate new accounts.
  Growing one honestly: 3–6 months. Buying them: breaks Reddit's rules and they get
  banned in sweeps
- Disclosure still required — an automated account posting marketing without disclosure
  is the FTC problem, and Reddit's self-promo rules apply per subreddit

### Option C3 — Auto-post, no human in the loop
Same as C2 without the approval gate.

- Build: same as C2, minus the approval UI
- **Note for the record:** Appilot themselves did not do this. Their own product puts a
  human approval step between the AI draft and the post. When the vendor selling
  automation builds a manual gate, that is a signal about what they learned

**Recommendation: start C1, keep the architecture C2-ready.** The draft pipeline is
identical in all three; only the last mile differs. Build the pipeline, post by hand for
6–8 weeks, measure whether the replies actually land. If they do, and if API write access
is approved, turning on C2 is roughly a week of work. If they don't land, you saved the
$12k and the account problem.

---

## 5. Proposed architecture (source and publisher are swappable)

```
  SOURCE (pluggable)          CORE                       OUTPUT (pluggable)
  ┌────────────────┐   ┌───────────────────────┐   ┌────────────────────────┐
  │ fixture (dev)  │   │ dedupe                │   │ manual export (C1)     │
  │ aggregator API │──▶│ engagement score→tier │──▶│ Slack/Discord alert    │
  │ reddit API     │   │ LLM qualify           │   │ reddit publisher (C2)  │
  └────────────────┘   │ LLM draft             │   └────────────────────────┘
                       │ store + audit log     │
                       └───────────────────────┘
                                  │
                          approval dashboard
                       (view · edit · approve · reject)
```

Two swap points, chosen so that neither the access decision (§3) nor the publishing
decision (§4) blocks building the core.

### Modules

| # | Module | Purpose | Est. |
|---|---|---|---|
| 1 | Source adapters | fixture (offline dev) · aggregator · Reddit API | 4 d |
| 2 | Dedupe + store | stable key per post, atomic writes, 90-day retention | 2 d |
| 3 | Scoring | engagement velocity → 0–100 → tier 1/2/3 | 1 d |
| 4 | Qualification | LLM triage: worthy / category / fit / answerable-without-pitch | 2 d |
| 5 | Drafting | LLM reply, disclosure enforced, no fabricated experience | 3 d |
| 6 | Mention tracking | find SGEN mentions, sentiment, link, alert on negatives | 2 d |
| 7 | Approval dashboard | list, filter, read the thread, edit the draft, approve/reject | 5 d |
| 8 | Alerting | Slack or Discord: new tier-1, new negative mention | 1 d |
| 9 | Audit log | every draft, every edit, every post, every outcome | 1 d |
| 10 | CLI + config + docs | `scan`, `serve`, `export`, README | 2 d |
| | **C1 subtotal** | | **~23 days ≈ 4–5 weeks** |
| 11 | Account manager | OAuth per account, token refresh, health | 4 d |
| 12 | Delay queue + rate ledger | tier delay, per-account/hour/day caps, quiet hours | 4 d |
| 13 | Reddit publisher | submit comment, handle failure, record permalink | 3 d |
| 14 | Outcome tracking | did it get upvoted, replied to, removed by a mod | 3 d |
| | **C2 increment** | | **~14 days ≈ 3 weeks** |

**Stack:** Node ≥20, ESM, zero npm dependencies — matches the MOE house convention
(`apps/monitor` is zero-dep by policy). Flat-file JSONL store, not a database, at this
volume. Anthropic API for qualify + draft; key from environment, never from a file.

---

## 6. What "good" looks like — measure this, not volume

| Metric | Target v1 | Why |
|---|---|---|
| Qualified threads surfaced / week | 20–40 | is the listening working |
| Draft accepted with light edit | > 60% | is the drafting worth having |
| Replies posted / week | 5–15 | deliberately low |
| Median reply score after 24 h | positive | are we actually helping |
| Replies removed by mods | **0** | any removal is a scope failure, investigate immediately |
| Negative mentions caught within 1 h | 100% | this is the defensive value |
| Cost / month | < $600 (C1) | it should be boring and cheap |

**Kill criteria, agreed up front:** two mod removals, or one public accusation of
astroturfing, and publishing stops until reviewed. Listening continues.

---

## 7. Risks

| # | Risk | Applies to | Mitigation |
|---|---|---|---|
| R1 | Reddit API access denied or delayed | all | Aggregator for read; C1 needs no write access at all |
| R2 | Account bans | C2, C3 | Disclosure, low volume, real accounts, no voting |
| R3 | Public astroturfing accusation | C2, C3 | Disclosure line, human review, kill criteria |
| R4 | Subreddit self-promo rules | C1–C3 | Read each subreddit's rules; some ban vendor participation outright — check r/WordPress specifically before anything |
| R5 | FTC undisclosed endorsement (US) | C1–C3 | Disclosure is mandatory in the prompt and enforced in review |
| R6 | Drafts are mediocre and nobody uses them | all | 4-week measurement window before building C2 |
| R7 | LLM cost creep | all | Cheap model for triage, expensive only for drafts above threshold |
| R8 | It becomes someone's daily chore | all | Name the operator in §9 before build starts, or it dies |

---

## 8. Phasing

| Phase | Weeks | Contains | Gate to proceed |
|---|---|---|---|
| **0 — Decide** | this week | §9 decisions answered; subreddit rules checked; access path chosen | all of D-1…D-6 answered |
| **1 — Listen** | 1–2 | Modules 1–4, 6, 8. Alerts only, no drafting UI | 20+ qualified threads/wk surfaced |
| **2 — Draft** | 3–5 | Modules 5, 7, 9, 10. Full C1. Humans post by hand | >60% drafts usable |
| **3 — Measure** | 6–9 | No new build. Post by hand. Track outcomes | positive median score, 0 removals |
| **4 — Automate** | 10–12 | Modules 11–14 (C2) — **only if phase 3 passed and API write approved** | explicit go/no-go |

---

## 9. Decisions register — needs answers before Phase 1

| # | Decision | Options | Recommendation | Answer | Date |
|---|---|---|---|---|---|
| D-1 | Publishing model | C1 human / C2 auto+approval / C3 auto | **C1 now, C2-ready architecture** | | |
| D-2 | Data access path | aggregator / Reddit API / both | **Aggregator now; API application in parallel** | | |
| D-3 | Automated voting | in / out | **Out** — recorded, Jerome's call | | |
| D-4 | Accounts | named SGEN staff / dedicated brand account / multiple identities | **Named staff, disclosed** | | |
| D-5 | Subreddits for v1 | r/WordPress only / + r/webdev, r/hosting, r/Wordpress_Help | **r/WordPress only** until it works | | |
| D-6 | Who operates it daily | Jerome / support / a dev / rotation | — | | |
| D-7 | Budget ceiling, year 1 | | build ~$15–20k, run <$7k/yr at C1 | | |
| D-8 | MOE integration | now / later / never | **Later** — per Jerome, 2026-07-22 | Later | 2026-07-22 |

---

## 10. What already exists

- `Projects/appilot-analysis/` — the teardown this came from. §19 reconciles Appilot's
  user guide against their binary; §14 has the effort model; §13 has the risk register
- `Projects/sgen-reddit-scout/` — 7 scaffolding files written during a false start on
  2026-07-22 and stopped mid-build: `config.mjs`, `score.mjs`, `llm.mjs`, `store.mjs`,
  two prompt files, `package.json`. **Does not run.** Reusable as reference if the scope
  lands close to it; delete otherwise. No sunk cost, ~2 hours

---

## 11. Open questions for Jerome

1. Has anyone checked r/WordPress's rules on vendor/employee participation? That single
   answer could invalidate C1, C2 and C3 alike, and it costs five minutes to find out.
2. Does SGEN have any existing Reddit presence — accounts, karma, history? Changes the
   account question completely.
3. Is the goal leads, or brand awareness, or defensive mention-monitoring? They rank the
   modules differently and right now I am guessing.
4. Who is accountable when a reply goes wrong in public?
