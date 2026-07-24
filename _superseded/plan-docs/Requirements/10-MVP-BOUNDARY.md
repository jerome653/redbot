# redbot — MVP boundary

The MVP is the smallest thing that is **genuinely working**, not a demo.

## In

- Browser session for **one** account, persisted and restorable (F-01, F-02)
- READ actions: openSubreddit, openPost, readComments, scrollFeed, search (F-03)
- WRITE actions: submitComment, replyToComment (F-04) — behind the approval gate
- Selector pack v1 for reddit.com with tiered resolution (N-06)
- Workflow interpreter with the schema in `engineering/WORKFLOW-SCHEMA.md` (F-08)
- Engagement scoring + tiering (F-11)
- LLM qualify + draft + linter (F-12, F-13, F-14)
- Approval queue + dashboard (F-16, F-17)
- Rate ledger (N-02) and humanize policy (N-03)
- Audit log (F-18) and kill switch (F-10)
- Offline test suite against a local fixture site (N-07)

## Out of MVP, specified for later

- submitPost, editOwn, deleteOwn, sendMessage, replyToMessage
- CURATE actions
- Multi-account orchestration
- Vote actions (ADR-0007)
- Mention monitoring (F-15) — moves in if Q-5 answers "defence"
- MOE integration
- Any platform other than Reddit

## Definition of done for the MVP

1. `npm test` green with the network disabled
2. A workflow document drives a full read-qualify-draft cycle against the fixture site
3. A draft that mentions SGEN without disclosure is rejected by the linter, with a test
   proving it
4. A write attempt that exceeds the ledger is blocked, with a test proving it
5. A workflow referencing `upvote` fails validation, with a test proving it
6. The kill switch halts a running workflow mid-step, with a test proving it
7. Live read-only run against reddit.com, logged out, one subreddit — P4 gate
8. Zero secrets in the repo, asserted by a CI check

Items 1-6 are achievable with no Reddit account and no network. Item 7 needs neither an
account nor API access. Only the pilot (P5) needs an account.
