# Research summary — Open Research Mode

**2026-07-23 · ENGINE FILES MODIFIED: 0**

Six hypotheses tested, each in a focused report. Two falsified, three supported, one resolved into a
different finding. **No engine defect was found; three measurement-quality defects were.**

---

## Every hypothesis tested

| # | Hypothesis | Outcome | Report |
|---|---|---|---|
| H1 | The replay gate validates the certification corpus | **Falsified** — covers 1 of 6 records | `RQ-01-REPLAY-COVERAGE.md` |
| H2 | Benchmark expectations encode independent correctness criteria | **Falsified** — 0 of 9 rule assertions human-backed | `RQ-02-BENCHMARK-INDEPENDENCE.md` |
| H3 | The pipeline is non-deterministic (same draft, different claim counts) | **Falsified — determinism holds**; resolved into a corpus-composition finding | `RQ-03-SAME-DRAFT-TRIPLE.md` |
| H4 | Multiple contradictions on a claim are redundant restatements | **Falsified — they are distinct** (mean Jaccard 0.080) | `RQ-04-CONTRADICTION-REDUNDANCY.md` |
| H5 | The validation gates are reproducible | **Supported** — byte-identical over 3 runs each | `RQ-05-GATE-DETERMINISM.md` |
| H6 | The AND-aggregation is exercised by the test suite | **Falsified** — max 2 claims; CERTIFIED only at n = 1 | `RQ-06-CERTIFIED-PATH-COVERAGE.md` |

---

## Hypotheses falsified

**H1 — replay coverage.** `ARE-001` reduces 6 records to the single richest and replays that one.
Coverage: 1/6 records, 1/4 drafts, 19/57 claims, REJECT only. Prior reports — including mine in
Phases 9–15 — cited "replay exit 0" alongside "182/182" as comparable evidence. It is a spot check.

**H2 — benchmark independence.** `make-cases.mjs` reads `data/certifications.jsonl` directly.
**3 of 4** verdict assertions have human backing; **0 of 9** rule assertions do. CERT-002 carries
6 of those 9 rule assertions and has no human verdict at all. The README already says "regression";
the ratio was never quantified.

**H4 — contradiction redundancy.** Falsified *in the engine's favour*. 144 pairs compared: mean
similarity 0.080, zero pairs above 0.3, and hand-inspection of the four most-similar pairs found
genuinely distinct mechanisms in every case. The fatal counts in Phases 14–15 are not inflated by
duplication.

**H6 — aggregation test coverage.** 29 tests in `argus.test.ts`: 21 with no claims array, 6 with one
claim, **2 with two claims, 0 with three or more**. Both CERTIFIED assertions use exactly one claim.

---

## Hypotheses strengthened

**H5 — gate determinism.** Benchmark artefact, replay stdout and corpus stdout all byte-identical
across three consecutive runs. This extends the Phases 11/13 check, which covered only
`last-run.json`. Confidence high for the deterministic tail; **the model-dependent layers
(extraction, refutation, epistemic) remain untested for determinism** — the three green gates certify
one of five layers.

---

## Newly discovered defects

**No engine defect.** Everything examined behaves as its source says it does.

Three **measurement-quality** defects, all in how evidence has been cited rather than in the engine:

| Defect | Nature | Severity |
|---|---|---|
| D-1 · Replay cited as corpus-wide verification | 1/6 coverage reported as a peer of the full test suite | Medium — inflates apparent assurance |
| D-2 · Benchmark cited as correctness evidence | 0/9 rule assertions independent; self-referential by construction | Medium — `benchmark 4/4` means "unchanged", not "correct" |
| D-3 · Aggregation behaviour asserted from source, not measured | Max test width 2 claims; CERTIFIED never tested above 1 | Low — the inference is sound, but it is inference |

All three are recorded and **none is fixed**, per the phase rules.

---

## Uncertainties eliminated

1. **Replay scope** — was unstated, now exactly quantified.
2. **Benchmark independence ratio** — was unmeasured, now 3/4 verdicts and 0/9 rules.
3. **Pipeline determinism on a repeated draft** — was an open anomaly (0 vs 12 claims on one
   `draftId`), now traced to `humanOverride` at `certify.ts:70` via `pipeline.ts:165`.
