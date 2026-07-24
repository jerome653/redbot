# Operator Review Package — `d_caf810a0f003_mrvwti98`

**Thread:** High database activity and caching plugin
**Verdict:** ⛔ **REJECT**
**Certified:** 2026-07-23 18:01 · model claude-haiku-4-5-20251001

> Read this in order. The draft is at the bottom on purpose — reading prose first primes you to
> assess whether it *sounds* right instead of whether it *is* right, which is exactly how
> HRC-001 reached the publication queue.

## 1. Thread status

🟢 open — no resolution signal found

_No resolution signals._

## 2. Verdict reasons

- **fatal-contradiction** `c3` — known-exception: WP Super Cache does not serve cached pages to logged-in users by default (only enabled if 'Cache pages for known users' is checked in Advanced Settings), and it also bypasses cache for any visitor carrying a comment_author, wp-postpass, or wordpress_logged_in cookie (default 'Rejected Cookies' list). Any of these visitors — including the site owner checking their own site while logged into wp-admin, which is the most likely way this check gets performed — will see the 'Dynamic' footer every time, regardless of whether the cache is serving everyone else fine. So 'Dynamic' does not reliably indicate the cache failed for the traffic spike; it may just indicate the requester was excluded from caching by design. [framework-documentation]
- **fatal-contradiction** `c7` — contradictory-documentation: The setting's own label is a negative: 'Don't cache pages with GET parameters.' Checking that box turns caching OFF for query-string URLs, not on. Telling the reader to 'explicitly allow it' via that control — without saying uncheck it — points the fix backwards; a reader who checks the box gets less query-string caching, not more, which would make the DB spike worse, not better. [reasoned-inference]
- **fatal-contradiction** `c13` — counterexample: WP Super Cache's cache-hit path (both Simple/PHP and Expert/mod_rewrite) is served by wp-content/advanced-cache.php, loaded via the WP_CACHE constant near the very top of wp-settings.php — before $wpdb/DB connection, before plugins_loaded/init, before theme load. On a match it echoes the cached file and calls exit(), so the rest of WordPress never runs. Only Expert mode differs by skipping PHP entirely via Apache rewrite rules; Simple mode still invokes PHP but only this small early shim, not a full WP boot. [official-implementation]
- **fatal-contradiction** `c15` — configuration-dependency: Expert mode's speed edge comes entirely from Apache mod_rewrite rules in .htaccess serving the static cache file before PHP even starts. On Nginx (no .htaccess support) or any host where AllowOverride is restricted (common on managed WP hosts), those rewrite rules never fire — WP Super Cache's own docs require the admin to hand-write equivalent Nginx server-block rules, which most users never do. Without that, every request falls through to PHP exactly as Simple mode does, so there is zero cost delta, and a botched rewrite rule can instead break the site (blank pages/stale content) per the plugin's own warning text on that settings page. [official-implementation]
- **fatal-contradiction** `c15` — alternative-explanation: The burst pattern actually being diagnosed in this thread is newsletter links carrying tracking query strings, which WP Super Cache excludes from caching by default in both Simple and Expert mode. For that specific burst, neither mode ever reaches the cached-file path — both invoke full PHP/WordPress/DB on every hit — so there is no cost difference between modes for the exact scenario under discussion. The 'Expert is cheaper under bursts' claim only holds for bursts of identical, cache-eligible (no-querystring) URLs, which is not what's happening here. [reasoned-inference]
- **fatal-contradiction** `c19` — configuration-dependency: WP Super Cache's own 'Mutex Locking' option is documented as serializing/queuing concurrent regeneration requests — only one process regenerates the page while others wait (block/retry) for the lock to clear. It is not described as handing waiters a stale cached copy; that's a distinct, separately-toggled feature ('Cache Rebuild' / serve-stale), not something Mutex Locking does on its own. [official-implementation]
- **fatal-contradiction** `c19` — configuration-dependency: Even where WP Super Cache does serve stale content during regeneration, that behavior is documented as working with Expert (mod_rewrite) mode — not Simple (PHP) mode, which the draft itself says this site is on. So in the exact scenario being diagnosed, mutex-locked waiters would block/retry (and can fall through to direct uncached PHP execution on timeout) rather than receive a stale copy — the opposite of what would explain reduced DB load. [framework-documentation]
- **fatal-contradiction** `c20` — alternative-explanation: WP Super Cache by design never caches wp-cron.php, admin-ajax.php, REST API (/wp-json/), xmlrpc.php, or POST requests. A DB spike driven by any of these (scheduled GC/cron jobs, Mailjet webhook callbacks, AJAX-based tracking pixels) fires regardless of what the page-source check on the article/landing page shows. Checking one cached page's footer comment says nothing about load on these paths — 'Cached' there does not establish the DB load is 'elsewhere,' since 'elsewhere' could just as well be one of these uncached endpoints on the same site. [official-implementation]
- **fatal-contradiction** `c20` — known-exception: WP Super Cache does not serve the cached copy to visitors carrying known-user cookies: logged-in users, recent commenters, and (with WooCommerce) cart-session cookies. Those visitors run full PHP/MySQL on every hit even while the plugin is healthy and even while the person checking (a clean, cookie-free browser) sees the 'Cached' comment. So the person doing the check can see 'Cached' while a meaningful slice of real recipients — anyone who has ever commented, or is logged in — is silently hitting the DB the whole time. This directly undercuts inferring the bottleneck is 'elsewhere' from a single clean-session page-source check. [official-implementation]
- **overconfident-language** `c16` — asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence — "if the cache for a page happens to expire right as the burst hits, every one of those simu"
- **invalidated-dependency** `c4` — rests on c3, which failed — invalid reasoning is not partially salvageable
- **invalidated-dependency** `c5` — rests on c3, which failed — invalid reasoning is not partially salvageable
- **falsifiable-claim-weak-evidence** `c16` — "Cache expiry coinciding with burst traffic causes cache stampede: simultaneous requests regenerate the page independently." asserts platform-behaviour on widely-accepted-practice — someone who knows the subject must confirm it, or it needs primary evidence
- **overconfident-language** `c3` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "If you're seeing "Dynamic" during the spike, the cache isn't actually being served"
- **overconfident-language** `c4` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "every visitor is hitting PHP/MySQL directly"
- **overconfident-language** `c5` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "which would explain the runaway queries"
- **overconfident-language** `c9` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "newsletter links carry any tracking parameters"
- **overconfident-language** `c10` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "every recipient who clicks lands on an uncached, dynamically-generated page"
- **overconfident-language** `c11` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "every recipient who clicks lands on an uncached, dynamically-generated page at the same ti"
- **overconfident-language** `c12` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "which is effectively the same load pattern you had with no cache at all"
- **overconfident-language** `c15` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "which is much cheaper under a burst of simultaneous hits"
- **overconfident-language** `c17` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "each doing full DB queries"
- **overconfident-language** `c19` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "while the others get served the old cached copy"
- **overconfident-language** `c20` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "If the page source shows "Cached" during the spike and none of the above apply, then the b"
- **unrefuted-falsifiable-claim** `c6` — "WP Super Cache does not cache URLs containing query strings by default." asserts implementation-detail and was never successfully attacked — its provenance (framework-documentation) is self-declared and unchecked

