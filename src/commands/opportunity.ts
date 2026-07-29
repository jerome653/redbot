/**
 * `redbot opportunity [--force] [--limit N]`
 *
 * Phase 3's decision stage: for each candidate thread, work out what the discussion is
 * missing, then decide mechanically whether there is anything worth adding.
 *
 * **Mechanical prefilter first.** A gap analysis costs a model call of roughly 25 seconds. A
 * thread that is eight years old, or is a guide rather than a question, or is in a subreddit
 * outside the pilot set, is disqualified by facts already on disk — spending a model call to
 * discover that would be paying to re-learn something known. Only threads that survive the
 * prefilter are analyzed, and the ones dropped are reported with the reason.
 */
import { loadThreads, loadGaps, saveGaps, loadAssessments, saveAssessments } from '../store.js';
import { analyzeGap } from '../gap.js';
import { assessOpportunity, MIN_OPPORTUNITY_SCORE } from '../opportunity.js';
import { isQuestionShaped, PILOT_SUBREDDITS, currentAgeHours } from '../select.js';
import { policy } from '../policy.js';
import { trace, timed } from '../trace.js';
import { record, say } from '../log.js';
import { getPool } from '../db.js';
import { savePrefilterOutcome } from '../db/prefilter.js';
import type { Thread, GapAnalysis, OpportunityAssessment } from '../types.js';

/**
 * WHICH rule caught a thread, as a value rather than as prose.
 *
 * `why` is written for a person and changes whenever the wording improves. Anything that needs
 * to GROUP drops — the console's breakdown, `insights.ts` — needs a key that does not move, and
 * before this existed insights.ts recovered one by running regexes over the sentence
 * (`/past the/.test(d.why)`). That silently reclassifies every drop the day somebody rephrases
 * a message, which is the sort of bug nobody notices because the number still looks plausible.
 */
export type DropKind = 'not-a-question' | 'age-unknown' | 'too-old' | 'outside-pilot';

export interface Dropped {
  thread: Thread;
  kind: DropKind;
  why: string;
}

export function prefilter(threads: Thread[]): { keep: Thread[]; dropped: Dropped[] } {
  const keep: Thread[] = [];
  const dropped: Dropped[] = [];

  for (const t of threads) {
    const shape = isQuestionShaped(t);
    if (!shape.pass) { dropped.push({ thread: t, kind: 'not-a-question', why: shape.detail }); continue; }

    // Age as it stands now, not at collection — see currentAgeHours() for the observation.
    const ageH = currentAgeHours(t);
    if (ageH == null) { dropped.push({ thread: t, kind: 'age-unknown', why: 'age unknown — recency cannot be confirmed' }); continue; }
    if (ageH > policy.maxThreadAgeHoursToPublish.value) {
      dropped.push({ thread: t, kind: 'too-old', why: `${Math.round(ageH)}h old, past the ${policy.maxThreadAgeHoursToPublish.value}h ceiling` });
      continue;
    }

    if (!(PILOT_SUBREDDITS as readonly string[]).includes(t.subreddit.toLowerCase())) {
      dropped.push({ thread: t, kind: 'outside-pilot', why: `r/${t.subreddit} is outside the pilot set` });
      continue;
    }

    keep.push(t);
  }
  return { keep, dropped };
}

