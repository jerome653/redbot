# Operator Dashboard v2

**Status:** complete and validated · 2026-07-23
**Engine files modified:** 0 · **QA:** 67/67 · **Tests:** 182/182

The browser is the normal way to operate redbot. It is not a second implementation — it is a client
that runs the same commands a person would type and shows the output verbatim.

---

## The one rule

**The dashboard holds no business logic and must never hold any.**

Every action spawns the real command. Nothing is summarised, re-derived, re-scored or "improved" on
the way to the screen. If a number is wrong, the command is wrong — there is no second implementation
here that could disagree with the first.

That is not a stylistic preference. A UI that recomputes a verdict is a UI that can disagree with the
engine, and once two things can disagree about whether a draft is certified, neither is authoritative.

---

## Running it

```bash
node tools/operator/server.mjs --port 7890     # → http://127.0.0.1:7890
```

Set `REDBOT_OPERATOR` in the launching shell for credential-backed commands; the dashboard reads it
exactly as `src/config.ts:78` does and shows `unset` when it is absent.

**Stack:** `node:http` + `node:child_process` + one HTML file. No framework, no React, no build step,
no database, no websocket, no charting library. Charts are hand-written SVG.

---

## Layout

A fixed sidebar with three groups — Overview, Evidence, Gates, System — and ten pages. The topbar
carries four live state chips: operator, Chrome, freeze, and a permanent `read-only` badge.

### Dashboard

**Row 1 — four status cards**, each colour-coded and never plain text:

| Card | States |
|---|---|
| Engine | FROZEN (blue) / ATTENTION (amber) |
| Validation | PASSING (green) / ATTENTION (red) |
| Corpus | CALIBRATED (green) / PARTIAL (amber) / UNCALIBRATED (red) |
| Publication | READY (green) / BLOCKED (red) / N/A |

**Row 2 — certification pipeline.** Five stages, left to right, each with a count, a progress bar and
a completion percentage:

```
Ground Truth → Calibration → Benchmark → Replay → Ready
    1/2            0/2          4/4       READY     63%
```

Stage colour encodes state: green complete, amber partial, red blocked. When calibration is at zero
the panel states the blocker in words — *"No case has both a human verdict and complete per-claim
labels. This is the one stage no amount of engineering clears."*

**Row 3 — eight live metrics** with animated count-up (suppressed under `prefers-reduced-motion`):
total certifications, CERTIFIED, ESCALATE, REJECT, ground truth cases, calibration approved,
published, operator reviews. Zeros render red, because on this project the zeros are the story.

**Row 4 — health chips**: Tests · Benchmark · Replay · Corpus · Extraction · Freeze · Doctor.

Tests and Doctor show **"run to measure"** rather than a colour. The panel never asserts a gate it
has not run — a green chip for an unrun test is exactly the kind of comfortable lie this project
exists to avoid.

**Charts** — four, all hand-written SVG:

| Chart | Source |
|---|---|
| Corpus growth (area, 7 points) | `data/history.jsonl` — cumulative threads added |
| Certification distribution (bars) | `data/certifications.jsonl` |
| Validation trend (area) | `tools/operator/run-history.jsonl` |
| Benchmark confusion (bars) | `qa/benchmark/last-run.json` |

**Widgets** — latest certification with verdict badge, claim/contradiction/fatal/invalidated counts,
fired rules and an Open button; ground truth with a progress ring; publication readiness with a
progress bar and all eight release checks.

**Recent activity** — a timeline, newest first, colour-coded per event kind, merging the engine's own
`data/history.jsonl` with artefact mtimes and this console's run log. Every entry names its source.

### Certifications — the flagship page

Record table, then the full reasoning for one record: header with seven summary figures, then
collapsible sections for **rule firing order** (numbered, in the order the engine fired them),
**dependency graph**, **claims · provenance · evidence**, **contradictions**, **epistemic issues**,
**thread resolution** and **raw JSON**.

A search box filters claim and contradiction rows live and reports `n of m rows match`; Expand all /
Collapse all operate on every section.

