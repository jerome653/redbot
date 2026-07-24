# RQ-03 — Is the pipeline deterministic when the same draft is certified three times?

**Open Research · 2026-07-23 · ENGINE FILES MODIFIED: 0**

**Question:** Records 0, 1 and 2 all carry `draftId: d_f11d8de68709_mrwj1koh`. Records 0 and 1
extracted **zero** claims; record 2 extracted **twelve**. Is that non-determinism?

This is a free natural experiment — the only repeated draft in the corpus — and nobody had examined it.

---

## Hypothesis

*H:* the pipeline is non-deterministic — the same draft produced different claim counts across runs.
**A confirmed non-determinism would undermine every distribution in Phases 14–15**, which pool claims
across records as if each were an independent observation.

## Method

Compared all three records field by field, then traced the divergence to source.

## Finding — hypothesis FALSIFIED

| | #0 | #1 | #2 |
|---|---|---|---|
| `certifiedAt` | 20:55:02 | 21:10:15 | 21:19:56 |
| `model` | claude-haiku-4-5 | claude-haiku-4-5 | claude-haiku-4-5 |
| `resolution.resolved` | **true** | **true** | **true** |
| `resolution.signals` | 4 | 4 | 4 |
| Signals byte-identical | — | ✅ vs #0 | ✅ vs #0 |
| Rules fired | `thread-resolved` | `thread-resolved` | `fatal-contradiction`, `overconfident-language` |
| Claims | 0 | 0 | **12** |

The resolution block is **identical across all three** — same four signals, same detail string. The
divergence is not in what the pipeline observed.

Source of the difference, `src/argus/certify.ts:70`:

```js
if (resolution.resolved && !input.humanOverride) {
  reject.push({ rule: 'thread-resolved', ... });
}
```

and `src/argus/pipeline.ts:165`:

```js
...(opts.override ? { humanOverride: true } : {})
```

**Record 2 was run with `--override`.** The operator explicitly instructed the pipeline to continue
past a correct resolved-thread rejection, in order to see what the certification layer would say.

**This is documented, intentional behaviour, not non-determinism.** The pipeline is deterministic
given its inputs; the third run had a different input flag.

## The finding that replaces it

Record 2 exists **only because a human overrode a correct pre-filter rejection.**

That matters for corpus composition, and no prior document states it:

| | records | drafts |
|---|---|---|
| Total | 6 | 4 |
| Rejected by pre-filter (`thread-resolved`) | 2 | 1 |
| **Reached the certifier naturally** | 3 | **3** |
| Reached the certifier via human override | 1 | 1 |

Phases 14 and 15 analysed **4 substantive drafts**. One of those four
(`d_f11d8de68709`, 12 claims, 16 fatal contradictions — the *highest* fatal density in the corpus)
would never have been certified without an operator override.

The naturally-occurring corpus is **3 drafts, 45 claims**, not 4 drafts and 57.

## Effect on prior conclusions

Recomputing the headline per-claim clean rate without record 2:

| Population | claims | clean | rate |
|---|---|---|---|
| All substantive records (Phases 14–15) | 57 | 15 | **26.3 %** |
| Excluding the override record | 45 | 11 | **24.4 %** |

A 1.9-point shift. **The Phase 14/15 conclusions are unaffected in direction or magnitude** —
P(CERTIFIED) at n = 14 moves from 7.6 × 10⁻⁹ to 2.8 × 10⁻⁹, which is the same answer.

## Confidence

**High** that this is not non-determinism — traced to a specific conditional and a specific CLI flag.
**High** for the corpus-composition counts.
**Medium** for the significance of the 1.9-point shift, since n is small either way.

## Assumptions

- `--override` is the only route to `humanOverride: true`. Verified by grep: three occurrences in
  `src/`, one of which is a test.
- The three records concern the same underlying thread. Confirmed by identical `resolution.signals`.

## Threats to validity

- Records 0 and 1 are themselves near-duplicates 15 minutes apart, both `thread-resolved`. They tell
  us the pre-filter is stable, and nothing else.
- This tests determinism of the *verdict layer* given recorded observations. It does **not** test
  whether extraction/refutation would produce the same claims if re-run — that would require running
  `certify` again, which costs 15–27 minutes and writes new evidence.

## Alternative explanations

- *The claim count differs because of model sampling variance.* Ruled out: records 0 and 1 never
  reached extraction, so there is no extraction output to compare. The comparison is
  "extraction did not run" versus "extraction ran", not "two extractions disagreed".

## How to prove this wrong

Re-run `certify --override` on `d_f11d8de68709` and compare the claim set to record 2. If the claims
differ materially, extraction is non-deterministic and the pooling assumption in Phases 14–15 needs
revisiting. **This experiment has not been run** — it costs one certification cycle and would be the
cheapest available test of extraction stability.
