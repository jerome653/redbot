# redbot 2.0.0 — per-account exit IP: what it is, what it proves, what it does not

**For:** Dan
**From:** Jerome
**Date:** 2026-08-04
**Subject:** the proxy release, the one defect blocking it, and what to buy — or not buy

---

## 0. Read this first — the honest verdict

The engineering is good and the feature is real. **It is not a fix for the problem it is being bought to fix**, and the difference matters before anyone spends money.

### What is provable today

| Claim | Status |
|---|---|
| Two accounts cannot share an exit IP | **Enforced by the schema** — `CREATE UNIQUE INDEX one_account_per_exit_ip` |
| The browser's timezone can be made to match the exit | **Measured** — CDP `Emulation.setTimezoneOverride`, Manila → New York, +8 → −4, survives navigation |
| WebRTC will not leak the real address | **Measured** — init script on the context, 0 candidates |
| A bad proxy can be rejected before purchase | **Yes** — `redbot proxy vet` with no account writes nothing and costs nothing |

### What is NOT proved, and must not be claimed

1. **"We get flagged from the Philippines" has never been measured.** The one test on record (2026-07-27) put a post up from PH residential (AS9299 PLDT), desktop Chrome, no proxy — and it was **visible to a logged-out stranger with the author intact**. Shadow-flagged content is invisible to strangers. Ours was not. Limits are real and stated: 1 post, 1 day, 1 account, r/test (no automod), and posts are not comments. But it is the only measurement anyone has, and it points the other way.

2. **Existing accounts keep their origin.** From `src/proxy/vet.ts`:
   > *"Reddit ties an account to the address it first appeared from and there is no undo."*

   `docs-architect` and `jrum_sgen` already first appeared from PH. Putting them behind a US exit now is a change of address, not a clean origin. **The 1:1 design pays off on accounts that do not exist yet.**

3. **A stated residual, from the source, not from me** (`src/proxy/align.ts`): a tab opened while redbot is *not* attached gets no WebRTC fence and no timezone override. `WebRtcIPHandling` is an enterprise policy and no working Chrome 150 command-line flag is confirmed. **Any manual browsing in those profiles outside redbot leaks.**

4. **`navigator.language` is not covered.** Measured: `--lang=en-US` as a launch flag is IGNORED, `navigator.language` unchanged. Alignment overrides timezone and WebRTC only. A US address with a PH language string is a contradiction one line of JavaScript can read.

5. **A proxy fixes exactly one signal.** It does nothing about behavioural correlation, posting timing, content similarity, signup phone/email, subreddit overlap, or device fingerprint.

6. **Throughput is zero regardless of IP.** redbot has published **0 replies, ever**. Every certification on record is REJECT. The scheduler refuses all four write kinds (`PUBLISH_KINDS = ['publish','reply','reply-comment','post']`) *before* a runner is looked up, with a test asserting a publish job stays `waiting` even with a working runner registered. A person types SEND. **Proxies do not move that number by one.**

### So — win or not

**Win, narrowly and genuinely:** it removes shared-IP correlation between accounts, and it does the two things that make a proxy safe rather than counter-productive. This is worth having.

**Not a win for the stated goal.** "As many accounts as possible, with karma" is not what this release delivers, and nothing in redbot delivers it — the tool is built to *refuse* volume publishing.

**One thing worth saying plainly, from `align.ts`:**
> *"Change only the IP and you manufacture a contradiction that one line of JavaScript can read — a US address announcing Manila time... Both are stronger signals than an unproxied account gives off at all."*

If anyone buys proxies and points Chrome at them **without** this release, they make the accounts **easier** to spot, not harder. That is the strongest argument for 2.0.0 and against a DIY proxy setup.

### Recommendation

