/**
 * Phase 3 — the Operator Review Dataset.
 *
 * Every decision a person makes at the approval prompt is recorded with a structured reason,
 * appended to `data/reviews.jsonl`. Free text alone would be unanalysable; a code alone would
 * lose the detail. Both are captured, and the code list is fixed so the dataset can be counted.
 *
 * What this is for, in order of how soon it pays off:
 *   1. It makes "the drafts are pretty good" a measurable claim instead of an impression.
 *   2. Rejection codes point at the specific stage that failed — a run of `already-covered`
 *      indicts the gap analyzer, a run of `inaccurate` indicts the drafting prompt, a run of
 *      `tone` indicts the craft gate.
 *   3. It is the only way to re-fit the thresholds that are currently declared rather than
 *      measured (novelty's RESTATES, the confidence floor) against real human judgement.
 *
 * The snapshot of gates and metrics is taken at decision time, so a later change to a
 * threshold cannot silently rewrite the history of what a person was looking at.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, ensureData } from './config.js';
import type { QualityMetrics } from './quality.js';

import { getPool } from './db.js';
import { insertReview, selectReviews, insertRegret, selectRegrets } from './db/logs.js';

export const reviewsPath = join(DATA, 'reviews.jsonl');

export type Decision = 'approved' | 'edited' | 'rejected';

/**
 * Fixed vocabularies. Adding a code is a deliberate act — an "other" bucket that fills up is
 * a signal that the list is wrong, and that signal is worth keeping.
 */
export const REJECT_REASONS = {
  inaccurate: 'technically wrong, or would not do what it says',
  'already-covered': 'the thread already says this',
  'not-confident': 'cannot tell whether it is right',
  'off-topic': 'does not answer what was asked',
  'adds-nothing': 'correct but not worth posting',
  tone: 'wrong register for the room',
  'too-long': 'padded, or longer than the answer needs',
  unsafe: 'would expose the operator or the employer',
  other: 'something else — say what in the note'
} as const;

export const EDIT_REASONS = {
  tightened: 'cut length without changing the substance',
  'corrected-fact': 'fixed something wrong',
  'added-specifics': 'added a detail the draft was missing',
  'removed-filler': 'stripped padding or a stock phrase',
  tone: 'adjusted register',
  restructured: 'same content, better order',
  other: 'something else — say what in the note'
} as const;

export const APPROVE_REASONS = {
  'as-written': 'publishable exactly as generated',
  'minor-nits': 'good enough to post, with reservations noted'
} as const;

export type RejectReason = keyof typeof REJECT_REASONS;
export type EditReason = keyof typeof EDIT_REASONS;
export type ApproveReason = keyof typeof APPROVE_REASONS;

export interface ReviewRecord {
  ts: string;
  draftId: string;
  threadId: string;
  permalink: string;
  decision: Decision;
  /** One of the fixed vocabularies above, chosen by the operator. */
  reasonCode: string;
  /** What the operator typed. May be empty. */
  note: string;
  operator: string | null;
  /**
   * Seconds from the draft appearing at the prompt to the operator pressing a/e/r.
   *
   * EVIDENCE GAP (Priority 2, 2026-07-23): "time to review" is a required measurement and
   * **nothing in the system timestamped the prompt**, so it could not be reconstructed after
   * the fact from any log. A reading taken after the first review is a reading of the second
   * review. Captured at the moment or lost.
   */
  reviewSeconds?: number;
  /** Seconds from the prompt to the review record being complete — includes typing an edit
   *  and choosing a reason code. `reviewSeconds` is the judgement; this is the whole task. */
  totalSeconds?: number;
  /** Set on 'edited' — how much of the draft survived. */
  edit?: {
    charsBefore: number;
    charsAfter: number;
    /** Share of the original's content words kept, 0-1. */
    retained: number;
    /**
     * The generated text, verbatim, and what it became.
     *
     * EVIDENCE GAP (Priority 2, 2026-07-23): `reply` overwrites `draft.body` with the edited
     * text and saves it, so before this field the model's actual output was destroyed the
     * moment a human improved it. Only two integers survived. "Number of corrections", and
     * every later question of the form "what do humans keep changing", needs the two texts.
     *
     * reviews.jsonl is append-only, so this is the durable copy — drafts.json can be edited
     * again.
     */
    before: string;
    after: string;
  };
  /** Snapshot at decision time. */
  quality?: QualityMetrics;
  gates?: { allowed: boolean; blocked: string[] };
  novelty?: { ok: boolean; maxOverlap: number; issues: string[] };
  /** The case the draft made for itself, so it can be compared against the verdict. */
  contribution?: { whyThread: string; whatNew: string; whyNotSilent: string };
}

/* ------------------------------------------------------------------ *
 * Phase C / Human Regret
 *
 * Added under the MVP freeze on an explicit operator instruction, not on an engineering
 * hunch. It introduces no engine and no score: two questions, asked of a person, appended to
 * a log. Everything derived from it is a count.
 *
 * The bet behind it: the product depends on a knowledgeable person remaining willing to have
 * their name on the contribution AFTER seeing how it landed. Every automated check in this
 * repo — linter, craft gate, novelty, opportunity score — is a proxy for that. This measures
 * it directly, which is why one honest answer here outweighs any number of proxy scores.
 * ------------------------------------------------------------------ */

/** Phase C, asked immediately after publishing. */
export const STANDALONE_ANSWERS = {
  yes: 'I would post this myself, with no automation involved',
  no: 'I would not have posted this on my own'
} as const;

/** Phase C classification when the answer is "no". */
export const ISSUE_CATEGORIES = {
  technical: 'the content is wrong, thin, or would not work',
  writing: 'the content is right but badly expressed',
  opportunity: 'the thread was not worth replying to',
  timing: 'right reply, wrong moment',
  safety: 'it exposes the operator or the employer',
  confidence: 'I am not sure enough to stand behind it'
} as const;

