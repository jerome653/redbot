import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHeadroom, commentsHaveSubstance } from '../gap.js';
import { assessOpportunity, MIN_OPPORTUNITY_SCORE } from '../opportunity.js';
import type { Thread, Gap, GapAnalysis } from '../types.js';

const gap = (kind: Gap['kind'], fillable = true): Gap => ({ kind, what: `a ${kind} gap`, fillable });

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 't', permalink: 'https://example.invalid/t',
  title: 'Checkout 502s after PHP 8.2 upgrade, any idea?',
  subreddit: 'wordpress', author: 'a', upvotes: 4, commentCount: 3,
  ageText: '4 hr ago', ageMinutes: 240,
  body: 'admin-ajax.php returns 502 since the upgrade.',
  comments: [{ author: 'b', body: 'Have you cleared the cache? The error log usually has the plugin name.', depth: 0 }],
  collectedAt: new Date().toISOString(), source: 'read', ...over
});

/**
 * Headroom is derived from the gaps rather than set by hand, so a fixture cannot assert a
 * combination the real pipeline could never produce.
 */
const analysis = (over: Partial<GapAnalysis> = {}): GapAnalysis => {
  const gaps = over.gaps ?? [gap('unanswered')];
  const alreadyAnswered = over.alreadyAnswered ?? false;
  return {
    threadId: 't', permalink: 'https://example.invalid/t', title: 'Checkout 502s after PHP 8.2 upgrade, any idea?',
    question: 'why does checkout 502 after the upgrade',
    // Nothing said yet by default, so a test that means to exercise the gap bands is not
    // silently also exercising the coverage penalty.
    covered: [],
    alreadyAnswered,
    analyzedAt: new Date().toISOString(), model: 'test',
    ...over,
    gaps,
    headroom: over.headroom ?? computeHeadroom(gaps, alreadyAnswered, true)
  };
};

/* ---------------- headroom ---------------- */

test('headroom is computed from the gaps, in published bands', () => {
  assert.equal(computeHeadroom([gap('unanswered')], false, true), 40);
  assert.equal(computeHeadroom([gap('incorrect')], false, true), 45);
  assert.equal(computeHeadroom([gap('unanswered'), gap('incorrect')], false, true), 85);
  assert.equal(computeHeadroom([], false, true), 0);
});

test('an uncorrected wrong claim outranks a question nobody answered', () => {
  // A wrong answer left standing sends the asker backwards; an unanswered one leaves them
  // where they started. The bands, the kind weights and the report all have to agree on this.
  assert.ok(computeHeadroom([gap('incorrect')], false, true) > computeHeadroom([gap('unanswered')], false, true));
});

test('an empty discussion adds headroom', () => {
  assert.equal(computeHeadroom([gap('unanswered')], false, false), 55);
});

test('gaps we cannot fill do not count toward headroom', () => {
  assert.equal(computeHeadroom([gap('unanswered', false), gap('incorrect', false)], false, true), 0);
});

test('an already-answered thread is capped no matter how many gaps were listed', () => {
  const many = [gap('unanswered'), gap('incorrect'), gap('partial')];
  assert.equal(computeHeadroom(many, false, true), 100);   // 45 + 40 + 20, capped
  assert.ok(computeHeadroom(many, true, true) <= 15);
});

test('headroom never exceeds 100', () => {
  const all: Gap[] = ['unanswered', 'incorrect', 'partial', 'unverified', 'missing-diagnostic'].map((k) => gap(k as Gap['kind']));
  assert.ok(computeHeadroom(all, false, false) <= 100);
});

test('comment substance is judged on technical content, not length', () => {
  assert.equal(commentsHaveSubstance(thread()), true);
  assert.equal(
    commentsHaveSubstance(thread({
      comments: [
        { author: 'x', body: 'same here, following this thread because I want to know too', depth: 0 },
        { author: 'y', body: 'commenting so I can find this again later on, good luck with it', depth: 0 }
      ]
    })),
    false
  );
});

/* ---------------- opportunity ---------------- */

test('a fillable gap on a fresh question is worth contributing to', () => {
  const a = assessOpportunity(thread(), analysis());
  assert.equal(a.verdict, 'contribute');
  assert.ok(a.score >= MIN_OPPORTUNITY_SCORE);
  assert.ok(a.thesis, 'a contribute verdict must carry the case for replying');
  assert.ok(a.thesis!.whatNew.length > 0);
});

