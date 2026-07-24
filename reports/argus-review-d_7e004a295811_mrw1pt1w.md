# Operator Review Package — `d_7e004a295811_mrw1pt1w`

**Thread:** Help with a mysterious begaviour of widgets
**Verdict:** ⛔ **REJECT**
**Certified:** 2026-07-23 18:14 · model claude-haiku-4-5-20251001

> Read this in order. The draft is at the bottom on purpose — reading prose first primes you to
> assess whether it *sounds* right instead of whether it *is* right, which is exactly how
> HRC-001 reached the publication queue.

## 1. Thread status

🟢 open — no resolution signal found

_No resolution signals._

## 2. Verdict reasons

- **fatal-contradiction** `c1` — alternative-explanation: Native CSS `content-visibility: auto` intentionally skips layout/paint for off-screen content, so wrapped widgets render as collapsed (zero/auto height) until they near the viewport, at which point the browser computes layout and box snaps to size — with zero JavaScript involved. Scroll is the trigger only because it's what brings the element near-viewport, not because a script listens for scroll. [framework-documentation]
- **fatal-contradiction** `c1` — counterexample: Known Chromium/WebKit layout bug: elements using `position: sticky` inside certain flex/grid/overflow ancestors are not correctly sized/positioned on initial paint and only get recalculated when a scroll (or resize) event forces a reflow — producing the exact collapsed-then-snap symptom via a pure browser layout-engine defect, not via script manipulating height/opacity/transform. [community-knowledge]
- **fatal-contradiction** `c1` — counterexample: CSS scroll-driven animations (`animation-timeline: view()` / `scroll()`) can drive opacity/transform/height purely in CSS, no JS at all — an element can be authored to start visually 'collapsed' and animate into place as the scrollport passes it, matching the symptom exactly while falsifying 'JavaScript is manipulating' as the mechanism. [framework-documentation]
- **fatal-contradiction** `c4` — counterexample: An uncaught synchronous error only unwinds the current call stack; it does not pause the JS engine's event loop. Other independent listeners (load, DOMContentLoaded, resize, requestAnimationFrame, timers, other <script> tags) keep firing on their own schedule regardless of the error — they are not 'waiting' for a later event to 'resume' anything. If corrective code only runs on scroll, that's because it happens to be bound to a scroll listener by the author, not because scroll is uniquely privileged as the thing that revives halted execution. [language-specification]
- **fatal-contradiction** `c4` — counterexample: When errors ARE caught (try/catch, window.onerror, unhandledrejection, or React error boundaries via componentDidCatch/getDerivedStateFromError), corrective logic runs synchronously in the same tick/render pass — not gated on any later user-triggered event like scroll. [framework-documentation]
- **fatal-contradiction** `c6` — counterexample: CSS scroll-driven animations (animation-timeline: scroll() / view(), plus animation-range) let a `transform`/`opacity` keyframe animation run purely off scroll position with zero JavaScript. A sidebar with `@keyframes { from { opacity:0; transform:translateY(20px) } to { opacity:1; transform:translateY(0) } }` and `animation-timeline: view()` will show exactly the load-state-vs-post-scroll delta described, authored entirely in CSS. [primary-documentation]
- **fatal-contradiction** `c6` — alternative-explanation: A plain CSS entrance animation/transition with a fixed delay and duration (`animation-delay`, `animation-fill-mode: backwards`) starts at `opacity:0`/`translateY(...)` on load and resolves to final state purely on elapsed time — no scroll dependency at all. If a user scrolls during that window, the before/after-scroll DevTools comparison shows the exact same diff, wrongly implicating a scroll script when the real cause is a time-based CSS transition that would have resolved even with zero scrolling. [reasoned-inference]
- **fatal-contradiction** `c7` — counterexample: content-visibility: auto causes a browser-native rendering optimization where off-screen elements render at a placeholder intrinsic size (from contain-intrinsic-size, often near-zero) and reflow to full layout height once scrolled into the viewport. Height diff before/after scroll here is pure CSS/rendering-engine behavior — zero JS involved. [primary-documentation]
- **fatal-contradiction** `c7` — counterexample: CSS scroll-driven animations (animation-timeline: scroll()/view(), scroll-timeline/view-timeline) let opacity and transform be driven directly by scroll position through the CSS engine — the exact 'element starts hidden/offset, animates in on scroll' symptom in the ticket — with no script at all. [primary-documentation]
- **fatal-contradiction** `c7` — alternative-explanation: Root logic flaw: a computed-style diff before/after scroll only shows THAT a value changed, not WHY. DevTools' Computed panel carries no provenance data — it can't distinguish a JS-set inline style from a CSS transition/animation, native position:sticky reflow, browser lazy-load reflow, or the content-visibility/scroll-timeline cases above. So the technique cannot itself 'reveal JS' as the cause; that requires the Animations panel, a DOM/attribute-modification breakpoint, or reading the actual CSS/JS source. [reasoned-inference]
- **fatal-contradiction** `c14` — contradictory-documentation: AOS.js (the most common 'scroll-triggered animation' library) states element positions are calculated on the DOMContentLoaded event (or immediately on AOS.init() if that already fired), not on scroll. Scroll only compares current scroll position against those pre-computed offsets to toggle a class — it does not (re)calculate element position. [primary-documentation]
- **fatal-contradiction** `c14` — counterexample: GSAP ScrollTrigger computes start/end trigger positions immediately at creation time (page load), and only recalculates via an explicit .refresh() call (e.g. after images finish loading) — not as a routine action driven by scroll events. [official-implementation]
- **fatal-contradiction** `c14` — alternative-explanation: CSS position:sticky sidebars use zero JavaScript and zero scroll event listeners — position is computed continuously by the browser's layout/compositor engine. WP Sticky, named directly in the draft reply, markets itself specifically as CSS-only (no JS scroll recalculation) as its differentiator from jQuery-based sticky plugins. So one of the reply's own named examples cannot exhibit the mechanism the claim describes. [official-implementation]
- **fatal-contradiction** `c14` — counterexample: jQuery sticky-kit and Theia Sticky Sidebar invoke their column/position recalculation function immediately on document-ready (page load), then bind scroll/resize only to re-invoke that same already-load-calculated function — load, not scroll, is where the calculation first happens. [source-code]
- **fatal-contradiction** `c15` — edge-case: The described symptom (elements appear collapsed/hidden on load, snap into correct state only after a scroll event) is the signature behavior of IntersectionObserver-driven reveal/sticky scripts and CSS-only mechanisms (content-visibility:auto, scroll-triggered transitions, lazy-render libraries like AOS/WOW.js). These fire exactly as coded — no exception is thrown — so DevTools Console shows zero errors. In that (common) case, step 1 of the plan yields nothing, and the plugin/theme list alone only produces a set of candidates, not an identification of 'which specific script' is responsible. [observed-runtime-behaviour]
- **overconfident-language** `c5` — asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence — "Open DevTools (F12) → Console tab, reload the page, and see if there are any red JS errors"
- **overconfident-language** `c6` — stated as fact, but the evidence is reasoned-inference (unknown) — say what you would check and why, or drop the claim — "if it's something like `transform: translateY(...)` or `opacity: 0` at load that clears on"
- **overconfident-language** `c7` — asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence — "inspect the widget wrapper right after load, then again after you scroll. Compare the comp"
- **overconfident-language** `c8` — asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence — "This specific pattern is common with sticky-sidebar plugins (Q2W3, WP Sticky, or a theme's"
- **overconfident-language** `c9` — asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence — "This specific pattern is common with sticky-sidebar plugins (Q2W3, WP Sticky, or a theme's"
- **overconfident-language** `c11` — asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence — "scroll/motion-effect libraries (AOS.js, WOW.js, or Elementor's "Motion Effects""
- **overconfident-language** `c12` — asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence — "scroll/motion-effect libraries (AOS.js, WOW.js, or Elementor's "Motion Effects""
- **overconfident-language** `c13` — asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence — "scroll/motion-effect libraries (AOS.js, WOW.js, or Elementor's "Motion Effects" if you're "
- **overconfident-language** `c15` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "If you can share the console output and your theme/plugin list, that'll narrow down which "
- **low-confidence-as-fact** `c6` — "CSS properties such as transform: translateY(...) or opacity: 0 present on load but cleared on scroll indicate the cause is an animate-on-scroll or sticky-sidebar script, not CSS-only" carries unknown confidence and is not marked as speculation

