# d_c9bd9366f6b9_mrwiupf2 — labelling worksheet

**Thread:** r/Wordpress — Google not indexing website
**Permalink:** https://www.reddit.com/r/Wordpress/comments/1v3ixnq/google_not_indexing_website/
**Argus verdict:** REJECT · 19 claims · 21 contradictions (8 fatal) · 9 epistemic · 6 invalidated
**Certified:** 2026-07-23T01:16:32.655Z · model `claude-haiku-4-5-20251001`

> **This file contains questions, not answers.** Every cell marked `?` must be filled by a
> person from an EXTERNAL source — official documentation, a specification, an RFC, vendor
> documentation, source code, or reproducible runtime behaviour.
>
> **AGTC rule: ground truth never originates from a language model.** The contradictions
> reproduced below are model output and are themselves unverified. They are shown as *leads to
> check*, never as evidence. Copying one into a case as an answer would make the pipeline its
> own examiner — the HRC-001 failure one level up.
>
> ⚠ This record predates EB-40, so `refutationRan` is not stored. "refutation ran" below is
> inferred from which claims received a contradiction, and cannot distinguish a refutation
> that completed and found nothing from one that failed.

## The draft, verbatim

```
Worth checking the domain's history on the Wayback Machine (web.archive.org/web/*/yourdomain.com) before spending more time on-page. You mentioned around 200k scraped pages existed under the previous owner — pull snapshots from before you bought it and see what the site actually was (scraper farm, expired-domain PBN, hacked site, etc.) and roughly how long that ran. That tells you whether you're dealing with residual algorithmic distrust or something that needs active cleanup.

A few things worth checking independent of the history angle too:

- GSC > Security & Manual Actions specifically, not just the coverage report. A manual action won't necessarily show up as anything other than "not indexed" in coverage.
- Whether the blanket redirect of all those legacy URLs to your homepage is still live. Collapsing 200k pages into one 301 target can itself read as manipulative link consolidation to Google, separate from whatever reputation the domain already carries.
- Whether robots.txt, a leftover noindex, or an edge/CDN rule from the old site is still in play somewhere in the stack. Live Test can show a URL as available on one crawl and still get blocked on a subsequent one if there's a stale rule sitting at the server or CDN level rather than in the page source Yoast checks.

If the Wayback history shows heavy scraping and there's no manual action in GSC, a reconsideration request won't apply, but disavowing the toxic inherited backlink profile and removing the mass redirect are things you can actually do instead of just waiting.
```

## Per-claim worksheet

### c1

> Use the Wayback Machine to review what the domain previously hosted

| field | Argus said | ground truth |
|---|---|---|
| type | `recommendation` | ? |
| provenance | `widely-accepted-practice` | **?** ← the calibration measurement |
| confidence | `high` | — |
| depends on | — | ? |
| refutation ran | **no — never attacked** | — |
| epistemic flag | no | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

_No contradiction generated for this claim._

### c2

> The previous site owner hosted approximately 200,000 pages that appear to be scraped content

| field | Argus said | ground truth |
|---|---|---|
| type | `observation` | ? |
| provenance | `observed-runtime-behaviour` | **?** ← the calibration measurement |
| confidence | `high` | — |
| depends on | — | ? |
| refutation ran | **no — never attacked** | — |
| epistemic flag | no | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

_No contradiction generated for this claim._

### c3

> Wayback Machine snapshots from before purchase reveal the site's prior purpose and structure

| field | Argus said | ground truth |
|---|---|---|
| type | `recommendation` | ? |
| provenance | `reasoned-inference` | **?** ← the calibration measurement |
| confidence | `high` | — |
| depends on | `c1` | ? |
| refutation ran | **no — never attacked** | — |
| epistemic flag | **yes** — language outruns evidence | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

_No contradiction generated for this claim._

### c4

> Problematic prior site types include scraper farms, expired-domain PBNs, and hacked sites

| field | Argus said | ground truth |
|---|---|---|
| type | `observation` | ? |
| provenance | `community-knowledge` | **?** ← the calibration measurement |
| confidence | `medium` | — |
| depends on | — | ? |
| refutation ran | **no — never attacked** | — |
| epistemic flag | no | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

