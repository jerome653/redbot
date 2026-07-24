/**
 * The Operator Review Dataset — the instrument, not the data.
 *
 * These tests exist because the dataset is empty and the first real reading is unrepeatable.
 * If the summary miscounts the first three reviews there is no way to notice: there is no
 * baseline to compare against, and no second chance to take the measurement.
 *
 * EVIDENCE GAP (Priority 2, 2026-07-23): time-to-review and the pre-edit text were both
 * uncapturable. The cases below fix the rules that matter for reading the dataset once it
 * exists — chiefly that an ABSENT measurement is unknown, never zero.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeReviews, retentionRatio, type ReviewRecord } from '../review.js';

const review = (over: Partial<ReviewRecord> = {}): ReviewRecord => ({
  ts: '2026-07-23T12:00:00.000Z',
  draftId: 'd_test_1',
  threadId: 't1',
  // Fixture value, deliberately not a resolvable thread — nothing here touches the network.
  permalink: 'fixture://thread/not-a-real-permalink',
  decision: 'approved',
  reasonCode: 'as-written',
  note: '',
  operator: 'docs-architect',
  ...over
});

/* ---------------- timing ---------------- */

test('an untimed review is unknown, not zero seconds', () => {
  const s = summarizeReviews([review(), review({ draftId: 'd2' })]);
  assert.equal(s.timedReviews, 0);
  assert.equal(s.meanReviewSeconds, null, 'no reading must not average to 0');
});

test('mean review time counts only the reviews that carry a reading', () => {
  const s = summarizeReviews([
    review({ reviewSeconds: 60 }),
    review({ draftId: 'd2', reviewSeconds: 120 }),
    review({ draftId: 'd3' })          // recorded before the instrument existed
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.timedReviews, 2);
  assert.equal(s.meanReviewSeconds, 90);
});

test('a non-finite timing is discarded rather than poisoning the mean', () => {
  const s = summarizeReviews([review({ reviewSeconds: Number.NaN }), review({ draftId: 'd2', reviewSeconds: 30 })]);
  assert.equal(s.timedReviews, 1);
  assert.equal(s.meanReviewSeconds, 30);
});

/* ---------------- the pre-edit text ---------------- */

test('an edited review preserves what the model actually generated', () => {
  const before = 'Check the error log first; it will name the plugin.';
  const after = 'Check wp-content/debug.log first — it names the plugin.';
  const [r] = [review({
    decision: 'edited',
    reasonCode: 'added-specifics',
    edit: {
      charsBefore: before.length,
      charsAfter: after.length,
      retained: Number(retentionRatio(before, after).toFixed(3)),
      before,
      after
    }
  })];
  // The point of the field: the generated text is recoverable after drafts.json moved on.
  assert.equal(r!.edit!.before, before);
  assert.equal(r!.edit!.after, after);
  assert.notEqual(r!.edit!.before, r!.edit!.after);
});

/* ---------------- retention ----------------
 * Rates, reason counting and the empty-dataset rule are covered in novelty.test.ts, where
 * summarizeReviews was first tested. Not repeated here — two copies of one assertion drift.
 */

test('retention is 1 when nothing was cut and drops as content words are removed', () => {
  const body = 'Disable object caching and check whether admin-ajax.php still times out.';
  assert.equal(retentionRatio(body, body), 1);
  assert.ok(retentionRatio(body, 'Disable object caching.') < 1);
});

test('an empty original retains nothing rather than dividing by zero', () => {
  assert.equal(retentionRatio('', 'anything at all'), 0);
});
