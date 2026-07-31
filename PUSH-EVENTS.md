# Event streams — one API per table that earns one

**Written 2026-07-30.** Supersedes the single-snapshot model in `PUSH-PAYLOAD.md`, which sent the
whole state in one payload. This sends **one event per row change, per stream**.

Every table verdict, cursor and volume figure below was measured against the live database
(`data/redbot.db`, 2,870 rows). The example payloads are real rows with the field filter applied —
nothing here is hand-written.

---

## 1. What changes when you move from snapshot to event log

The snapshot model had one useful property: **it could not produce duplicates**, because it sent
state rather than changes. Re-sending was a no-op. That property is now gone, and it is the whole
cost of this design:

| | Snapshot | Event log |
|---|---|---|
| Duplicates possible? | No | **Yes** — any retry re-sends the event |
| Missed pushes | Self-heal; next push is current | **Do not self-heal** — a dropped event stays dropped unless the cursor is right |
| Ordering | Irrelevant | Matters within a stream |
| Your API must | Overwrite | **Upsert on an idempotency key** |
| Detail available | Counts only | Every row, every field you allow |

You get per-row detail and real history. You take on de-duplication and cursor correctness. §4 is
the part that will bite you if it is skipped.

---

## 2. Which tables get an API

27 tables. **12 get an endpoint, 2 are optional, 13 do not.**

### ✅ Endpoints worth building

| Stream | Table | Events all-time | Cursor | What it tells the dashboard |
|---|---|---|---|---|
| `thread` | `threads` | 116 | `(updated_at, id)` | What redbot found |
| `thread_screened` | `thread_prefilter` | 87 | `(updated_at, thread_id)` | Refused mechanically, before any model call |
| `assessment` | `opportunity_assessments` | 30 | `(updated_at, thread_id)` | Worth answering, or left alone |
| `gap_analysis` | `gap_analyses` + `gaps` | 30 (+140 children) | `(updated_at, thread_id)` | What the discussion was missing |
| `draft` | `drafts` | 3 | `(updated_at, id)` | A reply was written, and its status |
| `certification` | `certifications` + 6 child tables | 3 | `id` | The fact-check verdict and why |
| `review` | `reviews` | 0 | `id` | Quality scoring |
| `decision` | `confirmations` | 0 | `id` | The human said send, or did not |
| `interaction` | `interactions` | 0 | `id` | What happened to a published reply |
| `observation` | `observations` | 4 | `id` | Karma and other measurements |
| `regret` | `regret` | 0 | `id` | Replies later regretted |
| `activity` | `history` | 51 | `id` | **The app's own event log** — see §3 |

### ⚙️ Optional — build only if you want them

| Stream | Table | Events | Why it is optional |
|---|---|---|---|
| `job` | `jobs` | 0 | Scheduler internals. Useful only for "is the loop alive", which the heartbeat already answers. |
| `trace` | `trace` | **1,114** | Debug telemetry: 12 runs produced 1,114 rows, **674 of them `debug` level**. That is ~93 rows per run for 3 drafts. Ship it off by default; turn it on to diagnose something. |

### ❌ Not an endpoint, and why

| Table | Rows | Reason |
|---|---|---|
| `credentials` | 0 | **Sealed API keys** (`iv`, `auth_tag`, `ciphertext`). Never leaves the machine, under any flag. |
| `thread_comments` | **1,127** | Other people's comment **bodies**. Highest volume in the database, lowest dashboard value, worst privacy. Send the count on the `thread` event instead. |
| `account_machines` | 2 | Local binding only — `profile_dir`, `debug_port`. Meaningless on another computer and mildly identifying. |
| `schema_migrations` | 15 | **No cursor** (see §4) and system-internal. Send the applied count as an envelope field instead. |
| `certification_claims` | 30 | **No cursor.** Composite PK, no timestamp — cannot be tailed. Folded into `certification`. |
| `certification_invalidations` | 3 | **No cursor.** Same. Folded into `certification`. |
| `certification_reasons` | 42 | Has a cursor, but is a child of one certification. Sending separately makes your API reassemble what redbot could send whole. Folded. |
| `certification_contradictions` | 45 | Folded, same reason. |
| `certification_epistemic_issues` | 19 | Folded, same reason. |
| `certification_resolution_signals` | 0 | Folded, same reason. |
| `gaps` | 140 | Child of `gap_analyses`. Folded. |
| `accounts` | 2 | Config, not an event — changes maybe twice ever. Its live figures already ride on the heartbeat. |
| `sources` | 7 | Config, same. |

