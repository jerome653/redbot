# Operator Review Package — `d_c9bd9366f6b9_mrwiupf2`

**Thread:** Google not indexing website
**Verdict:** ⛔ **REJECT**
**Certified:** 2026-07-23 01:16 · model claude-haiku-4-5-20251001

> Read this in order. The draft is at the bottom on purpose — reading prose first primes you to
> assess whether it *sounds* right instead of whether it *is* right, which is exactly how
> HRC-001 reached the publication queue.

## 1. Thread status

🟢 open — no resolution signal found

_No resolution signals._

## 2. Verdict reasons

- **fatal-contradiction** `c5` — alternative-explanation: Whether cleanup must be active depends on violation TYPE (manual action vs algorithmic) and whether toxic backlinks/spam exist — not on how long the prior activity ran. A scraper farm active for 2 weeks can trigger manual action (needs reconsideration request = active cleanup); a decade of low-quality-but-non-spammy content can resolve algorithmically once removed. Duration is not the discriminating variable — the reply's own next bullet (check GSC Security & Manual Actions) is the actual test, undermining duration as the indicator. [widely-accepted-practice]
- **fatal-contradiction** `c5` — known-exception: Algorithmic distrust from toxic backlinks (the 'residual' case) frequently still requires active cleanup — submitting a disavow file — rather than passive waiting. So even the 'residual algorithmic distrust' branch of the claimed dichotomy often needs the same active remediation as the 'manual action' branch, collapsing the distinction the claim relies on. [widely-accepted-practice]
- **fatal-contradiction** `c6` — counterexample: Many manual-action types don't touch indexing at all — they suppress rankings or devalue links while the page stays fully indexed. 'Unnatural links to your site' / 'Unnatural links from your site' penalties are the classic case: Google's own docs frame these as link-equity/ranking suppression, not removal. Affected pages keep showing 'Submitted and indexed' in Coverage — no 'not indexed' signal ever appears. [primary-documentation]
- **fatal-contradiction** `c6` — contradictory-documentation: "Without clear labeling" is wrong — GSC's Security & Manual Actions report names the exact violation type (pure spam, unnatural links, thin content, etc.), scope (site-wide/partial), and triggers an email + Message-center alert the moment it's applied. That's unambiguous labeling; it's just not surfaced in the Coverage report, which is a separate tool. [primary-documentation]
- **fatal-contradiction** `c9` — alternative-explanation: Google's own guidance names a different, specific mechanism for exactly this pattern (bulk-redirecting removed/unrelated URLs to a homepage): soft-404 misclassification. Google's Search Central documentation on HTTP/network errors and on site moves warns that redirecting pages to a destination whose content doesn't match the original request — homepage catch-alls being the canonical example — gets flagged as a soft 404, meaning Google treats the URL as effectively non-existent and does not pass ranking signals through it at all. That is a crawl/indexing quality classification, not a link-spam/manipulation classification, and its outcome is the opposite of 'consolidation' — no equity is merged into the homepage, the URL is just dropped. [primary-documentation]
- **fatal-contradiction** `c14` — counterexample: GSC's URL Inspection 'Live Test' — referenced two lines earlier in the same reply — fetches the URL live through Google's own fetcher, reading the actual HTTP response and the live robots.txt as served (including whatever an edge/CDN rule injects), and reports if the fetched URL is blocked. That is direct server/CDN-layer detection by an SEO tool, not page-source scanning. [official-implementation]
- **fatal-contradiction** `c14` — counterexample: Screaming Frog SEO Spider, a mainstream tool in the same class as Yoast, explicitly parses the X-Robots-Tag HTTP response header and fetches live robots.txt directives during a crawl — both are server-layer signals, not meta tags scraped from page source. [official-implementation]
- **fatal-contradiction** `c15` — alternative-explanation: Wayback Machine captures come from Internet Archive's own crawler (Heritrix / 'ia_archiver', plus user-submitted 'Save Page Now' captures) — a system entirely separate from Googlebot and Google's ranking/trust pipeline. Google does not ingest archive.org snapshot data as a trust or ranking signal. The actual determinants of 'toxic reputation' are GSC manual actions and algorithmic systems (SpamBrain link-spam detection, Panda/helpful-content-style content evaluation) acting on current content and backlink profile — not on how many times IA happened to crawl the domain. So Wayback history can tell you what the site used to be (forensics), but it cannot itself 'indicate' Google's algorithmic distrust — that requires the GSC manual-actions check the reply separately (and correctly) recommends. [primary-documentation]
- **no-provenance** `c8` — "Determine whether the site still has a 301 redirect consolidating 200k legacy URLs to the homepage" is unknown — a factual claim must say where it comes from
- **no-provenance** `c12` — "Rules at the server or CDN layer can block crawling and indexing even if page source is clean" is unknown — a factual claim must say where it comes from
- **no-provenance** `c17` — "Disavow the inherited toxic backlink profile" is unknown — a factual claim must say where it comes from
- **overconfident-language** `c6` — asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence — "A manual action won't necessarily show up as anything other than 'not indexed' in coverage"
- **overconfident-language** `c12` — stated as fact, but the evidence is unknown (unknown) — say what you would check and why, or drop the claim — "if there's a stale rule sitting at the server or CDN level rather than in the page source"
- **overconfident-language** `c14` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "rather than in the page source Yoast checks"
- **invalidated-dependency** `c7` — rests on c6, which failed — invalid reasoning is not partially salvageable
- **invalidated-dependency** `c10` — rests on c9, which failed — invalid reasoning is not partially salvageable
- **invalidated-dependency** `c13` — rests on c12, which failed — invalid reasoning is not partially salvageable
- **invalidated-dependency** `c16` — rests on c6, which failed — invalid reasoning is not partially salvageable
- **invalidated-dependency** `c18` — rests on c9, which failed — invalid reasoning is not partially salvageable
- **invalidated-dependency** `c19` — rests on c6, which failed — invalid reasoning is not partially salvageable
- **falsifiable-claim-weak-evidence** `c6` — "Manual actions in GSC may only appear as 'not indexed' in the coverage report without clear labeling" asserts implementation-detail on widely-accepted-practice — someone who knows the subject must confirm it, or it needs primary evidence
- **falsifiable-claim-weak-evidence** `c14` — "SEO tools like Yoast check page source for blocking rules but cannot detect server or CDN layer rules" asserts implementation-detail on reasoned-inference — someone who knows the subject must confirm it, or it needs primary evidence
- **overconfident-language** `c3` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "pull snapshots from before you bought it and see what the site actually was"
- **overconfident-language** `c8` — stated as fact, but the evidence is unknown (unknown) — say what you would check and why, or drop the claim — "Whether the blanket redirect of all those legacy URLs to your homepage is still live"
- **overconfident-language** `c15` — asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence — "If the Wayback history shows heavy scraping"
- **overconfident-language** `c16` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "there's no manual action in GSC, a reconsideration request won't apply"
- **overconfident-language** `c17` — stated as fact, but the evidence is unknown (unknown) — say what you would check and why, or drop the claim — "disavowing the toxic inherited backlink profile"
- **overconfident-language** `c18` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "removing the mass redirect are things you can actually do"
- **low-confidence-as-fact** `c8` — "Determine whether the site still has a 301 redirect consolidating 200k legacy URLs to the homepage" carries unknown confidence and is not marked as speculation

