# redbot — Action Plan

**Type:** action plan, not a proposal. Work items with owners, dates and verification methods.
**Date:** 2026-07-22 · **Owner:** Jerome (SGEN)
**Supersedes:** `MVP-PROPOSAL.md` (same date, two drafts — both superseded)
**Depends on:** `REDBOT-CANON.md`, `ADR/`, `Requirements/`
**Companion:** `Projects/appilot-analysis/`

---

## §0 — Evidence discipline

Every factual claim in this document carries a tag. If a claim has no tag it is a defect.

| Tag | Meaning |
|---|---|
| **[V]** | **Verified** — checked against primary source on 2026-07-22, source named |
| **[M]** | **Measured** — from the Appilot APK static analysis in `Projects/appilot-analysis/` |
| **[E]** | **Estimate** — engineering judgement, not a quote. Range given. Will be replaced by a measurement at the stated phase |
| **[A]** | **Assumption** — believed true, not proven. Named test that will prove or kill it |

### §0.1 What is NOT known, stated up front

These are the things it would be easy to gloss over, so they are listed before anything else.

| # | Unknown | Consequence if it goes badly | Resolved at |
|---|---|---|---|
| U-1 | Whether r/WordPress permits vendor/employee participation | **Kills the publishing half entirely.** Listening survives | W1 — 5 minutes of reading |
| U-2 | Whether Playwright + `ip netns` per-Chrome binding works cleanly on the target host | Falls back to per-context proxy, which is verified [V] and costs $0.30–6/IP/mo | P1 |
| U-3 | Whether the drafts are actually good enough that a human posts them | The whole publishing thesis fails; listening still has value | P5 |
| U-4 | Real per-profile RAM cost, so real fleet capacity per host | Changes topology choice, not feasibility | P3 |
| U-5 | Whether Reddit's DOM is stable enough that a selector pack lasts weeks not days | Raises maintenance cost toward Appilot's | P4–P5 |
| U-6 | Whether SGEN's people already have usable Reddit accounts | 3–6 month delay on the pilot; nothing to do about it in code | W1 |

**Nothing in this plan requires U-1..U-6 to be answered before engineering starts**, and no
phase gate is passed by assuming them.

### §0.2 The synthetic-fixture caveat

P1–P3 test against a **fixture site built for the purpose** — Reddit-shaped pages served
locally. This proves the engine, the workflow interpreter, the ledger, the linter, the
orchestrator and the isolation guarantees. **It does not prove the selectors work on real
Reddit.** That is what P4 exists for, and P4 is a hard gate, not a formality. Any claim that
redbot "works" before P4 means "works against the fixture" and will be written that way.

---

## §1 — What is being built

A fleet of Reddit accounts operated by software. Each account reads, searches, browses,
writes and replies as its owner would — across several subreddits, at human pace, on its own
schedule, from its own browser profile and its own network identity.

Accounts are **real SGEN people, disclosed as such** [A, design constraint]. Coverage comes
from several engineers with genuinely different expertise. This is the assumption the
disclosure linter enforces in code, and it is why the linter is a gate rather than a prompt
instruction.

**Not being built:** phone farm, fake personas, vote automation (ADR-0007), any platform
other than Reddit.

---

## §2 — Why not just keep using Appilot

Facts from the teardown, all **[M]** — read directly out of the APK SGEN was given.

| Finding | Evidence |
|---|---|
| Two live-format API keys compiled into the shipped APK | Anthropic `sk-ant-api03-…` 108 chars, OpenRouter `sk-or-v1-…` 73 chars, neither placeholder-shaped |
| Voting is active and undocumented | `attemptUpvote`/`attemptDownVote`, `UPVOTE_CHANCE=50`, per-minute ledger, confirmed execution logs. The user guide never mentions voting |
| One class holds 608 of ~1,500 methods | `RedditAutomation` |
| ~60 Reddit view IDs compiled into the binary | `com.reddit.frontpage:id/*` string table |
| TLS bypass helper present | `UnsafeHttpClient.getUnsafeOkHttpClient()` |
| Cleartext + user CA trust in the shipped network config | `res/8G.xml` |
| Self-update pulls an APK from a repo that 404s publicly | `api.github.com/repos/BitBashOwn/appilot-reddit-karma-bot-apk` |
| One physical phone required per account | architecture |

