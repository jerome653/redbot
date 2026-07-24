# Operator Review Package — `d_f0d72e0a6fce_mrw1mwnt`

**Thread:** Dying for a solution! Tried everything but contact form is not functioning. Using AWS ec2, have ran contact form 7 test emails which function but our custom built (by a wp dev we hired) contact form is not sending emails through.
**Verdict:** ⛔ **REJECT**
**Certified:** 2026-07-23 16:45 · model claude-haiku-4-5-20251001

> Read this in order. The draft is at the bottom on purpose — reading prose first primes you to
> assess whether it *sounds* right instead of whether it *is* right, which is exactly how
> HRC-001 reached the publication queue.

## 1. Thread status

🟢 open — no resolution signal found

_No resolution signals._

## 2. Verdict reasons

- **fatal-contradiction** `c2` — configuration-dependency: CF7 success proves SMTP/SES transport works only for CF7's specific From/Reply-To identity and recipient. AWS SES enforces verified-identity and sandbox-mode restrictions per sender/recipient address — if the custom form uses a different From address (unverified) or sends to a recipient not verified while account is still in SES sandbox, SES rejects (MessageRejected) at the delivery layer even though PHP execution and the trigger are fully correct. [primary-documentation]
- **fatal-contradiction** `c2` — configuration-dependency: SES maintains an account-level (or configuration-set) suppression list for addresses with prior bounces/complaints. If the custom form's test recipient is on that list, every send to it fails at SES regardless of trigger/PHP correctness — a pure mail-delivery-layer cause, not form-trigger or PHP. [primary-documentation]
- **fatal-contradiction** `c2` — counterexample: "Transport layer" is not a single shared resource across the whole site. Custom forms frequently bypass wp_mail()/the SMTP plugin entirely (native PHP mail(), a hardcoded SMTP block, or a separate library call). If that's the case here, CF7 succeeding through the SMTP-plugin path says nothing about whether the custom form's send even touches that same transport — so the premise 'transport layer works' hasn't actually been established for the code path in question. [widely-accepted-practice]
- **fatal-contradiction** `c5` — counterexample: The exact failure modes context names (bad nonce, wrong AJAX action) do not throw JS errors at all. `check_ajax_referer()` on nonce failure calls `wp_die(-1)` — a normal HTTP response (200/400/403) the JS receives via its success/error callback, not an uncaught exception. If the handler's `error:` callback is empty or the failure is caught in try/catch, console shows nothing. [source-code]
- **fatal-contradiction** `c6` — alternative-explanation: wp_mail() returning true only means the message was handed off to the underlying mail transport (PHP mail() or configured SMTP), not that it was delivered. A 200 AJAX response with wp_mail() succeeding is fully consistent with PHP NOT failing — the failure (spam filter, wrong 'From' domain not verified in SES, silent SMTP drop, catch-all mailbox) can occur entirely downstream of a successful send call. [framework-documentation]
- **fatal-contradiction** `c6` — known-exception: admin-ajax.php returns HTTP 200 with body '0' or '-1' whenever the requested action has no matching wp_ajax_/wp_ajax_nopriv_ hook (wrong action name) or nonce verification fails via check_ajax_referer() with die mode. In that case the custom handler — and any mail-sending code inside it — never executes at all. '200 = PHP executing' is false in this scenario; it's WordPress core's default die(0), not the custom code path. [source-code]
- **fatal-contradiction** `c7` — known-exception: WP REST-based AJAX endpoints return HTTP 404 (rest_no_route) when the site permalink structure is set to 'Plain', even though the endpoint's route is correctly registered and fully functional — it's reachable via the ?rest_route=/... query-var fallback. The 404 reflects a permalink/rewrite config, not a broken or unreachable handler. [primary-documentation]
- **fatal-contradiction** `c7` — alternative-explanation: admin-ajax.php requires wp-load.php, which bootstraps the ENTIRE WP environment (all active plugins, theme functions.php) before dispatching to the hooked wp_ajax_{action} callback. A fatal PHP error in any unrelated plugin/theme file crashes every admin-ajax.php request site-wide with a 500 — including calls to a target handler whose own code is completely correct and reachable. '500 → this endpoint is broken' misattributes the fault location. [source-code]
- **fatal-contradiction** `c13` — known-exception: SES's SendRawEmail API only requires the Source parameter (or, if Source is omitted, the address SES extracts from the raw message) to be a verified identity — it does not require the visible 'From:' header written into the raw MIME content to be verified when Source is explicitly supplied. A caller can set Source to a verified address while the raw message's From: header shows a completely different, unverified address, and SES will accept and send it rather than rejecting it. [primary-documentation]
- **fatal-contradiction** `c15` — counterexample: AWS SES does not silently drop mail from an unverified sending identity — it returns an explicit, synchronous rejection at send time. Via the API this is a MessageRejected exception with message text like 'Email address is not verified. The following identities failed the check...'; via SMTP it's a 554 'Message rejected: Email address is not verified' response at the RCPT TO/DATA stage. PHPMailer (which wp_mail() wraps) surfaces this as a thrown exception, so wp_mail() returns false and the wp_mail_failed hook — already proposed in step 4 of the same reply — fires with the real SES error string in it. That is the opposite of 'silent': the failure is loud and specific at the transport layer, it just isn't logged anywhere by default WordPress unless something is watching wp_mail_failed or debug.log. [primary-documentation]
- **overconfident-language** `c2` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "the bug has to be in how the custom form triggers (or fails to trigger) the send, not in m"
- **overconfident-language** `c6` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "A 200 with nothing happening points to a PHP-side issue"
- **overconfident-language** `c7` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "a 404/500 points to a broken endpoint"
- **overconfident-language** `c15` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "SES rejecting the send because the custom form's "From"/"Reply-To" address isn't a verifie"
- **unrefuted-falsifiable-claim** `c4` — "Common causes of silent AJAX form failures: bad nonce, wrong AJAX action name, validation error" asserts implementation-detail and was never successfully attacked — its provenance (framework-documentation) is self-declared and unchecked