## 3. Claims — 22

| id | claim | type | evidence | conf | rests on | contra |
|---|---|---|---|---|---|---|
| `c1` | WP Super Cache appends an HTML comment to the bottom of cached pages. | implementation-detail | framework-documentation (authoritative) | high | — | 2 |
| `c2` | The appended comment is either '<!-- Cached page generated by WP-Super-Cache on ... -->' or '<!-- Dynamic page generated in X seconds. -->'. | implementation-detail | framework-documentation (authoritative) | high | c1 | 2 |
| `c3` | A 'Dynamic' comment in the page source during a spike indicates the cache was not served. | inference | reasoned-inference (non-authoritative) | high | c2 | **fatal** |
| `c4` ☠ | When the cache is not served, every visitor request hits PHP and MySQL directly. | inference | reasoned-inference (non-authoritative) | high | c3 | 2 |
| `c5` ☠ | Simultaneous PHP/MySQL hits during a spike explain runaway query activity. | inference | reasoned-inference (non-authoritative) | high | c4 | — |
| `c6` | WP Super Cache does not cache URLs containing query strings by default. | implementation-detail | framework-documentation (authoritative) | high | — | — |
| `c7` | Query string caching can be enabled via Settings > WP Super Cache > Advanced > 'Don't cache pages with GET parameters'. | configuration-advice | framework-documentation (authoritative) | high | c6 | **fatal** |
| `c8` | Newsletter links commonly carry tracking parameters such as Mailjet click-tracking redirects or UTM tags. | observation | widely-accepted-practice (non-authoritative) | medium | — | — |
| `c9` | Tracking parameters in newsletter links create query strings in the requested URLs. | inference | reasoned-inference (non-authoritative) | high | c8 | 2 |
| `c10` | When newsletter links have query strings and WP Super Cache is set to not cache query strings, recipients land on uncached pages. | inference | reasoned-inference (non-authoritative) | high | c6, c9 | 3 |
| `c11` | Multiple simultaneous newsletter recipient clicks generate simultaneous uncached page requests. | inference | reasoned-inference (non-authoritative) | high | c10 | — |
| `c12` | Simultaneous uncached page generation from newsletter traffic mimics the server load of having no cache at all. | inference | reasoned-inference (non-authoritative) | high | c11 | 2 |
| `c13` | WP Super Cache 'Simple (PHP)' mode boots the WordPress application for every request even when serving a cached page. | implementation-detail | framework-documentation (authoritative) | high | — | **fatal** |
| `c14` | WP Super Cache 'Expert' (mod_rewrite) mode serves cached files as static content from Apache/Nginx before WordPress boots. | implementation-detail | framework-documentation (authoritative) | high | — | 2 |
| `c15` | Expert mode is significantly cheaper than Simple mode under bursts of simultaneous requests. | inference | reasoned-inference (non-authoritative) | high | c13, c14 | **fatal** |
| `c16` | Cache expiry coinciding with burst traffic causes cache stampede: simultaneous requests regenerate the page independently. | platform-behaviour | widely-accepted-practice (non-authoritative) | high | — | 1 |
| `c17` | During cache stampede, each simultaneous regeneration performs full database queries. | inference | reasoned-inference (non-authoritative) | high | c16 | 2 |
| `c18` | Mutex Locking in WP Super Cache limits page regeneration to a single process at a time. | implementation-detail | framework-documentation (authoritative) | high | — | 3 |
| `c19` | When Mutex Locking is active, requests waiting for regeneration receive the stale cached copy. | inference | reasoned-inference (non-authoritative) | high | c18 | **fatal** |
| `c20` | If the page source shows 'Cached' during the spike and previously mentioned causes are ruled out, the database bottleneck originates elsewhere. | inference | reasoned-inference (non-authoritative) | high | c3, c6, c13 | **fatal** |
| `c21` | Theme and Elementor plugins can perform database queries on every page load even when serving cached pages. | observation | operator-experience (non-authoritative) | medium | — | — |
| `c22` | Dynamic widgets, forms, and related-posts blocks in themes and plugins are not cache-safe and query the database on every request. | observation | operator-experience (non-authoritative) | medium | c21 | — |