## 3. Claims — 19

| id | claim | type | evidence | conf | rests on | contra |
|---|---|---|---|---|---|---|
| `c1` | Use the Wayback Machine to review what the domain previously hosted | recommendation | widely-accepted-practice (non-authoritative) | high | — | — |
| `c2` | The previous site owner hosted approximately 200,000 pages that appear to be scraped content | observation | observed-runtime-behaviour (authoritative) | high | — | — |
| `c3` | Wayback Machine snapshots from before purchase reveal the site's prior purpose and structure | recommendation | reasoned-inference (non-authoritative) | high | c1 | — |
| `c4` | Problematic prior site types include scraper farms, expired-domain PBNs, and hacked sites | observation | community-knowledge (non-authoritative) | medium | — | — |
| `c5` | The duration of prior problematic activity indicates whether the issue is residual algorithmic distrust or requires active cleanup | inference | reasoned-inference (non-authoritative) | medium | c4 | **fatal** |
| `c6` | Manual actions in GSC may only appear as 'not indexed' in the coverage report without clear labeling | implementation-detail | widely-accepted-practice (non-authoritative) | high | — | **fatal** |
| `c7` ☠ | Check GSC's 'Security & Manual Actions' section specifically rather than relying on the coverage report | recommendation | framework-documentation (authoritative) | high | c6 | — |
| `c8` | Determine whether the site still has a 301 redirect consolidating 200k legacy URLs to the homepage | recommendation | unknown (**none**) | unknown | — | — |
| `c9` | A 301 redirect consolidating 200,000 pages to a single homepage target can appear to Google as manipulative link consolidation | inference | reasoned-inference (non-authoritative) | medium | — | **fatal** |
| `c10` ☠ | The reputation damage from a mass redirect is separate and additional to the site's inherited domain reputation | inference | reasoned-inference (non-authoritative) | medium | c9 | 3 |
| `c11` | Check whether robots.txt, noindex tags, or CDN/edge rules from the old site are still in place | recommendation | widely-accepted-practice (non-authoritative) | medium | — | — |
| `c12` | Rules at the server or CDN layer can block crawling and indexing even if page source is clean | implementation-detail | unknown (**none**) | high | — | 2 |
| `c13` ☠ | Google's Live Test can show a URL as available in one crawl but blocked in a subsequent crawl if stale infrastructure rules exist | platform-behaviour | observed-runtime-behaviour (authoritative) | high | c12 | — |
| `c14` | SEO tools like Yoast check page source for blocking rules but cannot detect server or CDN layer rules | implementation-detail | reasoned-inference (non-authoritative) | high | c12 | **fatal** |
| `c15` | Heavy scraping history in Wayback indicates a toxic inherited reputation | inference | widely-accepted-practice (non-authoritative) | high | c1, c4 | **fatal** |
| `c16` ☠ | If no manual action is shown in GSC, a reconsideration request will not be applicable | inference | reasoned-inference (non-authoritative) | high | c7 | 2 |
| `c17` | Disavow the inherited toxic backlink profile | recommendation | unknown (**none**) | high | c15 | — |
| `c18` ☠ | Remove the mass redirect | recommendation | reasoned-inference (non-authoritative) | high | c9 | — |
| `c19` ☠ | Taking active remedial actions is preferable to passive waiting | opinion | operator-experience (non-authoritative) | medium | c16, c17, c18 | — |

