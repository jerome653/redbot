# Final operator report

**Date:** 2026-07-23
**Phases covered:** 9 (console) · 10 (release hardening) · 11 (Dashboard v2)
**Result:** complete and validated

> **Phase 11 summary — Operator Dashboard v2.** Ten pages behind a sidebar; four colour-coded status
> cards; a five-stage certification pipeline with progress bars; eight animated live metrics; health
> chips; four hand-written SVG charts; an activity timeline; latest-certification, ground-truth and
> publication widgets; a searchable, collapsible certification viewer; read-only Settings.
> **ENGINE FILES MODIFIED: 0 · 182/182 · QA 67/67 · benchmark, corpus, replay exit 0 · extraction
> 39 verified / 0 deviated.** Full reference: `OPERATOR-CONSOLE.md`.
>
> Two defects were found by the Phase 11 QA pass and fixed: pipeline progress bars were stuck at zero
> because an `innerHTML +=` after the append orphaned the bar node, and the screenshot capture was
> scrolling nothing because v2 makes `<main>` the scroll container rather than the window. Both were
> silent failures that looked correct until asserted against.
>
> No new data source was invented for the dashboard. Where no real series existed — validation
> trend — the chart shows an empty state and says why, and the console now records its own runs so
> the series becomes real over time rather than plausible immediately.

---

# Phase 9 — Operator Console Completion

**Phase:** Operator Console Completion
**Result:** complete and validated

---

## ENGINE FILES MODIFIED: 0

Nothing under `src/`, `qa/`, `ground-truth/`, `certification/`, `replay/` or `benchmark/` was
created, modified or deleted by this phase.

**Every file changed — 12, all new, all under `tools/operator/`:**

```
tools/operator/server.mjs                  local server (rewritten from the v0 shell)
tools/operator/index.html                  the console (rewritten — 5 tabs → 8 pages)
tools/operator/capture-screenshots.mjs     reproducible gallery capture
tools/operator/screenshots/*.png           18 images
```

**Documentation:**

```
OPERATOR-CONSOLE.md      new
FINAL-OPERATOR-REPORT.md new
RUNTIME-AUDIT.md         updated — §3, §4, §6, §9 corrected; §11 added
```

### The one engine-directory file with a new timestamp

`qa/benchmark/last-run.json` — 18:16, written by running the benchmark through the console.
Writing that file is the benchmark's documented purpose. Verified deterministic: copied it, re-ran
`node qa/benchmark/run.mjs`, and diffed — **byte-identical**. The console's own before/after
comparison independently reported `0 / 0 / 0` change.

Three files under `ground-truth/` also carry today's date —
`ground-truth/cases/CERT-002/LABELLING-WORKSHEET.md` (12:30),
`ground-truth/cases/HRC-001/ADJUDICATION-PACKET.md` (13:02),
`ground-truth/make-adjudication-packet.mjs` (13:01). All three predate the console phase, which began
at 18:00. They belong to the earlier adjudication work in this session, not to this one.

---

## Validation — all gates green

| Gate | Command | Result |
|---|---|---|
| **Tests** | `npm test` | **tests 182 · pass 182 · fail 0** |
| **Benchmark** | `node qa/benchmark/run.mjs` | exit 0 — 4 cases, 4 passed, 0 failed |
| **Corpus** | `node ground-truth/validate.mjs` | exit 0 — 2 cases, 0 structural failures |
| **Replay** | `node qa/ARE-001-argus-replay.mjs` | exit 0 — recorded verdict reproduced |
| **Extraction** | `node tools/verify-extraction.mjs` *(argus repo)* | exit 0 — 39 verified · 0 deviated · 0 missing |

Each was also run **through the console**, which is the point: the interface executes the real
command and reports the command's own exit code.

---

## What was built

Eight pages over the existing CLI. No framework, no React, no Next.js, no Electron, no database, no
websocket, no build tooling. `node:http` + `child_process` + one HTML file.

| Page | Delivers |
|---|---|
| **Dashboard** | engine · benchmark · replay · corpus · extraction · doctor · latest reports · latest certification · freeze state |
| **Certifications** | browse all; per record: claims, contradictions, dependency graph, provenance, verdict, evidence, fired rules, raw JSON |
| **Ground truth** | `ground-truth/cases` — reviewed, pending, calibration status, human verdict, adjudication packet rendered as markdown |
| **Reports** | all 14 files in `reports/`, rendered as markdown |
| **Benchmark** | run; pass/fail, timing, failures, verdict-path coverage, comparison to the previous run |
| **Replay** | runs when data exists; otherwise explains exactly why — never an error |
| **Validation** | one-click doctor · tests · benchmark · corpus · replay · extraction, every stdout shown |
| **Logs** | history · metrics · insights · health · review · backup via the CLI, plus the raw append-only files |

### The rule that governs it

**No business logic in the console.** Every action spawns the real command; output is shown verbatim.
Nothing is re-scored, re-derived or summarised. A UI that recomputes a verdict is a UI that can
disagree with the engine, and then neither is authoritative.

---

## Security

The interface remains read-only and cannot publish. Confirmed by probing the running server:

```
reply · regret · observe · read · search · session · login · draft · opportunity · certify
    → all refused, with the reason stated in the UI

../../../etc/passwd · ../../.env · data/operators/operators.json · src/argus/certify.ts
    → all refused
```

Allowlist, not denylist — a denylist admits every future command by default, and one of them
publishes. `/api/file` serves four directories and a fixed root list. Binds `127.0.0.1` only.

