# Publication audit

**Date:** 2026-07-23
**Audited:** `D:/AI/argus` — the publication candidate, 63 tracked files, 3 commits, no remote
**Method:** `git grep` over tracked content only, plus manifest cross-check
**Files modified by this audit: 0** — this is a report

---

## Which repository actually becomes public

This matters before any finding below means anything.

| | Repository | Fate |
|---|---|---|
| **Publication candidate** | `D:/AI/argus` — 63 files, 3 commits (`3aa8429` → `fc7ee64`), **no remote configured** | becomes `github.com/jerome653/redbot` |
| **Parent project** | `D:/AI/Clients/SGEN/Projects/redbot` — 76 markdown files, full CLI, operator console | **stays private**, untracked by design |

Everything below concerns **argus**. The parent is addressed under KEEP PRIVATE.

---

## Summary

| Verdict | Count |
|---|---|
| SAFE | 8 classes, no action |
| REMOVE | 0 files |
| REWRITE | 6 items |
| KEEP PRIVATE | 4 classes |
| DECISION REQUIRED | 2 items |

**Nothing found is a credential, a secret, or a live session artefact.** The `.gitignore` was written
before any source file precisely to prevent that class, and it holds.

---

## SAFE — verified clean, no action

| Class | Evidence |
|---|---|
| **Machine paths** | `D:\`, `D:/`, `C:\`, `C:/`, `Users`, `AppData` — **0 hits** in tracked content |
| **Windows usernames** | `DESKTOP-EA0N9F1` — **0 hits** |
| **Third-party identities** | `u/` handles — **0 hits**. Corpus threads carry `thread_id`, `subreddit`, `permalink`, `title`, `body`, `comment_count`, `resolved` and **no author field** |
| **Code hygiene** | `TODO` 0 · `FIXME` 0 · `XXX` 0 · `HACK` 0 · `@ts-ignore` 0 · `eslint-disable` 0 |
| **Secrets in env use** | all 8 `process.env` reads are named config (`REDBOT_LLM`, `REDBOT_OPERATOR`, `ANTHROPIC_API_KEY` read, never written or logged) |
| **localhost assumptions** | `localhost` 0 · `127.0.0.1` 0 · `9222` 0 — the extracted engine has no browser coupling |
| **"staging" hits (5)** | **false positive.** All five are the phrase *"staging vs prod folder name"* inside WordPress technical content in the corpus. No staging URL exists |
| **Test fixture URLs** | `https://example.com/`, `https://example.invalid/t` — reserved-for-documentation domains, intentional |

### `.gitignore` — reviewed, and it is the strongest artefact in the repository

It ignores `data/*` (not `data/`, so `.gitkeep` survives — the negation bug was found and fixed),
`**/chrome-profile*/`, `**/Cookies`, `**/Login Data`, `**/Local Storage/`, `**/operators/`, `.env*`,
`*.pem/key/p12/pfx`, `*.jsonl`, `reports/*`, and **all image formats except `docs/` and `examples/`**
on the reasoning that *"a screenshot of an authenticated page is a credential leak with a filename."*

Its header documents DEFECT-01: without it, `git add -A` would have committed 4.6 GB of Chrome
profile including live session cookies for two accounts.

---

## REWRITE — 6 items

### R-1 · Employer name in the ground-truth schema `$id` — **blocking**

```
ground-truth/schema.json:3   "$id": "https://sgen.local/agtc/case.schema.json"
```

An internal hostname in a public schema identifier. Should become a neutral or GitHub-based `$id`.

**Conflict:** `ground-truth/schema.json` is **VERBATIM** in `docs/EXTRACTION-MANIFEST.json`. Editing
it changes its SHA-256, and `node tools/verify-extraction.mjs` will report **DIVERGED** on a fresh
clone. See *The scrub-versus-verify conflict* below.

### R-2 · Employer repository name and commit hash in extraction provenance — **blocking**

```
docs/EXTRACTION-MANIFEST.json:8   "sgen_repo_head": "2b91670b2"
docs/EXTRACTION-MANIFEST.json:9   "sgen_repo_head_note": "Context only. The SGEN repository does not contain redbot."
docs/EXTRACTION-BASELINE.md:16    | SGEN repository HEAD | `2b91670b2` … |
docs/EXTRACTION-BASELINE.md:24    redbot is **untracked by design**. `git status` in the SGEN repository reports
```

This publishes the employer's name **and a commit hash from a private repository**. The hash reveals
nothing on its own, but it is a private-repo identifier with no public purpose.

**No conflict.** `EXTRACTION-MANIFEST.json` is not itself listed in the manifest, and
`verify-extraction.mjs` reads only `manifest.files[]` and `manifest.provenance.redbot_commit` —
verified by reading the tool. `sgen_repo_head` can be removed or renamed without breaking
verification.

### R-3 · Employer name in frozen engine source

```
src/backup.ts:31   *   does not delete the backups. A sibling directory would also be inside the SGEN repo, where
```

**Conflict:** `src/backup.ts` is **VERBATIM** in the manifest. Same problem as R-1.

### R-4 · Operational detail in frozen engine source

```
src/backup.ts:47   *   - the chrome-profile directories: live Reddit session cookies for two accounts (DEFECT-01)
```

Discloses that the operator runs **two Reddit accounts**. Not a credential, but an operational fact
that a reader could weigh against the project's own stance on multi-account use. Low severity;
same manifest conflict as R-3.

