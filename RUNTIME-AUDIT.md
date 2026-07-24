# Runtime audit — 2026-07-23

**Audit only. Nothing built, nothing modified, nothing published.** Every statement below was
executed or read, not inferred.

## The headline

**redbot is a pure command-line application. There is no server, no web UI, no API, no dashboard,
no localhost service, and no background process.**

It has one runtime dependency (Playwright), and the only thing it listens to is a Chrome that
**the operator** starts. **11 of its 19 commands run right now with zero configuration.**

---

## 1 · Entry-point inventory

### npm scripts — `package.json`

| Script | Command | Purpose | Validated |
|---|---|---|---|
| `build` | `tsc` | compile `src/` → `dist/` | ✅ exit 0 |
| `dev` | `tsc --watch` | recompile on change — the **only** long-running dev process | not run (audit) |
| `redbot` | `node dist/cli.js` | run the CLI | ✅ |
| `test` | `tsc && node --test dist/test/*.test.js` | 182 tests | ✅ 182/182 |
| `typecheck` | `tsc --noEmit` | strict typecheck | ✅ clean |

`bin: { "redbot": "dist/cli.js" }` — installable as a global `redbot` command.

### CLI commands — 19, all dispatched in `src/cli.ts`

| Command | Args | Needs | Output | Validated |
|---|---|---|---|---|
| `help` | — | nothing | usage text | ✅ exit 0 |
| `doctor` | — | nothing | 15 install checks | ✅ 12 pass / 3 warn / 0 fail |
| `policy` | — | nothing | 24 limits + provenance | ✅ exit 0 |
| `health` | `[account]` | nothing | account state machine | ✅ `Caution` |
| `metrics` | `[--json]` | nothing | reliability figures | ✅ exit 0 |
| `review` | — | nothing | operator decisions | ✅ `0 decision(s)` |
| `insights` | — | nothing | pipeline loss analysis | ✅ exit 0 |
| `select` | `[--all]` | nothing | ranked candidates | ✅ **7 eligible of 24** |
| `report` | — | nothing | regenerates 14 reports | ✅ exit 0 |
| `history` | `[n]` | nothing | activity log | ✅ exit 0 |
| `backup` | `[--list\|--verify]` | nothing | evidence snapshots | ✅ **6 snapshots** |
| `certify` | `[draftId] [--override]` | LLM creds | CERTIFIED/ESCALATE/REJECT | ✅ run live earlier |
| `opportunity` | `[--force] [--limit N]` | LLM creds | gap analysis + verdicts | ✅ run live earlier |
| `draft` | `[threadId]` | LLM creds | a drafted reply | ✅ run live earlier |
| `regret` | `[draftId]` | **TTY** | 2 human questions | never run (0 rows) |
| `login` | — | **Chrome** | session confirmation | ✅ fails safely |
| `read` | `<subreddit>` | **Chrome** | collected threads | ✅ fails safely |
| `search` | `"<query>"` | **Chrome** | collected threads | ✅ fails safely |
| `session` | `[--kind] [--sub]` | **Chrome** | a browsing session | never run (0 events) |
| `observe` | `[draftId] [--checkpoint]` | **Chrome** + a publish | checkpoint readings | ✅ fails safely |
| `reply` | `[draftId] [--quick]` | **Chrome + TTY** | publishes | **never run** |

### Shell / batch / PowerShell launchers

**None exist.** `find` for `*.ps1 *.sh *.bat *.cmd` outside `node_modules` returns nothing. The
PowerShell snippets in `README.md` are documentation, not files.

---

## 2 · Runtime architecture

```
  OPERATOR starts Chrome with --remote-debugging-port=9222
        │                       (redbot NEVER launches a browser — see below)
        ▼
  attach ──── browser.ts · chromium.connectOverCDP('http://127.0.0.1:9222')
        │
        ▼
  COLLECT      read / search ──► reddit/scrape.ts ──────────► data/threads.json
        │
        ▼
  ANALYSE      opportunity ──► gap.ts (LLM) ─────────────► data/gaps.json
                            └► opportunity.ts (mechanical) ► data/assessments.json
        │                      competence.ts · select.ts
        ▼
  DRAFT        draft ──► prompts.ts + llm.ts (LLM) ───────► data/drafts.json
                       └► disclosure.ts · novelty.ts · quality.ts
        │
        ▼
  CERTIFY      certify ──► argus/pipeline.ts ─────────────► data/certifications.jsonl
                  resolution (code) → extract (LLM) → contradiction (LLM, adversarial)
                  → graph (code) → epistemic (code) → certify (code, 12 rules)
        │
        ▼
  GATE         gates.ts — 20 conditions, all fail-closed
        │      health.ts — Healthy / Caution / Cooldown / Stop
        ▼
  HUMAN        reply ──► ask.ts — TTY REQUIRED, non-interactive throws
        │            └► review.ts ────────────────────────► data/reviews.jsonl  [0]
        ▼
  PUBLISH      reddit/post.ts ─────────────────────────────► 104 lines, NEVER EXECUTED
        │                                                     interactions.jsonl [0]
        ▼
  OBSERVE      observe ──► 4 checkpoints, signed-in + signed-out
        │                                                  ► observations.jsonl [1]
        ▼
  LEARN        regret ──► 2 questions ────────────────────► regret.jsonl        [0]
               metrics · insights · report
```

