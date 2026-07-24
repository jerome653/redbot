# Usability log — Phase 12

**Date:** 2026-07-23 · **Mode:** operator, not builder
**Rule for this phase:** record friction, do not fix it. **Nothing in this log was implemented.**

Severity is operational impact, not annoyance. Frequency is how often an operator meets it in normal
use. Cost is estimated implementation effort for the proposed fix.

---

## Summary

| # | Friction | Severity | Frequency | Fix cost |
|---|---|---|---|---|
| F-1 | Certification runs blind for 15–25+ minutes | **High** | every certification | Medium |
| F-2 | Certification cannot be started from the dashboard | Medium | every certification | Low |
| F-3 | A 10-minute timeout kills a valid certification | **High** | any wrapper/automation | Low |
| F-4 | The dashboard shows stale state during an in-flight run | Medium | every certification | Medium |
| F-5 | `expected_claims` is null in both corpus cases | Low | every corpus read | Low |
| F-6 | No way to see which drafts are uncertified | Medium | every session | Low |

**Only F-1 and F-3 appeared more than once and cost real time.** Under this phase's own rule — *do
not add features unless the same friction appears multiple times* — those two are the only candidates
that qualify, and F-3 is the only one whose fix is unambiguous.

---

## F-1 · Certification runs blind for 15–25+ minutes

**Severity: High · Frequency: every certification · Cost: Medium**

### What happened

`node dist/cli.js certify d_ac82fb88ec9d_mrvwodeo` printed its heading and then **nothing at all**
for over 35 minutes. No spinner, no claim counter, no stage line. I could not distinguish a working
run from a hung one without leaving the tool entirely.

To establish it was alive I had to:

1. `tail data/trace.jsonl` — which showed `argus.extract` at 92 s and `argus.claims` count 19, then
   silence.
2. Inspect the Windows process table and find `claude.exe -p --model claude-sonnet…` alive with
   near-zero CPU — i.e. blocked on model I/O.

That is three levels below the interface an operator is supposed to be using.

### Root cause

`certify` emits trace events at **stage boundaries only** — `argus.resolution`, `argus.extract`,
`argus.claims`, `argus.verdict`. The refutation loop between `argus.claims` and `argus.verdict` makes
one model call per claim and emits nothing until every claim is done. On a 19-claim draft that is a
single silent interval of 12–23 minutes, which is **85–95% of the run**.

### Proposed fix

**Do not change the engine.** A per-claim trace event would be the natural fix and is forbidden while
frozen — and it is not obviously worth unfreezing for.

Instead: the dashboard already reads `data/trace.jsonl`. Add a **"certification in flight"** panel
that detects a run whose `argus.claims` has fired without a matching `argus.verdict`, and shows the
draft, the claim count, elapsed time and the last event. That converts the silence into a visible
"running, 14 min elapsed, 19 claims" without touching frozen code.

**Cost: Medium.** One endpoint that groups trace by `runId` and finds incomplete gate runs, one panel.
No engine change, no new data source.

**Evidence:** observed on 1 of 1 certifications attempted this phase; the trace shows the same silent
interval on both historical runs (`82c9e2ba` 22.8 min, `e5a8e166` 12.4 min).

---

## F-2 · Certification cannot be started from the dashboard

**Severity: Medium · Frequency: every certification · Cost: Low**

### What happened

The dashboard is the intended operating surface, but `certify` is absent from the allowlist, so the
first real operator task of the phase required dropping to a terminal and hand-typing a draft ID
copied off the Certifications page.

### Root cause

Deliberate. `certify` spends model calls and writes evidence, so it was excluded when the allowlist
was drawn. **The exclusion is correct and should stay.**

### Proposed fix

Not "allow certify from the browser". A **certification queue** view: list drafts with no
certification record, and for each show a **copy-ready command**
(`node dist/cli.js certify <id>`) with a copy button. The operator still runs it in a terminal — the
dashboard stops being a dead end without becoming a trigger for expensive work.

