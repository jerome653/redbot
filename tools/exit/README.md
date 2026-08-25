# tools/exit — standing up a US exit on a consenting home connection

Everything here is for the **$0 exit**: a real person's US home internet, reached over a private
tailnet, used by exactly one Reddit account. The reasoning, the risks and the alternative
(Proxy-Cheap at $2.71/IP/month) are in `PROXY-TAILNET-EXIT-PLAN-2026-08-25.md` at the repo root.
Read that first if you are deciding *whether*. This directory is *how*.

| File | Runs on | What it does |
|---|---|---|
| `tinyproxy.conf.template` | the US machine | the proxy config, with the three values to replace marked |
| `verify-exit.sh` | the US machine | proves the proxy is authenticated, private, and exits locally |
| `verify-exit.ps1` | the operator machine | proves the tunnel works, the exit is US, and the port is not open to anyone |

## The shape

```
Chrome (one account)  ->  redbot relay on 127.0.0.1  ->  tailnet  ->  tinyproxy  ->  their ISP
```

redbot's relay speaks HTTP proxy and only HTTP proxy — `node:http` plus a hand-written `CONNECT`
(`src/proxy/relay.ts`). That is why the far end is tinyproxy and not a SOCKS daemon, and why
Tailscale's **exit-node feature is not used**: an exit node routes the whole machine, which would
give every account one shared exit and leave `manager.ts` nothing per-account to pin.

## Order of operations

Nothing here is reversible once an account signs in. `src/proxy/manager.ts` states the reason:

> Reddit ties an account to the address it first appears from and there is no undo.

So the exit is finished, proven and pinned **before** an account touches it.

1. **US machine** — install Tailscale, join the tailnet, **disable key expiry** for the node
   (an expired key drops it off and every launch afterwards fails). `tailscale ip -4` gives the
   address for `Listen`.
2. **US machine** — install tinyproxy, apply `tinyproxy.conf.template`, replace the three marked
   values, restart.
3. **US machine** — `REDBOT_PROXY_PASS='...' sh verify-exit.sh`
4. **Operator machine** — `pwsh verify-exit.ps1 -ProxyHost 100.x.y.z`
5. **Operator machine** — `node dist/cli.js proxy vet --country US --region "<city>"`, no handle,
   full window. Report-only.
6. **Operator machine** — same command **with** a handle. A PASS binds and pins; a FAIL writes
   nothing.
7. Set the account's timezone to the exit's zone, load Reddit signed-out through it once (expect
   200, not 403), then sign in.

Steps 3 and 4 are cheap and both are needed: the host cannot prove the port is private (from
localhost, every binding looks the same) and the operator cannot prove the traffic egresses locally.

## The check worth caring about

Both scripts make an **unauthenticated** request and require a **407**. If a page comes back
instead, the proxy is open and anyone who reaches the port browses as that household — silently,
and indistinguishably from success on our side. Stop, do not sign in, fix the auth or swap
tinyproxy for 3proxy.

There is a known upstream issue about `BasicAuth` not taking effect (tinyproxy#510), and the
documented syntax differs between sources (`BasicAuth user password` vs `BasicAuth user:password`),
so this is checked empirically rather than assumed.

## What running these does not entitle you to conclude

A green run means *worth vetting*. It does not mean ready. `proxy vet` takes 8 samples over 6
hours because a home line is DHCP and can move, and because rotating pools hold an address for
minutes. `--quick` "reports stability as NOT ESTABLISHED, which is fine for a smoke test and not
enough to sign in on."

## Secrets

Neither script takes the password as an argument — it comes from `REDBOT_PROXY_PASS` in the
environment. `verify-exit.sh` hands it to curl through a config file on stdin (`curl -K -`), which
is neither argv nor a file on disk. Same rule the CLI already keeps: "a password in a command line
lands in your shell history and in the process list."

## One host is one account

One home connection is one IP, and two accounts behind one IP are correlated by it. Scaling past
one account means another consenting household or a paid IP. Mixed fleets need no special handling
— the binding is per-account.
