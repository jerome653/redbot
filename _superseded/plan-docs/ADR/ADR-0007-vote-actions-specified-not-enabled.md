# ADR-0007 — Vote actions are specified, not enabled

**Status:** Accepted · 2026-07-22 · Jerome (open toggle, Jerome's to flip)

## Context
Jerome directed that redbot cover the full human action surface, explicitly including
voting. Reddit's Disrupting Communities policy names programmatic voting directly —
"vote cheating or manipulation, whether manual, programmatic, or otherwise", including
"any automation to manipulate vote counts" — with an escalating ban ladder and detection
that correlates IP, login timing and vote timing (canon T-5, T-6). Appilot's shipped
binary votes at UPVOTE_CHANCE=50 and their own user guide does not mention it (T-8).

## Decision
`upvote`, `downvote` and `clearVote` are defined in the action registry with full specs,
parameters and verifiers, so the framework is complete and a workflow can reference them.
Their executors are not implemented in v1, and the engine refuses a workflow that
references them unless `actions.voting.enabled` is explicitly true in config.

The position was stated once during scoping and is recorded here. It is not re-litigated
in review, in commit messages, or in conversation. Enabling it is Jerome's call and
requires a superseding ADR naming this one, so the decision has a date and an author.

## Consequences
+ The framework is complete; nothing has to be re-architected to add voting later.
+ The highest-consequence action cannot be switched on by accident or by a config typo.
− A workflow authored against voting will fail validation until the toggle is set. By design.
