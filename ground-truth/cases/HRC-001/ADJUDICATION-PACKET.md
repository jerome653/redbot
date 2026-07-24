# HRC-001 — adjudication packet

**9 claims awaiting a decision.** 3 of 12 already ruled.

Thread: r/Wordpress — Custom CSS missing after Updraft restore
Human verdict on the draft as a whole: **incorrect** (jerome, 2026-07-23)

## How to use this

For each claim below, record **TRUE**, **FALSE** or **UNKNOWN**, and the evidence you used.

- **UNKNOWN is a real answer.** It is recorded as `unverifiable` and is not a gap to be filled later.
- Every ruling needs the source you relied on, so the corpus stays externally checkable.
- Nothing below suggests an answer. The contradictions are reproduced because you should see
  what the machine argued, **not** because they are evidence — none of them has been checked
  against its cited source.

> ⚠ This record predates EB-40, so the set of completed refutations is not stored.
> "refutation completed" below is inferred from which claims received a contradiction and
> cannot distinguish a refutation that ran and found nothing from one that failed.

## Sources already on record for this case

Attached during earlier review. Listed here because some open claims may touch them. **No
mapping from source to claim is implied.**

- **official-documentation** — Exceeding max_allowed_packet raises ERROR 1153 (08S01) and terminates the connection; it does not silently insert an empty or truncated row
  <br>MySQL 8.4 Reference Manual, "Packet Too Large": "When a MySQL client or the mysqld server receives a packet bigger than max_allowed_packet bytes, it issues an ER_NET_PACKET_TOO_LARGE error and closes the connection." MySQL 8.0 Server Error Reference: error 1153, SQLSTATE 08S01, ER_NET_PACKET_TOO_LARGE, "Got a packet bigger than 'max_allowed_packet' bytes".
  <br><https://dev.mysql.com/doc/refman/8.4/en/packet-too-large.html>

- **source-code** — wp_options.option_value is LONGTEXT, so column-width truncation cannot explain a blanked Custom CSS value
  <br>WordPress core schema, wp-admin/includes/schema.php (trunk): "CREATE TABLE $wpdb->options ( option_id bigint(20) unsigned NOT NULL auto_increment, option_name varchar(191) NOT NULL default '', option_value longtext NOT NULL, autoload varchar(20) NOT NULL default 'yes', ... )"
  <br><https://raw.githubusercontent.com/WordPress/wordpress-develop/trunk/src/wp-admin/includes/schema.php>

- **primary-observation** — The thread was already resolved by the asker before the draft was written
  <br>the thread itself, stored in data/threads.json

## Already ruled

| claim | ruling | expected provenance |
|---|---|---|
| c5 | **false** | `reasoned-inference` |
| c6 | **false** | `reasoned-inference` |
| c7 | **false** | `reasoned-inference` |

---

## Claims awaiting a decision

### c1

> Custom CSS and Additional CSS are stored using different methods in WordPress

| | |
|---|---|
| machine-assigned type | `observation` |
| machine-assigned provenance | `framework-documentation` |
| machine-assigned confidence | `high` |
| stated support | WordPress documentation and code show separate storage locations: Customizer Additional CSS versus theme/plugin custom CSS settings |
| rests on | — |
| refutation completed | no — never attacked |
| language outruns evidence | not flagged |

_No contradiction was raised against this claim._

**DECISION:** `TRUE` / `FALSE` / `UNKNOWN` — 

**EVIDENCE:** 

**EXPECTED PROVENANCE** (what class the evidence actually warrants): 

---

### c2

> Because they are stored in different locations, a restore can delete Custom CSS while preserving Additional CSS

| | |
|---|---|
| machine-assigned type | `inference` |
| machine-assigned provenance | `reasoned-inference` |
| machine-assigned confidence | `medium` |
| stated support | If two settings exist in separate database locations, a restore targeting one location would not affect the other |
| rests on | `c1` (not yet ruled) |
| refutation completed | no — never attacked |
| language outruns evidence | not flagged |

_No contradiction was raised against this claim._

**DECISION:** `TRUE` / `FALSE` / `UNKNOWN` — 

**EVIDENCE:** 

