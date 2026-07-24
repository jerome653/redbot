# Operator Review Package — `d_b5a8b0185c8d_mrvwq5ao`

**Thread:** [Guide] Complete cleanup and securing of WordPress after REST Batch API (wp2shell) attack
**Verdict:** ⛔ **REJECT**
**Certified:** 2026-07-23 16:07 · model claude-haiku-4-5-20251001

> Read this in order. The draft is at the bottom on purpose — reading prose first primes you to
> assess whether it *sounds* right instead of whether it *is* right, which is exactly how
> HRC-001 reached the publication queue.

## 1. Thread status

🟢 open — no resolution signal found

_No resolution signals._

## 2. Verdict reasons

- **fatal-contradiction** `c14` — alternative-explanation: A checksum mismatch can result from file corruption or an incomplete/interrupted file transfer (bad FTP/rsync session, disk error, killed deploy or auto-update process) — not from either a compromise or a human edit. The bytes differ but no person and no attacker touched the file's content deliberately. [widely-accepted-practice]
- **fatal-contradiction** `c14` — known-exception: FTP clients in ASCII transfer mode, Windows-based editors, or git autocrlf settings silently rewrite line endings (CRLF vs LF) or insert a BOM, changing the file's byte content and thus its checksum with zero semantic change and no human 'edit' in the sense implied. [community-knowledge]
- **fatal-contradiction** `c14` — edge-case: An interrupted core/plugin auto-update can leave a file partially written — neither the old nor new version's checksum — from an automated WordPress process, not from an attacker or a person manually editing anything. [reasoned-inference]
- **fatal-contradiction** `c17` — counterexample: Attackers routinely backdate a dropped shell's mtime with `touch -r <legit-file> shell.php` or `touch -t <old-date>` (or a self-executing PHP `touch()` call) right after upload, specifically to defeat 'recently modified files' sweeps. This is a cataloged technique (MITRE ATT&CK T1070.006, Indicator Removal: Timestomp) and is common in WordPress webshell persistence. `find -mtime` reads the mtime field, which is exactly the field this technique forges — so 'still show a suspicious mtime' does not hold for any attacker who takes this basic step. [widely-accepted-practice]
- **fatal-contradiction** `c17` — configuration-dependency: Even without deliberate evasion, WordPress plugin/theme installs via the admin uploader extract a ZIP through PHP's ZipArchive, which by default applies the modification timestamp stored in each ZIP entry (not the extraction time) to the resulting file on disk. An attacker who packages the shell with an old or core-matching timestamp baked into the archive gets a file that shows an old mtime from the moment it lands on the server — no post-upload tampering step required, and no 'weeks later' delay needed for it to already read as old. [reasoned-inference]
- **fatal-contradiction** `c20` — counterexample: A wp_options cron entry is just data (hook name, args, timestamp) inside the serialized 'cron' option. When wp-cron.php runs it calls do_action_ref_array($hook, $args), which only invokes callbacks *already registered* to that hook name via add_action() in currently-loaded PHP. WordPress core never interprets the stored hook/args as executable code. So a bare malicious cron entry with no matching add_action() registration is inert — nothing fires. To do anything harmful, a callback for that hook must exist somewhere in loaded PHP (core, theme, plugin, or mu-plugin file) — i.e., a resident file is still required to give the DB entry teeth. The 'fileless via wp_options cron' technique that's actually documented (Sucuri/Wordfence writeups) always pairs the cron entry with a small loader snippet planted in functions.php or an mu-plugin (e.g. add_action('wp_loaded', fn() => eval(base64_decode(get_option('xyz'))));) — confirming a resident file is a necessary part of the mechanism, not an optional one. [official-implementation]
- **no-provenance** `c16` — "The find command with -mtime -30 option displays files modified within the last 30 days" is unknown — a factual claim must say where it comes from
- **invalidated-dependency** `c15` — rests on c14, which failed — invalid reasoning is not partially salvageable
- **invalidated-dependency** `c18` — rests on c16, which failed — invalid reasoning is not partially salvageable
- **invalidated-dependency** `c21` — rests on c20, which failed — invalid reasoning is not partially salvageable
- **overconfident-language** `c2` — asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence — "functions.php especially"
- **overconfident-language** `c3` — asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence — "files inside wp-includes/wp-admin disguised as core"
- **overconfident-language** `c9` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "This will also flag legitimate code"
- **overconfident-language** `c10` — asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence — "treat it as a shortlist to review by hand, not a delete list"
- **overconfident-language** `c13` — asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence — "instead of eyeballing manually"
- **overconfident-language** `c14` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "Anything that doesn't match is either a hacked file or a hand-edit"
- **overconfident-language** `c15` — asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence — "worth knowing either way"
- **overconfident-language** `c16` — stated as fact, but the evidence is unknown (unknown) — say what you would check and why, or drop the claim — "-mtime -30"
- **overconfident-language** `c17` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "a shell dropped weeks ago will still show a suspicious mtime"
- **overconfident-language** `c18` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "even with an innocuous filename"
- **overconfident-language** `c21` — asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence — "easy to miss if you only scan the filesystem"

