/**
 * Phase 3 — the Knowledge Gap Analyzer.
 *
 * Establishes what a discussion already contains and what it is missing, BEFORE anything is
 * drafted. The ordering is the entire point. A reply written first and justified afterwards
 * will always find a justification; a gap established first can come back empty, and "this
 * thread is already answered" is a result rather than a failure.
 *
 * Output feeds three things:
 *   - the opportunity score (src/opportunity.ts), which is mechanical over these fields;
 *   - the drafting prompt, which receives `covered` as an explicit do-not-repeat list;
 *   - the novelty check (src/novelty.ts), which tests the finished draft against `covered`.
 *
 * The model's `headroom` number is recomputed locally from the gaps it returned, so a model
 * that reports gaps and then invents a score inconsistent with them is corrected rather than
 * believed. That correction is recorded.
 */
import { complete, extractJson } from './llm.js';
import { gapPrompt } from './prompts.js';
import { config } from './config.js';
import type { Thread, GapAnalysis, Gap } from './types.js';

interface RawGap {
  question?: unknown;
  covered?: unknown;
  gaps?: unknown;
  alreadyAnswered?: unknown;
  headroom?: unknown;
}

const KINDS: Gap['kind'][] = ['unanswered', 'partial', 'incorrect', 'unverified', 'missing-diagnostic'];

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v.trim() : fallback);

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter((x) => x.length > 0) : [];

function parseGaps(v: unknown): Gap[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((g): Gap | null => {
      if (!g || typeof g !== 'object') return null;
      const o = g as Record<string, unknown>;
      const kind = str(o.kind) as Gap['kind'];
      const what = str(o.what);
      if (!what || !KINDS.includes(kind)) return null;
      return { kind, what, fillable: o.fillable === true };
    })
    .filter((g): g is Gap => g !== null);
}

/**
 * The headroom bands from the prompt, applied locally.
 *
 * Same reasoning as DEFECT-12: a band the model is asked to compute is a band the model can
 * skip. Computing it here from the structured gaps makes the number a function of the
 * evidence rather than a claim about it.
 */
export function computeHeadroom(gaps: Gap[], alreadyAnswered: boolean, commentsHaveContent: boolean): number {
  const fillable = gaps.filter((g) => g.fillable);
  let score = 0;
  // An incorrect claim standing unchallenged, or a thread nobody has asked the diagnostic
  // question in, is where a knowledgeable reply changes the outcome most. Ranked above an
  // unanswered question, which at least leaves the asker where they started.
  if (fillable.some((g) => g.kind === 'incorrect' || g.kind === 'missing-diagnostic')) score += 45;
  if (fillable.some((g) => g.kind === 'unanswered')) score += 40;
  if (fillable.some((g) => g.kind === 'partial' || g.kind === 'unverified')) score += 20;
  if (!commentsHaveContent) score += 15;
  score = Math.min(100, score);
  return alreadyAnswered ? Math.min(15, score) : score;
}

/**
 * Do the comments contain anything technical, or is it noise?
 *
 * Substance is naming a thing — a file, a version, a setting, an error. Length is not a
 * proxy for it: "the error log will name the plugin" is 34 characters and is the most useful
 * comment on many threads, while four paragraphs of "same here, following" is noise.
 */
export function commentsHaveSubstance(thread: Thread): boolean {
  const text = thread.comments.map((c) => c.body).join(' ');
  if (!text.trim()) return false;
  return /[a-z0-9_-]+\.(?:php|js|css|json|log|htaccess)|\b\d+\.\d+\b|\berror\b|\bplugin\b|\bcache\b|\bdatabase\b|\bserver\b/i.test(text);
}

export interface AnalyzeGapResult {
  analysis: GapAnalysis;
  /** Set when the model's own headroom disagreed with the bands its gaps imply. */
  headroomCorrected: { from: number; to: number } | null;
}

export async function analyzeGap(thread: Thread): Promise<AnalyzeGapResult> {
  const raw = await complete({
    prompt: gapPrompt(thread),
    model: config.llm.analyzeModel,
    maxTokens: 1600,
    temperature: 0
  });

  const parsed = extractJson<RawGap>(raw);
  const gaps = parseGaps(parsed.gaps);
  const alreadyAnswered = parsed.alreadyAnswered === true;
  const substance = commentsHaveSubstance(thread);

  const claimed = typeof parsed.headroom === 'number' && Number.isFinite(parsed.headroom)
    ? Math.max(0, Math.min(100, Math.round(parsed.headroom)))
    : null;
  const computed = computeHeadroom(gaps, alreadyAnswered, substance);

  const analysis: GapAnalysis = {
    threadId: thread.id,
    permalink: thread.permalink,
    title: thread.title,
    question: str(parsed.question, thread.title),
    covered: strList(parsed.covered),
    gaps,
    alreadyAnswered,
    headroom: computed,
    analyzedAt: new Date().toISOString(),
    model: config.llm.analyzeModel
  };

  return {
    analysis,
    headroomCorrected: claimed !== null && claimed !== computed ? { from: claimed, to: computed } : null
  };
}