**EXPECTED PROVENANCE** (what class the evidence actually warrants): 

---

### c3

> Additional CSS from Appearance > Customize is stored as a dedicated single database entry

| | |
|---|---|
| machine-assigned type | `implementation-detail` |
| machine-assigned provenance | `framework-documentation` |
| machine-assigned confidence | `high` |
| stated support | WordPress Customizer stores Additional CSS as a distinct setting entry |
| rests on | — |
| refutation completed | no — never attacked |
| language outruns evidence | not flagged |

_No contradiction was raised against this claim._

**DECISION:** `TRUE` / `FALSE` / `UNKNOWN` — 

**EVIDENCE:** 

**EXPECTED PROVENANCE** (what class the evidence actually warrants): 

---

### c4

> Custom CSS from theme/plugin settings is typically stored as a single row in wp_options or postmeta containing a large serialized value

| | |
|---|---|
| machine-assigned type | `implementation-detail` |
| machine-assigned provenance | `framework-documentation` |
| machine-assigned confidence | `high` |
| stated support | Standard WordPress and theme/plugin patterns store custom CSS as a single serialized option or post meta row |
| rests on | — |
| refutation completed | yes |
| language outruns evidence | not flagged |

<details><summary>4 contradiction(s) raised — unverified model output</summary>

- `configuration-dependency` · cites `source-code` — WordPress only PHP-serializes option/meta values that are arrays or objects — core's maybe_serialize() (wp-includes/functions.php) checks is_array()/is_object() and passes scalars through untouched. A minimal 'Custom CSS' textarea field implemented as update_option('theme_custom_css', $css_string) or update_post_meta($id, '_custom_css', $css_string) — arguably the simplest and most common way to code a single-purpose CSS field, as seen in plugins like 'Simple Custom CSS' — stores plain unserialized text, not 'a large serialized value.' Whether serialization occurs depends entirely on whether the developer wrapped the CSS in an array (e.g. a Redux Framework/Divi-style options bundle) or stored it as a bare scalar.
- `version-difference` · cites `community-knowledge` — Post-Gutenberg/REST-API-era plugins and page builders commonly store settings as JSON text via wp_json_encode() rather than native PHP serialize(). Elementor, for example, stores its per-page/per-element settings (including the Custom CSS field in Elementor Pro) in postmeta such as _elementor_data and _elementor_page_settings as JSON strings, and the cached compiled CSS in _elementor_css is likewise a JSON-encoded structure, not a PHP-serialized one.
- `edge-case` · cites `observed-runtime-behaviour` — For visual builders and CSS-heavy plugins (Elementor, Beaver Builder, Divi, WP Rocket critical CSS), the bulk compiled CSS is typically written out to static .css files under wp-content/uploads/... on disk, with only a hash/timestamp left in the DB row. This is exactly why Elementor ships a 'Regenerate CSS' tool. For these tools the actual large CSS payload often isn't sitting in a single wp_options/postmeta row at all — a SQL-only dump/restore wouldn't even carry it.
- `known-exception` · cites `community-knowledge` — Some widely-installed plugins offering a dedicated 'Custom CSS' feature don't use wp_options or postmeta at all. The 'Custom CSS and JS' plugin (300k+ active installs) registers a custom post type (custom-css-js) and stores each CSS snippet as post_content of its own post in wp_posts, not as a single options/postmeta row.

</details>

**DECISION:** `TRUE` / `FALSE` / `UNKNOWN` — 

**EVIDENCE:** 

**EXPECTED PROVENANCE** (what class the evidence actually warrants): 

---

### c6b

> Restore tools may have internal chunking limits that cause truncation during import independently of max_allowed_packet

| | |
|---|---|
| machine-assigned type | `inference` |
| machine-assigned provenance | `reasoned-inference` |
| machine-assigned confidence | `medium` |
| stated support | Backup/restore tools commonly implement chunking for memory efficiency; these can be independent of MySQL limits |
| rests on | — |
| refutation completed | yes |
| language outruns evidence | not flagged |

<details><summary>4 contradiction(s) raised — unverified model output</summary>

