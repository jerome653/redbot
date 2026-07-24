# Certification Report

**Generated:** 2026-07-23 · **Drafts certified:** 16

| verdict | count | meaning |
|---|---|---|
| ✅ CERTIFIED | 0 | every claim adequately supported — a human still reviews it |
| ⚠️ ESCALATE | 0 | human expertise required to resolve something Argus cannot |
| ⛔ REJECT | 16 | unsupported, contradicted, or false |

## Which rules fired

| rule | times |
|---|---|
| `fatal-contradiction` | 117 |
| `overconfident-language` | 101 |
| `invalidated-dependency` | 25 |
| `falsifiable-claim-weak-evidence` | 24 |
| `no-provenance` | 12 |
| `unrefuted-falsifiable-claim` | 4 |
| `thread-resolved` | 3 |
| `low-confidence-as-fact` | 3 |

## Every certification

- ⛔ **REJECT** `d_f11d8de68709_mrwj1koh` — 0 claim(s), 0 fatal contradiction(s)
  - the asker declared this resolved — 3 signal(s) from the original poster, plus 1 from other commenters — certification stopped before claim extraction
- ⛔ **REJECT** `d_f11d8de68709_mrwj1koh` — 0 claim(s), 0 fatal contradiction(s)
  - the asker declared this resolved — 3 signal(s) from the original poster, plus 1 from other commenters — certification stopped before claim extraction
- ⛔ **REJECT** `d_f11d8de68709_mrwj1koh` — 12 claim(s), 16 fatal contradiction(s)
  - counterexample: MySQL does not silently insert an empty/truncated row when max_allowed_packet is exceeded. It raises ERROR 1153 (08S01) 'Got a packet bigger than max_allowed_packet bytes' and the statement/connection is aborted. Default mysql CLI import (without --force) then stops at that statement entirely — the row is either absent or left at its prior value, not silently present-and-empty as the claim's mechanism describes. [primary-documentation]
- ⛔ **REJECT** `d_c9bd9366f6b9_mrwiupf2` — 19 claim(s), 8 fatal contradiction(s)
  - alternative-explanation: Whether cleanup must be active depends on violation TYPE (manual action vs algorithmic) and whether toxic backlinks/spam exist — not on how long the prior activity ran. A scraper farm active for 2 weeks can trigger manual action (needs reconsideration request = active cleanup); a decade of low-quality-but-non-spammy content can resolve algorithmically once removed. Duration is not the discriminating variable — the reply's own next bullet (check GSC Security & Manual Actions) is the actual test, undermining duration as the indicator. [widely-accepted-practice]
- ⛔ **REJECT** `d_ac82fb88ec9d_mrvwodeo` — 19 claim(s), 7 fatal contradiction(s)
  - counterexample: WooCommerce core itself treats product-catalog DB access as a real bottleneck at scale: since WC 3.6 it ships a denormalized `wp_wc_product_meta_lookup` table specifically because sorting/filtering products by price, stock, or rating via wp_postmeta EAV joins was measurably slow. That fix covers price/stock/rating only — custom attribute filtering (layered nav, meta_query on pa_ taxonomies) still hits postmeta/term joins directly, and this is the documented pain point for catalogs well within the unbounded '1000+' range the claim covers (commonly cited from ~10k products up). So 'DB itself isn't the bottleneck' is false for a real, non-edge slice of the range the claim asserts. [official-implementation]
- ⛔ **REJECT** `d_c14d9d8caa0e_mrw1nf9l` — 7 claim(s), 7 fatal contradiction(s)
  - version-difference: Since WordPress 5.8 (2021), the default Widgets screen (wp-admin/widgets.php) is the block-based widgets editor. It saves via the REST API (POST/PUT to wp-json/wp/v2/widgets/<id> or wp/v2/sidebars/<id>, dispatched through @wordpress/api-fetch), not admin-ajax.php. On a current default install, the Network tab shows a REST request, never an admin-ajax.php hit, when a widget is saved. [official-implementation]
- ⛔ **REJECT** `d_b5a8b0185c8d_mrvwq5ao` — 21 claim(s), 6 fatal contradiction(s)
  - alternative-explanation: A checksum mismatch can result from file corruption or an incomplete/interrupted file transfer (bad FTP/rsync session, disk error, killed deploy or auto-update process) — not from either a compromise or a human edit. The bytes differ but no person and no attacker touched the file's content deliberately. [widely-accepted-practice]
- ⛔ **REJECT** `d_cff7a2fef080_mrvwror4` — 0 claim(s), 0 fatal contradiction(s)
  - the asker declared this resolved — 1 signal(s) from the original poster — certification stopped before claim extraction
