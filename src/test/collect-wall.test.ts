/**
 * Every way a cycle decides Reddit is refusing.
 *
 * The rule this pins is arithmetic, and the arithmetic is the whole rule: one failure is a source,
 * two is the host. Exercising it here rather than through auto.ts is deliberate — see the header
 * of src/collect-wall.ts.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  hitCollectionWall, collectionWall, classifySourceExit,
  CONSECUTIVE_FAILURES_TO_ABORT, CONSECUTIVE_THROTTLES_TO_ABORT, runSources,
  type CollectRunState, type SourceRun, type RunSourcesDeps
} from '../collect-wall.js';
import { OK, FAILED, NOTHING_TO_DO, THROTTLED } from '../exit-codes.js';

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

/**
 * MEASURED 2026-11-03, 23:49:21Z and 23:49:22Z: two 429s one second apart, then "collection
 * abandoned after 2 failures in a row". Two cycles were abandoned that day for being throttled.
 * These pin the split that makes that impossible — a throttle is a wait, a fault is a wall.
 */
describe('a throttle is not a fault', () => {
  const state = (p: Partial<CollectRunState>): CollectRunState =>
    ({ faultsInARow: 0, throttlesInARow: 0, done: 12, total: 25, ...p });

  test('THE MEASURED CASE: two throttled reads do not abandon the cycle', () => {
    const v = collectionWall(state({ throttlesInARow: 2 }));
    assert.equal(v.abort, false,
      'this is the 23:49:22Z row that cost a whole cycle of collection');
    assert.equal(v.why, '');
  });

  test('and the throttles do not have to be the only thing that happened', () => {
    /* A cycle that collected, was throttled twice, then collected again. Nothing about that is a
       wall, and the old rule would have ended it at the second throttle. */
    const v = collectionWall(state({ throttlesInARow: 2, faultsInARow: 1 }));
    assert.equal(v.abort, false);
  });

  test('two real faults back to back still abort, with the wording that is already on record', () => {
    const v = collectionWall(state({ faultsInARow: 2 }));
    assert.equal(v.abort, true);
    assert.match(v.why, /back to back/, 'the fault rule is unchanged, including what it says');
    assert.match(v.why, /13 remaining source\(s\)/);
  });

  test('the throttle threshold is higher than the fault threshold, and that is the fix', () => {
    assert.ok(CONSECUTIVE_THROTTLES_TO_ABORT > CONSECUTIVE_FAILURES_TO_ABORT,
      'if these were equal, two throttles would abandon a cycle again');
    assert.equal(collectionWall(state({ throttlesInARow: CONSECUTIVE_THROTTLES_TO_ABORT - 1 })).abort, false);
    assert.equal(collectionWall(state({ throttlesInARow: CONSECUTIVE_THROTTLES_TO_ABORT })).abort, true);
  });

  test('an account-wide throttle does eventually stop the cycle, and says so in its own words', () => {
    const v = collectionWall(state({ throttlesInARow: 4, done: 20, total: 25 }));
    assert.equal(v.abort, true);
    assert.match(v.why, /rate limit on the account, not on one source/);
    assert.match(v.why, /5 remaining source\(s\)/);
    assert.ok(!/back to back/.test(v.why),
      'a throttle wall and a fault wall send a person to different places and must not read alike');
  });

  test('an exit code is read as one of four things, and only one of them is a fault', () => {
    assert.equal(classifySourceExit(OK), 'ok');
    assert.equal(classifySourceExit(NOTHING_TO_DO), 'nothing',
      'a search that found nothing usable is not Reddit refusing — src/test/search.test.ts:124');
    assert.equal(classifySourceExit(THROTTLED), 'throttled');
    assert.equal(classifySourceExit(FAILED), 'fault');
    assert.equal(classifySourceExit(99), 'fault', 'an unknown code is a fault, never a throttle');
  });
});

