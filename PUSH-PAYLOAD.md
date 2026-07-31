# The push payload — what redbot sends to your dashboard API

**Written 2026-07-30.** Every field below was produced by running the real functions against the
real database (`data/redbot.db`, 2,870 rows) and printing the result. The example is not
illustrative — it is a byte-for-byte capture of one push. Where a field came back empty, this
document says so and says why, rather than inventing a plausible value.

---

## 1. The transport

| | |
|---|---|
| Method | `POST` |
| Path | yours — redbot is configured with a full URL |
| `Content-Type` | `application/json; charset=utf-8` |
| Auth header | `Authorization: Bearer <shared secret>` |
| Body | one JSON object, described below |
| Typical size | **1,298 bytes** measured on the corpus below |
| Frequency | whatever you set; every few minutes is ample |

**Push, never pull.** redbot's console is bound to `127.0.0.1` and refuses cross-origin requests.
Your dashboard cannot reach into it, and should not be able to — that boundary is the app's
entire security model. So redbot posts outward and your API only ever receives.

### What your endpoint must do

1. **Reject anything without the right bearer token**, with `401`. Without this, anyone who
   learns the URL can post fake numbers into your dashboard.
2. **Answer `2xx` quickly.** redbot treats any non-2xx as "not delivered" and simply tries again
   on the next tick. Nothing queues up and nothing is lost, because each push is a *complete
   snapshot* — see §4.
3. **Store the newest snapshot per `installId`, and stop.** You do not need to merge, diff, or
   accumulate — but you DO need to key on `installId`, or two installs will overwrite each other.
   See §4.

---

## 2. A complete, real payload

Captured from the live database. Only the two account handles are the operator's own; nothing
else has been altered.

```json
{
  "v": 1,
  "installId": "c04d3c63-6444-4b48-bf0d-f2f1d0f902fd",
  "machine": "Dan",
  "at": "2026-07-30T14:38:36.640Z",
  "totals": {
    "published": 0,
    "pending": 3,
    "reviews": 0,
    "regret": 0,
    "removals": 0,
    "certifications": 3
  },
  "funnel": {
    "threadsCollected": 116,
    "assessed": 30,
    "contribute": 22,
    "skip": 8,
    "gapsAnalysed": 30,
    "drafted": 3
  },
  "drafts": {
    "total": 3,
    "pending": 3
  },
  "perAccount": {
    "Quirky_Owl_8028": {
      "handle": "Quirky_Owl_8028",
      "published": 0,
      "observations": 1,
      "karma": {
        "value": 1,
        "ts": "2026-07-29T07:32:25.313Z",
        "vector": "signed-in",
        "note": "measured by probe-karma from the profile page"
      }
    },
    "Striking_Mousse6841": {
      "handle": "Striking_Mousse6841",
      "published": 0,
      "observations": 3,
      "karma": {
        "value": 1,
        "ts": "2026-07-28T11:05:58.760Z",
        "vector": "signed-in",
        "note": "measured by probe-karma from the profile page"
      }
    }
  },
  "bySubreddit": {
    "CRM": 19,
    "CopilotPro": 1,
    "NoStupidQuestions": 15,
    "PiratingWebsites": 1,
    "Steam_Games": 15,
    "Wordpress": 32,
    "brainrot": 1,
    "fashionph": 1,
    "foods": 13,
    "meshyai": 1,
    "unknown": 4,
    "website_builder": 13
  },
  "argus": {
    "runs": 3,
    "draftsChecked": 3,
    "byVerdict": { "REJECT": 3, "ESCALATE": 0, "CERTIFIED": 0 },
    "topReasons": [
      { "rule": "overconfident-language", "n": 19 },
      { "rule": "fatal-contradiction", "n": 11 },
      { "rule": "falsifiable-claim-weak-evidence", "n": 8 },
      { "rule": "invalidated-dependency", "n": 3 },
      { "rule": "contested-contradiction", "n": 1 }
    ],
    "claimSpread": []
  }
}
```

---

## 3. Field reference

Types are taken from the exported TypeScript interfaces (`src/db/summary.ts`,
`src/db/pages.ts`), not inferred from one sample.

### Top level

| Field | Type | Notes |
|---|---|---|
| `v` | integer | Payload version. Currently `1`. Reject anything you do not recognise. |
| `installId` | string (UUID) | **The key. Store one snapshot per `installId`.** Opaque, random, created once on first push and persisted. Carries nothing about the machine or the person. |
| `machine` | string | Human-readable label for the install, 1–64 chars of `[A-Za-z0-9_.-]`. **A display label, never a key** — see §4. |
| `at` | string | ISO-8601 UTC, when the snapshot was taken — **not** when you received it. |
| `totals` | object | Whole-record counters. |
| `funnel` | object | The discovery pipeline. |
| `drafts` | object | Draft queue. |
| `perAccount` | object | Keyed by Reddit handle. **May be `{}`** if no account is configured. |
| `bySubreddit` | object | Keyed by subreddit name. |
| `argus` | object | Fact-checker performance. |

