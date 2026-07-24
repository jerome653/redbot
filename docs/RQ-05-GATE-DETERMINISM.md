# RQ-05 — Are the validation gates actually reproducible?

**Open Research · 2026-07-23 · ENGINE FILES MODIFIED: 0**

**Question:** Every phase report cites `benchmark exit 0 · corpus exit 0 · replay exit 0`. Exit codes
prove the gates *ran*, not that they produce the *same* result. Reproducibility had been assumed, not
measured, in every prior phase.

---

## Hypothesis

*H:* the gates are deterministic — repeated runs on unchanged inputs produce byte-identical output.

A failure here would be serious: it would mean every "unchanged" claim in Phases 9–15 rests on a
comparison that could drift.

## Method

Ran each gate three consecutive times with no intervening changes. Hashed the artefact
(`last-run.json`) for the benchmark, and full stdout for replay and corpus validation.

## Finding — hypothesis SUPPORTED

| Gate | Artefact hashed | Run 1 | Run 2 | Run 3 |
|---|---|---|---|---|
| Benchmark | `qa/benchmark/last-run.json` | `7aec0694f8c894c0` | `7aec0694f8c894c0` | `7aec0694f8c894c0` |
| Replay (ARE-001) | full stdout | `d4af53a25a5b1888` | `d4af53a25a5b1888` | `d4af53a25a5b1888` |
| Corpus validation | full stdout | `de99ca3409e5de1a` | `de99ca3409e5de1a` | `de99ca3409e5de1a` |

**All three gates are byte-identical across repeated runs.** SHA-256, first 16 hex characters shown.

This independently confirms the narrower check made in Phases 11 and 13, where `last-run.json` was
copied and diffed after a re-run. That established the benchmark writes stable bytes; this
establishes that **replay and corpus validation also produce stable output**, which had never been
tested.

## Why determinism is expected here

`qa/benchmark/run.mjs` and `qa/ARE-001-argus-replay.mjs` both operate on **recorded** observations —
they replay stored claims and contradictions through the verdict layer. `certify.ts:14` states the
property directly: *"Deterministic: the same claim set always yields the same verdict."*

No model call occurs in any of the three gates. Determinism is the design, and the measurement
confirms the design holds in practice.

## What this does NOT establish

**The certification pipeline as a whole is not covered by this result.** `certify` calls a language
model for extraction and refutation; those calls are not deterministic and are not exercised by any
gate. The gates test the deterministic *tail* of the pipeline.

| Layer | Deterministic? | Covered by a gate? |
|---|---|---|
| Extraction (model) | **unknown** | no |
| Refutation (model) | **unknown** | no |
| Epistemic analysis (model) | **unknown** | no |
| Verdict rules | **yes — measured** | yes |
| Dependency propagation | **yes — measured** | yes |

The three green gates certify one of five layers.

## Confidence

**High** for the claim tested — three identical hashes per gate, complete artefacts, no sampling.

**Low** for any extrapolation to the model-dependent layers, which this measurement says nothing
about. RQ-03 identifies the experiment that would test extraction stability; it has not been run.

## Assumptions

- Three runs is sufficient to detect gross non-determinism. It would not detect rare intermittent
  divergence — a 1-in-100 flake would very likely be missed.
- No input changed between runs. Verified: the gates read only committed corpus files, and
  `git status` on the engine directories showed no changes.

## Threats to validity

- **n = 3 runs.** A low-frequency source of non-determinism (timestamp granularity, hash-map
  iteration order under memory pressure) would not surface.
- Same machine, same Node version (v24.11.0), same session. Cross-platform determinism is untested,
  and `.gitattributes` in the extracted repository documents mixed line endings — a plausible source
  of cross-platform divergence in stdout hashing.

## Alternative explanations

- *The hashes match because the gates cache.* Ruled out: `last-run.json` mtime advanced on each run,
  and the benchmark rewrote the file with identical content.

## How to prove this wrong

Run any gate 100 times and hash each result; or run on a different OS and compare. A single divergent
hash falsifies determinism. Neither has been done.
