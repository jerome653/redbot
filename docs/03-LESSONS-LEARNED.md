# 3. Lessons learned

Every architectural lesson, and **why each one permanently changed the design**. Ordered by how
much of the current architecture each one is responsible for.

The pattern that runs through all of them: **the test suite was green for every single one.**
Not one of these was found by a test. They were found by running the thing and reading what came
out.

---

## The three that redirected the project

### HRC-001 — writing quality does not imply technical correctness

*2026-07-23. The draft was fluent, specific, correctly hedged, brand-safe, lint-clean, and novel
against the thread. It claimed an oversized row "inserts empty or truncated instead of throwing
an error" during a SQL import. MySQL raises `ERROR 1153` and aborts. Every automated gate passed
it.*

**Why it changed the design permanently.** Before HRC-001 the implicit model was that quality is
one axis — that a reply which is specific, hedged, safe and novel is *therefore* good. Every gate
was built on that assumption and every gate measured a proxy readable from text.

Correctness is not on that axis, and no text-level check can put it there. That produced Argus as
a separate architectural layer rather than another linter, and it produced the standing rule:
**never infer truth from writing quality.**

The secondary lesson is about who catches it. A person who knew MySQL caught this in seconds. The
system could not have caught it at any threshold setting. That is the argument for human review
being load-bearing rather than ceremonial, and it is why the project is now positioned as a
human-in-the-loop contribution assistant rather than a Reddit automation tool.

### HRC-001-A — the only "is this finished?" signal was a model's opinion

*The thread body contained `UPDATE: … it found all the CSS`, and the OP had replied "Yes this
worked" and "Thanks this is what I did". The gap analyzer returned `alreadyAnswered: false`.*

**Why it changed the design.** The pipeline had exactly one signal for "this thread is over" and
it was a judgement call delegated to a model. When it failed, everything downstream ran: the
opportunity engine scored 62/100, a draft was generated, and twenty gates passed it.

Resolution is not a judgement call. The asker either said they were done or they did not. That
became Phase 7 — deterministic string matching, first in the pipeline, short-circuiting
everything — and it is the check that actually stops HRC-001 today, at zero model cost.

Generalised: **anything a model can be asked to judge, and which is actually a matter of fact,
should be decided by code.**

### ARGUS-001 — self-declared provenance is inflatable

*The first real Argus run extracted 12 claims. The two carrying the false `max_allowed_packet`
assertion came back as `protocol-behaviour / observed-runtime-behaviour` and
`protocol-behaviour / official-implementation`.*

**Why it changed the design.** Argus's Rule 4 escalates a falsifiable claim resting on weak
evidence. The model simply declared strong evidence, so the rule never fired. The only remaining
check was the adversarial refutation — which timed out twice on that same run.

Without Rule 8, **Argus would have certified the HRC-001 draft on the claim path.** Only Phase 7
saved it. That produced Rule 8: an unrefuted falsifiable claim cannot certify, because a claim
judged solely on its own declared provenance is marking its own homework.

The deeper lesson, still unresolved: asking a model to grade its own evidence is the same
category of error as asking it to grade its own writing.

---

## Security and safety

### DEFECT-01 — live session cookies were one `git add -A` from being committed *(critical)*

`data/` held 4.6 GB of Chrome profile including `Login Data` and working `reddit_session`
cookies for two accounts, in a directory showing as `?? Projects/redbot/` inside the parent repo.

**Changed the design:** a nested `.gitignore` is now load-bearing, and `doctor` verifies its four
required patterns on every run. The same failure class had been flagged in the Appilot teardown
one day earlier and was reproduced in our own repo immediately — **knowing about a failure class
does not protect you from it; a check does.**

### DEFECT-08 — the approval gate failed open *(critical)*

`choose()` returned `options[0]` for any unrecognised answer. The publish gate offers `a/e/r`, so
a blank line, a typo or a stray newline resolved to **approve, and post**. It had never fired
only because the one non-interactive run died at end-of-input first.

**Changed the design:** the safe answer is now a required argument the caller must name;
unrecognised input re-asks; non-interactive stdin throws. One of four regression tests reads the
call site to catch a positional default being reintroduced.

The architectural lesson is broader than the bug: **ambiguity must resolve to silence.** That
rule now governs every gate in `gates.ts` — a probe that cannot establish its fact blocks.

### DEFECT-06 — agent context leaked into a draft *(critical)*

`claude -p` runs as a full agent in the working directory. Executed inside this repo it inherited
CLAUDE.md, memory pins and plan mode, and returned drafts containing plan-file notes, internal
tool names and a local Windows path. **Two of three such drafts passed the linter as it stood.**

