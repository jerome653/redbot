/**
 * Every way a cycle decides Reddit is refusing.
 *
 * The rule this pins is arithmetic, and the arithmetic is the whole rule: one failure is a source,
 * two is the host. Exercising it here rather than through auto.ts is deliberate — see the header
 * of src/collect-wall.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitCollectionWall, CONSECUTIVE_FAILURES_TO_ABORT } from '../collect-wall.js';

test('one failed source is not a wall — a subreddit may simply be quiet or private', () => {
  for (const n of [0, 1]) {
    const v = hitCollectionWall(n, 5, 25);
    assert.equal(v.abort, false, `${n} failure(s) in a row must not abort the cycle`);
    assert.equal(v.why, '', 'and there is nothing to record');
  }
});

test('two failed sources back to back is the host refusing, and the cycle stops', () => {
  const v = hitCollectionWall(2, 12, 25);
  assert.equal(v.abort, true);
  assert.match(v.why, /back to back/);
  assert.match(v.why, /13 remaining source\(s\) were not attempted/,
    'the count of what was ABANDONED is the number that shows the saving');
});

test('the threshold is 2, and it is pinned here rather than re-derived at the call site', () => {
  assert.equal(CONSECUTIVE_FAILURES_TO_ABORT, 2);
  assert.equal(hitCollectionWall(CONSECUTIVE_FAILURES_TO_ABORT - 1, 0, 25).abort, false);
  assert.equal(hitCollectionWall(CONSECUTIVE_FAILURES_TO_ABORT, 0, 25).abort, true);
});

test('a longer run still aborts, and says how long it was', () => {
  const v = hitCollectionWall(9, 24, 25);
  assert.equal(v.abort, true);
  assert.match(v.why, /^9 sources failed back to back/);
  assert.match(v.why, /1 remaining source\(s\)/);
});

test('the last source failing leaves nothing to abandon, and the count says 0 rather than -1', () => {
  /* The measured cycle failed on its 25th of 25. An off-by-one here would record a negative
     count into history, which is the kind of number that gets read as a sentinel later. */
  const v = hitCollectionWall(25, 25, 25);
  assert.equal(v.abort, true);
  assert.match(v.why, /0 remaining source\(s\)/);
});

test('every abort carries a reason, because it goes straight into the run log', () => {
  /* `collected: 0` with no row beside it reads as a quiet hour — the confusion that cost this
     pipeline its posts. The reason string IS the distinction. */
  for (const n of [2, 3, 25]) {
    const v = hitCollectionWall(n, n, 25);
    assert.ok(v.why.trim().length > 20, `an abort must explain itself: ${JSON.stringify(v.why)}`);
  }
});