## 3. Claims — 21

| id | claim | type | evidence | conf | rests on | contra |
|---|---|---|---|---|---|---|
| `c1` | Theme files (active and inactive) are commonly used by attackers for persistence after WordPress compromise | observation | community-knowledge (non-authoritative) | high | — | — |
| `c2` | functions.php in theme files is especially targeted by attackers for persistence | observation | community-knowledge (non-authoritative) | high | — | — |
| `c3` | Attackers commonly place malicious files disguised as core files inside wp-includes/wp-admin directories | observation | community-knowledge (non-authoritative) | high | — | — |
| `c4` | The original guide skips coverage of theme file persistence vectors | observation | primary-documentation (authoritative) | high | — | — |
| `c5` | The original guide does not mention checking wp-includes/wp-admin for disguised core files | observation | primary-documentation (authoritative) | high | — | — |
| `c6` | Searching for eval(), base64_decode(), gzinflate(), str_rot13(), create_function(), assert(), shell_exec(), and system() patterns can identify obfuscated or directly-executable malicious code | recommendation | reasoned-inference (non-authoritative) | medium | — | — |
| `c7` | Some legitimate WordPress plugins use base64_decode() | observation | observed-runtime-behaviour (authoritative) | high | — | — |
| `c8` | Some code minifiers use base64_decode() | observation | observed-runtime-behaviour (authoritative) | high | — | — |
| `c9` | The grep pattern search will flag legitimate code in addition to malicious code | inference | reasoned-inference (non-authoritative) | high | c7, c8 | — |
| `c10` | grep results should be treated as a manual review list rather than an automated deletion list | best-practice | operator-experience (non-authoritative) | high | c9 | 1 |
| `c11` | WP-CLI has a verify-checksums command for WordPress core files | implementation-detail | official-implementation (authoritative) | high | — | 3 |
| `c12` | WP-CLI has a verify-checksums command for plugin files | implementation-detail | official-implementation (authoritative) | high | — | 2 |
| `c13` | WP-CLI checksum verification is more efficient than manual file inspection | best-practice | operator-experience (non-authoritative) | high | c11, c12 | 4 |
| `c14` | Files failing checksum verification are either hacked or have been manually edited | inference | reasoned-inference (non-authoritative) | high | c11, c12 | **fatal** |
| `c15` ☠ | Detecting manual edits to core/plugin code is valuable in a forensic investigation | best-practice | operator-experience (non-authoritative) | high | c14 | 3 |
| `c16` | The find command with -mtime -30 option displays files modified within the last 30 days | observation | unknown (**none**) | high | — | — |
| `c17` | A malicious shell uploaded weeks ago will still display a recent modification timestamp | inference | reasoned-inference (non-authoritative) | high | c16 | **fatal** |
| `c18` ☠ | Checking file modification times can reveal malicious code even when the filename is innocuous | inference | reasoned-inference (non-authoritative) | high | c16, c17 | 2 |
| `c19` | WordPress stores scheduled task (cron) and active plugins data in the wp_options database table | observation | framework-documentation (authoritative) | high | — | — |
| `c20` | Malicious scheduled tasks can persist in wp_options without needing a resident file on disk | implementation-detail | framework-documentation (authoritative) | high | c19 | **fatal** |
| `c21` ☠ | Database-resident scheduled task persistence is easy to miss in filesystem-only scans | observation | operator-experience (non-authoritative) | high | c20 | — |

☠ = invalidated because something it rests on failed.

## 4. What this reply actually concludes

