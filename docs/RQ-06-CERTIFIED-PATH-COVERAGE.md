# RQ-06 — Has the CERTIFIED path ever been exercised at realistic scale?

**Open Research · 2026-07-23 · ENGINE FILES MODIFIED: 0**

**Question:** CERTIFIED has never occurred on real input (Phases 12–15). Is it reachable *at all*,
and at what claim count has it been demonstrated? This bears directly on the aggregation hypothesis:
if the AND-gate is the binding constraint, then the gate's behaviour at n > 1 is what matters — and
nobody had checked whether it is tested there.

---

## Hypothesis

*H:* the AND-aggregation across many claims is exercised by the test suite.

## Method

Parsed all 29 `test()` blocks in `src/test/argus.test.ts`, counted claims per test, and cross-checked
by reading each verdict-asserting test.

## Finding — hypothesis FALSIFIED

### CERTIFIED is reachable, and only ever demonstrated with one claim

Two tests assert `CERTIFIED`, at `argus.test.ts:247` and `:300`. Both construct **exactly one
claim**:

```js
// :244-247
const c = claim({ id: 'c1', type: 'implementation-detail',
                  evidenceClass: 'primary-documentation', confidence: 'high' });
const r = certify({ ...base, claims: [c], refutationRan: new Set(['c1']) });
assert.equal(r.verdict, 'CERTIFIED');
```

```js
// :297-300
const c = claim({ id: 'c8', type: 'protocol-behaviour',
                  evidenceClass: 'official-implementation', confidence: 'high' });
const r = certify({ ...base, claims: [c], refutationRan: new Set(['c8']) });
assert.equal(r.verdict, 'CERTIFIED');
```

The CERTIFIED path is real, tested, and requires: authoritative provenance, a falsifiable type,
refutation actually having run, and nothing found.

### Claim-count distribution across the whole suite

| Claims per test | tests |
|---|---|
| 0 (no `claims:` array) | 21 |
| **1** | 6 |
| **2** | **2** |
| 3+ | **0** |

| | |
|---|---|
| Max claims in any test | **2** |
| Tests with ≥3 claims | **0** |
| Max claims in a CERTIFIED test | **1** |

**The AND-aggregation across claims — the mechanism Phases 14–15 identified as the binding
constraint on certification — has a maximum test width of two claims, and has never been tested for
a CERTIFIED outcome above one.**

The two-claim tests are `downstream claims are rejected when their foundation is unsupported`
(dependency propagation, asserts REJECT) and `there is no fourth outcome`.

## Interpretation

This is a **measurement-quality finding, not an engine defect.** Nothing here shows the aggregation
is wrong. It shows that the property most load-bearing for the project's central open question is
supported by:

- **unit tests:** n ≤ 2 claims, CERTIFIED only at n = 1
- **benchmark:** 4 cases, all recorded-run, verdict paths 2 of 6 covered
- **replay:** 1 record (RQ-01)
- **real data:** 0 CERTIFIED outcomes in 4 drafts

The evidence that a 14-claim draft *would* certify if all 14 claims were clean is **the source code,
not a test**. That is a reasonable thing to believe — `certify.ts` returns CERTIFIED when both
buckets are empty, and bucket emptiness is claim-count independent — but it is inference from
reading, not measurement.

## Confidence

**High** for the counts: complete enumeration of 29 test blocks, cross-checked by reading the
verdict-asserting tests directly.

**One measurement artifact, stated:** the automated scan reported `n=0` for both CERTIFIED tests
because they pass a pre-built variable (`claims: [c]`) rather than an inline `claim(...)` call. Hand
reading confirms both use **exactly one claim**. The `0` bucket in the distribution therefore mixes
"no claims array" with "claims supplied via a variable"; the maximum of 2 and the absence of any
3+ test are unaffected, since those were counted the same way and verified by reading.

## Assumptions

- `src/test/argus.test.ts` is the only file testing `certify()`. Verified: the other test file is
  `llm-json.test.ts`, which tests JSON parsing.
- A test's claim count reflects the aggregation width it exercises.

## Threats to validity

- The scan is regex-based over source text. Mitigated by hand-verifying every verdict-asserting test.
- 182 total tests across the suite; only 29 are in `argus.test.ts`. The remainder test other modules
  and are not expected to exercise `certify()`.

## Alternative explanations

- *Aggregation is trivially claim-count independent, so testing at n = 1 is sufficient.* This is the
  strongest counter and it is largely right — `if (reject.length)` does not care how many claims
  produced the reasons. The residual risk is in `propagateFailure` and `validateGraph`, which **are**
  claim-count and topology dependent, and whose deepest test is 2 claims against observed dependency
  depths of up to 3.

## How to prove this wrong

Point to a test that asserts a verdict with ≥3 claims. None exists — the distribution above is
complete.

## What this does not license

**No test should be added.** The freeze prohibits it, and this document records a coverage
measurement, not a request. The finding's value is that it bounds how much the green suite can be
cited for regarding aggregation behaviour.
