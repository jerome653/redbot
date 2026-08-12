/**
 * Improvement signals — where the pipeline is losing candidates, and which stage to fix.
 *
 * The funnel already tells you the system rejects most threads. That is by design and says
 * nothing about whether it is rejecting the right ones. What is actionable is *where* the
 * losses cluster, because each stage's failures indict a different component:
 *
 *   dropped at the prefilter      the collector is reading the wrong subreddits or sorts
 *   no fillable gap               the competence list is too narrow, or the sub is wrong
 *   already answered              we are arriving late — collect more often, not more widely
 *   model declined                the gap analyzer is passing threads it should have skipped
 *   novelty blocked               the drafting prompt is not using the do-not-repeat list
 *   gate blocked                  depends which gate; listed individually
 *   rejected: inaccurate          the drafting model is out of its depth on this topic
 *   rejected: already-covered     the gap analyzer's `covered` extraction is missing claims
 *
 * Every signal below states the evidence and the count it came from. A signal over a sample
 * of two is reported with the two attached, so it reads as a hint rather than a finding.
 */
import { loadTrace, type TraceEvent } from './trace.js';
import { loadThreads, loadGaps, loadAssessments, loadDrafts } from './store.js';
import { loadReviews, summarizeReviews } from './review.js';
import { loadHistory } from './store.js';
import { prefilter } from './commands/opportunity.js';
import { policy } from './policy.js';

export interface Signal {
  /** Which component the evidence points at. */
  stage: string;
  severity: 'info' | 'watch' | 'act';
  finding: string;
  evidence: string;
  /** Denominator, so a signal over a tiny sample cannot masquerade as a rate. */
  n: number;
}

export interface StageTiming {
  stage: string;
  event: string;
  count: number;
  medianMs: number;
  maxMs: number;
}

