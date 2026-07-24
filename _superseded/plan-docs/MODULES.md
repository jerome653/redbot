# redbot — modules

Build order is dependency order. A module may not start before its dependencies are green.

| # | Module | Phase | Depends on | Est. |
|---|--------|-------|-----------|------|
| M-01 | **config** — layered config, env-only secrets, validation | P1 | — | 1 d |
| M-02 | **store** — JSONL, atomic write, dedupe keys, retention | P1 | — | 2 d |
| M-03 | **selector pack** — schema, loader, tiered resolver, trace | P1 | M-01 | 3 d |
| M-04 | **page driver** — Playwright wrapper, primitives, session storage | P1 | M-03 | 3 d |
| M-05 | **action registry** — read/write/curate/account/meta, typed results | P1 | M-04 | 5 d |
| M-06 | **workflow schema + parser** — validate, version, expression eval | P1 | M-01 | 3 d |
| M-07 | **humanize** — log-normal delays, typing cadence, session shape | P1 | — | 2 d |
| M-08 | **rate ledger** — per-account caps, quiet hours, hard stop | P1 | M-02 | 2 d |
| M-09 | **engine** — interpreter, run state machine, recovery routines | P2 | M-05..M-08 | 5 d |
| M-10 | **llm** — provider client, model ladder, JSON extraction | P2 | M-01 | 2 d |
| M-11 | **qualify + draft** — prompts, scoring, draft linter (ADR-0005) | P2 | M-10 | 3 d |
| M-12 | **approval queue** — enqueue, list, edit, approve, reject | P2 | M-02 | 2 d |
| M-13 | **dashboard** — read the thread, edit the draft, approve, audit view | P2 | M-12 | 4 d |
| M-14 | **audit log** — before/after every write, immutable append | P2 | M-02 | 1 d |
| M-15 | **alerts** — new tier-1, negative mention, account health, halt | P2 | M-02 | 1 d |
| M-16 | **cli** — run, serve, scan, approve, halt, doctor | P2 | M-09 | 2 d |
| M-17 | **kill switch** — halt all accounts mid-workflow, everywhere | P2 | M-09 | 1 d |
| M-18 | **fixture site** — local Reddit-shaped pages for offline E2E | P3 | M-04 | 3 d |
| M-19 | **golden pages** — captured DOM corpus for selector regression | P3 | M-03 | 2 d |
| M-20 | **test harness** — offline suite, zero-network assertion | P3 | M-18, M-19 | 3 d |

P1 ≈ 21 d · P2 ≈ 21 d · P3 ≈ 8 d → **~50 engineer-days to a tested, unpiloted system.**

Not counted: P4 live read-only validation, P5 pilot, and the account question (Q-2), which
is a calendar problem rather than an engineering one.

## Module boundaries that are load-bearing

- **M-03 must not know about Reddit concepts.** It resolves selectors. If "post" or
  "comment" appears in the selector resolver, the boundary has leaked.
- **M-05 must not know about workflows.** An action does one thing and verifies it.
- **M-09 must not touch the DOM.** If the engine imports the page driver, the layering is
  broken and the Appilot collapse has begun.
- **M-08 is checked by the engine before every write, without exception.** There is no
  code path from a write action to the network that skips the ledger.
