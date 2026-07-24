# 4. Reddit-specific vs platform-general

**Long-term goal: minimise Reddit-specific code.**

Measured over 55 modules and 9,462 lines. The split is better than expected, and that is an
accident of how the project developed rather than a design achievement — the general parts were
built because the *failures* were general, not because portability was a goal.

---

## Summary

| | Modules | Lines | Share |
|---|---|---|---|
| **Reddit-specific** | 9 | ~1,180 | **12%** |
| **General contribution engine** | 34 | ~6,400 | **68%** |
| **Configuration wearing code's clothes** | 4 | ~640 | 7% |
| Infrastructure (neutral) | 8 | ~1,240 | 13% |

**Roughly two-thirds of this codebase is already a platform-neutral contribution engine.**

---

## Reddit-specific — the adapter

These would be replaced wholesale for GitHub, a forum, or a docs platform.

| Module | Lines | Why it is Reddit-bound |
|---|---|---|
| `reddit/selectors.ts` | 71 | Shreddit DOM selectors |
| `reddit/scrape.ts` | 185 | Feed/thread structure, `shreddit-post` attributes |
| `reddit/post.ts` | 104 | The composer and submit flow |
| `reddit/thread-state.ts` | 99 | Lock/archive markers, `shreddit-comment` authors |
| `browser.ts` — identity half | ~70 of 169 | `shreddit-app[user-logged-in]`, header profile link |
| `commands/read.ts` · `search.ts` | 142 | Subreddit and search URL shapes |
| `probe-karma.ts` | 76 | Reddit profile page parsing |
| `ACCOUNT-WARMING.md` policy encoded in `policy.ts` | ~40 | Karma, crowd control, subreddit minimums |

**Total ~1,180 lines.** The write path — the highest-risk code — is 104 lines.

## General contribution engine — portable today

These have no Reddit concept in them beyond a type name.

| Module | Lines | What it actually is |
|---|---|---|
| **`argus/*`** (9 modules) | **1,547** | Claims, provenance classes, contradiction, dependency graph, epistemic calibration, verdicts. **Nothing platform-specific whatsoever.** |
| `argus/resolution.ts` | 121 | "The asker said they're done" — universal |
| `disclosure.ts` | 238 | Agent leakage, brand mentions, fabricated experience, sales register |
| `quality.ts` | 268 | Clichés, register, specificity, length, false certainty |
| `novelty.ts` | 93 | Restatement detection against prior claims |
| `gap.ts` | 127 | What a discussion is missing |
| `opportunity.ts` | 158 | Contribute-or-skip from structured gaps |
| `review.ts` | 267 | Operator decisions, reason taxonomy, Human Regret |
| `behavior.ts` + `rand.ts` | 346 | Dwell, scroll shape, session budgets, seeded replay |
| `health.ts` | 305 | Account state machine over observations |
| `policy.ts` | 145 | Limits with provenance |
| `trace.ts` · `insights.ts` · `metrics.ts` | 542 | Telemetry, funnel attribution, reliability |
| `reports.ts` + `argus/reports.ts` | 841 | Ledgers and review packages |
| `gates.ts` | 247 | Fail-closed gate framework (~half the gates are neutral) |
| `store.ts` · `config.ts` · `log.ts` · `ask.ts` | 440 | Persistence, prompts, logging |

## Configuration wearing code's clothes

Not Reddit-specific in principle, but currently hardcoded to this deployment. **This is the
cheapest portability win available.**

| Where | What is hardcoded |
|---|---|
| `select.ts` → `PILOT_SUBREDDITS` | `wordpress`, `wordpress_help`, `webdev` |
| `competence.ts` → `AREAS`, `OTHER_PLATFORMS` | The entire WordPress vocabulary and its competitor list |
| `config.ts` → `expertise[]`, `brand` | Six declared competence areas, the employer name |
| `prompts.ts` | WordPress framing in the analyze and draft prompts |

~640 lines that describe *a WordPress consultancy contributing to Reddit* rather than *a system*.

---

## What a second adapter would actually require

If the target were GitHub issues:

**Replace (~1,180 lines):** the `reddit/` directory, identity detection, the read/search commands,
karma probing.

**Reconfigure (~640 lines):** competence vocabulary, target repositories instead of subreddits,
expertise areas.

**Reuse unchanged (~6,400 lines):** all of Argus, all three linters, gap analysis, opportunity
scoring, the review dataset, Human Regret, health, policy, telemetry, reports, the gate framework.

**Genuinely new work:** an adapter interface that does not currently exist. Today `Thread`,
`Comment` and `Draft` are Reddit-shaped types used everywhere, and the pipeline calls
`reddit/scrape.ts` directly rather than through a port.

---

## The honest assessment

The portable core exists but **there is no seam.** Extracting it is not a matter of moving files:
it requires defining a `Discussion` interface (thread + comments + author + resolution signals),
a `Publisher` interface (probe state, submit, confirm), and an `Identity` interface — then making
`reddit/` one implementation.

That work is real but small, and it is **not urgent**. There is no second platform in view, and
doing it now would be architecture for an unevidenced future — precisely what the engineering
rules forbid. The right time is when a second adapter is actually wanted.

What *should* happen now is cheaper and pays immediately: **move the configuration out of the
code.** `PILOT_SUBREDDITS`, the competence vocabulary, and the expertise list are deployment
facts sitting in source files, and every one of them has already required a code edit to change
during normal operation.
