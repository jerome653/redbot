# Provenance audit

**Phase 14 · 2026-07-23 · ENGINE FILES MODIFIED: 0**
Source: `evidenceClass` on all 57 claims in `data/certifications.jsonl`; human expectations from
`ground-truth/cases/HRC-001/case.json`.

---

## Declared provenance — all 57 claims

| Evidence class | count | share | engine treatment |
|---|---|---|---|
| `reasoned-inference` | 16 | 28.1 % | non-authoritative |
| `operator-experience` | 12 | 21.1 % | non-authoritative |
| `widely-accepted-practice` | 10 | 17.5 % | non-authoritative |
| `framework-documentation` | 9 | 15.8 % | **authoritative** |
| `observed-runtime-behaviour` | 3 | 5.3 % | **authoritative** |
| `unknown` | 3 | 5.3 % | **no provenance → REJECT** |
| `community-knowledge` | 2 | 3.5 % | non-authoritative |
| `primary-documentation` | 1 | 1.8 % | **authoritative** |
| `official-implementation` | 1 | 1.8 % | **authoritative** |

Grouped, using the sets in `src/argus/types.ts`:

| Band | count | share |
|---|---|---|
| **Authoritative** — `primary-documentation`, `official-implementation`, `language-specification`, `framework-documentation`, `source-code`, `observed-runtime-behaviour` | **14** | **24.6 %** |
| **Weak but declared** — `reasoned-inference`, `operator-experience`, `widely-accepted-practice`, `community-knowledge` | **40** | **70.2 %** |
| **No provenance** — `unknown`, `unsupported` | **3** | **5.3 %** |

Three-quarters of every claim this engine has ever assessed rests on evidence it does not treat as
authoritative. `no-provenance` — the reject-class rule — catches only the 5.3 % that declare nothing
at all.

---

## Inflation, measured against the only human labels that exist

Three claims in HRC-001 carry a human ruling. All three were adjudicated `truth: false`, with an
expected provenance of `reasoned-inference`.

| Claim | Human expected | Argus declared | Band shift |
|---|---|---|---|
| c5 | `reasoned-inference` | `observed-runtime-behaviour` | weak → **authoritative** |
| c6 | `reasoned-inference` | `primary-documentation` | weak → **authoritative** |
| c7 | `reasoned-inference` | `official-implementation` | weak → **authoritative** |

**Provenance accuracy: 0 / 3. Every error is in the same direction — inflation, and inflation across
the band boundary.**

Not one of the three was merely mislabelled within the weak band. All three were promoted from
"someone reasoned about it" to "a primary source says so".

The benchmark reports the same shape independently at larger n: `provenance_correct: 0` of
`provenance_declared: 9` in `qa/benchmark/last-run.json`.

---

## Why this matters more than the count suggests

Provenance is not descriptive metadata. Three rules read it directly:

| Rule | reads provenance | class |
|---|---|---|
| `no-provenance` | fires when `evidenceClass ∈ {unknown, unsupported}` | REJECT |
| `falsifiable-claim-weak-evidence` | fires when a falsifiable claim lacks authoritative backing | ESCALATE |
| `unrefuted-falsifiable-claim` | detail text cites the self-declared class | ESCALATE |

Inflation therefore **suppresses** rules rather than triggering them. A claim that should read
`reasoned-inference` but declares `primary-documentation` escapes
`falsifiable-claim-weak-evidence` entirely.

**The direction of the error makes the engine more permissive, not less.** On the three labelled
claims, inflation would have hidden weak evidence — and the drafts were rejected anyway, on
contradictions. That is the definition of reaching the right verdict for the wrong reasons, which is
one of the two admissible grounds for unfreezing under `ENGINE-FREEZE.md`.

---

## The self-declaration problem

Provenance is asserted by the same extraction pass that produces the claim. Nothing verifies it.
`certify.ts:184` says so in its own rule text: *"its provenance … is self-declared and unchecked"*.

The 24.6 % authoritative share should be read as **"24.6 % of claims asserted that they had
authoritative backing"** — not as a measurement that they do. Citation-fidelity checking, done by
hand in an earlier phase on 13 Tier-1 contradictions, found only 4 fully faithful citations against 4
partial and 4 unsupported. There is no reason to assume claim provenance is more reliable than
contradiction provenance, and one measured reason (0/3) to think it is worse.

---

## What cannot be concluded

- **An inflation *rate* cannot be computed.** 3 labelled claims out of 57 is 5.3 % coverage. The
  observed rate is 100 %, and 100 % of three is not a rate.
- **No claim has been labelled where Argus declared weak provenance.** Every labelled example is one
  where Argus over-claimed. Whether it ever *under*-claims is entirely unmeasured.
- **Direction is better evidenced than magnitude.** Three independent inflations, all crossing the
  authoritative boundary, plus a benchmark counter reading 0/9, is a consistent signal. How large the
  effect is across a real corpus is unknown.

**What would settle it:** provenance labels on claims from a draft whose evidence is genuinely mixed —
some authoritative, some inferred — so that both over- and under-declaration can be observed.
