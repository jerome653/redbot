# Argus — the truth certification engine

Argus decides whether a technical reply **deserves to exist**, before a human is asked to read it.

It is not a drafting engine, not a linter, and not a prompt. Its output is one of exactly three
verdicts — **CERTIFIED**, **ESCALATE**, **REJECT** — and nothing else. No score, no percentage,
no "mostly fine": a certification system that emits a number invites someone to pick a threshold
and argue about it.

---

## Why it exists

HRC-001, 2026-07-23. The pipeline produced a reply that was fluent, specific, correctly hedged,
brand-safe, lint-clean, and genuinely novel against the thread. It claimed an oversized row
"inserts empty or truncated instead of throwing an error" during a SQL import. MySQL raises
`ERROR 1153 (08S01)` and aborts.

**Every automated gate passed it.** Each measured a proxy readable from text — leakage, register,
specificity, novelty, opportunity. None measured truth, and none could.

> **Writing quality does not imply technical correctness.**

That sentence is the axiom every module here is built from. It is treated as architectural
evidence, not as an anecdote.

## The core principle

**Never evaluate paragraphs. Evaluate claims.**

A paragraph cannot be certified — it is an average of assertions, and averages are how invalid
reasoning survives review. A claim can be certified, because a claim has provenance.

## Architectural position

```
Collect → Resolution Detection → Gap → Opportunity → Draft
        → Claim Extraction → Classification → Evidence → Contradiction
        → Confidence → CERTIFICATION → Human Review → Publish
```

Truth certification is a first-class layer, not a step inside drafting.

## Where the model is used, and where it is not

| Phase | Who decides | Why |
|---|---|---|
| 7 · resolution detection | **code** | a model already failed at this (HRC-001-A) |
| 1-4 · extraction, classification, provenance, confidence | model | reading prose and decomposing it is what a model is for |
| 5 · contradiction | model, adversarial | asked to *refute*, never to *assess* |
| 6 · dependency graph | **code** | graph traversal has no opinion |
| 8 · epistemic calibration | **code** | the certainty of a sentence is a property of its words |
| 12 · verdict | **code** | every rule is deterministic and cites an observed failure |

The model produces **structure**. Code makes every **decision**. That inversion is the whole
response to HRC-001, where fluent model output was trusted end to end.

Model output is also validated against the enums in `types.ts` — an unrecognised evidence class
becomes `unknown`, which the rules treat as *absent provenance*. A model cannot invent a new
authority for itself.

## Phase 7 — resolution detection

Deterministic string matching over the post body and comment authors. Runs first, and
short-circuits everything: a resolved thread costs zero model calls.

`byOriginalPoster` matters more than the wording. A bystander saying "this worked" is recorded
but is not authoritative; only the asker's own declaration, or an `UPDATE:`/`SOLVED:` marker in
the post, sets `resolved`. Bare politeness ("Thanks!", "I'll try that") is explicitly excluded —
it appears under answers that did not work.

On resolution the opportunity score is forced to zero. Only `--override` continues.

## Phase 3 — the evidence rule that matters most

> **Reasoning about how software behaves is not evidence of how it behaves.**

`reasoned-inference` is an honest and common answer for explanatory claims. It is also the class
HRC-001's false claim actually belonged to, while presenting itself as implementation detail.

So: a **falsifiable** claim (implementation detail, version-specific, platform, protocol,
configuration advice) resting on **non-authoritative** evidence does not certify. It escalates.

## Phase 6 — no partial salvage

HRC-001's structure:

```
A  "exceeding max_allowed_packet truncates the row silently"   ← FALSE
B  "Custom CSS is one large serialized row"                     ← unverified
C  "so that is why your CSS came back blank"                    ← rests on A, B
D  "check max_allowed_packet before the next restore"           ← rests on C
```

Scored independently, three of four read as plausible and the average passes. When A fails, C and
D fail with it — and the reviewer is told *"D is dead because A is false"*, not handed four
separate complaints.

## Phase 10 — the citation check, and why it is so narrow

