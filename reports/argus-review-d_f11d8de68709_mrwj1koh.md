# Operator Review Package — `d_f11d8de68709_mrwj1koh`

**Thread:** Custom CSS missing after Updraft restore
**Verdict:** ⛔ **REJECT**
**Certified:** 2026-07-23 21:56 · model claude-haiku-4-5-20251001

> Read this in order. The draft is at the bottom on purpose — reading prose first primes you to
> assess whether it *sounds* right instead of whether it *is* right, which is exactly how
> HRC-001 reached the publication queue.

## 1. Thread status

⛔ **RESOLVED** — the asker declared this resolved — 3 signal(s) from the original poster, plus 1 from other commenters

- `post-body` **(original poster)** — "UPDATE:"
  - post carries an UPDATE section: …y I can get that Custom CSS back? I have the Updraft backup UPDATE: I downloaded the Updraft database file and extracted it. I…
- `comment` — "found it"
  - found the cause: …I knew was in the Custom CSS (eg: ".main-cta") and when it found it, I selected the block of text for that chunk of CSS. I had…
- `op-reply` **(original poster)** — "this worked"
  - confirmed a fix worked: …Yes this worked…
- `op-reply` **(original poster)** — "this is what I did"
  - adopted the suggested fix: …Thanks this is what I did…

## 2. Verdict reasons

