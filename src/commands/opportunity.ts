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
import { isQuestionShaped, PILOT_SUBREDDITS, allowedSubreddits, currentAgeHours } from '../select.js';
import { policy } from '../policy.js';
import { selectedAccount } from '../config.js';
import { enabledSources } from '../sources.js';
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

/**
 * THE FILTER ADVISES. IT DOES NOT LOCK THE OPERATOR OUT.
 *
 * `opts.allowed` is the acting account's own subreddit list — see allowedSubreddits in select.ts.
 * It used to be the PILOT_SUBREDDITS constant, which meant an operator could add a source, widen
 * the account from the console, and still watch every thread refused by an array in a source file
 * they had no way to reach. Measured on 2026-08-01: r/website added in both places, 14 threads
 * still dropped as "outside the pilot set".
 *
 * `opts.force` is the override. A thread the operator has explicitly asked for skips the
 * mechanical rules and goes to assessment — because the rules are cheap proxies (does the title
 * look like a question, is this subreddit on the list) and a person reading the actual thread
 * knows things the proxies cannot. THE HUMAN HAS THE FINAL SAY, which is the same principle that
 * puts a typed SEND in front of every publish.
 *
 * What an override does NOT do: it does not publish, it does not skip certification, and it does
 * not touch the gates in src/gates.ts. It buys one thread a model call it would otherwise not
 * have had.
 */
export function prefilter(
  threads: Thread[],
  opts: { allowed?: readonly string[]; force?: ReadonlySet<string> } = {}
): { keep: Thread[]; dropped: Dropped[] } {
  const keep: Thread[] = [];
  const dropped: Dropped[] = [];
  const allowed = opts.allowed ?? (PILOT_SUBREDDITS as readonly string[]);
  const force = opts.force ?? new Set<string>();

  for (const t of threads) {
    /* Asked for by name: the mechanical rules are skipped entirely rather than argued with. */
    if (force.has(t.id)) { keep.push(t); continue; }

    const shape = isQuestionShaped(t);
    if (!shape.pass) { dropped.push({ thread: t, kind: 'not-a-question', why: shape.detail }); continue; }

    // Age as it stands now, not at collection — see currentAgeHours() for the observation.
    const ageH = currentAgeHours(t);
    if (ageH == null) { dropped.push({ thread: t, kind: 'age-unknown', why: 'age unknown — recency cannot be confirmed' }); continue; }
    if (ageH > policy.maxThreadAgeHoursToPublish.value) {
      dropped.push({ thread: t, kind: 'too-old', why: `${Math.round(ageH)}h old, past the ${policy.maxThreadAgeHoursToPublish.value}h ceiling` });
      continue;
    }

    if (!allowed.includes(t.subreddit.toLowerCase())) {
      dropped.push({
        thread: t, kind: 'outside-pilot',
        why: `r/${t.subreddit} is not one this account speaks in (${allowed.map((x) => 'r/' + x).join(', ')})`
      });
      continue;
    }

    keep.push(t);
  }
  return { keep, dropped };
}

/**
 * There was nothing to work on — which is not the same as something went wrong.
 *
 * Both of this command's early exits are "the corpus gave me nothing": no threads at all, or none
 * that survived the mechanical prefilter. They used to return 1, indistinguishable from a crash,
 * and the console — which judges a run purely by its exit code — showed six runs of "scoring did
 * not work" for a day on which scoring was never reached. The message is carried up separately now
 * (tools/product/run-outcome.mjs); this code exists so a caller can branch on the DISTINCTION
 * without parsing English. Still non-zero: nothing downstream ran, and a script must not treat
 * that as success.
 */
export const NOTHING_TO_DO = 2;

export async function opportunity(opts?: { force?: boolean; limit?: number; only?: string[]; all?: boolean }): Promise<number> {
  say.head('redbot opportunity');

  const threads = await loadThreads();
  if (!threads.length) {
    /* The FACT goes on the flagged line and the terminal-only advice on an unflagged step.
       run-outcome.mjs reports the flagged line, so the desktop console — where there is no
       terminal and the collect button is right there — no longer repeats an instruction to go
       and type a command. Someone at a prompt still gets it, one line down. */
    say.warn('No threads have been collected yet.');
    say.step('Collect some first:  redbot read <subreddit>   (or `redbot session`)');
    return NOTHING_TO_DO;
  }

  /**
   * WHERE THIS ACCOUNT MAY POST, from the account itself.
   *
   * Read here rather than baked into prefilter(), so the rule is the operator's setting and the
   * function stays testable without a database. An account that declares nothing falls back to the
   * pilot set — "speaks nowhere" must not quietly mean "speaks everywhere".
   */
  let allowed: readonly string[] = PILOT_SUBREDDITS as readonly string[];
  try {
    /**
     * The sources are read so an account that declares NO subreddits is confined to the rooms the
     * operator actually enabled, rather than to the pilot constant. Adding an account no longer
     * fills the field in for them, so "declares none" is now a normal state rather than a sign
     * that somebody deleted a default.
     */
    let enabled: string[] = [];
    try {
      enabled = (await enabledSources()).subs;
    } catch { /* an unreadable source list is not a licence to widen; the fallbacks below hold */ }

    /* `selectedAccount()` already returns the record, not a handle. */
    allowed = allowedSubreddits(selectedAccount(), enabled);
  } catch { /* no account resolvable — the fallback above is the honest answer */ }

  /**
   * `--only <id>` names threads the operator asked for by hand. They skip the mechanical rules;
   * see prefilter() for why that is a decision the person is entitled to make.
   *
   * `--all` extends the same entitlement to the whole batch. It exists because the prefilter can
   * legitimately drop EVERYTHING — a /hot feed on a slow subreddit is mostly older than the 72h
   * ceiling — and "0 pass, 20 dropped" leaves the operator unable to see what was collected at
   * all. There was no blanket override before: `--force` means "re-assess threads already
   * assessed", which is a different thing that reads like this one.
   *
   * WHAT IT DOES NOT TOUCH. The 20 publish gates, the health state, the disclosure linter and
   * certification are all downstream of here and are untouched by it. This decides what is
   * LOOKED AT, not what may be said in public — those are separate, and only the first is a
   * matter of taste.
   *
   * Nothing is hidden by it: every thread that WOULD have been dropped is still reported, with
   * the reason, so relaxing the filter costs visibility of nothing.
   */
  const forcedAll = opts?.all === true;
  const force = new Set(forcedAll ? threads.map((t) => t.id) : (opts?.only ?? []));
  const { keep, dropped } = prefilter(threads, { allowed, force });

  if (forcedAll) {
    /* Re-run the rules purely to SAY what they would have done. The operator asked to see the
       threads, not to be kept ignorant of why they are usually skipped. */
    const { dropped: wouldDrop } = prefilter(threads, { allowed });
    say.step(`${threads.length} collected · prefilter OFF (--all) · ${keep.length} kept`);
    if (wouldDrop.length) {
      const byKind = new Map<string, number>();
      for (const d of wouldDrop) byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1);
      say.step(`   ${wouldDrop.length} would normally have been dropped: ` +
        [...byKind.entries()].map(([k, n]) => `${n} ${k}`).join(' · '));
    }
  } else {
    if (force.size) say.step(`${force.size} thread(s) forced past the prefilter by request`);
    say.step(`${threads.length} collected · ${keep.length} pass the mechanical prefilter · ${dropped.length} dropped`);
  }

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
    return NOTHING_TO_DO;
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
