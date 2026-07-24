# redbot — event contract

Every meaningful thing redbot does emits one event, appended to a JSONL stream. This is
the audit trail, the debugging surface, and the future MOE integration point — MOE consumes
events, it does not call into redbot.

    {
      "ts": "2026-07-22T09:14:03.221Z",
      "runId": "run_01J...",
      "accountId": "u_sgen_dev",
      "kind": "write.submitted",
      "seq": 42,
      "data": { ... },
      "evidence": { ... }
    }

## Kinds

**run** — `run.started` `run.completed` `run.failed` `run.aborted` `run.halted`

**step** — `step.started` `step.completed` `step.failed` `step.retried` `step.recovered`

**selector** — `selector.resolved` (with winning tier) · `selector.degraded` (won at a
lower tier than its recorded baseline — the ADR-0003 early warning) · `selector.failed`

**observation** — `post.observed` `comment.observed` `mention.observed`

**ai** — `qualify.completed` `draft.completed` `draft.rejected` (with linter reason)

**approval** — `queue.enqueued` `queue.approved` `queue.edited` `queue.rejected`

**write** — `write.blocked` (ledger) · `write.submitted` (before) · `write.confirmed`
(after, with permalink) · `write.failed`

**account** — `account.login` `account.session_restored` `account.health_ok`
`account.health_degraded` `account.auth_lost` `account.halted`

## Rules

1. `write.submitted` is written **before** the network call, `write.confirmed` after.
   A `submitted` with no matching `confirmed` is an unknown-outcome write and must be
   investigated by hand — never retried automatically.
2. Events are append-only. Nothing rewrites history.
3. Content is recorded in full for write events. This is deliberate: the audit trail is
   the evidence that disclosure was present, which is the FTC answer.
4. `seq` is monotonic per run, so a gap means lost events.