## 3. Claims — 15

| id | claim | type | evidence | conf | rests on | contra |
|---|---|---|---|---|---|---|
| `c1` | The symptom of widgets appearing collapsed on load then snapping into place on scroll indicates JavaScript is manipulating sidebar height, opacity, or transform after page load | inference | reasoned-inference (non-authoritative) | medium | — | **fatal** |
| `c2` | The correction or snap-into-place behavior is triggered by a scroll event, not page load | observation | observed-runtime-behaviour (authoritative) | high | — | — |
| `c3` | A JavaScript error occurring during page load can leave DOM elements in an incomplete or unfinished state | implementation-detail | official-implementation (authoritative) | high | — | — |
| `c4` | When JavaScript execution is halted by an error, corrective logic does not run until a later event (such as scroll) re-triggers the function | implementation-detail | official-implementation (authoritative) | high | c3 | **fatal** |
| `c5` | Checking the browser DevTools Console for JavaScript errors on page load is a valid diagnostic step for script-related DOM state issues | best-practice | widely-accepted-practice (non-authoritative) | high | — | 3 |
| `c6` | CSS properties such as transform: translateY(...) or opacity: 0 present on load but cleared on scroll indicate the cause is an animate-on-scroll or sticky-sidebar script, not CSS-only | inference | reasoned-inference (non-authoritative) | unknown | — | **fatal** |
| `c7` | Comparing computed CSS values (height, opacity, transform) in DevTools Elements Inspector before and after scrolling reveals which styles are being changed by JavaScript | best-practice | widely-accepted-practice (non-authoritative) | high | — | **fatal** |
| `c8` | Q2W3 sticky-sidebar plugin exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern | observation | community-knowledge (non-authoritative) | high | — | — |
| `c9` | WP Sticky plugin exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern | observation | community-knowledge (non-authoritative) | high | — | — |
| `c10` | Theme built-in sticky widget options exhibit the collapsed-on-load-then-snap-on-scroll behavior pattern | observation | community-knowledge (non-authoritative) | medium | — | — |
| `c11` | AOS.js scroll-triggered animation library exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern | observation | community-knowledge (non-authoritative) | high | — | — |
| `c12` | WOW.js scroll-triggered animation library exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern | observation | community-knowledge (non-authoritative) | high | — | — |
| `c13` | Elementor Motion Effects feature exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern | observation | community-knowledge (non-authoritative) | high | — | — |
| `c14` | Sticky-sidebar and scroll-triggered animation scripts recalculate element position on scroll events rather than during initial page load | implementation-detail | source-code (authoritative) | high | — | **fatal** |
| `c15` | Providing console error messages and a list of active theme and plugins enables identification of which specific script is causing the behavior | inference | reasoned-inference (non-authoritative) | high | c5 | **fatal** |

