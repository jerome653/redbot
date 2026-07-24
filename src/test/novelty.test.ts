import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNovelty, overlapRatio, RESTATES } from '../novelty.js';
import { summarizeReviews, retentionRatio, type ReviewRecord } from '../review.js';

const COVERED = [
  'suggested disabling plugins one at a time to find the culprit',
  'said to clear the object cache before testing again'
];

test('a draft that restates an existing comment is caught', () => {
  const restatement =
    'Try disabling your plugins one at a time until you find the culprit. ' +
    'That is usually the quickest way to narrow it down.';
  const r = checkNovelty(restatement, 'disable plugins one at a time to find the culprit', COVERED);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /restates a claim/.test(i)));
});

test('a genuinely new contribution passes', () => {
  const novel =
    'Before touching plugins, read the PHP error log — a 502 on admin-ajax.php after an 8.2 ' +
    'upgrade names the fatal and the file on the first line, which skips the bisection entirely.';
  const r = checkNovelty(novel, 'the error log names the offending file, so bisection is unnecessary', COVERED);
  assert.equal(r.ok, true, `flagged: ${JSON.stringify(r.issues)}`);
});

test('a stated contribution that merely repeats a claim is caught even when the body differs', () => {
  const r = checkNovelty(
    'Read the error log first, it names the file.',
    'suggested disabling plugins one at a time to find the culprit',
    COVERED
  );
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /stated contribution matches/.test(i)));
});

test('a draft that states no contribution is refused', () => {
  const r = checkNovelty('Read the error log first, it names the file.', '   ', COVERED);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /does not say what it adds/.test(i)));
});

test('with nothing already covered, anything is novel', () => {
  const r = checkNovelty('Read the error log.', 'points at the error log', []);
  assert.equal(r.ok, true);
  assert.equal(r.maxOverlap, 0);
});

test('overlap is a ratio of the claim, not of the reply', () => {
  assert.equal(overlapRatio('cache plugin database', 'cache plugin database'), 1);
  assert.equal(overlapRatio('cache plugin database', 'nothing relevant whatsoever'), 0);
  // A long reply that happens to contain the claim still scores 1 — the question is whether
  // the claim was restated, not what proportion of the reply it occupies.
  assert.equal(overlapRatio('cache plugin', 'the cache and the plugin and much more besides'), 1);
});

test('the threshold is a declared proxy, and every issue says so', () => {
  assert.ok(RESTATES > 0 && RESTATES <= 1);
  const r = checkNovelty(
    'Disable plugins one at a time until you find the culprit.',
    'x',
    ['disabling plugins one at a time finds the culprit']
  );
  assert.ok(r.issues.every((i) => /proxy/.test(i)), 'a proxy result must be labelled at the point of use');
});

/* ---------------- review dataset ---------------- */

const review = (over: Partial<ReviewRecord> = {}): ReviewRecord => ({
  ts: new Date().toISOString(), draftId: 'd', threadId: 't', permalink: 'p',
  decision: 'approved', reasonCode: 'as-written', note: '', operator: 'docs-architect', ...over
});

test('an empty dataset reports no data rather than a flattering zero', () => {
  const s = summarizeReviews([]);
  assert.equal(s.total, 0);
  assert.equal(s.publishableRate, null);
  assert.equal(s.asWrittenRate, null);
  assert.equal(s.meanRetention, null);
});

test('publishable and as-written are different rates', () => {
  const s = summarizeReviews([
    review(),
    review({ decision: 'edited', reasonCode: 'tightened', edit: { charsBefore: 100, charsAfter: 80, retained: 0.8, before: 'x'.repeat(100), after: 'x'.repeat(80) } }),
    review({ decision: 'rejected', reasonCode: 'inaccurate' })
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.publishableRate, 2 / 3);
  assert.equal(s.asWrittenRate, 1 / 3);
  assert.equal(s.meanRetention, 0.8);
});

test('reasons are counted per decision so a pattern points at a stage', () => {
  const s = summarizeReviews([
    review({ decision: 'rejected', reasonCode: 'already-covered' }),
    review({ decision: 'rejected', reasonCode: 'already-covered' }),
    review({ decision: 'rejected', reasonCode: 'inaccurate' })
  ]);
  const top = s.byReason[0]!;
  assert.equal(top.code, 'already-covered');
  assert.equal(top.count, 2);
  assert.equal(top.decision, 'rejected');
});

test('retention measures how much of the draft survived the edit', () => {
  assert.equal(retentionRatio('cache plugin database', 'cache plugin database'), 1);
  assert.equal(retentionRatio('cache plugin database', 'completely rewritten text here'), 0);
  assert.ok(Math.abs(retentionRatio('cache plugin database', 'cache plugin') - 2 / 3) < 0.01);
});
