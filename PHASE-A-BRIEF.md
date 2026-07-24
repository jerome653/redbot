# Phase A — first live reply: decision brief

**Prepared:** 2026-07-23 · **Account:** `docs-architect` (karma **1**, measured today)

> ## ⛔ SUPERSEDED — DO NOT PUBLISH THIS DRAFT
>
> Human Representation Certification **rejected** it on 2026-07-23:
> [`reports/HRC-001-custom-css-updraft.md`](reports/HRC-001-custom-css-updraft.md).
>
> **Two fatal findings:**
> 1. The central technical claim is false. The draft says an oversized row "inserts empty or
>    truncated instead of throwing an error" — MySQL raises `ERROR 1153 (08S01)` and aborts the
>    import at that line.
> 2. The thread was already resolved. The asker's post carries an `UPDATE:` confirming they
>    recovered the CSS, and two commenters' fixes are confirmed working.
>
> The gate analysis below was accurate about everything it could measure, and every gate passed.
> That is exactly the point: the gates measure proxies for quality, not truth.
>
> **Action:** reject at the prompt so the reason enters the review dataset —
> `node dist/cli.js reply d_f11d8de68709_mrwj1koh` then press `r`, reason `inaccurate`.
>
> The rest of this brief is retained unedited as the record of what was staged and why.

---

## The command

    cd D:\AI\Clients\SGEN\Projects\redbot
    node dist/cli.js reply d_f11d8de68709_mrwj1koh

It will re-open the thread, re-probe it live, re-run all 20 gates against fresh state, read the
thread properly, show you the draft, and then ask. `r` is the safe answer and the default on
anything unclear. **Nothing is posted until you press `a`.**

Two independent layers stopped me from running this myself, and both did their job: redbot
refuses a non-interactive stdin, and the Claude Code classifier blocked the publish path. I did
not work around either.

---

## The thread

**"Custom CSS missing after Updraft restore"** — r/Wordpress
`https://www.reddit.com/r/Wordpress/comments/1v3evup/custom_css_missing_after_updraft_restore/`

| Criterion (yours) | Evidence |
|---|---|
| genuine technical question | "Where did Custom CSS go after an Updraft restore, and how do I recover it?" |
| active discussion | 7 comments, 2 upvotes, **7.8 hours old** — measured now, not at collection |
| no existing complete answer | longest existing comment **440 characters**; 5 claims made, none explaining the cause |
| contribution clearly improves it | the thread found a workaround and never asked *why*; the reply explains the mechanism and how to stop it recurring |
| passes every gate | **yes — pre-flight: `GATES ALLOW: true`** |

### Why not the higher-scoring candidates

| Candidate | Score | Rejected because |
|---|---|---|
| Alternatives to Rankmath | 87 | a plugin **recommendation** request — r/WordPress rule 1 is "no promotion of products or services" |
| Spam Activity and Bots | 85 | our headline gap was that comment 1 was wrong about a GA4 toggle — **comment 8 already corrected it** |
| VS Code e-commerce | 85 | 28h old, a 2,000-character answer already present, Shopify-centric |
| Google not indexing | 80 | drafted, then **blocked by the novelty gate** — see Case 1 below |

The winner scored **62**, the lowest of the five. Score is a filter, not a ranking of what to
post first.

---

## The gap it fills

Nobody in the thread asked why the Custom CSS field emptied while Additional CSS survived.

> Custom CSS is probably a single `wp_options`/postmeta row holding one large serialized value —
> exactly the kind of row that truncates silently during a SQL import when it hits
> `max_allowed_packet` or a chunking limit. Additional CSS survives because it is stored
> separately.

Concrete check offered: compare that option **present-but-empty live** against
**present-and-full in the backup dump**. Concrete prevention: check `max_allowed_packet` before
the next restore.

## The reply, as it will be posted

> Custom CSS and Additional CSS often aren't stored the same way, which is why a restore can wipe one and leave the other intact. Additional CSS (Appearance > Customize) is its own dedicated entry. A theme/plugin's "Site Settings > Custom CSS" field is usually a single row in wp_options (or a single postmeta row) holding one large serialized value.
>
> Big single-row values like that are the ones most likely to get silently truncated during a SQL import if it hits a size limit (the DB server's max_allowed_packet, or a chunking limit in whatever tool did the restore) - the row inserts empty or truncated instead of throwing an error, while smaller settings restore fine.
>
> Since you already extracted the CSS from the backup dump, you can confirm this: check whether that option is present-but-empty in the live DB versus present-and-full in the backup dump. If so, that's a truncation issue, not a deliberate wipe, and it's worth checking your host's max_allowed_packet setting before your next restore so it doesn't happen again.

171 words · 2 hedges · novelty overlap **57%** (threshold 70%) · linter clean · craft gate clean.

### What the machine cannot tell you

- Is the `max_allowed_packet` truncation mechanism **actually right** for this plugin's storage?
- Does it answer what was asked, or an adjacent question?
- Would you post it under your own name, to people who know WordPress?

If any answer is no, press `r`. A reasoned rejection is a case study too, and the review prompt
will record why.

---

## Immediately after

    node dist/cli.js observe --checkpoint immediate   # signed-in + signed-out
    node dist/cli.js regret                           # "would you post this without automation?"

Then `observe` again at 1h, 24h and 7d, and `regret` again at 24h for the question that
outranks every automated score in this repo.

**Expect a removal or a silent filter.** The account has karma 1 and has posted nothing. Per
`ACCOUNT-WARMING.md` that is the profile automated filters treat as spam. If the comment is
visible signed-in and absent signed-out, that is the recorded observation and nothing more —
no inference about why. It is a Stage-1 data point, not a failure.

---

## Open case: the novelty gate blocked a draft I judged good

Recorded as production evidence rather than fixed on the spot.

The "Google not indexing" draft was blocked by two novelty flags at 88% and 80% word overlap
against claims already on the thread. Reading it, the draft **referenced** those established
facts (the 200k scraped pages, the GSC-vs-Live-Test discrepancy) in order to build new
recommendations on top — check Wayback snapshots, check Security & Manual Actions specifically,
question whether the blanket 200k→homepage redirect is itself the problem, check for stale
edge/CDN rules.

The metric compares content words. It cannot distinguish *restating* X from *referring to* X
while adding Y — and a reply that engages with the thread's established facts will always share
vocabulary with them.

**Not fixed, deliberately.** N=1, and the correct threshold is exactly what the review dataset
exists to establish. Two more cases like this and it is a real finding; one is an anecdote.
Filed for the ten-interaction retrospective.
