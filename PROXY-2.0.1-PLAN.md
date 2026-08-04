# PLAN — redbot 2.0.1: unblock the per-account exit MVP

**Author:** Dan (development) · **Date:** 2026-08-04
**Responds to:** `HANDOVER-PROXY-MVP-2026-08-04.md` (Jerome)
**Basis:** every claim below was measured against this checkout and the two live databases on this
machine on 2026-08-04. Where the handover and the code disagree, the code is quoted.

---

## STATUS — implemented 2026-08-04, in the working tree, NOT released

| Step | State | Proof |
|---|---|---|
| D-1 canonical checksum + bidirectional heal | **done** | a 15-row CRLF ledger reproduced the exact reported failure on the HEAD runner (`ledger aa2d529d31222113 != file 3495e98e3a607ea1`, exit 1); the new runner re-stamped 15 rows, applied 0016, exit 0 |
| D-2 `.gitattributes` | **done** | `git checkout-index` on `0001_init.up.sql` went from 4,649 B / `aa2d529d31222113` / CRLF to 4,577 B / `3495e98e3a607ea1` / LF; `redbot.cmd` deliberately unaffected |
| D-3 pending is visible | **done** | on a 15-of-16 database: `ping().ok=false` naming `0016`, blocking `database` requirement red, `db:verify` exit 1 |
| D-6 uncovered-tab residual | **done** | rendered from the real `exitLine` source with the real stylesheet; present on `exit ready` + `exit live`, absent on `exit changed` + `no proxy` |
| D-7 regression guard | **done** | 6 tests; 4 fail on the HEAD runner, 6 pass on the fix; registered in `npm test` |
| D-4 release | **config + build only** | `artifactName` set; local 2.0.1 build has disk name == `latest.yml` path. **Not tagged, not pushed, not published — that is the user's call.** |
| D-5 `navigator.language` | **not done — blocked** | the code already ships (C-C); confirming it needs a bound account on a real purchased exit, which does not exist yet. Spike S-1 stands. |

---

## 0. Verdict on the handover

The handover is **substantially correct on the mechanism and wrong on the blast radius**. Its
diagnosis — a checksum over raw file bytes is sensitive to line endings — is right, and it is the
right thing to fix. Four of its factual claims do not survive contact with this machine.

### Confirmed

| Claim | Evidence |
|---|---|
| `migrate.mjs:156-163` hashes the raw file | read; `readFileSync(...,'utf8')` → `createHash('sha256').update(body)` |
| Drift refusal is real and fail-closed | `assertNoDrift` `migrate.mjs:183-192` → `die()`; called from `cmdUp:227` and `cmdStatus:202` |
| No `.gitattributes` in the repo | `ls .gitattributes` → No such file |
| `0001_init.up.sql` CRLF = 4,649 B = `aa2d529d31222113` | reproduced via `git checkout-index` |
| `0001_init.up.sql` LF = 4,577 B = `3495e98e3a607ea1` | reproduced from the worktree |
| Content differs **only** in line endings | all 16 up-migrations: `same=true` after `\r\n`→`\n` |
| Console has the complete exit write path | `server.mjs:2736,2740,2744,3080` |
| `account_machines.relay_port` shipped in 0016 | `PRAGMA table_info` → `...,debug_port,selected,relay_port,...` |

### Corrected — these change the work

**C-A · The blocker is not reproducible on this machine. It is Jerome's machine that is stuck.**

Both local databases are healthy *right now*:

```
installed  %APPDATA%\redbot\data\redbot.db   16 rows, 0016 applied 2026-08-04T01:13:00Z
dev        data\redbot.db                     16 rows, 0016 applied 2026-08-03T14:41:28Z
tables     account_proxies · account_exit_ips · account_machines.relay_port   all present
```

Every ledger checksum on both DBs is the **LF** value. This machine's `boot.log` contains **no
`2026-08-04T02:26` entry at all**; its last boot reads
`2026-08-04T02:25:32.816Z schema sqlite 3.53.1, 16 migration(s) applied`. The only
`migrations failed` line in the entire log is dated **2026-08-02T07:39:14**.

So **acceptance A1 and A2 already pass here.** The failing log in §2 of the handover came from
Jerome's install, whose ledger was written 2026-07-31 by a CRLF source run. The fix must be judged
by whether it heals *that* database, and it cannot be verified by booting this one.

