# Operator Review Package — `d_33d71cad1566_mrw1of0k`

**Thread:** Need help with design problems on my WordPress site!
**Verdict:** ⛔ **REJECT**
**Certified:** 2026-07-23 17:12 · model claude-haiku-4-5-20251001

> Read this in order. The draft is at the bottom on purpose — reading prose first primes you to
> assess whether it *sounds* right instead of whether it *is* right, which is exactly how
> HRC-001 reached the publication queue.

## 1. Thread status

🟢 open — no resolution signal found

_No resolution signals._

## 2. Verdict reasons

- **fatal-contradiction** `c5` — contradictory-documentation: Height (min-height) for a Section/Container lives in the Layout tab, not Advanced. Elementor's own panel structure: Layout tab = Content Width, Columns Gap, Height/Min Height, HTML Tag, Vertical Align, Stretch Section; Advanced tab = Margin, Padding, Z-Index, CSS ID/Classes, Motion Effects, Responsive visibility. This holds for both legacy Section/Column and the newer Flexbox Container element. [official-implementation]
- **fatal-contradiction** `c11` — contradictory-documentation: Appearance > Customize > Menus is WordPress core's native panel (all themes) for building menu structure and assigning locations. It holds zero OceanWP-specific toggles — no dropdown-arrow, sticky-menu, transparent-header, or mobile-icon options live there. OceanWP's own menu style settings sit in a separately-named section (commonly 'Menu', singular, under OceanWP's own 'Ocean'/'Header' panel, or in the Ocean Extra admin panel outside Customizer in newer versions) — not inside core's 'Menus' panel. [official-implementation]
- **fatal-contradiction** `c16` — alternative-explanation: Switching only the theme doesn't isolate Elementor. Elementor is a plugin — its CSS output, widget settings, and per-section values (min-height, padding, arrow toggle) live in Elementor's own frontend.min.css + post-meta data, independent of active theme. If Elementor stays active, footer-gap and arrow bugs persist unchanged after a theme swap, since root cause sits in Elementor data, not OceanWP's stylesheet. Standard WP isolation practice (Health Check & Troubleshooting plugin) treats theme-switch and plugin-deactivation as separate, orthogonal tests for exactly this reason — one doesn't substitute for other. [widely-accepted-practice]
- **fatal-contradiction** `c17` — counterexample: When the specific element under investigation is itself built with Elementor (e.g., an Elementor Pro Theme Builder footer/header, or an Elementor Nav Menu widget — both explicitly in play in this context), deactivating the Elementor plugin does not merely strip Elementor's CSS while leaving the same markup. Elementor-built content is stored as JSON in `_elementor_data` postmeta and rendered by Elementor's own PHP; with the plugin off, that content reverts to raw/fallback `post_content` or disappears entirely (blank section, theme default fallback, or 'activate Elementor to view this content' placeholder). The before/after comparison is then structure-vs-no-structure, not styled-vs-unstyled — so the test cannot cleanly attribute the gap or arrow to Elementor's CSS specifically. [observed-runtime-behaviour]
- **fatal-contradiction** `c17` — known-exception: If Elementor Pro or any third-party Elementor add-on (Essential Addons, JetElements, etc.) remains active while core Elementor is deactivated, PHP fatal errors ('Class Elementor\... not found') and white-screen crashes are a commonly reported outcome, since these add-ons hard-depend on Elementor's classes at load time. In that case the test yields no signal at all about the CSS issue — the site just breaks — rather than isolating anything. [community-knowledge]
- **overconfident-language** `c3` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "a background color that's showing through an empty container"
- **overconfident-language** `c11` — stated as fact, but the evidence is observed-runtime-behaviour (unknown) — say what you would check and why, or drop the claim — "check Appearance > Customize > Menus"
- **invalidated-dependency** `c12` — rests on c11, which failed — invalid reasoning is not partially salvageable
- **invalidated-dependency** `c19` — rests on c16, which failed — invalid reasoning is not partially salvageable
- **falsifiable-claim-weak-evidence** `c3` — "A visual gap can result from a container's background color being visible through empty or unintended space" asserts platform-behaviour on reasoned-inference — someone who knows the subject must confirm it, or it needs primary evidence
- **overconfident-language** `c12` — stated as fact, but the evidence is operator-experience (low) — say what you would check and why, or drop the claim — "search for a 'dropdown-arrow' related option there"
- **overconfident-language** `c16` — asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence — "temporarily switch to a default theme like Twenty Twenty-Four"
- **overconfident-language** `c17` — asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence — "or disable Elementor, to see if the gap/arrow persists"
- **overconfident-language** `c18` — asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence — "use a staging copy, not your live site"
- **overconfident-language** `c19` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "Whichever one makes the issue disappear tells you where to keep looking"
- **low-confidence-as-fact** `c11` — "OceanWP's menu settings are accessible via WordPress Appearance > Customize > Menus" carries unknown confidence and is not marked as speculation
- **unrefuted-falsifiable-claim** `c3` — "A visual gap can result from a container's background color being visible through empty or unintended space" asserts platform-behaviour and was never successfully attacked — its provenance (reasoned-inference) is self-declared and unchecked

## 3. Claims — 19

| id | claim | type | evidence | conf | rests on | contra |
|---|---|---|---|---|---|---|
| `c1` | Elementor sections exhibit different CSS behavior at different viewport sizes/breakpoints | observation | widely-accepted-practice (non-authoritative) | high | — | — |
| `c2` | A footer gap can result from a section or column having an explicit min-height value in Elementor's mobile breakpoint settings | inference | operator-experience (non-authoritative) | medium | c1 | 1 |
| `c3` | A visual gap can result from a container's background color being visible through empty or unintended space | platform-behaviour | reasoned-inference (non-authoritative) | high | — | — |
| `c4` | Elementor's editor includes a mobile view mode toggle located at the bottom of the interface | implementation-detail | observed-runtime-behaviour (authoritative) | high | — | 1 |
| `c5` | Elementor sections expose height, margin, and padding settings via an Advanced tab during editing | implementation-detail | observed-runtime-behaviour (authoritative) | high | — | **fatal** |
| `c6` | Elementor allows height, margin, and padding to be set to apply only to specific breakpoints including mobile only | implementation-detail | observed-runtime-behaviour (authoritative) | high | — | 2 |
| `c7` | A dropdown arrow in a menu originates from either OceanWP's built-in menu system or Elementor's Nav Menu widget | observation | widely-accepted-practice (non-authoritative) | high | — | — |
| `c8` | Elementor's Nav Menu widget has Style and Content tabs containing dropdown arrow controls | implementation-detail | observed-runtime-behaviour (authoritative) | medium | — | 1 |
| `c9` | Elementor's Nav Menu widget typically includes a toggle to disable dropdown arrow display | inference | operator-experience (non-authoritative) | medium | c8 | 1 |
| `c10` | The location of arrow visibility settings within Elementor's Nav Menu widget differs across Elementor versions | version-specific | observed-runtime-behaviour (authoritative) | medium | — | — |
| `c11` | OceanWP's menu settings are accessible via WordPress Appearance > Customize > Menus | implementation-detail | observed-runtime-behaviour (authoritative) | unknown | — | **fatal** |
| `c12` ☠ | OceanWP may expose a 'dropdown-arrow' related configuration option for menu styling | speculation | operator-experience (non-authoritative) | low | c11 | — |
| `c13` | Browser DevTools can inspect an HTML element and display its CSS class names | platform-behaviour | observed-runtime-behaviour (authoritative) | high | — | 1 |
| `c14` | The CSS property display: none removes an element from page layout and rendering | protocol-behaviour | language-specification (authoritative) | high | — | 2 |
| `c15` | WordPress Customize section includes an Additional CSS text area that applies custom CSS site-wide | implementation-detail | observed-runtime-behaviour (authoritative) | high | — | 3 |
| `c16` | Switching from OceanWP or Elementor to a default WordPress theme isolates whether those plugins/themes cause a CSS issue | best-practice | widely-accepted-practice (non-authoritative) | high | — | **fatal** |
| `c17` | Disabling Elementor isolates whether Elementor is the source of a CSS issue | best-practice | widely-accepted-practice (non-authoritative) | high | — | **fatal** |
| `c18` | Using a staging copy of a site for testing is safer than using the live production site | best-practice | widely-accepted-practice (non-authoritative) | high | — | 2 |
| `c19` ☠ | If a CSS issue disappears after disabling a specific plugin or theme, that plugin or theme is the likely source | inference | reasoned-inference (non-authoritative) | high | c16, c17 | 2 |

☠ = invalidated because something it rests on failed.

## 4. What this reply actually concludes

- `c2` A footer gap can result from a section or column having an explicit min-height value in Elementor's mobile breakpoint settings — evidence: **operator-experience**, confidence **medium**
- `c3` A visual gap can result from a container's background color being visible through empty or unintended space — evidence: **reasoned-inference**, confidence **high**
- `c4` Elementor's editor includes a mobile view mode toggle located at the bottom of the interface — evidence: **observed-runtime-behaviour**, confidence **high**
- `c5` Elementor sections expose height, margin, and padding settings via an Advanced tab during editing — evidence: **observed-runtime-behaviour**, confidence **high**
- `c6` Elementor allows height, margin, and padding to be set to apply only to specific breakpoints including mobile only — evidence: **observed-runtime-behaviour**, confidence **high**
- `c7` A dropdown arrow in a menu originates from either OceanWP's built-in menu system or Elementor's Nav Menu widget — evidence: **widely-accepted-practice**, confidence **high**
- `c9` Elementor's Nav Menu widget typically includes a toggle to disable dropdown arrow display — evidence: **operator-experience**, confidence **medium**
- `c10` The location of arrow visibility settings within Elementor's Nav Menu widget differs across Elementor versions — evidence: **observed-runtime-behaviour**, confidence **medium**
- `c12` OceanWP may expose a 'dropdown-arrow' related configuration option for menu styling — evidence: **operator-experience**, confidence **low**
- `c13` Browser DevTools can inspect an HTML element and display its CSS class names — evidence: **observed-runtime-behaviour**, confidence **high**
- `c14` The CSS property display: none removes an element from page layout and rendering — evidence: **language-specification**, confidence **high**
- `c15` WordPress Customize section includes an Additional CSS text area that applies custom CSS site-wide — evidence: **observed-runtime-behaviour**, confidence **high**
- `c18` Using a staging copy of a site for testing is safer than using the live production site — evidence: **widely-accepted-practice**, confidence **high**
- `c19` If a CSS issue disappears after disabling a specific plugin or theme, that plugin or theme is the likely source — evidence: **reasoned-inference**, confidence **high**

> ⚠️ At least one conclusion asserts how software behaves without authoritative evidence.
> That is the HRC-001 shape: reasoning about behaviour is not evidence of behaviour.

## 5. Known uncertainties

_Every claim states a provenance._


### Language outrunning evidence

- `c3` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > a background color that's showing through an empty container
- `c11` stated as fact, but the evidence is observed-runtime-behaviour (unknown) — say what you would check and why, or drop the claim
  - > check Appearance > Customize > Menus
- `c12` stated as fact, but the evidence is operator-experience (low) — say what you would check and why, or drop the claim
  - > search for a 'dropdown-arrow' related option there
- `c16` asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence
  - > temporarily switch to a default theme like Twenty Twenty-Four
- `c17` asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence
  - > or disable Elementor, to see if the gap/arrow persists
- `c18` asserted with high confidence, but widely-accepted-practice supports medium at best — hedge it or find primary evidence
  - > use a staging copy, not your live site
- `c19` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > Whichever one makes the issue disappear tells you where to keep looking

## 6. Contradictions — 27 (5 fatal)

### `c2` — configuration-dependency

Elementor's responsive controls cascade top-down: a min-height value set at Desktop (or Tablet/Laptop) applies to Mobile automatically unless a Mobile-specific override exists. So a mobile-width gap very often traces to a non-overridden Desktop min-height 'bleeding through', not to an explicit value entered in the Mobile breakpoint tab itself. The claim's framing ('explicit... value in Elementor's mobile breakpoint settings') implies the setting lives at the mobile breakpoint, which is frequently not where the actual value was set — troubleshooting should check all breakpoints' min-height, not just mobile's own.

*Evidence:* framework-documentation — Elementor's documented responsive-control behavior (desktop-first cascade for size/layout controls, incl. Section/Container min-height)

### `c4` — version-difference

Since Elementor rolled out the new 'Top Bar' editor UI (introduced as an experiment ~v3.15, made default for new/updated sites around v3.20, mid-2023), the responsive/device-mode switcher (Desktop/Tablet/Mobile icons) sits in the top bar spanning the canvas, not at the bottom of the left panel. The bottom-panel 'screen icon' location described in the reply matches only the older classic Elementor panel layout, which is still available via the Experiments toggle but is no longer what most current installs show by default.

*Evidence:* framework-documentation — Elementor's own release notes/help docs for the 'Top Bar' feature (Elementor 3.15+ experiment, defaulted ~3.20) describe moving Structure/Preview/Publish/History/Responsive Mode controls from the bottom panel footer into the new top bar.

### `c5` — contradictory-documentation · **FATAL**

Height (min-height) for a Section/Container lives in the Layout tab, not Advanced. Elementor's own panel structure: Layout tab = Content Width, Columns Gap, Height/Min Height, HTML Tag, Vertical Align, Stretch Section; Advanced tab = Margin, Padding, Z-Index, CSS ID/Classes, Motion Effects, Responsive visibility. This holds for both legacy Section/Column and the newer Flexbox Container element.

*Evidence:* official-implementation — Elementor's documented section/container settings panel (elementor.com/help/section/, elementor.com/help/container/) — Layout tab owns Height/Min-Height including per-breakpoint mobile overrides; Advanced tab owns Margin/Padding only.

### `c6` — edge-case

Section/Container 'Height' isn't fully breakpoint-independent: the height mode selector (Default / Fit to Screen / Min Height / Full Screen) is a single global control shared across all breakpoints — you cannot set 'Fit to Screen' on desktop and 'Min Height' on mobile only. Only the numeric min-height value beneath that mode has the per-breakpoint device-switcher icon.

*Evidence:* framework-documentation — Elementor editor UI: Section/Container Advanced/Layout tab — Height dropdown has no responsive (device) icon; only the Min Height slider control does

### `c6` — configuration-dependency

Breakpoint granularity beyond the default three (Desktop/Tablet/Mobile) — e.g. Mobile Landscape, Tablet Extra, Laptop, Widescreen — requires Elementor Pro's Custom Breakpoints feature. Free Elementor only exposes mobile as one of three fixed breakpoints, not an arbitrary 'specific breakpoint' set.

*Evidence:* official-implementation — Elementor.com feature comparison / Pro docs on Custom Breakpoints (Additional Breakpoints released as a Pro-gated feature)

### `c8` — version-difference

The dropdown/submenu-arrow control (Content tab, Layout section — 'Submenu Icon', an icon picker with a 'None' option to remove the arrow) was only added to Elementor Pro's Nav Menu widget in a later Pro release (~v3.6, early 2022). On older Elementor Pro installs, neither the Content tab nor the Style tab exposes any built-in control for the dropdown arrow at all — removing it required custom CSS (e.g. targeting the toggle/indicator element), which is exactly the fallback the source reply itself falls back to. So 'has Style and Content tabs containing dropdown arrow controls' is only true for sufficiently recent Pro versions, not universally true of 'Elementor's Nav Menu widget' as a flat claim.

*Evidence:* community-knowledge — Elementor Pro changelog history for the Nav Menu widget (Submenu Icon control introduced in a 3.6-era release) plus longstanding user/support-forum reports that no arrow toggle existed pre-that version, requiring manual CSS overrides

### `c9` — version-difference

A native on/off control for the submenu arrow (an 'Indicator' style option with a 'None' value) only exists in newer Elementor Pro Nav Menu widget releases from the widget's Content/Layout redesign. Many live sites — especially older Hello Elementor + OceanWP builds like the one in this thread — run older Elementor Pro versions where no such control exists, and the documented/community-standard fix is custom CSS targeting the sub-arrow class, not a widget toggle.

*Evidence:* community-knowledge — Recurring Elementor support-forum/community pattern of 'hide dropdown arrow via custom CSS' workarounds for Nav Menu widget, predating the later Indicator/None style control added in a subsequent Nav Menu widget redesign

### `c11` — contradictory-documentation · **FATAL**

Appearance > Customize > Menus is WordPress core's native panel (all themes) for building menu structure and assigning locations. It holds zero OceanWP-specific toggles — no dropdown-arrow, sticky-menu, transparent-header, or mobile-icon options live there. OceanWP's own menu style settings sit in a separately-named section (commonly 'Menu', singular, under OceanWP's own 'Ocean'/'Header' panel, or in the Ocean Extra admin panel outside Customizer in newer versions) — not inside core's 'Menus' panel.

*Evidence:* official-implementation — WordPress core Customizer API ships a built-in 'Menus' panel on every theme (since WP 4.3) scoped to menu-item/location management; OceanWP docs place theme display options under its own separately labeled panel/section, not this one.

### `c11` — configuration-dependency

Many OceanWP menu style options (arrow indicator, mega menu, sticky menu items) only appear once the free 'Ocean Extra' companion plugin is installed/active. On a bare OceanWP install without Ocean Extra, no such section renders at all — telling user to just check 'Customize > Menus' skips this prerequisite.

*Evidence:* community-knowledge — OceanWP's extended Customizer sections are registered by the Ocean Extra plugin, not theme core.

### `c11` — edge-case

Sub-menu dropdown carets in OceanWP are sometimes pure CSS pseudo-elements (::after content) with no admin toggle at all in either core Menus or OceanWP's own panel — meaning checking Customizer (any section) may find nothing, and CSS override is the only path.

*Evidence:* reasoned-inference — Original reply itself hedges with 'if neither has an obvious toggle' — no confirmed setting name.

### `c13` — edge-case

DevTools cannot show a 'class name' for CSS generated content. If the dropdown arrow (or the empty-looking footer gap) is produced via a ::before/::after pseudo-element (icon font glyph, content: '' box, etc. — common in OceanWP/Elementor icon toggles), Chrome/Firefox/Safari DevTools list it as a separate tree node (e.g. '::before') that has no class attribute of its own. Selecting it with the element picker and reading 'the class' actually returns the host element's class, not a class belonging to the arrow itself — inspecting won't yield a class name to target the arrow directly; the user has to target it via a compound selector like .parent::before instead.

*Evidence:* official-implementation — Chrome DevTools Elements panel behavior for pseudo-elements (documented under 'Inspect and modify CSS pseudo-elements'); same behavior in Firefox and Safari inspectors — pseudo-element tree nodes carry no independent class/id attributes.

### `c14` — known-exception

With CSS Transitions Level 2 (transition-behavior: allow-discrete + @starting-style), a browser can hold an element's used display value at its prior (rendered) value for the full duration of an exit transition even though the cascaded/computed value is already 'none', flipping to the true no-box state only at the transition's end. During that interval the element is demonstrably still laid out and painted despite display:none applying.

*Evidence:* primary-documentation — W3C CSS Transitions Level 2 draft (drafts.csswg.org/css-transitions-2), 'before-change style' / discrete animation of display; web.dev article 'Animate to display: none' documents Chrome 117+/Firefox 129+/Safari 17.4+ behavior

### `c14` — edge-case

display:none does not stop the browser's non-visual processing of the element: eagerly-loaded <img>/<iframe>/<video><source> subresources inside a display:none container still issue network requests, and an <audio>/<video> element's audio track keeps playing after display:none is applied to it or an ancestor. Only box generation/painting is skipped, not resource fetching or media output.

*Evidence:* observed-runtime-behaviour — Widely reproduced dev-tools observation: hidden (display:none) media/img/iframe elements still appear in the Network panel and audio continues audibly; consistent with WHATWG HTML spec defining resource fetching independent of CSS box generation

### `c15` — configuration-dependency

Block themes (Twenty Twenty-Two/Three/Four, FSE themes) hide the classic Customizer entirely — Appearance shows 'Editor' (Site Editor) not 'Customize', so no Additional CSS text area exists there at all; CSS goes through Site Editor's Styles UI instead.

*Evidence:* primary-documentation — WordPress.org Support: block themes replace Appearance > Customize with Appearance > Editor since WP 5.9

### `c15` — configuration-dependency

'Site-wide' overstates scope: Additional CSS only injects into front-end wp_head output, not wp-admin/dashboard screens, and on multisite it's per-site, not network-wide.

*Evidence:* source-code — wp_custom_css_cb() hooks to front-end wp_head only; custom_css is a per-site post type in multisite

### `c15` — edge-case

Theme/plugin can strip the panel via remove_theme_support('custom-css') or a customize_register filter, and CSS-optimizer/caching plugins (Autoptimize, WP Rocket) can inline/minify or cache stale copies of it — so presence and freshness aren't guaranteed even on a classic theme.

*Evidence:* community-knowledge — common WP plugin-ecosystem behavior around custom_css output and asset optimization

### `c16` — alternative-explanation · **FATAL**

Switching only the theme doesn't isolate Elementor. Elementor is a plugin — its CSS output, widget settings, and per-section values (min-height, padding, arrow toggle) live in Elementor's own frontend.min.css + post-meta data, independent of active theme. If Elementor stays active, footer-gap and arrow bugs persist unchanged after a theme swap, since root cause sits in Elementor data, not OceanWP's stylesheet. Standard WP isolation practice (Health Check & Troubleshooting plugin) treats theme-switch and plugin-deactivation as separate, orthogonal tests for exactly this reason — one doesn't substitute for other.

*Evidence:* widely-accepted-practice — WP Health Check plugin's Troubleshooting Mode deactivates plugins and switches theme as two distinct steps; WPBeginner/Kinsta debugging guides same split

### `c16` — counterexample

OceanWP + Elementor Theme Builder often supplies header/footer via Elementor templates tied to theme hooks. Swapping to default theme (e.g. Twenty Twenty-Four) can break/replace that header-footer wiring entirely, producing a NEW layout difference unrelated to the original bug — confounds the test rather than isolating it.

*Evidence:* community-knowledge — OceanWP + Elementor Theme Builder hook-based header/footer override behavior

### `c16` — configuration-dependency

Page cache / CDN (WP Rocket, LiteSpeed, Cloudflare) can serve stale CSS/HTML after theme switch, making result look unchanged (false negative) or changed for wrong reason (false positive) until cache purged.

*Evidence:* widely-accepted-practice — standard caching-plugin behavior serving stale minified CSS after template/theme changes

### `c17` — counterexample · **FATAL**

When the specific element under investigation is itself built with Elementor (e.g., an Elementor Pro Theme Builder footer/header, or an Elementor Nav Menu widget — both explicitly in play in this context), deactivating the Elementor plugin does not merely strip Elementor's CSS while leaving the same markup. Elementor-built content is stored as JSON in `_elementor_data` postmeta and rendered by Elementor's own PHP; with the plugin off, that content reverts to raw/fallback `post_content` or disappears entirely (blank section, theme default fallback, or 'activate Elementor to view this content' placeholder). The before/after comparison is then structure-vs-no-structure, not styled-vs-unstyled — so the test cannot cleanly attribute the gap or arrow to Elementor's CSS specifically.

*Evidence:* observed-runtime-behaviour — Elementor's documented data model (Elementor page data stored as JSON, rendered only while the plugin is active) and widely reported behavior when deactivating Elementor on pages/templates built with it

### `c17` — known-exception · **FATAL**

If Elementor Pro or any third-party Elementor add-on (Essential Addons, JetElements, etc.) remains active while core Elementor is deactivated, PHP fatal errors ('Class Elementor\... not found') and white-screen crashes are a commonly reported outcome, since these add-ons hard-depend on Elementor's classes at load time. In that case the test yields no signal at all about the CSS issue — the site just breaks — rather than isolating anything.

*Evidence:* community-knowledge — Widely reported WordPress ecosystem failure mode: deactivating a base/parent plugin while dependent add-on plugins stay active throws fatal 'class not found' errors

### `c17` — contradictory-documentation

Elementor's own official troubleshooting workflow is 'Safe Mode' (Elementor > Tools > Safe Mode), which keeps Elementor itself running (so pages/templates still render normally) while disabling other plugins/switching theme, specifically to avoid the breakage described above. This is the documented recommended technique for isolating Elementor-related display conflicts — not fully deactivating the Elementor plugin.

*Evidence:* framework-documentation — Elementor's built-in Safe Mode feature/documentation

### `c17` — configuration-dependency

Page/object caching and CDN layers (WP Rocket, LiteSpeed Cache, Cloudflare, etc.) commonly continue serving previously generated HTML/CSS after a plugin is deactivated until the cache is purged. If the tester doesn't clear cache (and hard-refresh past the browser cache) after disabling Elementor, the footer gap or arrow can appear to persist even though Elementor actually was the cause — a false negative.

*Evidence:* widely-accepted-practice — Standard WP caching-plugin guidance to purge cache after any plugin/theme state change before re-testing front-end output

### `c18` — configuration-dependency

Staging clones commonly retain live third-party credentials (payment gateway keys, SMTP/transactional email, CRM/webhook endpoints) unless manually switched to sandbox mode. Testing a checkout or form-submit flow on such a staging site can trigger real charges, real emails to real customers, or real CRM writes — the exact harm 'staging is safer' is meant to prevent.

*Evidence:* widely-accepted-practice — Standard warning across staging tooling docs (WooCommerce, WP Engine, Kinsta staging guides): explicitly instructs switching payment gateways to test/sandbox mode and disabling live SMTP before treating a staging clone as safe to test on.

### `c18` — edge-case

Staging sites are frequently left crawlable/publicly reachable (no noindex, no basic auth), which can get unfinished or duplicate content indexed by search engines — a distinct risk category that doesn't exist when carefully editing production directly during a low-traffic window.

*Evidence:* widely-accepted-practice — Common recommendation in host staging docs (WP Engine 'Discourage search engines' toggle, Kinsta staging password-protection default) — the fact that this is a default mitigation implies the underlying risk is real and staging-specific.

### `c19` — configuration-dependency

Many WP stacks run a cache-purging plugin (WP Rocket, LiteSpeed Cache, W3 Total Cache, WP Super Cache, SG Optimizer, etc.) that hooks `activated_plugin`/`deactivated_plugin` and auto-flushes page/CSS/minify cache on ANY plugin state change. Toggling an unrelated plugin off can itself clear stale/broken generated CSS, making the bug 'disappear' with zero causal link to that plugin. This is exactly why official troubleshooting guides (WordPress.org plugin-conflict guide, Elementor's own troubleshooting docs) instruct testers to clear site cache AND browser cache at every deactivation step — because skipping that step is a known source of false attribution.

*Evidence:* widely-accepted-practice — WordPress.org 'Test for WordPress Errors' / plugin-conflict debugging guide and Elementor Help Center troubleshooting articles, both of which mandate cache-clearing between toggles specifically to rule out this confound

### `c19` — alternative-explanation

Deactivating a plugin removes its enqueued stylesheet from the page entirely, changing the DOM's cascade source order for every remaining rule. Per the CSS cascade algorithm, when two rules have equal specificity the one later in source order wins — so removing plugin A's stylesheet can flip which rule 'wins' on a selector even though the actual conflicting/buggy rule lives in the theme or in plugin B, not plugin A. The symptom vanishes, but the plugin fingered is not the source — it just perturbed load order.

*Evidence:* primary-documentation — W3C CSS Cascading and Inheritance spec — cascade sorts by origin/specificity then source order for ties

---

## 7. The draft, last

> For the footer gap: right-click near the black area on mobile view and choose Inspect (or use Chrome DevTools' device toolbar, since Elementor sections often behave differently at breakpoints). Look for the specific `<section>` or `<div>` that's taller than its content — a common cause is a section/column with a min-height or padding set in Elementor's mobile settings, or a background color that's showing through an empty container. In the Elementor editor itself, switch to mobile view (the little screen icon at the bottom), click directly on the footer section around the social icons, and check the Advanced tab for any leftover height/margin/padding values that only apply on mobile.
> 
> For the dropdown arrow: it depends on whether you're using OceanWP's native menu or Elementor's Nav Menu widget. If it's Elementor's widget, edit it and check Style > Arrow (or Content tab, depending on version) — there's usually a toggle to remove it. If it's OceanWP's built-in menu, check Appearance > Customize > Menus, or search for a "dropdown-arrow" related option there. If neither has an obvious toggle, inspect the arrow element in DevTools to grab its class name, then hide it with `display: none` via Appearance > Customize > Additional CSS.
> 
> If neither of those turns anything up, it's worth checking whether OceanWP or Elementor is the actual source — duplicate your site (or use a staging copy, not your live site) and temporarily switch to a default theme like Twenty Twenty-Four, or disable Elementor, to see if the gap/arrow persists. Whichever one makes the issue disappear tells you where to keep looking.

---

### What is still yours to decide

Argus checks that claims are *supported*. It cannot check that they are *true*, and it has no
opinion on whether this reply is worth posting. Those remain human judgements:

- Is the evidence cited actually what it claims to be?
- Does this answer what was asked?
- Would you put your name on it?
