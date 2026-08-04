# Measured — browser alignment on Chrome 151, and the answer to D-5

**Supersedes §5 and §6 of `EVIDENCE-MIGRATION-DRIFT-2026-08-04.md`.** That file said A5–A7 were
source-quoted and that `navigator.language` was unmeasured and needed a bound account. Two of the
three are now measured, and the `navigator.language` question is **answered** — the API currently
wired for it is the wrong one, and the one that works is named below with its evidence.

Run 2026-08-04 on **Chrome 151.0.7922.72** — note that is *newer* than the Chrome 150 the
`align.ts` header records. Playwright 1.61.1 from this repo's own `node_modules`. No redbot
account, no proxy, no database, no migration. Fresh temp profile, closed after each run.

---

## 1. D-5 — `setLocaleOverride` does not do what it is being asked to do

`src/proxy/align.ts:44` already sends it:

```ts
if (opts.locale) await cdp.send('Emulation.setLocaleOverride', { locale: opts.locale });
```

So D-5 is not unimplemented. It is **implemented and ineffective for the property that matters.**

### Measured, with a locale that must move

The first run set the override to `en-US` on a machine already at `en-US`, so nothing could change
and the result was worthless. Discarded. Re-run against `de-DE`:

```
BASELINE js       {"language":"en-US","languages":"en-US,en","intlLocale":"en-US",
                   "numberFmt":"1,234.5","dateFmt":"1/15/2026"}
BASELINE header   en-US,en;q=0.9

setLocaleOverride(de-DE) error    none
AFTER override, js (reloaded)     {"language":"en-US","languages":"en-US,en","intlLocale":"de-DE",
                                   "numberFmt":"1.234,5","dateFmt":"15.1.2026"}
AFTER override, header            en-US,en;q=0.9
```

| Property | `setLocaleOverride` |
|---|---|
| `Intl…resolvedOptions().locale` | **moves** → `de-DE` |
| number / date formatting | **moves** → `1.234,5`, `15.1.2026` |
| `navigator.language` | **does not move** |
| `navigator.languages` | **does not move** |
| `Accept-Language` header | **does not move** |

## 2. The API that does work — `Emulation.setUserAgentOverride`

It takes an `acceptLanguage` parameter. Pass the page's **current** user-agent straight back so
nothing else changes:

```
setUserAgentOverride({ userAgent: <the page's existing UA>, acceptLanguage: 'de-DE' })

AFTER UA-override, js (reloaded)   {"language":"de-DE","languages":"de-DE","intlLocale":"en-US"}
AFTER UA-override, header          de-DE
```

| Property | `setUserAgentOverride` |
|---|---|
| `navigator.language` | **moves** → `de-DE` |
| `navigator.languages` | **moves** → `de-DE` |
| `Accept-Language` header | **moves** → `de-DE` |
| `Intl…locale` / formatting | does not move |

**They are complementary, not alternatives.** Both together, measured:

```
UA-override + setLocaleOverride, js    {"language":"de-DE","languages":"de-DE","intlLocale":"de-DE"}
UA-override + setLocaleOverride, hdr   de-DE
```

All four properties agree. That is the complete answer to D-5.

### Where it goes

Beside the existing call, in the same per-page hook `align.ts` already uses for the timezone — the
header explains why that has to be per page: *"`Emulation.setTimezoneOverride` is a CDP call against
a target."* The same is true of both calls here.

Read the current UA off the page first and pass it back unchanged. Overriding the UA string itself
would be a separate decision with separate consequences; this needs only the `acceptLanguage` field.

### Two things that will not work, so nobody spends a day on them

- **`browser.newContext({ locale })`** aligns everything in one option — `navigator.language`,
  `languages`, `Intl`, and the header all move together (measured). **It is unavailable to redbot.**
  `src/browser.ts:210-211` and `align.ts` both take `browser.contexts()[0]` from
  `chromium.connectOverCDP`. redbot attaches; it does not create the context. Using this would mean
  launching the browser, which contradicts the architectural rule that makes redbot work at all.
- **`Network.setExtraHTTPHeaders`** moves the header and nothing else (measured). On its own it is
  *worse than doing nothing*: a `de-DE` header on a browser whose `navigator.language` says `en-US`
  is a contradiction one line of JavaScript can read — precisely what the `align.ts` header exists
  to prevent.

### The residual, which is not new

```
SECOND TAB, no CDP session on it   {"language":"en-US","languages":"en-US,en","intlLocale":"en-US"}
SECOND TAB header                  en-US,en;q=0.9
```

A tab with no CDP session attached reverts. That is the **same** limit `align.ts` already records
for the timezone — *"on a tab redbot did not create: NO — reports Asia/Manila."* Not a new gap,
and it is closed the same way the timezone one is: by the `context.on('page')` hook applying to
every page as it appears.

---

## 3. A5 — timezone override — REPRODUCED independently

```
BASELINE                        {"timeZone":"Asia/Manila","offsetMin":-480}
setTimezoneOverride error       none
AFTER setTimezoneOverride(NY)   {"timeZone":"America/New_York","offsetMin":240}
AFTER navigation                {"timeZone":"America/New_York","offsetMin":240}
```

UTC+8 → UTC−4, and it survives navigation. Matches the `align.ts` header claim, now confirmed by a
second party on a newer Chrome. **A5 moves from source-quoted to measured.**

## 4. A6 — the WebRTC fence — REPRODUCED, with one honest correction

```
WEBRTC no mitigation             {"constructed":true,"candidates":1,
                                  "sample":"candidate:… 09d41307-….local 53107 typ host …"}
WEBRTC init script on CONTEXT    {"constructed":false,"error":"NotAllowedError: Permission denied","candidates":0}
WEBRTC second tab, same context  {"constructed":false,"error":"NotAllowedError: Permission denied","candidates":0}
```

The fence works, including on a tab created after the init script was installed — because it is
registered on the **context**, which is the design point.

**Correction to the claim, not to the fence.** The header says unmitigated WebRTC *"LEAKS a real
public address over UDP."* This run configured **no STUN server**, so what appeared was an mDNS
`.local` host candidate — Chrome's own obfuscation — not a public address. So: *the fence is
confirmed; the public-address leak is not reproduced here and would need a STUN server to
demonstrate.* Stated so nobody cites this run as proof of the leak.

## 5. A7 — zero connections through a dead relay — STILL NOT REPRODUCED

This one genuinely needs a bound account and a running relay, which needs `0016`, which needs the
migration fix. It stays **claimed by the implementation, unverified**. It is the only one of the
three still in that state.

---

## 6. What this changes

| Item | Before | Now |
|---|---|---|
| A5 timezone | source-quoted | **measured**, Chrome 151 |
| A6 WebRTC fence | source-quoted | **measured**; leak half explicitly not reproduced |
| A7 dead relay | source-quoted | unchanged — needs the migration fix first |
| D-5 `navigator.language` | "unmeasured, needs a bound account" | **answered.** Wrong API wired; the working one is named, measured, and placed |

D-5 was listed as optional. It is still optional — but it is now a known one-call addition next to
an existing call, not an open research question.

---

## Provenance

Three probe scripts, run 2026-08-04 against Chrome 151.0.7922.72 via Playwright 1.61.1 from this
repo's `node_modules`. The first was discarded for testing `en-US` against an `en-US` baseline.
Header values were read from a loopback HTTP server started inside the probe, so no external
network was involved. No redbot code was modified, no account used, no database touched.