Do **not** buy N proxies yet. Buy **one**, vet it for free, and hold. The gating question is a business decision nobody in the codebase can answer: **how many accounts, and do they disclose SGEN?** Two or three disclosed accounts on residential IPs is one legal object; ten-plus undisclosed accounts posing as independent is astroturfing, and FTC 16 CFR 255 lands on SGEN, not on the accounts. Note also that redbot **mechanically refuses to name SGEN** (`config.brand.forbidMention = true`, `disclosure.ts` blocks any mention), so these accounts earn karma and cannot promote anything until someone changes that deliberately.

---

## 1. What 2.0.0 actually ships

Tag `v2.0.0` = commit `3eff436` on `origin/main`, exactly **one commit** past `b4cf17e` (1.0.12). 23 files, +4,229 lines.

| Module | Job |
|---|---|
| `src/proxy/relay.ts` | Loopback credential injector — the reason this needs code at all |
| `src/proxy/vet.ts` | Judge an exit address before an account signs in through it |
| `src/proxy/align.ts` | Make the browser agree with the address (timezone + WebRTC) |
| `src/proxy/health.ts` | Reachability + JSON fetch through the upstream |
| `src/proxy/credential.ts` | Seals proxy user/pass into the vault |
| `src/db/proxies.ts` | Row mappers for the two new tables |
| `src/commands/proxy.ts` | `redbot proxy vet` CLI |
| `db/sqlite/migrations/0016_account_proxy` | Schema |
| `tools/product/*` | Console: exit line per account, `/api/account/exit` |

### Why a relay exists (two simpler designs are dead — both measured)

From `src/proxy/relay.ts`:

1. **IP-whitelist auth** — let the provider authorise this machine's public IP, no credentials needed. **Rejected: this connection's public IP is dynamic.** Two clean runs minutes apart exited from `126.209.19.165` and `180.191.139.234` — different /8. A whitelist entry goes stale with no warning and every account fails to launch.
2. **Credentials on the command line** — `--proxy-server="http://user:pass@host"`. **Chrome ignores the credentials** (crbug 40471183), and the historical workaround (an extension via `chrome.webRequest.onAuthRequired`) is gone: `--load-extension` was removed from branded Chrome in 137, this machine runs 150.

So Chrome is pointed at `127.0.0.1:<relayPort>` and the relay adds the credential on the way out. It binds loopback only, never starts without a credential, and never puts the credential in a log or an error.

### Schema — where each fact lives, and why

- `account_proxies` (keyed by handle) — the leased IP is an **account-level identity fact**; it travels with the account to any machine.
- `account_machines.relay_port` — the relay port is **machine-local**, so it sits with `debug_port`.
- `account_exit_ips` — **append-only ledger** of what the exit actually was, every time anything looked (`via` ∈ `vet|launch|run|doctor`, plus `matched_pin` recorded at the time). A residential exit is somebody's device holding a tunnel open; it can drop and the address changes underneath a live session. A single "last seen" column would overwrite the evidence of exactly that.
- Credentials go to the **vault** (AES-256-GCM under a key the database never holds), scope = `lower(handle)`, name = `proxy_auth`.
- `0016` deliberately does **not** add columns to `accounts`. SQLite cannot attach a CHECK to an ALTER-added column, so it would mean rebuilding `accounts` — and with `PRAGMA foreign_keys = ON` a DROP fires the referential actions. **Measured 2026-08-03** on a fixture with the same four relationships: `before jobs=1 drafts=1` → `after jobs=0 drafts=1 drafts.account=null`, while reporting success. That rebuild silently destroys every job and orphans every draft. Worth knowing before anyone "simplifies" this table.

---

## 2. 🔴 The defect blocking all of it

The installed 2.0.0 boots, then logs:

```
2026-08-04T02:26:38Z  schema  Applied migrations have changed on disk:
2026-08-04T02:26:38Z  note    migrations failed
```

`migrate` aborts before reaching `0016`, so **`account_proxies`, `account_exit_ips` and `account_machines.relay_port` do not exist**. Verified against the live database — 15 migrations recorded, `account_proxies` absent. The console reports the database as healthy; nothing surfaces this in the UI.

