/**
 * The console must say what the CLI said.
 *
 * Every one of these cases existed before this module and produced the SAME six words on screen:
 * "scoring did not work". The CLI had already printed the real reason and the console threw it
 * away, because `runAction` set no `error` field for a non-zero exit and the front end substituted
 * a hardcoded string. Six failure modes, one sentence, none of them diagnosable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runError, runNote, nextThrottleCount, pacingFields, NOTHING_TO_DO } from './run-outcome.mjs';

test('a run that succeeded has no error', () => {
  assert.equal(runError({ code: 0, stopped: false, out: 'all good\n', err: '' }), null);
});

test('a run somebody stopped is not a run that failed', () => {
  assert.equal(runError({ code: 1, stopped: true, out: '', err: '  !   whatever\n' }), 'Stopped.');
});

test('THE REGRESSION: a prefilter stop reports the prefilter, not "scoring"', () => {
  /* Copied from run-logs/2026-08-11T07-10-39-203Z__000017.jsonl — this is the run that spent a
     day being read as a scoring crash. */
  const err = '  !   Nothing survives the prefilter. Collect fresher threads rather than relaxing it.\n';
  const out = [
    '',
    'redbot opportunity',
    '------------------',
    '  145 collected · 0 pass the mechanical prefilter · 145 dropped',
    '     dropped 116: too old',
    '     dropped 29: not a question',
    ''
  ].join('\n');
  /* The reason is still the prefilter's own sentence — but it is now carried by runNote, because
     exit 2 is `nothing to do` and that is not a failure. See the block below. */
  assert.equal(runError({ code: 2, stopped: false, out, err }), null,
    'exit 2 means nothing ran, not that something broke');
  assert.equal(
    runNote({ code: 2, out, err }),
    'Nothing survives the prefilter. Collect fresher threads rather than relaxing it.'
  );
});

/**
 * NOTHING TO DO IS NOT A FAILURE, AND THE CONSOLE SPENT THIS WHOLE TIME SAYING IT WAS.
 *
 * `opportunity` returns NOTHING_TO_DO = 2 from both of its nothing-to-do exits — the constant was
 * added so a caller could branch without parsing English. No caller ever did: the console judged
 * every run by `ok: code === 0`, so an empty corpus came back as a failed run and the collect
 * chain threw on it, painting a whole successful collect red. Reported by an operator on
 * 2026-08-14 as an error: "No threads collected. Run `redbot session` or `redbot read` first."
 *
 * The command was right. The frame around it was wrong.
 */
test('nothing to do is reported as a note, and is never an error', () => {
  const err = '  !   No threads have been collected yet.\n';
  assert.equal(runError({ code: NOTHING_TO_DO, stopped: false, out: '', err }), null);
  assert.equal(runNote({ code: NOTHING_TO_DO, out: '', err }), 'No threads have been collected yet.');
});

test('a real failure has no note, and a success has neither', () => {
  const err = '  X   the database could not be reached\n';
  assert.equal(runNote({ code: 1, out: '', err }), null, 'a note must never soften a failure');
  assert.equal(runError({ code: 1, stopped: false, out: '', err }), 'the database could not be reached');
  assert.equal(runNote({ code: 0, out: 'fine', err: '' }), null);
  assert.equal(runError({ code: 0, stopped: false, out: 'fine', err: '' }), null);
});

test('a run that stopped short with nothing to say still reads as nothing to do', () => {
  // Never invent a sentence here: the caller renders "nothing to do" from the flag either way.
  assert.equal(runNote({ code: NOTHING_TO_DO, out: '', err: '' }), null);
  assert.equal(runError({ code: NOTHING_TO_DO, stopped: false, out: '', err: '' }), null);
});

test('a flagged problem wins over a later ordinary step', () => {
  const out = [
    '  X   the model is not signed in',
    '  carrying on with the next thread'
  ].join('\n');
  assert.equal(runError({ code: 1, stopped: false, out, err: '' }), 'the model is not signed in');
});

test('the last flagged line wins when there are several', () => {
  const err = ['  !   first complaint', '  !   second complaint'].join('\n');
  assert.equal(runError({ code: 1, stopped: false, out: '', err }), 'second complaint');
});

test('with nothing flagged, the last thing it said is the reason', () => {
  const out = ['  step one', '  step two', ''].join('\n');
  assert.equal(runError({ code: 1, stopped: false, out, err: '' }), 'step two');
});

test('the heading rule is decoration, never the reason', () => {
  const out = ['redbot opportunity', '------------------', ''].join('\n');
  assert.equal(runError({ code: 1, stopped: false, out, err: '' }), 'redbot opportunity');
});