### `totals` — `ConsoleTotals`

| Field | Type | Meaning |
|---|---|---|
| `published` | integer | Replies actually sent, all accounts. |
| `pending` | integer | Drafts waiting on a person. |
| `reviews` | integer | Quality reviews recorded. |
| `regret` | integer | Replies later regretted. |
| `removals` | integer | Replies a moderator took down. |
| `certifications` | integer | Fact-check runs recorded. |

### `funnel` — the discovery pipeline

Each is a whole-record count, **not** a subset of the one above it — do not assume they nest.

| Field | Type | Meaning |
|---|---|---|
| `threadsCollected` | integer | Threads collected. |
| `assessed` | integer | Threads that reached an opportunity assessment. |
| `contribute` | integer | Assessed as worth answering. |
| `skip` | integer | Assessed and left alone. |
| `gapsAnalysed` | integer | Threads that got a gap analysis. |
| `drafted` | integer | Threads a reply was written for. |

In the sample: `contribute (22) + skip (8) = 30 = assessed`. That identity held on this data but
is **not** guaranteed by a constraint — do not build a chart that breaks if it ever fails.

### `drafts`

| Field | Type | Meaning |
|---|---|---|
| `total` | integer | All drafts. |
| `pending` | integer | Drafts with `status = 'pending'`. |

### `perAccount` — map of handle → `AccountTally`

| Field | Type | Meaning |
|---|---|---|
| `handle` | string | Reddit handle. Repeated inside the object as well as being the key. |
| `published` | integer | Replies published as this account. |
| `observations` | integer | How many measurements exist for it. |
| `karma` | object **or `null`** | Most recent karma reading. `null` when none was ever taken. |
| `karma.value` | **unknown** | Typed `unknown` in the source. Numeric in practice — **coerce, do not trust**. |
| `karma.ts` | string | ISO-8601 UTC of the reading. |
| `karma.vector` | string or `null` | How it was measured, e.g. `"signed-in"`. |
| `karma.note` | string or `null` | Free text. |

### `bySubreddit` — map of subreddit name → integer

Threads collected per subreddit. Threads with no subreddit recorded are grouped under the literal
key **`"unknown"`** (4 of them in the sample). Keys preserve Reddit's original casing.

The values sum to `funnel.threadsCollected` — verified on this data: 116 = 116. Every thread
appears exactly once, so this is safe to render as a share-of-total.

### `argus` — `ArgusSummary`

| Field | Type | Meaning |
|---|---|---|
| `runs` | integer | Certification runs. |
| `draftsChecked` | integer | Distinct drafts checked. |
| `byVerdict` | object | Verdict → count. Observed keys: `CERTIFIED`, `ESCALATE`, `REJECT`. **Treat as open** — read whatever keys arrive rather than hard-coding three. |
| `topReasons` | array | `{ rule: string, n: integer }`, most frequent first. |
| `claimSpread` | array of arrays of integers | Claim counts for drafts certified more than once — the stability evidence. |

---

## 4. Things that will bite you if nobody says them

**Key on `installId`, never on `machine`.** This is the one that produces silently wrong numbers
rather than an error. `machine` comes from `machineId()` (`src/machine.ts`), which seeds from
`os.hostname()` — so it answers *"which computer"*, and one computer can hold several installs.
Measured on the machine this document was written on:

```
installed app  machine-id=Dan  rows=   53
repo dev copy  machine-id=Dan  rows= 2870
```

Two entirely separate databases, the same `machine`. Keyed on `machine`, those two would
overwrite each other and the dashboard would flip between 53 and 2,870 depending on which pushed
last, with nothing in the payload indicating a problem. `installId` is random per install, so it
cannot collide.

**Each push is a complete snapshot, not a delta.** Store the latest *for that `installId`* and
overwrite. If three pushes are missed, nothing needs replaying — the next one is already current.
This is also why a failed push needs no retry queue.

**`machine` is a hostname, so treat it as personal data.** On the machine above the value is
literally `Dan`. Hostnames leak people's names and company naming conventions (`ACME-FINANCE-07`).
That is at odds with the rest of this payload, which is deliberately just counts — see §5. Two
ways to avoid it, either fine: set `REDBOT_MACHINE` to a neutral label (`laptop-a`), which
overrides the hostname without touching code; or drop `machine` from the payload entirely and
label installs in the dashboard yourself. The `installId` key works either way.

**Counters can go DOWN.** Rows get deleted; an account gets removed; the operator resets a data
directory. A dashboard that assumes monotonic growth will render nonsense. Do not compute a rate
by subtracting two snapshots without checking the result is positive.