**Two of these need action this week regardless of whether redbot is ever built:** rotate
the keys, and ask Appilot whether voting can be turned off.

**And the fair part:** Appilot's bot works. It is competent Android engineering, and its
human-approval design is better than the marketing implies. redbot's case is architecture
and cost, not quality.

---

## §3 — Cost and effort, with the assumptions exposed

### §3.1 Effort

**[E]** — engineering estimate against the 20 modules in `MODULES.md`, which were scoped
from the measured Appilot surface. Not a quote.

| Phase | Engineer-days [E] | Calendar, 1 dev | Calendar, 2 devs |
|---|---|---|---|
| P1 Engineer | 21 | 4–5 wks | 2–3 wks |
| P2 Platform | 21 | 4–5 wks | 2–3 wks |
| P3 Test | 8 | 1.5 wks | 1 wk |
| P4 Real test | 2 | 2 days | 2 days |
| **To a tested fleet** | **~52** | **~11 wks** | **~6–7 wks** |

The "8 weeks" figure used in the earlier draft assumed two developers and is only true with
two. With one developer it is ~11 weeks. Stated plainly because the earlier draft did not.

### §3.2 Money

**[E]**, and the rate assumption is the whole number — stated so it can be corrected:

| Rate assumption | Build cost, 52 days |
|---|---|
| $50/hr blended (offshore senior) | ~$21k |
| $75/hr | ~$31k |
| $100/hr (Western contract) | ~$42k |

Running costs:

| Item | Cost | Tag |
|---|---|---|
| Infrastructure, 3–10 disclosed accounts, shared IP | $0 | [V] no product needed |
| Optional distinct exits, 10 accounts | ~$40/mo | [V] static residential $0.30–6/IP/mo, Webshare/Oxylabs public pricing |
| LLM | $50–200/mo | [E] scales with volume, not accounts |
| Hosting | ~$20/mo | [E] |
| Selector maintenance | $3–5k/yr | **[E], and the softest number here.** Depends entirely on U-5 |
| **Year 2+ total** | **~$4–8k/yr** | [E] |

### §3.3 Appilot comparison

Appilot's running cost figures are **[E]** — reconstructed from their published $30/hr and
$1k–10k project pricing plus observable hardware requirements, **not** from an invoice. If
SGEN has real numbers they should replace these.

| | Appilot [E] | redbot [E] |
|---|---|---|
| Build | 5–6 months, ~$100k | ~6–11 wks, $21–42k |
| Cost per additional account | a phone + SIM + mobile proxy | a config row |
| 10 accounts, hardware | ~$2,000 | $0 |
| 10 accounts, network/yr | $3,600–9,600 | $0–480 |
| Selector maintenance/yr | $25–40k | $3–5k |
| **Year 2+** | ~$30–50k | ~$4–8k |

---

## §4 — The fleet: what is verified, what is not

### §4.1 Verified today [V] — Playwright docs, 2026-07-22

- `browser.newContext()` isolates cookies, localStorage, sessionStorage, cache
- `context.storageState({ path })` saves a login; `newContext({ storageState })` restores it
- Per-context: `proxy`, `locale`, `timezoneId`, `viewport`, `geolocation`, `colorScheme`, `permissions`
- `chromium.launchPersistentContext(userDataDir, opts)` — a real Chrome profile directory
  *(Playwright's own caveat: fresh directory, never Chrome's main "User Data", never shared)*
- `chromium.launchServer({ port, host })` → `wsEndpoint()` → `chromium.connect(ws)`
- `chromium.connectOverCDP('http://127.0.0.1:9222')` — attach to any Chrome you launched

That is the port model, confirmed. Account count is bounded by RAM and by egress identities,
**not** by Playwright or by redbot.

### §4.2 Topologies

| Topology | Capacity per 16 GB host | Tag |
|---|---|---|
| A. Contexts in one browser | ~20–40, ≈40–80 MB each | **[E] — measured in P3, U-4** |
| B. Persistent profiles, one browser each | ~25–40, ≈200–400 MB each | **[E] — measured in P3, U-4** |
| C. Server/port model | as B, processes outlive the script, may be remote | [V] API confirmed |
| D. Containers, own network namespace | bounded by RAM and exits | [A] — proven in P1, U-2 |

### §4.3 Network identity