- `c1` Theme files (active and inactive) are commonly used by attackers for persistence after WordPress compromise — evidence: **community-knowledge**, confidence **high**
- `c2` functions.php in theme files is especially targeted by attackers for persistence — evidence: **community-knowledge**, confidence **high**
- `c3` Attackers commonly place malicious files disguised as core files inside wp-includes/wp-admin directories — evidence: **community-knowledge**, confidence **high**
- `c4` The original guide skips coverage of theme file persistence vectors — evidence: **primary-documentation**, confidence **high**
- `c5` The original guide does not mention checking wp-includes/wp-admin for disguised core files — evidence: **primary-documentation**, confidence **high**
- `c6` Searching for eval(), base64_decode(), gzinflate(), str_rot13(), create_function(), assert(), shell_exec(), and system() patterns can identify obfuscated or directly-executable malicious code — evidence: **reasoned-inference**, confidence **medium**
- `c10` grep results should be treated as a manual review list rather than an automated deletion list — evidence: **operator-experience**, confidence **high**
- `c13` WP-CLI checksum verification is more efficient than manual file inspection — evidence: **operator-experience**, confidence **high**
- `c15` Detecting manual edits to core/plugin code is valuable in a forensic investigation — evidence: **operator-experience**, confidence **high**
- `c18` Checking file modification times can reveal malicious code even when the filename is innocuous — evidence: **reasoned-inference**, confidence **high**
- `c21` Database-resident scheduled task persistence is easy to miss in filesystem-only scans — evidence: **operator-experience**, confidence **high**



## 5. Known uncertainties

- `c16` **unknown** — The find command with -mtime -30 option displays files modified within the last 30 days


### Language outrunning evidence

- `c2` asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence
  - > functions.php especially
- `c3` asserted with high confidence, but community-knowledge supports medium at best — hedge it or find primary evidence
  - > files inside wp-includes/wp-admin disguised as core
- `c9` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > This will also flag legitimate code
- `c10` asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence
  - > treat it as a shortlist to review by hand, not a delete list
- `c13` asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence
  - > instead of eyeballing manually
- `c14` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > Anything that doesn't match is either a hacked file or a hand-edit
- `c15` asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence
  - > worth knowing either way
- `c16` stated as fact, but the evidence is unknown (unknown) — say what you would check and why, or drop the claim
  - > -mtime -30
- `c17` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > a shell dropped weeks ago will still show a suspicious mtime
- `c18` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > even with an innocuous filename
- `c21` asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence
  - > easy to miss if you only scan the filesystem

## 6. Contradictions — 23 (6 fatal)

### `c10` — configuration-dependency

The claim frames the choice as binary (manual review vs automated deletion), but the same reply's own follow-up technique — `wp core verify-checksums` / `wp plugin verify-checksums --all` — supplies a legitimate middle path: grep hits that ALSO fail checksum verification against known-good core/plugin source can be automatically quarantined (moved out of webroot, not permanently deleted) with much lower false-positive risk than the raw function-name grep alone, since core/plugin files have no legitimate reason to contain unexpected code at all. This doesn't make raw grep output safe to auto-delete, but it does mean 'grep + checksum diff' as a combined signal is commonly automated in real IR tooling (Wordfence, MalCare, Sucuri) via quarantine, not manual review.

*Evidence:* widely-accepted-practice — Standard WP malware-cleanup tooling (Wordfence, Sucuri, MalCare) auto-quarantines files that fail checksum/signature verification, reserving manual review for ambiguous pattern-only matches like plain function-name grep on customized theme/plugin code.

### `c11` — configuration-dependency

wp core verify-checksums requires live outbound access to api.wordpress.org to fetch the reference checksums; on air-gapped, firewalled, or intentionally-isolated IR/cleanup boxes (common exactly in the compromise scenario this reply addresses) the command errors out ("Failed to get checksums from WordPress.org") rather than verifying anything.

*Evidence:* official-implementation — WP-CLI checksum-command source (wp-cli/checksum-command, Core_Command::verify_checksums) calls the api.wordpress.org/core/checksums/1.0/ endpoint at runtime; no offline/local checksum manifest fallback exists.

### `c11` — configuration-dependency

The verify-checksums subcommands are not part of bare wp-cli/wp-cli — they ship in the separate wp-cli/checksum-command package, pulled in only by the bundled distribution (wp-cli/wp-cli-bundle: the phar, Homebrew, apt installs). Composer-based installs that require wp-cli/wp-cli alone won't have `wp core verify-checksums` or `wp plugin verify-checksums` until that package is added explicitly.

*Evidence:* official-implementation — wp-cli/wp-cli-bundle composer.json lists wp-cli/checksum-command as a require; bare wp-cli/wp-cli does not.

### `c11` — edge-case

