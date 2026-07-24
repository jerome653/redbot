# redbot — master requirements

Requirement IDs are stable forever. Traceability lives in `MASTER-REGISTRY.csv`;
this file is the readable form.

## Functional — agent

- **F-01** Drive reddit.com in a real browser session as a logged-in user
- **F-02** Persist and restore a session per account without re-login
- **F-03** Perform every READ action in the registry
- **F-04** Perform every WRITE action in the registry
- **F-05** Perform every CURATE action in the registry
- **F-06** Report account health: suspended, shadowbanned, karma
- **F-07** Resolve a target by permalink or by match spec
- **F-08** Execute a JSON workflow document without a code change
- **F-09** Recover from a wrong screen without ending the run
- **F-10** Halt every account mid-workflow on one command

## Functional — intelligence

- **F-11** Score a thread for engagement and assign a tier
- **F-12** Qualify a thread with an LLM into a typed verdict
- **F-13** Draft a reply with an LLM
- **F-14** Reject a draft that fails the disclosure or authenticity linter
- **F-15** Detect and classify SGEN mentions, capture the permalink

## Functional — control

- **F-16** Queue every write for human approval; allow edit, approve, reject
- **F-17** Dashboard showing thread, draft, score, tier, account, history
- **F-18** Audit log of every write, before and after, with content
- **F-19** Alert on tier-1 finds, negative mentions, and account health changes
- **F-20** CLI: run, serve, approve, halt, doctor

## Non-functional

- **N-01** Zero secrets in any file in this repo. Env or encrypted store only
- **N-02** Rate limits enforced in code; no code path to a write bypasses the ledger
- **N-03** Timing drawn from a log-normal distribution, never uniform
- **N-04** One browser session per account; no shared session, no parallel bursts
- **N-05** Every write produces before/after audit events or it is a P0 defect
- **N-06** Selector packs hot-swappable without an engine release
- **N-07** Offline test suite passes with the network disabled
- **N-08** Layer imports point downward only, asserted in CI
- **N-09** No npm dependency other than Playwright
- **N-10** Node >= 20

## Compliance

- **C-01** Disclosure line present on any generated text mentioning SGEN — enforced in code
- **C-02** No fabricated personal experience in generated text — enforced in code
- **C-03** No deliberate misspelling or AI-detection evasion in prompts or output
- **C-04** Vote actions disabled unless explicitly enabled in config (ADR-0007)
- **C-05** Per-subreddit rules recorded in config before that subreddit is targeted
- **C-06** Audit log retained as the evidence trail for C-01