**Changed the design:** the LLM subprocess runs in an empty scratch directory with an explicit
permission mode, and `AGENT_LEAKAGE` exists as a backstop. The lesson: **a subprocess inherits
more context than you think it does**, and the primary fix is isolation, not detection.

### DEFECT-10 — the linter passed a real leak *(critical)*

A draft opened with *"One sec — checked site fetch, blocked by permission gate…"* and announced
*"Here's the draft reply:"* on line 3. The preamble check read **line 1 only**.

**Changed the design:** the scan covers the opening block, and a separate handoff-marker class
exists. Found by reading generated output, not by the suite — which is the lesson: **a linter is
only as wide as the failure you have already seen.**

---

## Operational reality

### DEFECT-02 — self-inflicted HTTP 429

~75 page loads in a few minutes. Recovery took under 5 minutes but the run died mid-collection.

**Changed the design:** produced the only genuinely **measured** operational limit in the system
(9.5 loads/min), and produced `policy.ts` — where every limit carries its provenance as
`measured` / `declared` / `provisional`. Currently **1 measured, 17 declared, 6 provisional**.

The lesson: a system full of confident-looking constants is mostly guesses. Making the guesses
visible is cheaper than pretending they are findings.

### DEFECT-03 — the page is not the results

The first-ever live `search` run for "elementor slow loading" collected, alongside real results,
`Tile Up daily puzzle #34`, `Dog breeds - July 21, 2026` and `Play the Game!`. `collectPermalinks`
walked the whole document and swept up home-feed and sidebar widgets with the results list.

**Changed the design:** collection is scoped to an explicit results container (`searchScope` /
`feedScope`), and a fallback to `<main>` emits a warning rather than passing silently.

The lesson generalises past scraping: **a selector that matches everywhere matches nothing in
particular.** The same reasoning is why `competence.ts` requires two declared areas rather than
one shared word, and why the resolution detector requires the asker's own declaration rather than
any "this worked" on the page. Breadth of match is not evidence of relevance.

Worth recording alongside it: the fix has **never been exercised in production** — `search` has
not been run live since. It sits in `07-MODULE-MATURITY` as `Unsupported` for exactly that reason.

### DEFECT-04 — one bad thread killed the whole run

**Changed the design:** every per-item fetch is isolated and skips are counted. The same
reasoning later produced incremental persistence of gap analyses, after observing that a crash on
thread 12 would discard eleven minutes of completed model calls.

### DEFECT-05 — identity detection was wrong three separate ways

`#expand-user-drawer-button` exists while logged **out** (false positives). "Log In"/"Sign Up"
body text renders while logged **in** (false negatives). The first `a[href^="/user/"]` on the page
is a **post author**, not the account.

**Changed the design:** identity reads Reddit's own `shreddit-app[user-logged-in]` flag plus the
header profile link, polls for hydration, and reports *how* it decided so a wrong answer is
debuggable. The dead ends are recorded in the source so they are not retried.

### DEFECT-09 — an error message with nothing in it

`claude CLI exited 1:` and nothing after the colon. Forty minutes of no drafts with no usable
explanation. Cause: the auth check sat *after* the exit-code branch, and the CLI writes "Not
logged in" to **stdout** while the error path read only **stderr**.

**Changed the design:** the auth check runs first and reads both streams. Lesson: **an error path
that can produce an empty message is a bug in the error path.**

---

## Selection and judgement

### DEFECT-07 — ranking instability *(bounded, never closed)*

The same thread scored 95 / 85 / 20 across runs. Root cause was **not** temperature — a
controlled experiment made it *worse* (spread 20 → 25.8) — but an underspecified rubric.
Rewriting triage from a free 0–100 score into mechanical gates took average spread **19.2 → 6.7**.
Two borderline threads still flip.

**Changed the design:** established the pattern used everywhere since — replace free judgement
with published bands, then recompute the band locally from the structured output. The negative
result about temperature is recorded because it is the more useful half: **the instability was in
the question, not the sampling.**

### DEFECT-12 — the rubric was skipped and rationalised

A `[Guide]` post scored priority **72**, confidence **90**, when GATE A of the rubric puts a guide
at 5. The model then wrote a justification for the band it had already chosen.

**Changed the design:** fixed **mechanically**, not by rewording the prompt — `isQuestionShaped()`
checks the title, and it is wired into both selection and the publish gates so a bad score cannot
be inherited. This is the origin of the standing rule: **a prompt is a request; a bracket tag in a
title is a fact about a string.**

### DEFECT-11 — three drafts targeted threads seven to eight years old

62,975 h · 70,180 h · 70,627 h. `read` pulls a low-traffic subreddit's hot feed, which surfaces
ancient posts, and nothing gated age.

**Changed the design:** the 72-hour ceiling, and later `currentAgeHours()`.

### DEFECT-14 — the opportunity score saturated

