# Operator Review Package — `d_fee0044a496c_ms62ds6b`

**Thread:** Any plugin that can convert existing images to webp?
**Verdict:** ⛔ **REJECT**
**Certified:** 2026-07-29 12:43 · model claude-haiku-4-5-20251001

> Read this in order. The draft is at the bottom on purpose — reading prose first primes you to
> assess whether it *sounds* right instead of whether it *is* right, which is exactly how
> HRC-001 reached the publication queue.

## 1. Thread status

🟢 open — no resolution signal found

_No resolution signals._

## 2. Verdict reasons

- **fatal-contradiction** `c7` — counterexample: Regeneration does not require replacement/deletion of originals. Several 'replace' plugins (e.g. WebP Express in 'directory structure' mode) write generated .webp files as siblings alongside the untouched original in the uploads tree, rather than overwriting or deleting the source file. A downstream process that reads the uploads folder directly and knows to look for a same-named .webp variant will find it without any file being replaced — only additive regeneration occurred, not replacement. [community-knowledge]
- **fatal-contradiction** `c7` — alternative-explanation: Whether replacement is needed depends entirely on how the 'downstream' consumer accesses the file, which the claim doesn't specify. If the downstream system fetches the image over HTTP/HTTPS (a CDN pulling from origin, an image-optimization edge service, a mobile app hitting the media URL) rather than reading the filesystem, it passes through the same webserver rewrite/PHP-fallback layer as a browser and gets the negotiated response — no replacement needed. Only genuine out-of-band filesystem access (e.g., a backup job, an image pipeline scanning disk, rsync/S3 sync) bypasses the rewrite layer and would actually need a real file present. [reasoned-inference]
- **overconfident-language** `c1` — asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence — "Some (WebP Express is the common example) keep your original jpg/png files in place and se"
- **overconfident-language** `c3` — asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence — "based on what the visitor's browser supports"
- **overconfident-language** `c4` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "Your media library still shows the originals"
- **overconfident-language** `c5` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "nothing gets deleted or replaced"
- **overconfident-language** `c6` — asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence — "Others genuinely regenerate/replace the files"
- **overconfident-language** `c9` — asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence — "faster page loads with modern formats"
- **falsifiable-claim-weak-evidence** `c1` — "Some WordPress plugins, exemplified by WebP Express, keep original image files in place and serve converted webp versions conditionally at request time" asserts implementation-detail on operator-experience — someone who knows the subject must confirm it, or it needs primary evidence
- **falsifiable-claim-weak-evidence** `c2` — "Conditional webp serving uses rewrite rules or PHP fallback mechanisms to determine which format to serve" asserts implementation-detail on reasoned-inference — someone who knows the subject must confirm it, or it needs primary evidence
- **falsifiable-claim-weak-evidence** `c3` — "Conditional webp serving makes format decisions based on the visitor's browser support" asserts platform-behaviour on widely-accepted-practice — someone who knows the subject must confirm it, or it needs primary evidence
- **falsifiable-claim-weak-evidence** `c4` — "When conditional serving is used, the WordPress media library continues to display the original image files" asserts implementation-detail on reasoned-inference — someone who knows the subject must confirm it, or it needs primary evidence
- **falsifiable-claim-weak-evidence** `c5` — "Conditional serving does not delete or replace source image files" asserts implementation-detail on reasoned-inference — someone who knows the subject must confirm it, or it needs primary evidence
- **falsifiable-claim-weak-evidence** `c6` — "Some WordPress plugins actually regenerate and replace the original image files with webp versions" asserts implementation-detail on community-knowledge — someone who knows the subject must confirm it, or it needs primary evidence
- **falsifiable-claim-weak-evidence** `c9` — "WebP and other modern image formats provide faster page load times" asserts platform-behaviour on widely-accepted-practice — someone who knows the subject must confirm it, or it needs primary evidence
- **overconfident-language** `c7` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "which is what you'd need if something downstream reads the uploads folder directly"
- **overconfident-language** `c8` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "or if your goal is to eventually delete the source images"
- **overconfident-language** `c12` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "If you just want faster page loads with modern formats and don't care whether the original"
- **overconfident-language** `c13` — asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence — "check their docs for a bulk convert-and-replace feature"
- **overconfident-language** `c14` — asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence — "on existing (not just newly uploaded) media"

