# 10. Stop-building check

> **If RedBot had to remain exactly as it is for six months, what architectural decisions would
> we later regret?**

No optimism. No marketing. The honest answers, worst first.

---

## 1. That we built a certification engine before publishing anything

This is the one that would sting.

The system can read, rank, gap-analyse, score, draft, lint three ways, certify against atomic
claims with adversarial refutation and a dependency graph, gate on twenty conditions, and generate
thirteen reports. It has published **zero** replies.

Six months from now the regret is not that Argus exists — it is genuinely good, and E-32/E-33/E-34
show it independently finding a defect that human review found and three that human review missed.
The regret is that **its entire calibration is theoretical**. Every threshold was chosen against
imagination. We do not know Argus's false-positive rate, and a truth layer that quietly rejects
sound replies leaves no trace at all.

We optimised the judgement of contributions we never made.

## 2. That model self-assessment was designed in as an input, repeatedly

`fillable` (97% true). `alreadyAnswered` (missed an explicit UPDATE). `headroom` (disagreed with
its own gaps twice in sixteen). `evidenceClass` (declared `official-implementation` for a false
claim).

Four times the same mistake, each time patched individually — a deterministic backstop here, a
local recomputation there, Rule 8 for the last one. **The pattern was never addressed as a
pattern.** `fillable` is *still* read and still meaningless.

In six months the regret would be not having adopted one rule early: **ask a model for
observations, never for verdicts** — and audited every field against it in one pass.

## 3. That we kept two decision paths alive

`analyze` → `analysis.json` and `opportunity` → `assessments.json` both decide "is this thread
worth replying to". `gates.ts` accepts either. This already produced a defect where every thread
on the newer path was silently unpublishable.

Six months of both existing means drafts, gates and reports each reasoning about a different
answer to the same question. It will drift again, and the second time it will be harder to see.

## 4. That the evidence has no backup

Thirty-one proven observations, every defect trace, every telemetry event — in gitignored files on
one machine. The gitignore is correct and necessary. The absence of any alternative is not a
decision anyone made; it is a gap nobody closed.

Losing that directory would not cost code. It would cost **the entire justification for the
architecture** — and this project's defining property is that its design is traceable to observed
failures.

## 5. That the behaviour engine was built to a standard nothing validated

346 lines modelling dwell, scroll shape, abandonment, session budgets and seeded replay. Fifteen
tests. Zero live sessions. Reading speed is a provisional placeholder; every rate is declared.

If it turns out a person reads nothing like this, none of the tests would have told us. It is the
clearest example of engineering effort spent where no evidence was available to spend it against.

## 6. That "the model may decline" is an untested affordance

The Phase 3 draft contract permits the model to refuse. It has produced exactly one draft and
**zero declines**. A safety valve nobody has seen operate is a hypothesis with good documentation.

## 7. That report generation grew to 9% of the codebase

841 lines producing thirteen documents, read by one person, describing zero published
interactions. Defensible for an evidence campaign. In six months of stasis it is 841 lines of
maintenance surface documenting the same nothing.

---

## What we would *not* regret

Stated so the review is not merely pessimistic — these are the decisions that would hold.

- **Attach, never launch.** Removed the need for a device fleet, means redbot never handles a
  credential, and makes the session genuinely the operator's.
- **Ambiguity resolves to silence.** DEFECT-08 was a gate that failed open; every gate since fails
  closed, and unknown is never permission.
- **Mechanical over prompt.** Every fix that held was a check on a fact the model does not control.
  Every prompt revision that was tried did not hold.
- **Provenance tagging on operational limits.** One measured, seventeen declared, six provisional —
  visible on every run. It has repeatedly stopped a placeholder being quoted as a finding.
- **Two logs, deliberately separate.** The account record stayed clean enough to be trusted.
- **Honest output conventions.** `no data (0 samples)`, rates with denominators, proxies labelled
  as proxies. Each has caught something.
- **The human boundary.** Two independent layers refuse agent publication, one of them outside
  this project's own code.

---

## The uncomfortable summary

Six months of stasis would reveal that this project **built the hard half first**.

Deciding whether a contribution deserves to exist is genuinely difficult, and that part is done to
a standard well above what the problem has so far demanded. Publishing one reply and recording one
human verdict is trivially easy, and it is undone.

Every regret above traces to the same root: **we have a sophisticated instrument and no readings.**

The correct response is not more instrument.
