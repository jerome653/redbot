# ADR-0003 — Selectors ship as a versioned pack, separate from the engine

**Status:** Accepted · 2026-07-22 · Jerome

## Context
The single largest maintenance cost measured in the Appilot teardown was ~60 hardcoded
view IDs compiled into the binary. Every Reddit release could break them, and every fix
required a full rebuild-sign-redistribute cycle.

## Decision
Every selector lives in a versioned **selector pack** — a JSON file, loaded at runtime,
independent of the engine release. Resolution is tiered and falls back in order:

1. stable attribute (data-testid, aria-label, role)
2. semantic (visible text, accessible name)
3. structural (relative position from a resolved anchor, with tolerance)

Every resolution emits a trace recording which tier won. A selector that starts winning at
a lower tier than usual is an early warning that Reddit changed something, days before it
becomes a failure.

## Consequences
+ A Reddit UI change is a pack edit, not a release.
+ Degradation is observable before it is an outage.
− Requires a golden-page test corpus and a pack CI pipeline from day one, not later.