### Root cause — measured, not inferred

`db/sqlite/migrate.mjs:156-163` hashes the raw file body:

```js
const body = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
checksum: createHash('sha256').update(body).digest('hex').slice(0, 16)
```

| | 0001_init.up.sql | checksum |
|---|---|---|
| Windows checkout (CRLF) | 4,649 bytes | `aa2d529d31222113` |
| Installed 2.0.0 `app.asar` (LF) | 4,577 bytes | `3495e98e3a607ea1` |
| **Ledger row, applied 2026-07-31** | — | **`aa2d529d31222113`** |

`diff` after `tr -d '\r'` is empty — the content is identical. **The only difference is line endings.**

The ledger was written by a **source run** on Windows, where git checks out CRLF. The shipped 2.0.0 asar carries LF. Every applied migration therefore reads as drifted, and the runner refuses — correctly, by its own design.

### Why it looked machine-specific before

The 1.0.7 release did **not** show this, and the conclusion at the time was "build releases from the same machine." That was a proxy for the real variable. The `redbot dev` 1.0.12 install, **built on this machine from the CRLF checkout**, boots clean: `schema sqlite 3.53.1, 15 migration(s) applied`. 2.0.0 was built elsewhere, with LF. **The variable is the line endings in the packed file, not the machine.**

### Fix — Dan's call, three parts

**(a) Make the checksum immune to line endings** — the durable fix:

```js
const body = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
const canonical = body.replace(/\r\n/g, '\n');
checksum: createHash('sha256').update(canonical).digest('hex').slice(0, 16)
```

⚠ This changes **every** checksum, so every existing install drifts on the next boot. It needs a heal path: on drift, if the *canonical* hash matches, re-stamp the ledger row silently and continue; only refuse when the canonical hashes genuinely differ. Without that, the fix causes the bug it fixes.

**(b) Stop the divergence at source** — `.gitattributes` in the repo root:

```gitattributes
db/sqlite/migrations/*.sql text eol=lf
db/sqlite/*.mjs           text eol=lf
```

Cheap, and it makes every future build byte-identical regardless of who builds it.

**(c) Surface it** — a failed migration currently logs to `boot.log` while `/api/setup` reports the database GREEN. A startup check that fails invisibly is worse than one that fails loudly. This is the second time it has cost a debugging cycle.

### Unblocking a machine today, with no code

The affected database is effectively empty — audited all 27 tables:

```
NON-EMPTY: schema_migrations=15   credentials=2   sources=4
```

No accounts, threads, drafts, jobs or history. So: quit the app, **rename** `%APPDATA%\redbot\data\redbot.db` → `.db.bak`, relaunch. Boot spawns `migrate.mjs up` with `REDBOT_DB=<app db>` (`dist/provision.js:176-200`) and applies all 16 from zero, LF against LF, no drift. Cost: retype 4 sources, and lose two sealed dashboard tokens (`sync_push_token`, `sync_share_token` — minted 2026-08-01 for a service that per the 08-01 handover was never built).

The alternative — re-stamping 15 ledger rows via the runner's own `sql` command — keeps a database that has nothing in it. Not worth the risk.

---

## 3. Plan

### Objective

Put redbot in a state where **one** US exit IP can be bought, judged and bound to **one** account, with evidence at every step — without touching the production install, and without Jerome writing code.

### Acceptance criteria — from what was actually asked

1. Each account exits from its own IP, and two accounts cannot share one. *(from: "they flagged we need IP per account")*
2. Nothing here requires Jerome to write code or run a development workflow. *(from: "no code no development")*
3. Testing happens on the **dev** channel; the production install stays as it is. *(from: "use the dev version")*
4. Before any money is spent, an exit address can be judged and rejected.
5. Every claim below is backed by an artefact on disk, not by an assertion.

