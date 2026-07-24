# ADR-0004 — Every outbound write passes a human gate in v1

**Status:** Accepted · 2026-07-22 · Jerome

## Context
Appilot's own product — sold as automation — puts a human approval step between the AI
draft and the post (canon T-7). A vendor whose entire pitch is hands-off automation chose
to build a manual gate. That is evidence about what they learned, not a marketing choice.

Separately: a bad reply published under SGEN's name is public, permanent, searchable and
attributable to the company.

## Decision
`autoPost.requireApproval` defaults to **true**. Every write action — comment, post, reply,
message — enters an approval queue and waits for a human to approve, edit or reject.

It is a configuration value. Jerome can set it false. The default is on, and flipping it
is a recorded decision, not an accident.

## Consequences
+ No unreviewed text ever carries SGEN's name.
+ The queue doubles as the training signal for whether drafts are any good.
− Throughput is bounded by human attention. That is the intended trade in v1.
