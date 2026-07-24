# Evidence — how redbot reaches Reddit

**Date:** 2026-07-22 · **Host:** JerOme DESKTOP-EA0N9F1
**Playwright:** 1.60.0 · **Node:** 24.11.0 · **Chrome:** 150.0.7871.129

## Headline

**Playwright must not launch the browser. It must attach to one the operator started.**

That single change took `redbot read` from 0 threads to 25 real threads.

## The experiments, in order

| # | Configuration | Result |
|---|---|---|
| 1 | Playwright launches Chromium, headless | **BLOCKED** — HTTP 200, body = "You've been blocked by network security" |
| 2 | Playwright launches Chromium, headed | **BLOCKED**, same |
| 3 | Playwright launches real Chrome (`channel:'chrome'`), headless | **BLOCKED**, same |
| 4 | Playwright launches real Chrome, headed | **BLOCKED**, same |
| 5 | `old.reddit.com`, Playwright-launched | **BLOCKED**, HTTP **403** |
| 6 | Plain `fetch()` from Node, no browser | challenged — `<title>Reddit - Please wait for verification</title>`, 8,440 bytes |
| 7 | Plain `fetch()` with a normal Chrome UA + accept headers | identical challenge |
| 8 | Chrome started **by hand** with `--remote-debugging-port=9222`, fresh profile. Playwright `connectOverCDP` + `newPage()` | **BLOCKED** |
| 9 | Same browser, **raw CDP over a WebSocket, no Playwright** | **WORKS** — title "WordPress", 80 `/comments/` anchors, screenshot saved |
| 10 | Same browser after #9, Playwright `connectOverCDP` — `noDefaults:true` + existing page | **WORKS** — 111 anchors |
| 11 | Same, `noDefaults:true` + new page | **WORKS** — 111 anchors |
| 12 | Same, plain defaults + existing page | **WORKS** — 115 anchors |

Screenshot from #9: `data/probe-raw.png` — real r/Wordpress feed, logged out.

Reproduce: `node dist/test/probe.js` · `probe-old.js` · `probe-cdp.js` · `probe-raw.js` · `probe-cdp2.js`

## Reading the results honestly

**Certain:** every configuration where **Playwright launched the browser** was blocked (1–5).
Every configuration attaching to an **operator-launched** Chrome eventually worked (9–12).

**Not certain:** why #8 was blocked but #10–12 were not. Between them, #9 succeeded and
almost certainly left clearance cookies in that profile. So #8's failure may be
"Playwright-over-CDP is detected on a cold profile" or may be "the profile had not yet
passed the challenge." Distinguishing them needs a second cold profile, and the attempt to
create one was stopped by the chrome-lifecycle bylaw. **This ambiguity is recorded, not
resolved.**

**It does not block the build**, because the working recipe is the same either way: the
operator starts Chrome, visits Reddit once as a human, and redbot attaches. Signing in —
which the operator must do anyway — warms the profile as a side effect.

**Not attempted:** defeating the bot challenge. The spec forbids anti-detect and fingerprint
spoofing, and it would be the wrong thing to build.

## What redbot now does

- `browser.ts` exposes `attach()` only. There is no launch path.
- `connectOverCDP(endpoint, { noDefaults: true })` — the documented option for attaching to
  a browser Playwright did not launch.
- redbot opens **its own tab** and never touches one the operator is using. `close()`
  detaches; it never closes the operator's Chrome.
- `isBlocked(page)` is a first-class check, because Reddit returns **HTTP 200 with a block
  body** — status code alone is not a usable health signal.

## Live end-to-end result

    $ node dist/cli.js read wordpress
    redbot read r/wordpress
      Collecting up to 25 posts…
      Found 25 post links.
        [1/25] [Guide] Complete cleanup and securing of WordPress after REST Batch AP…
        [2/25] How do you keep track of a handful of WordPress client sites?
        …
        [25/25] Why does WordPress still ship only 8 admin color schemes in 2026?
      OK  Collected 25 threads (25 new).

Sample record quality:

    title        "How do you keep track of a handful of WordPress client sites?"
    subreddit    Wordpress
    upvotes      9
    commentCount 36
    comments     25 scraped
    body         556 chars
    permalink    https://www.reddit.com/r/Wordpress/comments/1v2xr5x/…

## Bonus finding — r/WordPress rule 1

Visible in the sidebar of the screenshot captured in #9:

> **1. No promotions of products or services**

This is unknown **U-1** from the action plan, answered without asking anyone. It does not
forbid a disclosed SGEN engineer from answering a technical question, but it does forbid
promotion — which means the `answerableWithoutPitch` gate in the analyze prompt is not a
nicety, it is the rule of the room. Full rule text should be read in the sidebar before the
pilot.
