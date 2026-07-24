# Operator Review Package — `d_c14d9d8caa0e_mrw1nf9l`

**Thread:** Help: Wordpress JSON Error on Sidebar Widget
**Verdict:** ⛔ **REJECT**
**Certified:** 2026-07-23 11:59 · model claude-haiku-4-5-20251001

> Read this in order. The draft is at the bottom on purpose — reading prose first primes you to
> assess whether it *sounds* right instead of whether it *is* right, which is exactly how
> HRC-001 reached the publication queue.

## 1. Thread status

🟢 open — no resolution signal found

_No resolution signals._

## 2. Verdict reasons

- **fatal-contradiction** `c1` — version-difference: Since WordPress 5.8 (2021), the default Widgets screen (wp-admin/widgets.php) is the block-based widgets editor. It saves via the REST API (POST/PUT to wp-json/wp/v2/widgets/<id> or wp/v2/sidebars/<id>, dispatched through @wordpress/api-fetch), not admin-ajax.php. On a current default install, the Network tab shows a REST request, never an admin-ajax.php hit, when a widget is saved. [official-implementation]
- **fatal-contradiction** `c2` — counterexample: WordPress core's own widget-save handler contradicts this. wp_ajax_save_widget() in wp-admin/includes/ajax-actions.php (bound to action=save-widget, the classic Widgets screen 'Save' button) does not call wp_send_json_success/wp_send_json_error — it calls the widget's control callback directly and wp_die()s, echoing the re-rendered widget-control HTML form as the body. wp-admin/js/widgets.js consumes this with jQuery's $.post(..., 'html') — an explicit HTML dataType, not JSON. So the single most common 'widget save' AJAX call in WordPress core returns an HTML fragment on success, not JSON. [source-code]
- **fatal-contradiction** `c3` — known-exception: PHP explicitly categorizes notices, warnings, and deprecation messages (E_NOTICE, E_WARNING, E_DEPRECATED) as non-fatal — they do not halt script execution. A very common WordPress case: PHP 8.x 'Deprecated: Creation of dynamic property' or 'Warning: Undefined array key' text is printed by a plugin/theme, execution continues, and the script still appends a working {"success":true,...} JSON payload afterward. The save itself succeeds; only client-side JSON.parse chokes on the leading text. Seeing notice text is proof of a non-fatal condition, not evidence of one. [language-specification]
- **fatal-contradiction** `c3` — alternative-explanation: HTML in the admin-ajax.php response commonly comes from something other than a PHP error: an expired nonce/auth cookie causing WP to emit the wp-login.php HTML form, a firewall/security plugin (Wordfence, Sucuri, iThemes) returning an HTML block or challenge page, a CDN/WAF (e.g. Cloudflare) interception page, or a maintenance-mode screen. None of these is a 'fatal server error' — the PHP process on the app server may not even have run the AJAX callback. [community-knowledge]
- **fatal-contradiction** `c3` — edge-case: The same reply that makes this claim separately instructs checking whether a caching/object-cache plugin 'mangles' the AJAX output — i.e., it already concedes non-JSON output can occur with zero PHP error of any kind, fatal or otherwise. That directly undercuts treating HTML-instead-of-JSON as diagnostic of a fatal error. [reasoned-inference]
- **fatal-contradiction** `c4` — counterexample: Object-cache plugins (Redis Object Cache, Memcached, W3TC's Object Cache module) implement WP's wp_cache_* API and store serialized PHP objects/query results in an external key-value store. They never buffer or rewrite the raw HTTP response body, so architecturally they cannot alter an admin-ajax.php response the way a page-cache/output-buffering plugin could. Telling someone to 'pause the object-cache plugin' to fix mangled AJAX output targets the wrong layer. [source-code]
- **fatal-contradiction** `c5` — counterexample: Dedicated object-cache plugins (Redis Object Cache, Memcached Object Cache, W3TC's Object Cache module) only intercept wp_cache_get()/wp_cache_set()/wp_cache_add() calls to store internal PHP data (transients, term/meta/option lookups) in Redis/Memcached. They never hook into output buffering (ob_start) or the HTTP response stream, so there is no code path by which they could inject HTML/notices into an admin-ajax.php JSON response. The plugins that DO use output buffering to capture/rewrite the full response — and that can mangle admin-ajax.php output — are page/full-page-cache plugins (WP Super Cache, WP Rocket's page cache, W3TC's Page Cache module) and minifiers (Autoptimize, WP Rocket minify). Naming 'object-cache plugins' as the corrupting agent misidentifies the mechanism. [official-implementation]
- **overconfident-language** `c4` — asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence — "caching or object-cache plugins sometimes mangle AJAX output"
- **overconfident-language** `c5` — asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence — "caching or object-cache plugins sometimes mangle AJAX output"
- **invalidated-dependency** `c6` — rests on c4, which failed — invalid reasoning is not partially salvageable
- **invalidated-dependency** `c7` — rests on c4, which failed — invalid reasoning is not partially salvageable
- **falsifiable-claim-weak-evidence** `c4` — "Caching plugins can corrupt AJAX output" asserts platform-behaviour on operator-experience — someone who knows the subject must confirm it, or it needs primary evidence
- **falsifiable-claim-weak-evidence** `c5` — "Object-cache plugins can corrupt AJAX output" asserts platform-behaviour on operator-experience — someone who knows the subject must confirm it, or it needs primary evidence
- **overconfident-language** `c3` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "If HTML/PHP notice instead of JSON — that's your fatal error"
- **overconfident-language** `c6` — asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence — "check that response with caching plugin paused"
- **overconfident-language** `c7` — asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence — "exclude admin-ajax"

## 3. Claims — 7

| id | claim | type | evidence | conf | rests on | contra |
|---|---|---|---|---|---|---|
| `c1` | Saving a WordPress widget triggers an AJAX request to admin-ajax.php | implementation-detail | framework-documentation (authoritative) | high | — | **fatal** |
| `c2` | A successful widget save response from admin-ajax.php is JSON | protocol-behaviour | framework-documentation (authoritative) | high | — | **fatal** |
| `c3` | HTML or PHP error notices in the admin-ajax.php response indicate a fatal server error | inference | reasoned-inference (non-authoritative) | high | c2 | **fatal** |
| `c4` | Caching plugins can corrupt AJAX output | platform-behaviour | operator-experience (non-authoritative) | high | — | **fatal** |
| `c5` | Object-cache plugins can corrupt AJAX output | platform-behaviour | operator-experience (non-authoritative) | high | — | **fatal** |
| `c6` ☠ | Disabling caching plugins helps diagnose whether they cause widget AJAX errors | recommendation | operator-experience (non-authoritative) | high | c4 | — |
| `c7` ☠ | Configuring caching plugins to exclude admin-ajax.php prevents cache interference with widget AJAX | recommendation | operator-experience (non-authoritative) | high | c4 | — |

☠ = invalidated because something it rests on failed.

## 4. What this reply actually concludes

- `c1` Saving a WordPress widget triggers an AJAX request to admin-ajax.php — evidence: **framework-documentation**, confidence **high**
- `c3` HTML or PHP error notices in the admin-ajax.php response indicate a fatal server error — evidence: **reasoned-inference**, confidence **high**
- `c5` Object-cache plugins can corrupt AJAX output — evidence: **operator-experience**, confidence **high**
- `c6` Disabling caching plugins helps diagnose whether they cause widget AJAX errors — evidence: **operator-experience**, confidence **high**
- `c7` Configuring caching plugins to exclude admin-ajax.php prevents cache interference with widget AJAX — evidence: **operator-experience**, confidence **high**

> ⚠️ At least one conclusion asserts how software behaves without authoritative evidence.
> That is the HRC-001 shape: reasoning about behaviour is not evidence of behaviour.

## 5. Known uncertainties

_Every claim states a provenance._


### Language outrunning evidence

- `c3` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > If HTML/PHP notice instead of JSON — that's your fatal error
- `c4` asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence
  - > caching or object-cache plugins sometimes mangle AJAX output
- `c5` asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence
  - > caching or object-cache plugins sometimes mangle AJAX output
- `c6` asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence
  - > check that response with caching plugin paused
- `c7` asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence
  - > exclude admin-ajax

## 6. Contradictions — 15 (7 fatal)

### `c1` — version-difference · **FATAL**

Since WordPress 5.8 (2021), the default Widgets screen (wp-admin/widgets.php) is the block-based widgets editor. It saves via the REST API (POST/PUT to wp-json/wp/v2/widgets/<id> or wp/v2/sidebars/<id>, dispatched through @wordpress/api-fetch), not admin-ajax.php. On a current default install, the Network tab shows a REST request, never an admin-ajax.php hit, when a widget is saved.

*Evidence:* official-implementation — WordPress core devnote 'WordPress 5.8: Widgets and the Block Editor' (make.wordpress.org/core) + wp-admin/widgets.php enqueuing the wp-edit-widgets script module, which persists via REST endpoints rather than admin-ajax actions

### `c1` — configuration-dependency

The official 'Classic Widgets' plugin (WordPress.org, millions of active installs, common on Elementor/Divi/Avada and legacy-theme sites) reverts widgets.php to the pre-5.8 screen, restoring the admin-ajax.php action=save-widget flow. So whether admin-ajax.php is hit at all depends on plugin state, not just on the act of saving.

*Evidence:* official-implementation — Classic Widgets plugin (wordpress.org/plugins/classic-widgets) — disables wp_use_widgets_block_editor, restoring legacy admin-ajax.php save path

### `c1` — edge-case

A widget can be saved with zero browser/AJAX involvement — e.g. `wp widget update`/`wp widget add` via WP-CLI, or a direct write to the sidebars_widgets option and widget instance option via PHP/DB. No HTTP request of any kind occurs, let alone one to admin-ajax.php.

*Evidence:* official-implementation — WP-CLI `wp widget` command family operates directly on wp_options via WP_Widget APIs, bypassing HTTP entirely

### `c2` — counterexample · **FATAL**

WordPress core's own widget-save handler contradicts this. wp_ajax_save_widget() in wp-admin/includes/ajax-actions.php (bound to action=save-widget, the classic Widgets screen 'Save' button) does not call wp_send_json_success/wp_send_json_error — it calls the widget's control callback directly and wp_die()s, echoing the re-rendered widget-control HTML form as the body. wp-admin/js/widgets.js consumes this with jQuery's $.post(..., 'html') — an explicit HTML dataType, not JSON. So the single most common 'widget save' AJAX call in WordPress core returns an HTML fragment on success, not JSON.

*Evidence:* source-code — wp-admin/includes/ajax-actions.php wp_ajax_save_widget() and wp-admin/js/widgets.js save-widget handler (WordPress core, classic Widgets admin screen)

### `c2` — version-difference

In the block-based Widgets editor (WP 5.8+, site-editor.php/widgets.php with Gutenberg blocks) and the Customizer widgets panel, saving a widget does not go through admin-ajax.php at all — it's persisted via REST API requests (e.g. wp-json/wp/v2/sidebars or /widget-types), so the premise that the relevant network request is 'usually admin-ajax.php' doesn't hold in that mode even though the REST response itself is JSON.

*Evidence:* official-implementation — WordPress 5.8 block widgets editor architecture — widget persistence via wp/v2 REST endpoints instead of admin-ajax.php

### `c3` — known-exception · **FATAL**

PHP explicitly categorizes notices, warnings, and deprecation messages (E_NOTICE, E_WARNING, E_DEPRECATED) as non-fatal — they do not halt script execution. A very common WordPress case: PHP 8.x 'Deprecated: Creation of dynamic property' or 'Warning: Undefined array key' text is printed by a plugin/theme, execution continues, and the script still appends a working {"success":true,...} JSON payload afterward. The save itself succeeds; only client-side JSON.parse chokes on the leading text. Seeing notice text is proof of a non-fatal condition, not evidence of one.

*Evidence:* language-specification — PHP manual error-level reference: only E_ERROR/E_PARSE/E_CORE_ERROR/E_COMPILE_ERROR/E_USER_ERROR are fatal; E_NOTICE/E_WARNING/E_DEPRECATED/E_STRICT are non-halting by definition.

### `c3` — alternative-explanation · **FATAL**

HTML in the admin-ajax.php response commonly comes from something other than a PHP error: an expired nonce/auth cookie causing WP to emit the wp-login.php HTML form, a firewall/security plugin (Wordfence, Sucuri, iThemes) returning an HTML block or challenge page, a CDN/WAF (e.g. Cloudflare) interception page, or a maintenance-mode screen. None of these is a 'fatal server error' — the PHP process on the app server may not even have run the AJAX callback.

*Evidence:* community-knowledge — Standard WP troubleshooting knowledge for 'admin-ajax.php returns HTML instead of JSON' — session/nonce expiry and security-plugin interception are the two most frequently cited non-error causes.

### `c3` — edge-case · **FATAL**

The same reply that makes this claim separately instructs checking whether a caching/object-cache plugin 'mangles' the AJAX output — i.e., it already concedes non-JSON output can occur with zero PHP error of any kind, fatal or otherwise. That directly undercuts treating HTML-instead-of-JSON as diagnostic of a fatal error.

*Evidence:* reasoned-inference — Self-contradiction within the source reply's own caching-plugin caveat.

### `c3` — configuration-dependency

Whether error text is visible in the response body at all is controlled by php.ini display_errors / WP's WP_DEBUG_DISPLAY, independent of severity. WordPress's own recommended production config is WP_DEBUG_DISPLAY=false with WP_DEBUG_LOG=true — under that (common, recommended) setup, a genuine fatal error produces a blank body or bare HTTP 500 with no visible 'PHP notice' text, while non-fatal notices can still leak through if a plugin locally re-enables display_errors. So visibility and fatality are decoupled by configuration, not correlated as the claim assumes.

*Evidence:* framework-documentation — WordPress Debugging in WordPress developer docs — WP_DEBUG_DISPLAY / WP_DEBUG_LOG guidance for production environments.

### `c4` — counterexample · **FATAL**

Object-cache plugins (Redis Object Cache, Memcached, W3TC's Object Cache module) implement WP's wp_cache_* API and store serialized PHP objects/query results in an external key-value store. They never buffer or rewrite the raw HTTP response body, so architecturally they cannot alter an admin-ajax.php response the way a page-cache/output-buffering plugin could. Telling someone to 'pause the object-cache plugin' to fix mangled AJAX output targets the wrong layer.

*Evidence:* source-code — WP_Object_Cache backend implementations (Redis/Memcached object-cache drop-ins) hook only wp_cache_get/set/delete — they sit at the DB-query layer, not in template_redirect/output buffering where page-cache plugins intercept response bytes.

### `c4` — configuration-dependency

Mainstream page-caching plugins (WP Super Cache, WP Rocket, LiteSpeed Cache) check WP core's DOING_AJAX constant (set in wp-admin/admin-ajax.php) and skip caching/serving cached output for those requests by default. So by default, reputable caching plugins don't touch admin-ajax.php output at all — only misconfigured caching, a non-compliant plugin, or an external layer (reverse proxy/CDN cache rule) would intercept it.

*Evidence:* official-implementation — WP Super Cache's advanced-cache.php and WP Rocket's cache engine both bail early on DOING_AJAX; documented default cache-exclusion behavior for admin-ajax.php.

### `c4` — alternative-explanation

HTML/PHP notice appearing instead of JSON in an admin-ajax.php response is the classic signature of a PHP notice/warning/deprecated message being echoed before wp_send_json() runs — surfaced when WP_DEBUG/display_errors is on, or a plugin/theme throws a warning inside the AJAX hook. This is a debug/error-display config issue, unrelated to any caching layer, and is the more common root cause reported for this exact symptom.

*Evidence:* community-knowledge — Widely documented WP troubleshooting pattern for 'unexpected token < in JSON' on admin-ajax responses — stray PHP error output breaking JSON parsing.

### `c5` — counterexample · **FATAL**

Dedicated object-cache plugins (Redis Object Cache, Memcached Object Cache, W3TC's Object Cache module) only intercept wp_cache_get()/wp_cache_set()/wp_cache_add() calls to store internal PHP data (transients, term/meta/option lookups) in Redis/Memcached. They never hook into output buffering (ob_start) or the HTTP response stream, so there is no code path by which they could inject HTML/notices into an admin-ajax.php JSON response. The plugins that DO use output buffering to capture/rewrite the full response — and that can mangle admin-ajax.php output — are page/full-page-cache plugins (WP Super Cache, WP Rocket's page cache, W3TC's Page Cache module) and minifiers (Autoptimize, WP Rocket minify). Naming 'object-cache plugins' as the corrupting agent misidentifies the mechanism.

*Evidence:* official-implementation — Redis Object Cache / Memcached Object Cache plugin source (drop-in object-cache.php implementing WP_Object_Cache) only overrides wp_cache_* API calls; WP core wp-includes/cache.php shows object cache is invoked solely for internal data lookups, never for output rendering

### `c5` — contradictory-documentation

The advice to 'exclude admin-ajax from caching plugin' describes a URL-based exclusion list — that is a Page Cache / Minify feature (e.g. WP Rocket 'Never Cache These URL(s)', W3TC 'Page Cache: Never cache the following pages'), not an Object Cache setting. Object cache has no per-URL exclusion concept since it's keyed by cache group/key, not by request URL. So even when it works, the described remedy is actually testing the page-cache/minify module, mislabeled as 'object-cache'.

*Evidence:* framework-documentation — W3 Total Cache and WP Rocket settings UIs separate 'Page Cache' (URL-based exclude rules) from 'Object Cache' (group/key based, no URL exclusions) as distinct modules/tabs

### `c5` — known-exception

Most page-cache plugins already check the DOING_AJAX constant and skip caching admin-ajax.php requests by default (WP Super Cache, WP Rocket, LiteSpeed Cache). So in a stock config, pausing the caching plugin to test admin-ajax output is often a no-op — if mangled output appears, it's more likely from a minifier, a CDN/edge cache (e.g., Cloudflare) that ignores DOING_AJAX, or PHP display_errors printing notices before wp_send_json(), not from the object-cache layer.

*Evidence:* widely-accepted-practice — Common WP caching-plugin behavior of excluding DOING_AJAX requests from page cache by default

---

## 7. The draft, last

> Network tab. Save widget, watch new AJAX request (usually `admin-ajax.php`), open its Response. If HTML/PHP notice instead of JSON — that's your fatal error, paste it here.
> 
> Also check that response with caching plugin paused/exclude admin-ajax — caching or object-cache plugins sometimes mangle AJAX output.

---

### What is still yours to decide

Argus checks that claims are *supported*. It cannot check that they are *true*, and it has no
opinion on whether this reply is worth posting. Those remain human judgements:

- Is the evidence cited actually what it claims to be?
- Does this answer what was asked?
- Would you put your name on it?