## 3. Claims — 15

| id | claim | type | evidence | conf | rests on | contra |
|---|---|---|---|---|---|---|
| `c1` | Some WordPress plugins, exemplified by WebP Express, keep original image files in place and serve converted webp versions conditionally at request time | implementation-detail | operator-experience (non-authoritative) | high | — | — |
| `c2` | Conditional webp serving uses rewrite rules or PHP fallback mechanisms to determine which format to serve | implementation-detail | reasoned-inference (non-authoritative) | medium | c1 | 2 |
| `c3` | Conditional webp serving makes format decisions based on the visitor's browser support | platform-behaviour | widely-accepted-practice (non-authoritative) | high | — | 2 |
| `c4` | When conditional serving is used, the WordPress media library continues to display the original image files | implementation-detail | reasoned-inference (non-authoritative) | high | c1 | 1 |
| `c5` | Conditional serving does not delete or replace source image files | implementation-detail | reasoned-inference (non-authoritative) | high | c1 | 1 |
| `c6` | Some WordPress plugins actually regenerate and replace the original image files with webp versions | implementation-detail | community-knowledge (non-authoritative) | high | — | 2 |
| `c7` | File replacement is required if downstream applications or services read files directly from the uploads folder | inference | reasoned-inference (non-authoritative) | high | — | **fatal** |
| `c8` | File replacement is required if the goal is to eventually delete the original JPEG/PNG source files | inference | reasoned-inference (non-authoritative) | high | — | 2 |
| `c9` | WebP and other modern image formats provide faster page load times | platform-behaviour | widely-accepted-practice (non-authoritative) | high | — | 4 |
| `c10` | Conditional serving is simpler than file replacement | opinion | reasoned-inference (non-authoritative) | medium | c1, c6 | — |
| `c11` | Conditional serving carries lower risk than file replacement | opinion | reasoned-inference (non-authoritative) | medium | c1, c6 | — |
| `c12` | Conditional serving should be chosen if the priority is faster page loads and original files do not need to be deleted | recommendation | reasoned-inference (non-authoritative) | high | c1, c9, c10, c11 | — |
| `c13` | When choosing a plugin that replaces files, its documentation should be checked for bulk convert-and-replace functionality | recommendation | operator-experience (non-authoritative) | high | — | — |
| `c14` | Bulk conversion features should be verified to work on existing media files, not only on newly uploaded media | recommendation | operator-experience (non-authoritative) | high | c13 | — |
| `c15` | Several free-tier plugins mentioned in this thread only process newly uploaded images, not existing media | observation | community-knowledge (non-authoritative) | medium | — | — |

☠ = invalidated because something it rests on failed.

## 4. What this reply actually concludes

- `c2` Conditional webp serving uses rewrite rules or PHP fallback mechanisms to determine which format to serve — evidence: **reasoned-inference**, confidence **medium**
- `c3` Conditional webp serving makes format decisions based on the visitor's browser support — evidence: **widely-accepted-practice**, confidence **high**
- `c4` When conditional serving is used, the WordPress media library continues to display the original image files — evidence: **reasoned-inference**, confidence **high**
- `c5` Conditional serving does not delete or replace source image files — evidence: **reasoned-inference**, confidence **high**
- `c7` File replacement is required if downstream applications or services read files directly from the uploads folder — evidence: **reasoned-inference**, confidence **high**
- `c8` File replacement is required if the goal is to eventually delete the original JPEG/PNG source files — evidence: **reasoned-inference**, confidence **high**
- `c12` Conditional serving should be chosen if the priority is faster page loads and original files do not need to be deleted — evidence: **reasoned-inference**, confidence **high**
- `c14` Bulk conversion features should be verified to work on existing media files, not only on newly uploaded media — evidence: **operator-experience**, confidence **high**
- `c15` Several free-tier plugins mentioned in this thread only process newly uploaded images, not existing media — evidence: **community-knowledge**, confidence **medium**

