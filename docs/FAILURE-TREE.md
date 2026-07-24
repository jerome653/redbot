# Failure tree

**Phase 15 · 2026-07-23 · ENGINE FILES MODIFIED: 0**

Where rejection enters the pipeline, quantified at every level.

---

```
CERTIFICATION ATTEMPTS ......................... 6      100 %
│
├── rejected before the certifier ............. 2       33.3 %
│     └── thread-resolved, 0 claims extracted
│         Aggregation never involved. Nothing about reply
│         quality was assessed.
│
└── reached the certifier ..................... 4       66.7 %
    │
    ├── REJECT-class rules fired
    │     ├── fatal-contradiction ............. 4/4 drafts    100 %
    │     ├── invalidated-dependency .......... 3/4 drafts     75 %
    │     └── no-provenance ................... 1/4 drafts     25 %
    │
    ├── FATAL CONTRADICTIONS .................. 38 on 24 distinct claims
    │     ├── counterexample .................. 18    47.4 %
    │     ├── alternative-explanation .........  7    18.4 %
    │     ├── known-exception .................  7    18.4 %
    │     ├── edge-case ......................   2     5.3 %
    │     ├── configuration-dependency .......   2     5.3 %
    │     ├── contradictory-documentation ....   1     2.6 %
    │     └── version-difference .............   1     2.6 %
    │
    ├── CLAIMS ................................ 57 total
    │     ├── failing (any trigger) ........... 42    73.7 %
    │     └── clean ........................... 15    26.3 %
    │
    └── EVIDENCE .............................. 57 claims
          ├── non-authoritative ............... 43    75.4 %
          └── authoritative ................... 14    24.6 %
```

---

## Where rejection actually enters

| Entry point | records | share |
|---|---|---|
| **Pre-filter** (`thread-resolved`, no claims) | 2 | **33.3 %** |
| **Certifier** (claim-level rules) | 4 | **66.7 %** |

A third of all rejections in this corpus never reached the certification engine. Any analysis of
Argus's discrimination that includes records #0 and #1 is measuring the pre-filter, not the engine.

---

## Narrowing at each level

| Level | population | failing | rate |
|---|---|---|---|
| Certification | 4 reached the certifier | 4 | **100 %** |
| Claim | 57 | 42 | **73.7 %** |
| Claim — fatal only | 57 | 24 | 42.1 % |
| Contradiction | 119 | 38 fatal | 31.9 % |
| Evidence | 57 | 43 non-authoritative | 75.4 % |

**The amplification step is claim → certification: 73.7 % of claims fail, and 100 % of drafts do.**
Every other level narrows or holds; only the final aggregation expands failure to totality.

That single row is the clearest quantitative statement of the aggregation effect available in this
data, and unlike the probability model it requires no independence assumption.

---

## Per-claim trigger overlap

| Trigger | claims | share of 57 |
|---|---|---|
| `fatal-contradiction` | 24 | 42.1 % |
| epistemic issue → `overconfident-language` | 24 | 42.1 % |
| — of which on a falsifiable type (reject-class) | 8 | 14.0 % |
| — of which on other types (escalate-class) | 16 | 28.1 % |
| `invalidated-dependency` | 9 | 15.8 % |
| `no-provenance` | 3 | 5.3 % |
| **Union — claims failing for any reason** | **42** | **73.7 %** |

The union (42) is far below the sum (60), so triggers overlap heavily: many claims fail in more than
one way. That overlap is why removing `no-provenance` or reject-class `overconfident-language`
changes the clean rate by zero — see `COUNTEREXAMPLES.md` CE-4 and CE-5.

---

## The dominant path

Reading the tree by volume, the single most common route to rejection is:

```
non-authoritative evidence (75.4 % of claims)
      ↓
claim asserted with high confidence (68.4 % declare high)
      ↓
refutation finds a counterexample (47.4 % of all fatal contradictions)
      ↓
claim carries a fatal contradiction (42.1 % of claims)
      ↓
draft rejects (100 % of drafts reaching the certifier)
```

Every stage of that path is measured. Whether any individual step is *correct* is not — the fatal
contradictions have been verified by hand only on the three adjudicated claims, where all three were
right.