## 3. Claims — 15

| id | claim | type | evidence | conf | rests on | contra |
|---|---|---|---|---|---|---|
| `c1` | CF7 test emails work, confirming SMTP and SES transport is functioning | observation | observed-runtime-behaviour (authoritative) | high | — | — |
| `c2` | If transport layer works, the bug is in form submission trigger or PHP execution, not mail delivery | inference | reasoned-inference (non-authoritative) | high | c1 | **fatal** |
| `c3` | AJAX-based forms can have JS handlers that fail silently before reaching backend PHP code | best-practice | community-knowledge (non-authoritative) | high | — | 1 |
| `c4` | Common causes of silent AJAX form failures: bad nonce, wrong AJAX action name, validation error | implementation-detail | framework-documentation (authoritative) | high | c3 | — |
| `c5` | Browser console (F12) will display JS errors when form is submitted | platform-behaviour | primary-documentation (authoritative) | high | — | **fatal** |
| `c6` | AJAX response 200 with no mail delivery indicates PHP backend is executing but failing to send | inference | reasoned-inference (non-authoritative) | high | c2 | **fatal** |
| `c7` | AJAX response 404 or 500 indicates the endpoint is broken or unreachable | inference | reasoned-inference (non-authoritative) | high | — | **fatal** |
| `c8` | Setting WP_DEBUG=true and WP_DEBUG_LOG=true in wp-config.php enables error logging to wp-content/debug.log | configuration-advice | framework-documentation (authoritative) | high | — | 4 |
| `c9` | PHP errors, warnings, and fatals appear in wp-content/debug.log after form submission when logging is enabled | platform-behaviour | framework-documentation (authoritative) | high | c8 | 3 |
| `c10` | wp_mail() can fail without returning error details or logging the failure | implementation-detail | framework-documentation (authoritative) | high | — | — |
| `c11` | The wp_mail_failed action hook is triggered when wp_mail() fails | unknown | official-implementation (authoritative) | high | c10 | — |
| `c12` | Using add_action('wp_mail_failed') will capture actual error details from wp_mail() failures | configuration-advice | official-implementation (authoritative) | high | c11 | 3 |
| `c13` | AWS SES rejects email sent from unverified sender addresses | platform-behaviour | official-implementation (authoritative) | high | — | **fatal** |
| `c14` | Custom contact forms often hardcode a 'From' or 'Reply-To' address different from CF7 | unknown | community-knowledge (non-authoritative) | medium | — | — |
| `c15` | When a custom form uses an unverified SES identity as sender, mail is rejected silently | inference | reasoned-inference (non-authoritative) | high | c13, c14, c10 | **fatal** |

