# Evidence pack — migration checksum drift, 2026-08-04

**Why this exists.** The receiving engineer marked three claims **SUSPECTED — not proven**, and was
right to. This file replaces the reproduced-from-description parts with primary data taken off the
affected machine, and states plainly which claims are still unmeasured and who can measure them.

Nothing here is asserted from a source comment unless it says so.

Paths are scrubbed: `<user>` replaces the Windows account name.

---

## 1. The ledger, taken from the database rather than described

Previously: *"I have still never seen his database; I reproduced his state from his description."*
Fair. Here it is, read directly with `node:sqlite` in read-only mode.

### `%APPDATA%\redbot\data\redbot.db` — PROD, running 2.0.0

```
version  checksum          applied_at                name
0001     aa2d529d31222113  2026-07-31T13:10:26.688Z  init
0002     4cbcf9d2990dead0  2026-07-31T13:10:26.692Z  accounts
0003     7c465ca07008cc34  2026-07-31T13:10:26.695Z  threads
0004     e0d460e8e331da21  2026-07-31T13:10:26.697Z  gap_analyses
0005     bf8040d9251c3e61  2026-07-31T13:10:26.698Z  opportunity_assessments
0006     668fdff2a94b3f88  2026-07-31T13:10:26.699Z  drafts
0007     e7d63fc638f41aa4  2026-07-31T13:10:26.703Z  certifications
0008     1efd148d045acf0b  2026-07-31T13:10:26.706Z  jobs
0009     8824faa6d39b086a  2026-07-31T13:10:26.708Z  event_logs
0010     b67fe38ad53591d3  2026-07-31T13:10:26.715Z  event_log_completeness
0011     1e8e84a2e087c57f  2026-07-31T13:10:26.716Z  credentials
0012     0289fccd5a96ba08  2026-07-31T13:10:26.717Z  sources
0013     f40f206c2b7edfee  2026-07-31T13:10:26.718Z  account_machines
0014     57a325bf935f4367  2026-07-31T13:10:26.720Z  thread_prefilter
0015     d168568d25374d66  2026-07-31T13:10:26.723Z  selected_account

rows = 15    account_proxies = MISSING
```

### `%APPDATA%\redbot dev\data\redbot.db` — DEV, running 1.0.12, same machine

Identical checksums, different `applied_at` — written by a different install on 2026-08-03.

```
0001 aa2d529d31222113 · 0002 4cbcf9d2990dead0 · 0003 7c465ca07008cc34 · 0004 e0d460e8e331da21
0005 bf8040d9251c3e61 · 0006 668fdff2a94b3f88 · 0007 e7d63fc638f41aa4 · 0008 1efd148d045acf0b
0009 8824faa6d39b086a · 0010 b67fe38ad53591d3 · 0011 1e8e84a2e087c57f · 0012 0289fccd5a96ba08
0013 f40f206c2b7edfee · 0014 57a325bf935f4367 · 0015 d168568d25374d66

rows = 15    account_proxies = MISSING  (expected — 1.0.12 has no 0016)
```

### The match, computed rather than eyeballed

Every ledger row compared against both hashings of the same file:

```
PROD ledger rows 15 | match CRLF: 15 | match LF: 0
DEV  ledger rows 15 | match CRLF: 15 | match LF: 0
```

**Measured.** Both ledgers are CRLF, 15/15, zero LF matches. The heal has a real corpus to run
against, not an assumed one.

---

## 2. Both hashings of every migration

For testing a bidirectional heal. Left column is what a Windows checkout produces; right is what
the git object store holds and what a Linux/CI build ships.