☠ = invalidated because something it rests on failed.

## 4. What this reply actually concludes

- `c2` The previous site owner hosted approximately 200,000 pages that appear to be scraped content — evidence: **observed-runtime-behaviour**, confidence **high**
- `c3` Wayback Machine snapshots from before purchase reveal the site's prior purpose and structure — evidence: **reasoned-inference**, confidence **high**
- `c5` The duration of prior problematic activity indicates whether the issue is residual algorithmic distrust or requires active cleanup — evidence: **reasoned-inference**, confidence **medium**
- `c8` Determine whether the site still has a 301 redirect consolidating 200k legacy URLs to the homepage — evidence: **unknown**, confidence **unknown**
- `c10` The reputation damage from a mass redirect is separate and additional to the site's inherited domain reputation — evidence: **reasoned-inference**, confidence **medium**
- `c11` Check whether robots.txt, noindex tags, or CDN/edge rules from the old site are still in place — evidence: **widely-accepted-practice**, confidence **medium**
- `c13` Google's Live Test can show a URL as available in one crawl but blocked in a subsequent crawl if stale infrastructure rules exist — evidence: **observed-runtime-behaviour**, confidence **high**
- `c14` SEO tools like Yoast check page source for blocking rules but cannot detect server or CDN layer rules — evidence: **reasoned-inference**, confidence **high**
- `c19` Taking active remedial actions is preferable to passive waiting — evidence: **operator-experience**, confidence **medium**