> Karma is explicitly **out of scope**. Nothing in 2.0.0 addresses it and nothing in redbot is built to farm it.

### Phase 0 — unblock (no code) · ~10 min

| # | Action | Evidence of success |
|---|---|---|
| 0.1 | Quit both redbot installs | no `redbot*.exe` in the task list |
| 0.2 | Rename `%APPDATA%\redbot\data\redbot.db` → `.db.bak` | file present under the new name |
| 0.3 | Relaunch | `boot.log` shows `16 migration(s) applied`, **no** `migrations failed` |
| 0.4 | Confirm the schema | `account_proxies`, `account_exit_ips` present; `account_machines` has `relay_port` |

### Phase 1 — dev channel at 2.0.0 · ~20 min

The installed `redbot dev` is **1.0.12** — pre-proxy. It has to be rebuilt at the tag, or there is nothing to test.

| # | Action | Notes |
|---|---|---|
| 1.1 | `git checkout v2.0.0` (detached) | reversible: `git checkout bot-optimization` |
| 1.2 | `npm run build` | `tsc`; expect 0 errors |
| 1.3 | `npm test` | run **serial** — `node --test` is parallel and several suites write the same SQLite test DB; the `test` script already pins `--test-concurrency=1` |
| 1.4 | `npm run dist:dev` | appId `com.sgen.redbot.dev`, output `release-dev/`, **separate userData** at `%APPDATA%\redbot dev` — production is untouched by construction |
| 1.5 | Install `redbot dev Setup 2.0.0.exe` silently (`/S`) | |
| 1.6 | Launch, check `%APPDATA%\redbot dev\boot.log` | ⚠ the dev DB has **15 migrations applied against CRLF**. A dev build made **on this machine** packs CRLF, so it should match — but confirm, and if it drifts, rename that DB too. The dev data dir has 2 accounts and signed-in Chrome profiles worth keeping, so **rename, never delete**. |

### Phase 2 — judge a proxy before buying it · $0

`redbot proxy vet` **with no handle reports only and writes nothing.** That is the judge-before-you-buy mode.

```powershell
$env:REDBOT_PROXY_HOST="198.51.100.20"
$env:REDBOT_PROXY_PORT="12323"
$env:REDBOT_PROXY_USER="..."
$env:REDBOT_PROXY_PASS="..."
node dist/cli.js proxy vet --country US --region "New York"
```

Credentials come from the environment, never from a flag — a password in a command line lands in shell history and in the process list.

**What the vet reports:**

| Check | Fails when |
|---|---|
| reachable | the exit did not answer every sample |
| country / region | not what was ordered — *"the browser timezone would contradict the address"* |
| stability | the address changed across the window — then it cannot be a permanent identity |
| network (ASN) | recorded as evidence, not a vendor claim |
| proxy flag | an IP-intelligence service already classifies it as a proxy — *"Reddit may use the same signal"* |
| hosting flag | datacenter — the weaker end of the range |
| mobile flag | a carrier address, which is not what an ISP proxy should be |
| rDNS shape | consumer-access shape behind a product sold as hosted ISP |
| equals our own address | the proxy is carrying nothing |

**Defaults: 8 checks over 6 hours.** That is deliberate — *"the one property a rented dedicated address has and a rotating pool does not is that it stays put, and a single check cannot tell them apart."* `--quick` takes one sample and reports stability as NOT ESTABLISHED — fine for a smoke test, **not enough to sign in on**.

**What to ask a vendor for:** dedicated (not rotating, not shared), US residential or ISP, static for the life of the account, with a trial IP for vetting. Billing is per IP per month, so **cost scales 1:1 with account count** — that is the real ceiling on "as many as possible."

### Phase 3 — bind, on a NEW account only

A PASS **with** a handle binds the account: address, country, region, network and the sealed credential are written, and from then on **that account's browser launches through it and refuses to launch without it**. A FAIL writes nothing.