**Everything from PUBLISH down has never run.**

---

## 3 · Interfaces — exhaustive search

Searched for React · Next.js · Vite · Electron · Tauri · Express · Fastify · Hono · WebSocket ·
GraphQL · OpenAPI · Swagger · Ink · Blessed · Commander · Inquirer.

**Zero hits in live code.** Matches appeared only in collected Reddit thread content
(`data/threads.json`, `gaps.json`, corpus cases) — i.e. people talking about React, not us using it.

> **Superseded 2026-07-23 by the operator console.** The "zero hits" finding above remains true —
> the console introduced no framework. It is `node:http` + `child_process` + one HTML file. See §11.

| Path | Purpose | Launch | Status |
|---|---|---|---|
| **`tools/operator/`** | **the operator console — 8 pages over the existing CLI** | **`node tools/operator/server.mjs`** | **live; read-only; see §11** |
| `design/redbot-ui-mockup.html` | 63 KB accounts-first operator mockup | open in a browser | **static mockup — no `fetch`, no backend, no data hooks** |
| `design/redbot-mvp.html` | 34 KB MVP presentation | open in a browser | **static mockup** |
| `_superseded/*.html` (4) | historical proposals | — | abandoned, archived |

Both design files were grepped for `fetch(`, `XMLHttpRequest`, `localhost`, `<script src=` and
`/api/` — **no matches**. They render a picture of an interface that does not exist.

**Interactive terminal input** exists but is not a TUI: `ask.ts` uses `node:readline` for the
approval prompt and reason codes. No Ink, no Blessed, no Commander — `cli.ts` parses `process.argv`
by hand.

---

## 4 · Services

**No long-running service exists *in the engine*.** No worker, no queue, no cron, no poller, no
filesystem watcher, no MCP server. No `chokidar`.

> **Amended 2026-07-23.** One `createServer` / `.listen(` now exists — `tools/operator/server.mjs`,
> the operator console. It is a **tool, not part of the engine**: nothing under `src/` imports it,
> nothing depends on it running, and every engine command behaves identically whether it is up or
> down. It binds `127.0.0.1` only and spawns the same commands a person would type. See §11.

| Construct | Where | Nature |
|---|---|---|
| `setTimeout` | `llm.ts:30,102`, `pacing.ts:3` | retry backoff and a subprocess kill-timer — not schedulers |
| `spawn` | `llm.ts:79` | one child process: the `claude` CLI, awaited then exits |
| Playwright | `browser.ts` + 5 modules | **`connectOverCDP` only — `chromium.launch` is never called** |
| `tsc --watch` | `npm run dev` | the only persistent process, and it is a compiler |

**Architectural rule, verified in source:** redbot attaches to a browser the operator opened. Every
Playwright-*launched* browser received a Reddit block page — that finding is why `attach()` exists
and `launch()` does not.

---

## 5 · Data stores

All local files. No SQLite, Postgres, Redis, or any database.

| Store | Bytes | Writer | Reader | Lifecycle |
|---|---|---|---|---|
| `threads.json` | 213 K | `saveThreads` ← read/search | opportunity, draft, select, observe | upsert by id |
| `analysis.json` | 29 K | **none — retired (D-01)** | nothing | frozen evidence |
| `gaps.json` | 56 K | `saveGaps` ← opportunity | draft, reports | upsert |
| `assessments.json` | 25 K | `saveAssessments` ← opportunity | draft, select, reply, gates | upsert |
| `drafts.json` | 25 K | `saveDraft` ← draft/reply | reply, certify, observe | upsert; status pending→published |
| `certifications.jsonl` | 80 K | `recordCertification` ← certify | benchmark, replay, corpus | append-only |
| `history.jsonl` | 12 K | `record()` ← every command | history, metrics, health | append-only |
| `trace.jsonl` | 99 K | `trace()` | insights | append-only |
| `observations.jsonl` | 162 B | `recordObservation` ← observe/probe-karma | health | append-only · **1 row** |
| `reviews.jsonl` | — | `recordReview` ← reply | review, reports | **0 rows** |
| `regret.jsonl` | — | `recordRegret` ← regret | reports | **0 rows** |
| `interactions.jsonl` | — | `appendInteraction` ← reply/observe | — | **0 rows** |
| `reports/` | 14 files | `redbot report` | humans | fully regenerated |
| `data/chrome-profile*/` | ~GB | Chrome | Chrome | **credentials — gitignored** |
| `data/operators/` | — | operator | `claudeConfigDir()` | **credentials — gitignored** |