_No contradiction generated for this claim._

### c5

> The duration of prior problematic activity indicates whether the issue is residual algorithmic distrust or requires active cleanup

| field | Argus said | ground truth |
|---|---|---|
| type | `inference` | ? |
| provenance | `reasoned-inference` | **?** ← the calibration measurement |
| confidence | `medium` | — |
| depends on | `c4` | ? |
| refutation ran | yes | — |
| epistemic flag | no | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

<details><summary>3 model-generated contradiction(s), 2 marked fatal — leads to verify, NOT evidence</summary>

- **[fatal]** `alternative-explanation` · cites `widely-accepted-practice` — Whether cleanup must be active depends on violation TYPE (manual action vs algorithmic) and whether toxic backlinks/spam exist — not on how long the prior activity ran. A scraper farm active for 2 weeks can trigger manual action (needs reconsideration request = active cleanup); a decade of low-quality-but-non-spammy co
- **[fatal]** `known-exception` · cites `widely-accepted-practice` — Algorithmic distrust from toxic backlinks (the 'residual' case) frequently still requires active cleanup — submitting a disavow file — rather than passive waiting. So even the 'residual algorithmic distrust' branch of the claimed dichotomy often needs the same active remediation as the 'manual action' branch, collapsin
- `counterexample` · cites `reasoned-inference` — A long-running but low-severity issue (e.g. years of thin auto-generated content with no spammy backlinks) can carry algorithmic distrust that clears passively once content quality improves — while a short-lived but severe issue (e.g. brief cloaking or hacked-spam period) can trigger a manual action that never clears w

</details>

### c6  · FALSIFIABLE

> Manual actions in GSC may only appear as 'not indexed' in the coverage report without clear labeling

| field | Argus said | ground truth |
|---|---|---|
| type | `implementation-detail` | ? |
| provenance | `widely-accepted-practice` | **?** ← the calibration measurement |
| confidence | `high` | — |
| depends on | — | ? |
| refutation ran | yes | — |
| epistemic flag | **yes** — language outruns evidence | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

<details><summary>2 model-generated contradiction(s), 2 marked fatal — leads to verify, NOT evidence</summary>

- **[fatal]** `counterexample` · cites `primary-documentation` — Many manual-action types don't touch indexing at all — they suppress rankings or devalue links while the page stays fully indexed. 'Unnatural links to your site' / 'Unnatural links from your site' penalties are the classic case: Google's own docs frame these as link-equity/ranking suppression, not removal. Affected pag
- **[fatal]** `contradictory-documentation` · cites `primary-documentation` — "Without clear labeling" is wrong — GSC's Security & Manual Actions report names the exact violation type (pure spam, unnatural links, thin content, etc.), scope (site-wide/partial), and triggers an email + Message-center alert the moment it's applied. That's unambiguous labeling; it's just not surfaced in the Coverage

</details>

### c7  · invalidated by c6

> Check GSC's 'Security & Manual Actions' section specifically rather than relying on the coverage report

| field | Argus said | ground truth |
|---|---|---|
| type | `recommendation` | ? |
| provenance | `framework-documentation` | **?** ← the calibration measurement |
| confidence | `high` | — |
| depends on | `c6` | ? |
| refutation ran | **no — never attacked** | — |
| epistemic flag | no | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

_No contradiction generated for this claim._

### c8

> Determine whether the site still has a 301 redirect consolidating 200k legacy URLs to the homepage

| field | Argus said | ground truth |
|---|---|---|
| type | `recommendation` | ? |
| provenance | `unknown` | **?** ← the calibration measurement |
| confidence | `unknown` | — |
| depends on | — | ? |
| refutation ran | **no — never attacked** | — |
| epistemic flag | **yes** — language outruns evidence | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

_No contradiction generated for this claim._

### c9

> A 301 redirect consolidating 200,000 pages to a single homepage target can appear to Google as manipulative link consolidation

| field | Argus said | ground truth |
|---|---|---|
| type | `inference` | ? |
| provenance | `reasoned-inference` | **?** ← the calibration measurement |
| confidence | `medium` | — |
| depends on | — | ? |
| refutation ran | yes | — |
| epistemic flag | no | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