- **fatal-contradiction** `c1` — counterexample: MySQL does not silently truncate an oversized row during SQL import — it raises an explicit error and the statement (often the whole import) aborts. mysqldump/mysql CLI restores hitting a value bigger than max_allowed_packet produce ERROR 1153 (08S01) 'Got a packet bigger than max_allowed_packet bytes' or ERROR 2006 'MySQL server has gone away'. The failing INSERT does not partially execute — the row is either entirely absent (fresh INSERT never lands) or (for UPDATE/REPLACE) retains its prior value. It never lands as a clean, present-but-empty row from truncation at the DB layer. [primary-documentation]
- **fatal-contradiction** `c6` — counterexample: WordPress does not serialize scalar values. `maybe_serialize()` (called internally by `update_option()`, `add_option()`, `update_post_meta()`, `add_post_meta()`) only runs `serialize()` when the value `is_array()` or `is_object()`; a plain CSS string is returned untouched. So a single-purpose option like `update_option('plugin_custom_css', $css_string)` or `update_post_meta($id, '_custom_css', $css_string)` stores raw, unserialized CSS text — not a serialized blob. Serialization only happens if the CSS is bundled as one element inside a larger settings array (e.g. Settings API options pages, Redux/ACF-style option blobs, `theme_mods_{theme}`), which is a common pattern but not the only one and not implied by 'a single row holding one large value.' [source-code]
- **fatal-contradiction** `c6` — known-exception: Additional CSS (Appearance > Customize > Additional CSS), which the surrounding context explicitly discusses as 'its own dedicated entry,' is not stored in wp_options or wp_postmeta at all. Since WP 4.7 it is persisted as a custom post type (`custom_css`) with the CSS living in `wp_posts.post_content` (plain text, via `wp_update_custom_css_post()`), addressed by `post_name` like `{stylesheet}` and a `csslimit` meta only for byte-count bookkeeping — the CSS body itself is never in wp_options or postmeta. [official-implementation]
- **fatal-contradiction** `c7` — counterexample: Exceeding max_allowed_packet does not silently truncate/empty a row — MySQL raises ERROR 1153 (08S01) "Got a packet bigger than 'max_allowed_packet' bytes" and aborts that statement. Default mysql CLI import also stops entirely on this error (no --force). The claimed mechanism (silent empty/truncated insert instead of an error) contradicts documented server behavior. [primary-documentation]
- **fatal-contradiction** `c7` — known-exception: The documented silent-truncation mechanism in MySQL (data truncated for a column with a warning, not an error) is driven by column width limits under non-strict SQL mode — not by row/value size. Large serialized blobs (e.g. WP CSS) are almost always stored in TEXT/LONGTEXT (up to 4GB), which essentially never hits a width limit, whereas small VARCHAR(n)-typed fields are the ones actually vulnerable to this silent-truncation path. This inverts the claim's ranking: width-constrained small columns, not large single-row values, are the more likely silent-truncation victims. [primary-documentation]
- **fatal-contradiction** `c8` — counterexample: MySQL does not silently truncate or insert an empty row when a statement exceeds max_allowed_packet. Server returns ERROR 1153 (08S01) 'Got a packet bigger than max_allowed_packet bytes', drops the connection/aborts that statement, and the mysql CLI import halts with that error (unless run with --force, in which case it skips the statement entirely rather than writing a truncated value). [primary-documentation]
- **fatal-contradiction** `c9` — counterexample: Known WP restore/import mechanisms that chunk large SQL files (WP-CLI's `wp db import`, phpMyAdmin's buffered import, UpdraftPlus, Duplicator, WP Migrate DB Pro) all chunk at the level of complete statements or batches, not mid-value bytes — because cutting a quoted string value in half leaves an unterminated string literal, which is a SQL syntax error that aborts/reports loudly. For a chunker to produce the described outcome ('row inserts empty or truncated instead of throwing an error'), it would have to deliberately detect the field boundary and re-close the quote/statement — that's a value-length cap by design, not an incidental 'chunking limit', and none of the common WP-ecosystem tools implement that. [reasoned-inference]
- **fatal-contradiction** `c10` — counterexample: Exceeding max_allowed_packet does not make MySQL insert an empty/truncated row silently. Server returns ERROR 1153 (08S01) 'Got a packet bigger than max_allowed_packet bytes', the offending statement fails, and the connection is often dropped. mysql CLI import aborts at that statement (continues only past it if run with --force, in which case that row is simply never written — not written empty/truncated). [primary-documentation]
- **fatal-contradiction** `c13` — counterexample: MySQL does not silently write an empty/truncated row when a value exceeds max_allowed_packet. It raises ERROR 1153 (08S01) "Got a packet bigger than 'max_allowed_packet' bytes" and rejects that statement (often dropping the connection with "MySQL server has gone away"). Under a plain `mysql < dump.sql` import without --force, this aborts the restore at that line rather than inserting a blank value; under --force it skips the statement, leaving the option at whatever it was BEFORE the restore ran — not a fresh empty value caused by the restore. [official-implementation]
- **fatal-contradiction** `c13` — alternative-explanation: The identical symptom — option present-and-full in the backup, present-but-empty live — is the classic signature of serialized-data corruption from a naive SQL search-and-replace during migration (e.g. swapping the old domain for the new one inside a dump that contains serialized PHP data). Search-replace changes string lengths without updating the serialized length prefixes, so PHP's unserialize()/maybe_unserialize() fails on that row; WordPress then reads (and sometimes resaves) the option as empty. This has nothing to do with packet size or row truncation, yet produces the exact same live-vs-backup diff. [community-knowledge]
- **fatal-contradiction** `c14` — counterexample: MySQL does not silently insert an empty/truncated row when a statement exceeds max_allowed_packet. The server returns ERROR 1153 (08S01) "Got a packet bigger than 'max_allowed_packet' bytes" (or the client raises ERROR 2006 "MySQL server has gone away"), and that INSERT/REPLACE statement fails outright. A single row is written atomically — there is no partial-write path that leaves a present-but-empty value; the outcome is either the full correct value or no row change at all, not blank data. This is the exact mechanism the worked example already rules out, and it is the load-bearing mechanism this reply's own diagnostic depends on. [primary-documentation]
- **invalidated-dependency** `c2` — rests on c1, which failed — invalid reasoning is not partially salvageable
- **invalidated-dependency** `c11` — rests on c7, which failed — invalid reasoning is not partially salvageable
- **invalidated-dependency** `c15` — rests on c8, which failed — invalid reasoning is not partially salvageable
- **invalidated-dependency** `c16` — rests on c8, which failed — invalid reasoning is not partially salvageable
- **falsifiable-claim-weak-evidence** `c4` — "Theme or plugin Custom CSS fields are typically stored as a single row in wp_options" asserts implementation-detail on community-knowledge — someone who knows the subject must confirm it, or it needs primary evidence
- **falsifiable-claim-weak-evidence** `c5` — "Custom CSS can alternatively be stored as a single postmeta row" asserts implementation-detail on community-knowledge — someone who knows the subject must confirm it, or it needs primary evidence
- **falsifiable-claim-weak-evidence** `c9` — "A restore tool may have its own chunking limit that can cause truncation" asserts implementation-detail on community-knowledge — someone who knows the subject must confirm it, or it needs primary evidence
- **overconfident-language** `c2` — asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence — "which is why a restore can wipe one and leave the other intact"
- **overconfident-language** `c11` — asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence — "while smaller settings restore fine"
- **overconfident-language** `c12` — asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence — "check whether that option is present-but-empty in the live DB versus present-and-full in t"
- **overconfident-language** `c13` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "If so, that's a truncation issue"
- **overconfident-language** `c14` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "not a deliberate wipe"
- **overconfident-language** `c16` — asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence — "so it doesn't happen again"
- **unrefuted-falsifiable-claim** `c4` — "Theme or plugin Custom CSS fields are typically stored as a single row in wp_options" asserts implementation-detail and was never successfully attacked — its provenance (community-knowledge) is self-declared and unchecked

