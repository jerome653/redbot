# redbot — decisions

One ADR per file in `ADR/`. Superseding requires a new ADR that names the old one.
Nothing is decided by conversation alone.

| ADR | Decision | Status | Owner |
|-----|----------|--------|-------|
| [0001](ADR/ADR-0001-workflows-are-data.md) | Workflows are JSON documents interpreted at runtime, never compiled behaviour | Accepted | Jerome |
| [0002](ADR/ADR-0002-browser-not-device.md) | Browser agent driving reddit.com — not Android, not the API | Accepted | Jerome |
| [0003](ADR/ADR-0003-selectors-are-a-pack.md) | Selectors ship as a versioned, hot-swappable pack with tiered fallback | Accepted | Jerome |
| [0004](ADR/ADR-0004-human-gate-default-on.md) | Every outbound write passes a human approval gate; default on | Accepted | Jerome |
| [0005](ADR/ADR-0005-disclosure-enforced-in-code.md) | Disclosure enforced by a linter, not requested in a prompt | Accepted | Jerome |
| [0006](ADR/ADR-0006-limits-in-code.md) | Rate limits are code, not runbook entries | Accepted | Jerome |
| [0007](ADR/ADR-0007-vote-actions-specified-not-enabled.md) | Vote actions specified in the registry, executors not implemented; config-gated | Accepted, open toggle | Jerome |

## Open — needed before P5 pilot

| # | Question | Blocks | Owner |
|---|----------|--------|-------|
| Q-1 | Does r/WordPress permit vendor/employee participation? Check the sidebar rules. | P5 | Jerome |
| Q-2 | Which account(s) does redbot drive? Named staff, or a brand account? | P5 | Jerome |
| Q-3 | Does SGEN have existing Reddit history/karma to build on? | P5 | Jerome |
| Q-4 | Who operates it daily once live? | P5 | Jerome |
| Q-5 | Primary objective: mention defence, lead generation, or presence? Reorders M-06 vs M-07. | P2 | Jerome |

Q-1..Q-4 do not block P1-P4. Engineering proceeds.
