/**
 * Fresh, quiet threads first — the ranking change that follows the karma measurement.
 *
 * MEASURED 2026-10-28 on production: 44 comments published 21–27 Oct. Of the 38 with a later score
 * check, 30 stayed at 1 (the automatic self-vote), 5 reached 2 and 3 fell to 0, and most of them sat
 * in big, busy r/webdev threads. A late answer in a crowded thread is not read, so it is not voted
 * on. These tests pin the ORDER only: what is eligible is unchanged (every thread here already
 * clears the contribution floor and the age/answer ceilings), so a cycle with no fresh thread still
 * drafts — the preference must never become a filter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates } from '../pick.js';
import { computeHeadroom } from '../gap.js';
import { policy } from '../policy.js';
import { isFresh, analysisOrder } from '../freshness.js';
import { warmingCandidates } from '../commands/warmup.js';
import type { Thread, GapAnalysis, OpportunityAssessment, Gap } from '../types.js';

const NOW = Date.now();
const FRESH_H = policy.freshThreadMaxAgeHours.value;
const FRESH_N = policy.freshThreadMaxAnswers.value;

const thread = (id: string, ageHours: number, answers: number | null): Thread => ({
  id, permalink: `https://example.invalid/${id}`,
  title: 'Checkout 502s after PHP 8.2 upgrade, any idea?',
  subreddit: 'webdev', author: 'a', upvotes: 4, commentCount: answers,
  ageText: null, ageMinutes: Math.round(ageHours * 60),
  body: 'admin-ajax.php returns 502 since the upgrade.',
  comments: [{ author: 'b', body: 'Have you cleared the cache? The log usually names the plugin.', depth: 0 }],
  collectedAt: new Date(NOW).toISOString(), source: 'read'
} as unknown as Thread);

/** `broad` adds a second fillable gap kind, which src/opportunity.ts scores +10. */
const gap = (threadId: string, broad = false): GapAnalysis => {
  const gaps: Gap[] = [{ kind: 'unanswered', what: 'an unanswered gap', fillable: true }];
  if (broad) gaps.push({ kind: 'missing-diagnostic', what: 'nobody asked for the log', fillable: true });
  return {
    threadId, permalink: `https://example.invalid/${threadId}`,
    title: 'x', question: 'why does checkout 502 after the upgrade',
    covered: [], alreadyAnswered: false, analyzedAt: new Date(NOW).toISOString(), model: 'test',
    gaps, headroom: computeHeadroom(gaps, false, true)
  } as unknown as GapAnalysis;
};

const stored = (threadId: string): OpportunityAssessment => ({
  threadId, permalink: `https://example.invalid/${threadId}`, title: 'x',
  verdict: 'contribute', score: 50, reasons: [], assessedAt: new Date(NOW).toISOString()
} as unknown as OpportunityAssessment);

const rank = (ts: Thread[], broad: ReadonlySet<string> = new Set()) => rankCandidates({
  assessments: ts.map((t) => stored(t.id)), threads: ts,
  gaps: ts.map((t) => gap(t.id, broad.has(t.id))), drafted: new Set(), now: NOW
});

test('the thresholds sit inside the hard ceilings, or the preference could never fire', () => {
  assert.ok(FRESH_H < policy.warmingMaxThreadAgeHours.value);
  assert.ok(FRESH_N < policy.warmingMaxAnswers.value);
});

test('a fresh, quiet thread outranks an older one that scored higher', () => {
  const old = thread('t_old', 12, 1);
  const young = thread('t_young', 2, 1);
  const out = rank([old, young], new Set(['t_old']));
  const score = Object.fromEntries(out.map((o) => [o.threadId, o.score]));
  assert.ok(score.t_old! > score.t_young!, `precondition: the old thread must score higher (${JSON.stringify(score)})`);
  assert.deepEqual(out.map((o) => o.threadId), ['t_young', 't_old']);
});

test('a young but busy thread does not get the fresh preference', () => {
  const busy = thread('t_busy', 1, FRESH_N + 2);
  const quiet = thread('t_quiet', 4, 1);
  const out = rank([busy, quiet], new Set(['t_busy']));
  assert.deepEqual(out.map((o) => o.threadId), ['t_quiet', 't_busy']);
});

test('equal scores in the same tier: the younger thread first', () => {
  const out = rank([thread('t_5h', 5, 0), thread('t_1h', 1, 0)]);
  assert.equal(out[0]!.score, out[1]!.score);
  assert.deepEqual(out.map((o) => o.threadId), ['t_1h', 't_5h']);
});

test('no fresh thread at all: candidates are still returned, by score — a preference, not a filter', () => {
  const a = thread('t_a', 10, 3);
  const b = thread('t_b', 20, 3);
  const out = rank([a, b], new Set(['t_b']));
  assert.deepEqual(out.map((o) => o.threadId), ['t_b', 't_a']);
});

test('the fresh preference is said out loud in the reasons', () => {
  const out = rank([thread('t_f', 2, 1)]);
  assert.ok(out[0]!.reasons.some((r) => /fresh/i.test(r)), JSON.stringify(out[0]!.reasons));
});

test('isFresh: under both thresholds; unknown age or unknown answer count is not fresh', () => {
  assert.equal(isFresh(thread('x', FRESH_H - 1, 0), NOW), true);
  assert.equal(isFresh(thread('x', FRESH_H + 1, 0), NOW), false);
  assert.equal(isFresh(thread('x', 1, FRESH_N), NOW), true, 'the max is inclusive, like warmingMaxAnswers');
  assert.equal(isFresh(thread('x', 1, FRESH_N + 1), NOW), false);
  assert.equal(isFresh(thread('x', 1, null), NOW), false);
  assert.equal(isFresh({ ...thread('x', 1, 0), ageMinutes: null }, NOW), false);
});

test('analysisOrder: the gap-analysis queue takes fresh threads first, then the youngest', () => {
  /* Input order is collected_at DESC (src/db/threads.ts), which is what the queue used before. */
  const ts = [thread('stale', 30, 1), thread('busy', 1, FRESH_N + 1), thread('fresh4', 4, 1),
    thread('noage', 0, 0), thread('fresh1', 1, 2)];
  (ts[3] as { ageMinutes: number | null }).ageMinutes = null;
  assert.deepEqual(analysisOrder(ts, NOW).map((t) => t.id), ['fresh1', 'fresh4', 'busy', 'stale', 'noage']);
});

test('warming: a quiet thread under the fresh line beats a younger crowded one', () => {
  const ts = [thread('crowded', 1, FRESH_N + 2), thread('quiet', 3, 1)];
  assert.deepEqual(warmingCandidates(ts, new Set(), NOW, 100).map((r) => r.t.id), ['quiet', 'crowded']);
});