☠ = invalidated because something it rests on failed.

## 4. What this reply actually concludes

- `c4` Common causes of silent AJAX form failures: bad nonce, wrong AJAX action name, validation error — evidence: **framework-documentation**, confidence **high**
- `c5` Browser console (F12) will display JS errors when form is submitted — evidence: **primary-documentation**, confidence **high**
- `c6` AJAX response 200 with no mail delivery indicates PHP backend is executing but failing to send — evidence: **reasoned-inference**, confidence **high**
- `c7` AJAX response 404 or 500 indicates the endpoint is broken or unreachable — evidence: **reasoned-inference**, confidence **high**
- `c9` PHP errors, warnings, and fatals appear in wp-content/debug.log after form submission when logging is enabled — evidence: **framework-documentation**, confidence **high**
- `c12` Using add_action('wp_mail_failed') will capture actual error details from wp_mail() failures — evidence: **official-implementation**, confidence **high**
- `c15` When a custom form uses an unverified SES identity as sender, mail is rejected silently — evidence: **reasoned-inference**, confidence **high**



## 5. Known uncertainties

_Every claim states a provenance._


### Language outrunning evidence

- `c2` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > the bug has to be in how the custom form triggers (or fails to trigger) the send, not in mail delivery itself
- `c6` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > A 200 with nothing happening points to a PHP-side issue
- `c7` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > a 404/500 points to a broken endpoint
- `c15` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > SES rejecting the send because the custom form's "From"/"Reply-To" address isn't a verified SES identity — a common mismatch when the custom form hardcodes a different address

## 6. Contradictions — 30 (10 fatal)

### `c2` — configuration-dependency · **FATAL**

CF7 success proves SMTP/SES transport works only for CF7's specific From/Reply-To identity and recipient. AWS SES enforces verified-identity and sandbox-mode restrictions per sender/recipient address — if the custom form uses a different From address (unverified) or sends to a recipient not verified while account is still in SES sandbox, SES rejects (MessageRejected) at the delivery layer even though PHP execution and the trigger are fully correct.

*Evidence:* primary-documentation — AWS SES sandbox docs: sandbox accounts can only send to verified identities or the SES mailbox simulator; sending to/from unverified addresses fails with MessageRejected regardless of SMTP auth success.

### `c2` — configuration-dependency · **FATAL**

SES maintains an account-level (or configuration-set) suppression list for addresses with prior bounces/complaints. If the custom form's test recipient is on that list, every send to it fails at SES regardless of trigger/PHP correctness — a pure mail-delivery-layer cause, not form-trigger or PHP.

*Evidence:* primary-documentation — AWS SES account-level suppression list behavior (documented in SES sending docs) — blocks delivery to specific addresses independent of application code.

### `c2` — counterexample · **FATAL**

"Transport layer" is not a single shared resource across the whole site. Custom forms frequently bypass wp_mail()/the SMTP plugin entirely (native PHP mail(), a hardcoded SMTP block, or a separate library call). If that's the case here, CF7 succeeding through the SMTP-plugin path says nothing about whether the custom form's send even touches that same transport — so the premise 'transport layer works' hasn't actually been established for the code path in question.

*Evidence:* widely-accepted-practice — Common WordPress pattern: custom/legacy forms often call PHP's native mail() or a separate mailer instead of wp_mail(), so SMTP-plugin config confirmed via CF7 doesn't apply to them.

### `c2` — alternative-explanation