> ⚠️ At least one conclusion asserts how software behaves without authoritative evidence.
> That is the HRC-001 shape: reasoning about behaviour is not evidence of behaviour.

## 5. Known uncertainties

_Every claim states a provenance._


### Language outrunning evidence

- `c1` asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence
  - > Some (WebP Express is the common example) keep your original jpg/png files in place and serve a webp version conditionally at request time
- `c3` asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence
  - > based on what the visitor's browser supports
- `c4` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > Your media library still shows the originals
- `c5` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > nothing gets deleted or replaced
- `c6` asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence
  - > Others genuinely regenerate/replace the files
- `c7` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > which is what you'd need if something downstream reads the uploads folder directly
- `c8` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > or if your goal is to eventually delete the source images
- `c9` asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence
  - > faster page loads with modern formats
- `c12` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > If you just want faster page loads with modern formats and don't care whether the original files stay on disk, conditional serving is simpler and lower risk
- `c13` asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence
  - > check their docs for a bulk convert-and-replace feature
- `c14` asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence
  - > on existing (not just newly uploaded) media

## 6. Contradictions — 17 (2 fatal)

### `c2` — known-exception

WebP Express itself doesn't only offer rewrite-rule or PHP-fallback serving — it also has an 'Alter HTML' operation mode that rewrites <img> tags into <picture> elements with a webp <source>, letting the browser natively pick the format via content negotiation rather than any server-side rewrite/PHP decision at request time. This is a documented, selectable mode in the plugin, not a rewrite rule or a PHP fallback mechanism.

*Evidence:* official-implementation — WebP Express plugin documentation/settings (by Bjørn Rosell) describes multiple 'operation modes' including a picture-tag/Alter-HTML mode alongside the .htaccess rewrite mode and PHP fallback mode

### `c2` — configuration-dependency

The 'rewrite rule' half of the mechanism is Apache/mod_rewrite (or nginx try_files) specific and requires server-level config; on hosts without .htaccess support (e.g. some IIS or locked-down nginx setups) the plugin cannot use a rewrite rule at all and must fall back entirely to the PHP method, meaning it's not accurate to describe both as freely interchangeable options for every visitor/server combination as the claim implies.

*Evidence:* reasoned-inference — General web-server architecture: mod_rewrite is Apache-specific, IIS/nginx require separate rewrite syntax or plugin-level PHP fallback

### `c3` — configuration-dependency

Rewrite-rule-based conditional serving (mod_rewrite checking HTTP_ACCEPT, or an equivalent Nginx map) decides the format once per cached response, not per visitor. If the page or image is served through any caching layer — browser cache, a CDN, a reverse proxy, or a WordPress page-cache plugin — without the response correctly declaring `Vary: Accept`, a webp response served to one visitor's webp-capable browser can be cached and then handed to a later visitor whose browser cannot decode webp (or vice versa). At that point the format a given visitor receives reflects the cache state, not that visitor's own browser support.

*Evidence:* framework-documentation — MDN's documentation on HTTP content negotiation and the Vary header describes exactly this failure mode for server-driven negotiation behind caches; it's a well-known operational gotcha for Apache/Nginx image-negotiation snippets and is a common complaint in WordPress performance-plugin support threads where page-cache plugins (WP Super Cache, W3TC, etc.) interact with webp-rewrite plugins.

### `c3` — edge-case