⚠ **Do not bind `docs-architect` or `jrum_sgen`.** They already first appeared from PH; there is no undo. Bind a fresh account created *through* the exit, or the main benefit is not there.

Evidence to capture: the vet report, the `account_exit_ips` rows, and a browser check that timezone matches the exit country before any sign-in.

### Phase 4 — what Dan owns (code)

| # | Item | Why |
|---|---|---|
| 4.1 | Line-ending-immune checksum + ledger heal | §2(a) — otherwise every release can brick migrations on any install that ever ran from source |
| 4.2 | `.gitattributes` for `db/sqlite/**` | §2(b) — stops it recurring |
| 4.3 | Surface a failed migration in the console | §2(c) — currently GREEN while broken |
| 4.4 | Decide on `navigator.language` | §0.4 — timezone is aligned, language is not; a US IP with a PH language string is a readable contradiction |
| 4.5 | Note the uncovered-tab residual in the product UI | §0.3 — a tab opened while redbot is not attached leaks; today only a source comment says so |

### Not in this plan, deliberately

- Anything that raises publish volume. The gates, the human SEND and the Argus REJECT block are the design, not the bug.
- Any karma mechanism.
- Binding existing accounts to new exits.
- Buying more than one proxy before a vet has passed.

---

## 4. Decisions that are not Dan's

1. **How many accounts, and do they disclose SGEN?** Everything downstream — spend, legal exposure, whether this is worth doing at all — follows from this answer.
2. **Does redbot's `forbidMention` stay on?** As shipped, these accounts can never mention SGEN. If the goal is promotion, that is a deliberate config change with its own consequences, not an oversight.
3. **Is the PH-flagging premise being kept?** It is currently unmeasured and the one test on record contradicts it. If it is being kept, it should be on the "asymmetric downside" argument — shared-IP correlation is cheap to remove now and impossible to undo later — not on a claim of observed flagging.

---

## 5. Market research and cost — August 2026

### Is there a zero-cost path?

**Not one that survives the vet.** Three candidates, all fail for a specific, checkable reason:

| Option | Cost | Why it fails |
|---|---|---|
| Free proxy lists | $0 | Shared, already abused, and frequently hostile (a free proxy sees all unencrypted traffic). Fails `stability` and `proxy flag` on the first vet. |
| **Webshare free tier** — 10 proxies, 1 GB/mo, no card, no expiry | $0 | **Shared datacenter.** Reddit blocks datacenter ASNs wholesale, not just individual IPs. Fails `hosting flag`, and shared means `one_account_per_exit_ip` is a lie the schema can't detect. |
| Cloud free tier (Oracle Always Free, etc.) | $0 | Same problem, worse — a cloud ASN is the most obviously non-residential address there is. |

**The one honest $0 option:** a **real US home connection belonging to a real person who consents** — a WireGuard or Tailscale exit node on their router or a spare machine. That is genuinely residential, genuinely static, on a genuine consumer ASN with consumer rDNS, and it would pass the vet on the merits rather than by luck. Marginal cost: zero. Requirement: a person in the US who agrees, and understands what their connection is being used for. There is no software substitute for that.

Everything else that is free is datacenter, and **Reddit's blocking extends to entire ASNs associated with hosting companies** — which is exactly the `hosting flag` check `vet.ts` already runs.

### Paid — what it actually costs

Two independent sources disagree by roughly 2×, and the reason matters: proxy "review" sites are overwhelmingly affiliate-monetised, and their headline numbers are usually annual-commit, non-US, or bandwidth-capped. I've separated primary vendor pages from aggregator claims.