test('an uncorrected wrong answer outranks an unanswered question, end to end', () => {
  const wrong = assessOpportunity(thread(), analysis({ gaps: [gap('incorrect')] })).score;
  const unanswered = assessOpportunity(thread(), analysis({ gaps: [gap('unanswered')] })).score;
  assert.ok(wrong > unanswered, `incorrect ${wrong} should outrank unanswered ${unanswered}`);
});

test('one unanswered fillable gap is exactly the minimum real contribution', () => {
  const a = assessOpportunity(thread(), analysis({ gaps: [gap('unanswered')] }));
  assert.equal(a.score, MIN_OPPORTUNITY_SCORE);
  assert.equal(a.verdict, 'contribute');
});

test('a thread whose answer merely stops short does not clear the bar', () => {
  const a = assessOpportunity(thread(), analysis({ gaps: [gap('partial')] }));
  assert.equal(a.verdict, 'skip');
});

test('a thread already carrying many claims has less room, and scores lower', () => {
  const quiet = assessOpportunity(thread(), analysis({ covered: [] })).score;
  const busy = assessOpportunity(
    thread(),
    analysis({ covered: Array.from({ length: 10 }, (_, i) => `claim ${i}`) })
  ).score;
  assert.ok(busy < quiet, `busy thread ${busy} should score below quiet thread ${quiet}`);
  assert.ok(quiet - busy >= 20, 'ten existing claims should cost meaningfully');
});

test('a thread outside the declared competence is capped, whatever its gaps', () => {
  // Real case from 2026-07-23: a webhook de-duplication thread scored 90/100 and was assessed
  // "contribute" because 65 of 67 gaps that run came back fillable.
  const a = assessOpportunity(
    thread({
      title: 'a webhook retry from a third party broke our dedup logic',
      body: 'Duplicate records appeared after the provider retried. What is the right idempotency key?',
      comments: [{ author: 'x', body: 'we hash the payload', depth: 0 }]
    }),
    analysis({ gaps: [gap('incorrect'), gap('missing-diagnostic')] })
  );
  assert.equal(a.verdict, 'skip');
  assert.ok(a.reasons.some((r) => /outside declared competence/.test(r)));
  assert.ok(a.reasons.some((r) => /proxy/.test(r)), 'the competence check must be labelled a proxy');
});

test('an already-answered thread is skipped, and says so', () => {
  const a = assessOpportunity(thread(), analysis({ alreadyAnswered: true, headroom: 15 }));
  assert.equal(a.verdict, 'skip');
  assert.equal(a.thesis, null);
  assert.ok(a.reasons.some((r) => /already answered/.test(r)));
});

test('no fillable gap means no opportunity', () => {
  const a = assessOpportunity(thread(), analysis({ gaps: [gap('unanswered', false)], headroom: 0 }));
  assert.equal(a.verdict, 'skip');
  assert.ok(a.reasons.some((r) => /none fillable/.test(r)));
});

test('a stale thread cannot be rescued by a good gap', () => {
  const a = assessOpportunity(thread({ ageMinutes: 100 * 24 * 60 }), analysis({ headroom: 100 }));
  assert.equal(a.verdict, 'skip');
  assert.ok(a.reasons.some((r) => /past the/.test(r)));
});

test('a guide is skipped even when gaps were found in it — DEFECT-12 class', () => {
  const a = assessOpportunity(
    thread({ title: '[Guide] Hardening WordPress after a breach', body: 'Here is what I did.' }),
    analysis({ headroom: 100, gaps: [gap('unanswered'), gap('incorrect')] })
  );
  assert.equal(a.verdict, 'skip');
  assert.ok(a.reasons.some((r) => /nothing is being asked/.test(r)));
});

test('several kinds of gap score higher than one', () => {
  const one = assessOpportunity(thread(), analysis({ gaps: [gap('unanswered')] })).score;
  const two = assessOpportunity(thread(), analysis({ gaps: [gap('unanswered'), gap('missing-diagnostic')] })).score;
  assert.ok(two > one);
});

test('every assessment explains itself', () => {
  for (const a of [
    assessOpportunity(thread(), analysis()),
    assessOpportunity(thread(), analysis({ alreadyAnswered: true })),
    assessOpportunity(thread({ ageMinutes: 999_999 }), analysis())
  ]) {
    assert.ok(a.reasons.length > 0, 'an assessment with no reason is not reviewable');
    for (const r of a.reasons) assert.ok(r.length > 10);
  }
});
