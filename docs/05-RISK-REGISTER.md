# 5. Risk register

Ranked by expected damage, not likelihood. **Blockers are marked ⛔** — work should not proceed
past them.

Severity: how bad if it happens · Likelihood: on current evidence · Detectability: would we know?

---

## ⛔ Blockers

### R-01 · Nothing has ever been published — every outcome claim is unfounded
**Class:** evidence · **Severity:** critical · **Likelihood:** certain (it is the current state)

0 publishes, 0 operator decisions, 0 regret readings, 0 signed-out observations. Nine of the
seventeen evidence holes (N-01…N-09) collapse to this one fact.

Every threshold in the system — the novelty 70%, the opportunity floor of 40, the 60% contribute
rate, the confidence floor of 70 — is **declared and uncalibrated**. There is no instrument to
calibrate them against except operator verdicts, and none exist.

**Consequence if ignored:** further engineering tunes numbers against imagination. The project
would accumulate sophistication without accumulating knowledge.

**Mitigation:** one publish, one review decision, one 24-hour regret reading. The staged draft was
correctly rejected; a new candidate is needed.

### ~~R-02~~ · Argus's claim path — **RESOLVED 2026-07-23**
**Downgraded to R-02b below.**

The full path completed on the HRC-001 draft: 12 claims, **32 contradictions, 16 fatal**, verdict
**REJECT** (E-32). The refutation independently identified `ERROR 1153` citing
`primary-documentation` (E-33) and surfaced three defects the human review missed (E-34).

This is the strongest positive result the project has produced. It is also the only one.

### R-02b · Argus has only ever returned REJECT
**Class:** architecture · **Severity:** high · **Likelihood:** certain

Both real verdicts are REJECT. A certification engine that has never certified anything has not
been shown to **discriminate** — only to reject. The false-positive rate is entirely unknown, and
a truth layer that rejects everything is as useless as one that certifies everything.

**Mitigation:** certify a draft that is genuinely sound and observe the verdict. Until then
CERTIFIED is a code path, not a demonstrated outcome.

### R-03 · Self-declared provenance is inflatable
**Class:** AI · **Severity:** high *(reduced from critical)* · **Likelihood:** observed

E-25 stands: the model declared `official-implementation` and `observed-runtime-behaviour` for
the known-false claim, so Rule 4 did not fire.

**What changed:** the adversarial refutation caught those exact claims anyway (E-35) — c5 and c7
both took fatal contradictions despite their inflated provenance. Defence in depth worked as
designed: the check that was defeated was backed by one that was not.

**Residual risk.** Refutation is a model too. When it is right, inflation is contained; when it
times out or misses, Rule 8 escalates rather than certifies. The unmeasured quantity is how often
refutation *misses* — which cannot be known without a case where a false claim survives it.

**Mitigation candidates (unbuilt, deliberately):** independent evidence verification against a
real source; treating model-declared authoritative provenance as `reasoned-inference` unless
externally corroborated.

---

## High

### R-04 · The system cannot evaluate technical correctness, by construction
**Class:** architecture · **Severity:** high · **Likelihood:** permanent · **Detectability:** none

HRC-001-B. Every automated check is a proxy readable from text. Correctness is not, and Argus
does not fix this — it *surfaces* the gap by demanding provenance and attacking claims, but it
still cannot determine truth.

This is not a defect to be closed. It is the reason human review is mandatory, and the reason the
project is positioned as an assistant. The risk is **drift**: as Argus matures, the temptation to
treat CERTIFIED as "correct" will grow. It means "adequately supported", which is a different
claim.

### R-05 · A wrong reply permanently attached to a real person
**Class:** reputational / legal-adjacent · **Severity:** high · **Likelihood:** moderate

Every published word represents the operator forever. HRC-001 came within one human review of
posting a confidently false claim about MySQL as a karma-1 account's first ever comment.

**Current mitigation:** HRC + Argus + human review, all of which held. The residual risk is that
the reviewer is the only real check and reviewer attention is finite.

### R-06 · Contribution quality is entirely unmeasured
**Class:** knowledge · **Severity:** high · **Likelihood:** certain

