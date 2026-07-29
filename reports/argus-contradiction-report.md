# Contradiction Report

**Generated:** 2026-07-29 · **Contradictions:** 45 · **Fatal:** 12

Every claim is attacked, not assessed. A model asked "is this right?" agrees; a model asked
"find where this breaks" looks.

### `d_eef1e76628fc_ms6` / `c1` — alternative-explanation · **FATAL**

The claim's disjunction (freelancer / agency / friend) is not exhaustive. A website can exist under an account the user never set up because a hosting provider or domain registrar auto-generates a default placeholder, 'parked domain', or website-builder starter page at signup or on domain registration — with no human 'setting it up' at all. In that case not-user is true but none of freelancer/agency/friend is true, so the conditional fails.

*Evidence:* widely-accepted-practice — Common hosting/registrar behavior (e.g., IONOS, GoDaddy, Namecheap) of auto-provisioning a default 'coming soon' or template page on new hosting/domain accounts, independent of any developer or agency involvement

### `d_eef1e76628fc_ms6` / `c1` — counterexample · **FATAL**

An unauthorized third party (a hacker, scammer, or someone who compromised/registered the account with stolen identity/payment info) can also be the one who 'set up' the site. Such an actor is 'someone else' but is not a freelancer, agency, or friend — and the reply's own next sentence explicitly treats 'unauthorized access' as a categorically different situation, contradicting the claim's implication that any non-user setup falls into those three benign categories.

*Evidence:* reasoned-inference — Internal inconsistency in the source text: it draws a firm line between 'freelancer/agency/friend set it up' and 'someone else gaining unauthorized access', yet both are instances of 'someone else... set it up' under the claim's own wording

### `d_eef1e76628fc_ms6` / `c1` — counterexample

The site could have been built by a previous owner of the domain (e.g., a lapsed/expired domain later re-registered by the current user, with residual site content, cached DNS, or a reseller's template still attached) rather than by anyone the current user ever engaged. That party is neither a freelancer, agency, nor friend of the user.

*Evidence:* community-knowledge — Common domain-lifecycle scenario: expired/dropped domains frequently retain or regenerate prior hosting artifacts under a new registrant who has no relationship with the original builder

### `d_eef1e76628fc_ms6` / `c2` — counterexample

Widely-followed web-development best practice is the opposite of what the claim predicts: reputable freelancers and agencies are commonly advised (and often required by contract) to register hosting/domain accounts using the CLIENT's own name, email, and payment details — precisely so the client retains ownership — while the developer just holds login credentials as a delegated user. In that (very common) setup the account is registered under the user's own name even though someone else 'set it up,' which is the direct opposite of what the claim predicts.

*Evidence:* widely-accepted-practice — Standard client-ownership guidance repeated across web-dev/agency communities (e.g. WordPress agency onboarding checklists, 'always let the client own their hosting and domain' advice threads on r/webdev and r/WordPress) — the recommended pattern is client-name registration with delegated developer access.

### `d_eef1e76628fc_ms6` / `c2` — alternative-explanation

IONOS hosting packages commonly let one account manage many domains/sites simultaneously (agency/reseller-style packages). If that's what happened here, the account isn't 'registered under' the individual developer's personal name at all — it's under an agency or business account name, which is a third category distinct from both 'the user's name' and 'the individual who built the site.' The binary framing in the claim (their name vs. the user's name) doesn't cover this case.

*Evidence:* community-knowledge — IONOS multi-domain/multi-site hosting plans are a standard offering allowing a single account holder (often a business/agency, not a named individual) to host multiple unrelated client sites.

### `d_eef1e76628fc_ms6` / `c4` — alternative-explanation · **FATAL**

The 'I don't have any websites' message is shown by the WordPress.com account dashboard (the hosted SaaS product), which only lists sites created directly on WordPress.com or self-hosted sites that have been explicitly connected via the Jetpack plugin. IONOS-hosted WordPress is self-hosted WordPress.org software; unless Jetpack was installed and connected to that site, it will never appear in ANY WordPress.com account's site list — including the correct, rightfully-owned account. So the message is the expected default state for a self-hosted/IONOS site regardless of which WordPress.com account is logged in, and does not indicate an account/site mismatch.

