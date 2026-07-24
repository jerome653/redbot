# Positive candidates

**Phase 14 · 2026-07-23 · ENGINE FILES MODIFIED: 0**

> **Nothing in this document is a label.** No claim below has been adjudicated, and none is asserted
> to be true. This is a *search* for claims that a human adjudicator would plausibly rule true, so
> that the next adjudication round can include some — because the corpus currently contains none, and
> without them no false-positive rate can ever be computed.
>
> The estimates in the final section are explicitly labelled as estimates and must not be entered
> into any `case.json`.

---

## Why this search matters

Every one of the three adjudicated claims in the corpus was ruled **false**. A corpus of only-false
claims can demonstrate that the engine catches bad claims. It can never demonstrate that the engine
leaves good ones alone.

That makes the false-positive rate **unmeasurable by construction**, and the false-positive rate is
the number that decides whether "always REJECT" is a defect or a finding.

---

## Selection criterion

A claim qualifies as a candidate if the engine raised **nothing at all** against it:

- zero contradictions of any kind
- zero epistemic issues
- not invalidated by a failed dependency

**11 of 57 claims (19.3 %) meet this bar.**

These are the claims Argus itself declined to attack. If the engine is well calibrated, a high
proportion should survive human adjudication as true. If a human rules several of them false, that is
a false-negative finding — equally valuable, and equally impossible to obtain today.

---

## The 11 candidates

| # | id | type | provenance | conf | claim |
|---|---|---|---|---|---|
| 2 | c1 | observation | `framework-documentation` | high | Custom CSS and Additional CSS are stored using different methods in WordPress |
| 2 | c2 | inference | `reasoned-inference` | medium | Because they are stored in different locations, a restore can delete Custom CSS while preserving Additional CSS |
| 2 | c3 | implementation-detail | `framework-documentation` | high | Additional CSS from Appearance → Customize is stored as a dedicated single database entry |
| 3 | c1 | recommendation | `widely-accepted-practice` | high | Use the Wayback Machine to review what the domain previously hosted |
| 3 | c2 | observation | `observed-runtime-behaviour` | high | The previous site owner hosted approximately 200,000 pages that appear to be scraped content |
| 3 | c4 | observation | `community-knowledge` | medium | Problematic prior site types include scraper farms, expired-domain PBNs, and hacked sites |
| 3 | c11 | recommendation | `widely-accepted-practice` | medium | Check whether robots.txt, noindex tags, or CDN/edge rules from the old site are still in place |
| 4 | c5 | observation | `community-knowledge` | medium | Category and product listing pages receive the most traffic in WooCommerce |
| 4 | c11 | observation | `operator-experience` | medium | In typical WooCommerce setups, one plugin adds 30–50+ … |
| 4 | c16 | observation | `operator-experience` | medium | Catalog search can become a performance bottleneck in large WooCommerce installations |
| 4 | c18 | observation | `framework-documentation` | high | Query Monitor reveals which plugins or queries are causing performance issues |

---

## Categories

**By claim type**

| Type | count | note |
|---|---|---|
| `observation` | 7 | the dominant category |
| `recommendation` | 2 | |
| `inference` | 1 | |
| `implementation-detail` | 1 | **falsifiable type** |

**By provenance**

| Class | count | |
|---|---|---|
| `framework-documentation` | 3 | authoritative |
| `widely-accepted-practice` | 2 | |
| `community-knowledge` | 2 | |
| `operator-experience` | 2 | |
| `observed-runtime-behaviour` | 1 | authoritative |
| `reasoned-inference` | 1 | |

**By confidence** — medium 6, high 5.

---

## Reading the pattern

Three groups are visible, and they differ in how strongly one would expect them to survive scrutiny.

**Group 1 — tool and storage facts (c1/c3 of #2, c18 of #4).** Assertions about where WordPress
stores Additional CSS and what Query Monitor displays. Checkable against WordPress documentation and
source; all three declare `framework-documentation`. This is the group most likely to hold, and also
the group where a *wrong* claim would be most embarrassing, since the source is public.

**Group 2 — procedural recommendations (c1/c11 of #3).** "Use the Wayback Machine", "check
robots.txt and CDN rules". These are advice, not factual assertions. They are hard to falsify
because they recommend an action rather than state a mechanism — which is exactly why the refutation
pass had nothing to attack. Their surviving cleanly is weak evidence about the engine.

**Group 3 — population claims about typical installations (c4/c11/c16/c5).** "Category pages receive
the most traffic", "one plugin adds 30–50+". These are empirical generalisations with no cited
measurement, three of four declaring `operator-experience` or `community-knowledge`. They are the
most likely of the three groups to be judged unsupported by a careful adjudicator — the refutation
pass left them alone, but that may reflect difficulty of attack rather than soundness.

**One candidate is notable: #2 c3 is an `implementation-detail`** — a falsifiable type. It is the only
candidate in a category the engine treats as demanding authoritative backing, and it declares
`framework-documentation`. It is the cleanest single test case in the set: specific, checkable, and
in a category the engine takes seriously.

---

## Estimate — explicitly an estimate, not a label

Asked how many of the 11 would survive adjudication, an honest answer distinguishes the groups:

| Group | claims | expectation |
|---|---|---|
| Tool and storage facts | 3 | most likely to survive — checkable against public sources |
| Procedural recommendations | 2 | likely to survive, but weakly informative |
| Population generalisations | 4 | most likely to be challenged — no cited measurement |
| Remaining (inference, observation) | 2 | uncertain |

**This is a prediction about what a human would decide. It is not evidence, it has no standing, and
it must not be recorded anywhere as ground truth.** Its only legitimate use is prioritisation: if
adjudication time is limited, the tool-and-storage group gives the clearest signal per minute spent,
because a false ruling there is externally checkable.

---

## Recommendation for the next adjudication round

1. **Adjudicate #2 c3 first** — falsifiable type, authoritative declared provenance, specific and
   checkable. It is the single most informative claim in the set.
2. **Then the other two tool/storage claims** (#2 c1, #4 c18).
3. **Then at least two population generalisations** (#4 c11, #4 c16) — because if these are ruled
   false, that is a **false-negative** finding: claims the engine should have attacked and did not.

Whatever the outcome, this is the first opportunity the corpus has had to contain a claim ruled
**true** — and until it does, `CERTIFICATION-METRICS.md` §8 stands: the false-positive rate is not
merely unmeasured but unmeasurable.
