# redbot → dashboard API — build specification

**For the engineer building the receiving API.** Everything here was measured against a live
redbot database on 2026-07-30; field names, types, row counts and example payloads are real,
not illustrative. Where a table is still empty the field list comes from the schema and the
example is omitted rather than invented — those rows are marked.

redbot is a Windows desktop app that runs on an operator's own machine. It holds a local
SQLite database and **pushes events outward**. It never accepts an inbound connection, so
nothing you build will ever call it. You receive, you store, you serve a dashboard.

---

## 1. Endpoints to build

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v2/events/{stream}` | Ingest one batch of events for one stream |
| `GET` | `/v2/accounts` | Serve the shared account list to an authorised machine |
| `POST` | `/v2/accounts` | Receive the owner machine's account list |
| `GET` | `/v2/health` | Liveness, unauthenticated |

`{stream}` is one of the 12 names in §5. One stream per request —
do not accept mixed batches, because partial failure then becomes ambiguous.

---

## 2. Authentication

Two separate tokens with different powers. **Do not collapse them into one.**

| Token | Used on | Power | If leaked |
|---|---|---|---|
| Ingest token | `POST /v2/events/*`, `POST /v2/accounts` | Write, for one install | Someone posts fake numbers |
| Share token | `GET /v2/accounts` | Read the account list | Someone learns account descriptions |

Both travel as `Authorization: Bearer <token>`.

- **Never accept a token in a query string.** It lands in access logs and browser history.
- **Store hashes, not tokens.** Keep `sha256(token)` so a database leak is not a set of live
  credentials.
- **Share tokens must be revocable and expiring.** They are the ones that leave the owner's
  machines — that is their entire purpose.
- Reject with `401` on a bad or missing token, `403` when the token is valid but not entitled
  to that install.

---

## 3. The envelope

Every request to `POST /v2/events/{stream}` has this shape. `events` is an array so a backfill
can be paged; a live push usually carries one.

```json
{
  "v": 1,
  "installId": "c04d3c63-6444-4b48-bf0d-f2f1d0f902fd",
  "machine": "Dan",
  "stream": "thread",
  "sentAt": "2026-07-30T15:04:00.000Z",
  "events": [
    {
      "op": "upsert",
      "cursor": {
        "updated_at": "2026-07-29T14:44:15.969Z",
        "id": "ff9ba5fd7184"
      },
      "data": {
        "…": "the stream payload from §5"
      }
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `v` | integer | Envelope version. Reject anything you do not recognise with `400`. |
| `installId` | string (UUID) | **Which install.** The partition key for everything you store. |
| `machine` | string | Display label only, 1–64 chars. It is a hostname — treat as personal data. |
| `stream` | string | Must equal the `{stream}` in the path, or `400`. |
| `sentAt` | ISO-8601 UTC | When the batch was sent. The operator's clock — record your own receive time too. |
| `events[].op` | `insert` \| `upsert` | Per §5. There is no `delete`. |
| `events[].cursor` | object | Position in the stream. **Part of the idempotency key.** |
| `events[].data` | object | The payload, per §5. |

### Idempotency — the one rule you cannot skip

```
UNIQUE (install_id, stream, cursor_json)
```

**Upsert on that key.** Delivery is at-least-once: redbot retries on timeout, so the same
event will arrive twice. Without this constraint every network hiccup double-counts.

---

## 4. Storage requirements

**Tolerate references you have not seen yet.** Streams advance independently, so a `draft`
event can arrive before the `thread` it points at. Store it and resolve later. Do **not**
reject on a missing foreign key — you will drop real data during any backfill.

**Several fields are JSON held in TEXT.** They arrive as strings and must be parsed, not
displayed raw:

```
  draft.novelty_issues
  draft.lint_issues
  certification.refutation_ran
  review.quality
  review.gates
  review.novelty
  review.contribution
  decision.observed
  interaction.vector
  observation.vector
  observation.value
  activity.data
```

**Booleans arrive as `0` / `1`.** SQLite has no boolean type — `fatal`, `confirmed`,
`has_disclosure`, `fillable`, `resolution_resolved`, `already_answered` are integers.

**Timestamps are ISO-8601 UTC strings** with milliseconds, e.g. `2026-07-29T14:44:15.969Z`.
They sort correctly as strings.

**Ids are opaque strings, not integers,** except where §5 says INTEGER. `thread_id` looks like
`ff9ba5fd7184`; `draft_id` like `d_e3f85c727608_ms644wlu`.

---

## 5. The streams

`op: upsert` means the row changes after creation — store the latest per cursor key.
`op: insert` means append-only.

### `thread` — `POST /v2/events/thread`

**op:** `upsert`  ·  **cursor:** `updated_at, id`  ·  **all-time volume on the reference database:** 116 events

| Field | Type |
|---|---|
| `id` | TEXT |
| `subreddit` | TEXT |
| `upvotes` | INTEGER |
| `comment_count` | INTEGER |
| `age_minutes` | INTEGER |
| `source` | TEXT |
| `query` | TEXT |
| `collected_at` | TEXT |
| `created_at` | TEXT |
| `updated_at` | TEXT |

```json
{
  "id": "ff9ba5fd7184",
  "subreddit": "NoStupidQuestions",
  "upvotes": 62,
  "comment_count": 81,
  "age_minutes": 151,
  "source": "read",
  "collected_at": "2026-07-29T14:42:42.037Z",
  "created_at": "2026-07-29T14:44:15.969Z",
  "updated_at": "2026-07-29T14:44:15.969Z"
}
```

*Withheld by the sender and never transmitted:* `permalink`, `title`, `author`, `age_text`, `body`

### `thread_screened` — `POST /v2/events/thread_screened`

**op:** `upsert`  ·  **cursor:** `updated_at, thread_id`  ·  **all-time volume on the reference database:** 87 events

| Field | Type |
|---|---|
| `thread_id` | TEXT |
| `kind` | TEXT |
| `checked_at` | TEXT |
| `created_at` | TEXT |
| `updated_at` | TEXT |

```json
{
  "thread_id": "ff9ba5fd7184",
  "kind": "outside-pilot",
  "checked_at": "2026-07-29T15:50:36.047Z",
  "created_at": "2026-07-29T15:50:36.047Z",
  "updated_at": "2026-07-29T15:50:36.047Z"
}
```

*Withheld by the sender and never transmitted:* `detail`

### `assessment` — `POST /v2/events/assessment`

**op:** `upsert`  ·  **cursor:** `updated_at, thread_id`  ·  **all-time volume on the reference database:** 30 events

| Field | Type |
|---|---|
| `thread_id` | TEXT |
| `verdict` | TEXT |
| `score` | INTEGER |
| `assessed_at` | TEXT |
| `created_at` | TEXT |
| `updated_at` | TEXT |

```json
{
  "thread_id": "fee0044a496c",
  "verdict": "contribute",
  "score": 100,
  "assessed_at": "2026-07-29T15:50:36.181Z",
  "created_at": "2026-07-28T12:38:52.674Z",
  "updated_at": "2026-07-29T15:50:36.369Z"
}
```

*Withheld by the sender and never transmitted:* `permalink`, `title`, `thesis_why_thread`, `thesis_what_new`, `thesis_why_not_silent`, `reasons`

### `gap_analysis` — `POST /v2/events/gap_analysis`

**op:** `upsert`  ·  **cursor:** `updated_at, thread_id`  ·  **all-time volume on the reference database:** 30 events
  ·  **carries nested:** `gaps`

| Field | Type |
|---|---|
| `thread_id` | TEXT |
| `already_answered` | INTEGER |
| `headroom` | INTEGER |
| `analyzed_at` | TEXT |
| `model` | TEXT |
| `created_at` | TEXT |
| `updated_at` | TEXT |

```json
{
  "thread_id": "0caf8656cde9",
  "already_answered": 0,
  "headroom": 75,
  "analyzed_at": "2026-07-29T12:31:30.511Z",
  "model": "claude-haiku-4-5-20251001",
  "created_at": "2026-07-29T12:31:30.526Z",
  "updated_at": "2026-07-29T12:31:30.560Z",
  "gaps": [
    {
      "position": 0,
      "kind": "unverified",
      "fillable": 1
    },
    {
      "position": 1,
      "kind": "partial",
      "fillable": 1
    }
  ]
}
```

*Withheld by the sender and never transmitted:* `permalink`, `title`, `question`, `covered`

### `draft` — `POST /v2/events/draft`

**op:** `upsert`  ·  **cursor:** `updated_at, id`  ·  **all-time volume on the reference database:** 3 events

| Field | Type |
|---|---|
| `id` | TEXT |
| `thread_id` | TEXT |
| `account` | TEXT |
| `status` | TEXT |
| `model` | TEXT |
| `has_disclosure` | INTEGER |
| `novelty_issues` | TEXT |
| `lint_issues` | TEXT |
| `cert_verdict` | TEXT |
| `cert_at` | TEXT |
| `cert_claims` | INTEGER |
| `cert_fatal_contradictions` | INTEGER |
| `created_at` | TEXT |
| `decided_at` | TEXT |
| `updated_at` | TEXT |

```json
{
  "id": "d_e3f85c727608_ms644wlu",
  "thread_id": "e3f85c727608",
  "account": "Quirky_Owl_8028",
  "status": "pending",
  "model": "claude-sonnet-5",
  "has_disclosure": 0,
  "novelty_issues": "[]",
  "lint_issues": "[]",
  "cert_verdict": "REJECT",
  "cert_at": "2026-07-29T13:28:39.814Z",
  "cert_claims": 7,
  "cert_fatal_contradictions": 6,
  "created_at": "2026-07-29T13:20:59.922Z",
  "updated_at": "2026-07-29T13:28:39.949Z"
}
```

*Withheld by the sender and never transmitted:* `permalink`, `title`, `body`, `contribution_why_thread`, `contribution_what_new`, `contribution_why_not_silent`, `published_url`, `comment_permalink`, `comment_id`

### `certification` — `POST /v2/events/certification`

**op:** `insert`  ·  **cursor:** `id`  ·  **all-time volume on the reference database:** 3 events
  ·  **carries nested:** `claims`, `reasons`, `contradictions`, `epistemicIssues`

| Field | Type |
|---|---|
| `id` | INTEGER |
| `draft_id` | TEXT |
| `thread_id` | TEXT |
| `verdict` | TEXT |
| `certified_at` | TEXT |
| `model` | TEXT |
| `model_analyze` | TEXT |
| `model_draft` | TEXT |
| `resolution_resolved` | INTEGER |
| `refutation_ran` | TEXT |
| `created_at` | TEXT |

```json
{
  "id": 3,
  "draft_id": "d_e3f85c727608_ms644wlu",
  "thread_id": "e3f85c727608",
  "verdict": "REJECT",
  "certified_at": "2026-07-29T13:28:39.814Z",
  "model": "claude-haiku-4-5-20251001",
  "model_analyze": "claude-haiku-4-5-20251001",
  "model_draft": "claude-sonnet-5",
  "resolution_resolved": 0,
  "refutation_ran": "[\"c1\",\"c2\",\"c3\",\"c5\",\"c6\",\"c7\"]",
  "created_at": "2026-07-29T13:28:39.835Z",
  "claims": [
    {
      "claim_id": "c1",
      "type": "platform-behaviour",
      "evidence_class": "primary-documentation",
      "confidence": "high"
    },
    {
      "claim_id": "c2",
      "type": "inference",
      "evidence_class": "reasoned-inference",
      "confidence": "high"
    }
  ],
  "reasons": [
    {
      "rule": "fatal-contradiction",
      "claim_id": "c3"
    },
    {
      "rule": "fatal-contradiction",
      "claim_id": "c6"
    }
  ],
  "contradictions": [
    {
      "claim_id": "c1",
      "kind": "configuration-dependency",
      "evidence_class": "community-knowledge",
      "fatal": 1
    },
    {
      "claim_id": "c1",
      "kind": "edge-case",
      "evidence_class": "reasoned-inference",
      "fatal": 0
    }
  ],
  "epistemicIssues": [
    {
      "claim_id": "c2",
      "language_certainty": "asserted",
      "supported_certainty": "medium"
    },
    {
      "claim_id": "c3",
      "language_certainty": "asserted",
      "supported_certainty": "medium"
    }
  ]
}
```

*Withheld by the sender and never transmitted:* `resolution_detail`, `citations`

### `review` — `POST /v2/events/review`

**op:** `insert`  ·  **cursor:** `id`  ·  **all-time volume on the reference database:** 0 events

| Field | Type |
|---|---|
| `id` | INTEGER |
| `ts` | TEXT |
| `draft_id` | TEXT |
| `thread_id` | TEXT |
| `decision` | TEXT |
| `reason_code` | TEXT |
| `operator` | TEXT |
| `review_seconds` | INTEGER |
| `total_seconds` | INTEGER |
| `edit_chars_before` | INTEGER |
| `edit_chars_after` | INTEGER |
| `edit_retained` | REAL |
| `quality` | TEXT |
| `gates` | TEXT |
| `novelty` | TEXT |
| `contribution` | TEXT |

> **No rows in the reference database yet.** The field list above comes from the schema and
> is reliable; no example is shown because none was captured. Expect this stream to stay
> empty until the operator publishes a reply.

*Withheld by the sender and never transmitted:* `permalink`, `note`, `edit_before`, `edit_after`

### `decision` — `POST /v2/events/decision`

**op:** `insert`  ·  **cursor:** `id`  ·  **all-time volume on the reference database:** 0 events

| Field | Type |
|---|---|
| `id` | INTEGER |
| `ts` | TEXT |
| `action` | TEXT |
| `account` | TEXT |
| `job_id` | TEXT |
| `confirmed` | INTEGER |
| `source` | TEXT |
| `observed` | TEXT |
| `visibility` | TEXT |
| `ms` | INTEGER |

> **No rows in the reference database yet.** The field list above comes from the schema and
> is reliable; no example is shown because none was captured. Expect this stream to stay
> empty until the operator publishes a reply.

*Withheld by the sender and never transmitted:* `permalink`, `error`

### `interaction` — `POST /v2/events/interaction`

**op:** `insert`  ·  **cursor:** `id`  ·  **all-time volume on the reference database:** 0 events

| Field | Type |
|---|---|
| `id` | INTEGER |
| `schema_version` | TEXT |
| `ts` | TEXT |
| `kind` | TEXT |
| `draft_id` | TEXT |
| `thread_id` | TEXT |
| `account` | TEXT |
| `checkpoint` | TEXT |
| `elapsed_minutes` | REAL |
| `vector` | TEXT |

> **No rows in the reference database yet.** The field list above comes from the schema and
> is reliable; no example is shown because none was captured. Expect this stream to stay
> empty until the operator publishes a reply.

*Withheld by the sender and never transmitted:* `permalink`, `comment_permalink`, `comment_id`, `thread`, `self`, `replies`, `note`

### `observation` — `POST /v2/events/observation`

**op:** `insert`  ·  **cursor:** `id`  ·  **all-time volume on the reference database:** 4 events

| Field | Type |
|---|---|
| `id` | INTEGER |
| `ts` | TEXT |
| `account` | TEXT |
| `kind` | TEXT |
| `vector` | TEXT |
| `checkpoint` | TEXT |
| `value` | TEXT |

```json
{
  "id": 4,
  "ts": "2026-07-29T07:32:25.313Z",
  "account": "Quirky_Owl_8028",
  "kind": "karma",
  "vector": "signed-in",
  "value": "1"
}
```

*Withheld by the sender and never transmitted:* `permalink`, `note`

### `regret` — `POST /v2/events/regret`

**op:** `insert`  ·  **cursor:** `id`  ·  **all-time volume on the reference database:** 0 events

| Field | Type |
|---|---|
| `id` | INTEGER |
| `ts` | TEXT |
| `draft_id` | TEXT |
| `thread_id` | TEXT |
| `kind` | TEXT |
| `category` | TEXT |
| `hours_after_publish` | REAL |
| `operator` | TEXT |

> **No rows in the reference database yet.** The field list above comes from the schema and
> is reliable; no example is shown because none was captured. Expect this stream to stay
> empty until the operator publishes a reply.

*Withheld by the sender and never transmitted:* `permalink`, `answer`, `lessons`

### `activity` — `POST /v2/events/activity`

**op:** `insert`  ·  **cursor:** `id`  ·  **all-time volume on the reference database:** 51 events

| Field | Type |
|---|---|
| `id` | INTEGER |
| `ts` | TEXT |
| `kind` | TEXT |
| `account` | TEXT |
| `subreddit` | TEXT |
| `status` | TEXT |
| `data` | TEXT |

```json
{
  "id": 52,
  "ts": "2026-07-29T15:50:36.418Z",
  "kind": "opportunity",
  "data": "{\"analyzed\":0,\"collected\":116,\"contribute\":21,\"prefiltered\":29,\"headroomCorrections\":0}"
}
```

*Withheld by the sender and never transmitted:* `thread_url`, `permalink`, `summary`

---

## 6. Account sync

The only two-way feature. The owner's machine POSTs its account list; other machines GET it.
redbot polls — you never call redbot.

### `POST /v2/accounts` — from the owning machine

Send the **whole list every time** and replace. It is small, and a full list is what makes a
deletion detectable: an account that is no longer present has been removed. A delta cannot
distinguish "deleted" from "not yet synced".

```json
{
  "v": 1,
  "installId": "c04d3c63-6444-4b48-bf0d-f2f1d0f902fd",
  "machine": "Dan",
  "kind": "accounts.list",
  "listVersion": 2,
  "sentAt": "2026-07-30T15:04:00.000Z",
  "accounts": [
    {
      "handle": "Quirky_Owl_8028",
      "role": "reviews",
      "speaks": "game reviews",
      "knows": "[]",
      "subreddits": "[\"mobilelegends\"]",
      "timezone": "Asia/Manila",
      "quiet_start": 0,
      "quiet_end": 8,
      "daily_ceiling": 1,
      "note": "Added from the console.",
      "created_at": "2026-07-29T02:06:58.155Z",
      "updated_at": "2026-07-29T14:12:41.894Z"
    },
    {
      "handle": "Striking_Mousse6841",
      "role": "support desk",
      "speaks": "Error messages, plugin conflicts, getting unstuck",
      "knows": "[]",
      "subreddits": "[\"WordPress\"]",
      "timezone": "Asia/Manila",
      "quiet_start": 0,
      "quiet_end": 8,
      "daily_ceiling": 1,
      "note": "Added from the console.",
      "created_at": "2026-07-28T09:20:07.595Z",
      "updated_at": "2026-07-29T10:34:06.373Z"
    }
  ]
}
```

`listVersion` increments on every change, so a polling machine can skip a list it already has.

### `GET /v2/accounts` — to a machine holding a share token

Return the newest list for the install the share token is entitled to, plus `listVersion` so
the caller can no-op. Support `If-None-Match` / `304` if convenient — the payload is under a
kilobyte, so this is politeness rather than necessity.

### What is deliberately absent, and must stay absent

| Never in this payload | Why |
|---|---|
| `profile_dir` | Names a folder on one specific computer |
| `debug_port` | A TCP port free on one specific computer. Copying it risks a machine attaching to an unrelated browser that speaks the same protocol. |
| `selected` | Which account *that* machine acts as |
| Reddit session / cookies | Encrypted under Windows DPAPI, bound to one user on one machine. Copying the folder yields a signed-out profile. Each machine signs in by hand. |

If any of those four ever appear in a payload you receive, **reject it** — the sender is buggy.

---

## 7. Environment variables for the API

| Variable | Required | Secret | Example | Notes |
|---|---|---|---|---|
| `PORT` | yes | no | `8080` | |
| `DATABASE_URL` | yes | **yes** | `postgres://…` | Contains a password — keep it out of logs. |
| `REDBOT_INGEST_TOKEN_SALT` | yes | **yes** | 32 random bytes | Salt for hashing ingest tokens at rest. Changing it invalidates every token. |
| `REDBOT_SHARE_TOKEN_SECRET` | yes | **yes** | 32 random bytes | HMAC secret for minting and verifying share tokens. |
| `REDBOT_ADMIN_TOKEN` | yes | **yes** | opaque string | Guards the route that mints and revokes tokens. Not the same as an ingest token. |
| `REDBOT_MAX_BODY_BYTES` | no | no | `262144` | Body cap. The largest measured event is ~1.3 KB; 256 KB is generous and stops a malformed sender filling a disk. |
| `REDBOT_ALLOWED_STREAMS` | no | no | `activity,thread,draft` | Reject unknown stream names. Defaults to the 12 in §5. |
| `REDBOT_SHARE_TOKEN_TTL_HOURS` | no | no | `168` | Expiry for newly minted share tokens. |

**Every secret above is a server secret** — put them in your platform's secret store, not in a
`.env` committed anywhere. None of them is ever sent to redbot; redbot holds only its own two
tokens, sealed in an OS-backed store on the operator's machine.

---

## 8. Status codes

| Code | When | redbot's reaction |
|---|---|---|
| `204` | Batch accepted (or was a duplicate — same thing) | Advances its cursor |
| `400` | Malformed body, unknown `v`, `stream` mismatch | **Does not retry** — logs and moves on |
| `401` | Missing or bad token | Stops pushing; surfaces a setup problem |
| `403` | Token valid, not entitled to this install | Stops pushing |
| `409` | Not used — a duplicate is a `204` | — |
| `413` | Body over the cap | Reduces batch size and retries |
| `429` | Rate limited | Backs off; honours `Retry-After` |
| `5xx` | Your problem | Retries with backoff, keeps its cursor |

**Answer `204` for a duplicate, not an error.** The cursor must advance or the sender will
resend the same batch forever.

---

## 9. Volume

All-time totals from the reference database — a first backfill, not a rate:

```
  thread               116
  thread_screened       87
  assessment            30
  gap_analysis          30
  draft                  3
  certification          3
  review                 0
  decision               0
  interaction            0
  observation            4
  regret                 0
  activity              51
  ────────────────────────
  first backfill       324 events
```

Plus an optional `trace` stream, off by default: **1,114 rows from 12 runs, 674 of them at
`debug` level**. Do not enable it without a reason.

Steady state is far smaller — most of the above accumulated over several days. No rate has
been measured, so size for the backfill and treat the ongoing load as small.

---

## 10. Open questions for you to decide

1. **`activity.data`** is a JSON string whose contents vary by `kind`. For `kind: "opportunity"`
   it is counts. For `kind: "error"` it may carry a message quoting a URL or model output.
   Either allow-list it per `kind` on ingest, or drop it. This is the one field that cannot be
   made safe from the schema alone.
2. **Retention.** Nothing in the design expires. `trace` alone would be the largest table you
   hold if enabled.
3. **Multiple installs per person.** One operator can run several installs — a laptop and a
   desktop, or a development copy alongside the packaged app. Decide whether your dashboard
   shows them separately or merges them. They are distinguished by `installId`, never by
   `machine`, which can be identical across installs on one computer.

---

## 11. Status of the sender

**None of this is built on the redbot side yet.** There is no sender, no watermark store and no
HTTP call anywhere in the app. This document is the contract to build against, derived from the
live schema, so both halves can be written in parallel.

What is real: every table, column, type, row count and example payload above was queried from a
working database. What is not: no request has ever been transmitted, so nothing here is a
measurement of throughput, latency or retry behaviour.