*Evidence:* official-implementation — WordPress.com's 'My Sites' list is populated only by WordPress.com-hosted sites and Jetpack-connected self-hosted sites (documented WordPress.com/Jetpack architecture); a self-hosted IONOS install with no Jetpack connection has no relationship to any WordPress.com account by design.

### `d_eef1e76628fc_ms6` / `c4` — counterexample

Even when the correct WordPress.com account is used and the site was previously connected, a user can be removed as a collaborator/user from that site (by an admin, agency, or after an ownership transfer) and will then see 'no sites' despite being logged into the very account that was once linked to it. This is access revocation, not being logged into an unrelated account.

*Evidence:* widely-accepted-practice — WordPress.com/Jetpack user-role management: removing a user from a connected site removes it from that user's 'My Sites' list without affecting other accounts' access.

### `d_eef1e76628fc_ms6` / `c4` — edge-case

If the site's Jetpack connection to WordPress.com was broken (expired token, plugin deactivated, site migrated/reinstalled by IONOS support), a previously-linked site can silently drop off the 'My Sites' list for the correct account holder, mimicking the 'wrong account' symptom.

*Evidence:* community-knowledge — Commonly reported Jetpack disconnection behavior (e.g., after host migrations, PHP/plugin updates, or manual Jetpack disconnect) causing sites to disappear from WordPress.com's site list until reconnected.

### `d_eef1e76628fc_ms6` / `c6` — configuration-dependency

The 'I don't have any websites' list is populated by which sites are Jetpack-connected (or hosted-on-WordPress.com) to the currently logged-in WordPress.com/account, an entirely separate identity system from the IONOS hosting account that actually owns/hosts the site. That list being empty tells you nothing about who holds the IONOS account — it only reflects Jetpack connection state for whichever WordPress.com login is active. A self-hosted site with no Jetpack connection at all shows the exact same empty list even when the user themselves owns 100% of the site and hosting outright, with zero third-party involvement.

*Evidence:* widely-accepted-practice — Standard Jetpack/WordPress.com architecture: the 'My Sites' list in the WordPress.com dashboard/app enumerates only sites connected via Jetpack (or wordpress.com-hosted) to the signed-in WP.com account; unconnected self-hosted sites never appear regardless of ownership.

### `d_eef1e76628fc_ms6` / `c6` — alternative-explanation

The same empty message equally arises if the user is simply logged into the wrong or a forgotten personal WordPress.com account of their own — no second party required. Since the symptom is produced identically whether the account belongs to a stranger/agency or to the user's own unrelated login, it does not discriminate between 'someone else's account' and 'my own account, wrong login,' making it uninformative as evidence for the specific theory it's being used to support.

*Evidence:* reasoned-inference — Logical structure of the symptom: identical output under both the stated hypothesis and a mundane self-caused alternative means the observation has no discriminating power between them.

### `d_eef1e76628fc_ms6` / `c8` — known-exception · **FATAL**

IONOS, like virtually all hosting providers and registrars, will not disclose account holder identity, creation date, or account/login activity to a caller who cannot first verify they are the account owner (via account PIN, security questions, ID verification, or an active login). If the user is not the account holder, this is precisely the scenario where support is trained to refuse the request rather than reveal it — GDPR data-minimization/confidentiality obligations (IONOS is an EU/German entity, 1&1 IONOS SE) reinforce this. So the premise that 'their answers will tell you fairly quickly' assumes disclosure that standard support policy is built to prevent for exactly this caller.

*Evidence:* widely-accepted-practice — Standard identity-verification gating used by hosting providers/registrars (IONOS, GoDaddy, Namecheap, etc.) before releasing any account details, combined with GDPR confidentiality obligations on EU-based providers toward non-account-holder third parties.

### `d_eef1e76628fc_ms6` / `c8` — counterexample

Even where creation date and login activity ARE disclosed, they do not reliably distinguish 'legitimate account registered by someone else' from 'unauthorized compromise.' A compromised account keeps its original creation date regardless of when the takeover happened, and if the compromise occurred long ago, 'login activity' will simply show a long, consistent access history indistinguishable from legitimate long-term ownership. The two scenarios can produce identical creation-date and login-history signatures.

