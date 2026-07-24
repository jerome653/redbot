# Operator Review Dataset

**Generated:** 2026-07-23 · **Records:** 0 · **File:** `data/reviews.jsonl` (gitignored)

Every decision made at the approval prompt, with a structured reason. One JSON object per
line, appended, never rewritten.

## Why it exists

1. It turns "the drafts are pretty good" into a number with a denominator.
2. Rejection codes indict a specific stage — a run of `already-covered` is a gap-analyzer
   problem, `inaccurate` is a drafting-prompt problem, `tone` is a craft-gate problem.
3. It is the only way to re-fit the thresholds that are currently **declared rather than
   measured** — the novelty overlap floor (70%) and the triage confidence floor — against
   real human judgement.

## Schema

| Field | Meaning |
|---|---|
| `ts` | when the decision was made |
| `draftId` / `threadId` / `permalink` | what was being judged |
| `decision` | `approved` · `edited` · `rejected` |
| `reasonCode` | one of the fixed vocabularies below |
| `note` | operator's free text, may be empty |
| `operator` | the signed-in Reddit account at decision time |
| `edit` | chars before/after and the share of content words retained |
| `quality` | craft metrics snapshot **at decision time** |
| `gates` | which gates passed, and which blocked |
| `novelty` | overlap against the thread's existing claims |
| `contribution` | the case the draft made for itself |

Snapshots are taken at decision time on purpose: changing a threshold later must not silently
rewrite the history of what a person was actually looking at.

## Counts

| | |
|---|---|
| Total decisions | 0 |
| Approved | 0 |
| Edited then approved | 0 |
| Rejected | 0 |

### Rejection reasons

| Code | Meaning | Recorded |
|---|---|---|
| `inaccurate` | technically wrong, or would not do what it says | 0 |
| `already-covered` | the thread already says this | 0 |
| `not-confident` | cannot tell whether it is right | 0 |
| `off-topic` | does not answer what was asked | 0 |
| `adds-nothing` | correct but not worth posting | 0 |
| `tone` | wrong register for the room | 0 |
| `too-long` | padded, or longer than the answer needs | 0 |
| `unsafe` | would expose the operator or the employer | 0 |
| `other` | something else — say what in the note | 0 |

### Edit reasons

| Code | Meaning | Recorded |
|---|---|---|
| `tightened` | cut length without changing the substance | 0 |
| `corrected-fact` | fixed something wrong | 0 |
| `added-specifics` | added a detail the draft was missing | 0 |
| `removed-filler` | stripped padding or a stock phrase | 0 |
| `tone` | adjusted register | 0 |
| `restructured` | same content, better order | 0 |
| `other` | something else — say what in the note | 0 |

### Approval reasons

| Code | Meaning | Recorded |
|---|---|---|
| `as-written` | publishable exactly as generated | 0 |
| `minor-nits` | good enough to post, with reservations noted | 0 |

## Status

**The dataset is empty.** The capture path is built and wired into `redbot reply`,
but no draft has been decided at the Phase 3 prompt. Every rate derived from it is therefore
`no data (0 samples)`, and is reported that way rather than omitted.