test('a run that said nothing at all still names its exit code', () => {
  assert.equal(runError({ code: 3, stopped: false, out: '   \n\n', err: '' }), 'redbot exited with code 3.');
});

/**
 * A killed child reports code null. That is the 20-minute timer, and saying "exited with code null"
 * would be a worse lie than saying nothing. Left to the timeout fix that owns it — pinned here so
 * the boundary is deliberate rather than forgotten.
 */
test('a killed run is left to the timeout path, not guessed at', () => {
  assert.equal(runError({ code: null, stopped: false, out: '', err: '' }), null);
});

test('a runaway line cannot flood the screen', () => {
  const long = 'x'.repeat(1000);
  const got = runError({ code: 1, stopped: false, out: `  !   ${long}`, err: '' });
  assert.ok(got.length <= 301, `expected a capped line, got ${got.length}`);
  assert.ok(got.endsWith('…'), 'a truncated line must say so');
});

test('carriage returns from a Windows child do not survive into the message', () => {
  assert.equal(runError({ code: 1, stopped: false, out: '', err: '  !   bad thing\r\n' }), 'bad thing');
});

/**
 * THE PACING. Measured 2026-11-03 23:49:22Z on cardinal: two 429s one second apart ended a whole
 * cycle's collection. `THROTTLED` (exit 3) was added so the cycle could tell "that source broke"
 * from "we are going too fast" — and the console was never taught the difference, so it kept
 * abandoning the rest of the collect at the first one.
 *
 * THROTTLED is 3 in src/exit-codes.ts; it is passed in here rather than imported, for the same
 * reason NOTHING_TO_DO is declared twice. tools/product/server.test.mjs pins the number.
 */
const T = { code: 3, stopped: false, throttledCode: 3 };

test('a throttled run increments the count, and anything else resets it', () => {
  assert.equal(nextThrottleCount(0, T), 1);
  assert.equal(nextThrottleCount(3, T), 4);
  assert.equal(nextThrottleCount(3, { code: 0, stopped: false, throttledCode: 3 }), 0);
  assert.equal(nextThrottleCount(3, { code: 1, stopped: false, throttledCode: 3 }), 0,
    'an ordinary failure is not a throttle and must not pace the next source');
  assert.equal(nextThrottleCount(3, { code: 2, stopped: false, throttledCode: 3 }), 0);
});

test('a run somebody stopped resets the count rather than carrying it', () => {
  assert.equal(nextThrottleCount(3, { code: null, stopped: true, throttledCode: 3 }), 0);
  assert.equal(nextThrottleCount(3, { code: 3, stopped: true, throttledCode: 3 }), 0,
    'a stop tells us nothing about the rate limit, so the next source must not wait on it');
});

test('with no build the console cannot know what 3 means, and the count does not move', () => {
  assert.equal(nextThrottleCount(2, { code: 3, stopped: false, throttledCode: null }), 2);
  assert.equal(nextThrottleCount(2, { code: 3, stopped: false, throttledCode: undefined }), 2);
});

test('THE REGRESSION: a throttled run carries the pacing a caller needs to carry on', () => {
  const p = pacingFields(1, { wallAt: 4, backoff: (n) => n * 60_000 });
  assert.equal(p.throttled, true, 'the caller must be able to tell a rate limit from a fault');
  assert.equal(p.throttlesInARow, 1);
  assert.equal(p.throttleWallAt, 4, 'the threshold must travel with the refusal, not be guessed');
  assert.equal(p.retryAfterMs, 60_000);
});

test('a run that was not throttled carries no pacing at all', () => {
  assert.deepEqual(pacingFields(0, { wallAt: 4, backoff: () => 1 }), {},
    'an untruthful `throttled: false` would still be a field the front end branches on');
});

test('the wait grows with the count, from the one backoff the CLI uses', () => {
  const backoff = (n) => Math.min(60_000 * 2 ** (n - 1), 600_000);
  assert.equal(pacingFields(1, { wallAt: 4, backoff }).retryAfterMs, 60_000);
  assert.equal(pacingFields(2, { wallAt: 4, backoff }).retryAfterMs, 120_000);
  assert.equal(pacingFields(4, { wallAt: 4, backoff }).retryAfterMs, 480_000);
});

test('the count reaching the wall is reported, not swallowed', () => {
  const p = pacingFields(4, { wallAt: 4, backoff: () => 1 });
  assert.ok(p.throttlesInARow >= p.throttleWallAt,
    'the caller decides to give up by comparing these two — both must be present');
});