> ⚠️ At least one conclusion asserts how software behaves without authoritative evidence.
> That is the HRC-001 shape: reasoning about behaviour is not evidence of behaviour.

## 5. Known uncertainties

- `c8` **unknown** — Determine whether the site still has a 301 redirect consolidating 200k legacy URLs to the homepage
- `c12` **unknown** — Rules at the server or CDN layer can block crawling and indexing even if page source is clean
- `c17` **unknown** — Disavow the inherited toxic backlink profile


### Language outrunning evidence

- `c3` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > pull snapshots from before you bought it and see what the site actually was
- `c6` asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence
  - > A manual action won't necessarily show up as anything other than 'not indexed' in coverage
- `c8` stated as fact, but the evidence is unknown (unknown) — say what you would check and why, or drop the claim
  - > Whether the blanket redirect of all those legacy URLs to your homepage is still live
- `c12` stated as fact, but the evidence is unknown (unknown) — say what you would check and why, or drop the claim
  - > if there's a stale rule sitting at the server or CDN level rather than in the page source
- `c14` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > rather than in the page source Yoast checks
- `c15` asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence
  - > If the Wayback history shows heavy scraping
- `c16` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > there's no manual action in GSC, a reconsideration request won't apply
- `c17` stated as fact, but the evidence is unknown (unknown) — say what you would check and why, or drop the claim
  - > disavowing the toxic inherited backlink profile
- `c18` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > removing the mass redirect are things you can actually do

## 6. Contradictions — 21 (8 fatal)

### `c5` — alternative-explanation · **FATAL**

Whether cleanup must be active depends on violation TYPE (manual action vs algorithmic) and whether toxic backlinks/spam exist — not on how long the prior activity ran. A scraper farm active for 2 weeks can trigger manual action (needs reconsideration request = active cleanup); a decade of low-quality-but-non-spammy content can resolve algorithmically once removed. Duration is not the discriminating variable — the reply's own next bullet (check GSC Security & Manual Actions) is the actual test, undermining duration as the indicator.

*Evidence:* widely-accepted-practice — Google Search Central manual actions documentation: manual actions are issued per violation instance/type, not scaled by duration; a brief but egregious spam period (e.g. hacked injection) still triggers a manual action requiring explicit reconsideration.

### `c5` — known-exception · **FATAL**

Algorithmic distrust from toxic backlinks (the 'residual' case) frequently still requires active cleanup — submitting a disavow file — rather than passive waiting. So even the 'residual algorithmic distrust' branch of the claimed dichotomy often needs the same active remediation as the 'manual action' branch, collapsing the distinction the claim relies on.

*Evidence:* widely-accepted-practice — Google's disavow links tool guidance: recommended for algorithmic (non-manual-action) link-spam distrust, explicitly framed as active cleanup, not wait-it-out.

### `c5` — counterexample

A long-running but low-severity issue (e.g. years of thin auto-generated content with no spammy backlinks) can carry algorithmic distrust that clears passively once content quality improves — while a short-lived but severe issue (e.g. brief cloaking or hacked-spam period) can trigger a manual action that never clears without reconsideration, regardless of how short it was. This shows duration and required-action-type vary independently, not monotonically as the claim implies.

*Evidence:* reasoned-inference — Contrast between Google's manual spam actions (triggered by violation severity/type, e.g. pure spam, cloaking, hacked content) versus algorithmic quality signals (triggered by aggregate content signals correlating more with volume/severity than elapsed time).

### `c6` — counterexample · **FATAL**

Many manual-action types don't touch indexing at all — they suppress rankings or devalue links while the page stays fully indexed. 'Unnatural links to your site' / 'Unnatural links from your site' penalties are the classic case: Google's own docs frame these as link-equity/ranking suppression, not removal. Affected pages keep showing 'Submitted and indexed' in Coverage — no 'not indexed' signal ever appears.

