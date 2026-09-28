import { config } from './config.js';
import { domain } from './domain.js';
import type { Thread } from './types.js';
import type { ReferenceHit } from './corpus.js';

function trim(s: string | null, n: number): string {
  if (!s) return '(none)';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/**
 * The declared areas, from the active domain profile. This list and the mechanical
 * competence check in `competence.ts` now read the SAME source — they used to be two
 * hardcoded tables that had to be kept in agreement by hand, which is how a competence
 * list can quietly drift from what the drafting prompt claims.
 */
const EXPERTISE = domain.expertise.map((e) => `  - ${e}`).join('\n');

/*
 * `analyzeBatchPrompt` — the Phase-1 batched triage prompt — was DELETED 2026-07-23 (D-01).
 *
 * It asked one model call for five judgements about its own reading of a title, and a later
 * stage consumed every one of them as input. DEFECT-12 is what that produces: the prompt’s own
 * GATE A puts a guide at priority 5, and it returned 72 with confidence 90, then wrote a
 * rationale for the band it had already chosen. Preserved in _superseded/phase1-triage/.
 */

/**
 * Knowledge Gap Analyzer.
 *
 * Runs BEFORE any draft exists, and reads the comments rather than the title. The question it
 * answers is not "is this thread interesting" but "what is this discussion missing" — and it
 * is allowed, explicitly, to answer "nothing".
 *
 * The `covered` list it returns becomes the do-not-repeat list for drafting and the novelty
 * check afterwards, so it has to be a faithful summary of what was already said, not a
 * critique of it.
 */
export function gapPrompt(thread: Thread): string {
  const comments = thread.comments
    .slice(0, 20)
    .map((c, i) => `[${i + 1}] (depth ${c.depth}) ${trim(c.body, 700)}`)
    .join('\n');

  return `Read a Reddit thread and report what its discussion is MISSING.

You are not writing a reply and you are not judging whether the thread is interesting. You are
establishing, for someone who may reply later, what has already been said and what has not.

Areas where a reply could come from real competence:
${EXPERTISE}

Return ONLY this JSON object, no prose, no fence:

{
  "question": "one line — what the asker actually needs to know",
  "covered": ["one line per distinct claim, instruction or diagnosis ALREADY made in the comments"],
  "gaps": [
    { "kind": "unanswered|partial|incorrect|unverified|missing-diagnostic",
      "what": "one line — what is missing, wrong or unverified",
      "fillable": true }
  ],
  "alreadyAnswered": false,
  "headroom": 0-100
}

**covered** — be faithful and specific. "Suggested disabling plugins one at a time" is useful;
"gave advice" is not. If two comments say the same thing, list it once. An empty thread gives
an empty list.

**gaps.kind**
  unanswered          nobody addressed this part of the question at all
  partial             addressed, but stops before the step that would actually resolve it
  incorrect           a claim in the comments is wrong or will not do what was said
  unverified          a diagnosis was asserted with no way given to confirm it
  missing-diagnostic  nobody asked for the one piece of information needed to tell causes apart

**gaps.fillable** — true only if the gap can be filled from the competence areas above,
without access to the asker's server, and without recommending a product.

**alreadyAnswered** — true when a correct, actionable answer is already present and another
reply would only restate it. Setting this true is a useful, normal outcome. Do not avoid it.

**headroom** — mechanical, not taste. Start at 0 and add:
  +45  at least one gap with kind "incorrect" or "missing-diagnostic" and fillable true
  +40  at least one gap with kind "unanswered" and fillable true
  +20  at least one gap with kind "partial" or "unverified" and fillable true
  +15  the comments contain no technical content at all (jokes, "same here", empty)
  Then, if alreadyAnswered is true, set headroom to at most 15 regardless of the above.
  Report the total, capped at 100.

THREAD
subreddit: r/${thread.subreddit}
title: ${thread.title}
age: ${thread.ageText ?? 'unknown'}   upvotes: ${thread.upvotes ?? '?'}   comments: ${thread.commentCount ?? '?'}

body:
${trim(thread.body, 2500)}

comments (${thread.comments.length} collected):
${comments || '(none)'}`;
}

/**
 * Draft a reply. The output must never name or allude to the operator's employer —
 * redbot writes answers, not advertising.
 *
 * Phase 3: the model must also state its case — why this thread, what is new, why not stay
 * silent — and it is told to refuse rather than manufacture one. The three answers are
 * checked against the gap analysis afterwards; they are not taken on trust.
 */
/**
 * The warming prompt — deliberately the opposite of `draftPrompt`.
 *
 * `draftPrompt` optimises for novelty: say something nobody else has said, and justify why the
 * thread deserves a reply at all. That is the right shape for a contribution and the wrong
 * shape for warming. A new account's first comments should be **ordinary** — short, useful,
 * unremarkable — because what earns karma is being a person who reads this subreddit, not being
 * the most insightful voice in it.
 *
 * The hard rules here are stricter than the contribution ones and are enforced again in code by
 * `checkWarmingComment`, which refuses the draft rather than trusting the model to have
 * complied. Prompts drift; a check does not.
 */
export function warmupPrompt(thread: Thread): string {
  const topComments = thread.comments
    .slice(0, 6)
    .map((c, i) => `${i + 1}. ${trim(c.body, 300)}`)
    .join('\n');

  return `Write a short, ordinary, genuinely helpful Reddit comment — the kind a working
developer leaves in passing when they happen to know the answer.

This is a NEW account with almost no history. The goal is not to be impressive. It is to be
useful and unremarkable, so the account reads like a person who reads this subreddit.

WHAT GOOD LOOKS LIKE
Two to five sentences. Answer the specific thing asked, or ask the one clarifying question
that would unblock them. Speak from practical experience. If you are not sure, say what you
would check and why — that is a genuinely useful comment and it cannot be wrong.

HARD RULES — a draft breaking any of these is thrown away by a check after you
1. **No links of any kind.** Not documentation, not a guide, nothing. From a new account even
   a helpful link reads as promotion.
2. **No product, company or brand names**, including any you might be affiliated with. Do not
   recommend a tool, a host, a plugin or a service.
3. **Under 120 words.** An essay from a two-day-old account is conspicuous.
4. **No engagement bait.** No "hope this helps", no "let me know if you need anything".
5. **Do not assert how software behaves unless you are certain.** Prefer "I'd check X" over
   "X does Y". A new account being publicly wrong is the worst available outcome.

DECLINE IF YOU SHOULD
If you have nothing genuinely useful to add, set "decline" to true. Filler is what makes an
account look like a bot, and one skipped thread costs nothing.

OUTPUT
Return ONLY this JSON object, no prose, no fence:

{
  "decline": false,
  "why": "one line — what you are adding, or why you are declining",
  "comment": "the comment itself, plain text, no preamble"
}

THREAD
subreddit: r/${thread.subreddit}
title: ${thread.title}

body:
${trim(thread.body, 1800)}

existing comments:
${topComments || '(none yet — you would be the first reply)'}`;
}

export function draftPrompt(
  thread: Thread,
  reason: string,
  angle: string,
  gap?: { question: string; covered: string[]; gaps: Array<{ kind: string; what: string }> },
  /**
   * Quoted primary documentation on the subjects this thread touches, retrieved deterministically
   * by `findReference`. Optional, and usually empty: the corpus is narrow on purpose and most
   * threads touch nothing it holds.
   *
   * WHY THIS EXISTS. Measured 2026-07-24: redbot had zero retrieval of any kind, so every
   * factual claim in every draft came out of model memory — which is exactly the provenance of
   * HRC-001's false `ERROR 1153` claim, and shows up in the certification log as 117
   * fatal-contradictions and 101 overconfident-language findings across 16 drafts. Adding a
   * check downstream of that (Argus) catches the symptom; this is the first thing upstream of
   * it that changes the input.
   */
  reference?: ReferenceHit[]
): string {
  const topComments = thread.comments
    .slice(0, 8)
    .map((c, i) => `${i + 1}. ${trim(c.body, 400)}`)
    .join('\n');

  const gapBlock = gap
    ? `
WHAT THE THREAD ALREADY CONTAINS — do not restate any of these:
${gap.covered.length ? gap.covered.map((c, i) => `  ${i + 1}. ${c}`).join('\n') : '  (nothing of technical substance)'}

WHAT IT IS MISSING — this is the only reason to reply:
${gap.gaps.length ? gap.gaps.map((g) => `  - [${g.kind}] ${g.what}`).join('\n') : '  (nothing identified)'}

What the asker actually needs: ${gap.question}
`
    : '';

  /**
   * The reference block is worded to stop two opposite failures. It must not be read as
   * permission to assert everything it contains — the cards answer their own questions, not
   * necessarily this thread's. And it must not be treated as the limit of what may be said,
   * or every reply becomes a quotation. So: ground what you can, mark what you cannot.
   */
  const referenceBlock = reference?.length
    ? `

REFERENCE MATERIAL — human-authored primary documentation, quoted
These were retrieved because they mention things this thread mentions. They are NOT tailored to
this thread and may not answer it. Use them to get the checkable facts right, quote a specific
setting or return value where it helps, and say plainly when they do not cover the case.

${reference.map((r, i) => `  [${i + 1}] ${r.cardId} — ${r.question}\n      ${trim(r.content, 700)}`).join('\n\n')}`
    : '';

  return `Write a draft Reddit reply that a real person will read, edit, and post under
their own name from their own account.${gapBlock}

You are drafting FOR a human, not AS a human. They are accountable for every word, so give
them something they would be comfortable putting their name on.

SUGGESTED ANGLE: ${angle}

WHAT MAKES IT GOOD
Short and useful beats thorough. One helpful observation, offered plainly, is the whole job.

LENGTH: two to four sentences. That is a ceiling, not a target — one sentence is fine when
one sentence answers it. Do not write an essay, a numbered plan, a list of options, or a
"hope this helps" wrapper. No headings. Usually no code block; include one only when a single
short command or setting IS the answer.

Name the one thing you would check first and what the result would tell them. If the fix
depends on something they did not say, ask for exactly that one thing and stop.

If you are not confident, say what you would check and why, rather than guessing with
confidence. "I'd start by checking X, because it usually explains Y" is a useful reply.
An invented certainty is not.

NEVER WRITE "X REQUIRES Y", "X NEEDS Y", "YOU CAN'T DO X WITHOUT Y", OR ANY OTHER ABSOLUTE ABOUT
HOW SOFTWARE WORKS. Measured: a draft asserting "comments require server-side processing",
"contact forms require server-side processing" and "search requires server-side processing" was
refused with a documented counterexample to each — client-side comment widgets, a mailto form, and
a pre-built static search index. All three were FALSE, and a false reply costs the account more
than no reply. There is almost always a tool, a service or a config that does the thing you just
said was impossible, and the fact-check will find it.

If a limit genuinely matters to the answer, make it a QUESTION or a CHECK, not a statement:
  ✗ "Static exports can't do comments, forms or search."
  ✓ "Do you need the comments and the contact form to keep working, or just the pages? That
     changes what will actually break."

TWO KINDS OF SENTENCE SURVIVE A FACT-CHECK. Write those and stop.

  1. AN OBSERVATION — something already in the thread. "The LCP breakdown you shared names the
     Jarallax image." Nobody can argue with what is on the page.
  2. A NEXT STEP — what you would do or check. "I'd check what Lighthouse reports as the LCP
     element now." A suggestion is not a claim about the world, so there is nothing to refute.

THE KIND THAT DOES NOT SURVIVE IS AN INFERENCE — a statement about what something would prove,
mean, show, rule out, distinguish, or cause. "Checking X would tell you whether it is Y or Z."
"That would rule out W." For anything not written in the thread, an alternative explanation
almost always exists, and the fact-check finds it.

So: GIVE THE STEP, NOT THE THEORY BEHIND IT. "I'd check the LCP element first" stands. "…because
that distinguishes a render delay from a preload problem" is the half that gets refused, and
dropping it costs the reader almost nothing — they asked what to do, not for a lecture.

A CONDITIONAL IS NOT A LICENCE TO BE CERTAIN EITHER. "If A, then B" reads as hedged and is not:
it asserts B outright for every case where A holds. So:

  - Do NOT rule a cause in or out from one observation. "If it still shows X, then Y isn't the
    problem" and "then the cause is Z" are both forbidden — one reading narrows the field, it
    does not settle it, and there is nearly always a case where A holds and B is false.
  - Say what the observation would NARROW instead: "if it still shows X, that points away from
    Y and I'd look at Z next" — same information, and it is true.
  - NO MECHANISM SENTENCES. "X causes Y", "X can cause Y", "that happens because Z" are read as
    statements of fact however softly they are phrased, and a reply that does not contain one
    cannot be contradicted about one. Drop it, or write it as an explicit guess (below).
  - IF YOU KEEP A GUESS, SAY IN THE WORDS THAT IT IS ONE. "My guess is…", "I'd bet…", "I'm not
    sure, but…", "I've seen that happen when…". The fact-check classifies the sentence it is
    given, not what you meant by it: an unmarked guess is read as a measurement and refused,
    and the same sentence prefixed with "my guess is" is accepted as a guess.
  - THE FACT-CHECK READS A CONFIDENCE OFF EVERY SENTENCE, and a flat declarative reads as HIGH.
    Measured: one draft had seven claims and the checker scored all seven "high" on
    reasoned-inference evidence, then refused each one with "asserted with high confidence, but
    reasoned-inference supports medium at best". Unless a fact is in the thread or the reference
    material above, the sentence carrying it must be visibly less than certain. This is not
    style — it is the difference between a reply that posts and one that does not.

STAY NEUTRAL. Answer the practical question and nothing around it. Do not take a side, do not
argue with another commenter, do not correct someone unless the correction IS the answer, and
do not volunteer an opinion nobody asked for. If two approaches both work, say so and move on
rather than ranking them.

HARD RULES — not style preferences
1. **Never mention any company, product, brand or service you are affiliated with.** No
   recommendations to buy, sign up for, or switch to anything. This reply exists to help,
   not to advertise. Naming third-party open-source tools that genuinely solve the problem
   is fine; promoting a commercial product is not.
2. **Never invent a personal experience.** No "I had this exact problem last year", no
   fabricated client stories, no made-up numbers. You do not have a past.
3. **Never imitate human error on purpose.** No deliberate typos, no forced slang, no
   artificial casualness added to seem less machine-written.
4. **No engagement bait.** No "hope this helps", no "let me know if you need anything else".
   If you genuinely need one piece of information, ask for that one thing.
5. **Plain formatting.** Code in fenced blocks. No emoji. No bold-everything.
6. **Do not state a checkable fact you cannot ground.** If a claim about how software behaves
   is not in the reference material below and not in the thread, either leave it out or write
   it as the check you would run: "I'd confirm X, because if it is Y then Z". A reply that is
   confidently wrong costs the person who posts it more than a reply that is usefully unsure.
7. **Quote at least one exact string from the thread.** Copy a filename, version number, path,
   setting name, command or error message out of the post or its comments, spelled exactly as
   they spelled it — "PHP 8.3" if they wrote PHP 8.3, "wp-config.php" if they wrote
   wp-config.php. This is checked mechanically, not judged: a reply whose specifics all appear
   for the first time in the reply itself is rejected before anyone reads it. Introducing new
   technical detail does not satisfy this. Reusing theirs does, and it is also the difference
   between answering this person and answering the topic.${referenceBlock}

DECLINE THESE OUTRIGHT — set "contribute" to false and leave the body empty
Not every thread is worth answering, and the ones below are worth answering least. Declining
costs nothing; a reply that draws an argument costs the account it was posted from.

  - anything debatable or contentious: politics, religion, identity, moral arguments, or a
    thread whose question is "which is better" rather than "why is this broken"
  - a thread that is already an argument, or where commenters are attacking each other
  - a complaint, a rant, a drama thread, or a callout — there is no practical question in it
  - anything where a correct answer would require taking a side
  - anything you would need to speculate about to answer at all

There is no credit for participating. Silence on a thread like this is the right output.

MAKE THE CASE, OR DECLINE
Before the reply, state three things. If you cannot state all three honestly, set
"contribute" to false and leave the body empty — declining is a correct, expected outcome and
is preferred over a reply that repeats the thread back to itself.

  whyThread     why this specific thread is worth a reply
  whatNew       what information the reply adds that is NOT already in the comments above
  whyNotSilent  why posting this beats saying nothing

"whatNew" is checked mechanically against the list of what the thread already contains. A
restatement of an existing comment will be caught and the draft discarded, so do not pad it.

OUTPUT
Return ONLY this JSON object, no prose, no fence:

{
  "contribute": true,
  "whyThread": "one line",
  "whatNew": "one line — the specific information being added",
  "whyNotSilent": "one line",
  "body": "the reply itself, plain text, no preamble"
}

THREAD
subreddit: r/${thread.subreddit}
title: ${thread.title}

body:
${trim(thread.body, 2500)}

existing comments (do not repeat what is already said):
${topComments || '(none)'}

why this thread was selected: ${reason}`;
}


/**
 * What to append to `draftPrompt` when the craft gate would block the draft that came back.
 *
 * src/commands/draft.ts:170 has always called `assessQuality(body, { thread })` at draft time and
 * recorded the result — `qualityOk` at :225 and `qualityBlocks` at :240 — and then saved the draft
 * regardless. src/gates.ts:137 turns those same block-severity issues into a `quality:<code>` gate,
 * and src/autopublish.ts:184 refuses on any advisory. So the draft stage measured the refusal,
 * wrote it down, and handed the draft on to be certified anyway.
 *
 * MEASURED 2026-09-28, draft d_61dd17759ea3_mukls4ac, r/webdev:
 *   02:03:07  draft        saved, with quality:generic already recorded against it
 *   02:10:06  gate.block   argus REJECT      (~7 minutes of certification)
 *   02:15:22  refused      quality:generic, warming:target
 *
 * Feeding the specific failure back is worth more than restating the rule: `quality.ts:181` fires
 * on `technicalHits === 0 && specificityHits < 3`, and `technicalHits` counts technical tokens in
 * the INTERSECTION of reply and thread — so it cannot be raised by any string the thread does not
 * already contain. Reproduced on the real pair: the draft above scored "2 overlapping terms, 0
 * technical" while a rewrite reusing the thread's own "MAMP 6.8", "PHP 8.3" and "php.ini" cleared
 * the same rule unchanged.
 */
export function draftCorrection(issues: Array<{ gate: string; reason: string }>): string {
  const named = issues.map((i) => `  - ${i.gate}: ${i.reason}`).join('\n');
  /* `generic` gets the mechanism spelled out, because it is the one failure a model cannot fix by
     trying harder — it has to copy strings rather than produce better ones. */
  /* The gate name, not a bare code: src/gates.ts:137 composes `quality:<code>`, and matching the
     bare code here would silently stop firing the day the composition changed. */
  const generic = issues.some((i) => i.gate === 'quality:generic')
    ? '\n\nFor "generic" specifically: the check counts strings that appear in BOTH your reply and '
      + 'the thread. Writing NEW technical detail scores zero no matter how precise it is. Open the '
      + 'post and its comments, take at least one exact string that contains a digit, a dot, a slash '
      + 'or a dash — a version, a filename, a path, a setting, an error — and use it verbatim.'
    : '';

  return `

--- REWRITE REQUIRED ---
Your previous draft was rejected mechanically, before anyone read it. The failures:

${named}

Write the reply again, fixing exactly these. Keep everything that was right about it; do not
lengthen it to compensate. Return the same JSON shape.${generic}`;
}
