# HRC-001 — Human Representation Certification

**Draft:** `d_f11d8de68709_mrwj1koh` · **Thread:** "Custom CSS missing after Updraft restore" (r/Wordpress)
**Operator:** `docs-architect` (karma 1) · **Certified:** 2026-07-23

**Standard applied:** *would an experienced engineer knowingly post this from their own Reddit account?*

---

## Recommendation

> # ✗ REJECT AND DO NOT PUBLISH

Two independent grounds, either of which is sufficient:

1. **The central technical claim is false.** The draft says an oversized row "inserts empty or
   truncated instead of throwing an error". MySQL does the opposite — it raises
   `ERROR 1153 (08S01): Got a packet bigger than 'max_allowed_packet' bytes` and the import
   aborts at that line.
2. **The thread is already resolved.** The asker posted an UPDATE saying they recovered the CSS,
   and confirmed the working fix twice in the comments. The reply arrives after the question is
   closed, to tell the asker why something happened — incorrectly.

This draft passed every automated gate. That is the most important finding in this document and
is treated separately at the end.

---

## Phase 1 — Reply audit

### Technical correctness — **FAIL**

The draft's novel contribution, verbatim:

> "Big single-row values like that are the ones most likely to get silently truncated during a
> SQL import if it hits a size limit (the DB server's max_allowed_packet, or a chunking limit in
> whatever tool did the restore) - **the row inserts empty or truncated instead of throwing an
> error**, while smaller settings restore fine."

Documented MySQL behaviour: a statement exceeding `max_allowed_packet` is rejected. The client
receives `ERROR 1153 (08S01)`, or the connection drops with `MySQL server has gone away` (2006).
The import stops at that line. There is no silent insert of a blank row.

Column-level truncation is a different mechanism and does not apply here either:
`wp_options.option_value` is `LONGTEXT` (~4 GiB), so a stylesheet cannot overflow it.

The reply is not merely imprecise. It asserts a specific failure mode that does not exist, and
builds a prevention step on top of it.

### Completeness — **FAIL**

The single most direct piece of evidence is never mentioned: **the UpdraftPlus restore log**. If
an import error occurred, it is recorded there. A reply diagnosing a restore failure without
asking the operator to read the restore log has skipped the first step.

### Accuracy of assumptions — **FAIL**

| Assumption | Status |
|---|---|
| "Site Settings > Custom CSS" is a theme/plugin option | Plausible, but **the theme is never named in the thread** and nobody asked |
| It is "usually a single row in `wp_options` … holding one large serialized value" | Unverified. Could equally be `theme_mods_<slug>`, a plugin table, or postmeta |
| Additional CSS is "its own dedicated entry" | Correct — WordPress core stores it as a `custom_css` post in `wp_posts`, keyed to the theme slug |

The last one is the interesting near-miss: because Additional CSS is keyed **to the theme slug**,
a restore that lands a different theme slug is a well-known cause of exactly this
one-survives-one-vanishes pattern. The draft had the right observation and reached for the wrong
mechanism.

### Evidence supporting each recommendation — **FAIL**

Nothing in the thread supports the truncation theory. Comments 1 and 4 establish only that the
CSS **is present in the dump** — which is consistent with an import error, a post-restore
overwrite, a theme-slug mismatch, or a plugin table not included in the backup. The draft picks
one cause and presents it as the likely one, with no evidence discriminating between them.

### Missing caveats — **FAIL**

No acknowledgement of the alternatives above. A correct reply here is mostly a diagnostic
question, because the thread does not contain enough information to name a cause.

### Ambiguities

"a chunking limit in whatever tool did the restore" — unfalsifiable hand-waving. Either name the
tool's behaviour or omit it.

### Risk of misunderstanding — **HIGH**

The concrete prevention step is "check your host's `max_allowed_packet` before your next
restore". Acting on it costs the asker time, may require a hosting ticket, and does nothing about
the actual (unknown) cause. It would leave them believing the problem is solved.

### Does it advance the discussion? — **NO**

From the thread body:

> "**UPDATE:** I downloaded the Updraft database file and extracted it. It was very big so I gave
> it to Claude and it found all the CSS."

And in the comments: *"Yes this worked"* · *"Thanks this is what I did"*.

The asker's question — *"Any way I can get that Custom CSS back?"* — was answered and confirmed
before redbot ever collected the thread.

---

## Phase 2 — Counter-review

Written as an experienced r/WordPress reader who knows MySQL. Each is a comment this reply would
plausibly attract.

