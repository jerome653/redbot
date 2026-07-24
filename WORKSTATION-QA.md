# Workstation QA — Phase 13

**Date:** 2026-07-23 · **Result: 83/83 checks passed**
**ENGINE FILES MODIFIED: 0**

`node tools/operator/qa-console.mjs --port <port>` drives every surface in a real browser and asserts
on what actually rendered. It is reproducible, not a transcript.

---

## Results

| Area | Checks | Result |
|---|---|---|
| performance | first meaningful paint under 20 s | **1/1** — 2.4 s to first status card |
| sidebar | 14 items, 4 groups | **2/2** |
| navigation | all 14 pages render with content | **14/14** |
| palette | opens on Ctrl+K · lists 30 entries · filters · empty state · Enter executes · **name outranks description** | **6/6** |
| terminal | drawer auto-opens · streams real stdout · live elapsed · cancel enabled · **409 on second command** · cancel stops the run · clear · cancel disabled when idle | **8/8** |
| search | opens on `/` · two-char prompt · finds matches · highlights · reports totals · empty state · jumps to the file | **7/7** |
| files | tree renders · opens a file · filename filter · 5 roots · JSONL viewer | **5/5** |
| timeline | 6 events · verdict + claims + fatal · real durations · opens certification | **4/4** |
| queue | pending + completed · copy-ready command · explains the exclusion | **3/3** |
| run history | records runs · exit codes and durations · trend chart | **3/3** |
| logs | split view · large log · line filter · auto-refresh · pause · jump to end | **6/6** |
| empty states | absent log explained, and **not** worded as an error | **2/2** |
| keyboard | `g d` · `g c` · `g v` · `g r` · Esc | **5/5** |
| settings | read-only environment · local-only disclosure · operator label honest · theme persists | **5/5** |
| security | 8 refused commands · traversal · credentials path | **3/3** |
| error states | 404 on missing record · unknown log handled | **2/2** |
| layout | 420 · 900 · 1280 · 1600 px, no horizontal body overflow | **4/4** |
| runtime | **no uncaught JS exceptions** · refusals surface as HTTP status | **2/2** |

---

## What the QA pass found

### Defect — the palette ran the wrong command

Typing `health` and pressing Enter ran **`doctor`**.

Both matched, because `doctor`'s description is *"install health — build, auth, data, secrets,
backup"* and the filter treated a description match as equal to a name match. `doctor` is first in
the command list, so it won the tie and Enter executed it.

That is the worst class of palette bug: it is silent, and the operator's muscle memory —
type-a-few-letters-and-hit-Enter — is exactly what triggers it.

**Fixed** by ranking matches: exact name → name prefix → name substring → description. There is now a
regression check asserting that typing `health` runs `redbot health`.

### Three assertions in the QA suite were wrong, not the app

Recorded because a test that fails for the wrong reason is a defect in the test:

1. **Elapsed-timer regex** required `1.2 s`; the UI renders `1.2s`. The feature worked.
2. **stdout assertion** expected `health` output while the palette had actually run `doctor` — the
   test was asserting against a command it did not run. Fixing the palette fixed the test.
3. **"No uncaught JS errors"** counted browser console messages about HTTP 409 and 400 responses.
   Those are **the security features working** — this suite deliberately provokes a 409 (one-command
   lock) and eight 400s (allowlist refusals). An uncaught exception and a refused request are
   different things, and the check now separates them: `errors` for real exceptions, `netNoise` for
   status-code logs. It asserts `netNoise.length > 0`, because zero would mean the refusals stopped
   happening.

---

## Live terminal — verified behaviour

| Property | Evidence |
|---|---|
| Streams incrementally | `doctor` arrived in 4 chunks, `corpus` in 7, `npm test` in 18 — not one buffered blob |
| Real stdout | `Account`, `May publish`, `Replies today` present verbatim in the pane |
| ANSI colours | rendered via a 20-line converter; `OK` green, `!` amber in `doctor` output |
| Elapsed timer | `● running tests · 1.2s`, updating at 10 Hz |
| Exit code | `✓ exit 0 · 472 ms` in both the header and the pane |
| One at a time | second command while one runs → **HTTP 409**, with the reason |
| Cancel | `SIGTERM` → `exit -1`, `cancelled: true`, pane shows `cancelled` |
| Copy / clear | clipboard write of the raw text; clear empties to < 5 chars |

Transport is **Server-Sent Events** — one long-lived HTTP response. No websocket, no dependency, no
protocol upgrade.

---

## Security — re-verified in this phase

The streaming endpoint enforces the same allowlist as the buffered one. All eight refused:

```
reply · regret · observe · login · read · session · certify · draft   → HTTP 400
```

File surface:

```
../../.env                        → refused
data/operators/operators.json     → refused
data/drafts.json                  → refused
data/history.jsonl                → served (named log file)
```

**`data/` is not a readable root.** It holds operator credentials and browser profiles in the same
tree as evidence. The file explorer needs the append-only logs, so exactly those files are allowed
**by name** — a directory allowance would have exposed `data/operators/`.

---

## Performance

| Measure | Result |
|---|---|
| First status card | **2.4 s** from cold navigation |
| Global search across 33 files | ~1.2 s, 200 matches in 12 files |
| 13 KB log render | instant, filtered client-side |
| `npm test` streamed | 18 chunks, 12,157 bytes, no dropped output |
| Page weight | one HTML file, zero network dependencies |

The dashboard is the slowest page because it fetches four endpoints, one of which shells out to
`ground-truth/validate.mjs`. That is the cost of never caching a number the engine owns.

---

## Not claimed

**A responsive QA pass was not performed.** The standing by-law requires a multi-viewport pass in the
Responsive Viewer extension; `list_connected_browsers` returned empty, so it could not run.

Measured instead: `document.documentElement.scrollWidth` equals viewport width at **420, 900, 1280 and
1600 px** — no horizontal body overflow, sidebar collapsing to an overlay below 900 px, terminal
drawer spanning full width. That is a rendering check at four widths, not a device-frame pass.

---

## Reproducing

```bash
node tools/operator/server.mjs --port 7901
node tools/operator/qa-console.mjs --port 7901        # 83 checks
node tools/operator/capture-screenshots.mjs --port 7901   # 26 screenshots
```