☠ = invalidated because something it rests on failed.

## 4. What this reply actually concludes

- `c1` The symptom of widgets appearing collapsed on load then snapping into place on scroll indicates JavaScript is manipulating sidebar height, opacity, or transform after page load — evidence: **reasoned-inference**, confidence **medium**
- `c2` The correction or snap-into-place behavior is triggered by a scroll event, not page load — evidence: **observed-runtime-behaviour**, confidence **high**
- `c4` When JavaScript execution is halted by an error, corrective logic does not run until a later event (such as scroll) re-triggers the function — evidence: **official-implementation**, confidence **high**
- `c6` CSS properties such as transform: translateY(...) or opacity: 0 present on load but cleared on scroll indicate the cause is an animate-on-scroll or sticky-sidebar script, not CSS-only — evidence: **reasoned-inference**, confidence **unknown**
- `c7` Comparing computed CSS values (height, opacity, transform) in DevTools Elements Inspector before and after scrolling reveals which styles are being changed by JavaScript — evidence: **widely-accepted-practice**, confidence **high**
- `c8` Q2W3 sticky-sidebar plugin exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern — evidence: **community-knowledge**, confidence **high**
- `c9` WP Sticky plugin exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern — evidence: **community-knowledge**, confidence **high**
- `c10` Theme built-in sticky widget options exhibit the collapsed-on-load-then-snap-on-scroll behavior pattern — evidence: **community-knowledge**, confidence **medium**
- `c11` AOS.js scroll-triggered animation library exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern — evidence: **community-knowledge**, confidence **high**
- `c12` WOW.js scroll-triggered animation library exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern — evidence: **community-knowledge**, confidence **high**
- `c13` Elementor Motion Effects feature exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern — evidence: **community-knowledge**, confidence **high**
- `c14` Sticky-sidebar and scroll-triggered animation scripts recalculate element position on scroll events rather than during initial page load — evidence: **source-code**, confidence **high**
- `c15` Providing console error messages and a list of active theme and plugins enables identification of which specific script is causing the behavior — evidence: **reasoned-inference**, confidence **high**



