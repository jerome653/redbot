# redbot — MVP status

> **Superseded for current state (2026-07-23).** This page describes the Phase 1 MVP as it
> stood on 2026-07-22 and is kept for that record. Current build, gates and recommendation:
> [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md) · what Phase 2 added: [PHASE-2.md](PHASE-2.md).
>
> Figures below went stale within a day and are corrected here rather than in place:
> the suite is **184/184** (this page says 29/29 and the note below once said 93/93 — both are
> historical), and the 45 collected threads **were** scored — 45/45 analyzed, 9 worthwhile,
> 9 drafts, 7 lint-clean. The corpus has since grown to 58 threads and 12 drafts.
>
> **Do not quote any figure from this page.** It is retained as the Phase-1 record only.
> Current state: [`docs/12-FINAL-PHASE-ASSESSMENT.md`](docs/12-FINAL-PHASE-ASSESSMENT.md).

**Date:** 2026-07-22 · **Build:** TypeScript strict, 0 errors · **Tests:** 29/29 pass · **Leakage fuzz:** 31/31 blocked, 0 false positives

Scope is the MVP spec: one account, one browser, local-first, no fleet, no orchestrator,
no workflow engine, no voting, no dashboard.

---

## Definition of done — actual state

| # | Requirement | State | Evidence |
|---|---|---|---|
| 1 | Log into Reddit | **works** | attaches to operator Chrome, detects signed-in state, refuses cleanly if blocked |
| 2 | Reuse that session without logging in again | **works** | session lives in the Chrome profile; redbot stores no credential and no session file |
| 3 | Browse a subreddit | **VERIFIED LIVE** | `read wordpress` → 25 real threads with titles, upvotes, comment counts, bodies, comment trees |
| 4 | Search Reddit | **VERIFIED LIVE** | runs after the feed-contamination fix (DEFECT-03); results scoped to the search container |
| 5 | Generate a context-aware reply | **VERIFIED LIVE** | real drafts on real r/WordPress threads via the Claude CLI, per-operator auth; every draft that passes the linter is publishable as written |
| 6 | Approve it | **works** | approve / edit / reject prompt, re-lints after edit |
| 7 | Publish through Playwright | **built, awaiting a person** | a lint-clean draft is queued. An automated approval was attempted during testing and was correctly refused — if a script can approve, the approval gate is decoration |
| 8 | Save a complete local log | **works** | `history` reads `data/history.jsonl`; every command appends |

**7 of 8 verified live. 1 awaiting a single human keystroke.** No item is claimed as working
on the strength of the code alone.

### Ranking (DEFECT-07) — fixed, with a stated residue

The triage rubric was rewritten from a free 0-100 score into mechanical gates. Measured over
three runs of six threads:

| | before | after |
|---|---|---|
| average score spread | 19.2 | **6.7** |
| threads identical across all runs | — | 3 of 6 |
| threads within 10 points | — | 5 of 6 |

Two borderline threads still flip in and out of the queue. Both sit near the cut-off, so a
small score change crosses the line. This affects *which* marginal threads appear, not what
gets written, and a person still chooses from the queue.

---

## What is proven, with commands you can re-run

```
npm test                      25/25 pass — disclosure linter + JSON extraction
node qa/phase4-fuzz.mjs       31/31 leakage cases blocked, 0 false positives
node dist/cli.js              help
node dist/cli.js read wordpress
node dist/cli.js history
node dist/test/probe-raw.js   raw-CDP proof that Reddit serves real content
```

Guards, all returning the right exit code:

| Command | Precondition missing | Behaviour |
|---|---|---|
| `analyze` | no threads collected | exit 1, tells you to run `read` |
| `analyze` | no API key | exit 1, prints the exact export line |
| `draft` | nothing analyzed | exit 1, tells you to run `analyze` |
| `draft` | no API key | exit 1 |
| `reply` | no pending drafts | exit 1 |
| `read`/`search`/`reply` | no debuggable Chrome | exit 1, prints the full Chrome command to run |
| any | unknown command | exit 1 + usage |

Linter, 13 tests: rejects SGEN-mention-without-disclosure · fabricated personal experience
("I had this exact problem last year") · engagement bait ("hope this helps") · too-short
drafts. `ensureDisclosure` is idempotent. JSON extraction handles fenced, prefaced, nested
braces, braces inside strings, and both throw cases.

---

## The one architectural change

**Playwright must attach to a browser, not launch one.**

Measured: all four Playwright-launched modes get a Reddit block page. Attaching to a Chrome
the operator started works. Full experiment table in
`certification/evidence/2026-07-22-reddit-access.md`.