Even when SES accepts and relays the message (250 OK), the receiving mail server can silently drop or spam-foliate it due to DKIM/SPF/DMARC misalignment specific to the From/Reply-To header the custom form sets (different from CF7's). Symptom looks identical ('nothing arrives') but the fault is in mail delivery/deliverability, not the trigger or PHP.

*Evidence:* community-knowledge — Well-documented deliverability behavior: sender authentication alignment is evaluated per From-domain, so two different senders on the same SES account can have divergent deliverability outcomes.

### `c2` — edge-case

SES enforces sending quotas/rate limits per account; if the custom form is invoked more frequently or in a burst (e.g., bot submissions) it can trip Daily Sending Quota or Maximum Send Rate, causing throttling/rejection that's unrelated to trigger or PHP correctness — but this only manifests under certain volume conditions, so it qualifies rather than universally refutes.

*Evidence:* primary-documentation — AWS SES sending limits (24-hour quota, max send rate) documented per-account/per-region.

### `c3` — known-exception

The reply's own examples of 'JS handler fails silently before PHP runs' (bad nonce, wrong AJAX action) are actually PHP-side failures, not JS-side. check_ajax_referer() runs inside the registered PHP callback and calls wp_die(-1, 403) on a bad nonce — PHP has already executed and returned a distinct 403 status. A wrong/unregistered action still hits admin-ajax.php (PHP), runs through do_action() with no matching hook, and falls through to wp_die(0), returning HTTP 200 with body "0". Both are visible, non-silent, PHP-originated outcomes — the reply even contradicts itself in point 2 by saying a 200-with-nothing-happening 'points to a PHP-side issue,' which is exactly what the bad-nonce/wrong-action cases in point 1 produce.

*Evidence:* framework-documentation — WordPress core: check_ajax_referer() in wp-includes/pluggable.php dies with wp_die(-1, 403) on nonce mismatch; wp-admin/admin-ajax.php dispatches do_action("wp_ajax_{$action}") then falls through to wp_die(0) when no callback is registered for that action — both PHP-side, not client JS.

### `c5` — counterexample · **FATAL**

The exact failure modes context names (bad nonce, wrong AJAX action) do not throw JS errors at all. `check_ajax_referer()` on nonce failure calls `wp_die(-1)` — a normal HTTP response (200/400/403) the JS receives via its success/error callback, not an uncaught exception. If the handler's `error:` callback is empty or the failure is caught in try/catch, console shows nothing.

*Evidence:* source-code — WordPress core `check_ajax_referer()` / `wp_die()` behavior on invalid nonce — returns response body, does not raise JS exception

### `c5` — configuration-dependency

If the form uses a native (non-AJAX) submit, the browser navigates/reloads the page. Chrome/Firefox DevTools clear the Console on navigation by default — any error logged in the split second before unload is gone unless 'Preserve log' is enabled.

*Evidence:* widely-accepted-practice — Chrome DevTools default behavior: Console panel clears on page navigation unless 'Preserve log' checkbox is checked

### `c5` — edge-case

Unhandled promise rejections in fetch()-based submit handlers only surface as 'Uncaught (in promise)' if truly unhandled; a `.catch()` that swallows the error (common defensive pattern) produces zero console output even though the handler failed.

*Evidence:* language-specification — ECMAScript Promise semantics — rejection is only reported to console/global handler if no rejection handler is attached

### `c6` — alternative-explanation · **FATAL**

wp_mail() returning true only means the message was handed off to the underlying mail transport (PHP mail() or configured SMTP), not that it was delivered. A 200 AJAX response with wp_mail() succeeding is fully consistent with PHP NOT failing — the failure (spam filter, wrong 'From' domain not verified in SES, silent SMTP drop, catch-all mailbox) can occur entirely downstream of a successful send call.

*Evidence:* framework-documentation — WordPress Developer Reference for wp_mail(): return value indicates the message was accepted for delivery, explicitly not a delivery guarantee.

### `c6` — known-exception · **FATAL**

admin-ajax.php returns HTTP 200 with body '0' or '-1' whenever the requested action has no matching wp_ajax_/wp_ajax_nopriv_ hook (wrong action name) or nonce verification fails via check_ajax_referer() with die mode. In that case the custom handler — and any mail-sending code inside it — never executes at all. '200 = PHP executing' is false in this scenario; it's WordPress core's default die(0), not the custom code path.

*Evidence:* source-code — WordPress core wp-admin/admin-ajax.php: falls through to do_action('wp_ajax_nopriv_' . $action) / wp_die(0) when no matching hook is registered.

### `c6` — alternative-explanation

If the form handler defers mail via wp_schedule_single_event / wp-cron instead of sending inline, the AJAX response returns 200 immediately regardless of whether the mail ever goes out. If WP-Cron is broken (DISABLE_WP_CRON set, no traffic to trigger pseudo-cron, or server-level wp-cron.php blocked), the deferred job silently never fires. This is not 'PHP failing to send' — send is never attempted synchronously, and never triggered asynchronously.

*Evidence:* framework-documentation — WordPress Codex/Developer docs on wp-cron: pseudo-cron only fires on page load traffic; DISABLE_WP_CRON and server cron misconfig are common causes of silently-stalled scheduled events.

### `c6` — edge-case

Many WordPress themes fail to call status_header(404) correctly in a broken 404 template, so a mistyped AJAX URL or unregistered REST/admin-ajax route can resolve through the template hierarchy and return HTTP 200 (soft-404) instead of 404. In that case the request never reaches any custom PHP handler or mail code — the 200 body is just rendered theme markup, not a JSON success response from the intended endpoint.

*Evidence:* community-knowledge — Well-documented WordPress soft-404 pitfall (flagged routinely by Google Search Console/Yoast) where non-existent URLs render 200 due to missing is_404()/status_header(404) calls in theme templates.

### `c7` — known-exception · **FATAL**

WP REST-based AJAX endpoints return HTTP 404 (rest_no_route) when the site permalink structure is set to 'Plain', even though the endpoint's route is correctly registered and fully functional — it's reachable via the ?rest_route=/... query-var fallback. The 404 reflects a permalink/rewrite config, not a broken or unreachable handler.

*Evidence:* primary-documentation — WordPress REST API Handbook (Routing/Discovery docs) documents the ?rest_route= fallback specifically for sites without pretty permalinks enabled.

### `c7` — alternative-explanation · **FATAL**

admin-ajax.php requires wp-load.php, which bootstraps the ENTIRE WP environment (all active plugins, theme functions.php) before dispatching to the hooked wp_ajax_{action} callback. A fatal PHP error in any unrelated plugin/theme file crashes every admin-ajax.php request site-wide with a 500 — including calls to a target handler whose own code is completely correct and reachable. '500 → this endpoint is broken' misattributes the fault location.

*Evidence:* source-code — wp-admin/admin-ajax.php source: require_once(ABSPATH . 'wp-load.php') runs full bootstrap before the action dispatch switch/hook fires.

### `c7` — configuration-dependency

Hosting-level WAF / security plugins (Wordfence, Sucuri, mod_security rulesets common on managed WP hosts) can block a legitimate AJAX POST because its body content matches a signature (e.g. certain keywords/patterns), returning 403 or a generic 500 error page — while the actual endpoint code is untouched and normally reachable for other payloads.

*Evidence:* community-knowledge — Widely reported behavior with Wordfence/Sucuri/mod_security on shared WP hosting: intermittent 403/500 on admin-ajax.php tied to submitted content, not endpoint registration.

### `c8` — configuration-dependency

Many managed WP hosts (WP Engine, Pantheon, Kinsta, Flywheel) inject their own wp-config includes that force WP_DEBUG_LOG off or redirect logging, overriding whatever the user defines. On these platforms the define() block in the reply creates no debug.log regardless of correctness.

*Evidence:* widely-accepted-practice — Documented managed-host behavior (WP Engine support docs, Pantheon upstream wp-config-pantheon.php include) — platform config loads after/overrides user wp-config.php debug constants

### `c8` — configuration-dependency

wp_debug_mode() in wp-includes/load.php only takes effect if wp-content/ (or the debug.log file itself) is writable by the PHP process. Locked-down permissions (common on hardened shared hosting) silently produce no log file even with both constants correctly set to true.

*Evidence:* official-implementation — WordPress core wp_debug_mode() source + WordPress.org 'Debugging in WordPress' article note on write permissions

### `c8` — configuration-dependency

wp_debug_mode() enables logging via ini_set('log_errors', 1) / ini_set('error_log', ...). If the host has ini_set in disable_functions (common security hardening), those calls fail silently — constants report as true but nothing gets routed to wp-content/debug.log.

*Evidence:* source-code — wp-includes/load.php wp_debug_mode() relies entirely on ini_set() calls with no fallback if disabled

### `c8` — edge-case

If WP_DEBUG or WP_DEBUG_LOG is already defined earlier in wp-config.php (common when hosts pre-populate wp-config-sample.php or a migrated config already has these lines), PHP's define() is a no-op on redefinition (E_WARNING, value unchanged) — pasting the reply's block lower in the file does nothing.

*Evidence:* language-specification — PHP define() semantics: redefining an existing constant fails silently (warning only, original value kept)

### `c9` — known-exception

PHP warnings/notices suppressed with the @ error-control operator do NOT get written to debug.log even with WP_DEBUG_LOG on. @ temporarily forces error_reporting(0) for that statement, so nothing matches the reporting level and nothing is logged — not just hidden from display. WordPress core and many mail/SMTP libraries (including parts of PHPMailer) use @ around fragile calls (fsockopen, ini_set, unlink, etc.), so an error in that exact path leaves zero trace in debug.log.

*Evidence:* language-specification — PHP manual, Error Control Operators (@): suppressed errors are not passed to logging at the reporting-level check, independent of display_errors/log_errors settings

### `c9` — configuration-dependency

On several major managed WordPress hosts (e.g. WP Engine Production environments), WP_DEBUG/WP_DEBUG_LOG constants set in wp-config.php are overridden or ignored at the platform level — WP_DEBUG stays forced false regardless of what the user defines, so wp-content/debug.log is never populated no matter how the form bug manifests.

*Evidence:* community-knowledge — Managed-host platform configs (WP Engine and similar) load their own config after/around wp-config.php and lock WP_DEBUG off on Production tiers

### `c9` — edge-case

A large class of 'custom AJAX form doesn't send mail' bugs never touch PHP's error/warning/fatal machinery at all: check_ajax_referer() on nonce failure calls wp_die(-1) and returns cleanly, and deliberate wp_send_json_error()/wp_send_json_success() branches are normal control flow, not errors. In both cases the request completes with HTTP 200 (or a clean -1 body) and debug.log stays empty — an empty log after submission does not mean the PHP path is fine, only that no PHP-level error occurred.

*Evidence:* official-implementation — WordPress core wp-admin/includes/ajax-actions.php / pluggable.php: check_ajax_referer() and wp_send_json_* helpers terminate/respond via normal code paths, not via triggered PHP errors

### `c12` — configuration-dependency

wp_mail() is a pluggable function (wrapped in `if (!function_exists('wp_mail'))` in wp-includes/pluggable.php). If any other plugin or mu-plugin — including a fair number of SES-integration plugins that call the SES API directly instead of going through SMTP/PHPMailer — has already defined wp_mail(), WordPress core's implementation (the one containing the try/catch that fires 'wp_mail_failed') never runs, so the hook never fires at all, regardless of how badly the send fails.

*Evidence:* official-implementation — wp-includes/pluggable.php wp_mail() definition guarded by function_exists(); WordPress developer reference notes wp_mail() is pluggable/overridable by plugins and themes.

### `c12` — edge-case

'wp_mail_failed' only fires inside wp_mail()'s try/catch around $phpmailer->send() — i.e. only for failures that happen synchronously during the SMTP conversation (auth failure, connect refused, invalid recipient syntax, etc.). If SES accepts the message (250 OK) and wp_mail() returns true, but the message is later bounced, suppressed, or dropped (soft bounce, suppression list hit, spam filtering) that happens asynchronously outside the PHP request, 'wp_mail_failed' will never fire even though the mail genuinely never arrives — so silence from this hook does not prove the send succeeded.

*Evidence:* observed-runtime-behaviour — PHPMailer send() only throws when the SMTP transaction itself errors; downstream bounce/suppression handling (e.g. SES async bounce notifications) occurs after the PHP process has already returned true, outside any wp_mail hook.

### `c12` — known-exception

The WP_Error passed to the callback carries $e->getMessage() from PHPMailerException verbatim. For a large class of failures (e.g. connection-level SMTP problems) that message is PHPMailer's generic 'SMTP connect() failed. https://github.com/PHPMailer/PHPMailer/wiki/Troubleshooting' string, not the actual underlying cause (wrong port, firewall block, TLS negotiation failure, DNS issue). Getting the real root cause typically requires separately hooking 'phpmailer_init' to enable $phpmailer->SMTPDebug/Debugoutput — 'wp_mail_failed' alone does not surface it.

*Evidence:* official-implementation — PHPMailer's own troubleshooting documentation calls out that the connect-failure exception message is non-specific and directs users to enable SMTPDebug for the actual reason; wp_mail() simply forwards $e->getMessage() unchanged into the WP_Error.

### `c13` — known-exception · **FATAL**

SES's SendRawEmail API only requires the Source parameter (or, if Source is omitted, the address SES extracts from the raw message) to be a verified identity — it does not require the visible 'From:' header written into the raw MIME content to be verified when Source is explicitly supplied. A caller can set Source to a verified address while the raw message's From: header shows a completely different, unverified address, and SES will accept and send it rather than rejecting it.

*Evidence:* primary-documentation — AWS SES Developer Guide / API Reference for SendRawEmail, 'Source' parameter description

### `c13` — configuration-dependency

Verification in SES is granted at the identity level, and an identity can be an entire domain, not just a single email address. Once a domain identity is verified (via DKIM/TXT record), any individual address at that domain can send mail through SES successfully — even though that specific address was never itself individually verified. So 'sender address' unverified-in-isolation is not sufficient to predict rejection; what matters is whether the covering identity (domain or address) is verified.

*Evidence:* framework-documentation — AWS SES Developer Guide, domain verification / identity model

### `c15` — counterexample · **FATAL**

AWS SES does not silently drop mail from an unverified sending identity — it returns an explicit, synchronous rejection at send time. Via the API this is a MessageRejected exception with message text like 'Email address is not verified. The following identities failed the check...'; via SMTP it's a 554 'Message rejected: Email address is not verified' response at the RCPT TO/DATA stage. PHPMailer (which wp_mail() wraps) surfaces this as a thrown exception, so wp_mail() returns false and the wp_mail_failed hook — already proposed in step 4 of the same reply — fires with the real SES error string in it. That is the opposite of 'silent': the failure is loud and specific at the transport layer, it just isn't logged anywhere by default WordPress unless something is watching wp_mail_failed or debug.log.

*Evidence:* primary-documentation — AWS SES Developer Guide (identity verification / troubleshooting sending) and SES SMTP interface error-code reference — MessageRejected API error and SMTP 554 rejection are the documented behavior for sending from an unverified identity.

### `c15` — configuration-dependency

Whether the sender identity is even 'unverified' at all depends on verification granularity: SES identities can be verified at the domain level (via DKIM/SPF/DKIM CNAME records), in which case every address at that domain is automatically an authorized sender with no per-address verification needed. A custom form using an address like sales@verified-domain.com is not sending from an unverified identity even if that exact address was never individually verified — so the premise of the claim may not hold at all depending on how the SES identity was set up.

*Evidence:* framework-documentation — AWS SES identity types: email-address verification vs. domain verification — domain-verified identities cover all addresses under that domain.

---

## 7. The draft, last

> Since SMTP and SES are already confirmed working via CF7, the transport layer is fine — the bug has to be in how the custom form triggers (or fails to trigger) the send, not in mail delivery itself. Before anyone can pinpoint the actual line, a few things worth checking:
> 
> 1. Open browser dev tools (F12) → Console, then submit the form. Custom forms built with AJAX submission often have a JS handler that fails silently (bad nonce, wrong AJAX action, validation error) before the PHP send code ever runs.
> 
> 2. Check the Network tab for that same submission — does the AJAX request fire, and what's the response code/body? A 200 with nothing happening points to a PHP-side issue; a 404/500 points to a broken endpoint.
> 
> 3. Turn on logging server-side in wp-config.php:
> ```
> define('WP_DEBUG', true);
> define('WP_DEBUG_LOG', true);
> define('WP_DEBUG_DISPLAY', false);
> ```
> Then check wp-content/debug.log right after a test submission for PHP warnings/fatals.
> 
> 4. If the form does call wp_mail() but nothing arrives, hook wp_mail_failed to surface the real error, since wp_mail() often fails silently:
> ```
> add_action('wp_mail_failed', function($error) {
>     error_log(print_r($error, true));
> });
> ```
> This also catches SES rejecting the send because the custom form's "From"/"Reply-To" address isn't a verified SES identity — a common mismatch when the custom form hardcodes a different address than the one CF7 used in its test.
> 
> Whichever of those turns something up (JS error, network response, or a debug.log entry), that's the actual bug. If you can paste the form's JS submit handler and the PHP function that calls wp_mail (or whatever mail function it uses), people here can point at the exact fix instead of guessing.

---

### What is still yours to decide

Argus checks that claims are *supported*. It cannot check that they are *true*, and it has no
opinion on whether this reply is worth posting. Those remain human judgements:

- Is the evidence cited actually what it claims to be?
- Does this answer what was asked?
- Would you put your name on it?