4. **Corpus composition** — 3 drafts reached the certifier naturally; the 4th required an operator
   override. Recomputing without it moves the per-claim clean rate 26.3 % → 24.4 %, and
   P(CERTIFIED, n=14) from 7.6 × 10⁻⁹ to 2.8 × 10⁻⁹ — **the Phase 14/15 conclusions are unaffected**.
5. **Contradiction distinctness** — was an untested assumption behind every fatal count.
6. **Gate reproducibility** — was assumed in every phase report, now measured.

---

## Remaining unknowns

| Unknown | Blocked by | Cost to resolve |
|---|---|---|
| Is any rejection *correct*? | human adjudication | ~1 hour |
| False-positive rate | zero claims labelled true | ~1 hour |
| Extraction determinism | needs one `certify --override` re-run of `d_f11d8de68709` and a claim-set diff | 15–27 min, writes evidence |
| Semantic (not lexical) contradiction distinctness | human judgement on ~144 pairs | hours |
| Behaviour outside WordPress/SEO | a draft from another domain | one collection + certification cycle |
| Whether claim failures are independent | ≥15 drafts | many hours |
| Cross-platform gate determinism | a second OS | low, needs another machine |

---

## Estimated confidence in the engine

| Property | Confidence | Basis |
|---|---|---|
| Verdict layer is deterministic | **High** | measured 3× per gate; stated in source |
| Verdict layer does what its source says | **High** | rule-to-bucket mapping read and reproduced |
| Rejections are internally coherent | **High** | overdetermined, non-redundant contradictions |
| Contradictions are substantively distinct | **Medium-high** | lexical measure + 4 hand checks |
| Engine catches false claims | **Medium** | 3/3 on the only adjudicated claims |
| Engine leaves true claims alone | **None** | zero labelled true claims — unmeasurable |
| Behaviour outside this domain | **None** | single subreddit |
| Extraction/refutation determinism | **None** | never tested |

**Overall: the deterministic parts of the engine are well evidenced; the model-dependent parts are
essentially unevidenced; and the central question — whether the verdicts are right — remains open.**

---

## Should the freeze remain?

**Yes**, and this phase strengthens the case rather than weakening it.

Nothing found here is an engine defect. All three defects are in the *evidence base* — and the
correct response to discovering that your assurance was overstated is not to change the thing being
assured.

The specific reason is D-2: `benchmark 4/4` is self-referential for every rule assertion. **A change
to the engine right now would be validated against a suite that was derived from the engine's own
prior behaviour.** Any regression it introduced in the rule set would be invisible unless it also
changed a verdict. Modifying an engine while its correctness suite is circular is the worst available
moment to modify it.

---

## The single highest-value experiment remaining

**Unchanged from Phase 15: adjudicate the 11 positive candidates in `POSITIVE-CANDIDATES.md`,
starting with `#2 c3`.**

Open Research did not displace it, and one finding here makes it *more* valuable: RQ-04 established
that the contradictions are non-redundant, so a human ruling on the claims the engine *declined* to
attack now tests a cleaner signal. If those claims are mostly true, the engine's claim-level
discrimination is real. If several are false, the refutation pass has false negatives and the
aggregation hypothesis is overturned.

**Cheapest new experiment:** re-run `certify --override` on `d_f11d8de68709` and diff the claim set
against record 2 (RQ-03). One certification cycle, 15–27 minutes, and it would produce the project's
first evidence about extraction determinism — currently at confidence **None**.

---

## Is further research expected to produce meaningful information?

**No — not without new data.**

Every remaining question in the table above is blocked on one of: human adjudication, a new
certification run, or a draft from another domain. None is answerable by further analysis of the
existing 6 records and 57 claims.

Continuing to slice n = 4 drafts would meet the stated stop conditions — repeating previous work and
producing negligible information gain. **Stopping here is the correct call**, and this phase reached
it after six hypotheses rather than by running out of ideas.

---

## Phase status

| Gate | Result |
|---|---|
| Engine files modified | **0** |
| Tests | **182 / 182** |
| Benchmark | exit 0 · byte-identical across a fresh run |
| Corpus | exit 0 |
| Replay | exit 0 |
| Extraction verification | 39 verified · 0 deviated |
| Behavioural changes | none |
| Defects fixed | **none — measured and documented only, per the phase rules** |