export interface Insights {
  funnel: Array<{ stage: string; count: number; note: string }>;
  signals: Signal[];
  timings: StageTiming[];
  traceEvents: number;
  runs: number;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

/**
 * Which of the two opposite causes a batch of "too old" drops actually has.
 *
 * `ageMinutes` is the age a thread had AT COLLECTION. If it was already past the ceiling then,
 * the feed handed over something stale and the sort is the thing to change. If it was inside the
 * ceiling then, the feed did its job and the thread aged on disk — the corpus is old because
 * nothing has collected since, and changing the sort would fix nothing.
 *
 * Measured 2026-08-12: 14 of 35 dropped too old, 0 of 35 over the ceiling at collection. The
 * finding said "the collector is reading a feed that surfaces old posts" for a collector that
 * had never once done so.
 *
 * Rows with no captured age abstain rather than vote — an unmeasured thread is not evidence for
 * either story, and counting it as one would be the same mistake in a smaller place.
 */
export function tooOldCause(
  dropped: readonly { ageMinutes: number | null }[],
  ceilingHours: number
): 'feed' | 'stale' | 'unknown' {
  const measurable = dropped.filter((d) => d.ageMinutes != null);
  if (!measurable.length) return 'unknown';
  const oldOnArrival = measurable.filter((d) => d.ageMinutes! / 60 > ceilingHours).length;
  return oldOnArrival * 2 > measurable.length ? 'feed' : 'stale';
}

export async function computeInsights(): Promise<Insights> {
  const threads = await loadThreads();
  const gaps = await loadGaps();
  const assessments = await loadAssessments();
  const drafts = await loadDrafts();
  const reviews = await loadReviews();
  const history = await loadHistory();
  const events = await loadTrace();

  const { keep, dropped } = prefilter(threads);
  const contribute = assessments.filter((a) => a.verdict === 'contribute');
  const declines = history.filter((h) => h.kind === 'draft.declined').length;
  const noveltyBlocked = drafts.filter((d) => (d.noveltyIssues?.length ?? 0) > 0).length;

  const funnel = [
    { stage: 'collected', count: threads.length, note: 'threads on disk' },
    { stage: 'prefiltered', count: keep.length, note: `${dropped.length} dropped before any model call` },
    { stage: 'gap-analyzed', count: gaps.length, note: 'one model call each' },
    { stage: 'assessed', count: assessments.length, note: 'contribute-or-skip decided' },
    { stage: 'worth-contributing', count: contribute.length, note: 'cleared the opportunity floor' },
    { stage: 'drafted', count: drafts.length, note: `${declines} decline(s) by the model` },
    { stage: 'decided', count: reviews.length, note: 'seen by a person at the approval prompt' },
    { stage: 'published', count: drafts.filter((d) => d.status === 'published').length, note: 'live on Reddit' }
  ];

  const signals: Signal[] = [];
  const add = (s: Signal) => signals.push(s);

  /* ---- prefilter losses ---- */
  if (dropped.length) {
    /* Grouped by the rule that fired, not by a regex over its message. The prose is written
       for a person and gets rephrased; `kind` is the value the filter actually decided. */
    const WORD: Record<string, string> = {
      'too-old': 'too old', 'outside-pilot': 'wrong subreddit',
      'age-unknown': 'age unknown', 'not-a-question': 'not a question'
    };
    const reasons = new Map<string, number>();
    for (const d of dropped) {
      const key = WORD[d.kind] ?? 'not a question';
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
    const [topReason, topCount] = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const share = topCount / threads.length;
    add({
      stage: 'collect',
      severity: share > 0.4 ? 'act' : 'watch',
      finding:
        topReason === 'too old'
          ? tooOldCause(
              dropped.filter((d) => d.kind === 'too-old').map((d) => d.thread),
              policy.maxThreadAgeHoursToPublish.value
            ) === 'feed'
            ? 'most collected threads are too old to reply to — the collector is reading a feed that surfaces old posts'
            : 'most collected threads have aged past the ceiling since they were collected — the corpus is stale, collect again rather than change the sort'
          : topReason === 'not a question'
            ? 'most collected threads are not questions — the sort or the subreddit is wrong'
            : `most collected threads are dropped for: ${topReason}`,
      evidence: `${topCount} of ${threads.length} dropped as "${topReason}" before any model call`,
      n: threads.length
    });
  }

  /* ---- gap-analyzer quality ---- */
  const answered = gaps.filter((g) => g.alreadyAnswered).length;
  if (gaps.length) {
    if (answered / gaps.length > 0.4) {
      add({
        stage: 'collect',
        severity: 'watch',
        finding: 'a large share of threads are already answered by the time we read them — arrive earlier rather than read wider',
        evidence: `${answered} of ${gaps.length} analyzed threads were already adequately answered`,
        n: gaps.length
      });
    }
    const noFillable = gaps.filter((g) => !g.gaps.some((x) => x.fillable)).length;
    if (noFillable / gaps.length > 0.5) {
      add({
        stage: 'gap',
        severity: 'watch',
        finding: 'most gaps found are outside the declared competence — either the competence list is too narrow or the subreddit is a poor match',
        evidence: `${noFillable} of ${gaps.length} analyzed threads had no fillable gap`,
        n: gaps.length
      });
    }
    const meanCovered = gaps.reduce((s, g) => s + g.covered.length, 0) / gaps.length;
    if (meanCovered < 0.5) {
      add({
        stage: 'gap',
        severity: 'watch',
        finding: 'the analyzer is extracting almost no existing claims — the novelty check has nothing to test against, so it cannot catch a restatement',
        evidence: `mean ${meanCovered.toFixed(1)} covered claim(s) per analyzed thread`,
        n: gaps.length
      });
    }
  }

  /* ---- headroom disagreements: the model skipping its own bands ---- */
  const corrections = events.filter((e) => e.event === 'headroom.corrected').length;
  if (gaps.length && corrections) {
    add({
      stage: 'gap',
      severity: corrections / gaps.length > 0.3 ? 'act' : 'info',
      finding: 'the model reports a headroom score inconsistent with the gaps it just listed — the same class as DEFECT-12, contained by recomputing locally',
      evidence: `${corrections} correction(s) across ${gaps.length} analyses`,
      n: gaps.length
    });
  }

  /* ---- drafting ---- */
  if (drafts.length && noveltyBlocked) {
    add({
      stage: 'draft',
      severity: noveltyBlocked / drafts.length > 0.3 ? 'act' : 'watch',
      finding: 'drafts are restating claims already on the thread — the do-not-repeat list is being ignored by the drafting prompt',
      evidence: `${noveltyBlocked} of ${drafts.length} drafts flagged by the novelty check`,
      n: drafts.length
    });
  }
  if (declines && contribute.length) {
    add({
      stage: 'opportunity',
      severity: declines / contribute.length > 0.4 ? 'act' : 'info',
      finding: 'the model declines to draft on threads the Opportunity Engine passed — the engine is more optimistic than the drafter',
      evidence: `${declines} decline(s) against ${contribute.length} contribute verdict(s)`,
      n: contribute.length
    });
  }

  /* ---- gates ---- */
  const blocks = history.filter((h) => h.kind === 'gate.block');
  if (blocks.length) {
    const byGate = new Map<string, number>();
    for (const b of blocks) {
      for (const g of ((b.data?.gates as string[] | undefined) ?? [])) {
        byGate.set(g, (byGate.get(g) ?? 0) + 1);
      }
    }
    for (const [gate, n] of [...byGate.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
      add({
        stage: 'gate',
        severity: 'info',
        finding: `publishing is most often blocked by the "${gate}" gate`,
        evidence: `${n} block(s) across ${blocks.length} blocked attempt(s)`,
        n: blocks.length
      });
    }
  }

  /* ---- operator verdicts: the highest-value signal, once it exists ---- */
  const rs = summarizeReviews(reviews);
  if (rs.total === 0) {
    add({
      stage: 'review',
      severity: 'info',
      finding: 'no operator verdicts recorded — draft quality is currently unmeasured, and every rate derived from it reads "no data"',
      evidence: '0 decisions at the approval prompt',
      n: 0
    });
  } else {
    const top = rs.byReason.filter((r) => r.decision === 'rejected')[0];
    if (top) {
      add({
        stage: top.code === 'already-covered' ? 'gap' : top.code === 'inaccurate' ? 'draft' : 'review',
        severity: 'act',
        finding: `the most common rejection is "${top.code}" — that indicts the ${
          top.code === 'already-covered' ? 'gap analyzer\'s claim extraction'
            : top.code === 'inaccurate' ? 'drafting model on this topic'
            : top.code === 'tone' ? 'craft gate'
            : 'pipeline stage that produced it'
        }`,
        evidence: `${top.count} of ${rs.rejected} rejection(s)`,
        n: rs.total
      });
    }
  }

  /* ---- timings ---- */
  const timingMap = new Map<string, number[]>();
  for (const e of events) {
    if (e.ms == null) continue;
    const key = `${e.stage}:${e.event}`;
    const arr = timingMap.get(key) ?? [];
    arr.push(e.ms);
    timingMap.set(key, arr);
  }
  const timings: StageTiming[] = [...timingMap.entries()]
    .map(([key, xs]) => {
      const [stage, event] = key.split(':') as [string, string];
      return { stage, event, count: xs.length, medianMs: median(xs), maxMs: Math.max(...xs) };
    })
    .sort((a, b) => b.medianMs * b.count - a.medianMs * a.count);

  return {
    funnel,
    signals: signals.sort((a, b) =>
      ({ act: 0, watch: 1, info: 2 })[a.severity] - ({ act: 0, watch: 1, info: 2 })[b.severity]),
    timings,
    traceEvents: events.length,
    runs: new Set(events.map((e: TraceEvent) => e.runId)).size
  };
}
