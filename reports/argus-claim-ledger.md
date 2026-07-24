# Claim Ledger

**Generated:** 2026-07-23 · **Certifications:** 16 · **Claims:** 216

Every factual assertion Argus has extracted, across every draft. This is the record that makes
"the drafts are usually right" a checkable statement instead of an impression.

## Claims by type

| type | count | falsifiable |
|---|---|---|
| `inference` | 51 | no |
| `observation` | 49 | no |
| `implementation-detail` | 42 | yes |
| `recommendation` | 25 | no |
| `platform-behaviour` | 15 | yes |
| `best-practice` | 15 | no |
| `protocol-behaviour` | 7 | yes |
| `configuration-advice` | 6 | yes |
| `opinion` | 2 | no |
| `unknown` | 2 | no |
| `version-specific` | 1 | yes |
| `speculation` | 1 | no |

## Every claim

| draft | id | claim | type | evidence | conf |
|---|---|---|---|---|---|
| `d_f11d8de68709_m` | `c1` | Custom CSS and Additional CSS are stored using different methods in WordPress | observation | framework-documentation | high |
| `d_f11d8de68709_m` | `c2` | Because they are stored in different locations, a restore can delete Custom CSS while preserving Additional CSS | inference | reasoned-inference | medium |
| `d_f11d8de68709_m` | `c3` | Additional CSS from Appearance > Customize is stored as a dedicated single database entry | implementation-detail | framework-documentation | high |
| `d_f11d8de68709_m` | `c4` | Custom CSS from theme/plugin settings is typically stored as a single row in wp_options or postmeta containing a large serialized value | implementation-detail | framework-documentation | high |
| `d_f11d8de68709_m` | `c5` | Large single-row database values are most prone to silent truncation during SQL import when a size limit is exceeded | protocol-behaviour | observed-runtime-behaviour | high |
| `d_f11d8de68709_m` | `c6` | MySQL's max_allowed_packet configuration is a server-side size limit that can trigger truncation during import | platform-behaviour | primary-documentation | high |
| `d_f11d8de68709_m` | `c6b` | Restore tools may have internal chunking limits that cause truncation during import independently of max_allowed_packet | inference | reasoned-inference | medium |
| `d_f11d8de68709_m` | `c7` | When truncation occurs, the row is inserted as empty or truncated without raising an error | protocol-behaviour | official-implementation | high |
| `d_f11d8de68709_m` | `c8` | Database values smaller than the size limit restore successfully during import | observation | operator-experience | medium |
| `d_f11d8de68709_m` | `c9` | You can reveal truncation by comparing whether an option is empty in the live database but full in the backup | recommendation | reasoned-inference | high |
| `d_f11d8de68709_m` | `c10` | If an option is empty in the live database but full in the backup, this indicates silent truncation rather than deliberate deletion | inference | reasoned-inference | medium |
| `d_f11d8de68709_m` | `c11` | Checking and raising the host's max_allowed_packet setting before the next restore will prevent truncation | recommendation | reasoned-inference | high |
| `d_c9bd9366f6b9_m` | `c1` | Use the Wayback Machine to review what the domain previously hosted | recommendation | widely-accepted-practice | high |
| `d_c9bd9366f6b9_m` | `c2` | The previous site owner hosted approximately 200,000 pages that appear to be scraped content | observation | observed-runtime-behaviour | high |
| `d_c9bd9366f6b9_m` | `c3` | Wayback Machine snapshots from before purchase reveal the site's prior purpose and structure | recommendation | reasoned-inference | high |
| `d_c9bd9366f6b9_m` | `c4` | Problematic prior site types include scraper farms, expired-domain PBNs, and hacked sites | observation | community-knowledge | medium |
| `d_c9bd9366f6b9_m` | `c5` | The duration of prior problematic activity indicates whether the issue is residual algorithmic distrust or requires active cleanup | inference | reasoned-inference | medium |
| `d_c9bd9366f6b9_m` | `c6` | Manual actions in GSC may only appear as 'not indexed' in the coverage report without clear labeling | implementation-detail | widely-accepted-practice | high |
| `d_c9bd9366f6b9_m` | `c7` | Check GSC's 'Security & Manual Actions' section specifically rather than relying on the coverage report | recommendation | framework-documentation | high |
| `d_c9bd9366f6b9_m` | `c8` | Determine whether the site still has a 301 redirect consolidating 200k legacy URLs to the homepage | recommendation | unknown | unknown |
| `d_c9bd9366f6b9_m` | `c9` | A 301 redirect consolidating 200,000 pages to a single homepage target can appear to Google as manipulative link consolidation | inference | reasoned-inference | medium |
| `d_c9bd9366f6b9_m` | `c10` | The reputation damage from a mass redirect is separate and additional to the site's inherited domain reputation | inference | reasoned-inference | medium |
| `d_c9bd9366f6b9_m` | `c11` | Check whether robots.txt, noindex tags, or CDN/edge rules from the old site are still in place | recommendation | widely-accepted-practice | medium |
| `d_c9bd9366f6b9_m` | `c12` | Rules at the server or CDN layer can block crawling and indexing even if page source is clean | implementation-detail | unknown | high |
| `d_c9bd9366f6b9_m` | `c13` | Google's Live Test can show a URL as available in one crawl but blocked in a subsequent crawl if stale infrastructure rules exist | platform-behaviour | observed-runtime-behaviour | high |
| `d_c9bd9366f6b9_m` | `c14` | SEO tools like Yoast check page source for blocking rules but cannot detect server or CDN layer rules | implementation-detail | reasoned-inference | high |
| `d_c9bd9366f6b9_m` | `c15` | Heavy scraping history in Wayback indicates a toxic inherited reputation | inference | widely-accepted-practice | high |
| `d_c9bd9366f6b9_m` | `c16` | If no manual action is shown in GSC, a reconsideration request will not be applicable | inference | reasoned-inference | high |
| `d_c9bd9366f6b9_m` | `c17` | Disavow the inherited toxic backlink profile | recommendation | unknown | high |
| `d_c9bd9366f6b9_m` | `c18` | Remove the mass redirect | recommendation | reasoned-inference | high |
| `d_c9bd9366f6b9_m` | `c19` | Taking active remedial actions is preferable to passive waiting | opinion | operator-experience | medium |
| `d_ac82fb88ec9d_m` | `c1` | With 1000+ products, database performance is not the primary performance bottleneck in WooCommerce | inference | operator-experience | medium |
| `d_ac82fb88ec9d_m` | `c2` | WordPress per-request overhead is the primary performance bottleneck for WooCommerce with 1000+ products | inference | operator-experience | medium |
| `d_ac82fb88ec9d_m` | `c3` | Use Nginx or Apache with PHP 8 and OPcache enabled for WooCommerce hosting | best-practice | widely-accepted-practice | high |
| `d_ac82fb88ec9d_m` | `c4` | Implement full-page caching for anonymous traffic in WooCommerce | configuration-advice | widely-accepted-practice | high |
| `d_ac82fb88ec9d_m` | `c5` | Category and product listing pages receive the most traffic in WooCommerce | observation | community-knowledge | medium |
| `d_ac82fb88ec9d_m` | `c6` | Full-page caching alone resolves most performance issues for WooCommerce with 1000+ products | inference | operator-experience | medium |
| `d_ac82fb88ec9d_m` | `c7` | WordPress queries for menus, options, and product meta hit the database repeatedly on each request without object caching | implementation-detail | framework-documentation | high |
| `d_ac82fb88ec9d_m` | `c8` | Object caching with Redis prevents repeated database queries for menus, options, and product meta | platform-behaviour | reasoned-inference | high |
| `d_ac82fb88ec9d_m` | `c9` | Use Query Monitor to audit plugin performance in WordPress | best-practice | widely-accepted-practice | high |
| `d_ac82fb88ec9d_m` | `c10` | Check the number of database queries per page load to identify performance issues | best-practice | widely-accepted-practice | high |
| `d_ac82fb88ec9d_m` | `c11` | In typical WooCommerce setups, one plugin (commonly SEO, related products, or review widgets) adds 30-50+ extra queries per page load | observation | operator-experience | medium |
| `d_ac82fb88ec9d_m` | `c12` | Plugin overhead, not product count, is usually the primary cause of excessive queries in WooCommerce | inference | operator-experience | medium |
| `d_ac82fb88ec9d_m` | `c13` | If traffic justifies advanced optimization, keep cart and checkout pages on separate uncached paths | configuration-advice | reasoned-inference | high |
| `d_ac82fb88ec9d_m` | `c14` | Place a CDN in front of product images to improve performance | best-practice | widely-accepted-practice | high |
| `d_ac82fb88ec9d_m` | `c15` | ElasticPress can improve WooCommerce catalog search performance by offloading search to Elasticsearch | platform-behaviour | framework-documentation | high |
| `d_ac82fb88ec9d_m` | `c16` | Catalog search can become a performance bottleneck in large WooCommerce installations | observation | operator-experience | medium |
| `d_ac82fb88ec9d_m` | `c17` | Install Query Monitor on a staging environment before production launch | best-practice | widely-accepted-practice | high |
| `d_ac82fb88ec9d_m` | `c18` | Query Monitor reveals which plugins or queries are causing performance issues | observation | framework-documentation | high |
| `d_ac82fb88ec9d_m` | `c19` | Using Query Monitor on staging helps determine whether tier 2 or tier 3 optimizations are necessary instead of guessing | best-practice | reasoned-inference | high |
| `d_c14d9d8caa0e_m` | `c1` | Saving a WordPress widget triggers an AJAX request to admin-ajax.php | implementation-detail | framework-documentation | high |
| `d_c14d9d8caa0e_m` | `c2` | A successful widget save response from admin-ajax.php is JSON | protocol-behaviour | framework-documentation | high |
| `d_c14d9d8caa0e_m` | `c3` | HTML or PHP error notices in the admin-ajax.php response indicate a fatal server error | inference | reasoned-inference | high |
| `d_c14d9d8caa0e_m` | `c4` | Caching plugins can corrupt AJAX output | platform-behaviour | operator-experience | high |
| `d_c14d9d8caa0e_m` | `c5` | Object-cache plugins can corrupt AJAX output | platform-behaviour | operator-experience | high |
| `d_c14d9d8caa0e_m` | `c6` | Disabling caching plugins helps diagnose whether they cause widget AJAX errors | recommendation | operator-experience | high |
| `d_c14d9d8caa0e_m` | `c7` | Configuring caching plugins to exclude admin-ajax.php prevents cache interference with widget AJAX | recommendation | operator-experience | high |
| `d_b5a8b0185c8d_m` | `c1` | Theme files (active and inactive) are commonly used by attackers for persistence after WordPress compromise | observation | community-knowledge | high |
| `d_b5a8b0185c8d_m` | `c2` | functions.php in theme files is especially targeted by attackers for persistence | observation | community-knowledge | high |
| `d_b5a8b0185c8d_m` | `c3` | Attackers commonly place malicious files disguised as core files inside wp-includes/wp-admin directories | observation | community-knowledge | high |
| `d_b5a8b0185c8d_m` | `c4` | The original guide skips coverage of theme file persistence vectors | observation | primary-documentation | high |
| `d_b5a8b0185c8d_m` | `c5` | The original guide does not mention checking wp-includes/wp-admin for disguised core files | observation | primary-documentation | high |
| `d_b5a8b0185c8d_m` | `c6` | Searching for eval(), base64_decode(), gzinflate(), str_rot13(), create_function(), assert(), shell_exec(), and system() patterns can identify obfuscated or directly-executable malicious code | recommendation | reasoned-inference | medium |
| `d_b5a8b0185c8d_m` | `c7` | Some legitimate WordPress plugins use base64_decode() | observation | observed-runtime-behaviour | high |
| `d_b5a8b0185c8d_m` | `c8` | Some code minifiers use base64_decode() | observation | observed-runtime-behaviour | high |
| `d_b5a8b0185c8d_m` | `c9` | The grep pattern search will flag legitimate code in addition to malicious code | inference | reasoned-inference | high |
| `d_b5a8b0185c8d_m` | `c10` | grep results should be treated as a manual review list rather than an automated deletion list | best-practice | operator-experience | high |
| `d_b5a8b0185c8d_m` | `c11` | WP-CLI has a verify-checksums command for WordPress core files | implementation-detail | official-implementation | high |
| `d_b5a8b0185c8d_m` | `c12` | WP-CLI has a verify-checksums command for plugin files | implementation-detail | official-implementation | high |
| `d_b5a8b0185c8d_m` | `c13` | WP-CLI checksum verification is more efficient than manual file inspection | best-practice | operator-experience | high |
| `d_b5a8b0185c8d_m` | `c14` | Files failing checksum verification are either hacked or have been manually edited | inference | reasoned-inference | high |
| `d_b5a8b0185c8d_m` | `c15` | Detecting manual edits to core/plugin code is valuable in a forensic investigation | best-practice | operator-experience | high |
| `d_b5a8b0185c8d_m` | `c16` | The find command with -mtime -30 option displays files modified within the last 30 days | observation | unknown | high |
| `d_b5a8b0185c8d_m` | `c17` | A malicious shell uploaded weeks ago will still display a recent modification timestamp | inference | reasoned-inference | high |
| `d_b5a8b0185c8d_m` | `c18` | Checking file modification times can reveal malicious code even when the filename is innocuous | inference | reasoned-inference | high |
| `d_b5a8b0185c8d_m` | `c19` | WordPress stores scheduled task (cron) and active plugins data in the wp_options database table | observation | framework-documentation | high |
| `d_b5a8b0185c8d_m` | `c20` | Malicious scheduled tasks can persist in wp_options without needing a resident file on disk | implementation-detail | framework-documentation | high |
| `d_b5a8b0185c8d_m` | `c21` | Database-resident scheduled task persistence is easy to miss in filesystem-only scans | observation | operator-experience | high |
| `d_2fc9b9ee57cc_m` | `c1` | The thread conflates two separate problems: layout breaking and download/purchase not working. | observation | reasoned-inference | high |
| `d_2fc9b9ee57cc_m` | `c2` | These two problems should be diagnosed separately. | recommendation | unknown | high |
| `d_2fc9b9ee57cc_m` | `c3` | Layout breaking in WordPress player plugins is caused by CSS or script conflicts with other plugins or themes in the vast majority of cases. | inference | operator-experience | high |
| `d_2fc9b9ee57cc_m` | `c4` | When a player plugin's layout breaks, the plugin code is functioning correctly; something else is overriding its styles or scripts. | inference | reasoned-inference | high |
| `d_2fc9b9ee57cc_m` | `c5` | The Health Check & Troubleshooting plugin is free and available from WordPress.org. | observation | official-implementation | high |
| `d_2fc9b9ee57cc_m` | `c6` | Using the Health Check plugin's Troubleshooting Mode is the fastest way to confirm a CSS/script conflict. | recommendation | operator-experience | high |
| `d_2fc9b9ee57cc_m` | `c7` | Troubleshooting Mode can disable all plugins and switch to a default theme (Twenty Twenty-Four) without the changes being visible to site visitors. | implementation-detail | official-implementation | high |
| `d_2fc9b9ee57cc_m` | `c8` | If the player renders correctly with all plugins disabled and default theme active, then re-enabling plugins one at a time until the issue reappears will identify exactly which plugin or theme is causing the conflict. | recommendation | unknown | high |
| `d_2fc9b9ee57cc_m` | `c9` | Browser developer tools can be accessed via F12 and can be used to manually diagnose player issues. | recommendation | unknown | high |
| `d_2fc9b9ee57cc_m` | `c10` | If player HTML is present in the Elements panel but styled incorrectly, the cause is CSS from the theme's global rules (button/list/link resets) conflicting with the plugin's stylesheet. | inference | reasoned-inference | high |
| `d_2fc9b9ee57cc_m` | `c11` | If a player barely renders or interactive buttons do not respond to clicks, one should check the browser Console tab for red errors. | recommendation | unknown | high |
| `d_2fc9b9ee57cc_m` | `c12` | Red errors in the Console tab indicate that the plugin's JavaScript is not loading. | inference | reasoned-inference | high |
| `d_2fc9b9ee57cc_m` | `c13` | JavaScript not loading in plugins is usually caused by caching plugins or JS-minification plugins corrupting or blocking the script. | inference | operator-experience | medium |
| `d_2fc9b9ee57cc_m` | `c14` | Download or purchase failures represent a separate diagnostic problem from layout breaking. | observation | reasoned-inference | high |
| `d_2fc9b9ee57cc_m` | `c15` | Files must be marked as downloadable in WordPress product settings for downloads to function. | configuration-advice | operator-experience | high |
| `d_2fc9b9ee57cc_m` | `c16` | Testing the download link while logged out can reveal whether a WordPress setup restricts downloads to authenticated users only. | recommendation | reasoned-inference | high |
| `d_2fc9b9ee57cc_m` | `c17` | Some WordPress setups restrict file downloads to logged-in users only. | platform-behaviour | operator-experience | medium |
| `d_2fc9b9ee57cc_m` | `c18` | When multiple different music player plugins all fail with similar patterns suggesting interference, a global caching or optimization plugin running in the background is a more likely culprit than flaws in the player plugins themselves. | inference | reasoned-inference | medium |
| `d_f0d72e0a6fce_m` | `c1` | CF7 test emails work, confirming SMTP and SES transport is functioning | observation | observed-runtime-behaviour | high |
| `d_f0d72e0a6fce_m` | `c2` | If transport layer works, the bug is in form submission trigger or PHP execution, not mail delivery | inference | reasoned-inference | high |
| `d_f0d72e0a6fce_m` | `c3` | AJAX-based forms can have JS handlers that fail silently before reaching backend PHP code | best-practice | community-knowledge | high |
| `d_f0d72e0a6fce_m` | `c4` | Common causes of silent AJAX form failures: bad nonce, wrong AJAX action name, validation error | implementation-detail | framework-documentation | high |
| `d_f0d72e0a6fce_m` | `c5` | Browser console (F12) will display JS errors when form is submitted | platform-behaviour | primary-documentation | high |
| `d_f0d72e0a6fce_m` | `c6` | AJAX response 200 with no mail delivery indicates PHP backend is executing but failing to send | inference | reasoned-inference | high |
| `d_f0d72e0a6fce_m` | `c7` | AJAX response 404 or 500 indicates the endpoint is broken or unreachable | inference | reasoned-inference | high |
| `d_f0d72e0a6fce_m` | `c8` | Setting WP_DEBUG=true and WP_DEBUG_LOG=true in wp-config.php enables error logging to wp-content/debug.log | configuration-advice | framework-documentation | high |
| `d_f0d72e0a6fce_m` | `c9` | PHP errors, warnings, and fatals appear in wp-content/debug.log after form submission when logging is enabled | platform-behaviour | framework-documentation | high |
| `d_f0d72e0a6fce_m` | `c10` | wp_mail() can fail without returning error details or logging the failure | implementation-detail | framework-documentation | high |
| `d_f0d72e0a6fce_m` | `c11` | The wp_mail_failed action hook is triggered when wp_mail() fails | unknown | official-implementation | high |
| `d_f0d72e0a6fce_m` | `c12` | Using add_action('wp_mail_failed') will capture actual error details from wp_mail() failures | configuration-advice | official-implementation | high |
| `d_f0d72e0a6fce_m` | `c13` | AWS SES rejects email sent from unverified sender addresses | platform-behaviour | official-implementation | high |
| `d_f0d72e0a6fce_m` | `c14` | Custom contact forms often hardcode a 'From' or 'Reply-To' address different from CF7 | unknown | community-knowledge | medium |
| `d_f0d72e0a6fce_m` | `c15` | When a custom form uses an unverified SES identity as sender, mail is rejected silently | inference | reasoned-inference | high |
| `d_33d71cad1566_m` | `c1` | Elementor sections exhibit different CSS behavior at different viewport sizes/breakpoints | observation | widely-accepted-practice | high |
| `d_33d71cad1566_m` | `c2` | A footer gap can result from a section or column having an explicit min-height value in Elementor's mobile breakpoint settings | inference | operator-experience | medium |
| `d_33d71cad1566_m` | `c3` | A visual gap can result from a container's background color being visible through empty or unintended space | platform-behaviour | reasoned-inference | high |
| `d_33d71cad1566_m` | `c4` | Elementor's editor includes a mobile view mode toggle located at the bottom of the interface | implementation-detail | observed-runtime-behaviour | high |
| `d_33d71cad1566_m` | `c5` | Elementor sections expose height, margin, and padding settings via an Advanced tab during editing | implementation-detail | observed-runtime-behaviour | high |
| `d_33d71cad1566_m` | `c6` | Elementor allows height, margin, and padding to be set to apply only to specific breakpoints including mobile only | implementation-detail | observed-runtime-behaviour | high |
| `d_33d71cad1566_m` | `c7` | A dropdown arrow in a menu originates from either OceanWP's built-in menu system or Elementor's Nav Menu widget | observation | widely-accepted-practice | high |
| `d_33d71cad1566_m` | `c8` | Elementor's Nav Menu widget has Style and Content tabs containing dropdown arrow controls | implementation-detail | observed-runtime-behaviour | medium |
| `d_33d71cad1566_m` | `c9` | Elementor's Nav Menu widget typically includes a toggle to disable dropdown arrow display | inference | operator-experience | medium |
| `d_33d71cad1566_m` | `c10` | The location of arrow visibility settings within Elementor's Nav Menu widget differs across Elementor versions | version-specific | observed-runtime-behaviour | medium |
| `d_33d71cad1566_m` | `c11` | OceanWP's menu settings are accessible via WordPress Appearance > Customize > Menus | implementation-detail | observed-runtime-behaviour | unknown |
| `d_33d71cad1566_m` | `c12` | OceanWP may expose a 'dropdown-arrow' related configuration option for menu styling | speculation | operator-experience | low |
| `d_33d71cad1566_m` | `c13` | Browser DevTools can inspect an HTML element and display its CSS class names | platform-behaviour | observed-runtime-behaviour | high |
| `d_33d71cad1566_m` | `c14` | The CSS property display: none removes an element from page layout and rendering | protocol-behaviour | language-specification | high |
| `d_33d71cad1566_m` | `c15` | WordPress Customize section includes an Additional CSS text area that applies custom CSS site-wide | implementation-detail | observed-runtime-behaviour | high |
| `d_33d71cad1566_m` | `c16` | Switching from OceanWP or Elementor to a default WordPress theme isolates whether those plugins/themes cause a CSS issue | best-practice | widely-accepted-practice | high |
| `d_33d71cad1566_m` | `c17` | Disabling Elementor isolates whether Elementor is the source of a CSS issue | best-practice | widely-accepted-practice | high |
| `d_33d71cad1566_m` | `c18` | Using a staging copy of a site for testing is safer than using the live production site | best-practice | widely-accepted-practice | high |
| `d_33d71cad1566_m` | `c19` | If a CSS issue disappears after disabling a specific plugin or theme, that plugin or theme is the likely source | inference | reasoned-inference | high |
| `d_4a45dca4edf4_m` | `c1` | MCP is not specific to WordPress | observation | reasoned-inference | high |
| `d_4a45dca4edf4_m` | `c2` | MCP is an open standard | observation | community-knowledge | high |
| `d_4a45dca4edf4_m` | `c3` | MCP enables AI assistants to call tools exposed by a server | observation | primary-documentation | high |
| `d_4a45dca4edf4_m` | `c4` | An alternative workflow is manually clicking through a hosting dashboard | observation | widely-accepted-practice | high |
| `d_4a45dca4edf4_m` | `c5` | Hosting providers wrap existing admin actions as callable MCP tools | inference | reasoned-inference | medium |
| `d_4a45dca4edf4_m` | `c6` | Example admin actions that can be exposed: create staging site, run core/plugin updates, change PHP version | observation | community-knowledge | medium |
| `d_4a45dca4edf4_m` | `c7` | To use an MCP server, you provide an API token to authenticate an AI client connection | observation | primary-documentation | high |
| `d_4a45dca4edf4_m` | `c8` | After connecting via MCP, you can request actions through natural language chat | observation | reasoned-inference | high |
| `d_4a45dca4edf4_m` | `c9` | Without MCP, users perform hosting admin via dashboard, REST API, or CLI | observation | widely-accepted-practice | high |
| `d_4a45dca4edf4_m` | `c10` | Without MCP, each action must be initiated separately, one at a time | observation | widely-accepted-practice | high |
| `d_4a45dca4edf4_m` | `c11` | With MCP, an agent can chain multiple tool calls into a single execution from one natural-language request | observation | reasoned-inference | high |
| `d_4a45dca4edf4_m` | `c12` | The workflow of 'make staging copy, bump PHP to 8.3, run updates' consists of three distinct steps | observation | unknown | high |
| `d_4a45dca4edf4_m` | `c13` | You should verify what auth scope an MCP server's token is granted | recommendation | unknown | high |
| `d_4a45dca4edf4_m` | `c14` | MCP server tokens can have varying permission scopes ranging from read-only to allowing destructive operations | implementation-detail | reasoned-inference | high |
| `d_4a45dca4edf4_m` | `c15` | Destructive operations include deleting a staging environment | implementation-detail | reasoned-inference | medium |
| `d_4a45dca4edf4_m` | `c16` | Destructive operations include force-running updates | implementation-detail | reasoned-inference | medium |
| `d_4a45dca4edf4_m` | `c17` | You should determine whether exposed MCP tools are thin wrappers around existing REST APIs or add genuinely new functionality | recommendation | unknown | high |
| `d_4a45dca4edf4_m` | `c18` | You should verify whether an MCP server maintains an audit log of actions performed by the agent | recommendation | unknown | high |
| `d_4a45dca4edf4_m` | `c19` | The substantive differentiators between MCP vendors are auth scope, tool implementation depth, and audit log presence | opinion | operator-experience | medium |
| `d_4a45dca4edf4_m` | `c20` | Vendors typically advertise similar feature checklists (updates, staging, PHP version changes) | observation | operator-experience | medium |
| `d_4a45dca4edf4_m` | `c21` | Having similar feature checklists is not a meaningful differentiator between MCP vendors | inference | reasoned-inference | medium |
| `d_caf810a0f003_m` | `c1` | WP Super Cache appends an HTML comment to the bottom of cached pages. | implementation-detail | framework-documentation | high |
| `d_caf810a0f003_m` | `c2` | The appended comment is either '<!-- Cached page generated by WP-Super-Cache on ... -->' or '<!-- Dynamic page generated in X seconds. -->'. | implementation-detail | framework-documentation | high |
| `d_caf810a0f003_m` | `c3` | A 'Dynamic' comment in the page source during a spike indicates the cache was not served. | inference | reasoned-inference | high |
| `d_caf810a0f003_m` | `c4` | When the cache is not served, every visitor request hits PHP and MySQL directly. | inference | reasoned-inference | high |
| `d_caf810a0f003_m` | `c5` | Simultaneous PHP/MySQL hits during a spike explain runaway query activity. | inference | reasoned-inference | high |
| `d_caf810a0f003_m` | `c6` | WP Super Cache does not cache URLs containing query strings by default. | implementation-detail | framework-documentation | high |
| `d_caf810a0f003_m` | `c7` | Query string caching can be enabled via Settings > WP Super Cache > Advanced > 'Don't cache pages with GET parameters'. | configuration-advice | framework-documentation | high |
| `d_caf810a0f003_m` | `c8` | Newsletter links commonly carry tracking parameters such as Mailjet click-tracking redirects or UTM tags. | observation | widely-accepted-practice | medium |
| `d_caf810a0f003_m` | `c9` | Tracking parameters in newsletter links create query strings in the requested URLs. | inference | reasoned-inference | high |
| `d_caf810a0f003_m` | `c10` | When newsletter links have query strings and WP Super Cache is set to not cache query strings, recipients land on uncached pages. | inference | reasoned-inference | high |
| `d_caf810a0f003_m` | `c11` | Multiple simultaneous newsletter recipient clicks generate simultaneous uncached page requests. | inference | reasoned-inference | high |
| `d_caf810a0f003_m` | `c12` | Simultaneous uncached page generation from newsletter traffic mimics the server load of having no cache at all. | inference | reasoned-inference | high |
| `d_caf810a0f003_m` | `c13` | WP Super Cache 'Simple (PHP)' mode boots the WordPress application for every request even when serving a cached page. | implementation-detail | framework-documentation | high |
| `d_caf810a0f003_m` | `c14` | WP Super Cache 'Expert' (mod_rewrite) mode serves cached files as static content from Apache/Nginx before WordPress boots. | implementation-detail | framework-documentation | high |
| `d_caf810a0f003_m` | `c15` | Expert mode is significantly cheaper than Simple mode under bursts of simultaneous requests. | inference | reasoned-inference | high |
| `d_caf810a0f003_m` | `c16` | Cache expiry coinciding with burst traffic causes cache stampede: simultaneous requests regenerate the page independently. | platform-behaviour | widely-accepted-practice | high |
| `d_caf810a0f003_m` | `c17` | During cache stampede, each simultaneous regeneration performs full database queries. | inference | reasoned-inference | high |
| `d_caf810a0f003_m` | `c18` | Mutex Locking in WP Super Cache limits page regeneration to a single process at a time. | implementation-detail | framework-documentation | high |
| `d_caf810a0f003_m` | `c19` | When Mutex Locking is active, requests waiting for regeneration receive the stale cached copy. | inference | reasoned-inference | high |
| `d_caf810a0f003_m` | `c20` | If the page source shows 'Cached' during the spike and previously mentioned causes are ruled out, the database bottleneck originates elsewhere. | inference | reasoned-inference | high |
| `d_caf810a0f003_m` | `c21` | Theme and Elementor plugins can perform database queries on every page load even when serving cached pages. | observation | operator-experience | medium |
| `d_caf810a0f003_m` | `c22` | Dynamic widgets, forms, and related-posts blocks in themes and plugins are not cache-safe and query the database on every request. | observation | operator-experience | medium |
| `d_7e004a295811_m` | `c1` | The symptom of widgets appearing collapsed on load then snapping into place on scroll indicates JavaScript is manipulating sidebar height, opacity, or transform after page load | inference | reasoned-inference | medium |
| `d_7e004a295811_m` | `c2` | The correction or snap-into-place behavior is triggered by a scroll event, not page load | observation | observed-runtime-behaviour | high |
| `d_7e004a295811_m` | `c3` | A JavaScript error occurring during page load can leave DOM elements in an incomplete or unfinished state | implementation-detail | official-implementation | high |
| `d_7e004a295811_m` | `c4` | When JavaScript execution is halted by an error, corrective logic does not run until a later event (such as scroll) re-triggers the function | implementation-detail | official-implementation | high |
| `d_7e004a295811_m` | `c5` | Checking the browser DevTools Console for JavaScript errors on page load is a valid diagnostic step for script-related DOM state issues | best-practice | widely-accepted-practice | high |
| `d_7e004a295811_m` | `c6` | CSS properties such as transform: translateY(...) or opacity: 0 present on load but cleared on scroll indicate the cause is an animate-on-scroll or sticky-sidebar script, not CSS-only | inference | reasoned-inference | unknown |
| `d_7e004a295811_m` | `c7` | Comparing computed CSS values (height, opacity, transform) in DevTools Elements Inspector before and after scrolling reveals which styles are being changed by JavaScript | best-practice | widely-accepted-practice | high |
| `d_7e004a295811_m` | `c8` | Q2W3 sticky-sidebar plugin exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern | observation | community-knowledge | high |
| `d_7e004a295811_m` | `c9` | WP Sticky plugin exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern | observation | community-knowledge | high |
| `d_7e004a295811_m` | `c10` | Theme built-in sticky widget options exhibit the collapsed-on-load-then-snap-on-scroll behavior pattern | observation | community-knowledge | medium |
| `d_7e004a295811_m` | `c11` | AOS.js scroll-triggered animation library exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern | observation | community-knowledge | high |
| `d_7e004a295811_m` | `c12` | WOW.js scroll-triggered animation library exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern | observation | community-knowledge | high |
| `d_7e004a295811_m` | `c13` | Elementor Motion Effects feature exhibits the collapsed-on-load-then-snap-on-scroll behavior pattern | observation | community-knowledge | high |
| `d_7e004a295811_m` | `c14` | Sticky-sidebar and scroll-triggered animation scripts recalculate element position on scroll events rather than during initial page load | implementation-detail | source-code | high |
| `d_7e004a295811_m` | `c15` | Providing console error messages and a list of active theme and plugins enables identification of which specific script is causing the behavior | inference | reasoned-inference | high |
| `d_f11d8de68709_m` | `c1` | Custom CSS and Additional CSS are stored in different database locations within WordPress | implementation-detail | community-knowledge | medium |
| `d_f11d8de68709_m` | `c2` | Storage differences between Custom CSS and Additional CSS cause selective restoration failures where one survives a restore and the other is wiped | inference | reasoned-inference | medium |
| `d_f11d8de68709_m` | `c3` | Additional CSS accessed via Appearance > Customize is stored as a dedicated database entry | implementation-detail | community-knowledge | high |
| `d_f11d8de68709_m` | `c4` | Custom CSS from theme or plugin settings is typically stored as a single row in wp_options or postmeta | implementation-detail | reasoned-inference | medium |
| `d_f11d8de68709_m` | `c5` | Custom CSS values are stored in serialized format | implementation-detail | community-knowledge | high |
| `d_f11d8de68709_m` | `c6` | Large single-row database values are susceptible to silent truncation during SQL imports when size limits are exceeded | platform-behaviour | reasoned-inference | high |
| `d_f11d8de68709_m` | `c7` | Database server max_allowed_packet setting controls the maximum size of a single query/row during SQL operations | protocol-behaviour | official-implementation | high |
| `d_f11d8de68709_m` | `c8` | Backup/restore tools may enforce their own chunking limits independent of the database server's max_allowed_packet | implementation-detail | operator-experience | medium |
| `d_f11d8de68709_m` | `c9` | When row data exceeds size limits during SQL import, MySQL inserts the row as empty or truncated instead of throwing an error and rejecting the insert | platform-behaviour | reasoned-inference | medium |
| `d_f11d8de68709_m` | `c10` | Smaller database settings without size constraint issues restore successfully even when larger settings fail truncation | observation | reasoned-inference | high |
| `d_f11d8de68709_m` | `c11` | If a database option field is empty or truncated in the restored database but contains full data in the source backup, the cause is truncation during restore, not deliberate deletion | inference | reasoned-inference | high |
| `d_f11d8de68709_m` | `c12` | Checking and increasing the host's max_allowed_packet setting before a future restore will prevent truncation-related data loss | recommendation | reasoned-inference | high |
| `d_f11d8de68709_m` | `c1` | Custom CSS and Additional CSS are stored in different locations in WordPress | implementation-detail | framework-documentation | high |
| `d_f11d8de68709_m` | `c2` | A restore operation can selectively wipe one storage location while leaving the other intact | observation | operator-experience | high |
| `d_f11d8de68709_m` | `c3` | Additional CSS uses its own dedicated entry in WordPress storage | implementation-detail | framework-documentation | high |
| `d_f11d8de68709_m` | `c4` | Theme or plugin Custom CSS fields are typically stored as a single row in wp_options | implementation-detail | community-knowledge | medium |
| `d_f11d8de68709_m` | `c5` | Custom CSS can alternatively be stored as a single postmeta row | implementation-detail | community-knowledge | medium |
| `d_f11d8de68709_m` | `c6` | The CSS value is serialized when stored in wp_options or postmeta | implementation-detail | framework-documentation | high |
| `d_f11d8de68709_m` | `c7` | Large single-row values are the most likely to be silently truncated during a SQL import | inference | reasoned-inference | high |
| `d_f11d8de68709_m` | `c8` | Exceeding max_allowed_packet triggers the truncation condition | protocol-behaviour | primary-documentation | high |
| `d_f11d8de68709_m` | `c9` | A restore tool may have its own chunking limit that can cause truncation | implementation-detail | community-knowledge | medium |
| `d_f11d8de68709_m` | `c10` | When data exceeds size limits, the row inserts as empty or truncated instead of throwing an error | protocol-behaviour | observed-runtime-behaviour | medium |
| `d_f11d8de68709_m` | `c11` | Smaller settings restore successfully when large ones are truncated | observation | operator-experience | high |
| `d_f11d8de68709_m` | `c12` | Inspect the live database to determine if the option is present-but-empty, then compare to the backup dump | recommendation | operator-experience | high |
| `d_f11d8de68709_m` | `c13` | If the option is present-but-empty in the live DB and present-and-full in the backup, this is a truncation issue | inference | reasoned-inference | high |
| `d_f11d8de68709_m` | `c14` | Truncation due to size limits is not a deliberate wipe by Updraft | inference | reasoned-inference | high |
| `d_f11d8de68709_m` | `c15` | Check your host's max_allowed_packet setting before the next restore | recommendation | operator-experience | high |
| `d_f11d8de68709_m` | `c16` | Increasing max_allowed_packet will prevent future truncation on restore | recommendation | reasoned-inference | high |