| migration | CRLF | LF |
|---|---|---|
| 0001_init | `aa2d529d31222113` | `3495e98e3a607ea1` |
| 0002_accounts | `4cbcf9d2990dead0` | `d2fc234ceda31801` |
| 0003_threads | `7c465ca07008cc34` | `0fd288e572fd129a` |
| 0004_gap_analyses | `e0d460e8e331da21` | `0566205823b088dd` |
| 0005_opportunity_assessments | `bf8040d9251c3e61` | `5975d13ba862555a` |
| 0006_drafts | `668fdff2a94b3f88` | `70d9700d465c0493` |
| 0007_certifications | `e7d63fc638f41aa4` | `89158a0632002852` |
| 0008_jobs | `1efd148d045acf0b` | `277702a8fc6d865e` |
| 0009_event_logs | `8824faa6d39b086a` | `99d75cf29cce5d4b` |
| 0010_event_log_completeness | `b67fe38ad53591d3` | `8575ec0631578276` |
| 0011_credentials | `1e8e84a2e087c57f` | `bbca3a0439fc5306` |
| 0012_sources | `0289fccd5a96ba08` | `8b0db4f1d9b5dad7` |
| 0013_account_machines | `f40f206c2b7edfee` | `22149a812f6e77b4` |
| 0014_thread_prefilter | `57a325bf935f4367` | `22e29faca55076d7` |
| 0015_selected_account | `d168568d25374d66` | `09549956d58798b4` |

Generated with the same expression `migrate.mjs:163` uses —
`createHash('sha256').update(body).digest('hex').slice(0,16)` — over the file as-is and over
`body.replace(/\r\n/g,'\n')`.

---

## 3. Boot logs, verbatim

```
PROD  %APPDATA%\redbot\boot.log
  2026-08-04T02:26:38.237Z  --- boot --- electron 43.2.0 node 24.18.0
  2026-08-04T02:26:38.494Z  database    C:\Users\<user>\AppData\Roaming\redbot\data\redbot.db
  2026-08-04T02:26:38.494Z  schema      Applied migrations have changed on disk:
  2026-08-04T02:26:38.495Z  note        migrations failed: Applied migrations have changed on disk:

DEV   %APPDATA%\redbot dev\boot.log
  2026-08-03T13:57:41.477Z  schema      sqlite 3.53.1, 15 migration(s) applied
```

One machine, two installs, byte-identical ledgers. The locally-built 1.0.12 applies cleanly; the
externally-built 2.0.0 aborts. **The machine is constant; the build varies.**

---

## 4. Why this is a repo property, not a machine property

| Check | Result |
|---|---|
| Any migration edited locally? | No — `git status` clean; all 30 up/down files identical to `v2.0.0` after stripping CR; **0** content differences |
| `core.autocrlf` set by hand? | No — unset at local, global, and `core.eol`. Resolves `true` from `C:/Program Files/Git/etc/gitconfig`, the Git-for-Windows installer default |
| Repo states a preference? | No — `git check-attr text eol` → `unspecified`; **`.gitattributes` absent at HEAD and at `v2.0.0`** |
| Git's view of the tree | unmodified |

```
0001_init.up.sql in the git object store : 4577 bytes, CRLF false
0001_init.up.sql on a Windows checkout   : 4649 bytes, CRLF true
```

`electron-builder` packs the working tree, so the artifact's line endings follow the build host.
Latent since the repo's first commit; 2.0.0 is simply the first release built on a host other than
the one that wrote this ledger.

**Three states, not two:** CRLF ledger + CRLF build → clean · LF + LF → clean · **CRLF + LF →
aborts**. A machine that applies 16 cleanly is the prediction, not a refutation. The distinguishing
query, whose every answer confirms rather than refutes:

```sql
SELECT checksum FROM schema_migrations WHERE version='0001';
-- 3495e98e3a607ea1 -> LF ledger, LF build, agree
-- aa2d529d31222113 -> CRLF ledger, so a CRLF build
```

---

## 5. Claims I am withdrawing to SOURCE-QUOTED, not measured

The challenge was right and this is the correction.

**A5, A6, A7 — timezone override, zero ICE candidates, zero connections through a dead relay.**
I presented these as measured. They are **quoted from the module header of `src/proxy/align.ts`**,
written by whoever built 2.0.0. I did not re-run any of them, and nobody re-ran them in the session
that produced the handover. The header records:

