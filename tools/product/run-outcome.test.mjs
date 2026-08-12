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
import { runError } from './run-outcome.mjs';

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
  assert.equal(
    runError({ code: 2, stopped: false, out, err }),
    'Nothing survives the prefilter. Collect fresher threads rather than relaxing it.'
  );
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
