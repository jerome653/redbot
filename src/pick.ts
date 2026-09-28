/**
 * Which assessed thread to draft for — decided against CURRENT facts, not stored ones.
 *
 * src/commands/draft.ts read `loadAssessments()` and filtered on the stored `verdict`, sorted by
 * the stored `score`. Both were computed when the row was written and neither was re-derived, so
 * the pick was the highest-scoring assessment EVER RECORDED for an un-drafted thread — not the
 * highest-scoring one that is still true. `store.ts:141-144` upserts and never deletes, and
 * `assessed_at` is on the row but nothing read it.
 *
 * MEASURED 2026-09-28 03:42, draft d_d61f816d4c59_mukopknx, r/Wordpress "What exactly must I
 * include in a scope of work agreement?":
 *
 *   stored   verdict 'contribute', score 90, assessed_at 2026-09-27T21:51:43
 *   thread   collected 2026-09-26T05:42, 29.98h old THEN, 75.98h old at the decision
 *            comment_count 20
 *   refused  stale-thread (gates.ts:260, 72h), warming:target (20 answers, max 8), warming:too-long
 *
 * The same run's `opportunity` had scored the live table and reported "2/212 worth contributing
 * to". The thread it drafted was neither of those two: score 90 sorted above both. And 90 was not
 * a near-miss — src/opportunity.ts caps a thread that violates the age or answer ceiling at 10,
 * which is below `minOpportunityToPublish` (40), so re-deriving the verdict excludes it outright.
 * The cap was already correct; nothing was asking it.
 *
 * The pool it was picking from, measured the same minute: 325 assessments, 40 with verdict
 * 'contribute', 21 of those assessed more than 24h earlier, and the top two scored 100 on
 * 2026-09-01 — 647.5 hours before the pick.
 *
 * WHY RE-DERIVE RATHER THAN EXPIRE BY `assessed_at`. A freshness cutoff needs a number nobody has
 * measured, and it would still admit a row that was wrong when written. `assessOpportunity` is
 * pure — gaps, headroom, `isQuestionShaped`, `assessCompetence` and policy, no model call — so
 * re-running it costs nothing and makes every future change to those rules take effect on the next
 * draft instead of waiting for stale rows to age out. This is the same correction `currentAgeHours`
 * (src/select.ts:236) made for thread age, applied to the verdict that age feeds.
 */
import { assessOpportunity } from './opportunity.js';
import type { Thread, GapAnalysis, OpportunityAssessment } from './types.js';

export interface RankInput {
  /** The stored rows — used as the LIST of threads worth re-examining, never for their verdicts. */
  assessments: readonly OpportunityAssessment[];
  threads: readonly Thread[];
  gaps: readonly GapAnalysis[];
  /** Thread ids that already have a draft. */
  drafted: ReadonlySet<string>;
  /** `redbot draft <threadId>` — when given, only that thread is considered. */
  threadId?: string | undefined;
}

/**
 * Re-assessed candidates, best first. Empty when nothing currently qualifies.
 *
 * A candidate whose thread or gap analysis is absent is dropped: `assessOpportunity` cannot be run
 * without both, and a row that cannot be re-derived is exactly the row this function exists to stop
 * trusting. draft.ts keeps its own thread/gap lookup after this, which is now defensive rather than
 * reachable on the auto path — its messages stay correct if ever reached.
 */
export function rankCandidates(input: RankInput): OpportunityAssessment[] {
  const byThread = new Map(input.threads.map((t) => [t.id, t]));
  const gapByThread = new Map(input.gaps.map((g) => [g.threadId, g]));

  const out: OpportunityAssessment[] = [];
  for (const stored of input.assessments) {
    if (input.threadId ? stored.threadId !== input.threadId : input.drafted.has(stored.threadId)) continue;

    const thread = byThread.get(stored.threadId);
    const gap = gapByThread.get(stored.threadId);
    if (!thread || !gap) continue;

    /* The stored score and verdict are discarded here, deliberately and completely. */
    const fresh = assessOpportunity(thread, gap);
    if (fresh.verdict === 'contribute') out.push(fresh);
  }

  return out.sort((a, b) => b.score - a.score);
}
