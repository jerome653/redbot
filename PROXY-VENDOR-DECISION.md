# DECISION — which exit vendor, and why

**Date:** 2026-08-25 · **Status:** RECOMMENDED, not yet chosen. Nothing bought.
**Cited by:** `src/credentials.ts`, `src/proxy/webshare.ts`
**Supersedes:** the IPRoyal preference recorded in those code comments, which was never purchased.

> **On the word "settled".** An earlier draft of this file called the recommendation settled. It
> is not: Jerome has not picked, and said so. What is settled is the *analysis* — the table below
> is measured and the reasoning under it holds. The choice is open, and open is the honest state
> to record, because a document that says "settled" about a decision nobody made is how the
> IPRoyal line this file replaces became load-bearing in the first place. Same failure, one
> iteration later, would be worse.

---

## Why this file exists at all

Two modules named this document as the authority for the exit vendor and **the document did not
exist**. `src/credentials.ts:28` and `src/proxy/webshare.ts:8` both read "The settled exit vendor is
IPRoyal ISP (PROXY-VENDOR-DECISION.md)", which meant the decision lived in two code comments and
nowhere a person would look for it. That is the shape a stale decision hides in: quoted often
enough to sound settled, written down nowhere that could be re-checked.

Re-checked here, and the answer changed.

---

## The recommendation

**Buy Proxy-Cheap static residential (ISP), one dedicated IP per account, US, month-to-month.**

Second choice **MarsProxies**. On the evidence below IPRoyal should not be the pick, though it is
the one the code currently names.

This is a recommendation with the analysis behind it, not an instruction and not a record of a
choice already made. Overriding it costs nothing — see *Reversing this* at the end.

Where a consenting US household is available, that is preferred over any paid vendor for that one
account, at $0 — see `PROXY-TAILNET-EXIT-PLAN-2026-08-25.md`. The two are not exclusive; binding is
per-account, so a mixed fleet needs no special handling.

---

## What was measured

Repo benchmark, `PROXY-PLAN-2026-08-04.md` §294–301, primary vendor pages only:

| Provider | $/IP/month | Min qty | Bandwidth | Note |
|---|---|---|---|---|
| **Proxy-Cheap** | **$2.29** | not stated | Unlimited | dedicated, static, US listed |
| MarsProxies | $2.79 | 1 | Unlimited | exclusive IPs, persist across renewals |
| IPRoyal | $4.00 | 1 | varies | 30+ countries, occasional stockouts |
| NodeMaven | $4.99 | 1 | Unlimited | 30–90 day terms |
| Rayobyte | $5.00 | 1 | varies | |
| Webshare (paid ISP) | $6.00 | **20** | 250 GB | |
| Oxylabs | $16.00 | 10 | throttled >50 GB | |
| Bright Data | $18.00 | 10 | varies | |

Re-checked against live vendor pages on **2026-08-25**:

| Provider | Then (2026-08-04) | Now (2026-08-25) | Source |
|---|---|---|---|
| Proxy-Cheap | $2.29 | **$2.71**/IP/mo, unlimited bandwidth, no stated minimum, 7-day trial **$1.99** | vendor page |
| Decodo | — | **$3.33**/IP at 1–3 IPs; the advertised "$0.27/IP" requires **2,000 IPs** | vendor page |
| DataImpulse | never evaluated | **not a candidate** — see below | vendor pages |

Prices move. The $2.29→$2.71 drift in three weeks is the reason this table carries dates and the
reason a re-check belongs in any purchase step rather than in memory.

---

## Why not the alternatives

**IPRoyal** — $4.00 against Proxy-Cheap's $2.71 for the same product class, with "occasional
stockouts" noted in the benchmark. It was named as settled but never bought, so switching costs
nothing: there is no account, no bound exit, no sealed credential to migrate.

