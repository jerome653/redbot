# redbot — Postgres

A containerised Postgres and the migrations that build redbot's domain schema.

**This database is the store.** `src/store.ts` reads and writes threads, thread comments,
gap analyses, opportunity assessments, drafts and history here. The domain is no longer
kept in `data/*.json`.

Secrets live here too, **sealed**. `redbot.credentials` (migration 0011) stores AES-256-GCM
ciphertext under a master key held in `REDBOT_VAULT_KEY` — outside the database, beside the
Postgres password, where no `pg_dump` reaches. The rule this project started with was "a
database gets dumped, and a session cookie in a dump is in every copy of it forever"; that
objection is to *plaintext* in a dump, and plaintext is what never lands in the table. See
`src/vault.ts` and `redbot vault`.

Configuration is here too. `redbot.accounts` (0002) is who redbot posts as; `redbot.sources`
(0012) is where it looks for threads. `data/accounts.json` and `data/sources.json` remain as
the seeds you import from and the fallback when the database is unreachable — the database
wins whenever it has rows, and `redbot accounts` / `redbot sources` report which one answered.

What is still a file, and cannot sensibly be anything else: the Chrome profiles under
`data/chrome-profile-*/`, because Chrome must read its own on-disk format from a real
directory; and the Postgres password itself, which unlocks the database the vault lives in.

No frozen module was touched. `ENGINE-FREEZE.md` covers `src/argus/*`, `src/opportunity.ts`,
`src/gap.ts`, `src/competence.ts`, `src/policy.ts` and `src/interactions.ts`; none of them
import the store.

---

## Quick start

```powershell
cp db/.env.example db/.env          # then set POSTGRES_PASSWORD
docker compose -f db/docker-compose.yml up -d
node db/migrate.mjs up
node db/migrate.mjs verify
```

Generate a password:

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

---

## Looking at the data

A [pgweb](https://github.com/sosedoff/pgweb) container is defined alongside the database.
It is **opt-in** — a plain `up -d` does not start it:

```powershell
docker compose -f db/docker-compose.yml --profile tools up -d
```

Then open **http://127.0.0.1:8081**. It connects itself with the credentials in `db/.env`,
so there is no login screen and no server to register — the tables are already listed.

To stop just the viewer and leave the database running:

```powershell
docker compose -f db/docker-compose.yml --profile tools stop pgweb
```

Two things worth knowing:

- **The `redbot` schema is collapsed when the page loads.** The sidebar opens on `public`,
  which holds only `schema_migrations`, so the first impression is a database with one
  table in it. Click **redbot**, then **Tables**, and all 24 appear.

- **It can write.** pgweb is a database client, not a read-only viewer; its query tab will
  happily run a `DELETE`. If you only ever open this to *look* at rows, uncomment
  `command: ["--readonly"]` in `db/docker-compose.yml` and recreate the container. Be aware
  of what that flag actually is: pgweb rejects the statement by **keyword match**
  (`"query contains keywords not allowed in read-only mode"`), not by opening a read-only
  transaction, so treat it as a guard against a slip rather than a security boundary.
  `src/store.ts` is what is supposed to be writing to these tables.

The port is bound to `127.0.0.1` for the same reason the database's is: the container holds
an already-authenticated connection, so anything that can reach it can read the database
without being asked for a password.

---

## Commands

| command | what it does |
|---|---|
| `node db/migrate.mjs status` | what is applied, what is pending |
| `node db/migrate.mjs up` | apply every pending migration |
| `node db/migrate.mjs down [n]` | roll back the last `n` (default 1) |
| `node db/migrate.mjs new <name>` | scaffold the next `up`/`down` pair |
| `node db/migrate.mjs verify` | assert the live schema matches the migrations |
| `node db/migrate.mjs psql "SELECT 1"` | run one statement |

The runner has **zero dependencies**. redbot's only runtime dependency is playwright, and
adding a migration framework — plus a driver, a config format and a lockfile — to run nine
SQL files would cost more than it carries. Migrations are plain SQL piped into the `psql`
that already exists inside the container.

### It fails closed

Each of these exits non-zero rather than guessing:

- the container is not running or not yet healthy
- an **already-applied migration's file has changed** since it was applied (checksum drift —
  the database and the repository disagree about what the schema is). The fix is a new
  migration; an applied migration is history.