**C-B · The bug is live, armed, and pointed the other way.**

`core.autocrlf = true` is set on this machine. The blobs in git are already LF (`git show
HEAD:db/sqlite/migrations/0001_init.up.sql | wc -c` → 4,577), but the checkout smudge re-expands
them:

```
git checkout-index --prefix=<tmp>/ -- db/sqlite/migrations/0001_init.up.sql
  → 4,649 bytes · hash aa2d529d31222113 · hasCRLF: true
```

The worktree currently holds LF files — something rewrote them after checkout — so git reports
`db/sqlite/` clean while a fresh clone or a `git checkout -f` would produce CRLF. **The next clean
checkout on this machine breaks both local databases**, which now hold LF checksums. This is the
same bug in the opposite direction, and it is why a one-way "re-stamp CRLF as LF" heal is not
enough. The heal must be **bidirectional**.

It also explains "build from the same machine": the variable was never the machine, and it is not
stable on one machine either.

**C-C · D-5 is already built.** The handover asks for `Emulation.setLocaleOverride` as new work.
It is on the launch path today:

```js
// tools/product/server.mjs:1876-1882 — coverProxiedBrowser()
locale: exit.proxy.country ? `en-${exit.proxy.country}` : null,
// src/proxy/align.ts:231
if (opts.locale) await cdp.send('Emulation.setLocaleOverride', { locale: opts.locale });
```

D-5 is therefore **a measurement, not a build** — see spike S-1. What is unverified is whether that
CDP call moves `navigator.language` on Chrome 150, not whether the code exists.

**C-D · D-3's blind spot is wider and simpler than described — it is three surfaces, one cause.**

Nothing in the health path has a concept of *pending*:

1. `dbUnavailableReason()` (`src/db.ts:170-176`) is `existsSync(dbFile())` and nothing else. This is
   what `/api/setup` renders as `database: { ok: true }`.
2. `ping()` (`src/db.ts:601-641`) returns `ok:true` for **any** ledger with ≥1 row. It never compares
   against what is on disk. This is the *blocking* `database` requirement
   (`src/requirements.ts:118-122`), so the first-boot gate passes too.
3. `EXPECTED_TABLES` (`migrate.mjs:333-341`) omits `account_proxies` and `account_exit_ips` — its
   comment still says "the 14 migrations". So **`npm run db:verify` passes on a database with 0016
   missing**, which is the one command whose entire job is to catch that.

A migration failure is invisible in all three. The console's `exitLine` (`index.html:3222+`) is the
sole place that even contemplates it, in its `unknown` state.

**C-E · The release-naming trap is structural, not a checklist item.** `electron-builder.yml` sets no
`artifactName`. Disk holds `release/redbot Setup 2.0.0.exe` (spaces) while `release/latest.yml`
names `redbot-Setup-2.0.0.exe` (hyphens). Fix it in config once instead of remembering it each time.

---

## 1. What "done" means for this plan

Unchanged from the handover's MVP definition. This plan delivers **D-1, D-2, D-3, D-7 and the 2.0.1
release (D-4)**, which is everything that stands between Jerome and step O-1. D-5 becomes a spike;
D-6 is a small UI truth-telling change. Nothing in §9 (C-1…C-7) or §10 (X-1…X-5) is in scope here —
they are assessed in §6.

---

## 2. The critical surface

| File | Lines | Change |
|---|---|---|
| `db/sqlite/migrate.mjs` | 156-163 | canonical checksum |
| | 183-192 | `assertNoDrift` → classify + bidirectional heal |
| | 222-234 | `cmdUp` heals inside a transaction, logs each re-stamp |
| | 198-220 | `cmdStatus` reports healable, stays read-only |
| | 333-341 | `EXPECTED_TABLES` += the 0016 tables |
| `.gitattributes` | new | pin `*.sql` / `*.mjs` under `db/sqlite/` to LF |
| `src/db.ts` | 601-641 | `ping()` learns what "pending" is |
| `src/requirements.ts` | 118-122 | inherits it — no change if `ping()` carries the detail |
| `tools/product/server.mjs` | 1468-1528 | `/api/setup.database` stops meaning `existsSync` |
| `db/sqlite/migrate-heal.test.mjs` | new | D-7 regression guard |
| `package.json` | `test` script | register the new test file (the glob lists files explicitly) |
| `electron-builder.yml` | ~83 | `artifactName` |

