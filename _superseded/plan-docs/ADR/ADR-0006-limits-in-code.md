# ADR-0006 — Rate limits live in code

**Status:** Accepted · 2026-07-22 · Jerome

## Context
Every account-operation failure mode in this category traces back to volume: too much,
too fast, too regular, too correlated across accounts. A limit written in a runbook is a
limit somebody forgets at 2am.

## Decision
Per-account ledger enforced by the engine, not by the operator: posts per hour, per day,
per subreddit per day, minimum gap between writes, and quiet hours in the account's local
timezone. Exceeding a limit is a hard stop with a logged reason, never a warning.

Timing between actions is drawn from a log-normal distribution, not a uniform range —
uniform delays are themselves a machine signature.

## Consequences
+ The dangerous knob cannot be turned by accident.
+ Ledger state is inspectable, so "why is nothing posting" always has an answer.
− Raising a limit is a code change and a review. Intentional.