export async function opportunity(opts?: { force?: boolean; limit?: number }): Promise<number> {
  say.head('redbot opportunity');

  const threads = await loadThreads();
  if (!threads.length) {
    say.warn('No threads collected. Run `redbot session` or `redbot read` first.');
    return 1;
  }

  const { keep, dropped } = prefilter(threads);
  say.step(`${threads.length} collected · ${keep.length} pass the mechanical prefilter · ${dropped.length} dropped`);

  /**
   * Written down, not just printed.
   *
   * This verdict used to exist for the length of one terminal line. The console could then
   * only report "71 never assessed" — a number nobody can act on — while the reason that would
   * have told them their collector is reading the wrong subreddits was already computed and
   * thrown away. Recording it costs one statement per dropped thread, once per run.
   *
   * Fails SOFT on purpose: this is a reporting aid, and a database hiccup must not stop the
   * actual work of assessing threads. The run says so and carries on.
   */
  try {
    await savePrefilterOutcome(
      getPool(),
      dropped.map((d) => ({ threadId: d.thread.id, kind: d.kind, detail: d.why })),
      keep.map((t) => t.id)
    );
  } catch (e) {
    say.warn(`The prefilter reasons could not be recorded: ${e instanceof Error ? e.message : String(e)}`);
    say.step('The run continues — this only affects the breakdown the console shows.');
  }

  if (dropped.length) {
    const WORD: Record<DropKind, string> = {
      'too-old': 'too old', 'outside-pilot': 'wrong subreddit',
      'age-unknown': 'age unknown', 'not-a-question': 'not a question'
    };
    const byReason = new Map<string, number>();
    for (const d of dropped) byReason.set(WORD[d.kind], (byReason.get(WORD[d.kind]) ?? 0) + 1);
    for (const [why, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
      say.step(`   dropped ${n}: ${why}`);
    }
  }

  if (!keep.length) {
    say.warn('Nothing survives the prefilter. Collect fresher threads rather than relaxing it.');
    return 1;
  }

  const existing = new Map((await loadGaps()).map((g) => [g.threadId, g]));
  const todo = (opts?.force ? keep : keep.filter((t) => !existing.has(t.id)))
    .slice(0, opts?.limit ?? 15);

  if (!todo.length) {
    say.step('Every candidate already has a gap analysis. Re-run with --force to redo them.');
  }

  const gaps: GapAnalysis[] = [];
  const corrections: string[] = [];

  for (const d of dropped) {
    trace('collect', 'thread.dropped', { why: d.why, subreddit: d.thread.subreddit }, { threadId: d.thread.id, level: 'debug' });
  }

  for (const [i, thread] of todo.entries()) {
    say.step(`[${i + 1}/${todo.length}] ${thread.title.slice(0, 62)}`);
    try {
      const { analysis, headroomCorrected } = await timed(
        'gap', 'gap.analyzed', () => analyzeGap(thread), { threadId: thread.id }
      );
      gaps.push(analysis);
      existing.set(analysis.threadId, analysis);
      // Persist each analysis as it lands. A gap call costs ~25-70s, so batching the write
      // until the end of the loop means a crash on thread 12 discards eleven minutes of
      // completed work. Same reasoning as DEFECT-04: isolate the unit, keep what succeeded.
      await saveGaps([analysis]);

      trace('gap', 'gap.result', {
        covered: analysis.covered.length,
        gaps: analysis.gaps.length,
        fillable: analysis.gaps.filter((g) => g.fillable).length,
        kinds: analysis.gaps.map((g) => g.kind),
        headroom: analysis.headroom,
        alreadyAnswered: analysis.alreadyAnswered
      }, { threadId: thread.id });

      if (headroomCorrected) {
        corrections.push(
          `${thread.id}: model said headroom ${headroomCorrected.from}, its own gaps compute to ${headroomCorrected.to}`
        );
        trace('gap', 'headroom.corrected', headroomCorrected, { threadId: thread.id, level: 'warn' });
      }

      const fillable = analysis.gaps.filter((g) => g.fillable).length;
      say.step(
        `        ${analysis.covered.length} claim(s) already made · ${analysis.gaps.length} gap(s), ${fillable} fillable · ` +
        `headroom ${analysis.headroom}${analysis.alreadyAnswered ? ' · already answered' : ''}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      say.warn(`        gap analysis failed: ${msg.slice(0, 120)}`);
      await record('error', `gap analysis failed for ${thread.id}: ${msg.slice(0, 200)}`);
    }
  }

  if (gaps.length) await saveGaps(gaps);

  if (corrections.length) {
    say.warn(`${corrections.length} headroom score(s) recomputed locally from the model's own gaps:`);
    for (const c of corrections) say.warn(`  ${c}`);
  }

  /* ---- assess everything that has a gap analysis ---- */
  const assessments: OpportunityAssessment[] = [];
  for (const thread of keep) {
    const gap = existing.get(thread.id);
    if (!gap) continue;
    const a = assessOpportunity(thread, gap);
    assessments.push(a);
    trace('opportunity', 'assessed', {
      verdict: a.verdict, score: a.score, headroom: gap.headroom, reasons: a.reasons
    }, { threadId: thread.id });
  }
  if (assessments.length) await saveAssessments(assessments);

  const contribute = assessments.filter((a) => a.verdict === 'contribute');

  say.info('');
  say.ok(`${contribute.length} of ${assessments.length} assessed threads are worth contributing to (floor ${MIN_OPPORTUNITY_SCORE}/100)`);
  for (const a of contribute.sort((x, y) => y.score - x.score)) {
    say.info('');
    say.step(`${a.score}/100 · ${a.threadId} · ${a.title.slice(0, 64)}`);
    for (const r of a.reasons) say.step(`        ${r}`);
    if (a.thesis) say.step(`        adds: ${a.thesis.whatNew}`);
  }

  if (!contribute.length) {
    say.info('');
    say.warn('Nothing clears the bar. A system that finds an opportunity in every thread has not found any.');
  }

  await record('opportunity', `${contribute.length}/${assessments.length} worth contributing to`, {
    collected: threads.length,
    prefiltered: keep.length,
    analyzed: gaps.length,
    contribute: contribute.length,
    headroomCorrections: corrections.length
  });

  const total = (await loadAssessments()).length;
  say.info('');
  say.step(`${total} assessment(s) on record. Next: redbot draft`);
  return 0;
}