- ⛔ **REJECT** `d_2fc9b9ee57cc_mrw1lpru` — 18 claim(s), 13 fatal contradiction(s)
  - counterexample: Plugin authors routinely ship their own CSS/JS bugs that break layout with zero external interference — WordPress.org changelogs are full of entries like 'Fixed: broken button/grid layout in Chrome' or 'Fixed: player controls misaligned,' which are the plugin's own defect being patched, not a conflict being resolved. [community-knowledge]
- ⛔ **REJECT** `d_f0d72e0a6fce_mrw1mwnt` — 15 claim(s), 10 fatal contradiction(s)
  - configuration-dependency: CF7 success proves SMTP/SES transport works only for CF7's specific From/Reply-To identity and recipient. AWS SES enforces verified-identity and sandbox-mode restrictions per sender/recipient address — if the custom form uses a different From address (unverified) or sends to a recipient not verified while account is still in SES sandbox, SES rejects (MessageRejected) at the delivery layer even though PHP execution and the trigger are fully correct. [primary-documentation]
- ⛔ **REJECT** `d_33d71cad1566_mrw1of0k` — 19 claim(s), 5 fatal contradiction(s)
  - contradictory-documentation: Height (min-height) for a Section/Container lives in the Layout tab, not Advanced. Elementor's own panel structure: Layout tab = Content Width, Columns Gap, Height/Min Height, HTML Tag, Vertical Align, Stretch Section; Advanced tab = Margin, Padding, Z-Index, CSS ID/Classes, Motion Effects, Responsive visibility. This holds for both legacy Section/Column and the newer Flexbox Container element. [official-implementation]
- ⛔ **REJECT** `d_4a45dca4edf4_mrwhzx0n` — 21 claim(s), 0 fatal contradiction(s)
  - "The workflow of 'make staging copy, bump PHP to 8.3, run updates' consists of three distinct steps" is unknown — a factual claim must say where it comes from
- ⛔ **REJECT** `d_caf810a0f003_mrvwti98` — 22 claim(s), 9 fatal contradiction(s)
  - known-exception: WP Super Cache does not serve cached pages to logged-in users by default (only enabled if 'Cache pages for known users' is checked in Advanced Settings), and it also bypasses cache for any visitor carrying a comment_author, wp-postpass, or wordpress_logged_in cookie (default 'Rejected Cookies' list). Any of these visitors — including the site owner checking their own site while logged into wp-admin, which is the most likely way this check gets performed — will see the 'Dynamic' footer every time, regardless of whether the cache is serving everyone else fine. So 'Dynamic' does not reliably indicate the cache failed for the traffic spike; it may just indicate the requester was excluded from caching by design. [framework-documentation]
- ⛔ **REJECT** `d_7e004a295811_mrw1pt1w` — 15 claim(s), 15 fatal contradiction(s)
  - alternative-explanation: Native CSS `content-visibility: auto` intentionally skips layout/paint for off-screen content, so wrapped widgets render as collapsed (zero/auto height) until they near the viewport, at which point the browser computes layout and box snaps to size — with zero JavaScript involved. Scroll is the trigger only because it's what brings the element near-viewport, not because a script listens for scroll. [framework-documentation]
- ⛔ **REJECT** `d_f11d8de68709_mrwj1koh` — 12 claim(s), 10 fatal contradiction(s)
  - counterexample: MySQL does not silently insert an empty/truncated row when a statement exceeds max_allowed_packet — it raises ERROR 1153 (08S01) 'Got a packet bigger than max_allowed_packet bytes' and the client aborts that statement (and, without --force, the whole import). Since mysqldump uses extended INSERTs by default, a single oversized value typically kills an entire multi-row INSERT batch, not just one option row. The claim's proposed verification ('check whether the option is present-but-empty') doesn't match this failure mode — a packet-size failure leaves the row (and often many sibling rows) absent, not present-and-blank. [primary-documentation]
- ⛔ **REJECT** `d_f11d8de68709_mrwj1koh` — 16 claim(s), 11 fatal contradiction(s)
  - counterexample: MySQL does not silently truncate an oversized row during SQL import — it raises an explicit error and the statement (often the whole import) aborts. mysqldump/mysql CLI restores hitting a value bigger than max_allowed_packet produce ERROR 1153 (08S01) 'Got a packet bigger than max_allowed_packet bytes' or ERROR 2006 'MySQL server has gone away'. The failing INSERT does not partially execute — the row is either entirely absent (fresh INSERT never lands) or (for UPDATE/REPLACE) retains its prior value. It never lands as a clean, present-but-empty row from truncation at the DB layer. [primary-documentation]