Added 2026-07-24 under a recorded freeze exception (EX-01 in `ENGINE-FREEZE.md`).

Every other phase measures a property readable inside the draft. This one looks outward — at
human-authored reference material — and it is deliberately scoped to almost nothing.

A corpus has a **jurisdiction**: the claims it is entitled to rule on. It is silent everywhere
else, and that silence is recorded as silence, never as approval. The only configured corpus is
the SGEN knowledge base, whose jurisdiction is claims about SGEN.

The measurement that set the scope, taken against the real KB (3,544 cards):

| | |
|---|---|
| cards mentioning WordPress | 17 — every one of them *"SGEN does not do that"* |
| cards mentioning mysql | 2 |
| updraft · elementor · woocommerce · jquery | **0** |

redbot answers WordPress questions. The KB's coverage of that claim space is effectively zero,
so a "no supporting source" flag over WordPress claims would be true ~100 % of the time — which
is DEFECT-15 again: *a flag that is almost always true is not a filter.* What the KB **can** rule
on is claims about SGEN, and a fabricated product capability asserted under a pseudonymous
account in a public subreddit is unretractable.

Three outcomes, and the middle one is the important one:

| | |
|---|---|
| `uncited` | the corpus covers the subject and holds nothing on the claim → **REJECT** |
| `covered` | material exists on the subject → **ESCALATE**, cards attached |
| `unavailable` | the corpus could not be read → **ESCALATE**, fails closed |

**`covered` is not `supported`, and the distinction cost a design change mid-build.** Measured
2026-07-24: the false claim *"SGEN supports installing WordPress plugins"* matched
`kb-can-i-install-a-plugin` at 0.60 term coverage — the card that says the exact opposite. Term
overlap finds cards **about** a subject; it cannot tell agreement from contradiction. Handing a
false claim a citation is HRC-001 with a footnote attached, so a match escalates to a person
with the cards attached and never certifies on its own.

No model call happens in this phase. Retrieval is term overlap; code decides. Both thresholds
live in `policy.ts` marked **provisional** — chosen to be conservative, never measured for
precision or recall, not quotable as findings.

The corpus set is pluggable (`src/corpus.ts`, overridable via `data/corpora.json`), so a real
WordPress ground-truth corpus drops in without touching the rules.

## Phase 9 — the review package shows the draft last

Reading a fluent paragraph primes you to check whether it *sounds* right instead of whether it
*is* right. HRC-001 is the proof: it was pleasant to read, and the pleasantness came first.

So the package leads with thread status, verdict reasons, the claim table, what the reply
actually concludes, known uncertainties, and contradictions. The draft appears at the bottom,
once the reviewer already knows what to look for.

## Acceptance

Success criterion 6 was *"HRC-001 would have been escalated or rejected before reaching the
publication queue"*. Measured on the real draft:

```
$ redbot certify d_f11d8de68709_mrwj1koh
Resolution : RESOLVED — the asker declared this resolved — 3 signal(s) from
             the original poster, plus 1 from other commenters
REJECT
  [thread-resolved] … certification stopped before claim extraction
Claims: 0
```

Rejected on the asker's own words, deterministically, before a single model call.

## Commands

```
redbot certify [draftId] [--override]     run Argus; --override continues past a resolved thread
```

Reports, regenerated every run:

| File | Contents |
|---|---|
| `argus-review-<draftId>.md` | the operator review package (Phase 9) |
| `argus-claim-ledger.md` | every claim ever extracted, by type |
| `argus-evidence-ledger.md` | provenance distribution — the pipeline's health metric |
| `argus-certification-report.md` | verdicts, and which rules fired |
| `argus-contradiction-report.md` | every contradiction, fatal flagged |
| `argus-confidence-report.md` | confidence distribution + language outrunning evidence |

## What Argus does not do

It checks that claims are **supported**. It cannot check that they are **true**, and it has no
opinion on whether a reply is worth posting.

Human review remains mandatory in all three verdicts, including CERTIFIED. Argus exists to make
that review better — by handing the reviewer evidence instead of prose — not to replace it.