### R-5 · `package.json` is not publication-shaped

```json
"name": "argus",          // public project name is "redbot"
"private": true,          // correct if not publishing to npm — confirm the intent
                          // missing: license, repository, author, bugs, homepage
```

`"name"` disagreeing with the public repository name is the kind of thing that confuses every
downstream tool. `license` must match whatever LICENSE becomes.

### R-6 · CHANGELOG is stale and states a test count that is not argus's

```
CHANGELOG.md   "### Added — Repository scaffold (c1) …"
CHANGELOG.md   "the certification engine … arrive in c2–c3"   ← c2 and c3 are already committed
CHANGELOG.md   "The frozen baseline at time of extraction: 182/182 tests"
```

**182/182 is a redbot fact.** Argus's own suite is **37/37**. The sentence is technically true — it
describes the source baseline — but a reader will take it as this repository's number. It needs to
say both, explicitly.

---

## REMOVE — 0 files

Nothing in the tracked tree needs deleting. Four broken links need repair, which is a documentation
matter — see `DOCUMENTATION-AUDIT.md` §argus.

---

## KEEP PRIVATE — do not migrate into the public repository

| Item | Why |
|---|---|
| **The whole redbot parent project** | Contains the Reddit adapter, browser attachment, publishing path, operator identity and full operational history. Untracked by design; keep it that way |
| **`data/`** in any form | evidence and credentials share the tree. Already ignored |
| **`reports/`** generated output | regenerated from data; committing it makes generated files look authoritative. Already ignored |
| **`tools/operator/`** — the console | Currently redbot-only. It reads `data/`, `reports/` and the CLI, none of which exist in a clean argus clone. **Do not port it as-is** |

---

## DECISION REQUIRED — 2 items, both yours

### D-1 · The reviewer name `jerome` — 7 occurrences

```
ground-truth/build-corpus.mjs:45              reviewer: 'jerome'
ground-truth/cases/HRC-001/case.json:27       "reviewer": "jerome"
ground-truth/cases/HRC-001/ADJUDICATION-PACKET.md:6   (jerome, 2026-07-23)
qa/benchmark/cases/HRC-001{,-A,-B}.json       "verdict_author": "jerome"
qa/benchmark/make-cases.mjs:61                verdict_author: 'jerome'
```

**Recommendation: keep it.** This is attribution of a human judgement in a scientific corpus, and
provenance is the point — an anonymous ground-truth label is weaker evidence than a named one. The
repository owner is `jerome653`, so the first name is already public via ownership. Removing it
would cost provenance and buy no privacy.

**Counter-consideration:** `reviewer: 'jerome'` is hardcoded in `build-corpus.mjs`, so a second
adjudicator's rulings would be mislabelled. That is a correctness issue, not a privacy one, and it
argues for making the field a parameter — after the freeze lifts.

### D-2 · Third-party Reddit content

Two real threads are reproduced: 431 and 569 characters of post body, with live permalinks to
`r/Wordpress`. No usernames.

This is short-excerpt use of user-generated content for research, attributed by permalink — a
defensible position, and the absence of author names already limits exposure. It is still
redistribution of someone else's words under whatever licence the eventual LICENSE grants.

**Recommendation:** keep, and state the practice explicitly in the README — what is quoted, why, how
much, and that removal on request is honoured.

---

## The scrub-versus-verify conflict — read this before scrubbing anything

Three commitments collide:

1. The engine is **frozen** — `src/` is not edited.
2. The extraction manifest proves the engine is **byte-identical** to its source.
3. Publication requires **removing employer references**, two of which live in frozen files
   (R-1 `ground-truth/schema.json`, R-3/R-4 `src/backup.ts`).

Any edit to a VERBATIM file makes `verify-extraction.mjs` report **DIVERGED on a clean clone of an
untouched repository** — the exact failure mode `.gitattributes` was reversed to prevent. Doing it
quietly would make the repository's headline integrity claim false on day one.

**Three honest options:**

| | Approach | Cost |
|---|---|---|
| **A** | Scrub in **redbot first**, then re-extract and regenerate the manifest | Correct and clean. Requires briefly lifting the freeze on two files, as a declared change |
| **B** | Scrub in argus, regenerate the manifest, record the deviation in `EXTRACTION-BASELINE.md` | Faster. Weakens the "verbatim" claim to "verbatim except two scrubbed comments" — which must then be stated everywhere the claim appears |
| **C** | Publish R-3 and R-4 unscrubbed | Zero integrity cost. Publishes the employer name in a source comment and the two-account detail |

**Recommendation: A.** The byte-identity claim is one of the few things this project can actually
prove, and it should not be spent on two code comments. R-2 (the manifest provenance) can be scrubbed
immediately under any option, because it breaks nothing.

---

## What was searched

`jerome` · `JerOme` · `DESKTOP-EA0N9F1` · `sgen` · `SGEN` · `Clients` · `D:\` · `D:/` · `C:\` · `C:/` ·
`Users` · `AppData` · `localhost` · `127.0.0.1` · `9222` · `staging` · `reddit.com` · `chrome-profile` ·
`http://` · `https://` · `TODO` · `FIXME` · `XXX` · `HACK` · `@ts-ignore` · `eslint-disable` ·
`console.log` · `process.env` · `u/<handle>` · every external URL, deduplicated.

Scope was `git grep` — **tracked content only**. Untracked working-tree files cannot reach the remote
and were excluded deliberately; `git status` reports the tree clean.
