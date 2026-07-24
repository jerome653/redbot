# redbot — operations runbook

**Status:** skeleton. Filled as P2 lands. Nothing here is live yet.

## Daily

1. `redbot doctor` — session valid, ledger headroom, pack version, last run outcome
2. Open the dashboard, work the approval queue
3. Check alerts: negative mentions, account health, selector degradation

## Kill switch

    redbot halt --all --reason "<why>"

Halts every account mid-step. Safe at any point: a halted run leaves a
`run.halted` event and no partially-submitted write, because `write.submitted` is
written before the network call and reconciled on restart.

## When a write has unknown outcome

A `write.submitted` with no `write.confirmed` means redbot does not know whether Reddit
accepted it. **Never retry automatically.** Open the account in a browser, look, and
resolve by hand. Automatic retry here is how one comment becomes three.

## When selectors degrade

`selector.degraded` events rising = Reddit changed something. Edit the pack, run the
golden-page suite, publish. No engine release. If resolution fails entirely, halt the
affected workflows rather than letting the engine flail.

## Kill criteria — stop publishing, keep listening

- Any moderator removal of a redbot-authored comment
- Any public accusation of astroturfing
- Any account health degradation
- Two consecutive runs with unknown-outcome writes

Restarting after a kill criterion requires a written note in `certification/evidence/`
saying what changed.

## Escalation

Account suspended → stop everything, do not create a replacement account, tell Jerome.
Creating a replacement account after a suspension is ban evasion and is a categorically
worse problem than the suspension.