---

## 6 · APIs

| API | Caller | Callee | Auth | Purpose |
|---|---|---|---|---|
| **Chrome DevTools Protocol** | `browser.ts` | `127.0.0.1:9222` | none — local | attach to the operator's browser |
| **Claude CLI** | `llm.ts:79` | `claude` subprocess | per-operator `CLAUDE_CONFIG_DIR` | default LLM provider |
| **Anthropic Messages API** | `llm.ts:177` | `api.anthropic.com/v1/messages` | `ANTHROPIC_API_KEY` | LLM when `REDBOT_LLM=api` |
| **Reddit** | `reddit/*.ts` | `reddit.com` **through the attached browser** | the operator's own session | read, and one write path |
| Filesystem | `store.ts`, `backup.ts` | local disk | — | all persistence |

**No API is exposed *by the engine*.** redbot itself serves nothing; it only calls out.

> **Amended 2026-07-23.** The operator console exposes a local read-only HTTP API on `127.0.0.1`:
> `/api/dashboard`, `/api/commands`, `/api/run`, `/api/certifications`, `/api/certification`,
> `/api/ground-truth`, `/api/reports`, `/api/file`, `/api/log`. Auth is the loopback bind. `/api/run`
> accepts only allowlisted keys; `/api/file` serves only four directories and a fixed file list.
> Verified refusals: `reply`, `regret`, `read`, `draft`, `observe`, `login`, `certify`,
> `../../../etc/passwd`, `../../.env`, `data/operators/operators.json`, `src/argus/certify.ts`.

---

## 7 · Operator workflow — verified

| Question | Answer | Status |
|---|---|---|
| **Launch redbot?** | `node dist/cli.js <cmd>`. No daemon to start | ✅ works now |
| **Certify one reply?** | `$env:REDBOT_OPERATOR="jerome"; node dist/cli.js certify <draftId>` | ✅ works — needs LLM creds only, **no browser** |
| **Benchmark?** | `node qa/benchmark/run.mjs` | ✅ exit 0 |
| **Replay?** | `node qa/ARE-001-argus-replay.mjs` | ✅ exit 0 |
| **Publish?** | `node dist/cli.js reply <draftId>` | ⛔ needs Chrome **and** a real TTY. Never executed |
| **Inspect evidence?** | `redbot report` → 14 markdown files; `history`, `metrics`, `insights`, `review` | ✅ works now |
| **Review claims?** | Open `ground-truth/cases/HRC-001/ADJUDICATION-PACKET.md` in an editor | ⚠️ **markdown only — no UI** |
| **Stop it?** | Nothing runs in the background. Every command exits | ✅ nothing to stop |

### What cannot be done today, and exactly why

- **Publish** — requires (a) Chrome on `:9222`, currently not running, and (b) a human at a real
  terminal. `ask.ts` throws `NoTerminalError` on non-interactive stdin by design.
- **Observe** — nothing has been published, so there is nothing to observe.
- **Review claims in a UI** — no UI exists. Adjudication is editing markdown by hand.

---

## 8 · Launch test — results

**11 commands booted with zero configuration, all exit 0:**
`help · doctor · policy · health · metrics · review · insights · select · report · history · backup --list`

None started a server. None opened a browser. None waited for input. None exposed a port.

**4 browser-dependent commands failed safely** with `No debuggable Chrome at http://127.0.0.1:9222`
and exit 1 — `login`, `read`, `search`; `observe` reported `Nothing has been published`.

**`reply` was invoked with empty stdin and refused** — exit 1, stopped at the Chrome check before
reaching the approval gate. **No publish was possible.**

CDP probe: `127.0.0.1:9222` — **nothing listening.**

---

## 9 · Missing operator capabilities

Measured against what exists, not against a wishlist. **Status updated 2026-07-23.**

1. **No claim-adjudication interface.** — **still open, and still the bottleneck.** The console
   *displays* every claim, its label and what blocks the case, but writing a ruling stays a human
   act in the case file. That is deliberate: a form that writes `truth: false` into
   `ground_truth.claim_labels` would let a click become an answer key.