| Method | Cost | Tag |
|---|---|---|
| Shared IP | $0 | [A] — see §4.5 |
| Per-context proxy | $0.30–6 /IP/mo | **[V]** Playwright API + public pricing |
| WireGuard + network namespace per profile | $0 software, ~$3–5/mo per VPS exit | **[A] — standard Linux technique, but the Chrome-in-netns binding is unproven on our target host. U-2, proven or dropped in P1** |
| Container + VPN sidecar | $0 local, ~$5/mo remote | [A], same test |

Ten accounts with ten distinct exits ≈ **$40/month** [E]. If U-2 fails, the fallback is
per-context proxy, which is [V] and costs about the same.

### §4.4 Device identity — the reasoning, and its status

Contexts share one browser binary on one GPU, so canvas, WebGL, audio and font fingerprints
are identical across them [V, how browsers work].

The anti-detect industry's answer is to randomise each profile. **That is the wrong move
here** [A, reasoned]: a fingerprint links accounts only when it is *rare*. Two accounts both
presenting a standard Chrome-on-Windows fingerprint are not linked by it — that is the modal
browser. Randomised canvas noise makes each profile unique and inconsistent between loads,
which is itself detectable as spoofing. Randomisation converts a non-signal into a signal.

So redbot aims to be **common, not unique**:

| Surface | Approach | Tag |
|---|---|---|
| `navigator.webdriver` and automation tells | remove via `addInitScript()` + `--disable-blink-features=AutomationControlled` | [V] API exists · [A] effectiveness, tested in P3 |
| TLS handshake | `channel: 'chrome'` uses the **installed Chrome** rather than bundled Chromium | **[V]** that it uses real Chrome. **[A]** that this materially changes the TLS fingerprint — not measured |
| UA / platform / languages | match installed Chrome exactly, never invent | [V] |
| Viewport | drawn from common real resolutions | [V] |
| Canvas / WebGL / audio | left alone | policy |
| Profile state | separate `userDataDir` | [V] |

**Honest limit:** redbot does not make ten accounts look like ten different computers. If
that is ever required, the answer is ten different computers — topology D, a few dollars a
month — not JS patching.

### §4.5 What is actually load-bearing

Everything above exists to make **connected accounts look unconnected**. redbot's accounts
are disclosed — the connection is public by construction — so that stack is hygiene, not
concealment.

Reddit does not action accounts for sharing an IP alone **[A, reasoned from how shared
networks work — households, offices, universities, carrier NAT — not a Reddit statement].**
What Reddit does state it acts on **[V]** is coordinated behaviour: multiple accounts used
to manipulate, coordinated voting, correlated IP + login + vote timing.

What matters, and is free:

1. One session per account, never shared
2. Never two accounts acting simultaneously — serial, staggered by hours
3. Per-account persona: own subreddits, own hours, own register, own ceiling
4. Accounts never interact — no shared threads, no replying to each other, no same links

All four enforced by the orchestrator, all four asserted by tests in §7.

---

## §5 — Work breakdown

### W1 — this week, before engineering
| # | Task | Owner | Output |
|---|---|---|---|
| 1.1 | **Rotate the Anthropic + OpenRouter keys in the Appilot APK** | Jerome | new keys, old revoked |
| 1.2 | Ask Appilot: can voting be disabled, and was it ever on for SGEN's device | Jerome | written answer |
| 1.3 | **Read r/WordPress rules on vendor/employee participation** (U-1) | Jerome | go / no-go on publishing |
| 1.4 | List the people who would be in the fleet + their existing accounts (U-6) | Jerome | names, handles, karma |
| 1.5 | Confirm dev resourcing: 1 or 2 developers | Jerome | sets the 11-week vs 7-week track |

### P1 — engineer (M-01..M-08 + fleet session manager)
Config · store · selector pack · page driver · **fleet session manager** · action registry ·
workflow parser · humanize · per-account ledger.
**Also P1:** prove or kill U-2 (netns binding) in the first three days, so the network design
is settled before anything depends on it.
**Exit:** unit tests green offline; a `netns` decision recorded in an ADR.

### P2 — platform (M-09..M-17)
Engine · **orchestrator** · LLM · qualify/draft/lint · approval queue with account
attribution · fleet dashboard · audit log · CLI · kill switch.
**Exit:** one workflow runs a full cycle across two profiles against the fixture site.

