# PLAN — the $0 US exit: a consenting home connection, reached over a tailnet

**Date:** 2026-08-25 · **Author:** Claude (for Jerome)
**Responds to:** "let's use and setup both wireguard or tailscale"
**Basis:** every constraint below is quoted from this checkout. Where an assumption could not be
checked against code or a vendor page, it is marked **UNVERIFIED**.

---

## 0. The one-paragraph version

redbot needs one **US residential IP, dedicated to one account, that does not change.** A
consenting person's home connection in the US is exactly that, and costs nothing. The work is not
the VPN — it is that redbot's relay speaks **HTTP proxy, not VPN**, so the US machine has to run a
small authenticating HTTP proxy, and the tailnet is only the private wire that reaches it. Setup is
about 40 minutes on each side. The thing that decides whether this is worth doing is not technical:
it is whether a real person in the US will say yes and keep saying yes.

---

## 1. Correction to the ask, before anything is built

**WireGuard and Tailscale are not two options. Tailscale *is* WireGuard** — the same kernel data
plane with a coordination server, key distribution, NAT traversal and ACLs layered on top.
"Setting up both" would mean building the same tunnel twice.

So this plan does one thing and documents the other as a fallback:

- **Primary: Tailscale.** §4–§7.
- **Fallback: raw WireGuard.** §11. Only if the US host refuses to install Tailscale or cannot
  create an account. It is strictly more work and has one failure mode Tailscale does not.

The decisive reason to prefer Tailscale is already measured in this repo. `src/proxy/relay.ts`
records why IP-whitelist authentication was rejected:

> this connection's public IP is DYNAMIC. Two clean runs minutes apart exited from
> `126.209.19.165` and `180.191.139.234` — different /8.

Raw WireGuard needs a reachable endpoint and a port forward, and it authenticates by key rather
than by IP, so a dynamic Manila address is survivable — but the **US** side's address is equally
dynamic, and that is the endpoint the Manila side dials. Tailscale's coordination server removes
the problem entirely: neither side needs a stable public address, and neither needs a port
forwarded. If the US host's ISP uses CGNAT, raw WireGuard is not merely harder, it is impossible
without a relay you also have to run.

---

## 2. The constraint that shapes the whole design

**`relay.ts` speaks HTTP proxy only. There is no SOCKS support.** It is built on
`createServer` from `node:http` and hand-writes `CONNECT <host:port> HTTP/1.1` to the upstream
(`src/proxy/relay.ts:34`, `:189`). `UpstreamProxy` is `{host, port, username, password}` — a
protocol field does not exist.

Two consequences, and both are load-bearing:

1. The US machine must run an **HTTP proxy with Basic authentication**. Not a SOCKS5 daemon,
   not `microsocks`, not an SSH `-D` tunnel.
2. **The credential is mandatory.** `upstreamFromEnv` (`src/commands/proxy.ts:59-79`) requires all
   four of `REDBOT_PROXY_HOST`, `REDBOT_PROXY_PORT`, `REDBOT_PROXY_USER`, `REDBOT_PROXY_PASS` and
   "refuses rather than guessing at anything missing." The relay "never starts without a
   credential." An unauthenticated proxy on the far end cannot be used even though it would work.

### What must NOT be built

**Do not use Tailscale's `--advertise-exit-node` / exit-node feature.** It routes the *entire*
machine's traffic through the US host. That breaks this product in three ways:

- Every account would share one exit, so `account_proxies` has nothing per-account to bind and the
  whole per-account isolation model collapses.
- `manager.ts` decides launch by comparing the observed exit to the **pinned** exit for that
  account. With a system-wide tunnel there is no proxy to pin and no per-account switch.
- Jerome's own browsing, Claude Code, git, and every other process on the machine would egress
  from a stranger's home connection. That is a favour nobody should be asked for.

The tailnet is a **private wire to one port on one machine.** Nothing more.

---

## 3. Architecture

