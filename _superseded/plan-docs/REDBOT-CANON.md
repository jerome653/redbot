# REDBOT — CANON

**The spine.** Everything else in this repo defers to this file. If a doc, a spec or a
line of code disagrees with canon, canon wins and the other thing is a bug.

- **Project:** redbot
- **Owner:** Jerome (SGEN)
- **Started:** 2026-07-22
- **Method:** MOE — plan infra + engineering → define everything → implement → test →
  real tests → deploy. No code before its spec exists.
- **Origin:** `Projects/appilot-analysis/` — teardown of the Appilot Reddit bot delivered
  to SGEN. redbot is the clean-room answer to it.

---

## 1. What redbot is

> **A Reddit user agent.** It does what a person does in Reddit: reads, searches, browses,
> follows threads, writes, replies, posts, and manages its own account — under SGEN's
> direction, at human pace, from real accounts.

It is not a scraper, not a scout, not a dashboard. Those are components. redbot is an
**agent that operates an account**.

## 2. What redbot is not

- Not a phone farm. No Android, no Accessibility Service, no devices. See ADR-0002.
- Not a spam engine. Volume is capped in code, not by policy. See ADR-0006.
- Not anonymous. Every account it drives is real and, where it speaks for SGEN, disclosed.
  See ADR-0005.
- Not autonomous by default. v1 ships with a human gate on every outbound write. The gate
  is a config value, not a law of nature. See ADR-0004.
- Not a MOE module. Standalone by direction (Jerome, 2026-07-22). Integration is a later
  door, and the event contract is written so that door opens cleanly.

## 3. The architecture decision, stated once

Three ways to make software act like a Reddit user. redbot picks the third.