| Criticism | Valid? |
|---|---|
| "That's not how `max_allowed_packet` works — you get ERROR 1153 and the import dies, you don't get a blank row." | **Yes. Decisive.** |
| "OP already fixed this and said so in the post. Did you read it?" | **Yes.** |
| "You never asked which theme. 'Site Settings > Custom CSS' isn't core WordPress." | **Yes.** |
| "If you think it truncated, why not just ask them to check the Updraft restore log?" | **Yes.** |
| Overconfidence: "the ones **most likely** to get silently truncated" — asserted, never evidenced | **Yes.** |
| Generic advice | No — it is specific. Specifically wrong, but specific. |
| Obvious AI wording | No — the prose reads naturally, hedges are placed sensibly, no stock phrases. |
| Unnecessary complexity | Partially — a serialization/packet-size theory where "check the restore log" comes first. |

**Five valid criticisms, one of them fatal.** Under the Phase 2 rule ("if the criticism is valid,
improve or reject"), this cannot be improved by editing: removing the false mechanism removes the
entire contribution, and what remains is "check the restore log", on a solved thread.

---

## Phase 3 — Moderator review

Observable subreddit norms only. No speculation about hidden systems.

| Question | Answer |
|---|---|
| Does it answer the question? | **No** — the question was "how do I get it back", already answered |
| Is it promotional? | No. No brand, product, or link |
| Is it respectful? | Yes |
| Does it fit the subreddit culture? | Partially — r/WordPress does welcome root-cause explanations, but on open threads |
| Is it excessively long? | No — 171 words |
| Likely considered low-effort? | No. It is substantive. **Being substantively wrong is worse than being low-effort** |

Nothing here would attract moderator action. That is not the bar. The bar is peer scrutiny, and
this fails it.

---

## Phase 4 — Reputation review

Assume this sits on `u/docs-architect` permanently, as the account's **first ever comment**.

| Question | Answer |
|---|---|
| Would it improve the operator's reputation? | **No.** A confident, incorrect claim about MySQL internals invites a public correction |
| Would another engineer trust this account more? | **No.** The likeliest visible outcome is a top-voted reply explaining ERROR 1153 |
| Would the operator stand behind it in six months? | **No.** The claim does not become true with time |

The asymmetry matters: the upside was explaining a root cause on a thread that no longer needed
one; the downside is a permanent, corrected, wrong technical claim as the account's opening
statement.

---

## Phase 5 — Publish readiness

> **REJECT AND DO NOT PUBLISH.**

Supporting observations, each concrete:

1. `ERROR 1153 (08S01)` is documented behaviour; the draft asserts the opposite.
2. `wp_options.option_value` is `LONGTEXT`, so column truncation cannot explain a blank field.
3. The asker posted an UPDATE confirming recovery; two further comments confirm the fix worked.
4. The theme is never named in the thread, so the storage-location assumption is unverifiable.
5. The restore log — the direct evidence — is never mentioned.

The draft stays `pending`. Rejecting it is the operator's action, at the prompt, so the reason
code (`inaccurate`) and note enter the review dataset as evidence:

    node dist/cli.js reply d_f11d8de68709_mrwj1koh     # then press r

---

## The finding that matters more than the draft

**Every automated gate passed this draft.**

| Gate | Result | Why it could not catch this |
|---|---|---|
| Safety linter | clean | Measures leakage, brand mentions, fabricated experience — not truth |
| Craft gate | clean | Measures specificity, hedging, register, length — a confident wrong claim scores *well* |
| Novelty check | 57%, pass | Measures **difference** from what was said. Different ≠ correct |
| Opportunity engine | 62/100, contribute | Measures whether a gap exists, not whether we can fill it correctly |
| Gap analyzer | `alreadyAnswered: false` | **Read a body containing "UPDATE: … it found all the CSS" and still said unanswered** |
| 20 safety gates | ALLOW | None of them evaluates a technical claim |

Two production observations follow, both filed for the ten-interaction retrospective:

**OBSERVATION HRC-001-A — the gap analyzer misses operator-declared resolution.**
The thread body contained an explicit `UPDATE:` stating the problem was solved, and two
confirmations sat in the comments. `alreadyAnswered` returned false. This is the second-order
cause of the entire near-miss: had it returned true, the opportunity score would have capped at
15 and no draft would exist. Severity **high** — it is the only signal in the system for "this
thread is finished".

**OBSERVATION HRC-001-B — nothing in the pipeline evaluates technical correctness.**
Not a defect; a structural boundary. Every automated gate is a proxy measurable from text alone.
Correctness is not measurable that way, and the pipeline should not pretend otherwise. This is
the strongest argument yet that the human review is load-bearing rather than ceremonial: **the
system produced a fluent, well-formed, specific, novel, safe, and wrong reply, and only a person
who knew MySQL stopped it.**

Neither is fixed here. Under the freeze, HRC-001-A is a candidate change with a citable
observation, but one case is an anecdote — it waits for the retrospective. HRC-001-B is not
fixable and should instead be stated in the product's positioning, which is the next section.
