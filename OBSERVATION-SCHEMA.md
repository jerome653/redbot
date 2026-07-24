# The observation schema — frozen 2026-07-23, before the first publish

`data/interactions.jsonl` · contract in [`src/interactions.ts`](src/interactions.ts) ·
pinned by [`src/test/interactions.test.ts`](src/test/interactions.test.ts)

**Decided ahead of the evidence, deliberately.** Everything else in this project waits for
measurement. This does not, because of a pattern already hit three times:

| Lost, or nearly | How it was caught |
|---|---|
| Review timing | nothing timestamped the approval prompt — added before the first review, or the first review would have had no reading |
| The pre-edit draft body | `reply.ts` overwrote `draft.body` with the operator's edit and saved it; only two integers survived |
| Child-reply text | `observe` recorded a count, and a count cannot answer "was a correction posted?" |

A field added after the first ten interactions is a field that is **empty** for the first ten
interactions. Analytics can wait. Capture cannot.

---

## The governing principle

> ### Never invent an aggregate before collecting its raw observations.

No rate, score, trend or index is stored. Not helpful-contribution rate, not trust score, not
expertise score, not approval rate. Those are **derived later**, from these rows, when there are
enough rows to derive them honestly.

What is stored is what a browser rendered at a moment in time.

The corollary that makes it work: **an aggregate computed from stored rows can be recomputed when
the definition changes.** An aggregate stored directly cannot — and every definition here is
going to change at least once, because none of them has ever been tested against real data.

## Three rules the schema enforces

**1 · Append-only.** A row is never edited. A later checkpoint is a new row, so a comment's score
history is the sequence of rows rather than a mutated field. The history of an observation is
itself an observation.

**2 · Absent is `null`, and `null` is recorded.** Every key is always present.
`score: null` means *we looked and Reddit rendered nothing*. A missing key would mean *this
version of the code did not look*. Those are different facts, they are not recoverable from each
other afterwards, and the tests pin the distinction.

**3 · `humanLabel` is never written by a machine.** Whether a reply beneath ours was corrective,
supportive, neutral or moderation-related is a judgement. It stays `null` on every automated
path, forever. The Ground Truth Corpus rule applies here too: a model may not fill its own answer
key — and a model classifying the reaction to its own output is the HRC-001 failure one level up.

## What is captured

### At publish — `kind: "publish"`

Written after a confirmed publish, from the probe that ran immediately before the submit click.
**Thread state at publish is unrecoverable** the moment the reply lands and the counts move.

| Field | Why it cannot be reconstructed |
|---|---|
| `thread.postScore`, `thread.commentCount` | as rendered at the instant of publishing; both move immediately |
| `thread.locked`, `thread.archived` | state at the moment of the decision |
| `thread.ageHours` | derived at publish, not at collection — the two differ, and the stale one once let a ~95h thread publish as "70h" |
| `commentId`, `commentPermalink` | Reddit does not always expose them; captured when it does |
| `account` | which identity is permanently attached to these words |

`postScore` and `commentCount` were added to the existing pre-submit probe rather than to a new
page read. **No gate reads them** — the publish path is the least-exercised code in the project,
and a new gating input there would be a new way to fail.

### At each checkpoint — `kind: "checkpoint"`

One row **per vector**. `signed-in` and `signed-out` are never merged: *visible signed in,
invisible signed out* is the only signal that detects silent filtering, and collapsing the rows
destroys it.

| Field | Why it cannot be reconstructed |
|---|---|
| `self.present` | per vector; the pair is the filtering signal |
| `self.score` | a vote snapshot; the sequence across rows is the vote history |
| `self.removalNotice` | Reddit's own wording, verbatim |
| `replies[].body` | **verbatim, untruncated.** A deleted comment leaves the page — this is the only durable copy |
| `replies[].renderedAge` | Reddit's own relative string, e.g. `"3 hr. ago"`. Kept as displayed rather than converted, because converting claims a precision the page does not offer |
| `replies[].timestamp` | the machine-readable form when the markup carries one; `null` is common and expected |
| `replies[].author`, `byOriginalPoster`, `byUs` | the asker replying is not the same event as a bystander replying |
| `replies[].distinguished` | Reddit marks moderator and admin comments |

## What is deliberately NOT captured

- **Any rate, score or trend.** See the principle.
- **Reddit's Contributor Quality Score.** Not exposed on any public surface. A field for it would
  be filled with a guess.
- **Achievements, contributor status.** Same reason, pending evidence they are readable.
- **Account age.** `probe-karma` returned `null` for `cakeDay`/`joined` on its one real run —
  account age is currently *unmeasured*, not merely unrecorded. Adding a field would imply a
  capability that does not exist.
- **Any classification of a reply's tone or intent.** `humanLabel`, human-only, null until a
  person fills it.

## Sequencing this belongs to

| Phase | What happens |
|---|---|
| **Now — before the first publish** | Freeze the schema. Ensure no irrecoverable fact is lost. **Build no analytics.** |
| **After 10–20 interactions** | Validate whether the schema captured enough. Add derived metrics *only* where one answers an existing evidence-backlog item |
| **After 100+ interactions** | Build Reputation Intelligence as an analytics layer over these immutable rows |

Reputation Intelligence itself is **PARKED** — dashboards, trust scores, trend analysis,
expertise drift and community ledgers all require data that does not exist. Its charter, when it
is built: *measure, never optimize.* It may never fabricate identities, simulate personalities,
schedule artificial inactivity, or optimize for looking human.

## Declared vs demonstrated competence

These are separate forever, and this schema is what will eventually separate them.

Today `config.expertise` **declares** competence — a vocabulary list, checked by
`competence.ts` against a thread's own words. It is a proxy and is labelled as one everywhere it
surfaces.

**Demonstrated** competence does not exist yet: it requires contributions with recorded outcomes,
which is what these rows accumulate. A configuration file saying *this account knows WordPress*
must never silently become *this account has demonstrated WordPress expertise*. **Only evidence
may promote one into the other**, and the promotion must be as explicit as the AGTC gate that
promotes a case from pending to approved.