- **[marked fatal]** `counterexample` · cites `official-implementation` — Tools that internally chunk/batch large imports (phpMyAdmin, Adminer, WP-CLI `wp db import`) don't reimplement the MySQL wire protocol themselves — they hand each statement to mysqli/PDO_MySQL, which enforces max_allowed_packet directly and raises a fatal, visible error (e.g. mysqli 'Packet too large' / PDOException, or CLI 'MySQL server has gone away') the moment a statement exceeds it. So any tool-level chunking limit is not independent of max_allowed_packet — it's the same wall, surfaced through the same client library, with the same fail-loud behavior, not a silent truncate-to-empty path.
- **[marked fatal]** `edge-case` · cites `reasoned-inference` — Chunking as actually implemented by dump/restore tooling (mysqldump extended-insert batching, GUI import batch-size settings) works by splitting many separate complete rows into multiple INSERT statements — it cannot slice a single field's value mid-string within one row, because an unterminated quoted string is a SQL syntax error, not a valid empty value. For the scenario at hand (one oversized serialized value in one row), no row-batching chunk strategy is even mechanically capable of producing a clean present-but-empty result — it would either include the whole value or fail the statement outright.
- `alternative-explanation` · cites `community-knowledge` — A present-but-empty option row is at least as well explained by ordinary WordPress/plugin behavior — many themes/plugins call add_option()/update_option() with an empty default during activation, upgrade routines, or a settings-repair pass — as by any import-time truncation. This alternative produces the identical symptom (present, empty) without any chunking or packet-size event occurring at all, so the proposed present-vs-empty test doesn't actually discriminate between the two causes.
- `configuration-dependency` · cites `language-specification` — If the Custom CSS field is stored as PHP-serialized data (vs. the reply's assumption it's a raw text blob), genuine mid-value truncation would break the length-prefixed serialization format, causing unserialize() to fail/warn or return false rather than yield a clean empty string — so the 'silent empty' signature described only lines up with truncation if the value is stored unserialized to begin with.

</details>

**DECISION:** `TRUE` / `FALSE` / `UNKNOWN` — 

**EVIDENCE:** 

**EXPECTED PROVENANCE** (what class the evidence actually warrants): 

---

### c8

> Database values smaller than the size limit restore successfully during import

| | |
|---|---|
| machine-assigned type | `observation` |
| machine-assigned provenance | `operator-experience` |
| machine-assigned confidence | `medium` |
| stated support | Observed in practice: settings under the truncation threshold complete without data loss |
| rests on | — |
| refutation completed | yes |
| language outruns evidence | not flagged |

<details><summary>4 contradiction(s) raised — unverified model output</summary>

- **[marked fatal]** `counterexample` · cites `official-implementation` — Default `mysql` CLI (and most WP restore paths that pipe a dump into it) aborts the entire import on the first SQL error unless `--force`/`-f` is passed. If the oversized-value statement throws (e.g. ERROR 1153, packet too big), every statement after it in the script — including ones holding values well under the size limit — never executes. So 'smaller values restore successfully' is false whenever those rows appear after the failure point, which is the common/default configuration, not an obscure edge case.
- **[marked fatal]** `counterexample` · cites `official-implementation` — mysqldump's default `--extended-insert` bundles many rows into one multi-row INSERT statement, sized against net_buffer_length/max_allowed_packet as a whole packet, not per value. A small value can be batched in the same INSERT as one oversized value; if that packet is rejected, the entire batch fails as a unit, including the small row. Per-row size under the limit is therefore not sufficient for that row to restore.
- `configuration-dependency` · cites `primary-documentation` — Whether an oversized value causes a hard error or a silent truncation depends on sql_mode, not on max_allowed_packet. Under non-strict mode, MySQL truncates any value exceeding its destination COLUMN's declared width and only emits a warning — so a value can sit well below the packet limit and still be silently truncated, for a completely different 'size limit' than the one the claim assumes.
- `alternative-explanation` · cites `community-knowledge` — Web-based import tools (e.g. phpMyAdmin) impose upload/execution-time limits and process large SQL files in chunks; a timeout or chunk cutoff can leave later statements unexecuted regardless of each value's individual size. This produces the same 'smaller entries survive, later/larger ones don't' pattern without any packet-size mechanism at all.