**Data flow being repaired:** `migrate.mjs up` (spawned by `provision.ts:206 ensureSchema`, which
sets `REDBOT_DB` and `ELECTRON_RUN_AS_NODE`) → ledger → `ping()` → `checkRequirements()` →
`/api/setup` → Setup screen. The failure today enters at step 1 and is swallowed by step 3.

**Blast radius:** the migration runner gates every boot of every install. A heal that is too
permissive silently disables the only protection against an edited applied migration. That is the
risk this plan spends most of its care on.

---

## 3. The work, in order

### Step 1 · D-1 — bidirectional canonical heal · **BLOCKER**

**Decision.** Checksums become canonical (`\r\n` → `\n` before hashing). Because that changes every
checksum, it ships *with* a heal that re-stamps a drifted row **only when the ledger's value equals
the hash of the current file in some line-ending form**.

```js
const canon   = (s) => s.replace(/\r\n/g, '\n');
const h       = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const checksumOf = (body) => h(canon(body));

// The only values a legitimate earlier run could have written for THIS content.
const legacyForms = (body) => {
  const lf = canon(body);
  return new Set([h(body), h(lf), h(lf.replace(/\n/g, '\r\n'))]);
};
```

`assertNoDrift` splits into `classifyDrift(files, done) → { healable, genuine }`:

- `ledger.checksum === checksumOf(file)` → fine.
- `legacyForms(file).has(ledger.checksum)` → **healable** (identical SQL, different bytes).
- otherwise → **genuine**, `die()` exactly as today.

`cmdUp` re-stamps every healable row in one transaction *before* applying anything pending, and
prints one line per re-stamp:

```
re-stamped  0001_init  ledger aa2d529d31222113 -> 3495e98e3a607ea1  (line endings only)
```

`cmdStatus` reports healable rows as a note and writes nothing — the file header promises `status`
never mutates, and that promise is worth keeping.

**Why not C-5 (store the SQL in the ledger).** It is the better long-term shape and I want it —
but it cannot replace this. Existing ledgers, including Jerome's, have no stored body, so the heal
is still required to read them. C-5 is strictly additive and lands after 2.0.1, at which point it is
cheap. Shipping it now doubles the change on the one code path that gates every boot.

**Done-signal.**
1. `node db/sqlite/migrate.mjs status` on this checkout → 16 applied, 0 pending, no error.
2. Fixture DB with CRLF checksums + LF files → `up` exits 0 and prints the re-stamps.
3. Fixture DB with LF checksums + CRLF files → same.
4. Fixture DB whose `0007` checksum is `deadbeefdeadbeef` → exits 1, message names `0007`.

### Step 2 · D-2 — stop the divergence at source · **BLOCKER-adjacent**

`.gitattributes` at the repo root:

```gitattributes
db/sqlite/migrations/*.sql text eol=lf
db/sqlite/*.mjs           text eol=lf
```

Narrow on purpose. A blanket `* text=auto eol=lf` would also convert `redbot.cmd`, and a batch file
with LF line endings has its own failure modes — not a trade worth making to fix a SQL problem.

The blobs are **already LF**, so no `git add --renormalize` is needed; this only overrides the
checkout smudge. Devs whose worktree already holds CRLF need one re-checkout of that directory.

**Done-signal.** On this machine (`core.autocrlf=true`), after the commit:

```bash
git checkout-index --prefix=<tmp>/ -- db/sqlite/migrations/0001_init.up.sql
# 4577 bytes · 3495e98e3a607ea1   (today: 4649 · aa2d529d31222113)
```

### Step 3 · D-7 — the regression guard · **do it with D-1, not after**

New `db/sqlite/migrate-heal.test.mjs`, run against a temp `REDBOT_DB`:

| Case | Assert |
|---|---|
| CRLF ledger, LF files | exit 0, checksums re-stamped, ledger count unchanged |
| LF ledger, CRLF files | exit 0, re-stamped |
| One genuinely different checksum | exit 1, stderr names the version |
| Clean DB | exit 0, no re-stamp line printed |
| `status` on a drifted DB | exit 0, reports healable, **ledger byte-identical afterwards** |