*Evidence:* reasoned-inference — Account metadata (creation timestamp, login timestamps) records when the account/session was created or accessed, not who is authorized to hold it or when authorization changed — an attacker with persistent access produces the same shape of data as a legitimate long-standing third-party owner.

### `d_eef1e76628fc_ms6` / `c8` — edge-case

The 'account holder on file' may be a reseller or agency-of-agency (common in shared/white-label hosting), not the individual freelancer/developer the user is trying to trace. In that case the name IONOS provides won't map cleanly onto 'someone else legitimately set this up' vs. 'this was compromised' — it just adds another unfamiliar name to check, which the earlier framing (this is 'a very different situation') doesn't account for.

*Evidence:* community-knowledge — Reseller/white-label hosting arrangements are common in the web-dev/agency space, where the billing account holder differs from the actual site builder.

### `d_fee0044a496c_ms6` / `c2` — known-exception

WebP Express itself doesn't only offer rewrite-rule or PHP-fallback serving — it also has an 'Alter HTML' operation mode that rewrites <img> tags into <picture> elements with a webp <source>, letting the browser natively pick the format via content negotiation rather than any server-side rewrite/PHP decision at request time. This is a documented, selectable mode in the plugin, not a rewrite rule or a PHP fallback mechanism.

*Evidence:* official-implementation — WebP Express plugin documentation/settings (by Bjørn Rosell) describes multiple 'operation modes' including a picture-tag/Alter-HTML mode alongside the .htaccess rewrite mode and PHP fallback mode

### `d_fee0044a496c_ms6` / `c2` — configuration-dependency

The 'rewrite rule' half of the mechanism is Apache/mod_rewrite (or nginx try_files) specific and requires server-level config; on hosts without .htaccess support (e.g. some IIS or locked-down nginx setups) the plugin cannot use a rewrite rule at all and must fall back entirely to the PHP method, meaning it's not accurate to describe both as freely interchangeable options for every visitor/server combination as the claim implies.

*Evidence:* reasoned-inference — General web-server architecture: mod_rewrite is Apache-specific, IIS/nginx require separate rewrite syntax or plugin-level PHP fallback

### `d_fee0044a496c_ms6` / `c3` — configuration-dependency

Rewrite-rule-based conditional serving (mod_rewrite checking HTTP_ACCEPT, or an equivalent Nginx map) decides the format once per cached response, not per visitor. If the page or image is served through any caching layer — browser cache, a CDN, a reverse proxy, or a WordPress page-cache plugin — without the response correctly declaring `Vary: Accept`, a webp response served to one visitor's webp-capable browser can be cached and then handed to a later visitor whose browser cannot decode webp (or vice versa). At that point the format a given visitor receives reflects the cache state, not that visitor's own browser support.

*Evidence:* framework-documentation — MDN's documentation on HTTP content negotiation and the Vary header describes exactly this failure mode for server-driven negotiation behind caches; it's a well-known operational gotcha for Apache/Nginx image-negotiation snippets and is a common complaint in WordPress performance-plugin support threads where page-cache plugins (WP Super Cache, W3TC, etc.) interact with webp-rewrite plugins.

### `d_fee0044a496c_ms6` / `c3` — edge-case

The 'based on browser support' check is really a proxy — it inspects the `Accept` header (or, in PHP-fallback modes, a User-Agent string match) on the current HTTP request, not the browser's actual codec capability. These two can diverge: some browsers/contexts don't send `Accept: image/webp` for every resource type (notably CSS `background-image` requests in some browser versions), and intermediary proxies, privacy extensions, or corporate security gateways can strip or rewrite Accept/User-Agent headers. In those cases the plugin falls back to the original format even though the visitor's browser does support webp, or (with UA-string heuristics) can misjudge a forked/embedded browser (in-app WebViews, etc.) that doesn't match the known-good UA list.