### P3 — test (M-18..M-20 + fingerprint harness)
Fixture site · golden-page corpus · offline suite · fingerprint differential harness.
**Also P3:** measure real per-profile RAM (U-4) and record it, replacing the [E] in §4.2.
**Exit:** the nine assertions in §7, network disabled.

### P4 — real test
Live, **logged out, read-only**, several profiles, one subreddit.
Proves selectors, driver, extraction, scoring, qualification, drafting and orchestration
against real Reddit. No account. No writes. No API access.
**Exit:** real threads returned, scored and qualified; selector tier-win rates recorded as
the baseline for degradation alerting.

### P5 — pilot
2–3 real accounts, human-approved writes only, r/WordPress, two weeks, measured.
**Exit:** U-3 answered with evidence.

### P6 — scale
Add accounts and subreddits only as evidence supports. Explicit go/no-go.

---

## §6 — What is deliberately not in the MVP

Original posts · edit/delete · direct messages · join/leave/save/follow/hide/report ·
vote actions (ADR-0007) · mention monitoring · MOE integration · any platform but Reddit.

All are specified in `engineering/ACTION-REGISTRY.md`, none is implemented, and none is
counted in the §3.1 estimate.

---

## §7 — Definition of done

Nine assertions. Seven require no Reddit account and no network.

1. `npm test` green **with the network disabled**
2. A JSON workflow drives read → score → qualify → draft against the fixture site
3. **Three profiles run the same workflow with fully isolated sessions** — no cookie, storage
   or history bleed — proven by test
4. **The orchestrator never runs two accounts concurrently** — proven by test
5. A draft mentioning SGEN without the disclosure line is rejected — proven by test
6. A write exceeding that account's ledger is blocked — proven by test
7. A workflow referencing `upvote` fails validation — proven by test
8. The kill switch halts the whole fleet mid-step — proven by test
9. A live logged-out read-only run against reddit.com returns real, scored, qualified threads

Plus: zero secrets in the repo, asserted by CI.

**"Done" before item 9 means "done against a synthetic fixture" and will be reported that
way.**

---

## §8 — Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | r/WordPress forbids vendor participation (U-1) | unknown | **fatal to publishing** | W1.3, before engineering |
| R-2 | Account suspended or shadowbanned | medium | high | per-account ledger, human pace, disclosure, no interaction |
| R-3 | Reddit changes its DOM (U-5) | **certain** | low if pack works, high if not | pack + golden pages + degradation alerts; measured at P4 |
| R-4 | Accounts correlated and actioned together | medium | **high — the fleet risk** | serial scheduling, per-account egress, no shared threads, no voting |
| R-5 | Public astroturfing accusation | low *(disclosed)* | high | disclosure enforced, human gate, kill criteria |
| R-6 | FTC undisclosed endorsement | low | high | linter + audit log as evidence |
| R-7 | Drafts mediocre, nobody posts them (U-3) | medium | medium | P5 measures before P6 spends |
| R-8 | Nobody operates it and it rots | medium | high | named operator required before P5 |
| R-9 | Effort estimate is wrong | **medium — it is an [E]** | medium | P1 re-forecasts against actuals and this table is updated |

**Kill criteria:** any moderator removal, any public astroturfing accusation, any account
health degradation, or two consecutive unknown-outcome writes → publishing stops fleet-wide,
listening continues, restart requires a written note saying what changed.

---

## §9 — Status

| Item | Status | Date |
|---|---|---|
| P0 — plan, canon, ADRs, requirements, specs | **complete** | 2026-07-22 |
| W1 — the five tasks in §5 | **not started** | — |
| P1 — engineer | **not started** | — |
| Code written | **none that runs.** 4 scaffolding files in `app/src/`, unwired | 2026-07-22 |

**Nothing in this repository executes yet.** The plan is real; the software is not. That
distinction will be maintained in every status report.

---

## §10 — Decisions needed to start

| # | Decision | Default if unanswered |
|---|---|---|
| D-a | 1 developer or 2 | assume 1 → 11-week track |
| D-b | Fleet size at pilot | assume 2 accounts |
| D-c | Publishing go/no-go pending U-1 | assume listening-only until U-1 answered |
| D-d | Primary objective — defence, leads, or presence | assume leads; reorders P2 modules only |

None of these blocks P1 starting. All four can be answered while engineering runs.