The dependency graph is a layered DAG: red for a fatal contradiction, amber for invalidated, a dashed
edge for the dependency that killed it, with a legend.

### Ground Truth

Progress ring, four status badges (ground truth · calibration · benchmark · argus), reviewed/pending
counts, blockers as chips, human claim labels as a table, and case files rendered as markdown in
place.

**There is no control anywhere that writes a label.** A form that set `truth: false` would let a click
become an answer key, and the corpus would stop being ground truth the day it shipped.

### Reports · Benchmark · Replay · Validation · Logs · Settings · About

- **Reports** — markdown with syntax highlighting (json / bash / yaml / js), a sticky table of
  contents built from the rendered headings, and anchor scrolling.
- **Benchmark** — run, then cases / passed / failed / drafts / verdict-path coverage / elapsed, plus
  calibration, stages, per-path coverage and a before/after comparison.
- **Replay** — runs when preconditions hold; otherwise explains exactly what is missing. **A missing
  precondition is never displayed as an error.**
- **Validation** — one click runs all six gates in sequence with a live elapsed counter and a summary
  chip (`6 passed · 0 failed · 0 unavailable · 4.1s`), plus a per-gate result cell and full stdout.
- **Logs** — split view, six CLI readouts and six append-only files, with a 5-second auto-refresh
  toggle. Absent files explain *why* they are absent.
- **Settings** — read-only environment: Node, TypeScript, platform, operator, branch, commit, working
  tree, freeze state, repository paths, port. **Zero form controls on the page** — asserted in QA.
- **About** — what the dashboard is, the rule it obeys, what it cannot do, and the honest state.

---

## Evidence policy

Every displayed metric originates from a CLI command or a JSON file on disk. Nothing is recomputed.

**The validation trend chart is the test of that policy.** No timestamped run history existed
anywhere in the project — `last-run.json` has no timestamp and nothing else records gate runs over
time. Rather than invent a plausible-looking series, the console records the exit code and duration
of runs *it* starts, in `tools/operator/run-history.jsonl`, and shows an empty state until there is
something real to draw:

> *No trend yet. This series records validation runs started from this console; it begins empty by
> design rather than showing invented history.*

Similarly, **corpus growth shows two different numbers on purpose**: cumulative threads added (90)
and the current corpus (58). They differ because threads are deduplicated and dropped downstream.
Reconciling them in the UI would have meant inventing a calculation the engine does not perform.

---

## Security

Unchanged from v1, re-verified in v2 QA.

| Refused | Why |
|---|---|
| `reply` | publishes to Reddit; requires a human at a real terminal |
| `regret` | asks a person two questions — a web form is not that person |
| `observe` | drives the operator's browser against a live thread |
| `read` · `search` · `session` · `login` | drive the operator's browser |
| `draft` · `opportunity` · `certify` | spend model calls and write evidence |

Allowlist, not denylist — a denylist admits every future command by default, and one of them
publishes. `/api/file` serves four directories and a fixed root list; path traversal is refused.
Binds `127.0.0.1` only.

The only file this server writes is its own run log.

---

## QA — 67/67

`node tools/operator/qa-console.mjs --port <port>` drives every page in a real browser and asserts on
what rendered.

| Area | Checks |
|---|---|
| sidebar | 10 items, 3+ groups, 10 inline SVG icons |
| navigation | all 10 pages, one visible section, correct title |
| dashboard | 4 status cards colour-coded · 5 pipeline stages · 5/5 bars filled · 8 metrics resolved to numbers · 7+ health chips · 4+ SVG charts · ring value · timeline populated with timestamps · publication widget |
| integrity | validation trend states its own source or absence |
| certifications | 4 records · detail auto-opens · 19 graph nodes · 7 collapsible sections · expand/collapse all · search filters 7 of 49 rows |
| ground truth | ring · 4 badges · empty state · blockers · 29 markdown headings |
| reports | TOC generated · headings rendered · no raw markdown leaked |
| security | refuses reply, regret, observe, login, read, session, certify, traversal |
| logs | absent log explained, not errored · auto-refresh control · split view |
| validation | 6 gate cells · doctor ran · **exit code matches the API verbatim** · summary cell updates · 182/182 through the UI |
| settings | node · typescript · branch · freeze · read-only · **zero form controls** |
| refresh / theme | stays on page, re-renders, one page visible, theme toggles both ways |
| layout | 390 · 768 · 1280 · 1600 px — no horizontal body overflow |
| runtime | no uncaught JS errors |

