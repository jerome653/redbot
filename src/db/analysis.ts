/**
 * gap analyses and opportunity assessments.
 *
 * Both are keyed by threadId and both upsert, matching saveGaps / saveAssessments
 * on disk. The child `gaps` rows are replaced rather than merged: a gap has no
 * identity beyond its position in the analysis that produced it.
 */
import type { Db } from '../db.js';
import type { GapAnalysis, Gap, OpportunityAssessment, ContributionThesis } from '../types.js';

/* ------------------------------------------------------------------ *
 * gap analyses
 * ------------------------------------------------------------------ */

interface GapAnalysisRow {
  thread_id: string;
  permalink: string;
  title: string;
  question: string;
  covered: string[];
  already_answered: boolean;
  headroom: number;
  analyzed_at: Date;
  model: string;
}

interface GapRow {
  thread_id: string;
  kind: Gap['kind'];
  what: string;
  fillable: boolean;
}

export async function upsertGapAnalyses(db: Db, items: GapAnalysis[]): Promise<number> {
  for (const g of items) {
    await db.query(
      `INSERT INTO gap_analyses
         (thread_id, permalink, title, question, covered, already_answered, headroom, analyzed_at, model)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (thread_id) DO UPDATE SET
         permalink        = EXCLUDED.permalink,
         title            = EXCLUDED.title,
         question         = EXCLUDED.question,
         covered          = EXCLUDED.covered,
         already_answered = EXCLUDED.already_answered,
         headroom         = EXCLUDED.headroom,
         analyzed_at      = EXCLUDED.analyzed_at,
         model            = EXCLUDED.model`,
      [g.threadId, g.permalink, g.title, g.question, JSON.stringify(g.covered ?? []),
       g.alreadyAnswered, g.headroom, g.analyzedAt, g.model]
    );

    await db.query('DELETE FROM gaps WHERE thread_id = $1', [g.threadId]);
    for (const [i, gap] of (g.gaps ?? []).entries()) {
      await db.query(
        `INSERT INTO gaps (thread_id, position, kind, what, fillable)
         VALUES ($1,$2,$3,$4,$5)`,
        [g.threadId, i, gap.kind, gap.what, gap.fillable]
      );
    }
  }
  return items.length;
}

export async function loadGapAnalyses(db: Db): Promise<GapAnalysis[]> {
  const a = await db.query<GapAnalysisRow>(
    `SELECT thread_id, permalink, title, question, covered,
            already_answered, headroom, analyzed_at, model
       FROM gap_analyses ORDER BY analyzed_at DESC, thread_id`
  );
  const g = await db.query<GapRow>(
    `SELECT thread_id, kind, what, fillable FROM gaps ORDER BY thread_id, position`
  );

  const byThread = new Map<string, Gap[]>();
  for (const row of g.rows) {
    const list = byThread.get(row.thread_id) ?? [];
    list.push({ kind: row.kind, what: row.what, fillable: row.fillable });
    byThread.set(row.thread_id, list);
  }

  return a.rows.map((r) => ({
    threadId: r.thread_id,
    permalink: r.permalink,
    title: r.title,
    question: r.question,
    covered: r.covered,
    gaps: byThread.get(r.thread_id) ?? [],
    alreadyAnswered: r.already_answered,
    headroom: r.headroom,
    analyzedAt: r.analyzed_at.toISOString(),
    model: r.model
  }));
}

/* ------------------------------------------------------------------ *
 * opportunity assessments
 * ------------------------------------------------------------------ */

interface AssessmentRow {
  thread_id: string;
  permalink: string;
  title: string;
  verdict: OpportunityAssessment['verdict'];
  score: number;
  thesis_why_thread: string | null;
  thesis_what_new: string | null;
  thesis_why_not_silent: string | null;
  reasons: string[];
  assessed_at: Date;
}

export async function upsertAssessments(db: Db, items: OpportunityAssessment[]): Promise<number> {
  for (const a of items) {
    const t: ContributionThesis | null = a.thesis ?? null;
    await db.query(
      `INSERT INTO opportunity_assessments
         (thread_id, permalink, title, verdict, score,
          thesis_why_thread, thesis_what_new, thesis_why_not_silent, reasons, assessed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (thread_id) DO UPDATE SET
         permalink             = EXCLUDED.permalink,
         title                 = EXCLUDED.title,
         verdict               = EXCLUDED.verdict,
         score                 = EXCLUDED.score,
         thesis_why_thread     = EXCLUDED.thesis_why_thread,
         thesis_what_new       = EXCLUDED.thesis_what_new,
         thesis_why_not_silent = EXCLUDED.thesis_why_not_silent,
         reasons               = EXCLUDED.reasons,
         assessed_at           = EXCLUDED.assessed_at`,
      [a.threadId, a.permalink, a.title, a.verdict, a.score,
       t?.whyThread ?? null, t?.whatNew ?? null, t?.whyNotSilent ?? null,
       JSON.stringify(a.reasons ?? []), a.assessedAt]
    );
  }
  return items.length;
}

/** Assessments, optionally only for these threads — the ones behind the drafts on a page. */
export async function loadAssessmentsFromDb(
  db: Db, threadIds?: string[]
): Promise<OpportunityAssessment[]> {
  if (threadIds && !threadIds.length) return [];
  const r = await db.query<AssessmentRow>(
    `SELECT thread_id, permalink, title, verdict, score,
            thesis_why_thread, thesis_what_new, thesis_why_not_silent, reasons, assessed_at
       FROM opportunity_assessments
      ${threadIds ? 'WHERE thread_id IN (SELECT j.value FROM json_each($1) j)' : ''}
      ORDER BY assessed_at DESC, thread_id`,
    threadIds ? [JSON.stringify(threadIds)] : []
  );
  return r.rows.map((x) => ({
    threadId: x.thread_id,
    permalink: x.permalink,
    title: x.title,
    verdict: x.verdict,
    score: x.score,
    // The column trio is all-or-nothing at the database level (thesis_is_whole), so
    // testing one is enough to know whether a thesis was recorded.
    thesis: x.thesis_why_thread === null ? null : {
      whyThread: x.thesis_why_thread,
      whatNew: x.thesis_what_new ?? '',
      whyNotSilent: x.thesis_why_not_silent ?? ''
    },
    reasons: x.reasons,
    assessedAt: x.assessed_at.toISOString()
  }));
}