The last row is the one that keeps `status` honest. Register the file in `package.json`'s `test`
script — that glob names files individually, so a new test file is otherwise never run.

**Done-signal.** `npm test` green, including the new file by name in the output.

### Step 4 · D-3 — make a failed migration impossible to miss · **HIGH, cheap half ships in 2.0.1**

Three edits, in increasing cost:

1. **`EXPECTED_TABLES`** += `account_proxies`, `account_exit_ips`; fix the stale "14 migrations"
   comment. `npm run db:verify` then fails on a 0016-less database. *Two lines.*
2. **`ping()`** counts the `*.up.sql` files on disk and compares. When `applied < onDisk`, return
   `ok:false` with `"15 of 16 migrations applied — 0016_account_proxy is pending"`. Because
   `checkRequirements` already renders `db.detail` into a blocking requirement, the Setup screen
   inherits the fix for free. Cache the `readdir` — `/api/setup` is read on every screen change.
3. **`/api/setup.database`** stops deriving from `dbUnavailableReason()` (existsSync) and uses the
   same `ping()` result as the requirement, so the two cannot disagree.

Item 3 is the only one that touches the console; if the release is time-pressured, 1 and 2 ship and
3 follows.

**Done-signal.** Point a dev build at a DB whose ledger has been trimmed to 15 rows: the Setup
screen shows a red blocking Database row naming `0016_account_proxy`, and `npm run db:verify` exits
non-zero. Neither requires opening a log file.

### Step 5 · D-4 — cut 2.0.1 · **BLOCKER**

1. `artifactName: redbot-Setup-${version}.${ext}` in `electron-builder.yml` so the disk name and
   `latest.yml` agree by construction (C-E). Verify after the build that both read
   `redbot-Setup-2.0.1.exe`.
2. Version → `2.0.1`, `npm test`, `npm run dist`.
3. Release **Published, not draft**; confirm the asset is attached to the release that was actually
   built; confirm `/releases/latest` returns 2.0.1 before telling Jerome.

**Done-signal.** A machine on 2.0.0 takes the update and boots to
`schema sqlite 3.53.1, 16 migration(s) applied`. **On Jerome's machine, not this one** — this one
already reports 16 and would prove nothing (C-A).

### Step 6 · D-6 — state the uncovered-tab residual · **MEDIUM, after the release**

`align.ts:36-37` records the limit in a source comment; the operator cannot see it. Add one line to
the proxied states of `exitLine` (`index.html:3222+`): tabs opened while redbot is not attached are
not covered, and their pages can read this connection's real address over WebRTC.

The seven states there are already carefully distinguished between "safe", "not protected" and "I do
not know" — this belongs in that vocabulary and should not be written as a footnote.

**Done-signal.** The sentence is visible beside a `live` account without hovering or expanding.

---

## 4. Sequencing

```
Step 1 (D-1) ─┬─ Step 3 (D-7) ─┬─> Step 5 (D-4, release 2.0.1) ──> Jerome O-1 … O-6
Step 2 (D-2) ─┘                │
Step 4 (D-3, items 1+2) ───────┘
Step 4 item 3, Step 6 (D-6), spikes S-1..S-3   — parallel, none block
```

Steps 1–3 are one commit: the canonical checksum, the thing that stops it recurring, and the test
that proves both. Splitting them ships a checksum change with no heal, which *is* the bug.

**Rollback.** All of it is additive to the runner and reversible by revert. The heal only ever
rewrites a `schema_migrations.checksum` to the canonical hash of SQL it just proved identical — no
schema object is touched. If 2.0.1 is wrong, 2.0.0 installs still boot exactly as they do today.

**If 2.0.1 slips**, the handover's §7 workaround stands and I have verified its premise:
`provision.ts:206` spawns `migrate.mjs up` with `REDBOT_DB` set, so renaming (never deleting)
`%APPDATA%\redbot\data\redbot.db` rebuilds all 16 from zero. Note that the *dev* data directory
holds signed-in Chrome profiles — same warning, and it applies to this machine.

---

## 5. Risks, and the one that matters

**R-1 · The heal disables the protection it is embedded in.** This is the real risk. If the
candidate set were fuzzy — "close enough", or a whitespace-insensitive compare — a genuinely edited
migration would be re-stamped and the database and repository would diverge silently forever.
Mitigation: the candidate set is exactly three exact hashes of the current file's own content; every
re-stamp is printed; and the D-7 fixture asserts the genuine-edit case still exits 1. **If that test
is not written, do not ship the heal.**