☠ = invalidated because something it rests on failed.

## 4. What this reply actually concludes

- `c5` Simultaneous PHP/MySQL hits during a spike explain runaway query activity. — evidence: **reasoned-inference**, confidence **high**
- `c7` Query string caching can be enabled via Settings > WP Super Cache > Advanced > 'Don't cache pages with GET parameters'. — evidence: **framework-documentation**, confidence **high**
- `c12` Simultaneous uncached page generation from newsletter traffic mimics the server load of having no cache at all. — evidence: **reasoned-inference**, confidence **high**
- `c15` Expert mode is significantly cheaper than Simple mode under bursts of simultaneous requests. — evidence: **reasoned-inference**, confidence **high**
- `c17` During cache stampede, each simultaneous regeneration performs full database queries. — evidence: **reasoned-inference**, confidence **high**
- `c19` When Mutex Locking is active, requests waiting for regeneration receive the stale cached copy. — evidence: **reasoned-inference**, confidence **high**
- `c20` If the page source shows 'Cached' during the spike and previously mentioned causes are ruled out, the database bottleneck originates elsewhere. — evidence: **reasoned-inference**, confidence **high**
- `c22` Dynamic widgets, forms, and related-posts blocks in themes and plugins are not cache-safe and query the database on every request. — evidence: **operator-experience**, confidence **medium**



## 5. Known uncertainties

_Every claim states a provenance._


### Language outrunning evidence

- `c3` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > If you're seeing "Dynamic" during the spike, the cache isn't actually being served
- `c4` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > every visitor is hitting PHP/MySQL directly
- `c5` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > which would explain the runaway queries
- `c9` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > newsletter links carry any tracking parameters
- `c10` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > every recipient who clicks lands on an uncached, dynamically-generated page
- `c11` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > every recipient who clicks lands on an uncached, dynamically-generated page at the same time
- `c12` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > which is effectively the same load pattern you had with no cache at all
- `c15` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > which is much cheaper under a burst of simultaneous hits
- `c16` asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence
  - > if the cache for a page happens to expire right as the burst hits, every one of those simultaneous requests can end up regenerating the page at once (cache stampede)
- `c17` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > each doing full DB queries
- `c19` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > while the others get served the old cached copy
- `c20` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > If the page source shows "Cached" during the spike and none of the above apply, then the bottleneck is something else

## 6. Contradictions — 35 (9 fatal)

### `c1` — configuration-dependency

By default WP Super Cache does not serve the 'Cached page generated by WP-Super-Cache' comment to logged-in users at all — the Advanced setting 'Cache pages for known users' is unchecked by default, so any logged-in visitor (including the site admin doing the check) is always routed to the dynamic/uncached path and will see the 'Dynamic page generated in X seconds' comment even when the cache is working perfectly for actual (logged-out) newsletter recipients.

*Evidence:* official-implementation — WP Super Cache Advanced settings screen, checkbox 'Cache pages for known users.' (unchecked by default) — a standard, frequently-documented setting in every WP Super Cache configuration guide.

### `c1` — configuration-dependency

