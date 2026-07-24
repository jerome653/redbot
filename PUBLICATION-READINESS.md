# Publication readiness — scan of 2026-07-23

**Status: NOT ready to publish as-is.** Nothing here blocks publication permanently; one finding
is a business decision rather than a technical one, and it should be made knowingly.

Scan: every `.ts .mjs .js .md .json .html .yml` outside `node_modules`, `dist/` and the Chrome
profiles.

---

## What a public repository would currently expose

| Class | Occurrences | Files | Assessment |
|---|---|---|---|
| **Employer name (`SGEN`)** | **179** | 33 | ⚠ **decision required — see below** |
| Operator name / `JerOme` paths | 91 | 34 | mostly `_superseded/`; excludable |
| **Reddit account names** | **25** | 13 | `docs-architect`, `jrum_sgen`, `canadacis` — in tests, mockups, reports |
| `reddit_session` | 11 | 6 | **false positive** — the cookie *name* in DEFECT-01 write-ups and in `backup.ts`'s own secret-scanner pattern. No cookie value anywhere |
| Absolute Windows path | 2 | 2 | `src/config.ts` (help text) is real; `data/operators/operators.json` is gitignored |
| API keys / tokens | **0** | — | clean |
| Private keys | **0** | — | clean |

**No secret material was found.** No API key, no token, no cookie value, no private key. The
findings are identifiers and paths, not credentials.

Noted and not opened: `data/operators/jerome/claude/` contains a Claude config. It is gitignored
by `data/operators/`, so it cannot publish. It was not inspected.

---

## The finding that is not technical

**179 mentions of the employer, plus two documents that change what this repository *is*:**

- `ACCOUNT-WARMING.md` — a staged plan for building Reddit karma on named accounts.
- `MULTI-ACCOUNT-RISK.md` — an analysis of what Reddit flags and how to avoid it.

Both are honest, both were written to keep conduct clean, and both say so. But published under a
company name, alongside the account handles, they read very differently to a stranger than they do
in context. A subreddit moderator finding *"weeks 1–2: 50–100 karma each, 2–4 comments a day"* next
to the account that just replied in their forum will not read the surrounding paragraphs about
disclosure.

That is the exposure. It is not a code problem and I am not treating it as one — it is Jerome's
call.

### The option that resolves it cleanly

**Publish Argus, not redbot.**

The proposed repository is already named `argus/`. The architecture review measured the split:
**~68% of the codebase is platform-neutral, ~12% Reddit-specific.** Argus — claim extraction,
provenance classification, adversarial refutation, the dependency graph, epistemic calibration,
the 12 deterministic verdict rules, the benchmark, the ground-truth corpus, the replay harness — is
the genuinely novel part, and none of it is about Reddit.

Splitting that way:

- removes `ACCOUNT-WARMING.md`, `MULTI-ACCOUNT-RISK.md`, every account handle, and the marketing framing;
- removes the employer association almost entirely, since Argus's rules cite *defects*, not a company;
- keeps every artifact the validation work produced — HRC-001, the corpus, the benchmark, the calibration report, the citation-fidelity campaign, the evidence index;
- matches what the repository was already going to be called.

redbot stays private as the first *consumer* of Argus. The science publishes; the operator does not.

---

## Required before any publication

| # | Item | Effort |
|---|---|---|
| 1 | Decide: Argus-only, or redbot-and-all | **a decision, not work** |
| 2 | Exclude `_superseded/` — 2 of the top 3 identifier concentrations live there and it is historical drafts | trivial |
| 3 | Replace account handles in `src/test/*`, `design/*.html`, `reports/HRC-001-*` with fixtures | small |
| 4 | Parameterise the absolute path in `src/config.ts` help text | trivial |
| 5 | Confirm `data/` never ships — it is the evidence *and* the credentials | verify `.gitignore` on the new repo |
| 6 | `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md` | small |
| 7 | CI running `npm test`, benchmark, ARE-001, corpus validation on every commit | small |

Items 2–7 are mechanical. Item 1 gates all of them.

---

## One thing publication changes that no scrub fixes

redbot's safety rests on two layers: `reply` refusing non-interactive stdin, and a person
accountable for every published word. **The first fork removes the TTY check in a line.**

That is not an argument against publishing — it is the reason the positioning has to be the
loudest thing in the README, and the reason Argus-only is the safer split. A certification engine
cannot be misused the way a Reddit poster can.

---

## Not done, deliberately

No files were moved, renamed, redacted or deleted. No repository was created. Scrubbing before the
Argus-vs-redbot decision would mean doing the work twice and possibly destroying context that the
private repository should keep.