`wp plugin verify-checksums --all` silently can't verify anything for premium/non-.org plugins (Elementor Pro, ACF Pro, Gravity Forms, etc.) — WordPress.org has no checksum manifest for them, so those return "Could not retrieve the checksums" errors rather than a pass/fail verdict, leaving exactly the kind of commercial plugin common in real installs unchecked despite the command running.

*Evidence:* observed-runtime-behaviour — checksum-command's plugin verifier only queries the WordPress.org plugins API/SVN checksums, which doesn't index plugins outside the .org repo.

### `c12` — configuration-dependency

wp plugin verify-checksums isn't part of WP-CLI core — it ships via the separate wp-cli/checksum-command package, bundled only in the official wp-cli.phar distribution. Minimal installs (composer require wp-cli/wp-cli, some Docker/CI images) lack bundled commands entirely, so the command errors out ('plugin' is not a registered wp command) until `wp package install wp-cli/checksum-command` is run.

*Evidence:* official-implementation — wp-cli/checksum-command package repo + WP-CLI bundled-vs-core packaging docs

### `c12` — version-difference

Older checksum-command releases exposed plugin checksum verification under a different, now-deprecated command name (`wp core checksum-plugin`) before it was consolidated into `wp plugin verify-checksums`. Scripts/docs pinned to an older package version may reference the old form.

*Evidence:* official-implementation — wp-cli/checksum-command deprecation notes

### `c13` — known-exception

There is no `wp theme verify-checksums` command — WP-CLI only ships checksum verification for `core` and `plugin`. For the exact vector this thread flags (active/inactive theme files, functions.php), no checksum baseline exists at all, so manual inspection isn't 'less efficient' there, it's the only option.

*Evidence:* official-implementation — WP-CLI command reference exposes `wp core verify-checksums` and `wp plugin verify-checksums`; no theme equivalent has ever shipped in wp-cli core.

### `c13` — configuration-dependency

`wp plugin verify-checksums` only works for plugins distributed through the WordPress.org repo — it has nothing to diff against for premium/commercial or custom in-house plugins (WooCommerce paid extensions, ACF Pro, Gravity Forms, agency-built plugins), which is a large share of real installs. Those still require manual review regardless of the command.

*Evidence:* official-implementation — verify-checksums fetches its comparison hashes from the wordpress.org SVN/API checksum service, which only has entries for repo-hosted plugin versions.

### `c13` — edge-case

Line-ending/BOM drift from deployment pipelines (FTP ASCII transfers, Windows CRLF checkouts) and intentional core 'virtual patches' from security plugins/managed hosts produce mass false-positive mismatches. In that state the tool flags most/all files, and you're back to manually reviewing each one — same or worse effort than a targeted manual pass.

*Evidence:* community-knowledge — Recurring wp-cli issue reports of verify-checksums returning near-total-mismatch results after non-binary file transfers or host-applied core hotfixes.

### `c13` — version-difference

Detection of extra/unexpected files sitting inside wp-admin/wp-includes under core-mimicking names (a known backdoor-persistence technique) was only added to `wp core verify-checksums` in later WP-CLI releases (~2.1, 2018). On older WP-CLI installs the command only reports mismatched/missing files from the manifest, not rogue additions — so a core-lookalike webshell placed in those directories would silently pass on older tooling.

*Evidence:* official-implementation — WP-CLI core-command changelog history for the verify-checksums extra-file check.

### `c14` — alternative-explanation · **FATAL**

A checksum mismatch can result from file corruption or an incomplete/interrupted file transfer (bad FTP/rsync session, disk error, killed deploy or auto-update process) — not from either a compromise or a human edit. The bytes differ but no person and no attacker touched the file's content deliberately.

*Evidence:* widely-accepted-practice — Standard WordPress hardening guidance (e.g. Sucuri/WPScan integrity-check writeups) lists 'file corruption / incomplete transfer' as a distinct third cause of checksum mismatch alongside compromise and legitimate customization.

### `c14` — known-exception · **FATAL**

FTP clients in ASCII transfer mode, Windows-based editors, or git autocrlf settings silently rewrite line endings (CRLF vs LF) or insert a BOM, changing the file's byte content and thus its checksum with zero semantic change and no human 'edit' in the sense implied.

*Evidence:* community-knowledge — Well-documented false-positive source for any byte-level checksum tool; reported repeatedly against wp-cli's checksum-command for exactly this reason.

### `c14` — configuration-dependency

`wp core verify-checksums` fetches checksums keyed to version and locale. On non-en_US installs (or when locale detection is off), legitimate localized core files differ from the en_US reference set and get flagged as mismatches even though nothing was hacked or hand-edited.