## 3. Claims — 16

| id | claim | type | evidence | conf | rests on | contra |
|---|---|---|---|---|---|---|
| `c1` | Custom CSS and Additional CSS are stored in different locations in WordPress | implementation-detail | framework-documentation (authoritative) | high | — | **fatal** |
| `c2` ☠ | A restore operation can selectively wipe one storage location while leaving the other intact | observation | operator-experience (non-authoritative) | high | c1 | — |
| `c3` | Additional CSS uses its own dedicated entry in WordPress storage | implementation-detail | framework-documentation (authoritative) | high | — | 1 |
| `c4` | Theme or plugin Custom CSS fields are typically stored as a single row in wp_options | implementation-detail | community-knowledge (non-authoritative) | medium | — | — |
| `c5` | Custom CSS can alternatively be stored as a single postmeta row | implementation-detail | community-knowledge (non-authoritative) | medium | — | — |
| `c6` | The CSS value is serialized when stored in wp_options or postmeta | implementation-detail | framework-documentation (authoritative) | high | c4, c5 | **fatal** |
| `c7` | Large single-row values are the most likely to be silently truncated during a SQL import | inference | reasoned-inference (non-authoritative) | high | — | **fatal** |
| `c8` | Exceeding max_allowed_packet triggers the truncation condition | protocol-behaviour | primary-documentation (authoritative) | high | — | **fatal** |
| `c9` | A restore tool may have its own chunking limit that can cause truncation | implementation-detail | community-knowledge (non-authoritative) | medium | — | **fatal** |
| `c10` | When data exceeds size limits, the row inserts as empty or truncated instead of throwing an error | protocol-behaviour | observed-runtime-behaviour (authoritative) | medium | c8, c9 | **fatal** |
| `c11` ☠ | Smaller settings restore successfully when large ones are truncated | observation | operator-experience (non-authoritative) | high | c7 | — |
| `c12` | Inspect the live database to determine if the option is present-but-empty, then compare to the backup dump | recommendation | operator-experience (non-authoritative) | high | — | — |
| `c13` | If the option is present-but-empty in the live DB and present-and-full in the backup, this is a truncation issue | inference | reasoned-inference (non-authoritative) | high | c12, c7, c10 | **fatal** |
| `c14` | Truncation due to size limits is not a deliberate wipe by Updraft | inference | reasoned-inference (non-authoritative) | high | c13 | **fatal** |
| `c15` ☠ | Check your host's max_allowed_packet setting before the next restore | recommendation | operator-experience (non-authoritative) | high | c8, c13 | — |
| `c16` ☠ | Increasing max_allowed_packet will prevent future truncation on restore | recommendation | reasoned-inference (non-authoritative) | high | c8, c15 | — |