`reply` and `regret` are absent on principle, not by oversight. Publishing needs a person at a real
terminal; `ask.ts` throws `NoTerminalError` on non-interactive stdin. Routing that prompt through a
web page would destroy the property that makes every published word attributable to a human.

---

## Two defects found and fixed during this phase

**Ground-truth reader used field names that do not exist.** It read `c.argus_observed.claims.length`
and treated `c.status` as a string. The real schema has `ground_truth.expected_claims`,
`ground_truth.claims_reviewed`, and `status` as an object with `ground_truth` / `calibration` /
`benchmark` / `blocked_by`. Caught by inspecting a real case file instead of assuming the shape;
the page would have shown plausible-looking wrong counts.

**Benchmark "verdict paths" rendered as `—`.** The dashboard remaps `verdict_paths` → `paths`, but a
live run returns raw `last-run.json`, which uses the original name. The metric silently showed a dash
where coverage should be. Now reads both shapes and displays real coverage (`2/6`) plus a per-path
breakdown and an explicit count of uncovered paths.

Also carried forward from the previous phase: `shell: true` splits
`C:\Program Files\nodejs\node.exe` at its space, and Node 20+ refuses to spawn npm's `.cmd` shim
without a shell. Both handled by explicit resolution in `resolveCmd`.

---

## What the console makes visible

The dashboard's red zeros are the honest state of the project:

- **0 calibration approved** — human calibration is blocked, not inactive
- **0 published** — nothing has been posted
- **0 operator reviews**, **0 regret entries**, **0 interaction rows** — the human loop has never run

Certification records: **4 records, all REJECT.** The most recent carries 19 claims, 21
contradictions of which 8 are fatal, 9 epistemic issues, and 6 claims invalidated by dependency.

`doctor`'s exit code depends entirely on `REDBOT_OPERATOR`, and the console shows whichever it is.

> **Corrected in Phase 10.** Phase 9 recorded "doctor exits 1" and attributed the `llm operator`
> FAIL to *credentials that are not present*. Measured directly: with `REDBOT_OPERATOR` **unset** →
> `11 pass · 3 warn · 1 fail`, **exit 1**; with it set to `jerome` → `11 pass · 4 warn · 0 fail`,
> **exit 0**. The check fails because the variable is unset, not because credentials are missing.
> The Phase 9 console screenshots were captured with it set, so they show exit 0.

Either way the console reports the command's own exit code — verified in Phase 10 by comparing the
displayed value against the API response. A console that dressed up a failure would be worse than no
console.

Under the contradictions table the page states that a cited contradiction is a **model observation,
not a verified fact**. Citation fidelity is measured separately and by hand.

**No control anywhere in this console writes a ground-truth label.** A form that sets `truth: false`
would let a click become an answer key, and the corpus would stop being ground truth on the day it
shipped.

---

## Phase 10 addendum — console QA, 41/41

An automated QA suite (`tools/operator/qa-console.mjs`) now drives every page in a real browser and
asserts on what rendered, not on what the code intended.

| Area | Checks | Result |
|---|---|---|
| navigation | 8 tabs, one visible page each, heading present | 8/8 |
| header | operator · chrome · freeze · read-only pills | 4/4 |
| empty states | absent log explained not errored · unlabelled case · no label table when 0 labels | 5/5 |
| error states | refuses `reply` · refuses traversal · unknown log · missing record 404s | 4/4 |
| execution | doctor ran · **exit code matches the API verbatim** · stdout not truncated | 3/3 |
| long output | `npm test` 182/182 through the UI · long pane scrolls internally | 2/2 |
| markdown | report renders · no raw syntax leaked · 605-line worksheet renders (30 headings) | 3/3 |
| cert detail | dependency graph 19 nodes / 14 edges · 3 tables · raw JSON | 3/3 |
| refresh | stays on tab · re-renders · exactly one page visible | 3/3 |
| theme | toggles both directions | 1/1 |
| layout | 390 · 768 · 1024 · 1440 px, no horizontal body overflow | 4/4 |
| runtime | no uncaught JS errors | 1/1 |

**Two defects in the QA suite itself, both mine, both fixed:** selectors matched hidden duplicate
buttons across pages (not scoped to the visible section), and one assertion hardcoded `exit 1` for
doctor — which is environment-dependent, as corrected above. The second is the more instructive: the
test was asserting a fact about the machine rather than a property of the console.

---

## Not claimed

**A responsive QA pass was not performed.** The standing by-law requires a multi-viewport pass in the
Responsive Viewer extension; `list_connected_browsers` returned an empty list, so it could not run.

What was measured instead: `document.documentElement.scrollWidth` equals viewport width at 390, 768,
1024 and 1440 px — no horizontal body overflow, with wide tables, terminal panes and the dependency
graph scrolling inside their own containers. That is a rendering check at four widths, not a device-
frame pass, and it should not be recorded as one.

---

## Boundaries respected

- No publication work started
- No Git remote configured
- No push
- No Reddit connection
- No irreversible action
- Engine freeze intact — see `ENGINE-FREEZE.md`

---

## State after this phase

redbot is now **operationally usable**: a browser is the normal operating surface, every gate runs
from one page, and every certification is inspectable without reading JSONL.

The scientific blocker is unchanged and unchangeable by software: **9 adjudications on HRC-001 and
19 claim labels on CERT-002 require a human.** The console makes that work easier to see and
impossible to fake.