The 'based on browser support' check is really a proxy — it inspects the `Accept` header (or, in PHP-fallback modes, a User-Agent string match) on the current HTTP request, not the browser's actual codec capability. These two can diverge: some browsers/contexts don't send `Accept: image/webp` for every resource type (notably CSS `background-image` requests in some browser versions), and intermediary proxies, privacy extensions, or corporate security gateways can strip or rewrite Accept/User-Agent headers. In those cases the plugin falls back to the original format even though the visitor's browser does support webp, or (with UA-string heuristics) can misjudge a forked/embedded browser (in-app WebViews, etc.) that doesn't match the known-good UA list.

*Evidence:* community-knowledge — This is a documented limitation discussed in WebP-conditional-serving plugin support forums (e.g. WebP Express's own FAQ notes it must fall back to User-Agent detection for certain non-<img> requests because no Accept header is available), and is consistent with general content-negotiation caveats.

### `c4` — configuration-dependency

The claim only holds for context-aware (PHP/WordPress-hook-based) conditional serving. For the rewrite-rule variant explicitly named in the context (WebP Express's .htaccess/mod_rewrite method), the interception happens purely at the web-server layer based on the request URL and the Accept header — it has no notion of 'this request came from wp-admin's media library grid vs. the public front end.' The wp-admin Media Library list/grid renders thumbnails with plain <img src="…/wp-content/uploads/…jpg"> tags, which is the identical URL space the rewrite rule intercepts. Since virtually all modern browsers (Chrome, Firefox, Edge) send an Accept header advertising image/webp support on every image request — including ones made while an administrator is browsing wp-admin — the same admin, viewing the Media Library in such a browser, would actually be served the generated WebP bytes at that URL, not the original file's bytes, unless the plugin has added an explicit is_admin()/referer-based exclusion for wp-admin contexts. That exclusion is a configuration/plugin-specific feature, not an inherent property of 'conditional serving' as a category.

*Evidence:* reasoned-inference — Mechanics of htaccess/mod_rewrite-based conditional WebP serving (e.g. WebP Express's rewrite-rule mode): the decision is made by the web server on Accept header + file extension alone, with no built-in WordPress admin-context awareness unless the plugin specifically adds it.

### `c5` — configuration-dependency

Several plugins that offer conditional WebP serving (EWWW Image Optimizer, ShortPixel, Imagify) bundle it with a separate lossy/lossless optimization pass that overwrites the original JPG/PNG file in place (with an optional backup-before-overwrite setting, often opt-in rather than default). In that common real-world configuration, the source file's bytes ARE replaced, even though the WebP delivery itself is purely conditional/rewrite-based. This doesn't apply to WebP Express (the example actually named), which only writes separate .webp copies and never touches the original — but it does undercut the claim as a generalization applied to 'conditional serving' plugins as a category.

*Evidence:* widely-accepted-practice — Documented behavior of EWWW Image Optimizer and ShortPixel Image Optimizer: both optimize/re-encode the original uploaded file in place as their core feature, with a 'backup originals before optimizing' toggle implying the live file in the uploads folder is otherwise overwritten; this optimization step is independent of, but commonly bundled alongside, their WebP conditional-serving delivery mode.

### `c6` — configuration-dependency

Genuine convert-and-replace only works if the server's PHP has WebP-capable GD or Imagick (or the plugin falls back to a cloud/API conversion). On hosts where the image library lacks WebP support, plugins like EWWW Image Optimizer, ShortPixel, and Imagify cannot produce real replacement .webp files at all — they either fail the operation or silently fall back to conditional/rewrite-based serving, regardless of which mode the user picked in settings.

*Evidence:* framework-documentation — EWWW Image Optimizer and ShortPixel documentation both note that local WebP conversion depends on server GD/Imagick WebP support and offer their own cloud API specifically to cover servers that lack it

### `c6` — edge-case

Plugins marketed as 'convert and replace' (e.g. EWWW's PNG↔JPG/WebP convert feature, WP-Optimize's image module) generally keep the original file as a recoverable backup rather than deleting it outright when the swap happens — the on-disk original is typically only purged by a separate, explicit 'delete originals' or 'remove backups' action. So 'replace' in these plugins' UI usually means the media library/attachment reference is swapped to the new webp file, not that the old bytes are immediately gone.

*Evidence:* framework-documentation — EWWW Image Optimizer's convert feature and WP-Optimize's image compression module both document retaining a restorable backup of the pre-conversion file after a 'replace' operation

### `c7` — counterexample · **FATAL**

Regeneration does not require replacement/deletion of originals. Several 'replace' plugins (e.g. WebP Express in 'directory structure' mode) write generated .webp files as siblings alongside the untouched original in the uploads tree, rather than overwriting or deleting the source file. A downstream process that reads the uploads folder directly and knows to look for a same-named .webp variant will find it without any file being replaced — only additive regeneration occurred, not replacement.

*Evidence:* community-knowledge — WebP Express's documented 'store in the same folder' conversion mode leaves original jpg/png files intact and adds an image.jpg.webp companion file

### `c7` — alternative-explanation · **FATAL**

Whether replacement is needed depends entirely on how the 'downstream' consumer accesses the file, which the claim doesn't specify. If the downstream system fetches the image over HTTP/HTTPS (a CDN pulling from origin, an image-optimization edge service, a mobile app hitting the media URL) rather than reading the filesystem, it passes through the same webserver rewrite/PHP-fallback layer as a browser and gets the negotiated response — no replacement needed. Only genuine out-of-band filesystem access (e.g., a backup job, an image pipeline scanning disk, rsync/S3 sync) bypasses the rewrite layer and would actually need a real file present.

*Evidence:* reasoned-inference — Standard behavior of Apache/Nginx rewrite-based or PHP-fallback conditional serving: any HTTP request to the media URL is intercepted server-side regardless of requester identity

### `c7` — counterexample

Some downstream 'services' that read origin images do their own format conversion at request time and never need a pre-existing webp file on disk at all — e.g., CDN/edge image optimizers (Cloudflare Polish, Cloudinary fetch-and-transform, imgix, Bunny Optimizer) fetch the original from the uploads folder over HTTP and transcode to WebP themselves. For these, the claim's premise is inverted: the existence of a downstream consumer reading the folder can make replacement *unnecessary*, not required.

*Evidence:* widely-accepted-practice — Documented behavior of on-the-fly image-optimization CDNs that transcode at the edge without requiring origin-side format conversion

### `c8` — configuration-dependency

Several conditional-serving plugins (e.g. WebP Express) implement the .htaccess rewrite by checking only whether a cached .webp file exists at the mapped path (RewriteCond ... -f on the webp cache file), not whether the original .jpg/.png still exists. Once the webp cache has been populated, WebP-capable browsers (now ~97%+ of traffic per caniuse) continue to be served correctly from that cache even if the original source file is deleted — only the small remaining non-WebP-capable segment would then get a broken image instead of the fallback original. So for a site willing to accept degraded/broken images for a small legacy-browser minority, originals can in fact be deleted while still using a 'conditional serving' plugin, without switching to a dedicated regenerate/replace plugin.

*Evidence:* community-knowledge — Documented .htaccess rewrite pattern used by WebP Express and similar Apache-rewrite-based WebP plugins, where the RewriteCond existence check targets the cached .webp file rather than the source image

### `c8` — alternative-explanation

The goal of 'deleting the source images' can also be achieved by relocating originals to a CDN/edge image service (e.g. Cloudflare Images, Cloudinary, Jetpack Photon) that fetches and caches the image once, then serves format-negotiated (WebP/AVIF) variants from its own edge cache going forward. In this architecture no local file 'replacement' occurs at all — the local jpg/png can be deleted immediately after the CDN's first fetch, with the CDN's own cached copy (not a locally generated replacement file) backing subsequent requests. This satisfies 'delete the local original' without any local regenerate/replace plugin.

*Evidence:* widely-accepted-practice — Common CDN image-optimization architecture (Cloudflare Polish/Images, Cloudinary fetch-and-cache, Jetpack Photon) where origin-fetch-once-then-serve-from-cache decouples local storage from image serving

### `c9` — configuration-dependency

The conditional-serving approach described (WebP Express and similar plugins using a PHP fallback / rewrite rule to convert on request) only delivers a speed benefit if the converted file is cached; in their default or misconfigured state, some of these plugins re-invoke PHP-based conversion on cache misses or on every request, which adds server-side processing time per page load and can make the page slower than simply serving the original JPEG/PNG statically.

*Evidence:* widely-accepted-practice — Documented behavior of on-the-fly image-conversion plugins (e.g. WebP Express's own docs warn to enable/verify caching); on-request conversion without a populated cache is a known performance pitfall distinct from pre-converted, statically served WebP.

### `c9` — counterexample

File-size reduction from WebP is not universal across image content: independent encoder comparisons (e.g. Cloudinary's and Kornel Lesiński's/squoosh.app benchmarks) show that JPEG re-encoded with mozjpeg at matched SSIM/quality can equal or beat WebP's file size for a meaningful share of photographic images, so switching format alone doesn't guarantee a smaller payload (and thus doesn't guarantee a faster load) unless encoder settings are also optimized.

*Evidence:* community-knowledge — Multiple public encoder-comparison studies (Cloudinary format comparisons, squoosh.app author's writeups) showing overlapping size distributions between optimized JPEG and WebP at equal perceptual quality.

### `c9` — known-exception

'Page load time' includes client-side decode/render cost, not just transfer size. WebP (and especially AVIF) decoding is more CPU-intensive than baseline JPEG decoding; on low-end or battery-throttled mobile devices with many images on a page, the extra decode time can offset or exceed the time saved from a smaller download, so total time-to-render is not guaranteed to improve.

*Evidence:* observed-runtime-behaviour — Reported CPU-decode overhead of WebP/AVIF relative to JPEG on constrained hardware, discussed in browser-vendor and image-format performance writeups (e.g. Google/Mozilla format-performance analyses).

### `c9` — edge-case

Clients that don't render WebP at all (older Android WebViews, some crawlers/scrapers, certain PDF/print or downstream image-processing pipelines, some email clients) will either fail to display the image or require the fallback path described in the reply — in those cases the 'modern format' delivers no load-time benefit at all, since the original is what actually gets served or the request errors.

*Evidence:* widely-accepted-practice — General WebP compatibility gaps outside modern mainstream browsers, which is precisely why conditional-serving/fallback plugins like WebP Express exist.


## 6b. Reference material — 0 of 15 claim(s) ruled on

**No corpus had standing over any claim in this draft.** Nothing here was checked against human-authored reference material — every claim above rests on the model's own memory and on the refutation pass alone. Read this as an absence of evidence, not as evidence of correctness.

_Corpora: sgen-kb (unavailable) · wordpress-primary (8 cards, 2026-07-27)._

---

## 7. The draft, last

> Before picking one of the plugins above, it's worth being clear on what you actually need, because they don't all do the same thing:
> 
> - Some (WebP Express is the common example) keep your original jpg/png files in place and serve a webp version conditionally at request time, using a rewrite rule or a PHP fallback, based on what the visitor's browser supports. Your media library still shows the originals; nothing gets deleted or replaced.
> - Others genuinely regenerate/replace the files, which is what you'd need if something downstream reads the uploads folder directly, or if your goal is to eventually delete the source images (like the person in this thread asking about deleting jpegs after conversion).
> 
> If you just want faster page loads with modern formats and don't care whether the original files stay on disk, conditional serving is simpler and lower risk. If you specifically need real .webp files replacing the originals in the library, say that when you're comparing plugins and check their docs for a bulk convert-and-replace feature on existing (not just newly uploaded) media, since several of the free tiers mentioned here only handle new uploads.

---

### What is still yours to decide

Argus checks that claims are *supported*. It cannot check that they are *true*, and it has no
opinion on whether this reply is worth posting. Those remain human judgements:

- Is the evidence cited actually what it claims to be?
- Does this answer what was asked?
- Would you put your name on it?
