/**
 * The pick is decided against current facts, not stored ones.
 *
 * The case that produced this file, measured 2026-09-28 03:42 (draft d_d61f816d4c59_mukopknx):
 * a stored row said verdict 'contribute', score 90, while the thread it named was 75.98h old with
 * 20 answers at the moment of the decision. It outranked both of the two candidates the same run's
 * `opportunity` had just found, because 90 was written six hours earlier and nothing re-derived it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates } from '../pick.js';
import { computeHeadroom } from '../gap.js';
import { policy } from '../policy.js';
import type { Thread, GapAnalysis, OpportunityAssessment, Gap } from '../types.js';

const H = 3_600_000;

const thread = (id: string, over: Partial<Thread> = {}): Thread => ({
  id, permalink: `https://example.invalid/${id}`,
  title: 'Checkout 502s after PHP 8.2 upgrade, any idea?',
  subreddit: 'wordpress', author: 'a', upvotes: 4, commentCount: 2,
  ageText: '1 hr ago', ageMinutes: 60,
  body: 'admin-ajax.php returns 502 since the upgrade.',
  comments: [{ author: 'b', body: 'Have you cleared the cache? The log usually names the plugin.', depth: 0 }],
  collectedAt: new Date().toISOString(), source: 'read', ...over
} as unknown as Thread);

const gap = (threadId: string): GapAnalysis => {
  const gaps: Gap[] = [{ kind: 'unanswered', what: 'an unanswered gap', fillable: true }];
  return {
    threadId, permalink: `https://example.invalid/${threadId}`,
    title: 'Checkout 502s after PHP 8.2 upgrade, any idea?',
    question: 'why does checkout 502 after the upgrade',
    covered: [], alreadyAnswered: false,
    analyzedAt: new Date().toISOString(), model: 'test',
    gaps, headroom: computeHeadroom(gaps, false, true)
  } as unknown as GapAnalysis;
};

/** A stored row whose numbers are whatever we say — that is the point. */
const stored = (threadId: string, score: number): OpportunityAssessment => ({
  threadId, permalink: `https://example.invalid/${threadId}`,
  title: 'x', verdict: 'contribute', score,
  reasons: ['written under older rules'],
  assessedAt: new Date(Date.now() - 6 * H).toISOString()
} as unknown as OpportunityAssessment);

test('a stored high score is discarded — the thread is re-assessed', () => {
  /* The measured case: 75.98h old, 20 answers, stored score 90. src/opportunity.ts caps both
     violations at 10, which is under minOpportunityToPublish (40), so it must not survive. */
  const stale = thread('t_stale', {
    ageMinutes: 30 * 60,
    collectedAt: new Date(Date.now() - 46 * H).toISOString(),
    commentCount: 20
  });
  const out = rankCandidates({
    assessments: [stored('t_stale', 90)],
    threads: [stale], gaps: [gap('t_stale')], drafted: new Set()
  });
  assert.deepEqual(out, [], `a 76h/20-answer thread must not be a candidate: ${JSON.stringify(out.map((o) => o.score))}`);
});

test('a thread that still qualifies survives, with its RE-DERIVED score', () => {
  const fresh = thread('t_ok');
  const out = rankCandidates({
    assessments: [stored('t_ok', 90)],
    threads: [fresh], gaps: [gap('t_ok')], drafted: new Set()
  });
  assert.equal(out.length, 1);
  assert.notEqual(out[0]!.score, 90, 'the stored 90 must not be carried through');
  assert.ok(out[0]!.score >= policy.minOpportunityToPublish.value);
});

test('the order comes from the re-derived scores, not the stored ones', () => {
  /* Stored order says t_low first (99 vs 41). Re-derivation must reverse that: t_low's thread
     violates the answer ceiling and caps at 10, so it drops out entirely. */
  const good = thread('t_high');
  const bad = thread('t_low', { commentCount: policy.warmingMaxAnswers.value + 5 });
  const out = rankCandidates({
    assessments: [stored('t_low', 99), stored('t_high', 41)],
    threads: [good, bad], gaps: [gap('t_high'), gap('t_low')], drafted: new Set()
  });
  assert.deepEqual(out.map((o) => o.threadId), ['t_high']);
});

test('an already-drafted thread is not a candidate', () => {
  const t = thread('t_done');
  const out = rankCandidates({
    assessments: [stored('t_done', 90)],
    threads: [t], gaps: [gap('t_done')], drafted: new Set(['t_done'])
  });
  assert.deepEqual(out, []);
});

test('threadId narrows to one thread and IGNORES the drafted set', () => {
  /* `redbot draft <id>` is an explicit instruction; draft.ts:66 has always skipped the drafted
     filter in that case, and re-deriving must not quietly add it back. */
  const t = thread('t_target');
  const out = rankCandidates({
    assessments: [stored('t_target', 90), stored('t_other', 95)],
    threads: [t, thread('t_other')], gaps: [gap('t_target'), gap('t_other')],
    drafted: new Set(['t_target']), threadId: 't_target'
  });
  assert.deepEqual(out.map((o) => o.threadId), ['t_target']);
});

test('a candidate that cannot be re-assessed is dropped, not trusted', () => {
  /* No thread row, or no gap analysis — assessOpportunity cannot run, and a row that cannot be
     re-derived is exactly the row this function exists to stop believing. */
  assert.deepEqual(rankCandidates({
    assessments: [stored('t_ghost', 100)], threads: [], gaps: [gap('t_ghost')], drafted: new Set()
  }), []);
  assert.deepEqual(rankCandidates({
    assessments: [stored('t_ghost', 100)], threads: [thread('t_ghost')], gaps: [], drafted: new Set()
  }), []);
});

test('an empty store yields no candidates rather than throwing', () => {
  assert.deepEqual(rankCandidates({ assessments: [], threads: [], gaps: [], drafted: new Set() }), []);
});