</details>

**DECISION:** `TRUE` / `FALSE` / `UNKNOWN` — 

**EVIDENCE:** 

**EXPECTED PROVENANCE** (what class the evidence actually warrants): 

---

### c9

> You can reveal truncation by comparing whether an option is empty in the live database but full in the backup

| | |
|---|---|
| machine-assigned type | `recommendation` |
| machine-assigned provenance | `reasoned-inference` |
| machine-assigned confidence | `high` |
| stated support | Diagnostic method: data present in source but absent/empty in target indicates data loss during import |
| rests on | `c5` (ruled **false**), `c7` (ruled **false**) |
| refutation completed | yes |
| language outruns evidence | flagged |

<details><summary>3 contradiction(s) raised — unverified model output</summary>

- **[marked fatal]** `counterexample` · cites `official-implementation` — The claim's own premise is that packet-limit truncation is what produces a present-but-empty row. But that mechanism doesn't behave that way: when a single INSERT (or extended-insert row) exceeds max_allowed_packet, MySQL rejects the packet atomically and raises ERROR 1153, aborting that statement rather than inserting a blank/truncated value. There is no MySQL code path where an oversized row 'inserts empty instead of throwing an error' — that's the same mechanism already shown false in the worked example. So finding the option empty-in-live/full-in-backup cannot be read as confirmation of packet-size truncation, because that specific cause doesn't produce that specific symptom.
- **[marked fatal]** `alternative-explanation` · cites `community-knowledge` — A present-but-empty wp_options row is the expected fingerprint of several unrelated, well-documented WordPress failure modes: (1) search-replace migration tools (Better Search Replace, WP Migrate DB, Interconnect/it) corrupting the byte-length prefixes of serialized strings when rewriting URLs inside them, which makes is_serialized()/unserialize() fail and the option read back as false/empty; (2) the setting being explicitly reset (theme switch, Customizer save, plugin reactivation writing its default); (3) a persistent object cache (Redis/Memcached) serving a stale empty value for get_option() while the raw DB row is actually intact. None of these involve SQL-import packet truncation at all, yet all produce exactly the 'empty-live, full-backup' pattern the claim treats as diagnostic of it.
- `edge-case` · cites `source-code` — Even granting a truncation mechanism, WordPress's own unserialize path (maybe_unserialize/is_serialized in wp-includes/functions.php) means a mid-value truncation of a serialized string typically fails the serialized-format check and is returned as-is (a partial, garbled string) or as boolean false — not as a clean empty string. Genuine truncation therefore tends to leave a corrupted/partial value, not a tidy empty option, so the binary 'empty vs full' test the claim proposes is more likely to flag deliberate wipes/resets than actual truncation, inverting the conclusion it's used to support.

</details>

**DECISION:** `TRUE` / `FALSE` / `UNKNOWN` — 

**EVIDENCE:** 

**EXPECTED PROVENANCE** (what class the evidence actually warrants): 

---

### c10

> If an option is empty in the live database but full in the backup, this indicates silent truncation rather than deliberate deletion

| | |
|---|---|
| machine-assigned type | `inference` |
| machine-assigned provenance | `reasoned-inference` |
| machine-assigned confidence | `medium` |
| stated support | Truncation during import (data loss in target) differs from deliberate deletion (data absent from source) |
| rests on | `c5` (ruled **false**), `c7` (ruled **false**), `c9` (not yet ruled) |
| refutation completed | yes |
| language outruns evidence | not flagged |

<details><summary>3 contradiction(s) raised — unverified model output</summary>