*Evidence:* primary-documentation — Google Search Central 'Manual actions report' doc — action types split into deindexing (pure spam, site-wide hacked content) vs. ranking/link suppression (unnatural links to/from site) with no required Coverage change for the latter.

### `c6` — contradictory-documentation · **FATAL**

"Without clear labeling" is wrong — GSC's Security & Manual Actions report names the exact violation type (pure spam, unnatural links, thin content, etc.), scope (site-wide/partial), and triggers an email + Message-center alert the moment it's applied. That's unambiguous labeling; it's just not surfaced in the Coverage report, which is a separate tool.

*Evidence:* primary-documentation — Google Search Console Help — Manual Actions report + automatic email/message notification on action application.

### `c9` — alternative-explanation · **FATAL**

Google's own guidance names a different, specific mechanism for exactly this pattern (bulk-redirecting removed/unrelated URLs to a homepage): soft-404 misclassification. Google's Search Central documentation on HTTP/network errors and on site moves warns that redirecting pages to a destination whose content doesn't match the original request — homepage catch-alls being the canonical example — gets flagged as a soft 404, meaning Google treats the URL as effectively non-existent and does not pass ranking signals through it at all. That is a crawl/indexing quality classification, not a link-spam/manipulation classification, and its outcome is the opposite of 'consolidation' — no equity is merged into the homepage, the URL is just dropped.

*Evidence:* primary-documentation — Google Search Central Help: 'Soft 404 errors' (crawling-indexing/http-network-errors) and 'Site moves with URL changes' guidance — both identify blanket redirect-to-homepage as a soft-404 risk specifically, not as manipulative link consolidation.

### `c9` — contradictory-documentation

Google's Spam Policies define 'link spam' / manipulative link schemes around artificially acquired third-party links — buying/selling links, excessive link exchanges, automated link-building services, PBNs. Redirecting URLs a site owner already controls to that same owner's homepage involves no third-party link acquisition and doesn't fall under that taxonomy at all. The only redirect-specific spam category Google names is 'sneaky redirects,' which requires showing crawlers and users different destinations (cloaking-style mismatch) — not present in a plain, consistent 301.

*Evidence:* primary-documentation — Google Search Essentials — Spam Policies for Google Web Search, 'Link spam' and 'Sneaky redirects' sections.

### `c9` — counterexample

Many-to-one redirect consolidation at large scale is standard, Google-endorsed practice during legitimate site migrations, domain merges, and forum/CMS shutdowns — often affecting hundreds of thousands of URLs redirected to a small set of targets, homepage included when no closer match exists. This is routine and not treated as manipulative by itself; the documented risk is specifically the 'irrelevant destination' case (soft 404), not the many-to-one cardinality.

*Evidence:* widely-accepted-practice — Google's own site-move migration guidance recommends 301s to the closest relevant equivalent, falling back to homepage only when no match exists — presented as normal migration technique, not as a manipulation risk.

### `c10` — configuration-dependency

Mass redirecting many legacy URLs to one target is not inherently penalized — Google's own site-migration guidance recommends 301-ing deprecated/removed URLs to the closest relevant replacement, and whether a many-to-one pattern reads as manipulative depends on topical relevance and redirect ratio, not on the act itself. So the 'additional damage' is conditional on the redirect looking deceptive (unrelated URLs consolidated to boost one target), not a guaranteed independent penalty source that applies on top of any inherited domain reputation.

*Evidence:* official-implementation — Google Search Central site-move/redirect guidance + John Mueller's repeated Webmaster Hangout statements that redirect consolidation is only treated as manipulative when relevance/intent signals point that way

### `c10` — alternative-explanation

The same symptom (redirected pages/domain not recovering rankings) is equally explained by Google simply not passing ranking value through the redirect at all — treating it as a weak/irrelevant signal and discounting it — rather than by an active, additive 'reputation damage' layered on top of inherited distrust. Non-transfer of signal and imposition of an extra penalty are mechanically different outcomes that produce identical observable symptoms, so the claim's causal attribution isn't uniquely supported by what's described.