describe('the cycle walks its sources', () => {
  /** A scripted cycle: each source returns the exit code given. */
  function harness(codes: readonly number[]) {
    const ran: string[] = [];
    const slept: number[] = [];
    const abandons: Array<{ why: string; reason: string; abandoned: number }> = [];
    const sources: SourceRun[] = codes.map((code, i) => ({
      step: `source ${i}`,
      run: async () => { ran.push(`s${i}`); return code; }
    }));
    const deps: RunSourcesDeps = {
      async onAbandon(why, info) { abandons.push({ why, reason: info.reason, abandoned: info.abandoned }); },
      async sleep(ms) { slept.push(ms); },
      backoff: (n) => 1000 * 2 ** (n - 1)
    };
    return { sources, deps, ran, slept, abandons };
  }

  test('THE MEASURED CASE: two throttled sources, and the rest are still collected', async () => {
    /* 2026-11-03 23:49:21Z r/bigseo and 23:49:22Z r/webdev, then the cycle gave up with sources
       still on the list. Those two are s1 and s2 here. */
    const h = harness([OK, THROTTLED, THROTTLED, OK, OK]);
    const out = await runSources(h.sources, h.deps);

    assert.deepEqual(h.ran, ['s0', 's1', 's2', 's3', 's4'],
      'every source must still be asked — this is the cycle that was thrown away');
    assert.deepEqual(h.abandons, [], 'and nothing was abandoned, so no row says it was');
    assert.equal(out.abandoned, 0);
    assert.equal(out.throttled, 2);
    assert.equal(out.attempted, 5);
  });

  test('each throttle buys a longer wait before the next source is asked', async () => {
    const h = harness([THROTTLED, THROTTLED, OK]);
    const out = await runSources(h.sources, h.deps);

    assert.deepEqual(h.slept, [1000, 2000], 'the second refusal waits longer than the first');
    assert.equal(out.waitedMs, 3000);
  });

  test('nothing waits after the last source — a wait buys time for a request still to come', async () => {
    const h = harness([OK, THROTTLED]);
    await runSources(h.sources, h.deps);
    assert.deepEqual(h.slept, []);
  });

  test('two real faults still stop the cycle, and the row names the fault', async () => {
    const h = harness([FAILED, FAILED, OK, OK]);
    const out = await runSources(h.sources, h.deps);

    assert.deepEqual(h.ran, ['s0', 's1'], 'the wall is checked before the third is asked');
    assert.equal(out.abandoned, 2);
    assert.equal(h.abandons[0]!.reason, 'fault');
    assert.match(h.abandons[0]!.why, /back to back/);
  });

  test('a throttle between two faults is not a third fault', async () => {
    /* The run of faults restarts, because being throttled says nothing about whether the next
       source is broken. Before the split, these three in a row were one wall. */
    const h = harness([FAILED, THROTTLED, FAILED, OK]);
    const out = await runSources(h.sources, h.deps);
    assert.deepEqual(h.ran, ['s0', 's1', 's2', 's3']);
    assert.equal(out.abandoned, 0);
  });

  test('a run of throttles does eventually stop, and the row says it was the rate, not a fault', async () => {
    const h = harness([THROTTLED, THROTTLED, THROTTLED, THROTTLED, OK, OK]);
    const out = await runSources(h.sources, h.deps);

    assert.deepEqual(h.ran, ['s0', 's1', 's2', 's3'], 'four in a row is account-wide');
    assert.equal(h.abandons[0]!.reason, 'throttle');
    assert.match(h.abandons[0]!.why, /rate limit on the account/);
    assert.equal(out.abandoned, 2);
  });

  test('a source with nothing to do is neither a fault nor a throttle', async () => {
    const h = harness([NOTHING_TO_DO, NOTHING_TO_DO, NOTHING_TO_DO]);
    const out = await runSources(h.sources, h.deps);
    assert.equal(out.attempted, 3);
    assert.equal(out.faults, 0);
    assert.deepEqual(h.slept, []);
  });
});