- a rollback is requested and the `.down.sql` does not exist. Every down file is checked
  *before* any of them runs, because a rollback that stops halfway is worse than one that
  never starts.

---

## Layout

```
db/
  docker-compose.yml     the container. Loopback-only, healthchecked, named volume.
  .env.example           committed template, no secret
  .env                   your real password — gitignored
  migrate.mjs            the runner
  migrations/
    0001_init.up.sql     schema, search_path, the updated_at trigger function
    0002_accounts        who redbot posts as
    0003_threads         the corpus: threads + comments
    0004_gap_analyses    what a discussion already contains
    0005_opportunity_assessments   contribute or stay silent
    0006_drafts          the reply and everything decided about it
    0007_certifications  Argus, normalised across seven tables
    0008_jobs            the per-account work queue
    0009_event_logs      history · observations · reviews · regret ·
                         interactions · trace · confirmations
```

Every migration has a matching `.down.sql`. The full round trip is exercised, not assumed:
`down 9` tears the schema back to nothing and `up` rebuilds it.

---

## The schema

Everything lives in the `redbot` schema, never `public`. `search_path` is set on the
database, so clients see the domain unqualified.

22 tables, 26 enum types, 14 foreign keys, 35 check constraints, 70 indexes.

Each table mirrors a type in the TypeScript source, and every migration cites the file and
line it was modelled from. The closed vocabularies (`ClaimType`, `EvidenceClass`,
`JobState`, `HistoryKind`, the review reason codes …) are **native Postgres enums**, so a
typo is refused by the database rather than discovered in a report three weeks later.

### Constraints that encode project history

These are not decoration. Each one is a defect that already happened:

| constraint | what it prevents |
|---|---|
| `drafts.reject_is_never_published` | Evaluation **H6** — a REJECTed draft was approvable and postable because the publish path never read the certification. |
| `opportunity_assessments.thesis_is_whole` | A partial thesis is the shape of an argument that was never made. All three of `whyThread`/`whatNew`/`whyNotSilent`, or none. |
| `confirmations.public_visibility_needs_a_third_party` | Seeing your own comment while signed in proves nothing about whether anyone else can. Only `source = 'third-party'` may claim `visibility = 'public'`. |
| `reviews.reason_code_matches_decision` | The reason vocabularies are fixed *and* paired with the decision — you cannot file `inaccurate` against an approval. |
| `jobs.terminal_and_waiting_states_explain_themselves` | A `failed`, `cancelled` or `waiting` job with no `detail` is an outcome nobody can act on. |
| `accounts.handle` regex | The same shape `accountDir` enforces before it touches the filesystem (`src/jobs.ts:101`). A handle that cannot be a directory name cannot be a row. |

### Append-only tables are append-only

`certifications` and the seven event logs have **no `updated_at` and no trigger**. They are
evidence. Nothing in the design expects them to be updated.

There is deliberately **no unique constraint on `certifications.draft_id`**. The same draft
certified five times on a byte-identical build produced claim counts of 0, 0, 12, 12 and 16
(`DEV-HANDOVER.md` trap 3). A schema permitting only one certification per draft would
quietly assert a determinism the engine has been measured *not* to have.

### No credentials, ever

`redbot.accounts` holds no password, cookie, token or session. Those stay in
`data/chrome-profile*/` and `data/operators/`, which are gitignored and live on one machine.
A database gets dumped, backed up and copied around; a session cookie that lands in one is
in every dump forever. `profile_dir` is a path, not a secret.

---

## Gotchas