```
Chrome, launched by redbot for ONE account
  │   --proxy-server=127.0.0.1:<relayPort>
  ▼
redbot relay  (127.0.0.1 only — "never binds anything but 127.0.0.1")
  │   CONNECT + Proxy-Authorization, injected from the sealed vault credential
  ▼
tailnet  100.x.y.z:8888            ← WireGuard, via Tailscale coordination
  │
  ▼
tinyproxy on the US machine        ← Listen bound to the tailnet address ONLY
  │
  ▼
the US household's ISP             ← the address Reddit sees. Residential ASN.
```

The credential travels Manila → US inside the WireGuard tunnel. The tailnet address `100.x.y.z` is
stable for the life of the node, independent of either side's public IP — which is the whole reason
this shape works where an IP whitelist did not.

---

## 4. Prerequisites — the part that is not technical

**One consenting adult in the US, with a home internet connection, who understands what their
connection will be used for.** This is not a formality. Their ISP account is the thing being
exposed. They should be told, in plain words:

- One Reddit account belonging to SGEN will appear to come from their home address.
- It posts roughly once a day, is disclosed as an SGEN person, does not vote, does not spam links.
- If they ever want it stopped, it stops the same day, and nothing on their machine is left running.
- Their traffic is not touched; nothing of theirs routes through us in either direction.

Also required on the US side:

- A machine that can stay powered on — a spare laptop, a mini PC, a Raspberry Pi. Not their daily
  driver, ideally, but it can be.
- Ability to install two pieces of software (Tailscale, tinyproxy).
- **No router changes, no port forwarding.** That is the point of Tailscale.

If no such person exists, stop here and buy Proxy-Cheap at $2.71/IP/month. §12.

---

## 5. Phase 1 — the US side (about 25 minutes, done once)

### 5.1 Tailscale

Install from tailscale.com, sign in, and join the tailnet. Then, so the node's address never
changes and the key never expires mid-run:

- In the Tailscale admin console, **disable key expiry** for this node. A node whose key expires
  drops off the tailnet and every launch after that fails — a confusing failure at the worst time.
- Note the node's tailnet address (`100.x.y.z`). This becomes `REDBOT_PROXY_HOST`.

### 5.2 tinyproxy

Install tinyproxy (`apt install tinyproxy` on Debian/Ubuntu, `brew install tinyproxy` on macOS).
Configuration, with the parts that matter called out:

```conf
# Bind ONLY to the tailnet address. Never 0.0.0.0 — that is an open proxy on a
# stranger's home network, carrying anyone's traffic out through the IP we are
# keeping clean.
Listen 100.x.y.z
Port 8888

# Only the Manila node may connect. Second lock, behind the tailnet ACL.
Allow 100.a.b.c/32

# Mandatory: the relay refuses to start without a credential, and an
# unauthenticated proxy would be usable by anything that reaches the port.
BasicAuth redbot <a-long-random-password>

# Chrome sends CONNECT for every https:// origin. 443 is the one that matters.
ConnectPort 443

# Hygiene: do not announce what this is.
DisableViaHeader Yes
```

Then restrict egress to Reddit only. tinyproxy has a `FilterURLs` / `Filter` mechanism; configure
it to allow `reddit.com` and its asset domains and deny the rest. This protects the host more than
it protects us: it means their connection cannot be used for anything else even by accident.