*Evidence:* source-code — wp-cli/checksum-command explicitly handles locale in its checksum-fetch logic — that handling exists precisely because locale mismatches produced false positives.

### `c14` — edge-case · **FATAL**

An interrupted core/plugin auto-update can leave a file partially written — neither the old nor new version's checksum — from an automated WordPress process, not from an attacker or a person manually editing anything.

*Evidence:* reasoned-inference — WordPress background auto-update writes files in place; a process kill, PHP timeout, or disk-full event mid-write produces a corrupted-but-unmalicious file.

### `c15` — configuration-dependency

`wp plugin verify-checksums --all` only checks plugins hosted on the WordPress.org repository — it has no checksums to compare against for premium/commercial or custom-built plugins (WooCommerce extensions, Elementor Pro, ACF Pro, agency-custom plugins), so it silently can't verify edits in exactly the plugin class most likely to carry attacker persistence or client hand-edits.

*Evidence:* framework-documentation — WP-CLI checksum-command docs: verification is performed against the wordpress.org API checksums endpoint, which only exists for repo-hosted plugin versions.

### `c15` — known-exception

`wp core verify-checksums` deliberately excludes wp-config.php, .htaccess, and everything under wp-content from comparison — these are exactly the files/locations attackers most commonly use for core-adjacent persistence (rogue defines, redirect rules, dropped shells), so the tool reports 'core is clean' while missing that entire surface.

*Evidence:* framework-documentation — WP-CLI core verify-checksums only compares the official core file manifest; files outside the shipped core tree (config, htaccess, wp-content) are not part of that manifest by design.

### `c15` — edge-case

Checksum verification fails outright (not a graceful skip) on WordPress installs running a nightly/beta build or an EOL version no longer served by the checksums API — the command errors with something like 'Couldn't find checksums' — meaning the exact class of stale, unpatched installs most likely to be compromised is also the class where this verification method can't run at all.

*Evidence:* community-knowledge — Reported WP-CLI behavior/issues for non-standard or unsupported version strings against the api.wordpress.org checksums endpoint.

### `c17` — counterexample · **FATAL**

Attackers routinely backdate a dropped shell's mtime with `touch -r <legit-file> shell.php` or `touch -t <old-date>` (or a self-executing PHP `touch()` call) right after upload, specifically to defeat 'recently modified files' sweeps. This is a cataloged technique (MITRE ATT&CK T1070.006, Indicator Removal: Timestomp) and is common in WordPress webshell persistence. `find -mtime` reads the mtime field, which is exactly the field this technique forges — so 'still show a suspicious mtime' does not hold for any attacker who takes this basic step.