<details><summary>3 model-generated contradiction(s), 1 marked fatal — leads to verify, NOT evidence</summary>

- **[fatal]** `alternative-explanation` · cites `primary-documentation` — Google's own guidance names a different, specific mechanism for exactly this pattern (bulk-redirecting removed/unrelated URLs to a homepage): soft-404 misclassification. Google's Search Central documentation on HTTP/network errors and on site moves warns that redirecting pages to a destination whose content doesn't mat
- `contradictory-documentation` · cites `primary-documentation` — Google's Spam Policies define 'link spam' / manipulative link schemes around artificially acquired third-party links — buying/selling links, excessive link exchanges, automated link-building services, PBNs. Redirecting URLs a site owner already controls to that same owner's homepage involves no third-party link acquisi
- `counterexample` · cites `widely-accepted-practice` — Many-to-one redirect consolidation at large scale is standard, Google-endorsed practice during legitimate site migrations, domain merges, and forum/CMS shutdowns — often affecting hundreds of thousands of URLs redirected to a small set of targets, homepage included when no closer match exists. This is routine and not t

</details>

### c10  · invalidated by c9

> The reputation damage from a mass redirect is separate and additional to the site's inherited domain reputation

| field | Argus said | ground truth |
|---|---|---|
| type | `inference` | ? |
| provenance | `reasoned-inference` | **?** ← the calibration measurement |
| confidence | `medium` | — |
| depends on | `c9` | ? |
| refutation ran | yes | — |
| epistemic flag | no | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

<details><summary>3 model-generated contradiction(s), 0 marked fatal — leads to verify, NOT evidence</summary>

- `configuration-dependency` · cites `official-implementation` — Mass redirecting many legacy URLs to one target is not inherently penalized — Google's own site-migration guidance recommends 301-ing deprecated/removed URLs to the closest relevant replacement, and whether a many-to-one pattern reads as manipulative depends on topical relevance and redirect ratio, not on the act itsel
- `alternative-explanation` · cites `community-knowledge` — The same symptom (redirected pages/domain not recovering rankings) is equally explained by Google simply not passing ranking value through the redirect at all — treating it as a weak/irrelevant signal and discounting it — rather than by an active, additive 'reputation damage' layered on top of inherited distrust. Non-t
- `edge-case` · cites `unsupported` — Framing the two effects as literally 'separate and additional' implies a modular, additive scoring architecture (domain-history penalty + redirect-manipulation penalty stacked). Google's spam/quality systems (e.g. SpamBrain, core ranking systems) are not publicly documented as linear point-additive; they're holistic cl

</details>

### c11

> Check whether robots.txt, noindex tags, or CDN/edge rules from the old site are still in place

| field | Argus said | ground truth |
|---|---|---|
| type | `recommendation` | ? |
| provenance | `widely-accepted-practice` | **?** ← the calibration measurement |
| confidence | `medium` | — |
| depends on | — | ? |
| refutation ran | **no — never attacked** | — |
| epistemic flag | no | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

_No contradiction generated for this claim._

### c12  · FALSIFIABLE

> Rules at the server or CDN layer can block crawling and indexing even if page source is clean

| field | Argus said | ground truth |
|---|---|---|
| type | `implementation-detail` | ? |
| provenance | `unknown` | **?** ← the calibration measurement |
| confidence | `high` | — |
| depends on | — | ? |
| refutation ran | yes | — |
| epistemic flag | **yes** — language outruns evidence | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

<details><summary>2 model-generated contradiction(s), 0 marked fatal — leads to verify, NOT evidence</summary>