☠ = invalidated because something it rests on failed.

## 4. What this reply actually concludes

- `c2` A restore operation can selectively wipe one storage location while leaving the other intact — evidence: **operator-experience**, confidence **high**
- `c3` Additional CSS uses its own dedicated entry in WordPress storage — evidence: **framework-documentation**, confidence **high**
- `c6` The CSS value is serialized when stored in wp_options or postmeta — evidence: **framework-documentation**, confidence **high**
- `c11` Smaller settings restore successfully when large ones are truncated — evidence: **operator-experience**, confidence **high**
- `c14` Truncation due to size limits is not a deliberate wipe by Updraft — evidence: **reasoned-inference**, confidence **high**
- `c16` Increasing max_allowed_packet will prevent future truncation on restore — evidence: **reasoned-inference**, confidence **high**



## 5. Known uncertainties

_Every claim states a provenance._


### Language outrunning evidence

- `c2` asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence
  - > which is why a restore can wipe one and leave the other intact
- `c11` asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence
  - > while smaller settings restore fine
- `c12` asserted with high confidence, but operator-experience supports medium at best — hedge it or find primary evidence
  - > check whether that option is present-but-empty in the live DB versus present-and-full in the backup dump
- `c13` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > If so, that's a truncation issue
- `c14` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > not a deliberate wipe
- `c16` asserted with high confidence, but reasoned-inference supports medium at best — hedge it or find primary evidence
  - > so it doesn't happen again

## 6. Contradictions — 25 (11 fatal)

### `c1` — counterexample · **FATAL**

MySQL does not silently truncate an oversized row during SQL import — it raises an explicit error and the statement (often the whole import) aborts. mysqldump/mysql CLI restores hitting a value bigger than max_allowed_packet produce ERROR 1153 (08S01) 'Got a packet bigger than max_allowed_packet bytes' or ERROR 2006 'MySQL server has gone away'. The failing INSERT does not partially execute — the row is either entirely absent (fresh INSERT never lands) or (for UPDATE/REPLACE) retains its prior value. It never lands as a clean, present-but-empty row from truncation at the DB layer.

*Evidence:* primary-documentation — MySQL Reference Manual, Error 1153 (ER_NET_PACKET_TOO_LARGE) and Error 2006 (CR_SERVER_GONE_ERROR) — both are hard failures at statement/connection level, not silent content truncation.

### `c1` — alternative-explanation

Even granting some tool-level swallowing of that DB error (a GUI/migration tool catching the exception and moving on), the resulting artifact would not read as 'cleanly empty' — a truncated serialized PHP value fails unserialize() and WordPress's maybe_unserialize() returns the mangled/garbled raw string (or throws a logged unserialize() warning), not a blank value. A clean empty option is more consistent with the row being absent post-restore and then re-created with a default ('' ) by the plugin's own get_option()/add_option() fallback — a different failure path than 'SQL import truncated the bytes.'

*Evidence:* reasoned-inference — PHP unserialize() error-on-malformed-input behavior + WordPress core's maybe_unserialize()/is_serialized() handling in wp-includes/functions.php.

### `c1` — known-exception

Not all plugin 'Custom CSS' fields live somewhere different from Additional CSS. Jetpack's Custom CSS module originally stored CSS as its own custom post type ('safecss'), but after WordPress 4.7 introduced native Additional CSS, Jetpack deprecated its own storage and folds into the same custom_css post type core uses — i.e., for that (very common) plugin, 'Custom CSS' and 'Additional CSS' end up in the identical location, not a different one.

*Evidence:* community-knowledge — Jetpack Custom CSS module deprecation notice/migration to WP core's native Additional CSS (custom_css post type) since WP 4.7.

### `c3` — configuration-dependency