| | Reddit API | Android device (Appilot's way) | **Browser agent (redbot)** |
|---|---|---|---|
| Covers the full human action surface | mostly | yes | **yes** |
| Needs Reddit's approval | **yes — $12k/yr, 2–4 wk, may be denied** | no | no |
| Needs hardware | no | **phones, SIMs, proxies, a shelf** | no |
| Needs an Android team | no | **yes — SGEN has none** | no |
| Fits SGEN's existing stack | partly | no | **yes — Node + Playwright already in use** |
| Breakage cadence | low | **high — every Reddit app release** | moderate — web DOM is steadier |
| Time to first working action | 2–4 wk (blocked on approval) | 5–6 months | **days** |

The API is gated behind a commercial agreement SGEN does not have. The device path is a
half-year build for a capability SGEN does not otherwise need. The browser path delivers
the same user-level capability on the stack SGEN already runs. That is the decision.

**Consequence to be honest about:** the browser path is still automation of a logged-in
account. It does not need Reddit's permission, and it does not have Reddit's blessing
either. Every account risk in §7 applies.

## 4. Action surface — what "what a human can do" actually means

The v1 action registry. Each is a declarative action with a spec, a verifier and a test.

**Read** — `openFeed` · `openSubreddit` · `search` · `openPost` · `readComments` ·
`scrollFeed` · `loadMoreComments` · `openUserProfile` · `readInbox`

**Write** — `submitPost` · `submitComment` · `replyToComment` · `editOwn` · `deleteOwn` ·
`sendMessage` · `replyToMessage`

**Curate** — `join` · `leave` · `save` · `unsave` · `follow` · `unfollow` · `hide` ·
`report`

**Signal** — `upvote` · `downvote` · `clearVote` — **specified, not enabled.** See ADR-0007.

**Account** — `login` · `sessionRestore` · `checkHealth` · `readKarma` · `logout`

**Meta** — `wait` · `assert` · `extract` · `screenshot` (evidence) · `abort`

A workflow is a sequence of these with conditions. Workflows are data, not code
(ADR-0003), so a new behaviour is a new JSON document, never a new release.

## 5. Ground truths — verified, not assumed

| # | Truth | Source | Date |
|---|---|---|---|
| T-1 | Reddit self-serve API signup is closed; new access is manual, 2–4 weeks | Reddit Responsible Builder Policy | 2026 |
| T-2 | Reddit free API tier is non-commercial only; SGEN's use is commercial | Reddit Data API Terms | rev. 2026-07-20 |
| T-3 | Commercial API is ~$0.24/1k calls, $12,000/yr minimum | Reddit developer docs | 2026-07 |
| T-4 | Unauthenticated `.json` endpoints return 403 | observed | since 2026-05 |
| T-5 | Programmatic voting is explicitly prohibited, with an escalating ban ladder | Reddit *Disrupting Communities* policy | current |
| T-6 | Reddit correlates IP, login timing and vote timing to detect coordinated accounts | Reddit policy + transparency reporting | current |
| T-7 | Appilot's own product puts a human approval gate between AI draft and post | Appilot user guide §2–3 | supplied 2026-07-22 |
| T-8 | Appilot's shipped binary votes at `UPVOTE_CHANCE=50` and their guide does not mention it | APK static analysis | 2026-07-22 |
| T-9 | SGEN has no Android engineering capability | organisational fact | 2026-07 |
| T-10 | Playwright is already in SGEN's toolchain (site-qa) | repo | 2026-07 |

Anything not in this table and not in a spec is an assumption, and must be labelled as one
wherever it appears.

## 6. Non-negotiables

1. **No secret in any artifact.** Credentials come from the environment or an encrypted
   store, never from a file in this repo, never compiled in. This rule exists because the
   Appilot build shipped two live API keys inside the APK.
2. **Every outbound write is logged before it happens and after it happens**, with the
   account, the target, the content and the outcome. If it is not in the audit log it did
   not happen, and if it happened without a log entry that is a P0 bug.
3. **Rate limits live in code, not in a runbook.** A limit a human can forget is not a limit.
4. **Disclosure is enforced by a linter, not by a prompt.** A draft that mentions SGEN and
   lacks the disclosure line cannot reach the approval queue.
5. **No fabricated experience in generated text.** No invented war stories, no manufactured
   typos, no persona invention. Enforced by the draft linter.
6. **Kill switch.** One command halts every account, mid-workflow, everywhere.

## 7. Standing risks

| # | Risk | Owner | Standing mitigation |
|---|---|---|---|
| R-1 | Account suspension or shadowban | Jerome | rate caps in code, real accounts, human pace, one identity per account |
| R-2 | Subreddit rules forbid vendor participation | Jerome | **must be checked per subreddit before it is added to config** — r/WordPress first |
| R-3 | Public astroturfing accusation | Jerome | mandatory disclosure, human gate, kill criteria in the runbook |
| R-4 | FTC undisclosed endorsement (US) | Jerome | disclosure linter, audit log as the evidence trail |
| R-5 | Reddit changes the DOM | eng | selector pack is data, hot-swappable, with a golden-page test corpus |
| R-6 | Detection of automation | eng | human-pace timing, one session per account, no parallel bursts |
| R-7 | Bad draft published under SGEN's name | Jerome | approval gate default-on; kill criteria |
| R-8 | Nobody operates it and it rots | Jerome | named operator required before Phase 3 |

## 8. Decisions

Recorded in `DECISIONS.md`, one ADR per file in `ADR/`. Superseding an ADR requires a new
ADR that names it. Nothing is decided by conversation alone.

## 9. Phase gates

| Phase | Exit criterion |
|---|---|
| **P0 Plan** | canon + ADRs + requirements registry + module specs written and reviewed |
| **P1 Engineer** | action framework + selector pack + workflow schema implemented, unit-tested offline |
| **P2 Platform** | store, audit log, approval queue, dashboard, CLI, kill switch — all wired |
| **P3 Test** | full offline test suite green against a local fixture site; zero-network run passes |
| **P4 Real test** | live read-only run against reddit.com, logged out, one subreddit, no writes |
| **P5 Pilot** | one real account, human-approved writes only, r/WordPress, 2 weeks, measured |
| **P6 Deploy** | only after P5 shows positive outcomes and zero mod removals |

**No phase may be skipped, and P4 may not begin before P3 is green.** This is the MOE rule
and it is the reason MOE shipped something real.
