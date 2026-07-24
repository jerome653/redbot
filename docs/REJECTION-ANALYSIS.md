# Rejection analysis

**Phase 14 · 2026-07-23 · ENGINE FILES MODIFIED: 0**
Source: `data/certifications.jsonl` `reasons[]`, plus the rule→bucket mapping read from
`src/argus/certify.ts`.

---

## How a verdict is actually decided

Read from `src/argus/certify.ts:218-231`:

```
if (reject.length)   return REJECT;
if (escalate.length) return ESCALATE;
return CERTIFIED;
```

**One reject-class reason is sufficient.** There is no threshold, no count, no ratio. The rules are
sorted into two buckets at the point they fire:

| Bucket | Rules |
|---|---|
| **REJECT** | `no-claims` · `thread-resolved` · `fatal-contradiction` · `no-provenance` · `invalidated-dependency` · `graph-cycle` |
| **ESCALATE** | `falsifiable-claim-weak-evidence` · `low-confidence-as-fact` · `unrefuted-falsifiable-claim` · non-cycle graph issues |
| **Conditional** | `overconfident-language` — **REJECT** if the claim type is falsifiable, otherwise ESCALATE (`certify.ts:135`) |

`FALSIFIABLE_TYPES` = `implementation-detail`, `version-specific`, `platform-behaviour`,
`protocol-behaviour`, `configuration-advice`.

---

## Rule firings across all six certifications

| Rule | firings | class |
|---|---|---|
| `fatal-contradiction` | **38** | REJECT |
| `overconfident-language` | 24 | conditional |
| `invalidated-dependency` | 9 | REJECT |
| `falsifiable-claim-weak-evidence` | 7 | ESCALATE |
| `no-provenance` | 3 | REJECT |
| `thread-resolved` | 2 | REJECT |
| `low-confidence-as-fact` | 1 | ESCALATE |

---

## Root cause per certification

| # | Verdict | REJECT-class rules that fired | Causes |
|---|---|---|---|
| 0 | REJECT | `thread-resolved` | **single** |
| 1 | REJECT | `thread-resolved` | **single** |
| 2 | REJECT | `fatal-contradiction` (+ conditional `overconfident-language`) | **single** |
| 3 | REJECT | `fatal-contradiction`, `no-provenance`, `invalidated-dependency` (+ conditional) | **OVERDETERMINED — 3** |
| 4 | REJECT | `fatal-contradiction`, `invalidated-dependency` (+ conditional) | **OVERDETERMINED — 2** |
| 5 | REJECT | `fatal-contradiction`, `invalidated-dependency` (+ conditional) | **OVERDETERMINED — 2** |

---

## Grouped by root cause

### Group A — thread already resolved (2 of 6)

Records 0 and 1. `thread-resolved` fired and **zero claims were extracted**. Nothing about the
reply's quality was assessed; the pipeline determined the discussion was already finished.

This is a *pre-filter* rejection, not a quality judgement. Any analysis that treats these two records
as evidence about the certification engine's discrimination is wrong — they never reached it.

### Group B — single fatal contradiction path (1 of 6)

Record 2. `fatal-contradiction` alone carries the verdict. **This is the only certification whose
rejection depends on the fatal rule.**

### Group C — overdetermined (3 of 6)

Records 3, 4, 5. Two or three *independent* reject-class rules each fired. Removing any one of them
changes nothing.

Record 3 is the extreme: `fatal-contradiction` **and** `no-provenance` **and**
`invalidated-dependency` **and** conditional `overconfident-language` on falsifiable claims — four
independent sufficient causes.

---

## The consequence for tuning

**If `fatal-contradiction` were removed from the engine entirely, five of six certifications would
still reject.**

| # | Without the fatal rule |
|---|---|
| 0 | STILL REJECT — `thread-resolved` |
| 1 | STILL REJECT — `thread-resolved` |
| 2 | **would no longer reject** |
| 3 | STILL REJECT — `no-provenance`, `invalidated-dependency`, `overconfident-language`/falsifiable |
| 4 | STILL REJECT — `invalidated-dependency`, `overconfident-language`/falsifiable |
| 5 | STILL REJECT — `invalidated-dependency`, `overconfident-language`/falsifiable |

Rejection is not concentrated in one rule. Tuning the fatal-contradiction threshold — the obvious
first move — would change **one verdict out of six**, and that one would move to ESCALATE, not
CERTIFIED. See `THRESHOLD-SIMULATION.md`.

---

## Rule reach

| Rule | fires on |
|---|---|
| `fatal-contradiction` | 4 / 6 certifications |
| `invalidated-dependency` | 3 / 6 |
| `thread-resolved` | 2 / 6 |
| `no-provenance` | 1 / 6 |

`invalidated-dependency` is worth noting: it is **derived**, not independent. It fires because
something upstream already failed, and `certify.ts:204` seeds the failure set from fatal
contradictions *and* unsupported claims. It amplifies other rules rather than detecting anything new,
yet it is the second most widespread reject-class rule.

---

## What this analysis cannot say

It establishes **why** each certification rejected, mechanically and completely. It says nothing
about whether any rejection was **correct** — that requires human adjudication, and only 3 of 57
claims have it. See `CALIBRATION-REPORT-V3.md`.