**Cost: Low.** The data is already in `/api/dashboard` (drafts) and `/api/certifications`.

**Evidence:** 1 occurrence, but it is structural — it will occur on every certification forever.

---

## F-3 · A 10-minute timeout kills a valid certification

**Severity: High · Frequency: any wrapper or automation · Cost: Low**

### What happened

The first `certify` invocation was run with a 600-second timeout — a reasonable-looking default — and
was terminated while healthy. Measured runtimes are **14.9, 24.7 and >35 minutes**. A 10-minute
timeout is not merely tight; it is below the observed *minimum*.

### Root cause

No documented expected runtime for `certify` anywhere in the project. `doctor` does not report it,
the README does not state it, and until this phase nothing had timed it. Every tool author picks a
default in the dark.

### Proposed fix

Documentation, not code. State the measured range in `README.md` and in `RUNTIME-AUDIT.md`:
*"certify: 15–25+ minutes per draft; the refutation loop is 85–95% of it; do not wrap it in a timeout
below 45 minutes."*

**Cost: Low.** Two paragraphs. **Highest value-to-effort ratio in this log.**

**Evidence:** 2 occurrences — this tool's default timeout, and the wait-loop that followed it.

---

## F-4 · The dashboard shows stale state during an in-flight run

**Severity: Medium · Frequency: every certification · Cost: Medium**

Counts (`4 cert records`) stayed correct-but-stale for the whole run. Nothing was wrong, but nothing
indicated that a long operation was in progress either. Same root cause and same fix as **F-1** —
they should be treated as one item.

---

## F-5 · `expected_claims` is null in both corpus cases

**Severity: Low · Frequency: every corpus read · Cost: Low**

```
HRC-001   ground_truth.expected_claims : null   (argus observed 12, blocked_by says "3 of 12")
CERT-002  ground_truth.expected_claims : null   (argus observed 19, blocked_by says "0 of 19")
```

The dashboard falls back to `argus_observed.claims.length` and therefore displays the right numbers.
**But the fallback is silently load-bearing.** If the field were ever populated with a value that
disagreed with the observed count, the dashboard would prefer it without complaint.

This is a data-quality issue in the corpus files, not a display bug. Populating it is a corpus edit
and therefore frozen this phase.

**Evidence:** hit once, while extracting adjudicated claims — the script printed `3 of null`.

---

## F-6 · No way to see which drafts are uncertified

**Severity: Medium · Frequency: every session · Cost: Low**

Answering "what should I certify next?" required a Node one-liner joining `data/drafts.json` against
`data/certifications.jsonl`. The dashboard shows `12 drafts · 10 pending` and `4 records · 2 certified
drafts`, but never *which* drafts those are.

Same fix as **F-2** — the queue view answers both. Merge them.

---

## What did NOT cause friction

Worth recording, because it is the part that did not need work:

- **Reading a certification.** The Certifications page answered every question about the record —
  fired rules in order, the dependency graph, per-claim provenance — without once needing the raw
  JSONL.
- **The search box.** Filtering 49 rows to 7 on "wayback" was the fastest way to answer "what did it
  say about the Wayback claims".
- **Validation.** One click, six gates, 4.1 s, exit codes visible. No friction at all.
- **Empty states.** `reviews.jsonl` explaining *why* it is absent prevented a wasted investigation.
- **Ground Truth blockers as chips.** `blocked_by` rendered as chips answered "why is this not
  promoted" instantly.

---

## Recommendation

**Implement F-3 only.** It is documentation, it costs two paragraphs, and it prevents the exact
failure that wasted the first 10 minutes of this phase.

**F-1/F-4 and F-2/F-6 are each one item, not four**, and both are worth doing — but each has been
observed in a single session. Under this phase's own rule they should be seen again before being
built. They are recorded here so that the second occurrence is recognised as a second occurrence.