### Two defects found by this QA pass

**Pipeline progress bars were all stuck at zero.** The arrow icon was appended with
`b.innerHTML += …` *after* the bar element was appended — which re-parses the subtree and orphans the
bar node, so `requestAnimationFrame` set width on a detached element. Silent: the markup looked
correct in the DOM inspector because the re-parsed copy was there. Fixed by appending the icon as a
node.

**The screenshot capture was scrolling nothing.** v2 makes `<main>` the scroll container, so
`window.scrollTo()` is a no-op — every "scrolled" shot was actually the top of the page. Two
screenshots were identical before this was caught. Fixed with `scrollIntoView`.

---

## Screenshot gallery — 24 images

Reproducible, not hand-collected:

```bash
node tools/operator/server.mjs --port 7896
node tools/operator/capture-screenshots.mjs --port 7896
```

| # | File | Shows |
|---|---|---|
| 01–02 | `01-dashboard-full` · `02-dashboard-above-fold` | the whole dashboard; the five-second read |
| 03–04 | `03-dashboard-pipeline-and-metrics` · `04-dashboard-activity-timeline` | pipeline, metrics, timeline |
| 05–09 | `05-certifications` … `09-certification-search` | records, rule firing order, dependency graph, expanded, search |
| 10–12 | `10-groundtruth-hrc001` · `11-groundtruth-cert002-unlabelled` · `12-groundtruth-markdown` | approved case, unlabelled case, rendered markdown |
| 13 | `13-reports-with-toc` | markdown + table of contents |
| 14–15 | `14-benchmark` · `15-replay` | gates run from the UI |
| 16–17 | `16-validation-summary` · `17-validation-full` | six gates, summary chip, full stdout |
| 18–19 | `18-logs-split-view` · `19-logs-absent-explained` | split view; an absent file explained |
| 20–21 | `20-settings` · `21-about` | read-only environment; what this is |
| 22 | `22-dashboard-light` | light theme |
| 23–24 | `23-viewport-tablet-768` · `24-viewport-phone-390` | narrow-viewport renders |

Playwright drives its own bundled Chromium against `127.0.0.1`. It does not attach to the operator's
Chrome and has nothing to do with Reddit, where the attach-never-launch rule applies.

> **Note for publication:** the validation screenshots contain `doctor` output verbatim, which
> includes a local Windows profile path. That is correct behaviour — the console shows what the
> command printed — but it means the gallery must not be copied into the public repository without a
> scrub. See `PUBLICATION-AUDIT.md`.

---

## Not claimed

**A responsive QA pass was not performed.** The standing by-law requires a multi-viewport pass in the
Responsive Viewer extension; `list_connected_browsers` returned an empty list, so it could not run.

What *was* measured: `document.documentElement.scrollWidth` equals viewport width at 390, 768, 1280
and 1600 px — no horizontal body overflow, with tables, terminal panes and the dependency graph
scrolling inside their own containers, and the sidebar collapsing to an overlay below 900 px. That is
a rendering check at four widths, not a device-frame pass, and it should not be recorded as one.

---

## Files

```
tools/operator/server.mjs               local server — spawns commands, serves read-only JSON
tools/operator/index.html               the dashboard — 10 pages, vanilla JS, hand-written SVG
tools/operator/capture-screenshots.mjs  reproducible gallery capture
tools/operator/qa-console.mjs           67-check browser QA suite
tools/operator/run-history.jsonl        this console's own run log (generated)
tools/operator/screenshots/             24 PNGs
```

Nothing under `src/`, `qa/`, `ground-truth/`, `certification/`, `replay/` or `benchmark/` was created,
modified or deleted.