Downstream HTML minification (Autoptimize, WP Rocket's minify/'Remove unused CSS', Cloudflare Auto Minify, Fast Velocity Minify, etc.) commonly strips HTML comments from the final response even though WP Super Cache did write the comment into the generated cache file — so an absent comment in view-source does not prove the page was served dynamically.

*Evidence:* widely-accepted-practice — HTML minifiers used alongside WP Super Cache routinely include comment-stripping as part of minification; this is a commonly cited caveat in WP performance troubleshooting threads for exactly this 'check the footer comment' test.

### `c2` — edge-case

Claim is strict either/or, but a third state exists: when WP Super Cache caching is toggled Off, the plugin isn't active, or its advanced-cache.php drop-in isn't loaded (common after core updates wipe drop-ins, or on a fresh/misconfigured install), the output-buffer hook that appends either comment never fires. Page source then has neither comment — not 'Dynamic', not 'Cached'.

*Evidence:* reasoned-inference — WP Super Cache's comment injection lives in the advanced-cache.php drop-in / wp-cache-phase2.php output buffer callback; if that hook isn't registered (caching off or drop-in missing) no buffer processing runs, so nothing gets appended.

### `c2` — configuration-dependency

WP Super Cache excludes logged-in users from the cache by default (Advanced Settings: don't cache pages for known/logged-in users). Anyone testing by viewing source while logged into wp-admin in that browser will see 'Dynamic page generated...' every time, regardless of whether anonymous newsletter clickers are being served the cache correctly. The reply's inference ('if Dynamic during the spike, cache isn't serving anyone') doesn't hold if the tester is logged in.

*Evidence:* community-knowledge — Well-documented WP Super Cache default behavior (Settings > WP Super Cache > Advanced, 'Cache Restrictions' section) — logged-in sessions bypass the page cache so admins/editors always see the dynamic path.

### `c3` — known-exception · **FATAL**

WP Super Cache does not serve cached pages to logged-in users by default (only enabled if 'Cache pages for known users' is checked in Advanced Settings), and it also bypasses cache for any visitor carrying a comment_author, wp-postpass, or wordpress_logged_in cookie (default 'Rejected Cookies' list). Any of these visitors — including the site owner checking their own site while logged into wp-admin, which is the most likely way this check gets performed — will see the 'Dynamic' footer every time, regardless of whether the cache is serving everyone else fine. So 'Dynamic' does not reliably indicate the cache failed for the traffic spike; it may just indicate the requester was excluded from caching by design.

*Evidence:* framework-documentation — WP Super Cache readme.txt / plugin FAQ and Advanced Settings page (Rejected Cookies list, 'Cache pages for known users' option)

### `c3` — edge-case

The footer comment is generated per-request at the moment PHP builds the page to (re)populate the cache file. A single 'Dynamic' hit is expected and normal the instant a cache file is missing or has just expired (garbage collection interval) — one visitor triggers the rebuild, then subsequent visitors get 'Cached'. Catching that one regeneration moment during a refresh does not mean the cache is failing for the whole spike or that every visitor is hitting PHP/MySQL directly.

*Evidence:* widely-accepted-practice — Standard page-cache regeneration/expiry behavior common to WP Super Cache and file-based full-page caches generally

### `c4` — configuration-dependency

If a persistent object cache is active (Redis/Memcached, e.g. via a Redis Object Cache-type plugin), WordPress's Object Cache API (wp_cache_get/wp_cache_set) serves most repeated reads (options, post meta, terms, menus) from the object cache layer even when WP Super Cache shows 'Dynamic.' PHP still executes, but MySQL is not hit for every query the page needs — contradicting the 'and MySQL directly' half of the claim.

*Evidence:* framework-documentation — WordPress Object Cache API — persistent object caching is a separate layer from page caching; a page-cache miss does not imply an object-cache miss.

### `c4` — alternative-explanation

If a CDN or reverse proxy sits in front of the origin (Cloudflare page rules/APO, host-level edge cache, etc.), it can cache the full HTML response — including a previously-baked 'Dynamic page generated in X seconds' comment — and re-serve it from edge on repeat hits during the spike. The visitor sees 'Dynamic' in source, but that specific request never reached origin PHP/MySQL. This also undercuts the draft's proposed diagnostic (view-source check) as proof of a live PHP/MySQL hit.

*Evidence:* widely-accepted-practice — Standard reverse-proxy/CDN edge-caching behavior (e.g. Cloudflare full-page caching) caches origin responses verbatim, including embedded debug/HTML comments generated at origin-render time.

### `c7` — contradictory-documentation · **FATAL**

The setting's own label is a negative: 'Don't cache pages with GET parameters.' Checking that box turns caching OFF for query-string URLs, not on. Telling the reader to 'explicitly allow it' via that control — without saying uncheck it — points the fix backwards; a reader who checks the box gets less query-string caching, not more, which would make the DB spike worse, not better.

*Evidence:* reasoned-inference — Literal semantics of the checkbox label quoted in the claim itself ('Don't cache pages with GET parameters' = enabling it disables caching for those URLs) — a well-known double-negative confusion point for this exact WP Super Cache setting.

### `c7` — configuration-dependency

This checkbox only governs the PHP-level (legacy WP-Cache) caching path. Under WP Super Cache's mod_rewrite-based caching methods (Expert / half-on), the generated Apache rewrite rules themselves require an empty QUERY_STRING before serving a static cached file — so any URL carrying tracking/UTM params bypasses the fast cache and always hits PHP/WordPress regardless of how this checkbox is set. The advice is accurate only because the draft later confirms the site is on 'Simple (PHP)' mode; stated as a general WP Super Cache fact it's incomplete.

*Evidence:* framework-documentation — WP Super Cache's mod_rewrite rule generation (Expert/half-on caching methods) conditions static-file serving on an empty QUERY_STRING, independent of the 'Don't cache pages with GET parameters' option.

### `c9` — configuration-dependency

Click-tracking redirects and UTM tagging are distinct ESP features. Mailjet's click-tracking redirect (ct.mailjet.com) logs the click and 302-redirects to the destination — by default it does not append query parameters to that destination URL. Query-string tracking params (utm_source, mc_cid/mc_eid, etc.) only appear if the sender separately enables UTM/parameter tagging. The draft treats 'Mailjet click-tracking redirects' and 'UTM tags' as the same mechanism producing the same effect on the requested URL; they aren't.

*Evidence:* community-knowledge — Standard ESP click-tracking architecture (Mailjet, Mailchimp, etc.): redirect hop records the click server-side; UTM/query-param injection is a separate, often opt-in, setting

### `c9` — edge-case

Tracking data appended after a '#' fragment (used by some client-side/SPA analytics schemes) is never transmitted to the server at all, so it cannot appear in the request line's query string — the server sees the bare URL. If a tracker used this pattern instead of '?key=value', the premise 'creates query strings in the requested URLs' would not hold for that link.

*Evidence:* language-specification — URL fragment identifiers are stripped by the user agent before the HTTP request is sent (RFC 3986 §3.5 — fragment is client-side only)

### `c10` — known-exception

WP Super Cache's GET-parameter exclusion has historically whitelisted a small set of single query params (e.g. `?p=`, `?page_id=`, `?cat=`, `?paged=`) used by plain-permalink/pagination URLs — pages hit with only one of those are still cached even when 'don't cache pages with GET parameters' is on. Doesn't save this case though: newsletter tracking params (utm_*, Mailjet click-token, etc.) aren't on that whitelist, so the no-cache outcome still holds for real ESP links.

*Evidence:* reasoned-inference — Recollection of wp-cache-phase2.php logic in WP Super Cache; not re-verified against current plugin source this session (WebFetch denied by permission mode).

### `c10` — configuration-dependency

In 'Expert' (mod_rewrite) caching mode, the .htaccess RewriteCond already skips the fast-path static-file serve whenever QUERY_STRING is non-empty, independent of the 'don't cache GET parameters' checkbox. Whether the request then still gets served from a PHP-level (legacy) cache or goes fully dynamic depends on that checkbox — so the mechanism is one layer more specific than the claim implies, though the end state (uncached/dynamic) is the same when the checkbox is on.

*Evidence:* reasoned-inference — General knowledge of WP Super Cache mod_rewrite rule structure.

### `c10` — alternative-explanation

If another cache layer sits in front of or beside WP Super Cache (host-level page cache on managed WP hosting, a CDN like Cloudflare with 'Cache Everything' + an ignore-query-string page rule), that layer can still serve a cached response for the query-string URL regardless of WP Super Cache's setting — so 'recipients land on uncached pages' isn't guaranteed to hold across every hosting environment, only when WP Super Cache is the sole/effective caching layer.

*Evidence:* widely-accepted-practice — Common managed-WordPress-hosting architecture (SiteGround/Kinsta/WP Engine server-level caching, Cloudflare page rules) layering cache in front of plugin-level cache.

### `c12` — configuration-dependency

"No cache at all" overstates it — WP Super Cache bypassing a URL only removes ITS page-cache layer. PHP OPcache (bytecode cache), MySQL's InnoDB buffer pool, and very commonly a host-level or CDN cache in front of WordPress (LiteSpeed Cache, Nginx FastCGI cache, Varnish, Cloudflare) keep operating independently of WP Super Cache's GET-parameter setting. A site truly running with zero caching anywhere behaves worse than one where only the WP-Super-Cache layer is bypassed on query-string URLs.

*Evidence:* widely-accepted-practice — Standard LAMP/LEMP + managed-WP hosting stack knowledge: OPcache and InnoDB buffer pool are near-universal defaults, and most WP hosts layer their own server-side cache ahead of any WP plugin.

### `c12` — edge-case

Equating the load to generic "no cache" undersells the concurrency profile: a newsletter blast produces a synchronized burst of identical requests within minutes, which can exhaust PHP-FPM's pm.max_children queue or MySQL's max_connections outright — a thundering-herd failure mode that a normal, time-distributed "no cache" traffic pattern wouldn't necessarily trigger. Same per-request cost, worse aggregate failure mode.

*Evidence:* widely-accepted-practice — Thundering-herd / cache-stampede behavior under synchronized traffic spikes vs. steady-state load — standard web-ops concurrency concern (PHP-FPM worker pool limits, DB connection limits).

### `c13` — counterexample · **FATAL**

WP Super Cache's cache-hit path (both Simple/PHP and Expert/mod_rewrite) is served by wp-content/advanced-cache.php, loaded via the WP_CACHE constant near the very top of wp-settings.php — before $wpdb/DB connection, before plugins_loaded/init, before theme load. On a match it echoes the cached file and calls exit(), so the rest of WordPress never runs. Only Expert mode differs by skipping PHP entirely via Apache rewrite rules; Simple mode still invokes PHP but only this small early shim, not a full WP boot.

*Evidence:* official-implementation — WP Super Cache's advanced-cache.php drop-in mechanism (WP_CACHE constant check in WordPress core wp-settings.php) plus the plugin's own documented 'serves cached files before WordPress is loaded' behavior — this is the plugin's entire performance premise.

### `c13` — configuration-dependency

Full WordPress bootstrap does occur on the 'legacy caching' fallback path (wp_cache_phase2 hooked to init) — used for requests that can't be served from the static Super Cache (e.g. logged-in users, uncacheable query strings) — but that's the not-cached case, not a property of Simple mode serving an actual cache hit.

*Evidence:* source-code — wp-cache-phase2 in wp-cache-phase2.php runs on WordPress's 'init' action, which by definition requires WP core, DB, and plugins already loaded.

### `c14` — configuration-dependency

mod_rewrite is an Apache-only module; WP Super Cache's Expert mode writes its direct-serve rules into .htaccess, which Nginx does not read or execute at all. On Nginx, WP Super Cache's own documentation says the equivalent behavior requires hand-written server-block rewrite rules — it is not generated or applied automatically the way it is on Apache. So 'Expert (mod_rewrite) mode' serving statically 'from Apache/Nginx' overstates Nginx support: on Nginx it's a manual, separate configuration, not the mod_rewrite mechanism itself.

*Evidence:* official-implementation — WP Super Cache readme.txt / plugin docs: Expert mode generates Apache .htaccess RewriteRule/RewriteCond blocks; Nginx section instructs manual server-block config since .htaccess/mod_rewrite has no Nginx equivalent.

### `c14` — known-exception

Even in Expert mode on Apache, the generated .htaccess rules only bypass PHP/WordPress when RewriteCond checks pass — no wordpress_logged_in/comment_author cookies, request method GET, and (by default) no query string. If any of those conditions fail, the request falls through to index.php and WordPress boots normally, so 'before WordPress boots' is conditional, not universal.

*Evidence:* official-implementation — WP Super Cache-generated .htaccess RewriteCond block (checks for auth cookies, %{REQUEST_METHOD}, %{QUERY_STRING}) gating the RewriteRule to the cached .html/.html.gz file.

### `c15` — configuration-dependency · **FATAL**

Expert mode's speed edge comes entirely from Apache mod_rewrite rules in .htaccess serving the static cache file before PHP even starts. On Nginx (no .htaccess support) or any host where AllowOverride is restricted (common on managed WP hosts), those rewrite rules never fire — WP Super Cache's own docs require the admin to hand-write equivalent Nginx server-block rules, which most users never do. Without that, every request falls through to PHP exactly as Simple mode does, so there is zero cost delta, and a botched rewrite rule can instead break the site (blank pages/stale content) per the plugin's own warning text on that settings page.

*Evidence:* official-implementation — WP Super Cache Advanced settings page / readme.txt: explicit warning that mod_rewrite (Expert) caching requires manually-added Nginx rewrite rules since Nginx ignores .htaccess, and that incorrect rules can serve broken or stale pages.

### `c15` — alternative-explanation · **FATAL**

The burst pattern actually being diagnosed in this thread is newsletter links carrying tracking query strings, which WP Super Cache excludes from caching by default in both Simple and Expert mode. For that specific burst, neither mode ever reaches the cached-file path — both invoke full PHP/WordPress/DB on every hit — so there is no cost difference between modes for the exact scenario under discussion. The 'Expert is cheaper under bursts' claim only holds for bursts of identical, cache-eligible (no-querystring) URLs, which is not what's happening here.

*Evidence:* reasoned-inference — Same draft's own diagnosis: 'WP Super Cache does not cache URLs that include a query string unless explicitly allowed' — applies identically regardless of Simple vs Expert setting.

### `c15` — edge-case

Even where mod_rewrite works, the marginal saving of Expert over Simple is just 'skip a thin PHP bootstrap and serve via Apache' — the expensive part (DB queries, plugin/theme execution) is already eliminated by caching in BOTH modes. Calling the remaining PHP-vs-static-file delta 'significantly cheaper' overstates it on any host with opcache/PHP-FPM tuned reasonably, where serving a cached string through advanced-cache.php costs low single-digit milliseconds.

*Evidence:* widely-accepted-practice — Well-documented WP Super Cache behavior: Simple mode already short-circuits full WP load via the advanced-cache.php drop-in before DB connection; Expert only removes the remaining PHP invocation itself.

### `c16` — configuration-dependency

WP Super Cache ships a mutex/lock mechanism ('Cache Rebuild' in Advanced Settings, enabled by default in modern versions) that serves the stale (already-expired) cached file to concurrent visitors while a single PHP process regenerates the page — it does not let every simultaneous request regenerate independently. The claim's mechanism only applies if this setting has been turned off, or if the plugin isn't actually caching the URL at all (e.g. due to query-string exclusion, as the draft itself investigates).

*Evidence:* official-implementation — WP Super Cache advanced-cache.php / plugin Advanced Settings tab, 'Cache Rebuild' option (serve stale copy during regeneration, mutex-locked rebuild) — a documented anti-stampede feature of the plugin itself

### `c17` — configuration-dependency

WP Super Cache ships an Advanced-setting called 'Mutex Locking' (EXPERIMENTAL) that uses sem_get()/flock() to allow only one PHP process to rebuild a given supercache file at a time — concurrent requests for the same expired page wait or get served the stale file instead of each spawning a fresh regeneration. If this is enabled, simultaneous visitors do NOT each trigger full DB queries; only one process does.

*Evidence:* framework-documentation — WP Super Cache Settings > Advanced > 'Mutex Locking' checkbox and its plugin description; long-standing (years-old) feature of the plugin itself

### `c17` — configuration-dependency

If the site pairs WP Super Cache with a persistent object cache (Redis Object Cache, Memcached, etc.), calls like get_option(), WP_Query, and menu/widget lookups are served from the shared object cache across PHP-FPM workers, not re-queried from MySQL each time. In that stack, concurrent page regenerations do not each perform 'full' database queries — only cache-miss items do.

*Evidence:* framework-documentation — WordPress core object-cache API (wp_cache_get/wp_cache_set) and standard behavior of persistent object-cache drop-ins — well documented in WP core developer docs

### `c18` — configuration-dependency

Mutex Locking is an opt-in Advanced Settings checkbox in WP Super Cache, off by default. Merely having the plugin 'active' does not mean regeneration is serialized — the site owner must have explicitly enabled it. If unchecked, the exact dogpile behavior the claim rules out is still happening.

*Evidence:* community-knowledge — WPSC Advanced settings tab, 'Mutex Locking' toggle, historically shipped default-off

### `c18` — edge-case

The lock relies on sem_get()/flock() under the hood. flock() is well-documented as unreliable or a no-op on NFS-mounted and some network/clustered filesystems, so on hosts where wp-content/cache sits on network storage, enabling the setting buys no real serialization even though the checkbox is on.

*Evidence:* community-knowledge — flock() semantics on NFS (PHP manual caveat, widely reported for any flock-based PHP locking, WPSC support threads referencing NFS/locking problems)

### `c18` — counterexample

The lock is scoped per cached file/URI, not a single global site-wide mutex. It only prevents concurrent processes from regenerating the *same* page at once — distinct URLs (different articles, or different query-string cache keys) still regenerate fully in parallel. A newsletter blast that fans traffic across several distinct article URLs (or across query-string variants that each get their own cache key) is not bounded to 'a single process at a time' site-wide by this feature.

*Evidence:* reasoned-inference — Per-file lock design implied by WPSC's file-based cache architecture (lock keyed to the cache filename being generated, not a global site mutex)

### `c19` — configuration-dependency · **FATAL**

WP Super Cache's own 'Mutex Locking' option is documented as serializing/queuing concurrent regeneration requests — only one process regenerates the page while others wait (block/retry) for the lock to clear. It is not described as handing waiters a stale cached copy; that's a distinct, separately-toggled feature ('Cache Rebuild' / serve-stale), not something Mutex Locking does on its own.

*Evidence:* official-implementation — WP Super Cache Advanced Settings copy for 'Mutex Locking' + wp-cache-phase2.php lock-acquire logic (wp_cache_sem_acquire/flock): losers of the lock wait, they aren't routed to the old file.

### `c19` — configuration-dependency · **FATAL**

Even where WP Super Cache does serve stale content during regeneration, that behavior is documented as working with Expert (mod_rewrite) mode — not Simple (PHP) mode, which the draft itself says this site is on. So in the exact scenario being diagnosed, mutex-locked waiters would block/retry (and can fall through to direct uncached PHP execution on timeout) rather than receive a stale copy — the opposite of what would explain reduced DB load.

*Evidence:* framework-documentation — WP Super Cache docs tie serve-stale-during-rebuild to Expert/mod_rewrite caching; Simple (PHP) mode lacks that path.

### `c20` — alternative-explanation · **FATAL**

WP Super Cache by design never caches wp-cron.php, admin-ajax.php, REST API (/wp-json/), xmlrpc.php, or POST requests. A DB spike driven by any of these (scheduled GC/cron jobs, Mailjet webhook callbacks, AJAX-based tracking pixels) fires regardless of what the page-source check on the article/landing page shows. Checking one cached page's footer comment says nothing about load on these paths — 'Cached' there does not establish the DB load is 'elsewhere,' since 'elsewhere' could just as well be one of these uncached endpoints on the same site.

*Evidence:* official-implementation — WP Super Cache documented caching scope (readme.txt / plugin FAQ) — excludes admin, cron, AJAX, XML-RPC, and non-GET requests from the page cache by design.

### `c20` — known-exception · **FATAL**

WP Super Cache does not serve the cached copy to visitors carrying known-user cookies: logged-in users, recent commenters, and (with WooCommerce) cart-session cookies. Those visitors run full PHP/MySQL on every hit even while the plugin is healthy and even while the person checking (a clean, cookie-free browser) sees the 'Cached' comment. So the person doing the check can see 'Cached' while a meaningful slice of real recipients — anyone who has ever commented, or is logged in — is silently hitting the DB the whole time. This directly undercuts inferring the bottleneck is 'elsewhere' from a single clean-session page-source check.

*Evidence:* official-implementation — WP Super Cache documented cookie-based cache bypass (does not serve cached HTML to visitors with comment_author, wordpress_logged_in, or configured 'rejected cookies').

### `c20` — configuration-dependency

The draft's own next paragraph shows the query-string exclusion caveat: if the checker loads the bare URL (no tracking params) they'll see 'Cached,' but real subscribers clicking Mailjet-tracked links land on a different, uncached variant of the same URL. So a 'Cached' reading only rules anything out if the check was performed on the exact URL (with query string) that recipients actually click — otherwise the check is testing a different request than the one causing load, and 'ruled out' doesn't hold.

*Evidence:* reasoned-inference — Internal to the draft itself — the query-string caching exclusion described two paragraphs later contradicts treating a bare-URL 'Cached' check as conclusive.

---

## 7. The draft, last

> Draft below, WP Super Cache diagnosis angle, ready to edit/post.
> 
> One check first: open your page source right after a send and look at the very bottom of the HTML. WP Super Cache appends a comment there — either `<!-- Cached page generated by WP-Super-Cache on ... -->` or `<!-- Dynamic page generated in X seconds. -->`. If you're seeing "Dynamic" during the spike, the cache isn't actually being served and every visitor is hitting PHP/MySQL directly, which would explain the runaway queries regardless of the plugin being active.
> 
> A common cause of that: WP Super Cache does not cache URLs that include a query string unless you explicitly allow it (Settings > WP Super Cache > Advanced > "Don't cache pages with GET parameters"). If your newsletter links carry any tracking parameters (Mailjet click-tracking redirects, UTM tags, etc.), every recipient who clicks lands on an uncached, dynamically-generated page at the same time — which is effectively the same load pattern you had with no cache at all. Worth checking the actual href your subscribers click, not just the base URL.
> 
> Two other things in Advanced settings worth checking while you're there:
> 
> - You're on "Simple (PHP)" caching. That mode still boots WordPress for every request even when serving a cached page. "Expert" (mod_rewrite) caching serves the static file straight from Apache/Nginx before WordPress loads at all, which is much cheaper under a burst of simultaneous hits.
> - "Mutex Locking" — if the cache for a page happens to expire right as the burst hits, every one of those simultaneous requests can end up regenerating the page at once (cache stampede), each doing full DB queries. Mutex Locking limits that to one regeneration at a time while the others get served the old cached copy.
> 
> If the page source shows "Cached" during the spike and none of the above apply, then the bottleneck is something else (theme/Elementor doing DB queries even on cache hits, e.g. dynamic widgets, forms, or related-posts blocks that aren't cache-safe) and it'd help to know what's actually running.

---

### What is still yours to decide

Argus checks that claims are *supported*. It cannot check that they are *true*, and it has no
opinion on whether this reply is worth posting. Those remain human judgements:

- Is the evidence cited actually what it claims to be?
- Does this answer what was asked?
- Would you put your name on it?