- **[marked fatal]** `alternative-explanation` · cites `reasoned-inference` — Empty-live/full-backup is not diagnostic of truncation: deliberate deletion (user clears Additional CSS in Customizer, plugin reset, theme switch clearing custom_css post_content) produces the exact same signature — value present-and-blank live, full in the pre-deletion backup. The observation is consistent with both hypotheses, so it cannot be used to conclude truncation 'rather than' deletion.
- **[marked fatal]** `configuration-dependency` · cites `official-implementation` — WordPress Additional CSS is looked up via wp_get_custom_css_post()/wp_get_custom_css(), keyed by a post_name derived from the active theme's stylesheet slug — not by a fixed row ID. If live and backup environments differ in active theme slug (rename, theme switch, staging vs prod folder name), the lookup misses the row entirely and reports empty CSS even though the row is fully intact and full in the live DB. Same symptom, zero truncation and zero deletion.
- **[marked fatal]** `known-exception` · cites `primary-documentation` — The proposed mechanism doesn't produce the pattern claimed to diagnose it. Exceeding max_allowed_packet aborts the INSERT with MySQL error 1153 — it does not commit a blank/truncated row. A packet-limit failure typically leaves the option row missing altogether, not 'present but empty.' Finding a present-and-empty row is therefore weak evidence against this truncation mechanism, not for it.

</details>

**DECISION:** `TRUE` / `FALSE` / `UNKNOWN` — 

**EVIDENCE:** 

**EXPECTED PROVENANCE** (what class the evidence actually warrants): 

---

### c11

> Checking and raising the host's max_allowed_packet setting before the next restore will prevent truncation

| | |
|---|---|
| machine-assigned type | `recommendation` |
| machine-assigned provenance | `reasoned-inference` |
| machine-assigned confidence | `high` |
| stated support | If max_allowed_packet is the limiting factor, increasing it allows larger values to import without truncation |
| rests on | `c5` (ruled **false**), `c6` (ruled **false**) |
| refutation completed | yes |
| language outruns evidence | not flagged |

<details><summary>5 contradiction(s) raised — unverified model output</summary>

- **[marked fatal]** `counterexample` · cites `primary-documentation` — MySQL's actual max_allowed_packet failure is a hard abort — ERROR 1153 'Got a packet bigger than max_allowed_packet bytes' — which stops the import at that statement. It does not silently insert an empty or truncated row. If the observed symptom really is a present-but-empty/truncated row with no error, that symptom doesn't match max_allowed_packet behavior, so raising the setting is aimed at the wrong mechanism.
- **[marked fatal]** `known-exception` · cites `primary-documentation` — The classic cause of silent (no-error) truncation in MySQL is non-strict SQL mode inserting a string longer than a column's max length (e.g. a TEXT/VARCHAR cap) — this produces only a truncation warning, not an abort, and has nothing to do with max_allowed_packet. That mechanism matches the described 'empty/truncated instead of erroring' symptom far better than a packet-size limit does, and raising max_allowed_packet does nothing for it.
- **[marked fatal]** `configuration-dependency` · cites `widely-accepted-practice` — max_allowed_packet exists independently on client and server, and many restore paths (phpMyAdmin, wp-cli db import, hosting-panel import GUIs) enforce their own packet/chunk-size ceiling separate from the MySQL server global variable — the very 'chunking limit in whatever tool did the restore' the surrounding text already names as an alternate cause. Raising only the server-side setting leaves that tool-level ceiling untouched, so the fix can be a no-op for tool-driven restores.
- **[marked fatal]** `alternative-explanation` · cites `reasoned-inference` — If the truncation already happened when the backup was created (e.g. mysqldump run with a low client-side --max_allowed_packet, or exported from a source server with a lower limit), the dump file itself already contains the truncated value. Restoring that same file to a host with a newly-raised max_allowed_packet just reproduces the truncated data — the fix has to happen at export time, not at the next import.
- `configuration-dependency` · cites `community-knowledge` — On many managed/shared hosting plans, max_allowed_packet is not user-changeable (fixed by the host, or requires a support ticket / parameter-group change on managed DBaaS), so 'checking and raising' it may not be actionable at all before the next restore.

</details>

**DECISION:** `TRUE` / `FALSE` / `UNKNOWN` — 

**EVIDENCE:** 

**EXPECTED PROVENANCE** (what class the evidence actually warrants): 

---

## When every claim is ruled

Transfer the rulings into the `SPEC` block in `ground-truth/build-corpus.mjs`, then run:

```
node ground-truth/validate.mjs --fix
node qa/benchmark/run.mjs
```

`validate.mjs` promotes a case to **calibration: approved** only when all 12 claims
carry a ruling with an expected provenance. That promotion is the phase's success condition.