On block themes (theme.json / Full Site Editing, e.g. Twenty Twenty-Four+), 'Additional CSS' is not edited via the classic Customizer and is not stored in the dedicated `custom_css` post type at all. It lives in Site Editor > Styles > Additional CSS, which writes into the `css` key of a single JSON blob in the post_content of a `wp_global_styles` post — the same post also holds all other user style overrides (colors, typography, spacing). That is structurally identical to the 'single row holding one large serialized value' pattern the claim attributes only to the Custom CSS plugin case, not to Additional CSS.

*Evidence:* official-implementation — WordPress core Global Styles / Site Editor implementation (post type `wp_global_styles`, introduced with Full Site Editing in WP 5.9+ and now the default for block themes) vs. the classic Customizer `custom_css` post type used only on classic (non-block) themes.

### `c6` — counterexample · **FATAL**

WordPress does not serialize scalar values. `maybe_serialize()` (called internally by `update_option()`, `add_option()`, `update_post_meta()`, `add_post_meta()`) only runs `serialize()` when the value `is_array()` or `is_object()`; a plain CSS string is returned untouched. So a single-purpose option like `update_option('plugin_custom_css', $css_string)` or `update_post_meta($id, '_custom_css', $css_string)` stores raw, unserialized CSS text — not a serialized blob. Serialization only happens if the CSS is bundled as one element inside a larger settings array (e.g. Settings API options pages, Redux/ACF-style option blobs, `theme_mods_{theme}`), which is a common pattern but not the only one and not implied by 'a single row holding one large value.'

*Evidence:* source-code — wp-includes/functions.php, maybe_serialize(): `if ( is_array($data) \|\| is_object($data) ) { return serialize($data); } ... return $data;` — core WordPress behavior since early versions

### `c6` — known-exception · **FATAL**

Additional CSS (Appearance > Customize > Additional CSS), which the surrounding context explicitly discusses as 'its own dedicated entry,' is not stored in wp_options or wp_postmeta at all. Since WP 4.7 it is persisted as a custom post type (`custom_css`) with the CSS living in `wp_posts.post_content` (plain text, via `wp_update_custom_css_post()`), addressed by `post_name` like `{stylesheet}` and a `csslimit` meta only for byte-count bookkeeping — the CSS body itself is never in wp_options or postmeta.

