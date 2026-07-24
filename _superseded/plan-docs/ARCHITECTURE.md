# redbot — architecture

## Shape

    ┌─────────────────────────────────────────────────────────────┐
    │  CONTROL                                                     │
    │  cli · approval dashboard · kill switch · audit viewer        │
    └───────────────┬─────────────────────────────────────────────┘
                    │
    ┌───────────────▼─────────────────────────────────────────────┐
    │  ENGINE                                                      │
    │  workflow interpreter · run state machine · recovery          │
    │  humanize policy · rate ledger · approval queue                │
    └───────────────┬─────────────────────────────────────────────┘
                    │
    ┌───────────────▼─────────────────────────────────────────────┐
    │  ACTIONS                                                     │
    │  read · write · curate · account · meta   (vote: spec only)   │
    └───────────────┬─────────────────────────────────────────────┘
                    │
    ┌───────────────▼─────────────────────────────────────────────┐
    │  SURFACE                                                     │
    │  selector pack (data) · page driver (Playwright)              │
    │  session store per account                                    │
    └───────────────┬─────────────────────────────────────────────┘
                    │
              reddit.com

    side channels:  LLM (qualify + draft)  ·  store (JSONL)  ·  audit log  ·  alerts

## Layer contracts

**Surface** knows about the browser and the DOM. It knows nothing about Reddit's meaning.
It resolves a selector to an element and performs a primitive: click, type, scroll, read.

**Actions** know about Reddit's meaning — what a post is, what a comment is, what "reply"
means. They compose surface primitives and verify the result. An action either succeeds
with evidence or fails with a typed error. No action knows what workflow it is part of.

**Engine** knows about intent. It interprets a workflow, decides the next action, applies
the humanize policy for timing, checks the rate ledger before any write, routes writes
through the approval queue, and recovers when an action fails.

**Control** knows about people. CLI, dashboard, kill switch, audit.

Dependencies point downward only. A CI test asserts it: nothing in `surface/` may import
from `engine/`, nothing in `actions/` may import from `control/`.

## Why this is not one class

The Appilot teardown found 608 methods in a single class because perception, actuation,
flow control, data capture and recovery all lived together with no boundary. The boundary
above is drawn specifically so that the same collapse cannot happen: selector resolution
lives behind an interface, actions are individually testable against fixture pages, and the
engine never touches the DOM.

## Failure model

Every action returns `{ ok, evidence, error }`. Errors are typed, not strings:

    NOT_FOUND        selector resolved to nothing
    AMBIGUOUS        selector resolved to more than one candidate
    NOT_INTERACTABLE element found but blocked, covered or disabled
    WRONG_SCREEN     precondition screen assertion failed
    RATE_LIMITED     ledger refused the write
    NEEDS_APPROVAL   write is queued, not an error but not done
    AUTH_LOST        session no longer logged in
    UPSTREAM         Reddit returned an error state
    TIMEOUT

The engine maps error types to recovery routines. `AUTH_LOST` halts the account.
`WRONG_SCREEN` triggers re-anchoring. `NOT_FOUND` degrades to the next selector tier and,
if that also fails, records a pack-degradation event — the early warning in ADR-0003.

## Data

    data/
      accounts/<id>/session.json     browser storage state, gitignored, 0600
      accounts/<id>/ledger.jsonl     every write attempt, for the rate limiter
      runs/<runId>.jsonl             run timeline, one event per line
      queue.jsonl                    approval queue
      observations.jsonl             scraped posts/comments, deduped
      audit.jsonl                    every outbound write, before and after

No database. At redbot's volume — tens of writes a day, thousands of observations —
JSONL is greppable, diffable and cannot corrupt on a partial write if written atomically.