*Evidence:* widely-accepted-practice — MITRE ATT&CK T1070.006 (Timestomp); standard IR/forensics knowledge that mtime (unlike ctime on Linux, which the given `find -mtime` command doesn't check either) is trivially attacker-controlled via touch(1) or PHP touch()

### `c17` — configuration-dependency · **FATAL**

Even without deliberate evasion, WordPress plugin/theme installs via the admin uploader extract a ZIP through PHP's ZipArchive, which by default applies the modification timestamp stored in each ZIP entry (not the extraction time) to the resulting file on disk. An attacker who packages the shell with an old or core-matching timestamp baked into the archive gets a file that shows an old mtime from the moment it lands on the server — no post-upload tampering step required, and no 'weeks later' delay needed for it to already read as old.

*Evidence:* reasoned-inference — Documented behavior of PHP ZipArchive::extractTo() / standard zip format semantics (DOS timestamp field applied via touch on extraction) as used by WP_Upgrader/Plugin_Upgrader's unzip path

### `c18` — known-exception

Attackers routinely reset a dropped file's mtime to match a legitimate neighboring file (via `touch -r legit.php backdoor.php` or `touch -d`), a technique formally cataloged as MITRE ATT&CK T1070.006 (Timestomping) and standard practice in webshell installer kits (WSO, c99, and WordPress-specific droppers post-process the dropped file this way specifically to defeat mtime/`find -mtime` sweeps). This directly defeats the context's specific claim that 'a shell dropped weeks ago will still show a suspicious mtime' — a competent attacker sets the mtime to match wp-includes/core files, so it blends in with thousands of legitimately old files.

*Evidence:* framework-documentation — MITRE ATT&CK technique T1070.006 (Indicator Removal: Timestomping); widely documented in webshell/persistence tooling as a standard anti-forensic step after file drop

### `c18` — configuration-dependency

On sites deployed via git checkout, composer install, wp-cli core/plugin updates, or synced across managed-hosting nodes (WP Engine, Pantheon, etc.), every file's mtime is reset to the deploy/checkout time rather than the time the content was authored — a malicious file planted long ago but re-synced during a routine deploy shows the same 'recent' mtime as every legitimate file, and conversely a huge fraction of the codebase shows 'suspicious' recent mtimes on every redeploy, destroying the signal-to-noise ratio the technique depends on.

*Evidence:* widely-accepted-practice — Standard behavior of git (checkout sets mtime to checkout time, not commit time), composer/npm installs, and file-sync based hosting platforms — well-known DevOps/forensics caveat, not documented as a security control anywhere

### `c20` — counterexample · **FATAL**

A wp_options cron entry is just data (hook name, args, timestamp) inside the serialized 'cron' option. When wp-cron.php runs it calls do_action_ref_array($hook, $args), which only invokes callbacks *already registered* to that hook name via add_action() in currently-loaded PHP. WordPress core never interprets the stored hook/args as executable code. So a bare malicious cron entry with no matching add_action() registration is inert — nothing fires. To do anything harmful, a callback for that hook must exist somewhere in loaded PHP (core, theme, plugin, or mu-plugin file) — i.e., a resident file is still required to give the DB entry teeth. The 'fileless via wp_options cron' technique that's actually documented (Sucuri/Wordfence writeups) always pairs the cron entry with a small loader snippet planted in functions.php or an mu-plugin (e.g. add_action('wp_loaded', fn() => eval(base64_decode(get_option('xyz'))));) — confirming a resident file is a necessary part of the mechanism, not an optional one.

*Evidence:* official-implementation — WordPress core wp-includes/plugin.php do_action()/do_action_ref_array() (dispatches only to callbacks already registered in $wp_filter) and wp-includes/cron.php (_get_cron_array(), spawn_cron()); corroborated by Sucuri/Wordfence malware-cleanup writeups showing the wp_options cron payload always paired with a functions.php/mu-plugin loader snippet.

### `c20` — configuration-dependency

The one real exception is PHP Object Injection: since cron data goes through maybe_unserialize(), a crafted serialized object in the args can trigger a POP gadget's __wakeup/__destruct on option load, achieving execution without the attacker adding a new file. But this still depends on a pre-existing vulnerable gadget class already loaded from some resident file (core or an installed plugin/theme) — it's not a general, version-independent capability, only exploitable where such a gadget chain happens to exist (e.g., the 2018 WP GDPR Compliance chain).

*Evidence:* community-knowledge — Documented POP-chain/PHP Object Injection attacks against WordPress plugins (e.g. WP GDPR Compliance CVE-2018-19207-adjacent exploitation chain) requiring a pre-existing vulnerable class.

---

## 7. The draft, last

> Good writeup. One gap worth flagging: the steps cover mu-plugins, plugins, and cache, but skip two spots attackers commonly use for persistence — active and inactive theme files (functions.php especially) and files inside wp-includes/wp-admin disguised as core.
> 
> For a fast first-pass sweep across the whole install, grep for the usual obfuscation/execution patterns:
> 
> ```
> grep -rlE "eval\(|base64_decode\(|gzinflate\(|str_rot13\(|create_function\(|assert\(|shell_exec\(|system\(" --include=*.php /path/to/wordpress
> ```
> 
> This will also flag legitimate code (some plugins/minifiers use base64), so treat it as a shortlist to review by hand, not a delete list.
> 
> For verification after cleanup, WP-CLI can diff core and repo plugin files against official checksums instead of eyeballing manually:
> 
> ```
> wp core verify-checksums
> wp plugin verify-checksums --all
> ```
> 
> Anything that doesn't match is either a hacked file or a hand-edit to core/plugin code (worth knowing either way). Also useful: `find /path/to/wordpress -name "*.php" -mtime -30 -ls` to see what's been touched recently — a shell dropped weeks ago will still show a suspicious mtime even with an innocuous filename.
> 
> One more place worth checking directly in the database: the `cron` and `active_plugins` entries in `wp_options`. A malicious scheduled task can persist there without needing a resident file on disk, and it's easy to miss if you only scan the filesystem.

---

### What is still yours to decide

Argus checks that claims are *supported*. It cannot check that they are *true*, and it has no
opinion on whether this reply is worth posting. Those remain human judgements:

- Is the evidence cited actually what it claims to be?
- Does this answer what was asked?
- Would you put your name on it?