*Evidence:* official-implementation — WordPress core, wp-includes/theme.php `wp_update_custom_css_post()` / `wp_get_custom_css()`, and the WP 4.7 'Customize CSS' feature merge (Trac #34713)

### `c7` — counterexample · **FATAL**

Exceeding max_allowed_packet does not silently truncate/empty a row — MySQL raises ERROR 1153 (08S01) "Got a packet bigger than 'max_allowed_packet' bytes" and aborts that statement. Default mysql CLI import also stops entirely on this error (no --force). The claimed mechanism (silent empty/truncated insert instead of an error) contradicts documented server behavior.

*Evidence:* primary-documentation — MySQL Server Error Reference, Error 1153 / packet-too-large behavior

### `c7` — known-exception · **FATAL**

The documented silent-truncation mechanism in MySQL (data truncated for a column with a warning, not an error) is driven by column width limits under non-strict SQL mode — not by row/value size. Large serialized blobs (e.g. WP CSS) are almost always stored in TEXT/LONGTEXT (up to 4GB), which essentially never hits a width limit, whereas small VARCHAR(n)-typed fields are the ones actually vulnerable to this silent-truncation path. This inverts the claim's ranking: width-constrained small columns, not large single-row values, are the more likely silent-truncation victims.

*Evidence:* primary-documentation — MySQL Reference Manual, 'Server SQL Modes' — strict vs. non-strict truncation-to-warning behavior for column data types

### `c7` — alternative-explanation

A present-but-empty WP option holding serialized data is commonly caused by transfer/encoding corruption (e.g. text-mode FTP altering line endings, charset mismatch) breaking PHP unserialize(), after which WordPress/plugins reset the option to empty on unserialize failure — no DB-level size truncation involved at all.

*Evidence:* community-knowledge — Widely documented WordPress serialized-data corruption pattern (FTP text-mode / encoding mismatch clobbering serialize() length prefixes)

### `c8` — counterexample · **FATAL**

MySQL does not silently truncate or insert an empty row when a statement exceeds max_allowed_packet. Server returns ERROR 1153 (08S01) 'Got a packet bigger than max_allowed_packet bytes', drops the connection/aborts that statement, and the mysql CLI import halts with that error (unless run with --force, in which case it skips the statement entirely rather than writing a truncated value).

*Evidence:* primary-documentation — MySQL Reference Manual, Server Error Reference: Error 1153 (ER_NET_PACKET_TOO_LARGE); max_allowed_packet system variable docs state exceeding it produces this error, not silent truncation.

### `c8` — alternative-explanation

A present-but-empty wp_options/postmeta row is classically caused by serialized-data corruption (e.g. a naive search-replace on a backup/migration that changes string lengths inside PHP serialized data, invalidating the s:N: length prefix), which makes WordPress fail to unserialize and treat the value as empty — independent of any packet-size limit.

*Evidence:* widely-accepted-practice — Well-documented WP migration pitfall: unserialize() returns false/empty on length-mismatched serialized strings after in-place search-replace; this is why tools like WP-CLI search-replace and Interconnect/it's Search Replace DB exist specifically to handle serialization-safe replacement.

### `c8` — configuration-dependency

Even when a size limit is the real cause, the 'inserts empty or truncated instead of throwing an error' behavior is tool-specific, not a MySQL protocol behavior: it requires a restore path that catches/ignores the driver error (e.g. some GUI import tools, custom PHP scripts using mysqli/PDO without checking query return values) — the underlying max_allowed_packet condition itself is always a hard error at the protocol level.

*Evidence:* reasoned-inference — mysqli/PDO both surface the 1153 error on the connection; silent swallowing only happens if calling code ignores exec()/query() return values or error state.

### `c9` — alternative-explanation

The textbook WordPress symptom of 'option present in the DB row but reads as empty/broken after a migration or restore' is not primarily attributed to a restore tool's chunking limit — it's the signature of serialized-data corruption from running search-and-replace (e.g. domain/URL swap) directly on a raw SQL dump. Every serialized PHP string is prefixed with its exact byte length (`s:1234:"...";`); if the string content changes length during a naive text substitution but the length prefix doesn't, `unserialize()` fails and PHP treats the option as empty even though the raw column still holds a full, non-truncated blob. This is the specific failure mode WP-CLI's `wp search-replace` and dedicated migration plugins were built to guard against, precisely because it's so common.

*Evidence:* widely-accepted-practice — Standard WP migration guidance ('never run search-and-replace on a raw SQL dump, only via serialization-aware tools') and the existence of `wp search-replace`'s serialization-safe replace mode as a direct response to this exact failure.

### `c9` — counterexample · **FATAL**

Known WP restore/import mechanisms that chunk large SQL files (WP-CLI's `wp db import`, phpMyAdmin's buffered import, UpdraftPlus, Duplicator, WP Migrate DB Pro) all chunk at the level of complete statements or batches, not mid-value bytes — because cutting a quoted string value in half leaves an unterminated string literal, which is a SQL syntax error that aborts/reports loudly. For a chunker to produce the described outcome ('row inserts empty or truncated instead of throwing an error'), it would have to deliberately detect the field boundary and re-close the quote/statement — that's a value-length cap by design, not an incidental 'chunking limit', and none of the common WP-ecosystem tools implement that.

*Evidence:* reasoned-inference — Documented chunking behavior of WP-CLI/phpMyAdmin/UpdraftPlus/Duplicator operates on statement/batch boundaries to preserve valid SQL, not on intra-value byte limits.

### `c9` — version-difference

Even the DB-level 'silent truncation instead of an error' behavior (inserting an oversized value into a length-bounded column with just a warning) only happens when the connection's sql_mode lacks STRICT_TRANS_TABLES/STRICT_ALL_TABLES. MySQL 5.7+ and MariaDB enable strict mode by default, which converts that case into a hard error (ERROR 1406 'Data too long for column'), not a silent partial insert. So the 'silent, no-error truncation' premise the claim leans on is itself a legacy/non-default-configuration scenario, not the norm on a modern DB server.

*Evidence:* primary-documentation — MySQL Reference Manual, Server SQL Modes — sql_mode default changed to include STRICT_TRANS_TABLES as of MySQL 5.7.

### `c10` — counterexample · **FATAL**

Exceeding max_allowed_packet does not make MySQL insert an empty/truncated row silently. Server returns ERROR 1153 (08S01) 'Got a packet bigger than max_allowed_packet bytes', the offending statement fails, and the connection is often dropped. mysql CLI import aborts at that statement (continues only past it if run with --force, in which case that row is simply never written — not written empty/truncated).

*Evidence:* primary-documentation — MySQL Reference Manual, Server Error Reference ER_NET_PACKET_TOO_LARGE / max_allowed_packet docs

### `c10` — configuration-dependency

Silent truncate-with-warning instead of error only happens for column-length overflow under non-strict sql_mode. Since MySQL 5.7.5 / modern MariaDB, STRICT_TRANS_TABLES is on by default, so 'Data too long for column' raises ER_DATA_TOO_LONG and the row fails instead of truncating. Also moot for wp_options: option_value is LONGTEXT (~4GB cap), so column-length is never the real ceiling for CSS text — max_allowed_packet is, and that path errors per above.

*Evidence:* primary-documentation — MySQL Reference Manual sql_mode / strict mode docs; WordPress core schema wp_options.option_value LONGTEXT

### `c10` — alternative-explanation

Present-in-dump-but-empty/broken-live is the signature symptom of WordPress serialized-data corruption from domain search-replace during migration, not packet truncation: PHP serialized strings carry explicit byte-length prefixes (s:1234:"..."), and any naive find/replace on the URL inside a serialized blob desyncs the length prefix, making unserialize() fail. WordPress/plugins reading a broken serialized option commonly render it as empty. This produces the exact same 'full in backup, empty live' signature with zero involvement of max_allowed_packet or import truncation.

*Evidence:* community-knowledge — Widely documented WP migration pitfall behind tools like WP-CLI 'search-replace' and Better Search Replace, which exist specifically to serialize-safely replace URLs instead of raw text substitution

### `c10` — counterexample

mysqldump defaults to --extended-insert, batching many rows per INSERT statement. If a batch fails on max_allowed_packet, the whole multi-row statement fails together — that can take out neighboring smaller-row inserts too, contradicting the framing that only the oversized CSS row would be affected while 'smaller settings restore fine.'

*Evidence:* official-implementation — mysqldump manual, --extended-insert (default: on) — groups multiple VALUES rows into one INSERT statement

### `c13` — counterexample · **FATAL**

MySQL does not silently write an empty/truncated row when a value exceeds max_allowed_packet. It raises ERROR 1153 (08S01) "Got a packet bigger than 'max_allowed_packet' bytes" and rejects that statement (often dropping the connection with "MySQL server has gone away"). Under a plain `mysql < dump.sql` import without --force, this aborts the restore at that line rather than inserting a blank value; under --force it skips the statement, leaving the option at whatever it was BEFORE the restore ran — not a fresh empty value caused by the restore.

*Evidence:* official-implementation — MySQL Server error reference, Error 1153 / SQLSTATE 08S01 (documented client/server packet-size rejection behavior)

### `c13` — alternative-explanation · **FATAL**

The identical symptom — option present-and-full in the backup, present-but-empty live — is the classic signature of serialized-data corruption from a naive SQL search-and-replace during migration (e.g. swapping the old domain for the new one inside a dump that contains serialized PHP data). Search-replace changes string lengths without updating the serialized length prefixes, so PHP's unserialize()/maybe_unserialize() fails on that row; WordPress then reads (and sometimes resaves) the option as empty. This has nothing to do with packet size or row truncation, yet produces the exact same live-vs-backup diff.

*Evidence:* community-knowledge — Well-documented WordPress migration gotcha — the entire reason tools like Interconnect/it's Search-Replace-DB and WP-CLI's `wp search-replace` exist instead of raw SQL replace

### `c13` — configuration-dependency

Even granting a 'truncate instead of error' pathway, that only happens when sql_mode is non-strict AND the destination column is too small for the value (MySQL then truncates to fit and emits a warning, not an error). wp_options.option_value and postmeta.meta_value are LONGTEXT (up to 4GB) in modern WordPress, so an undersized column is not the applicable failure mode here — this route requires a specific, non-default configuration, it isn't a general property of large-value imports.

*Evidence:* framework-documentation — MySQL Reference Manual, strict vs. non-strict SQL mode column-value truncation behavior; WordPress core wp_options/postmeta schema (option_value/meta_value defined LONGTEXT)

### `c14` — counterexample · **FATAL**

MySQL does not silently insert an empty/truncated row when a statement exceeds max_allowed_packet. The server returns ERROR 1153 (08S01) "Got a packet bigger than 'max_allowed_packet' bytes" (or the client raises ERROR 2006 "MySQL server has gone away"), and that INSERT/REPLACE statement fails outright. A single row is written atomically — there is no partial-write path that leaves a present-but-empty value; the outcome is either the full correct value or no row change at all, not blank data. This is the exact mechanism the worked example already rules out, and it is the load-bearing mechanism this reply's own diagnostic depends on.

*Evidence:* primary-documentation — MySQL Reference Manual, max_allowed_packet server variable + Error 1153 (08S01)

### `c14` — configuration-dependency

UpdraftPlus does not import raw mysqldump through the bare `mysql` client; its own PHP-based restore routine parses the dump line-by-line/query-by-query and has documented handling for oversized lines/queries, logging a warning when a line is skipped for being too long. That makes an oversized-row failure visible in Updraft's own restore log, not 'silent' — so the claim's framing (silent truncation, undetectable except by comparing DB vs dump and checking host max_allowed_packet) misidentifies where the evidence actually lives.

*Evidence:* official-implementation — UpdraftPlus database restore code path / support documentation on oversized-line handling during restore

### `c14` — alternative-explanation

The far more common cause of a WordPress option being 'present-and-full in the backup dump but present-and-empty live' is not packet-size truncation but serialized-data corruption from the migration's search-and-replace step: replacing domain/path strings inside a serialized PHP value changes its byte length without updating the `s:N:"..."` length prefix, so unserialize() silently fails and get_option() returns false/empty — while the raw row may still be non-empty, just corrupted. This produces an identical symptom to the one the claim uses as its confirmation test, so 'backup full / live empty' does not discriminate between packet truncation and search-replace corruption; the proposed test under-determines the cause.

*Evidence:* community-knowledge — Well-documented WordPress migration failure mode: URL search-replace breaking serialized option/postmeta strings (the reason tools like WP Migrate DB / UpdraftPlus Migrator implement serialization-aware search-replace instead of naive string replace)

---

## 7. The draft, last

> Custom CSS and Additional CSS often aren't stored the same way, which is why a restore can wipe one and leave the other intact. Additional CSS (Appearance > Customize) is its own dedicated entry. A theme/plugin's "Site Settings > Custom CSS" field is usually a single row in wp_options (or a single postmeta row) holding one large serialized value.
> 
> Big single-row values like that are the ones most likely to get silently truncated during a SQL import if it hits a size limit (the DB server's max_allowed_packet, or a chunking limit in whatever tool did the restore) - the row inserts empty or truncated instead of throwing an error, while smaller settings restore fine.
> 
> Since you already extracted the CSS from the backup dump, you can confirm this: check whether that option is present-but-empty in the live DB versus present-and-full in the backup dump. If so, that's a truncation issue, not a deliberate wipe, and it's worth checking your host's max_allowed_packet setting before your next restore so it doesn't happen again.

---

### What is still yours to decide

Argus checks that claims are *supported*. It cannot check that they are *true*, and it has no
opinion on whether this reply is worth posting. Those remain human judgements:

- Is the evidence cited actually what it claims to be?
- Does this answer what was asked?
- Would you put your name on it?