**`at` is the snapshot time, from the operator's machine clock.** If that clock is wrong, this is
wrong. Record your own receive time alongside it and show whichever suits — but do not assume they
agree, and do not assume `at` always moves forward between pushes.

**Empty is not zero.** `perAccount: {}` means *no account is configured*, which is a different
statement from "an account exists and has published nothing" — that would be a present handle with
`published: 0`. Render the two differently or you will report a broken install as a quiet one.

**`claimSpread` was `[]` in this capture.** It only fills once a draft has been certified more
than once; three runs over three distinct drafts produce nothing here. An empty array is normal,
not a fault.

**Watch the `perAccount` Map trap.** Internally `accountTallies()` returns a JavaScript `Map`, and
`JSON.stringify(map)` silently produces `{}` — no error, no warning. This was hit while writing
this document: two accounts with real data serialised to nothing and looked like an empty install.
The sender must call `Object.fromEntries()` first. If `perAccount` ever arrives as `{}` on an
install that has accounts, this is the bug to suspect.

**`karma.value` is typed `unknown`.** Coerce it defensively before charting.

---

## 5. What is deliberately NOT in the payload

Never send, and this is a design rule rather than an oversight:

- Draft or reply **text**, thread bodies, comment bodies
- Anything from `credentials` — that table holds sealed API keys
- Chrome profile paths, machine identifiers, file paths
- Thread URLs or post IDs

The payload is a **scoreboard**. If your dashboard leaks, it leaks counts and rule names — not the
operator's evidence, and not anything that identifies a Reddit user. Adding a field that carries
text turns a low-value leak into a high-value one, so weigh any addition against that.

---

## 6. A minimal receiver

Illustrative, not run — the shape only.

```js
app.post('/redbot/snapshot', express.json({ limit: '256kb' }), (req, res) => {
  if (req.get('authorization') !== `Bearer ${process.env.REDBOT_PUSH_SECRET}`) {
    return res.sendStatus(401);
  }
  const p = req.body;
  if (p?.v !== 1) return res.status(400).json({ error: 'unsupported payload version' });
  if (typeof p.installId !== 'string' || !p.installId) {
    return res.status(400).json({ error: 'installId is required' });
  }

  // Keyed on installId, NOT machine: one computer can run several installs (§4).
  saveLatest(p.installId, { ...p, receivedAt: new Date().toISOString() });   // overwrite
  res.sendStatus(204);
});
```

Cap the body size. The measured payload is ~1.2 KB; `bySubreddit` grows with the number of
distinct subreddits and `topReasons` with the number of distinct rules, so it will drift upward —
kilobytes, not megabytes. A 256 KB ceiling is generous and stops a malformed sender filling a disk.

---

## 7. Provenance

Every figure in §2 was computed by the same functions the console calls to draw its own screens —
`consoleTotals`, `threadFunnel`, `draftCounts`, `accountTallies`, `threadsBySubreddit`,
`argusSummary` — then reconciled against direct SQL over the same database:

```
  metric                      payload   raw SQL   ok
  funnel.threadsCollected       116       116   yes
  funnel.gapsAnalysed            30        30   yes
  funnel.drafted                  3         3   yes
  drafts.total                    3         3   yes
  totals.certifications           3         3   yes
  argus.runs                      3         3   yes
  bySubreddit sum               116       116   yes
  mismatches: 0
```

`machine` is the real return of `machineId()` on the authoring machine. `installId` was generated
with `crypto.randomUUID()` for this capture — see the caveat below.

**What is not verified here:** nothing has ever been pushed over a network. There is no sender in
redbot yet — this document describes the payload a sender would produce, captured by calling the
same functions directly. Sizes, field names and types are real; the HTTP behaviour in §1 is a
specification to build against, not a measurement.

**`installId` does not exist in redbot yet.** Every other field came out of shipped code; this one
is specified here and still has to be built. The sender must generate it once, persist it next to
`data/machine-id`, and never regenerate it — a new id on every push would look like an endless
stream of new installs. It must also NOT be copied when a `data/` directory is copied to another
machine, or the collision this key exists to prevent comes straight back.

---

## 8. How long an `installId` lives

