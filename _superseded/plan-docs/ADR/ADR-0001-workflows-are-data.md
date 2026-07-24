# ADR-0001 — Workflows are data, not code

**Status:** Accepted · 2026-07-22 · Jerome

## Context
Appilot compiles one bot per target app per customer into its own APK. Adding a behaviour
means a new binary, a new signing, a new download, a new install across every device. The
teardown measured the cost of that: 608 methods in a single class, and a release treadmill
that scales linearly with the catalogue.

## Decision
A redbot behaviour is a **JSON workflow document**: a sequence of declarative actions with
conditions, parameters and recovery routines. The engine interprets it. Adding a behaviour
is authoring a document; it never requires a release.

The expression language inside a workflow is deliberately small and non-Turing — literals,
variable references, comparisons, and a fixed function list. A document arriving from
outside must not be able to compute arbitrarily.

## Consequences
+ New behaviour in minutes, no deploy.
+ Workflows are diffable, reviewable and testable as fixtures.
− The engine must be stricter: schema validation, versioning, and a signed-document path
  before any workflow is ever accepted from outside this repo.