*Evidence:* community-knowledge — Documented Google guidance/statements that redirects can be algorithmically discounted or ignored when the pattern doesn't look like a genuine 1:1 content move, as opposed to actively penalized

### `c10` — edge-case

Framing the two effects as literally 'separate and additional' implies a modular, additive scoring architecture (domain-history penalty + redirect-manipulation penalty stacked). Google's spam/quality systems (e.g. SpamBrain, core ranking systems) are not publicly documented as linear point-additive; they're holistic classifiers. Asserting additivity as fact goes beyond what's actually known about the mechanism, even though the practical advice (check both independently) is reasonable.

*Evidence:* unsupported — No published Google documentation describes discrete, additive penalty buckets for inherited domain reputation vs. redirect-consolidation patterns

### `c12` — known-exception

A robots.txt disallow at the server/CDN layer blocks crawling but does not by itself block indexing — Google can still index a URL it is disallowed from crawling (via external links/anchor text), showing it in results with 'No information is available for this page.' So 'block crawling and indexing' as a single joint outcome from one rule overstates robots.txt's effect; noindex (meta or X-Robots-Tag) is the mechanism that actually blocks indexing.

*Evidence:* primary-documentation — Google Search Central docs on robots.txt: disallowed-but-linked URLs can still appear indexed without a snippet; distinct from the noindex directive which is the actual indexing blocker

### `c12` — configuration-dependency

Major CDNs/WAFs (Cloudflare, Akamai, Fastly) ship default verified-bot allowlists that pass through Googlebot/Bingbot by IP+UA validation, so enabling CDN security/bot-management does not automatically block search engine crawling — it requires a specific misconfiguration (e.g., strict ASN/rate rules, 'Under Attack' JS challenge applied indiscriminately, or an old bot-fight rule not updated) for Googlebot to actually get blocked.

*Evidence:* widely-accepted-practice — Cloudflare/Akamai bot-management docs: verified bot categories exempted from challenge/block rules by default

### `c14` — counterexample · **FATAL**

GSC's URL Inspection 'Live Test' — referenced two lines earlier in the same reply — fetches the URL live through Google's own fetcher, reading the actual HTTP response and the live robots.txt as served (including whatever an edge/CDN rule injects), and reports if the fetched URL is blocked. That is direct server/CDN-layer detection by an SEO tool, not page-source scanning.

*Evidence:* official-implementation — Google Search Console URL Inspection Tool / Live Test behavior

### `c14` — counterexample · **FATAL**

Screaming Frog SEO Spider, a mainstream tool in the same class as Yoast, explicitly parses the X-Robots-Tag HTTP response header and fetches live robots.txt directives during a crawl — both are server-layer signals, not meta tags scraped from page source.

*Evidence:* official-implementation — Screaming Frog directives/response-header reporting (X-Robots-Tag column, robots.txt tab)

### `c14` — configuration-dependency

Even granting the narrower point about Yoast specifically: crawler-based tools (Screaming Frog, Sitebulb, Ahrefs Site Audit) still crawl from their own IP/user-agent, not Googlebot's — so CDN/WAF rules that block or cloak specifically for Googlebot's UA/IP range won't surface even in those header-aware tools. This limits, but doesn't eliminate, the counterexamples above.

*Evidence:* reasoned-inference — Bot-specific CDN/WAF rules (e.g., Cloudflare bot-fight rules keyed on Googlebot verification) evade non-Googlebot crawlers regardless of whether the crawler reads headers

### `c15` — alternative-explanation · **FATAL**

Wayback Machine captures come from Internet Archive's own crawler (Heritrix / 'ia_archiver', plus user-submitted 'Save Page Now' captures) — a system entirely separate from Googlebot and Google's ranking/trust pipeline. Google does not ingest archive.org snapshot data as a trust or ranking signal. The actual determinants of 'toxic reputation' are GSC manual actions and algorithmic systems (SpamBrain link-spam detection, Panda/helpful-content-style content evaluation) acting on current content and backlink profile — not on how many times IA happened to crawl the domain. So Wayback history can tell you what the site used to be (forensics), but it cannot itself 'indicate' Google's algorithmic distrust — that requires the GSC manual-actions check the reply separately (and correctly) recommends.