```
TZ=America/New_York as an environment variable   IGNORED — still Asia/Manila
--lang=en-US as a launch flag                    IGNORED — navigator.language unchanged
CDP Emulation.setTimezoneOverride                WORKS — Manila -> New York, +8 -> -4
 ...and it survives navigation                   YES
 ...on a tab redbot did not create               NO — reports Asia/Manila
WebRTC, no mitigation                            LEAKS a real public address over UDP
WebRTC, init script on the CONTEXT               blocked, 0 candidates
```

Treat that as **the author's report, not independent verification.** Correct status: *claimed by
the implementation, unverified by the operator.* Any acceptance criteria list should mark A5–A7
accordingly until someone re-runs them.

The zero-connections-through-a-dead-relay result is likewise from `tools/product/server.mjs`
around the launch-state comment, not from a run this session.

---

## 6. `navigator.language` — genuinely open, and it does not need a bound account

Currently blocked on a circular dependency: it needs a bound account → which needs `0016` → which
needs this fix. That circle is breakable.

`Emulation.setLocaleOverride` is a plain CDP call against a target. It can be tested against **any**
Chrome on a debug port with no redbot account, no proxy and no database:

1. start Chrome with a remote debugging port;
2. attach, send `Emulation.setLocaleOverride` with e.g. `en-US`;
3. evaluate `navigator.language`, `navigator.languages`, and
   `Intl.DateTimeFormat().resolvedOptions().locale`;
4. navigate, re-evaluate — the timezone override survives navigation, so the question is whether
   this one does too;
5. repeat on a tab the process did not create — that is where the timezone override is already
   recorded as failing.

Worth pairing with an `Accept-Language` header check via `Network.setExtraHTTPHeaders`, since a
page can read the header and the JS value independently and a mismatch between them is its own
signal.

This settles D-5 without waiting on anything.

---

## 7. Unrelated finding, surfaced while checking the free-proxy path

`src/proxy/vet.ts:265` — *"Any FAIL fails; WARNs are surfaced and do not block."* And `proxy flag`,
`hosting flag` and `mobile flag` are all WARN.

**Consequence:** a free, shared, datacenter address that is reachable, in the requested country and
stable will return **PASS** and can be bound to a real account, with only a printed warning. Nothing
in the software prevents it.

The header's reasoning is sound in the general case — an ISP proxy is a datacenter-hosted address
carrying an ISP's ASN, so auto-failing on `hosting` would reject the entire product category. But
where the target platform blocks datacenter ASNs wholesale, that signal is much less arguable than
the general case it was written for.

**Open question, not a defect claim:** should `hosting` be a FAIL when the stated intent is a
residential exit, or should binding require an explicit override once it warns? Owner's call. It
does not block anything.

---

## 8. How to attack this

Stated so the claims can be falsified rather than accepted.

| Claim | What would refute it |
|---|---|
| The ledger is CRLF | A `SELECT checksum FROM schema_migrations WHERE version='0001'` on the affected DB returning anything but `aa2d529d31222113` |
| Only line endings differ | Any of the 15 migrations differing after `tr -d '\r'` — currently 0 of 30 up/down files |
| The build host decides | A Windows-built artifact shipping LF migrations, or a Linux-built one shipping CRLF |
| The heal is safe both ways | A ledger row whose stored value matches neither hashing of the current file — that is genuine drift and must still refuse |
| A5–A7 | Nothing — they are unverified by us and are labelled as such above |

---

## Provenance

Read 2026-08-04 from: both installed applications' SQLite stores (read-only), both `boot.log`
files, the working checkout at `bot-optimization` = `b4cf17e`, and `git show v2.0.0:` for source
quotations. Checksums computed with the expression at `migrate.mjs:163`. No application was
started, no database was written, no migration was run to produce this file.