**R-2 · `ping()` is on a hot path.** It is called per `/api/setup`, which the console reads on every
screen change. A `readdirSync` of 32 entries is negligible next to the sqlite queries already there,
but it should be cached rather than left to grow a second reader of the migrations directory.

**R-3 · Healing masks a real question.** After 2.0.1, a CRLF/LF mismatch heals silently-ish. That is
correct behaviour, but D-2 is what actually removes the divergence; the heal is the safety net, not
the fix. Ship both or the repo keeps generating the condition.

**R-4 · The MVP acceptance table cannot be self-certified here.** A1–A2 already pass on this
machine (C-A) and A3–A8 need Jerome's install and two purchased IPs. This plan can prove the *fix*;
it cannot prove the *MVP*. Saying otherwise would be exactly the wrong claim.

---

## 6. Spikes — unknowns not to plan as settled

**S-1 · Does `Emulation.setLocaleOverride` move `navigator.language` on Chrome 150?** The call
already ships (C-C). Read `navigator.language` and `navigator.languages` in an aligned page on a
proxied account. If it works, D-5 is closed and the handover's §D-5 is simply out of date; if it does
not, the decision is `Network.setUserAgentOverride` with `acceptLanguage`, or a written
accepted-residual next to D-6's sentence. **Cost: minutes, needs one bound account.**

**S-2 · What is actually in Jerome's ledger?** I inferred CRLF checksums from the handover's table
and could not read that database. The bidirectional heal is safe under either answer, which is
precisely why it is bidirectional — but the *proof* comes from the D-7 fixture, not from Jerome's
machine. Ask for the ledger dump (the handover's own appendix command) before shipping, as
confirmation rather than as a dependency.

**S-3 · Does `artifactName` change the `latest.yml` URL as intended?** Verify on the 2.0.1 build
before publishing, not after — this trap has already cost one release.

---

## 7. On §9 and §10 of the handover

Assessed, deliberately out of scope here, and worth saying why rather than leaving them unanswered.

- **C-3 (heartbeat the exit, stop the relay on mismatch)** is the strongest item in §9. The relay
  already sees every connection, `account_exit_ips` already records `matched_pin`, and
  `manager.ts:258-270` already knows how to refuse a changed address — it just does not run again
  after launch. Small, and it converts a recorded fact into an action. **Recommend next after 2.0.1.**
- **C-5** — adopt, right after D-1, for the reasons in Step 1.
- **C-7 (the `one_account_per_exit_ip` index is wrong for mobile exits)** is correct and free to
  defuse *before* anyone buys a mobile IP. Cheap now, a confusing bug later.
- **C-1 (fingerprint as the identity unit)** — the argument that two accounts on one box still share
  a high-entropy fingerprint is sound, and `src/rand.ts` really does have the seeded PRNG it
  proposes. It is days of work and it is not what is blocking the MVP.
- **C-2 (VPS per account)** — not until the account count justifies it, and the handover says so
  itself.
- **§10 X-1 (intake gate for acquired accounts)** is the highest-value item in the whole document
  and it is nearly free: `observe.ts:22` already opens an incognito context for a signed-out read and
  `probe-karma.ts` already reads age and karma. Pointing them at an account *before* purchase costs
  little and prevents binding a paid IP to a shadowbanned account. **If any account is bought before
  2.0.1 ships, do X-1 first.**

The handover's closing point — that redbot has published zero replies and every certification is
REJECT, so per-account exits protect throughput that does not exist yet — is a fair challenge to the
priority of this whole workstream. It is a question for the business, not a reason to leave the
migration runner broken.

---

## 8. What I have not verified

- Jerome's database and boot.log — inferred from the handover only (S-2).
- Every measurement in the handover's Chrome 150 table (TZ env ignored, `--lang` ignored, WebRTC
  leak without the fence). Taken as reported; not re-run this session.
- That the published 2.0.0 asar carries LF migrations. Consistent with this machine's install
  applying 0016 with the LF checksum, but the asar itself was not extracted.
- Anything in the MVP acceptance table A3–A8 — it needs purchased IPs and Jerome's install.