**UNVERIFIED, and check this on the real install:** two sources disagree on the `BasicAuth` syntax
— the official documentation shows `BasicAuth user password` (space-separated), one secondary
source shows `BasicAuth username:password` (colon). There is also an open upstream issue titled
"BasicAuth still not working" (tinyproxy#510). **Verify authentication works before relying on
it**, and if tinyproxy's Basic auth misbehaves on the installed version, substitute **3proxy**,
which does the same job with a different config syntax. Test from the US machine itself:

```
curl -x http://redbot:<password>@100.x.y.z:8888 https://api.ipify.org   # expect the home IP
curl -x http://100.x.y.z:8888 https://api.ipify.org                     # expect 407, NOT a result
```

The second command is the one that matters. If it returns an IP instead of a 407, authentication
is not on and the port is an open proxy — stop and fix it before going further.

---

## 6. Phase 2 — the Manila side (about 10 minutes)

1. Install Tailscale, sign into the same tailnet, confirm `tailscale ping <us-node>` succeeds.
2. Confirm the proxy is reachable **through the tunnel and only through the tunnel**:

```
curl -x http://redbot:<password>@100.x.y.z:8888 https://api.ipify.org
```

This must return the **US home IP**, not a Manila address. If it returns Manila, traffic is not
going through the proxy and everything downstream would be measuring the wrong thing.

3. Confirm the port is *not* reachable from the public internet. From any machine not on the
   tailnet, a connection to the US host's public IP on 8888 must fail. If it succeeds, `Listen` is
   bound to the wrong address.

---

## 7. Phase 3 — vet and pin (6 hours, mostly waiting)

Set the environment. Never pass these as command arguments — "a password in a command line lands
in your shell history and in the process list" (`src/commands/proxy.ts:46`):

```powershell
$env:REDBOT_PROXY_HOST="100.x.y.z"
$env:REDBOT_PROXY_PORT="8888"
$env:REDBOT_PROXY_USER="redbot"
$env:REDBOT_PROXY_PASS="<the password>"
```

**Step 1 — report only, nothing written:**

```
node dist/cli.js proxy vet --country US --region "<their city>"
```

With no handle this only reports. Expected results, and what each means:

| Check | Expected | Why |
|---|---|---|
| `country` | PASS, `US` | it is a US household |
| `region` | PASS | must match the city you pass |
| `hosting flag` | **PASS** (absent) | a real home line is not a hosting ASN — this is the check a datacenter IP fails and the advantage over every paid ISP proxy, which is "a datacenter-hosted address with an ISP's ASN" and trips this as a WARN by construction (`src/proxy/vet.ts:26`) |
| `proxy flag` | PASS | a residential line is not in any proxy list |
| `stability` | PASS after the full window | 8 samples over 6 hours must all see one address |

Run the **full** window, not `--quick`. `--quick` "takes one check and reports stability as NOT
ESTABLISHED, which is fine for a smoke test and not enough to sign in on." For a home connection
the stability check is not a formality: a residential line is DHCP, and its address can change on a
lease renewal or a router reboot. Six hours of evidence is the minimum honest basis for pinning.

**Step 2 — bind it:**

```
node dist/cli.js proxy vet <handle> --country US --region "<their city>"
```

A PASS binds the account to this exit, stores the address, country, region and network, seals the
credential in the vault, and pins the IP. From then on that account's browser launches through it
and **refuses to launch without it**. A FAIL writes nothing.

**Step 3 — set the account's timezone** to the US city's zone. `align.ts` carries a US city→zone
table covering `America/New_York`, `Chicago`, `Denver`, `Phoenix`, `Los_Angeles` and `Anchorage`
(`src/proxy/align.ts:138-185`). The existing account is Manila and **will be refused** against a US
exit until this is corrected.

**Step 4 — load Reddit signed-out through the exit, once.** A vet PASS has zero predictive power
for whether Reddit serves the address. Confirm 200, not 403. A residential IP should be clean, but
"should" is not evidence.

---

## 8. Phase 4 — the account

Only now does an account sign in.

> Reddit ties an account to the address it first appears from and there is no undo.
> — `src/proxy/manager.ts`

That sentence is the entire reason phases 1–3 come first. Sign in **through the pinned exit**, in
that account's own Chrome profile, by hand — sessions are DPAPI-bound and cannot be moved between
machines, so this is a manual step by design, not a gap.

Then: do not post that day. `redbot health` for the account, confirm `may publish: yes`, then a
small collect → draft → approve cycle. Stagger the first post.

---

## 9. What breaks this, ranked by likelihood

| # | Failure | Symptom | Response |
|---|---|---|---|
| 1 | **The home IP changes** (DHCP lease, router reboot, ISP maintenance) | `manager.ts` refuses to launch, naming both the pinned and the observed address | Re-vet and re-pin. Reddit has now seen the account from two addresses — infrequently this is normal household behaviour; frequently it is a signal. Ask the host not to power-cycle the router casually |
| 2 | **The US machine sleeps or is shut down** | relay cannot reach the exit → refuses to launch (fail closed, by design) | Disable sleep on the US machine. This is why a spare always-on box beats a daily-driver laptop |
| 3 | **Tailscale node key expires** | node drops off the tailnet, same symptom as #2 | Disable key expiry in the admin console at setup — §5.1 |
| 4 | **The host withdraws consent** | — | Stop the same day. Uninstall on their side. This is a foreseeable end state, not a betrayal — plan for it by keeping the paid option one purchase away |
| 5 | **tinyproxy Basic auth does not work on the installed version** | `curl` without credentials returns a result instead of 407 | Do not proceed. Switch to 3proxy. An open proxy on someone's home line is the worst outcome in this document |
| 6 | Quitting redbot leaves Chrome open with a dead relay | every page fails `ERR_PROXY_CONNECTION_FAILED` | Known and deliberate: relays live in the console process, chosen over a detached daemon holding live credentials with nobody watching |

---

## 10. The hard limit

**One home connection is one IP, and one IP is one account.** Two accounts behind it share an
address, and shared-IP correlation is a documented Reddit signal — `MULTI-ACCOUNT-RISK.md` ranks it
"low on its own", but it stops being low when it is the *only* thing tying two accounts together
and both are ours.

So this plan scales to exactly as many accounts as there are consenting US households. For the
second and third account, either find another host or buy Proxy-Cheap IPs. **A mixed setup is
completely fine** — the binding is per-account, so account A can exit through a tailnet and
account B through a paid ISP proxy with no special handling.

---

## 11. Fallback — raw WireGuard, if Tailscale is refused

Same architecture, same tinyproxy, only the wire changes. What gets harder:

- The US host must forward a UDP port on their router, or the tunnel cannot be established.
- **The US endpoint's public IP is dynamic too**, so the Manila config's `Endpoint` goes stale
  exactly the way the rejected IP-whitelist design did. Needs dynamic DNS on the US side, which is
  another moving part on someone else's network.
- **If their ISP uses CGNAT, this cannot work at all** without a publicly-reachable relay host,
  which reintroduces a paid server and defeats the $0 premise.
- Key management, IP assignment, and `AllowedIPs` are all manual. Set `AllowedIPs` to the tunnel
  subnet **only** — never `0.0.0.0/0`, which is the exit-node mistake from §2 in another form.

Verdict: only if Tailscale is impossible. It is the same protocol with three extra failure modes.

---

## 12. Cost, and the decision this is really about

| Option | Cost | Gets us |
|---|---|---|
| Consenting US household + tailnet | **$0** | 1 IP, residential ASN, passes `hosting flag` cleanly |
| Proxy-Cheap static residential | **$2.71**/IP/mo | N IPs, unlimited bandwidth, no minimum, no favours owed |
| Proxy-Cheap 7-day trial | **$1.99** once | enough to run a full vet before committing |

The tailnet route is free in money and expensive in dependency: it relies on a person, their
router, their electricity bill and their continued goodwill. Proxy-Cheap costs $2.71 and relies on
nobody.

**Recommendation: do both, in this order.** Set up the tailnet for account #1 if a host exists —
it is the cleanest possible IP and it costs nothing. Buy paid IPs for accounts #2+ rather than
recruiting more households. And keep the $1.99 trial in your pocket as the same-day answer if the
household route stalls, because the cost of waiting is that bought accounts sit unused, and an
unused bought account is pure downside.

---

## 13. What is not yet decided

1. **Who the US host is.** Nothing in this plan starts without that name.
2. **`PROXY-VENDOR-DECISION.md` does not exist.** It is cited as the settled-vendor authority by
   `src/credentials.ts:28` and `src/proxy/webshare.ts:8`, but no such file is in the repo. The
   IPRoyal decision it names is also stale — this repo's own benchmark puts IPRoyal at $4.00
   against Proxy-Cheap's $2.71.
3. **Whether `FilterURLs` scoping to Reddit interferes with anything redbot fetches.** Not tested.
   Start permissive, tighten after the first successful collect.