**Folding is not a shortcut.** `certification_claims` and `certification_invalidations` have
composite primary keys and no timestamp columns at all — there is no expression that means "rows
added since last time". They *cannot* be streamed independently without adding columns. Sending
them inside the `certification` event is the only correct option that does not change the schema.

---

## 3. `history` is already an event log

`history` has exactly the shape you are trying to build: `id` (autoincrement), `ts`, `kind`,
`account`, `subreddit`, `status`, `summary`, `data`. Observed kinds and counts:

```
read 23 · opportunity 14 · auto.cycle 4 · draft 3 · gate.block 3 · login 2 · error 1 · operator.add 1
```

**Build `activity` first.** It is one endpoint, it already has a perfect cursor, and it gives you a
usable dashboard on its own. The other streams add per-row detail underneath it.

Note the grain, though: 51 events describe 116 threads and 3 drafts, so `history` is **coarse** —
one `read` event per collection run, not one per thread. It tells you *what redbot did*, not
*what it found*. That is why `thread` and the rest still earn their endpoints.

---

## 4. The cursor problem — read this before writing any endpoint

An event log needs a marker meaning "everything after this point is new". Measured across all 27
tables:

```
  id (autoincrement)   14 tables
  updated_at           10 tables
  created_at            0 tables
  NONE                  3 tables
```

### Autoincrement ids are safe

Sampled five streams — all contiguous and monotonic:

```
history                min=    2 max=   52 n=   51  contiguous
gaps                   min=    1 max=  140 n=  140  contiguous
thread_comments        min=    1 max= 1127 n= 1127  contiguous
certification_reasons  min=    1 max=   42 n=   42  contiguous
trace                  min=    1 max= 1114 n= 1114  contiguous
```

`WHERE id > :lastId ORDER BY id` is correct and cannot skip a row.

### `updated_at` alone is NOT safe — this is the important one

Timestamps tie, heavily, because the engine writes in batches inside one transaction:

```
  thread_prefilter          rows=  87  distinct updated_at=   1  worst tie= 87
  opportunity_assessments   rows=  30  distinct updated_at=   2  worst tie= 29
  threads                   rows= 116  distinct updated_at=  15  worst tie= 15
  gap_analyses              rows=  30  distinct updated_at=   4  worst tie= 14
```

**All 87 `thread_prefilter` rows share a single `updated_at` value.** A sender using
`WHERE updated_at > :last` that stops halfway through that batch resumes *past* the whole
timestamp and silently drops the remaining rows. No error, no gap in any id, nothing to notice.

Use a **composite keyset cursor** — the timestamp *and* the primary key:

```sql
SELECT * FROM threads
 WHERE updated_at > :ts
    OR (updated_at = :ts AND id > :lastId)
 ORDER BY updated_at, id
 LIMIT 500;
```

This is mandatory for all 10 `updated_at` streams, not a refinement.

### Three tables have no cursor at all

`certification_claims`, `certification_invalidations`, `schema_migrations` — handled in §2 by
folding or exclusion.

---

## 5. The envelope

Every event, on every stream, has the same outer shape:

```json
{
  "v": 1,
  "installId": "c04d3c63-6444-4b48-bf0d-f2f1d0f902fd",
  "machine": "Dan",
  "stream": "thread",
  "op": "upsert",
  "cursor": { "updated_at": "2026-07-29T14:44:15.969Z", "id": "ff9ba5fd7184" },
  "emittedAt": "2026-07-30T14:52:00.000Z",
  "data": { }
}
```