**Primary sources (vendor's own page, or a benchmark with a stated method):**

| Provider | $/IP/month | Min qty | Bandwidth | Notes |
|---|---|---|---|---|
| **Proxy-Cheap** (vendor page) | **$2.29** | not stated | **Unlimited** | Dedicated, static, US listed. 7-day trial **$1.99/week**. |
| **MarsProxies** (benchmark) | **$2.79** | 1 | Unlimited | Exclusive IPs, persist across renewals |
| IPRoyal (benchmark) | $4.00 | 1 | varies | 30+ countries, occasional stockouts |
| NodeMaven | $4.99 | 1 | Unlimited | 30–90 day terms, 9 countries |
| Rayobyte | $5.00 | 1 | varies | 2-day money-back |
| Webshare (paid ISP) | $6.00 | **20** | 250 GB | 20-IP minimum makes it the wrong shape for a 1–3 account trial |
| Oxylabs | $16.00 | 10 | throttled >50 GB | |
| Bright Data | $18.00 | 10 | varies | |

**Aggregator claims, treat as a floor not a quote:** Rayobyte ~$1.35, Proxy-Cheap ~$1.60, Decodo ~$1.60, IPRoyal ~$1.80, Webshare ~$1.99 per IP/month. The same sources note the cheap tiers commonly **cap bandwidth at 2–10 GB per IP**, **lease from overlapping /24 subnets**, or **sell rotating IPs dressed as static** — the last of which `vet.ts` catches on the `stability` check, which is precisely why the default window is 8 samples over 6 hours.

### What this costs us, realistically

| Accounts | Monthly, at $2.29–$2.79/IP |
|---|---|
| 1 (trial) | **$2.29–$2.79** — or **$1.99 for a 7-day trial** |
| 3 | $7 – $8 |
| 5 | $11 – $14 |
| 10 | $23 – $28 |
| 20 | $46 – $56 |

**Budget 2–3 vendor trials, not one.** Cheap ISP proxies frequently sit on abused /24s; the vet's `proxy flag`, `hosting flag` and `rDNS shape` checks exist to catch exactly that, and a failed vendor costs a week's trial fee, not a month.

### The conclusion the numbers point to

**Proxies are not the expensive part of this.** Ten dedicated US ISP IPs is roughly the price of one lunch per month. The expensive parts are the ones no vendor sells:

- a human to type SEND on every publish, because the tool is built that way;
- the legal position on undisclosed accounts;
- and the fact that redbot currently publishes nothing at all, at any IP.

If the spend is the objection, the spend is not the problem. Buy one trial IP, vet it for free, and make the account-count decision on its merits.

**Sources:** [Proxy-Cheap — static residential](https://www.proxy-cheap.com/services/static-residential-proxies) · [AIMultiple — ISP proxy pricing & benchmarks](https://aimultiple.com/isp-proxies) · [Webshare review — free tier detail](https://traffic-creator.com/blog/webshare-review-2026) · [SpyderProxy — cheapest static residential 2026](https://spyderproxy.com/blog/cheapest-static-residential-proxies-2026) · [Proxyway — best static residential proxies](https://proxyway.com/best/static-residential-proxies) · [nstbrowser — Reddit IP bans](https://www.nstbrowser.io/en/blog/reddit-ip-ban) · [VPNAPI — Reddit VPN/ASN blocking](https://vpnapi.io/reddit-vpn-block)

---

## Appendix — verification commands

```bash
# what shipped
git show v2.0.0 --stat

# the drift, reproduced
node -e "const fs=require('fs'),{createHash}=require('crypto');
const h=p=>createHash('sha256').update(fs.readFileSync(p,'utf8')).digest('hex').slice(0,16);
console.log(h('db/sqlite/migrations/0001_init.up.sql'))"   # CRLF checkout -> aa2d529d31222113

# the ledger on a live install
node -e "const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.APPDATA+'/redbot/data/redbot.db',{readOnly:true});
console.log(db.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all())"

# is the proxy schema there at all
node -e "const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.APPDATA+'/redbot/data/redbot.db',{readOnly:true});
console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name LIKE 'account_%'\").all())"
```