Stored beside `machine-id` it sits in `%APPDATA%\redbot\data\`, which is a different directory
from the program itself (`%LOCALAPPDATA%\Programs\redbot`). That separation is what decides the
answer, and it was exercised for real: the app was uninstalled once and installed three times
while this document was being written.

| Event | Survives? | Evidence |
|---|---|---|
| **App update / reinstall over the top** | **Yes** | `machine-id` created `18:24:07`, unmodified; the installed binary is from `22:07:50` — two reinstalls later, same file |
| **Uninstall, then reinstall** | **Yes** | The uninstaller ran during this session and `vault.key` (created `16:35:59`) and the database were still present afterwards |
| Uninstall with `--delete-app-data` | No | `$isDeleteAppData` flips only on that flag, or on a `DELETE_APP_DATA_ON_UNINSTALL` define that `deleteAppDataOnUninstall: false` withholds |
| `%APPDATA%\redbot` deleted by hand, PC reset, profile recreated | No | Nothing outside that directory holds it |
| A different Windows user on the same PC | No — and correctly so | Separate `%APPDATA%`, so genuinely a separate install |
| A different machine | No — as intended | That is the whole point of the key |

The uninstall command Windows actually runs, read from the registry:

```
"C:\Users\lloyd\AppData\Local\Programs\redbot\Uninstall redbot.exe" /currentuser
contains --delete-app-data: False
```

### What your dashboard should do about the "No" rows

In those cases a **new `installId` appears and the old one goes quiet**. Nothing is corrupted and
no numbers are wrong — the history simply does not stitch itself together.

Handle that by letting a person merge two `installId`s in the dashboard, rather than by trying to
make the id outlive its own data directory. An id that survived a wiped `%APPDATA%` would have to
live in the registry or the program folder, and it would then be wrong in the opposite and worse
direction: a fresh install on a reset profile would silently inherit the previous occupant's
identity and append its numbers to a stranger's history. A gap in a chart is recoverable; two
installs merged into one without anyone noticing is not.

**Caveat on this section:** persistence was verified using `machine-id` and `vault.key`, which
live in exactly the directory `installId` will. `installId` itself does not exist yet, so its
lifetime is inherited from that location rather than separately measured.

---

## 9. When it sends, and why there is no such thing as a duplicate

### This is a snapshot, not an event stream

Every push carries **the complete current state of the whole database**. It is not a batch of new
rows since last time, and there is no cursor, no offset and no "since" parameter. That single
property answers most of what an ingestion API normally has to worry about.

Measured — three snapshots taken ~1.2 seconds apart with the database untouched between them:

```
  content hash (excluding `at`):
    #1 41f78179f9411826
    #2 41f78179f9411826
    #3 41f78179f9411826
  all three identical:              true
  full JSON identical except `at`:  true
```

The payload is a pure function of the database. Two pushes with no work in between are
byte-identical apart from the timestamp.

### Consequences you can rely on

| Question | Answer |
|---|---|
| Does it send in bulk? | **No, and it cannot.** There is nothing to batch — one push is already everything. |
| Can rows arrive twice? | **No.** No rows are sent, only counts. There is no row-level duplication to guard against. |
| What if pushes are missed? | **Nothing is lost.** The next push is already current. No backlog, no replay, no retry queue. |
| Does arrival order matter? | Only in that a *later* snapshot should not be overwritten by an *earlier* one — compare `at`, and ignore anything older than what you hold. |
| Is it safe to receive the same push twice? | **Yes.** Storing it again is a no-op. The endpoint is idempotent by construction. |

### When redbot should send

Four moments, and they exist for different reasons:

| Trigger | Why |
|---|---|
| **App start** | The dashboard learns the install is alive, and gets current numbers immediately. |
| **After a run finishes** | This is the only moment the numbers actually change. Sending here is what makes the dashboard feel live. |
| **On a timer** | A heartbeat. Proves the install is still running even when idle, so a silent install is distinguishable from a stopped one. |
| **On quit** | A final state, so the dashboard is not left showing numbers from mid-session. |

A run-completion push is the one that carries information. The timer exists mostly so that
*silence* becomes meaningful.

### The one real duplication question

It depends on what your dashboard is for, and the two answers differ:

**If it shows "how are things right now"** — store one record per `installId` and overwrite it on
every push. Identical repeats cost nothing and there is no dedup problem to solve. This is the
simple case and it is what §6's receiver does.

**If it shows history over time** — charts, trends, "threads collected per day" — then an idle
install pushing every five minutes writes hundreds of identical rows a day, and your charts will
be mostly flat repeats. Two ways to avoid that, either fine:

- **Sender-side:** hash the payload with `at` removed (exactly as measured above), skip the push
  when the hash matches the last one sent, and force one through every N minutes regardless so
  the heartbeat survives.
- **Receiver-side:** keep the same hash yourself; when it matches the newest stored record,
  update that record's "last seen" time instead of inserting a new one.

Sender-side saves bandwidth; receiver-side keeps the sender dumb and means a change of policy
does not need a redbot release. For one operator and a ~1.3 KB payload, receiver-side is the
easier call — but the hash must exclude `at`, or every snapshot is unique and the dedup does
nothing.

**Caveat:** the hash stability above was measured over ~2.4 seconds on a database nobody was
writing to. It demonstrates that the payload is deterministic; it is not a claim about how often
these numbers change during real use, which has not been measured.