/** Phase C+ / Human Regret, asked 24 hours after publishing. */
export const REGRET_ANSWERS = {
  unchanged: 'Yes, unchanged — still comfortable having my name on it',
  'would-edit': "Yes, but I'd edit it",
  'would-delete': "No, I'd delete it"
} as const;

export type RegretAnswer = keyof typeof REGRET_ANSWERS;
export type IssueCategory = keyof typeof ISSUE_CATEGORIES;

export const regretPath = join(DATA, 'regret.jsonl');

export interface RegretRecord {
  ts: string;
  draftId: string;
  threadId: string;
  permalink: string;
  /** 'standalone' is the Phase C question at publish time; 'regret' is the 24h question. */
  kind: 'standalone' | 'regret';
  /** 'yes'/'no' for standalone; a RegretAnswer for regret. */
  answer: string;
  category?: IssueCategory;
  /** What the operator learned. The only field in the evidence log a machine cannot fill. */
  lessons: string;
  hoursAfterPublish: number;
  operator: string | null;
}

export async function recordRegret(r: Omit<RegretRecord, 'ts'>): Promise<RegretRecord> {
  const full: RegretRecord = { ts: new Date().toISOString(), ...r };
  await insertRegret(getPool(), full);
  return full;
}

export async function loadRegrets(): Promise<RegretRecord[]> {
  return selectRegrets(getPool());
}

export interface RegretSummary {
  standaloneAsked: number;
  standaloneYes: number;
  regretAsked: number;
  unchanged: number;
  wouldEdit: number;
  wouldDelete: number;
  /** unchanged / regretAsked. null when nothing has been asked. */
  standBehindRate: number | null;
  byCategory: Array<{ category: string; count: number }>;
}

export function summarizeRegret(records: RegretRecord[]): RegretSummary {
  const standalone = records.filter((r) => r.kind === 'standalone');
  const regret = records.filter((r) => r.kind === 'regret');
  const counts = new Map<string, number>();
  for (const r of records) {
    if (r.category) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  }
  const unchanged = regret.filter((r) => r.answer === 'unchanged').length;
  return {
    standaloneAsked: standalone.length,
    standaloneYes: standalone.filter((r) => r.answer === 'yes').length,
    regretAsked: regret.length,
    unchanged,
    wouldEdit: regret.filter((r) => r.answer === 'would-edit').length,
    wouldDelete: regret.filter((r) => r.answer === 'would-delete').length,
    standBehindRate: regret.length ? unchanged / regret.length : null,
    byCategory: [...counts.entries()].map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
  };
}

export async function recordReview(r: Omit<ReviewRecord, 'ts'>): Promise<ReviewRecord> {
  const full: ReviewRecord = { ts: new Date().toISOString(), ...r };
  await insertReview(getPool(), full);
  return full;
}

export async function loadReviews(): Promise<ReviewRecord[]> {
  return selectReviews(getPool());
}

/** Share of the original's content words still present after an edit. */
export function retentionRatio(before: string, after: string): number {
  const words = (s: string) =>
    new Set((s.toLowerCase().match(/[a-z0-9_][a-z0-9_.\-/]{2,}/g) ?? []).filter((w) => w.length >= 4));
  const a = words(before);
  if (!a.size) return 0;
  const b = words(after);
  let kept = 0;
  for (const w of a) if (b.has(w)) kept++;
  return kept / a.size;
}

export interface ReviewSummary {
  total: number;
  approved: number;
  edited: number;
  rejected: number;
  /** approved + edited, over all decided. null when nothing has been decided. */
  publishableRate: number | null;
  /** approved with no edit, over all decided — the "little or no editing" figure. */
  asWrittenRate: number | null;
  byReason: Array<{ code: string; decision: Decision; count: number }>;
  /** Mean retention across edited drafts. */
  meanRetention: number | null;
  /** Mean seconds from prompt to decision, over reviews that recorded it. */
  meanReviewSeconds: number | null;
  /** How many reviews carry a timing reading. Reviews recorded before the instrumentation
   *  landed have none, and must not be counted as "reviewed in 0 seconds". */
  timedReviews: number;
}

export function summarizeReviews(reviews: ReviewRecord[]): ReviewSummary {
  const total = reviews.length;
  const approved = reviews.filter((r) => r.decision === 'approved').length;
  const edited = reviews.filter((r) => r.decision === 'edited').length;
  const rejected = reviews.filter((r) => r.decision === 'rejected').length;

  const counts = new Map<string, { code: string; decision: Decision; count: number }>();
  for (const r of reviews) {
    const key = `${r.decision}:${r.reasonCode}`;
    const hit = counts.get(key);
    if (hit) hit.count++;
    else counts.set(key, { code: r.reasonCode, decision: r.decision, count: 1 });
  }

  const retentions = reviews
    .map((r) => r.edit?.retained)
    .filter((x): x is number => typeof x === 'number');

  // Only reviews that actually carry a reading. An absent timing is unknown, not zero —
  // the same rule the policy table applies to unmeasured limits.
  const timings = reviews
    .map((r) => r.reviewSeconds)
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x));

  return {
    total,
    approved,
    edited,
    rejected,
    publishableRate: total ? (approved + edited) / total : null,
    asWrittenRate: total ? approved / total : null,
    byReason: [...counts.values()].sort((a, b) => b.count - a.count),
    meanRetention: retentions.length
      ? retentions.reduce((a, b) => a + b, 0) / retentions.length
      : null,
    meanReviewSeconds: timings.length
      ? timings.reduce((a, b) => a + b, 0) / timings.length
      : null,
    timedReviews: timings.length
  };
}