| Field | Meaning |
|---|---|
| `v` | Envelope version. Reject what you do not recognise. |
| `installId` | Which install. See `PUSH-PAYLOAD.md` §4 and §8 — a hostname is **not** a safe key. |
| `machine` | Display label only. It is a hostname, so treat it as personal data. |
| `stream` | Which table this came from. |
| `op` | `insert` for append-only streams, `upsert` for mutable ones. Never `delete` — redbot does not emit deletions. |
| `cursor` | The exact cursor value for this row. **This is your idempotency key**, with `installId` and `stream`. |
| `emittedAt` | When the sender built the event. Not when the row changed — that is in `data`. |
| `data` | The filtered row. |

### Your idempotency key

```
(installId, stream, cursor)
```

Upsert on that. A retry after a timeout re-sends an identical event, and upserting makes the
second one harmless. **Without this, every network hiccup double-counts.**

---

## 6. The streams, with real payloads

All captured from real rows with the allow-list filter applied. A field not named in the filter
never leaves the machine — that is why these are safe to publish.

### `thread` — 465 bytes

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

**Dropped:** `permalink`, `title`, `body`, `age_text`, `author`. `author` is another Reddit user's
identity and has no place in your dashboard; `title` and `body` are their words.

### `thread_screened` — 411 bytes

```json
{
  "thread_id": "ff9ba5fd7184",
  "kind": "outside-pilot",
  "checked_at": "2026-07-29T15:50:36.047Z",
  "created_at": "2026-07-29T15:50:36.047Z",
  "updated_at": "2026-07-29T15:50:36.047Z"
}
```

**Dropped:** `detail` (free text). `kind` is the machine-readable reason and is what you chart.

### `assessment` — 419 bytes

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

**Dropped:** `permalink`, `title`, `thesis_why_thread`, `thesis_what_new`,
`thesis_why_not_silent`, `reasons` — all model-written prose.

### `draft` — 613 bytes

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

**Dropped:** `title`, `body`, `permalink`, `published_url`, `comment_permalink`, `comment_id`,
`contribution_*`. The reply text is the single most sensitive thing here and never leaves.

`novelty_issues` and `lint_issues` arrive as **JSON strings**, not arrays — they are TEXT columns
holding JSON. Parse them.