This made `read` go from 0 threads to 25.

It is also a better fit for the mission than the original design: the session is genuinely
the operator's, redbot never handles a password, and there is no session file to leak.

---

## How to run it

**Once per working session** — start the browser redbot will attach to:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
    --remote-debugging-port=9222 `
    --user-data-dir="D:\AI\Clients\SGEN\Projects\redbot\data\chrome-profile" `
    --no-first-run --no-default-browser-check
```

Visit reddit.com in that window once and sign in. Then:

```
$env:ANTHROPIC_API_KEY = "sk-ant-..."      # required by analyze and draft

node dist/cli.js login                      # confirms the session
node dist/cli.js read wordpress             # collect threads
node dist/cli.js analyze                    # score them
node dist/cli.js draft                      # generate one reply, linted
node dist/cli.js reply                      # review, approve/edit/reject, publish
node dist/cli.js history                    # what happened
```

---

## Open items

| # | Item | Blocks | Note |
|---|---|---|---|
| O-1 | `ANTHROPIC_API_KEY` not set on this host | verifying `analyze` + `draft` live | one env var. **Use a fresh key — not the one compiled into the Appilot APK, which should be rotated** |
| O-2 | `reply` never exercised against Reddit | verifying publish | first run should target a throwaway post you own, not a real thread |
| O-3 | Cold-profile ambiguity in the access evidence | nothing — recipe works either way | recorded in the evidence file, not resolved |
| O-4 | `search` not run live | low | shares the verified code path with `read` |
| O-5 | Selector drift | future reads | all selectors are in `src/reddit/selectors.ts`, one file |

---

## r/WordPress rule 1

Read off the sidebar in the captured screenshot:

> **1. No promotions of products or services**

That is the publishing constraint answered for free. It does not stop a disclosed SGEN
engineer answering a technical question; it does stop promotion. The `answerableWithoutPitch`
field in the analyze prompt is therefore not a nicety — it is the rule of the room, and
`draft` already refuses to consider any thread where that field is false.

---

## Source

25 files, 1,691 lines TypeScript, strict mode.

```
src/cli.ts                    command dispatch
src/config.ts                 paths, models, pacing, disclosure line
src/browser.ts                attach over CDP · isLoggedIn · isBlocked
src/store.ts                  atomic JSON + append-only history
src/llm.ts                    Anthropic client + JSON extraction
src/prompts.ts                analyze + draft prompts
src/disclosure.ts             the linter — the gate before any draft is shown
src/pacing.ts  src/ask.ts  src/log.ts  src/types.ts
src/reddit/selectors.ts       every selector, one file
src/reddit/scrape.ts          feed → permalinks → thread records
src/reddit/post.ts            the only write path
src/commands/*.ts             login read search analyze draft reply history
src/test/*.test.ts            13 tests
src/test/probe*.ts            the four access experiments
```

Dependencies: `playwright` only. Dev: `typescript`, `@types/node`.


---

## Defects found after the first certification pass

Both were found by attempting a real publish, and both were silent failures.

### DEFECT-08 — the approval gate failed open (critical)

`choose()` returned `options[0]` for any unrecognised answer. `reply` calls it with
`['a','e','r']`, so a blank line, a typo, or a stray newline resolved to **approve, and post**.

It had never fired: the only non-interactive run died at end-of-input before deciding. A single
stray newline would have published.

Fixed — the safe answer is now a required argument (`'r'` for the publish gate), unrecognised
input re-asks, and a non-interactive stdin throws `NoTerminalError` instead of proceeding.
Four regression tests in `src/test/ask.test.ts`, one of which reads `reply.ts` to catch a
positional default being re-introduced.

### DEFECT-09 — an error message with nothing in it (high)

Drafting failed with `claude CLI exited 1:` and nothing after the colon. A batch run produced
no drafts for forty minutes with no usable explanation.

Cause: per-operator auth correctly refused to use the machine's ambient Claude login, but the
"not signed in" check sat *after* the exit-code branch, so a non-zero exit skipped it — and the
CLI writes "Not logged in" to **stdout** while the error path read only **stderr**.

Fixed — the auth check runs first and reads both streams; any other non-zero exit reports
whichever stream produced output. The message now names the operator and prints the exact
sign-in command.

### Current blocker for growing the draft sample

Operator `jerome` has no Claude credentials in its config dir, so `analyze` and `draft` refuse.
This is the per-operator design working. To unblock:

```powershell
$env:CLAUDE_CONFIG_DIR = "D:\AI\Clients\SGEN\Projects\redbot\data\operators\jerome\claude"
claude          # then /login, then close
```

45 threads are collected and waiting to be scored.