The one positive quality signal ever produced is "one draft passed three gates and one human
judged it good". Everything else measured is a failure. The project cannot currently answer *does
this produce good contributions?* — which is its whole purpose.

### R-07 · Reddit moderation and account loss
**Class:** moderation · **Severity:** high · **Likelihood:** moderate to high on first post

Karma 1, no history, WordPress support subreddits with promotion rules. ACCOUNT-WARMING records
the expected outcome: removal or silent filtering is likely, and a suspension means **stop** —
replacing the account from the same machine is ban evasion.

**Detectability:** only via the signed-out check, which has never run (N-04).

### R-08 · Selector drift breaks collection silently
**Class:** maintenance · **Severity:** high · **Likelihood:** high over months

Reddit's DOM is not an API. `selector.miss` telemetry exists but has **never fired**, so its
sensitivity is unknown. A partial break — some selectors working — would degrade quality without
failing.

---

## Medium

### R-09 · Model-declared judgements failing quietly
**Class:** AI · **Severity:** medium · **Likelihood:** observed repeatedly

Every model self-assessment field has failed at least once: `alreadyAnswered` (missed an explicit
UPDATE), `fillable` (97% true), `headroom` (disagreed with its own gaps twice), provenance
(inflated). The mitigation pattern — ask for observations, compute verdicts in code — is applied
but not uniformly.

### R-10 · Untested paths concentrated at the highest-consequence step
**Class:** technical · **Severity:** medium-high · **Likelihood:** certain on first publish

The publish path (`reddit/post.ts`, 104 lines) has never executed: composer discovery, typing,
submit, landed-confirmation, permalink capture. It is simultaneously the least exercised and most
consequential code in the project.

### R-11 · Operator-judgement debt accumulates invisibly
**Class:** operational · **Severity:** medium

Nothing breaks when a review or regret check is skipped. `doctor` surfaces outstanding checks,
which is the only defence. If the operator stops answering, the calibration strategy silently
dies while the system appears healthy.

### R-12 · Single operator, single machine, single account
**Class:** operational · **Severity:** medium

One Chrome profile, one recorded credential exception pointing at a machine-wide Claude config,
one Reddit account. No second operator has ever run it; cold-start on a clean machine is untested
(N-16).

### R-13 · Novelty false positives suppress good replies
**Class:** technical · **Severity:** medium · **Likelihood:** observed once

The check blocks drafts that *reference* thread facts to build on them. Unfixable without
operator data. Currently costs good drafts silently.

### R-14 · Report surface is large and unvalidated
**Class:** maintenance · **Severity:** medium

841 lines generating 13 documents for zero published interactions. Every schema change touches
them. Low risk today, growing.

---

## Low, watched

| # | Risk | Class | Note |
|---|---|---|---|
| R-15 | 6 provisional limits quoted as findings | evidence | `policy` prints the split; convention holds so far |
| R-16 | Rate-limit envelope measured once, months of drift possible | technical | 1 measured limit total |
| R-17 | Legal/disclosure exposure | legal | Mitigated by construction: generated replies may not name the employer at all; FTC-style disclosure enforced if a human adds one |
| R-18 | Lock/archive gates never exercised | technical | Fail closed — safe but unverified |
| R-19 | Trace/history divergence | maintenance | Two logs, deliberate; a future contributor may merge them |
| R-20 | `data/` is untracked and unbacked-up | operational | Evidence loss would be unrecoverable; gitignored by necessity (DEFECT-01) |

---

## What is *not* a risk, and why

- **Publishing without a human.** Two independent layers refuse it (E-31), one of them outside
  the project's own code.
- **Credential leakage to git.** Verified gitignored, checked by `doctor` every run.
- **Brand exposure in generated text.** Generated replies may not name the employer *at all*;
  31/31 adversarial cases blocked.
- **Runaway posting volume.** Daily ceiling, spacing, cooldowns, and health states — none of
  which have been exercised, but all fail closed.

---

## Blocker summary

**R-01, R-02, R-03.** All three are cheap to address and none requires new architecture:
one publish, one completed certification run, and a decision about whether model-declared
authoritative provenance should be trusted at all.

Until then, further building is momentum rather than evidence.