### `certification` — 1,256 bytes, children folded in

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
    { "claim_id": "c1", "type": "platform-behaviour", "evidence_class": "primary-documentation", "confidence": "high" },
    { "claim_id": "c2", "type": "inference", "evidence_class": "reasoned-inference", "confidence": "high" }
  ],
  "reasons": [
    { "rule": "fatal-contradiction", "claim_id": "c3" },
    { "rule": "fatal-contradiction", "claim_id": "c6" }
  ],
  "contradictions": [
    { "claim_id": "c1", "kind": "configuration-dependency", "evidence_class": "community-knowledge", "fatal": 1 },
    { "claim_id": "c1", "kind": "edge-case", "evidence_class": "reasoned-inference", "fatal": 0 }
  ],
  "epistemicIssues": [
    { "claim_id": "c2", "language_certainty": "asserted", "supported_certainty": "medium" },
    { "claim_id": "c3", "language_certainty": "asserted", "supported_certainty": "medium" }
  ]
}
```

Truncated to two children each for the example; a real event carries all of them. **Dropped:**
`text`, `source_quote`, `evidence_detail`, `statement`, `quote`, `detail`, `resolution_detail`,
`citations` — every one is prose or a quotation.

Booleans arrive as `0`/`1` — SQLite has no boolean type.

### `activity` — 343 bytes

```json
{
  "id": 52,
  "ts": "2026-07-29T15:50:36.418Z",
  "kind": "opportunity",
  "data": "{\"analyzed\":0,\"collected\":116,\"contribute\":21,\"prefiltered\":29,\"headroomCorrections\":0}"
}
```

**Dropped:** `thread_url`, `permalink`, `summary`.

⚠️ **`data` needs your judgement.** It is a JSON string whose contents depend on `kind`. For
`opportunity` it is counts, as above. For `kind = 'error'` it may carry a message that quotes a
URL or a model response. Either allow-list `data` per `kind`, or drop it and keep `summary`-free
counts only. This is the one field in the whole design I cannot make safe from the schema alone.

---

## 7. Delivery

**At-least-once, never exactly-once.** The sender retries on failure; your API de-duplicates on
`(installId, stream, cursor)`. Any other split of responsibility ends in double counting.

**Per-stream watermarks.** The sender stores the last cursor sent *per stream*, persisted beside
`machine-id` so a restart does not resend everything. A stream that fails does not block the others.

**Batching within a stream is fine** — send up to N events in one request as an array, but keep
one stream per request. Mixing streams in one body makes partial failure ambiguous.

**Backfill is the first push.** On a fresh dashboard every watermark is empty, so the first run
sends everything: on this database that is 116 + 87 + 30 + 30 + 3 + 3 + 4 + 51 ≈ **324 events**,
plus 1,114 more if `trace` is enabled. Page it, and expect the first sync to be the largest.

**Order within a stream, not across.** A `draft` event can arrive before the `thread` it points at,
because streams advance independently. Your API must tolerate a foreign key it has not seen yet —
store it and resolve later, do not reject.

---

## 8. Account sync — the one two-way feature

Everything above is **one-way**: the machine talks, the cloud listens, and nothing reaches back in.
Account sync is different in kind, because a second machine has to *receive* accounts. That single
difference drives every decision below.

### 8.1 The schema was already built for this

`accounts` (0002) mixed two kinds of fact in one row. Migration `0013_account_machines` split them
apart, and says why in its own header:

> Most of it is portable and worth sharing: who this account is, what it talks about, which
> subreddits, the daily ceiling, the quiet hours. Two of the columns are not portable at all —
> `profile_dir` names a folder under data/ on ONE computer, and `debug_port` names a TCP port that
> is free on ONE computer.
>
> […] the table is what keeps the non-portable columns SEPARATED from the portable ones, and that
> separation is what makes a future export/sync possible at all.

So this feature does not need a schema change. It needs the split to be *honoured*.

### 8.2 Still a pull, so the security model survives

The app **asks** for the account list on a timer — an ordinary outbound GET, exactly like the
update check. The cloud never initiates a connection to the machine.

That matters more than it sounds. redbot's console is bound to `127.0.0.1` and refuses
cross-origin requests. Nothing in this feature opens a port, forwards anything through a router,
or gives the cloud an address to reach. A machine behind any firewall syncs fine, and a
compromised dashboard still cannot *reach* an install — the worst it can do is answer a question
badly, which §8.6 handles.

### 8.3 What syncs, and what must never

| Syncs — the description | Never syncs — the binding |
|---|---|
| `handle`, `role`, `speaks`, `knows` | `profile_dir` (**both** tables) |
| `subreddits` | `debug_port` (**both** tables) |
| `timezone`, `quiet_start`, `quiet_end` | `selected` — which account *this* machine acts as |
| `daily_ceiling`, `note` | `machine` |
| `created_at`, `updated_at` | The Chrome profile folder itself |

**The trap:** `accounts` still carries `profile_dir` and `debug_port` columns, which duplicate
`account_machines`. On this database they hold identical values, because there is only one machine
— so a naive `SELECT * FROM accounts` looks perfectly correct and would ship machine-local values
to every other computer. The migration keeps those legacy columns deliberately, as a fallback for
installs that have no binding row yet. A sync built on `SELECT *` inherits them.

Verified on the real rows — the portable projection carries **0 machine-local fields**:

```json
{
  "v": 1,
  "installId": "c04d3c63-6444-4b48-bf0d-f2f1d0f902fd",
  "machine": "Dan",
  "kind": "accounts.list",
  "listVersion": 2,
  "emittedAt": "2026-07-30T14:58:00.000Z",
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
    }
  ]
}
```

815 bytes for two accounts. `knows` and `subreddits` are **JSON strings**, not arrays — TEXT
columns holding JSON. Parse them.

### 8.4 The Reddit session cannot sync, and that is measured

From the same migration header:

> The Reddit session lives in the Chrome profile FOLDER, encrypted under a key that Windows DPAPI
> has bound to one user on one machine — measured: the cookies in `data/chrome-profile-a` carry
> the `v10` tag and Local State holds a DPAPI-wrapped `encrypted_key`. Copying that folder to
> another machine yields a signed-out profile.

So syncing an account gives machine B the *description*. Machine B then runs **Set it up** — which
creates its own profile folder and picks its own free port — and the person **signs in to Reddit
once, by hand**. That is already the app's flow; sync just removes the retyping of role,
subreddits, quiet hours and ceiling.

### 8.5 Ports must be re-derived locally, never copied

The migration records what happens if a port travels between machines:

> a port is a rendezvous with whatever got there first: on the development machine 9222 is held by
> Lenovo Vantage's Edge WebView, which speaks the debugging protocol fluently and would be driven
> as though it were the account's own Chrome.

Re-confirmed while porting the schema on 2026-07-30: attaching to `127.0.0.1:9222` reports
`Edg/150.0.4078.105`, user agent `LenovoVantage/3.0.0.197`.

An account arriving on a new machine must get its port from `suggestFreePort()` on **that**
machine. Copying `debug_port` across risks driving somebody else's browser as if it were yours.

### 8.6 Full list, not deltas — and why this one is not an event stream

Every other stream in this document is append-or-update. Accounts are the exception: **send the
whole list every time, and have the receiver replace.**

Two reasons, and the first is decisive:

1. **Deletions.** A pull-based delta cannot tell "this account was deleted" from "this account has
   not synced yet" — absence means both. A full list makes a deletion simply *an account that is
   no longer in the list*.
2. **It is tiny.** Two accounts, 815 bytes, and `updated_at` shows they have been edited twice in
   their lifetime. There is nothing to optimise.

`listVersion` increments on every change so a machine can skip a list it already has.

### 8.7 A remote deletion must never silently destroy local work

This is the part to get wrong slowly. `src/console-accounts.ts:397` already refuses to remove an
account when `dependents.jobs > 0 || dependents.drafts > 0` unless the caller passes
`confirm: true`. A sync that bypasses that guard would let a click on machine A delete drafts on
machine B.

So an account that disappears from the list should be marked **withdrawn** locally — hidden from
the picker, no longer collected for — while its drafts, history and profile folder stay untouched
until a person confirms locally. Fail closed: the sync may deactivate, never destroy.

### 8.8 Conflicts

Last-write-wins on `updated_at`, per account, and **never apply an older row over a newer one** — a
machine that has been offline for a week will otherwise resurrect stale settings the moment it
reconnects. With two accounts edited twice ever, that is enough; the alternative is a merge UI
nobody will use.

`handle` is the identity across machines: it is the primary key of `accounts` and a Reddit handle
is globally unique. No synthetic id is needed.

---

## 9. Auth, and the configuration to add

### 9.1 Two tokens, not one

The push path and the account-sync path need **separate tokens with different powers**. Collapsing
them into one is the mistake that turns a small leak into a large one.

| Token | Direction | Power | If it leaks |
|---|---|---|---|
| **Push token** | machine → cloud | Write its own events only | Somebody can post fake numbers into your dashboard |
| **Share token** | cloud → machine | Read the account list only | Somebody learns your account descriptions |

If one token did both, a share token handed to a colleague would also let them forge events for
every install. Issue them separately, and make the share token **revocable and expiring** — it is
the one that leaves your own machines.

### 9.2 The share flow, in order

1. On the owning machine, an account list is pushed as in §8.6.
2. In the dashboard, the owner mints a **share token** — read-only, scoped to the account list,
   with an expiry.
3. The owner sends that token to the other person out of band.
4. On the second machine, the token is stored (§9.3) and `REDBOT_SYNC_URL` is set.
5. That machine polls, receives the list, and creates each account locally — **its own profile
   folder, its own free port** (§8.5), and a Reddit sign-in done by hand (§8.4).
6. The owner can revoke the token at any time; the second machine keeps the accounts it already
   has and simply stops receiving updates.

Revocation deliberately does **not** delete anything remotely — same rule as §8.7: sync may
deactivate, never destroy.

### 9.3 Where the token lives — the vault, not an environment variable

redbot already has a sealed named-secret store: `putSecret(name, value, scope)` /
`getSecret(name, scope)` in `src/credentials.ts`, AES-256-GCM under a key held in the OS
credential store. The Anthropic API key already lives there as `anthropic_api_key`.

Store the tokens the same way:

| Secret name | Scope | Holds |
|---|---|---|
| `sync_push_token` | `global` | The push token |
| `sync_share_token` | `global` | The share token, on a receiving machine |

**Resolution order matches `anthropicKey()` exactly** — environment first, vault second. That
keeps one rule in the codebase rather than two, and it is why the env vars below exist at all:
they are an override for headless and CI use, not the normal home.

Two rules the repo already enforces for the API key, and which apply unchanged here:

- **Never accept a token as a command-line argument.** `src/commands/vault.ts` refuses an argv
  value because the shell history and the process list both keep it.
- **Never put a token in a URL or query string.** `tools/product/server.mjs` says it plainly for
  the vault endpoint: a query string "lands in access logs and browser history". Use
  `Authorization: Bearer …`.

### 9.4 Environment variables to add

Following the existing `REDBOT_*` convention — there are 19 of them today.

| Variable | Required | Secret | Example | If unset |
|---|---|---|---|---|
| `REDBOT_SYNC_URL` | to enable anything | no | `https://dash.example.com/api` | **All syncing and pushing is off.** This is the master switch — no separate enable flag. |
| `REDBOT_SYNC_PUSH_TOKEN` | no | **yes** | `rbp_…` | Falls back to the `sync_push_token` vault secret. If neither, pushing is off. |
| `REDBOT_SYNC_SHARE_TOKEN` | no | **yes** | `rbs_…` | Falls back to the `sync_share_token` vault secret. If neither, account sync is off. |
| `REDBOT_INSTALL_ID` | no | no | a UUID | A generated id is used and persisted beside `machine-id`. Override exists for tests, mirroring `REDBOT_MACHINE`. |
| `REDBOT_SYNC_INTERVAL_MS` | no | no | `300000` | A built-in default. Lower bound enforced so a typo cannot hammer your API. |
| `REDBOT_SYNC_STREAMS` | no | no | `activity,thread,draft` | All non-optional streams from §2. Naming streams here is how `trace` gets switched on. |