**7 of 14 threads scored exactly 100.** Additive bands plus threads that nearly all carry two
high-band gap kinds. The engine excluded bad candidates but could not rank good ones — ordering
among passing threads was arbitrary.

**Changed the design:** the fix used signal already being collected and thrown away — `covered`,
the number of claims already on the thread (range 1–12). Scores now spread 100 → 47. Lesson:
**before adding a signal, check what you are already discarding.**

### DEFECT-15 — the competence filter did nothing

**65 of 67 gaps (97%) came back `fillable`** against a WordPress-only competence list — including
Shopify Liquid architecture, an unspecified "MCP-Server", and *"Vue/Nuxt + Laravel API
deployment"* which scored **92/100**.

**Changed the design:** competence is now checked against the thread's own vocabulary, which the
model does not control. Building it exposed four English-word false positives — "theme tokens",
"the best compromise", "rendering order", a lone "cache" — each found by printing what actually
matched rather than by guessing. A further rule emerged from the re-run: every declared area is
WordPress-centric, so generic infrastructure vocabulary only counts with a **WordPress anchor**.

**A flag that is true 97% of the time is not a filter.** That sentence is now a design test.

### DEFECT-13 — showcase posts read as technical questions

*"Redesigning my AI company's site, would appreciate honest feedback"* scored **90/100**. Later,
a fresh collect found **3 of 15 threads `[PROMO]`-tagged** with the tag unknown to the filter.

**Changed the design:** the announcement/showcase vocabulary is now explicit and mechanical.
Lesson: the taxonomy of "things that are not questions" is larger than it looks, and it is
discovered by collecting, not by imagining.

---

## Integration and evidence-chain failures

### The Phase-3 path was unpublishable *(high — found by the first live pre-flight)*

The gates required the Phase-1 `analysis.json` record. Every thread processed through the newer
`opportunity` path hit `[triage] no analysis on record`. Phase 3 shipped a decision stage and left
the gate reading the old one. **Nothing failed loudly** — the pipeline simply could not publish.

**Lesson:** adding a stage without retiring or bridging the old one produces a system that is
green everywhere and functional nowhere. The first end-to-end dry run is what exposed it, and
nothing short of that would have.

### `ageMinutes` was frozen at collection *(medium)*

Stored 17.8 h against a true age of 28.3 h. The 72-hour ceiling was enforced against the stored
number, so a thread collected at 70 h and drafted a day later publishes as "70h" while actually
~95 h old. **A gate that passes exactly what it exists to stop, with no error.**

**Lesson:** a timestamped fact is not a fact; it is a fact plus a clock. Derived values must be
derived at use.

### `probe-karma` printed but never recorded *(medium)*

Karma was measured, printed to a terminal, and thrown away. The health machine went on reporting
"karma has never been measured".

**Lesson:** **a measurement that does not reach the log is not evidence.** In an evidence-driven
project this is a category error, not a minor omission.

### ARGUS-002 — refutation is expensive and was best-effort

Extraction produced 12 claims; refuting them one at a time hit the 180 s CLI timeout repeatedly.
Twelve sequential refutations is 18–36 minutes per draft, and a timed-out refutation meant a claim
was judged without ever being attacked.

**Changed the design:** refutation is spent only on claims that can be contradicted, and Rule 8
makes a *missing* refutation escalate rather than pass. Lesson: **a best-effort verification step
must fail loud, or it silently becomes optional.**

---

## Open, unresolved

### The novelty check blocked a correct draft

88% and 80% word overlap against claims already on the thread — but the draft was *referencing*
those established facts in order to build new recommendations on them. The metric compares
content words; it cannot distinguish restating X from referring to X while adding Y.

**Deliberately not fixed.** N=1 is an anecdote, and the operator review dataset is exactly what
should set that threshold — except that dataset is still empty. This is the clearest illustration
of the project's current bottleneck: **there is no operator data to calibrate anything against.**

---

## Meta-lessons

1. **Green suites do not find architecture defects.** 169 tests pass; not one of the failures
   above was caught by a test before it was observed. Tests protect what you already understand.
2. **Every fix that stuck was mechanical.** Prompt revisions were tried for DEFECT-07 and DEFECT-12
   and did not hold; the checks that hold are the ones operating on facts a model does not control.
3. **The first live run of anything finds a class of defect nothing else does.** The pre-flight
   found the pipeline join; the first Argus run found provenance inflation; the first collect
   found `[PROMO]`.
4. **Negative results are load-bearing.** The temperature experiment, the "reasoning is not
   evidence" rule, and the 97%-fillable measurement each changed the design more than a feature did.
5. **The system is honest by construction and that has repeatedly paid.** Rates print with
   denominators, `no data (0 samples)` is a real output, and provenance is tagged
   measured/declared/provisional. Every one of those conventions caught something.