## 5. Known uncertainties

_Every claim states a provenance._


### Language outrunning evidence

- `c5` asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence
  - > Open DevTools (F12) → Console tab, reload the page, and see if there are any red JS errors on load
- `c6` stated as fact, but the evidence is reasoned-inference (unknown) — say what you would check and why, or drop the claim
  - > if it's something like `transform: translateY(...)` or `opacity: 0` at load that clears on scroll, you're looking at an animate-on-scroll or sticky sidebar script, not a CSS bug per se
- `c7` asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence
  - > inspect the widget wrapper right after load, then again after you scroll. Compare the computed `height`, `opacity`, and `transform` values
- `c8` asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence
  - > This specific pattern is common with sticky-sidebar plugins (Q2W3, WP Sticky, or a theme's built-in sticky widget option)
- `c9` asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence
  - > This specific pattern is common with sticky-sidebar plugins (Q2W3, WP Sticky, or a theme's built-in sticky widget option)
- `c11` asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence
  - > scroll/motion-effect libraries (AOS.js, WOW.js, or Elementor's "Motion Effects"
- `c12` asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence
  - > scroll/motion-effect libraries (AOS.js, WOW.js, or Elementor's "Motion Effects"
- `c13` asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence
  - > scroll/motion-effect libraries (AOS.js, WOW.js, or Elementor's "Motion Effects" if you're using Elementor)
- `c15` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > If you can share the console output and your theme/plugin list, that'll narrow down which script is doing this

## 6. Contradictions — 23 (15 fatal)

### `c1` — alternative-explanation · **FATAL**

Native CSS `content-visibility: auto` intentionally skips layout/paint for off-screen content, so wrapped widgets render as collapsed (zero/auto height) until they near the viewport, at which point the browser computes layout and box snaps to size — with zero JavaScript involved. Scroll is the trigger only because it's what brings the element near-viewport, not because a script listens for scroll.

*Evidence:* framework-documentation — MDN / CSSWG spec for `content-visibility` and the `contain-intrinsic-size` companion property

### `c1` — counterexample · **FATAL**

Known Chromium/WebKit layout bug: elements using `position: sticky` inside certain flex/grid/overflow ancestors are not correctly sized/positioned on initial paint and only get recalculated when a scroll (or resize) event forces a reflow — producing the exact collapsed-then-snap symptom via a pure browser layout-engine defect, not via script manipulating height/opacity/transform.

*Evidence:* community-knowledge — Widely reported Chromium/WebKit position:sticky recalculation bugs (bugs.chromium.org / Stack Overflow reports of 'sticky sidebar not working until scroll')

### `c1` — counterexample · **FATAL**

CSS scroll-driven animations (`animation-timeline: view()` / `scroll()`) can drive opacity/transform/height purely in CSS, no JS at all — an element can be authored to start visually 'collapsed' and animate into place as the scrollport passes it, matching the symptom exactly while falsifying 'JavaScript is manipulating' as the mechanism.

*Evidence:* framework-documentation — MDN / CSSWG Scroll-driven Animations spec (animation-timeline, view-timeline)

### `c1` — alternative-explanation

Native lazy-loading (`loading="lazy"` on `<img>`/`<iframe>`) is a browser-level fetch behavior: the widget's embedded image/iframe has no intrinsic size reserved and only fetches/renders once it nears the viewport during scroll, causing the sidebar to visually 'snap' — this is browser networking/rendering behavior, not post-load script manipulation of height/opacity/transform.

*Evidence:* framework-documentation — WHATWG HTML Living Standard, loading attribute for img/iframe

### `c4` — counterexample · **FATAL**

An uncaught synchronous error only unwinds the current call stack; it does not pause the JS engine's event loop. Other independent listeners (load, DOMContentLoaded, resize, requestAnimationFrame, timers, other <script> tags) keep firing on their own schedule regardless of the error — they are not 'waiting' for a later event to 'resume' anything. If corrective code only runs on scroll, that's because it happens to be bound to a scroll listener by the author, not because scroll is uniquely privileged as the thing that revives halted execution.

*Evidence:* language-specification — ECMAScript/HTML event loop model (MDN 'Concurrency model and the event loop'): an unhandled exception terminates only the current job/task; the task queue continues processing independently.

### `c4` — counterexample · **FATAL**

When errors ARE caught (try/catch, window.onerror, unhandledrejection, or React error boundaries via componentDidCatch/getDerivedStateFromError), corrective logic runs synchronously in the same tick/render pass — not gated on any later user-triggered event like scroll.

*Evidence:* framework-documentation — React docs on Error Boundaries: componentDidCatch/getDerivedStateFromError fire immediately and re-render fallback UI without waiting for further events.

### `c4` — alternative-explanation

The described symptom (widget collapsed at load, snaps into place on scroll) is the standard, by-design behavior of scroll-triggered animation/sticky-sidebar libraries (AOS.js, WOW.js, ScrollReveal, Theia Sticky Sidebar, Elementor's Motion Effects/Sticky, jQuery Waypoints/inview) — these intentionally compute position/opacity/transform only inside scroll or IntersectionObserver callbacks. No JS error is present in the large majority of real cases matching this pattern.

*Evidence:* community-knowledge — Well-documented behavior of scroll/IntersectionObserver-driven animation and sticky-sidebar plugins, which compute layout lazily on scroll regardless of any error state.

### `c5` — edge-case

Silent logic bugs (wrong selector returns null, race condition, forgotten listener, conditional never met) manipulate DOM state without throwing any exception — console stays clean while the script-related bug is real. A clear console is not evidence of 'no script issue'; it's evidence of 'no *thrown* error'.

*Evidence:* widely-accepted-practice — JS console.error only fires on uncaught exceptions or explicit console.error/warn calls; logic errors that don't throw produce zero console output — standard JS debugging knowledge (MDN error-handling docs).

### `c5` — alternative-explanation

The exact symptom in context (widgets collapsed/hidden on load, snap into place on scroll) is the signature behavior of scroll-reveal / sticky-sidebar libraries (AOS.js, ScrollReveal, WOW.js, IntersectionObserver-based lazy init) working AS DESIGNED — elements start at opacity:0/collapsed via CSS or inline style and are revealed on a scroll/intersection callback. No error is thrown in this case; the console check will return nothing, even though a script is unambiguously driving the DOM state.

*Evidence:* community-knowledge — Documented behavior pattern of common scroll-animation libraries (AOS, ScrollReveal) — init-hidden-then-reveal-on-scroll is their core mechanic, not a bug.

### `c5` — known-exception

Errors from cross-origin scripts (CDN-hosted plugin/theme JS without proper CORS headers) surface in console as a generic 'Script error.' with no line number, file, or stack trace — and third-party noise (ad blockers, analytics, browser extensions) commonly throws unrelated red errors on the same page load. Both reduce the check's diagnostic value: one hides the real error's location, the other produces false leads.

*Evidence:* primary-documentation — MDN/browser vendor documentation on the cross-origin 'Script error.' masking behavior (window.onerror spec, CORS + <script crossorigin>).

### `c6` — counterexample · **FATAL**

CSS scroll-driven animations (animation-timeline: scroll() / view(), plus animation-range) let a `transform`/`opacity` keyframe animation run purely off scroll position with zero JavaScript. A sidebar with `@keyframes { from { opacity:0; transform:translateY(20px) } to { opacity:1; transform:translateY(0) } }` and `animation-timeline: view()` will show exactly the load-state-vs-post-scroll delta described, authored entirely in CSS.

*Evidence:* primary-documentation — MDN 'CSS scroll-driven animations' (animation-timeline: scroll()/view()); shipped Chromium 115+, later Firefox and Safari — a standardized CSS-only mechanism, not a JS scroll listener or sticky-sidebar plugin

### `c6` — alternative-explanation · **FATAL**

A plain CSS entrance animation/transition with a fixed delay and duration (`animation-delay`, `animation-fill-mode: backwards`) starts at `opacity:0`/`translateY(...)` on load and resolves to final state purely on elapsed time — no scroll dependency at all. If a user scrolls during that window, the before/after-scroll DevTools comparison shows the exact same diff, wrongly implicating a scroll script when the real cause is a time-based CSS transition that would have resolved even with zero scrolling.

*Evidence:* reasoned-inference — Standard CSS animation-fill-mode/animation-delay semantics — coincidental timing overlap between animation completion and user scroll behavior

### `c7` — counterexample · **FATAL**

content-visibility: auto causes a browser-native rendering optimization where off-screen elements render at a placeholder intrinsic size (from contain-intrinsic-size, often near-zero) and reflow to full layout height once scrolled into the viewport. Height diff before/after scroll here is pure CSS/rendering-engine behavior — zero JS involved.

*Evidence:* primary-documentation — MDN: content-visibility and CSS containment spec — 'auto' skips layout/paint for off-screen content and substitutes an intrinsic size until it's near the viewport.

### `c7` — counterexample · **FATAL**

CSS scroll-driven animations (animation-timeline: scroll()/view(), scroll-timeline/view-timeline) let opacity and transform be driven directly by scroll position through the CSS engine — the exact 'element starts hidden/offset, animates in on scroll' symptom in the ticket — with no script at all.

*Evidence:* primary-documentation — MDN/CSSWG Scroll-driven Animations spec; shipped in Chromium and adopted by CSS-only 'reveal on scroll' patterns that replace JS libs like AOS.js.

### `c7` — alternative-explanation · **FATAL**

Root logic flaw: a computed-style diff before/after scroll only shows THAT a value changed, not WHY. DevTools' Computed panel carries no provenance data — it can't distinguish a JS-set inline style from a CSS transition/animation, native position:sticky reflow, browser lazy-load reflow, or the content-visibility/scroll-timeline cases above. So the technique cannot itself 'reveal JS' as the cause; that requires the Animations panel, a DOM/attribute-modification breakpoint, or reading the actual CSS/JS source.

*Evidence:* reasoned-inference — Structural limitation of DevTools' Computed tab (value-only, no cause attribution) versus tools that do attribute cause (Animations panel, 'break on attribute modifications').

### `c14` — contradictory-documentation · **FATAL**

AOS.js (the most common 'scroll-triggered animation' library) states element positions are calculated on the DOMContentLoaded event (or immediately on AOS.init() if that already fired), not on scroll. Scroll only compares current scroll position against those pre-computed offsets to toggle a class — it does not (re)calculate element position.

*Evidence:* primary-documentation — AOS.js official README/docs, 'How does it work' section

### `c14` — counterexample · **FATAL**

GSAP ScrollTrigger computes start/end trigger positions immediately at creation time (page load), and only recalculates via an explicit .refresh() call (e.g. after images finish loading) — not as a routine action driven by scroll events.

*Evidence:* official-implementation — GSAP ScrollTrigger docs, refresh() behavior notes

### `c14` — alternative-explanation · **FATAL**

CSS position:sticky sidebars use zero JavaScript and zero scroll event listeners — position is computed continuously by the browser's layout/compositor engine. WP Sticky, named directly in the draft reply, markets itself specifically as CSS-only (no JS scroll recalculation) as its differentiator from jQuery-based sticky plugins. So one of the reply's own named examples cannot exhibit the mechanism the claim describes.

*Evidence:* official-implementation — CSS position:sticky spec behavior; WP Sticky plugin marketing/docs (CSS-only sticky, no JS scroll handler)

### `c14` — counterexample · **FATAL**

jQuery sticky-kit and Theia Sticky Sidebar invoke their column/position recalculation function immediately on document-ready (page load), then bind scroll/resize only to re-invoke that same already-load-calculated function — load, not scroll, is where the calculation first happens.

*Evidence:* source-code — sticky-kit / theia-sticky-sidebar plugin init code (recalc on init, scroll/resize just re-trigger)

### `c14` — edge-case

The collapsed-on-load-then-snaps-on-scroll symptom is commonly caused by cumulative layout shift (late-loading images/webfonts changing container height after first paint), independent of any scroll-vs-load recalculation logic in the widget script itself.

*Evidence:* widely-accepted-practice — Known CLS behavior from async font/image loading affecting layout after initial render

### `c15` — edge-case · **FATAL**

The described symptom (elements appear collapsed/hidden on load, snap into correct state only after a scroll event) is the signature behavior of IntersectionObserver-driven reveal/sticky scripts and CSS-only mechanisms (content-visibility:auto, scroll-triggered transitions, lazy-render libraries like AOS/WOW.js). These fire exactly as coded — no exception is thrown — so DevTools Console shows zero errors. In that (common) case, step 1 of the plan yields nothing, and the plugin/theme list alone only produces a set of candidates, not an identification of 'which specific script' is responsible.

*Evidence:* observed-runtime-behaviour — Standard behavior of IntersectionObserver-based reveal/sticky-sidebar implementations and CSS content-visibility/scroll-driven animation — these do not raise JS exceptions when the trigger condition (viewport intersection / scroll offset) simply hasn't been met yet.

### `c15` — configuration-dependency

WordPress performance plugins (Autoptimize, WP Rocket, W3 Total Cache, etc.) commonly concatenate and minify all enqueued scripts into one combined asset. When an error does occur, the stack trace points to the combined bundle filename/line, not to the originating plugin — so console output plus a plugin list still can't pin down 'which specific script' without first disabling JS combination/minification.

*Evidence:* widely-accepted-practice — Known behavior of JS-aggregation features in Autoptimize / WP Rocket / W3TC — a routine WordPress debugging obstacle documented in their own troubleshooting guides ('disable JS optimization before debugging').

### `c15` — alternative-explanation

Console errors can originate from browser extensions (ad blockers, Grammarly, translators, password managers) that inject content scripts into every page. These appear in the Console tied to a script/content-script name that has no relation to any active theme or plugin, risking a false attribution even when an error is present.

*Evidence:* community-knowledge — Well-documented false-positive source in front-end debugging: extension-injected scripts (e.g. 'content_script.js', 'inpage.js') routinely show up in DevTools Console unrelated to the site's own code.

---

## 7. The draft, last

> One sec — checked site fetch, blocked by permission gate. Reply written from generic diagnosis, no site-specific confirm.
> 
> Here's the draft reply:
> 
> ---
> 
> That behavior (widgets look collapsed/dropped on load, then snap into place on scroll) usually means something is manipulating the sidebar's height, opacity, or transform via JS after the page loads, and the fix only fires on a scroll event. A few things worth checking:
> 
> 1. Open DevTools (F12) → Console tab, reload the page, and see if there are any red JS errors on load. If a script throws partway through, it can leave elements in an unfinished state until a later event (like scroll) re-triggers whatever function was supposed to fix it.
> 2. In the Elements tab, inspect the widget wrapper right after load, then again after you scroll. Compare the computed `height`, `opacity`, and `transform` values — if it's something like `transform: translateY(...)` or `opacity: 0` at load that clears on scroll, you're looking at an animate-on-scroll or "sticky sidebar" script, not a CSS bug per se.
> 3. What theme are you on, and what plugins are active? This specific pattern is common with sticky-sidebar plugins (Q2W3, WP Sticky, or a theme's built-in sticky widget option) or scroll/motion-effect libraries (AOS.js, WOW.js, or Elementor's "Motion Effects" if you're using Elementor) that recalculate position based on scroll position rather than on load.
> 
> If you can share the console output and your theme/plugin list, that'll narrow down which script is doing this.

---

### What is still yours to decide

Argus checks that claims are *supported*. It cannot check that they are *true*, and it has no
opinion on whether this reply is worth posting. Those remain human judgements:

- Is the evidence cited actually what it claims to be?
- Does this answer what was asked?
- Would you put your name on it?