*Evidence:* primary-documentation — Internet Archive's documented independent crawling infrastructure vs. Google Search Central's Manual Actions / Search Essentials documentation as the actual source of spam-reputation signals

### `c15` — counterexample

Snapshot density/frequency in Wayback correlates mainly with site size, popularity, update cadence, and historical crawl-priority feeds (e.g. former Alexa Toolbar data), not with content toxicity. Massive, entirely reputable sites (major news outlets, large e-commerce catalogs, Wikipedia mirrors) show some of the heaviest capture histories on record with zero toxic reputation — so 'heavy' capture volume alone doesn't discriminate a scraper farm from a large legitimate site.

*Evidence:* observed-runtime-behaviour — Comparative Wayback capture-count behavior for high-volume legitimate domains vs. spam domains

### `c15` — configuration-dependency

Whether a prior owner's bad reputation actually inherits to a new owner depends on whether Google's demotion was manual-action-based (attached to the property, persists across ownership transfer until a reconsideration request is filed and granted) vs. purely algorithmic/content-tied (which typically fades once content is fully replaced and recrawled). Wayback snapshot history cannot distinguish which of these applies — only the GSC Manual Actions report can, which is a separate check the reply itself lists.

*Evidence:* framework-documentation — Google Search Central guidance distinguishing manual actions (persist until reconsideration) from algorithmic demotions (content/recrawl-dependent)

### `c16` — configuration-dependency

Manual actions are scoped to the specific verified property being viewed. If the site is checked via a URL-prefix property (e.g. https://example.com/) rather than a Domain property, a manual action applied to a different host/protocol variant (www vs non-www, http vs https, a subdomain) can exist and simply not display for the property being checked — meaning 'not shown' can be a false negative rather than proof no manual action exists.

*Evidence:* primary-documentation — Google Search Console Help — Manual Actions report documentation states the report reflects actions against the currently selected property; Google recommends the Domain property specifically to see the full picture across all site variants.

### `c16` — configuration-dependency

A GSC user with 'Restricted' permission level cannot view the Security & Manual Actions report at all. In that case 'no manual action is shown' reflects a permissions gap, not an absence of manual action — full/owner access is required to see it.

*Evidence:* primary-documentation — Google Search Console Help — user permission levels documentation: Restricted users are excluded from Security & Manual Actions data.

---

## 7. The draft, last

> Worth checking the domain's history on the Wayback Machine (web.archive.org/web/*/yourdomain.com) before spending more time on-page. You mentioned around 200k scraped pages existed under the previous owner — pull snapshots from before you bought it and see what the site actually was (scraper farm, expired-domain PBN, hacked site, etc.) and roughly how long that ran. That tells you whether you're dealing with residual algorithmic distrust or something that needs active cleanup.
> 
> A few things worth checking independent of the history angle too:
> 
> - GSC > Security & Manual Actions specifically, not just the coverage report. A manual action won't necessarily show up as anything other than "not indexed" in coverage.
> - Whether the blanket redirect of all those legacy URLs to your homepage is still live. Collapsing 200k pages into one 301 target can itself read as manipulative link consolidation to Google, separate from whatever reputation the domain already carries.
> - Whether robots.txt, a leftover noindex, or an edge/CDN rule from the old site is still in play somewhere in the stack. Live Test can show a URL as available on one crawl and still get blocked on a subsequent one if there's a stale rule sitting at the server or CDN level rather than in the page source Yoast checks.
> 
> If the Wayback history shows heavy scraping and there's no manual action in GSC, a reconsideration request won't apply, but disavowing the toxic inherited backlink profile and removing the mass redirect are things you can actually do instead of just waiting.

---

### What is still yours to decide

Argus checks that claims are *supported*. It cannot check that they are *true*, and it has no
opinion on whether this reply is worth posting. Those remain human judgements:

- Is the evidence cited actually what it claims to be?
- Does this answer what was asked?
- Would you put your name on it?