2. ~~No way to view a certification without reading raw JSON.~~ — **closed.** The Certifications page
   renders claims, provenance, evidence, contradictions, epistemic issues, the dependency graph, the
   fired rules and the raw record.
3. ~~No live status view.~~ — **closed.** The Dashboard composes corpus, benchmark, replay, extraction,
   freeze state, doctor and eleven operational counts on one page.
4. **The design mockups are not wired to anything.** — **still true of the mockups.** They were not
   used; the console was built against the real API surface instead.
5. **No `argus` verb for a non-Reddit draft.** — **still open.** Certification is still reachable
   only through a stored `Draft` + `Thread`, and the console does not expose certification at all.

---

## 10 · Fastest path to a usable operator experience with ONLY what exists

**redbot is already operable today. It is a CLI, and the CLI works.**

```powershell
# One-time per session — the browser redbot attaches to (needed for read/reply only)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
    --remote-debugging-port=9222 `
    --user-data-dir="D:\AI\Clients\SGEN\Projects\redbot\data\chrome-profile" `
    --no-first-run --no-default-browser-check

$env:REDBOT_OPERATOR = "jerome"

# Works with NO browser at all:
node dist/cli.js doctor            # is the install sound
node dist/cli.js select            # 7 eligible candidates right now
node dist/cli.js certify <draftId> # full Argus certification
node dist/cli.js report            # regenerate 14 evidence reports
node qa/benchmark/run.mjs          # 4/4
node ground-truth/validate.mjs     # corpus status

# Needs the Chrome above:
node dist/cli.js login
node dist/cli.js read wordpress
node dist/cli.js reply <draftId>   # + a real terminal
```

**The single highest-value thing already possible with no new code:** open
`ground-truth/cases/HRC-001/ADJUDICATION-PACKET.md`, rule on 9 claims, transfer them into
`ground-truth/build-corpus.mjs`, then run `validate.mjs --fix`. That produces the project's first
calibration-approved case — the one blocker every other measurement waits on.

---

## 11 · The operator console — added 2026-07-23

The browser is now the normal operating surface. It is a **client of the CLI**, nothing more.

```
node tools/operator/server.mjs --port 7890   →   http://127.0.0.1:7890
```

### What it changed about the runtime

| Before | After |
|---|---|
| No interface | 8 pages: Dashboard · Certifications · Ground truth · Reports · Benchmark · Replay · Validation · Logs |
| No `createServer` anywhere | one, in `tools/`, loopback-bound, no dependencies |
| No exposed API | 9 read-only local endpoints, allowlisted |
| Certifications read as raw JSONL | rendered with a dependency graph and per-claim state |
| Gates run one command at a time | one click runs all six and shows every stdout |

### What it did NOT change

`src/` is untouched. `npm test` is **182/182**. Benchmark, corpus, replay and extraction all still
exit 0, and the benchmark's own before/after comparison reports **identical** — which is the expected
result under freeze, and the console displays that fact rather than hiding it.

### Measured through the console, 2026-07-23

| Command | Exit | Time |
|---|---|---|
| `redbot doctor` | 1 | 485 ms |
| `npm test` — tests 182 · pass 182 · fail 0 | 0 | 3.7 s |
| `node qa/benchmark/run.mjs` — 4/4 | 0 | 72 ms |
| `node ground-truth/validate.mjs` | 0 | 72 ms |
| `node qa/ARE-001-argus-replay.mjs` | 0 | 63 ms |
| `node tools/verify-extraction.mjs` — 39 verified · 0 deviated | 0 | 66 ms |
| `history` · `metrics` · `insights` · `health` · `review` · `backup` · `policy` · `select` · `report` | 0 | 429–464 ms each |

**`doctor` exits 1**, and that is the install's real state, not a console defect: `llm operator` FAILs
because `REDBOT_OPERATOR` selects credentials that are not present, and three checks WARN — Chrome
absent, 6 provisional limits, empty review dataset. The console shows the failure verbatim rather
than dressing it up.

### Replay became available

At the time of the original audit this section would have read *blocked*. Four certification records
now exist, so ARE-001 runs — the console detects the precondition and switches the page from an
explanation to a run button. **When a precondition is missing the console explains it; it never shows
an error.**

### What is still impossible from the browser, by design

`reply` · `regret` · `observe` · `read` · `search` · `session` · `login` · `draft` · `opportunity` ·
`certify` are absent from the allowlist. Publishing needs a person at a real terminal; `ask.ts`
throws `NoTerminalError` on non-interactive stdin, and routing that prompt through a web page would
destroy the property that makes every published word attributable to a human.

Full documentation: `OPERATOR-CONSOLE.md`.