**Webshare** — has the only vendor API client in this codebase (`src/proxy/webshare.ts`), which is
the one argument in its favour, and it is not enough. The paid ISP tier carries a **20-IP minimum**
at $6.00/IP — $120/month to run three accounts. That module's own header already says the quote:
its cheap pool "is datacenter-classified, which the vet is there to catch." Keep the client; it
auto-fills a form and costs nothing to leave in place.

**Decodo** — the "$0.27/IP" headline needs 2,000 IPs. At our scale it is $3.33, more expensive than
Proxy-Cheap. A worked example of the trap the plan already warned about: aggregator floors are
annual-commit, bulk, or non-US.

**DataImpulse** — asked about on 2026-08-25, never previously evaluated, and it is the **wrong
product class entirely**. It sells bandwidth, not IPs: residential $1/GB, datacenter $0.50/GB,
mobile $2/GB, with rotating or **sticky sessions capped at 30–120 minutes**. There is no static or
dedicated IP product. It cannot pass `vet.ts`'s `stability` check by construction — that check
requires one address across 8 samples spread over 6 hours, and a 120-minute ceiling cannot span the
window. `manager.ts` would then refuse every launch after the session rolled, since it compares the
observed exit to the pinned one. Cheap for what it is; not an exit.

**Oxylabs / Bright Data** — 10-IP minimums at $16–18. Enterprise shape, enterprise price.

---

## The criteria, in the order that decided it

1. **Dedicated and static.** Not sticky, not rotating, not shared. A changing exit is itself a ban
   signal, and `manager.ts` refuses to launch when the observed exit is not the pinned one — so a
   rotating product does not degrade gracefully here, it stops the product.
2. **No minimum quantity.** We are buying 1–3 IPs to start. A 10- or 20-IP floor prices out the
   trial and buys inventory against an unproven pipeline.
3. **Month-to-month.** Nothing here justifies an annual commit; the account strategy could change
   in a month.
4. **US, in a city `align.ts` knows.** The zone table covers `America/New_York`, `Chicago`,
   `Denver`, `Phoenix`, `Los_Angeles`, `Anchorage` (`src/proxy/align.ts:138-185`). A city outside
   it means hand-setting the account timezone, and a guessed zone is worse than a known one.
5. **Bandwidth,** last and nearly irrelevant. At a ceiling of one post per account per day the
   traffic is a few MB. Unlimited is a tiebreak, not a reason.

Price mattered least of all — the spread between the top three is under $1.30/IP/month. What
decided it was minimum quantity and product class, which is why the cheapest headline in the market
lost to the fourth-cheapest.

---

## What this does NOT settle

A vendor's own page is marketing until the vet says otherwise. The benchmark's warning stands: the
cheap tiers commonly cap bandwidth at 2–10 GB per IP, lease from overlapping /24 subnets, or **sell
rotating IPs dressed as static**. `vet.ts` runs 8 samples over 6 hours precisely because that last
one is common enough to design against.

So the purchase step is: **buy the $1.99 seven-day trial first**, run the full vet, and only then
buy the month. `redbot proxy vet` with no handle reports and writes nothing — that is the
pre-purchase test, and it exists for exactly this.

Expect `hosting flag` to come back **WARN**, not PASS, on any paid ISP proxy. That is correct and
not a reason to reject the vendor: as `src/proxy/vet.ts:26` puts it, "An ISP proxy is a
datacenter-hosted address with an ISP's ASN, so *some* services flag it by construction." The check
that decides is `stability`. A consenting household passes `hosting flag` outright, which is its one
technical advantage over every vendor on this page.

---

## Reversing this

Nothing is locked in. There is no annual term, no minimum, no migration: each account's exit is an
independent row in `account_proxies` with its own sealed credential. Changing vendor for one
account is one `proxy vet <handle>` against the new address. Changing vendor for all of them is the
same command, N times.

If a re-check finds Proxy-Cheap has moved on price, stock, or product terms, update the table above
with the date and change the pick. That is maintenance, not a reversal.