- `known-exception` · cites `primary-documentation` — A robots.txt disallow at the server/CDN layer blocks crawling but does not by itself block indexing — Google can still index a URL it is disallowed from crawling (via external links/anchor text), showing it in results with 'No information is available for this page.' So 'block crawling and indexing' as a single joint o
- `configuration-dependency` · cites `widely-accepted-practice` — Major CDNs/WAFs (Cloudflare, Akamai, Fastly) ship default verified-bot allowlists that pass through Googlebot/Bingbot by IP+UA validation, so enabling CDN security/bot-management does not automatically block search engine crawling — it requires a specific misconfiguration (e.g., strict ASN/rate rules, 'Under Attack' JS

</details>

### c13  · FALSIFIABLE · invalidated by c12

> Google's Live Test can show a URL as available in one crawl but blocked in a subsequent crawl if stale infrastructure rules exist

| field | Argus said | ground truth |
|---|---|---|
| type | `platform-behaviour` | ? |
| provenance | `observed-runtime-behaviour` | **?** ← the calibration measurement |
| confidence | `high` | — |
| depends on | `c12` | ? |
| refutation ran | **no — never attacked** | — |
| epistemic flag | no | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

_No contradiction generated for this claim._

### c14  · FALSIFIABLE

> SEO tools like Yoast check page source for blocking rules but cannot detect server or CDN layer rules

| field | Argus said | ground truth |
|---|---|---|
| type | `implementation-detail` | ? |
| provenance | `reasoned-inference` | **?** ← the calibration measurement |
| confidence | `high` | — |
| depends on | `c12` | ? |
| refutation ran | yes | — |
| epistemic flag | **yes** — language outruns evidence | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

<details><summary>3 model-generated contradiction(s), 2 marked fatal — leads to verify, NOT evidence</summary>

- **[fatal]** `counterexample` · cites `official-implementation` — GSC's URL Inspection 'Live Test' — referenced two lines earlier in the same reply — fetches the URL live through Google's own fetcher, reading the actual HTTP response and the live robots.txt as served (including whatever an edge/CDN rule injects), and reports if the fetched URL is blocked. That is direct server/CDN-la
- **[fatal]** `counterexample` · cites `official-implementation` — Screaming Frog SEO Spider, a mainstream tool in the same class as Yoast, explicitly parses the X-Robots-Tag HTTP response header and fetches live robots.txt directives during a crawl — both are server-layer signals, not meta tags scraped from page source.
- `configuration-dependency` · cites `reasoned-inference` — Even granting the narrower point about Yoast specifically: crawler-based tools (Screaming Frog, Sitebulb, Ahrefs Site Audit) still crawl from their own IP/user-agent, not Googlebot's — so CDN/WAF rules that block or cloak specifically for Googlebot's UA/IP range won't surface even in those header-aware tools. This limi

</details>

### c15

> Heavy scraping history in Wayback indicates a toxic inherited reputation

| field | Argus said | ground truth |
|---|---|---|
| type | `inference` | ? |
| provenance | `widely-accepted-practice` | **?** ← the calibration measurement |
| confidence | `high` | — |
| depends on | `c1`, `c4` | ? |
| refutation ran | yes | — |
| epistemic flag | **yes** — language outruns evidence | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

<details><summary>3 model-generated contradiction(s), 1 marked fatal — leads to verify, NOT evidence</summary>

- **[fatal]** `alternative-explanation` · cites `primary-documentation` — Wayback Machine captures come from Internet Archive's own crawler (Heritrix / 'ia_archiver', plus user-submitted 'Save Page Now' captures) — a system entirely separate from Googlebot and Google's ranking/trust pipeline. Google does not ingest archive.org snapshot data as a trust or ranking signal. The actual determinan
- `counterexample` · cites `observed-runtime-behaviour` — Snapshot density/frequency in Wayback correlates mainly with site size, popularity, update cadence, and historical crawl-priority feeds (e.g. former Alexa Toolbar data), not with content toxicity. Massive, entirely reputable sites (major news outlets, large e-commerce catalogs, Wikipedia mirrors) show some of the heavi
- `configuration-dependency` · cites `framework-documentation` — Whether a prior owner's bad reputation actually inherits to a new owner depends on whether Google's demotion was manual-action-based (attached to the property, persists across ownership transfer until a reconsideration request is filed and granted) vs. purely algorithmic/content-tied (which typically fades once content

</details>

### c16  · invalidated by c6

> If no manual action is shown in GSC, a reconsideration request will not be applicable

| field | Argus said | ground truth |
|---|---|---|
| type | `inference` | ? |
| provenance | `reasoned-inference` | **?** ← the calibration measurement |
| confidence | `high` | — |
| depends on | `c7` | ? |
| refutation ran | yes | — |
| epistemic flag | **yes** — language outruns evidence | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

<details><summary>2 model-generated contradiction(s), 0 marked fatal — leads to verify, NOT evidence</summary>

- `configuration-dependency` · cites `primary-documentation` — Manual actions are scoped to the specific verified property being viewed. If the site is checked via a URL-prefix property (e.g. https://example.com/) rather than a Domain property, a manual action applied to a different host/protocol variant (www vs non-www, http vs https, a subdomain) can exist and simply not display
- `configuration-dependency` · cites `primary-documentation` — A GSC user with 'Restricted' permission level cannot view the Security & Manual Actions report at all. In that case 'no manual action is shown' reflects a permissions gap, not an absence of manual action — full/owner access is required to see it.

</details>

### c17

> Disavow the inherited toxic backlink profile

| field | Argus said | ground truth |
|---|---|---|
| type | `recommendation` | ? |
| provenance | `unknown` | **?** ← the calibration measurement |
| confidence | `high` | — |
| depends on | `c15` | ? |
| refutation ran | **no — never attacked** | — |
| epistemic flag | **yes** — language outruns evidence | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

_No contradiction generated for this claim._

### c18  · invalidated by c9

> Remove the mass redirect

| field | Argus said | ground truth |
|---|---|---|
| type | `recommendation` | ? |
| provenance | `reasoned-inference` | **?** ← the calibration measurement |
| confidence | `high` | — |
| depends on | `c9` | ? |
| refutation ran | **no — never attacked** | — |
| epistemic flag | **yes** — language outruns evidence | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

_No contradiction generated for this claim._

### c19  · invalidated by c6

> Taking active remedial actions is preferable to passive waiting

| field | Argus said | ground truth |
|---|---|---|
| type | `opinion` | ? |
| provenance | `operator-experience` | **?** ← the calibration measurement |
| confidence | `medium` | — |
| depends on | `c16`, `c17`, `c18` | ? |
| refutation ran | **no — never attacked** | — |
| epistemic flag | no | ? |

**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`

**SOURCE: ?** — what documents it, and whether it was checked today or inherited

_No contradiction generated for this claim._


## Externally verified sources — attached 2026-07-23

**Retrieved, quoted, not reinterpreted.** These verify only that a cited document *says what the
contradiction says it says*. They do **not** label any claim, and they do not decide whether the
draft is correct. That remains yours.

**For c9** — the contradiction asserts Google documents homepage catch-all redirects as soft 404s,
citing `primary-documentation`. **SUPPORTED.** Google Search Central, *Site Moves with URL Changes*:

> "Don't redirect many old URLs to one irrelevant single URL destination, such as the home page of
> the new site. This can confuse users and might be treated as a `soft 404` error."

<https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes>

⚠ **Calibration note, for your labelling:** the source says "**might be treated**". The
contradiction says "**gets flagged**". The citation is accurate; the certainty is overstated by
one step. Same pattern as the epistemic findings — language outrunning the evidence behind it.

*Checked and NOT supporting:* the *HTTP status codes and network errors* page and the *Redirects*
page — neither mentions redirect-target relevance or homepage catch-alls. The contradiction named
"HTTP/network errors and site moves"; only the second carries the claim.

**For c14** — the contradiction asserts Screaming Frog parses the `X-Robots-Tag` HTTP response
header, citing `official-implementation`. **SUPPORTED.** Screaming Frog SEO Spider User Guide:

> "By default the SEO Spider will not crawl internal or external links with the 'nofollow',
> 'sponsored' and 'ugc' attributes, or links from pages with the meta nofollow tag and **nofollow
> in the X-Robots-Tag HTTP Header**."

and, under Directives: "The following directives are configurable to be stored in the SEO Spider.
* Meta Robots * **X-Robots-Tag**"

<https://www.screamingfrog.co.uk/seo-spider/user-guide/configuration/>

**Not verified:** every other contradiction in this worksheet. 2 of 21 checked.


## Citation-fidelity scorecard — 2026-07-23

**What this measures:** when Argus cites a document, does that document actually support the
specific proposition? **It does NOT ask whether the proposition is true.** A contradiction can
cite badly and still be correct, or cite perfectly and still be wrong. Only fidelity is scored.

**Tier classification of all 21 contradictions**

| Tier | Count | Which |
|---|---|---|
| **1 — authoritative documentation** | 13 | #4 #5 #6 #7 #8 #12 #13 #14 #15 #17 #19 #20 #21 |
| **2 — needs implementation or experiment** | 4 | #9 #10 (cite hangout statements / community knowledge) · #16 #18 (empirical crawl behaviour) |
| **3 — normative / expert judgement** | 4 | #1 #2 #3 (analytical contrasts) · #11 (self-declares `unsupported`; argues from *absence* of documentation) |

Tier 2 and Tier 3 are **not externally verifiable by retrieval** and were not attempted.

**Tier 1 results — 7 of 13 checked**

| # | Claim | Cited as | Retrieved | Supports | Effect | Reason |
|---|---|---|---|---|---|---|
| #6 c9 | homepage catch-all redirects → soft 404 | primary-documentation | Y | **FULL** | Strengthened | *Site Moves*: "might be treated as a `soft 404` error" |
| #12 c12 | robots.txt disallow blocks crawling, not indexing | primary-documentation | Y | **FULL** | Strengthened | "A page that's disallowed in robots.txt can still be indexed if linked to from other sites"; "block indexing with `noindex`" |
| #14 c14 | GSC Live Test fetches live, reports robots block | official-implementation | Y | **FULL** | Strengthened | "the tool fetches and examines the URL in real time"; "Crawl allowed? … block it with a robots.txt rule" |
| #15 c14 | Screaming Frog parses `X-Robots-Tag` | official-implementation | Y | **FULL** | Strengthened | "nofollow in the X-Robots-Tag HTTP Header"; listed as a stored directive |
| #5 c6 | GSC names violation type + notifies | primary-documentation | Y | **PARTIAL** | Unchanged | Notification confirmed — but doc says "**Search Console message center**", not "email"; "Unnatural links to/from your site" and "Thin content" present; **"pure spam" is not on the cited page** |
| #4 c6 | manual actions split deindex vs ranking-suppression; affected pages stay "Submitted and indexed" | primary-documentation | Y | **NONE** | **WEAKENED** | The cited page does **not** systematically distinguish deindexing from ranking suppression — it says "some or all of that site will not be shown in Google search results". The "Submitted and indexed" assertion is absent entirely. ⚠ **This is a FATAL contradiction** |
| #20 c16 | report is scoped to the selected property; Domain property recommended | primary-documentation | Y | **NONE** | **WEAKENED** | The cited page does not address property scoping at all |

**Citation fidelity on the checked sample: 4 FULL · 1 PARTIAL · 2 NONE (n = 7).**

⚠ **#4 is one of the 8 fatal contradictions that produced this REJECT.** Its cited documentation
does not contain the claimed statement. **This does not make the proposition false** — manual
actions may well differ in effect — it means the *citation is not faithful*, which is precisely
the provenance-inflation failure HRC-001 exposed, now observed in the refutation pass rather than
the extraction pass.

**Not yet checked (Tier 1, 6 remaining):** #7 (spam policies / sneaky redirects) · #8 (site-move
fallback guidance) · #13 (Cloudflare verified-bot allowlists) · #17 (Internet Archive crawler
independence — note its second half is a *negative* claim about Google not ingesting archive data,
which documentation cannot establish) · #19 (manual vs algorithmic persistence) · #21 (Restricted
permission level).


## Citation fidelity — COMPLETE, 13 of 13 Tier-1 · 2026-07-23

Supersedes the partial scorecard above (7 of 13). That entry is left in place; this one is the
complete result.

| # | Claim | Cited as | Fatal | Supports | Effect |
|---|---|---|---|---|---|
| #6 | homepage catch-all → soft 404 | primary-doc | **yes** | **FULL** | Strengthened |
| #12 | robots.txt blocks crawling, not indexing | primary-doc | no | **FULL** | Strengthened |
| #14 | GSC Live Test fetches live, reports robots block | official-impl | **yes** | **FULL** | Strengthened |
| #15 | Screaming Frog parses `X-Robots-Tag` | official-impl | **yes** | **FULL** | Strengthened |
| #5 | GSC names violation type + notifies | primary-doc | **yes** | **PARTIAL** | Unchanged |
| #7 | link spam = 3rd-party acquisition; sneaky redirects = cloaking | primary-doc | no | **PARTIAL** | Narrowed |
| #13 | CDNs allow verified bots by default | widely-accepted | no | **PARTIAL** | Narrowed |
| #19 | manual actions persist until reconsideration; algorithmic fades | framework-doc | no | **PARTIAL** | Narrowed |
| #4 | manual actions split deindex vs ranking-suppression | primary-doc | **yes** | **NONE** | **Weakened** |
| #8 | homepage fallback is endorsed migration practice | widely-accepted | no | **NONE** | **Weakened** |
| #20 | manual-action report scoped to selected property | primary-doc | no | **NONE** | **Weakened** |
| #21 | Restricted GSC users cannot see Manual Actions | primary-doc | no | **NONE** | **Weakened** |
| #17 | Wayback data is not a Google ranking signal | primary-doc | **yes** | **UNVERIFIABLE** | — |

### Totals — n = 13 of 13 Tier-1 (13 of 21 contradictions)

**FULL 4 · PARTIAL 4 · NONE 4 · UNVERIFIABLE 1**

No extrapolation, no interval. This is a count of what was checked.

### Fatal contradictions specifically

Of the **8 fatal** contradictions that produced this REJECT:
**3 FULL · 1 PARTIAL · 1 NONE · 1 UNVERIFIABLE · 2 not retrievable (Tier 3, normative).**

**Only 3 of 8 fatal contradictions rest on a fully faithful citation.**

### The findings behind the counts

**#4 — a fatal contradiction whose cited page lacks its claim.** The Manual Actions report does not
distinguish deindexing from ranking suppression; it says "some or all of that site will not be
shown in Google search results". The "Submitted and indexed" assertion is absent.

**#8 — the cited source says the opposite.** The contradiction claims homepage fallback is endorsed
migration practice. Google: "Don't redirect many old URLs to one irrelevant single URL destination,
such as the home page of the new site."

**#6 and #8 attack the same claim (c9) and disagree with each other.** Documentation supports #6 and
refutes #8. Argus produced two mutually inconsistent contradictions and flagged only one as fatal.

**#7 — omits a limb that cuts against its conclusion.** Sneaky redirects is defined as showing
"users and search engines different content **or show users unexpected content**". The contradiction
reports only the first limb, then concludes a plain homepage 301 is uncovered.

**#17 — UNVERIFIABLE by construction.** Its load-bearing half is a *negative*: "Google does not
ingest archive.org data as a trust or ranking signal." Documentation cannot establish an absence.
Its other half is also imprecise: `ia_archiver` is **Alexa Internet's** crawler donating to the
Internet Archive, not IA's own; Heritrix "was not the main crawler" for many years. ⚠ Source for
this one is Wikipedia — tertiary, weaker than the vendor documentation used everywhere else.

**#13, #19, #21 — the claim may be true; the cited page does not say it.** Cloudflare's default
verified-bot exclusion is documented as *historical* and has since changed. The reconsideration page
confirms manual-action↔reconsideration but says nothing about persistence or algorithmic fade. The
permissions page defines "Restricted" as "simple view rights on most data" and never mentions the
Manual Actions report.

### Limitations, stated

- 13 of 21 contradictions. Tier 2 (4) and Tier 3 (4) are not reachable by retrieval.
- One draft, one certification. This is not a rate for Argus.
- Fidelity ≠ correctness. A faithless citation may still front a true proposition.
- #17 relies on a tertiary source.

## Corpus-level questions

- **Expected verdict: ?** — `REJECT` / `ESCALATE` / `CERTIFIED`. Argus said **REJECT**.
- **Was that verdict right, and for the right reasons?** ?
- **Extraction — did it miss a claim the draft makes, or invent one that it does not?** ?
- **Propagation — Argus invalidated 6 claim(s): c7 ← c6, c10 ← c9, c13 ← c12, c16 ← c6, c18 ← c9, c19 ← c6. Correct?** ?
- **Reviewer: ?**   **Date: ?**

---

When every `?` above is answered, transfer the answers into a `SPEC` block in
`ground-truth/build-corpus.mjs`, then run `build-corpus.mjs` and `validate.mjs --fix`.