**The volume path is not the traditional one.** `postgres:18-alpine` sets
`PGDATA=/var/lib/postgresql/18/docker` and declares its VOLUME at `/var/lib/postgresql` —
not the historical `/var/lib/postgresql/data`. Mounting the old path against an 18 image
gives you a container that runs perfectly and persists **nothing**. The compose file mounts
the volume the image itself declares. Verified with `docker image inspect`.

**The port is bound to 127.0.0.1 explicitly.** Docker's usual `"5432:5432"` binds `0.0.0.0`
and punches through the Windows firewall. redbot is local-first and sits beside live session
cookies; the database has no business listening on a LAN.

**The migration ledger lives in `public`, not `redbot`.** `0001_init.down.sql` drops the
`redbot` schema, which would take the ledger with it. `public.schema_migrations` survives a
full teardown.

**`ALTER TYPE … ADD VALUE` and transactions.** Migrations are wrapped in a transaction by
default. For the rare statement Postgres refuses to run inside one, start the file with
`-- +no-transaction`.

---

## Resetting

```powershell
docker compose -f db/docker-compose.yml down -v    # -v also drops the data volume
docker compose -f db/docker-compose.yml up -d
node db/migrate.mjs up
```

---

## Running the tests

`npm test` runs with `--env-file=db/.env.test`, which points `POSTGRES_DB` at
`redbot_test`. Without that the suite would read and write the real `redbot` database —
the operator's evidence — which is the failure mode `REDBOT_DATA` exists to prevent for
the file store (`src/config.ts:15`).

```powershell
node db/setup-test-db.mjs           # create + migrate redbot_test (safe to re-run)
node db/setup-test-db.mjs --reset   # drop and rebuild from empty
npm test
```

The setup script refuses to run if `db/.env.test` names `redbot`.

**The suite now needs a running container.** That is a real cost of moving the store into
Postgres: tests used to run against temp directories with no external dependency. If the
container is down, `npm test` fails rather than silently passing against nothing.

## What writes where

Every table is wired to the application. Nothing in the domain appends to JSONL any more.

| tables | written by |
|---|---|
| `threads`, `thread_comments`, `gap_analyses`, `gaps`, `opportunity_assessments`, `drafts`, `history` | `src/store.ts` |
| `certifications` + its 6 child tables | `src/argus/pipeline.ts` |
| `jobs`, `accounts` | `src/jobs.ts` |
| `observations` | `src/health.ts` |
| `reviews`, `regret` | `src/review.ts` |
| `interactions` | `src/interactions.ts` |
| `trace` | `src/trace.ts` |
| `confirmations` | `src/confirm.ts` |

Two things changed shape rather than just location:

**The job claim is no longer a lock file.** `claimJob` was an O_EXCL `.claim` file plus
`stealAbandonedClaim` to recover a worker killed between taking the lock and writing its
`running` row. It is now one statement — `UPDATE … WHERE state IN ('pending','scheduled')`
— so the claim and the state change are the same write and that window cannot open.
`releaseClaim` survives as a documented no-op: the state *is* the claim.

**`trace()` stays synchronous.** It is called from dozens of sync call sites and its
contract is that telemetry never takes the run down. The write is fire-and-forget and
tracked; `flushTrace()` awaits outstanding writes so a short command cannot exit with its
own telemetry still on the wire.

## Still to do

- **No backfill.** Nothing imports existing `data/*.json` / `*.jsonl` into these tables. On
  this machine that is moot: `data/` holds one file (`ui-status.json`) and no threads,
  drafts or certifications ever existed. On a machine with real evidence, that import must
  be written before the switch is safe.
- **The corrupt-file quarantine no longer covers the domain.** `readJson` (`src/store.ts`)
  still moves an unparseable file aside rather than overwriting it, but the domain is no
  longer in files, so that protection now applies only to `session.json` and friends. The
  database's equivalent is its constraints — see the table above.
- **Test isolation is per-run, not per-file.** `db/reset-test-db.mjs` empties the database
  once before the suite; files then run in parallel and share it. A test that counted rows
  globally rather than filtering by its own account or id would be flaky. None does today.