*Evidence:* community-knowledge — This is a documented limitation discussed in WebP-conditional-serving plugin support forums (e.g. WebP Express's own FAQ notes it must fall back to User-Agent detection for certain non-<img> requests because no Accept header is available), and is consistent with general content-negotiation caveats.

### `d_fee0044a496c_ms6` / `c4` — configuration-dependency

The claim only holds for context-aware (PHP/WordPress-hook-based) conditional serving. For the rewrite-rule variant explicitly named in the context (WebP Express's .htaccess/mod_rewrite method), the interception happens purely at the web-server layer based on the request URL and the Accept header — it has no notion of 'this request came from wp-admin's media library grid vs. the public front end.' The wp-admin Media Library list/grid renders thumbnails with plain <img src="…/wp-content/uploads/…jpg"> tags, which is the identical URL space the rewrite rule intercepts. Since virtually all modern browsers (Chrome, Firefox, Edge) send an Accept header advertising image/webp support on every image request — including ones made while an administrator is browsing wp-admin — the same admin, viewing the Media Library in such a browser, would actually be served the generated WebP bytes at that URL, not the original file's bytes, unless the plugin has added an explicit is_admin()/referer-based exclusion for wp-admin contexts. That exclusion is a configuration/plugin-specific feature, not an inherent property of 'conditional serving' as a category.

*Evidence:* reasoned-inference — Mechanics of htaccess/mod_rewrite-based conditional WebP serving (e.g. WebP Express's rewrite-rule mode): the decision is made by the web server on Accept header + file extension alone, with no built-in WordPress admin-context awareness unless the plugin specifically adds it.

### `d_fee0044a496c_ms6` / `c5` — configuration-dependency

Several plugins that offer conditional WebP serving (EWWW Image Optimizer, ShortPixel, Imagify) bundle it with a separate lossy/lossless optimization pass that overwrites the original JPG/PNG file in place (with an optional backup-before-overwrite setting, often opt-in rather than default). In that common real-world configuration, the source file's bytes ARE replaced, even though the WebP delivery itself is purely conditional/rewrite-based. This doesn't apply to WebP Express (the example actually named), which only writes separate .webp copies and never touches the original — but it does undercut the claim as a generalization applied to 'conditional serving' plugins as a category.

*Evidence:* widely-accepted-practice — Documented behavior of EWWW Image Optimizer and ShortPixel Image Optimizer: both optimize/re-encode the original uploaded file in place as their core feature, with a 'backup originals before optimizing' toggle implying the live file in the uploads folder is otherwise overwritten; this optimization step is independent of, but commonly bundled alongside, their WebP conditional-serving delivery mode.

### `d_fee0044a496c_ms6` / `c6` — configuration-dependency

Genuine convert-and-replace only works if the server's PHP has WebP-capable GD or Imagick (or the plugin falls back to a cloud/API conversion). On hosts where the image library lacks WebP support, plugins like EWWW Image Optimizer, ShortPixel, and Imagify cannot produce real replacement .webp files at all — they either fail the operation or silently fall back to conditional/rewrite-based serving, regardless of which mode the user picked in settings.

*Evidence:* framework-documentation — EWWW Image Optimizer and ShortPixel documentation both note that local WebP conversion depends on server GD/Imagick WebP support and offer their own cloud API specifically to cover servers that lack it

### `d_fee0044a496c_ms6` / `c6` — edge-case

Plugins marketed as 'convert and replace' (e.g. EWWW's PNG↔JPG/WebP convert feature, WP-Optimize's image module) generally keep the original file as a recoverable backup rather than deleting it outright when the swap happens — the on-disk original is typically only purged by a separate, explicit 'delete originals' or 'remove backups' action. So 'replace' in these plugins' UI usually means the media library/attachment reference is swapped to the new webp file, not that the old bytes are immediately gone.

*Evidence:* framework-documentation — EWWW Image Optimizer's convert feature and WP-Optimize's image compression module both document retaining a restorable backup of the pre-conversion file after a 'replace' operation

### `d_fee0044a496c_ms6` / `c7` — counterexample · **FATAL**

Regeneration does not require replacement/deletion of originals. Several 'replace' plugins (e.g. WebP Express in 'directory structure' mode) write generated .webp files as siblings alongside the untouched original in the uploads tree, rather than overwriting or deleting the source file. A downstream process that reads the uploads folder directly and knows to look for a same-named .webp variant will find it without any file being replaced — only additive regeneration occurred, not replacement.

*Evidence:* community-knowledge — WebP Express's documented 'store in the same folder' conversion mode leaves original jpg/png files intact and adds an image.jpg.webp companion file

### `d_fee0044a496c_ms6` / `c7` — alternative-explanation · **FATAL**

Whether replacement is needed depends entirely on how the 'downstream' consumer accesses the file, which the claim doesn't specify. If the downstream system fetches the image over HTTP/HTTPS (a CDN pulling from origin, an image-optimization edge service, a mobile app hitting the media URL) rather than reading the filesystem, it passes through the same webserver rewrite/PHP-fallback layer as a browser and gets the negotiated response — no replacement needed. Only genuine out-of-band filesystem access (e.g., a backup job, an image pipeline scanning disk, rsync/S3 sync) bypasses the rewrite layer and would actually need a real file present.

*Evidence:* reasoned-inference — Standard behavior of Apache/Nginx rewrite-based or PHP-fallback conditional serving: any HTTP request to the media URL is intercepted server-side regardless of requester identity

### `d_fee0044a496c_ms6` / `c7` — counterexample

Some downstream 'services' that read origin images do their own format conversion at request time and never need a pre-existing webp file on disk at all — e.g., CDN/edge image optimizers (Cloudflare Polish, Cloudinary fetch-and-transform, imgix, Bunny Optimizer) fetch the original from the uploads folder over HTTP and transcode to WebP themselves. For these, the claim's premise is inverted: the existence of a downstream consumer reading the folder can make replacement *unnecessary*, not required.

*Evidence:* widely-accepted-practice — Documented behavior of on-the-fly image-optimization CDNs that transcode at the edge without requiring origin-side format conversion

### `d_fee0044a496c_ms6` / `c8` — configuration-dependency

Several conditional-serving plugins (e.g. WebP Express) implement the .htaccess rewrite by checking only whether a cached .webp file exists at the mapped path (RewriteCond ... -f on the webp cache file), not whether the original .jpg/.png still exists. Once the webp cache has been populated, WebP-capable browsers (now ~97%+ of traffic per caniuse) continue to be served correctly from that cache even if the original source file is deleted — only the small remaining non-WebP-capable segment would then get a broken image instead of the fallback original. So for a site willing to accept degraded/broken images for a small legacy-browser minority, originals can in fact be deleted while still using a 'conditional serving' plugin, without switching to a dedicated regenerate/replace plugin.

*Evidence:* community-knowledge — Documented .htaccess rewrite pattern used by WebP Express and similar Apache-rewrite-based WebP plugins, where the RewriteCond existence check targets the cached .webp file rather than the source image

### `d_fee0044a496c_ms6` / `c8` — alternative-explanation

The goal of 'deleting the source images' can also be achieved by relocating originals to a CDN/edge image service (e.g. Cloudflare Images, Cloudinary, Jetpack Photon) that fetches and caches the image once, then serves format-negotiated (WebP/AVIF) variants from its own edge cache going forward. In this architecture no local file 'replacement' occurs at all — the local jpg/png can be deleted immediately after the CDN's first fetch, with the CDN's own cached copy (not a locally generated replacement file) backing subsequent requests. This satisfies 'delete the local original' without any local regenerate/replace plugin.

*Evidence:* widely-accepted-practice — Common CDN image-optimization architecture (Cloudflare Polish/Images, Cloudinary fetch-and-cache, Jetpack Photon) where origin-fetch-once-then-serve-from-cache decouples local storage from image serving

### `d_fee0044a496c_ms6` / `c9` — configuration-dependency

The conditional-serving approach described (WebP Express and similar plugins using a PHP fallback / rewrite rule to convert on request) only delivers a speed benefit if the converted file is cached; in their default or misconfigured state, some of these plugins re-invoke PHP-based conversion on cache misses or on every request, which adds server-side processing time per page load and can make the page slower than simply serving the original JPEG/PNG statically.

*Evidence:* widely-accepted-practice — Documented behavior of on-the-fly image-conversion plugins (e.g. WebP Express's own docs warn to enable/verify caching); on-request conversion without a populated cache is a known performance pitfall distinct from pre-converted, statically served WebP.

### `d_fee0044a496c_ms6` / `c9` — counterexample

File-size reduction from WebP is not universal across image content: independent encoder comparisons (e.g. Cloudinary's and Kornel Lesiński's/squoosh.app benchmarks) show that JPEG re-encoded with mozjpeg at matched SSIM/quality can equal or beat WebP's file size for a meaningful share of photographic images, so switching format alone doesn't guarantee a smaller payload (and thus doesn't guarantee a faster load) unless encoder settings are also optimized.

*Evidence:* community-knowledge — Multiple public encoder-comparison studies (Cloudinary format comparisons, squoosh.app author's writeups) showing overlapping size distributions between optimized JPEG and WebP at equal perceptual quality.

### `d_fee0044a496c_ms6` / `c9` — known-exception

'Page load time' includes client-side decode/render cost, not just transfer size. WebP (and especially AVIF) decoding is more CPU-intensive than baseline JPEG decoding; on low-end or battery-throttled mobile devices with many images on a page, the extra decode time can offset or exceed the time saved from a smaller download, so total time-to-render is not guaranteed to improve.

*Evidence:* observed-runtime-behaviour — Reported CPU-decode overhead of WebP/AVIF relative to JPEG on constrained hardware, discussed in browser-vendor and image-format performance writeups (e.g. Google/Mozilla format-performance analyses).

### `d_fee0044a496c_ms6` / `c9` — edge-case

Clients that don't render WebP at all (older Android WebViews, some crawlers/scrapers, certain PDF/print or downstream image-processing pipelines, some email clients) will either fail to display the image or require the fallback path described in the reply — in those cases the 'modern format' delivers no load-time benefit at all, since the original is what actually gets served or the request errors.

*Evidence:* widely-accepted-practice — General WebP compatibility gaps outside modern mainstream browsers, which is precisely why conditional-serving/fallback plugins like WebP Express exist.

### `d_e3f85c727608_ms6` / `c1` — configuration-dependency · **FATAL**

The X-LiteSpeed-Cache hit/miss response header is not emitted unconditionally by default — it depends on the 'X-LiteSpeed-Cache Control' / debug-header setting being enabled (in LSWS admin console cache settings, or the corresponding LSCWP 'Debug Header' toggle for WordPress). Many production configs leave this off because LiteSpeed's own guidance treats it as a debugging aid, not a header every deployment ships with. So a site running LiteSpeed cannot be assumed to be emitting this header at all without checking that setting first.

*Evidence:* community-knowledge — LiteSpeed/LSCWP admin documentation and community support threads describing the cache-control debug header as an opt-in toggle rather than an always-on default

### `d_e3f85c727608_ms6` / `c1` — edge-case

Even when enabled, the header is only attached to requests that actually pass through the LSCache page-cache lookup path for cacheable dynamic content. Static assets served directly, requests excluded from caching (logged-in sessions, POST requests, admin/ajax endpoints, pages with no-cache cookies), and requests handled by a CDN or reverse proxy in front of LiteSpeed will often not carry the header, or will carry a value other than a clean 'hit'/'miss' (e.g. reason codes for why caching was bypassed). 'On each request' overstates the coverage — the long-tail crawler pages the plan cares about are exactly the kind of edge case (varying query strings, bot user-agents, vary-on-cookie rules) that can fall outside normal cache-lookup handling.

*Evidence:* reasoned-inference — Known LSCache exclusion rules (private/no-cache responses, non-GET requests, vary-based bypass) documented in LiteSpeed/LSCWP cache exclusion settings

### `d_e3f85c727608_ms6` / `c2` — configuration-dependency

Standard access log formats (Apache Common/Combined Log Format, and LiteSpeed's default access log, which follows the same convention) do not capture arbitrary response headers. Response header values like X-LiteSpeed-Cache only appear in the log if the LogFormat is explicitly customized with a header-capture token (analogous to Apache's %{Header}o). Unless that was already configured before the preloader was enabled, historical 'before' logs simply won't contain this field, so there's nothing to retroactively extract for the before side of a before/after comparison.

*Evidence:* widely-accepted-practice — Apache/LiteSpeed common/combined log format fields (client IP, timestamp, request line, status, bytes, referer, user-agent) — response headers require an explicit custom LogFormat directive to be captured

### `d_e3f85c727608_ms6` / `c2` — configuration-dependency

The X-LiteSpeed-Cache header itself is often a diagnostic/debug feature that is not emitted to all visitors by default in many LSCache deployments (server-level LSWS/OLS cache settings or the LSCWP WordPress plugin) — it's frequently gated behind a debug-header toggle or restricted to admin/logged-in requests specifically to avoid leaking cache internals publicly. If that setting was never turned on for this site, the header won't be present in responses at all, regardless of log configuration, so there's nothing for the log format fix in the first point to even capture.

*Evidence:* community-knowledge — LSCache/LSCWP cache-debug header options are commonly documented as opt-in rather than on-by-default in production configurations

### `d_e3f85c727608_ms6` / `c2` — alternative-explanation

If an edge cache or CDN (e.g., Cloudflare, commonly paired with LiteSpeed/LSCache setups such as Cloudflare APO) sits in front of the origin, requests served as hits at the edge never reach the origin server's access log at all. Only requests that reach the origin (edge misses or bypassed requests) get logged, so an origin-log-derived hit/miss rate reflects origin-level cache behavior only, not the end-user-experienced cache rate the crawler/long-tail-page discussion is actually trying to measure.

*Evidence:* reasoned-inference — General CDN/reverse-proxy caching architecture: edge-served hits bypass the origin entirely and produce no origin access-log entry

### `d_e3f85c727608_ms6` / `c3` — alternative-explanation · **FATAL**

Cache hit/miss ratio is a proxy for cache effectiveness, not a direct measure of performance (response time/TTFB). A preloader's crawl process itself consumes CPU, DB, and I/O on the origin server while it runs; LiteSpeed's own crawler feature exposes throttling controls (thread count, delay between requests, run interval) precisely because unthrottled crawling can degrade concurrent real-user response times. So it is possible for X-LiteSpeed-Cache miss rate to drop after enabling the preloader while actual page load times for real visitors stay flat or worsen during crawl windows — meaning a miss-rate comparison alone can indicate 'success' even when performance did not improve, or can obscure a regression.

*Evidence:* community-knowledge — LiteSpeed Cache (LSCWP) crawler feature is documented as configurable via run interval, threads, and delay/USleep specifically to bound the server load it generates — an acknowledgment that crawling has a real resource cost that is orthogonal to the hit-rate metric being proposed as the success indicator

### `d_e3f85c727608_ms6` / `c3` — alternative-explanation

A simple before/after comparison with no control period cannot isolate the preloader's causal contribution to the miss rate. Concurrent confounds — changes in bot vs. human traffic mix, cache TTL expirations/purges (from content edits, plugin/core updates), new content being added, or other configuration changes made around the same time — can shift the observed miss rate independently of the preloader. This is the classic 'history/maturation' threat to pre-post study designs: two snapshots in time, without a concurrent control group or holdout set of pages, can't attribute an observed delta solely to the intervention.

*Evidence:* widely-accepted-practice — Standard threat-to-validity concern in pre/post (non-controlled) experimental design methodology

### `d_e3f85c727608_ms6` / `c3` — configuration-dependency

Not every 'miss' recorded in the X-LiteSpeed-Cache header reflects an un-warmed page the preloader could have prevented — misses also occur for pages excluded from caching entirely (query-string variants, cookie-based/logged-in sessions, POST requests, admin/cart/checkout URLs in typical LiteSpeed exclusion rules). If the before/after comparison is taken in aggregate rather than scoped strictly to the cacheable long-tail URLs the crawler targets, these structurally-uncacheable misses dilute the signal and can mask or exaggerate the preloader's real effect.

*Evidence:* framework-documentation — LiteSpeed Cache exclusion behavior for private/dynamic/no-cache request types always reports as miss regardless of preload state

### `d_e3f85c727608_ms6` / `c5` — configuration-dependency

When the feature under test is itself a perceived-performance or UX/aesthetic change (e.g., skeleton screens, progress indicators, animation easing, perceived-latency tricks), the target metric is literally user perception, not an underlying objective quantity. In that narrow class, a rigorously collected subjective judgment (structured, blinded, statistically sampled user studies — e.g., the kind of perceived-performance research Nielsen Norman Group and Google's RAIL/UX teams publish) is the primary and legitimate validation signal, because there is no more 'objective' ground truth to compare against — perception is the thing being validated.

*Evidence:* widely-accepted-practice — Perceived-performance UX research methodology (structured user studies measuring subjective speed perception as the primary outcome variable for UI/UX changes, as opposed to server-side timing)

### `d_e3f85c727608_ms6` / `c6` — counterexample · **FATAL**

Patient-reported pain and other subjective clinical outcomes (e.g., the Visual Analog Scale / Numeric Rating Scale) are entirely first-person subjective reports, yet they are reliably evaluated via documented test-retest and inter-rater reliability coefficients, and are reproduced across independent randomized controlled trials and meta-analyses — this is the standard evidentiary basis for analgesic efficacy in medicine.

*Evidence:* widely-accepted-practice — Patient-reported outcome measures (PROMs) methodology in clinical trials, e.g. VAS/NRS pain scores with published reliability statistics, used and reproduced across independent RCTs and Cochrane meta-analyses

### `d_e3f85c727608_ms6` / `c6` — counterexample · **FATAL**

The System Usability Scale (SUS) is a purely subjective self-report instrument (10 Likert-scale items on perceived ease of use), yet it has well-documented high reliability (Cronbach's alpha ~0.91) and has been reproduced consistently across hundreds of independent studies and products.

*Evidence:* widely-accepted-practice — Brooke's System Usability Scale (1996) and subsequent psychometric validation studies reporting Cronbach's alpha ≈0.91 and cross-study reproducibility

### `d_e3f85c727608_ms6` / `c6` — counterexample

Trained sensory evaluation panels (e.g., wine, food, fragrance judging) produce subjective quality/flavor ratings that show high inter-panelist reliability and are reproducible across independent panels and laboratories under standardized protocols.

*Evidence:* widely-accepted-practice — ISO 8586 sensory analysis standard for selection and training of assessors, and inter-laboratory reproducibility studies in sensory science

### `d_e3f85c727608_ms6` / `c7` — counterexample · **FATAL**

The premise supporting the claim is a single reviewer's personal suggestion in one reply ('it's worth nailing down...', 'that's the kind of data... will want to see') — this is one person's opinion about what would strengthen the submission, not documented evidence of a norm held by 'repository reviewers' as a class. Generalizing from n=1 to a general expectation of 'repository reviewers' is an unsupported inductive leap; the reply never claims to speak for reviewers generally, and no repository policy, CONTRIBUTING.md, or review checklist is cited.

*Evidence:* reasoned-inference — The quoted reply text itself contains no reference to a formal policy, other reviewers' opinions, or a repo's contribution guidelines — it is framed as the speaker's own recommendation ('it's worth nailing down how you're confirming...').

### `d_e3f85c727608_ms6` / `c7` — contradictory-documentation · **FATAL**

For the most common real-world venue for a caching/preloader plugin like this (the WordPress.org Plugin Directory), the actual published review criteria (the Detailed Plugin Guidelines) focus on security (output escaping/input sanitization), licensing (GPL compatibility), no 'phoning home' without disclosure, no obfuscated code, and no trialware/upsell nagging — they do not list quantitative performance benchmarks, cache hit-rate data, or before/after comparisons as a merge/acceptance requirement.

*Evidence:* primary-documentation — developer.wordpress.org 'Detailed Plugin Guidelines' — the canonical, documented review checklist used by the actual reviewer team for plugin submissions in this ecosystem.

### `d_e3f85c727608_ms6` / `c7` — edge-case

Widespread real-world practice contradicts a universal expectation: large numbers of caching/performance plugins (on GitHub and in the WordPress plugin ecosystem, including many LiteSpeed/W3TC/WP-Rocket-adjacent community tools) are merged and published on the strength of code review, functional testing, and maintainer judgment alone, with no quantitative hit-rate benchmark included in the PR or README. 'Seems faster' or qualitative confirmation is the norm for small/solo-maintained repos, not the exception.

*Evidence:* widely-accepted-practice — Common observed practice across small-to-mid-size open-source plugin repositories, where merge decisions are made by a single maintainer based on code quality/functionality rather than a formal benchmarking gate.
