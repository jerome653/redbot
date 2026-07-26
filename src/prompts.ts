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
Solve the actual problem, concretely. Name the setting, the file, the command, the thing to
check first and what the result tells them. If the fix depends on something they did not
say, ask for exactly that one thing.

If you are not confident, say what you would check and why, rather than guessing with
confidence. "I'd start by checking X, because it usually explains Y" is a useful reply.
An invented certainty is not.

Length follows the problem. Two sentences if that solves it. Do not pad to look thorough.

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
   confidently wrong costs the person who posts it more than a reply that is usefully unsure.${referenceBlock}

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