**Absence of `REDBOT_SYNC_URL` disables the whole feature.** One switch, and it fails closed: a
half-configured install sends nothing rather than sending somewhere unintended.

**No variable ever holds a URL with credentials in it.** `REDBOT_SYNC_URL` is a bare base URL; the
tokens travel in a header.

### 9.5 What this adds to the packaged app

Nothing in `electron-builder.yml` changes — no new files ship. The Electron shell passes the
environment through to its server child unchanged (`electron/main.mjs:133`), so a variable set for
the user is inherited by a double-clicked app, exactly as `REDBOT_OPERATOR` is today.

For a desktop user who never opens a terminal, the tokens should be enterable on the **Setup
screen** using the existing sealed-secret control — the same POST-body path the Anthropic key
already uses, which never echoes the value back and shows only the last four characters.

---

## 10. What is NOT built

**None of this exists in redbot yet.** There is no sender, no watermark store, no `installId`, and
no HTTP call anywhere in the codebase. This document specifies what to build against, derived from
the live schema.

What IS real: every table name, column name, row count, cursor availability, tie measurement and
example payload. Those were queried, not recalled.

What is NOT verified: nothing has been transmitted, so no claim is made about retry behaviour,
throughput, or how these streams behave under a long run. The volume figures are all-time totals
for this database, not a rate.
