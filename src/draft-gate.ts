/**
 * What the publish gate will refuse, computed at DRAFT time.
 *
 * src/gates.ts evaluates four families that are functions of the draft body and the thread — data
 * that exists the moment the model returns. src/commands/draft.ts computed one of them, recorded
 * it, and saved the draft anyway; the other three it did not compute at all. So a refusal that was
 * knowable at the draft line was discovered one certification and one publish decision later, one
 * family per cycle:
 *
 *   2026-09-27 22:07  refused  health                 (fixed 1401b03)
 *   2026-09-28 01:16  refused  warming:target          age  (fixed bd3c13d)
 *   2026-09-28 02:15  refused  warming:target          answers (fixed 6cc566d)
 *                              + quality:generic       (fixed b7904e4)
 *
 * Each of those cost a full cycle — ~30 minutes, one gap analysis, one draft and one certification
 * — to learn one fact that `assessQuality`, `lintDraft`, `checkWarmingComment` and the stored
 * `noveltyIssues` could all have reported before anything was saved.
 *
 * THE FOUR FAMILIES, and where each is mirrored from:
 *
 *   linter      gates.ts:129-131   lintDraft(body)                    recomputed by the gate
 *   quality:*   gates.ts:135-137   assessQuality(body, { thread })     recomputed by the gate
 *   novelty     gates.ts:143-145   draft.noveltyIssues                 REPLAYED from the draft
 *   warming:*   gates.ts:291-293   checkWarmingComment(body)           recomputed, when warming
 *
 * The warming family is narrower here than in gates.ts on purpose. gates.ts pushes `warming:<rule>`
 * from three places: this one, `checkWarmingPace` (:311, a fact about the ACCOUNT's recent
 * publishing) and `isWarmingTarget` (:324, a fact about the THREAD's age and answer count). Only
 * the body-derived rules belong to the draft, which is why they are named explicitly below rather
 * than matched by the `warming:` prefix — a prefix match would claim this function had checked
 * pace and target when it had not.
 */
import { lintDraft } from './disclosure.js';
import { assessQuality } from './quality.js';
import { checkWarmingComment } from './warming.js';
import { assessRepetition } from './repetition.js';
import type { Thread } from './types.js';

export interface DraftTimeBlock {
  /** The gate name src/gates.ts would use, so the two can be compared directly. */
  gate: string;
  reason: string;
}

/**
 * The `warming:<rule>` names `checkWarmingComment` can produce — src/warming.ts:162, :172, :179,
 * :184. Exported so a test can assert this list against that function rather than trusting it.
 *
 * `WARMING_MIN_WORDS` is 12 and `WARMING_MAX_WORDS` is 120 (src/warming.ts:150-151); the unhedged-
 * claim check at :194 is a WARNING, and src/autopublish.ts never refuses on warnings, so it is
 * deliberately not here.
 */
export const BODY_WARMING_RULES: readonly string[] = ['no-links', 'no-promotion', 'too-long', 'too-short'];

export function draftTimeBlocks(input: {
  body: string;
  /** As stored on the draft — gates.ts:143 replays this rather than recomputing it. */
  noveltyIssues?: readonly string[] | undefined;
  thread?: Pick<Thread, 'title' | 'body' | 'comments'> | undefined;
  /** `warmingStage(...).warming` — when false, gates.ts:290 skips the whole warming block. */
  warming: boolean;
  /**
   * This account's recently published comment bodies, MOST RECENT FIRST.
   *
   * Optional, and absent is NOT the same as empty: an empty array is a positive statement that the
   * account has posted nothing, while `undefined` means the caller did not look. Both skip the
   * check, but only one of them is a fact, and a future reader of this signature should not have to
   * guess which the caller meant.
   *
   * Unlike the other four families this one is NOT mirrored from src/gates.ts. It has no gate there
   * to mirror: repetition is a fact about the ACCOUNT'S HISTORY, not about the live thread, so it is
   * fully knowable at draft time and there is nothing a later re-check against the page could add.
   */
  previousBodies?: readonly string[] | undefined;
}): DraftTimeBlock[] {
  const out: DraftTimeBlock[] = [];

  /* Order mirrors gates.ts so two outputs can be read side by side. */
  const lint = lintDraft(input.body);
  if (!lint.ok) for (const issue of lint.issues) out.push({ gate: 'linter', reason: issue });

  if (input.thread) {
    const quality = assessQuality(input.body, { thread: input.thread });
    for (const i of quality.issues) {
      if (i.severity === 'block') out.push({ gate: `quality:${i.code}`, reason: i.message });
    }
  }

  for (const issue of input.noveltyIssues ?? []) out.push({ gate: 'novelty', reason: issue });

  if (input.warming) {
    const comment = checkWarmingComment(input.body);
    for (const i of comment.issues) out.push({ gate: `warming:${i.rule}`, reason: i.detail });
  }

  /* Last, because it is the only family that compares the draft to something other than the thread
     — and because the rewrite prompt reads this list in order, so the thread-local failures should
     be the ones it sees first. */
  if (input.previousBodies) {
    const rep = assessRepetition(input.body, input.previousBodies);
    for (const i of rep.issues) out.push({ gate: `repetition:${i.rule}`, reason: i.detail });
  }

  return out;
}
