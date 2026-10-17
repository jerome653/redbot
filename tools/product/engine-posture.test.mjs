/**
 * The engine-health verdict, driven from the exact state that reported `healthy: true` for
 * eleven days.
 *
 * The first test is the regression: `/api/pulse` on 2026-10-16 answered `healthy: true,
 * problems: []` with `auto.running === false` and a newest `history` row from 2026-10-05. Those
 * two inputs, fed to `engineProblems`, must produce two findings — and if either assertion can be
 * satisfied by a function that always returns `[]`, this file is worthless, which is why the
 * healthy cases below are asserted just as hard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineProblems, DEFAULT_STALE_HOURS } from './engine-posture.mjs';

const H = 3_600_000;
const NOW = Date.parse('2026-10-16T22:45:42Z');

test('the measured 2026-10-16 state is reported, not passed', () => {
  const problems = engineProblems({
    autoRunning: false,
    autoAccount: null,
    recordedAt: '2026-10-05T10:14:01.364Z',
    now: NOW
  });
  assert.equal(problems.length, 2, problems.join(' | '));
  assert.match(problems[0], /unattended loop is not running/);
  assert.match(problems[1], /nothing has been recorded for 11 days/);
});

test('a loop that is running and recording recently is healthy', () => {
  const problems = engineProblems({
    autoRunning: true,
    autoAccount: 'ryangrowth12',
    recordedAt: new Date(NOW - 2 * H).toISOString(),
    now: NOW
  });
  assert.deepEqual(problems, []);
});

test('a running loop that has stopped recording is STILL a problem — this is the hang', () => {
  /* The case the watchdog exists for, and the one the pulse could not see: the loop reports
     itself alive while writing nothing. The loop's own word is not the measurement. */
  const problems = engineProblems({
    autoRunning: true,
    recordedAt: new Date(NOW - 72 * H).toISOString(),
    now: NOW
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /nothing has been recorded for 3 days/);
});

test('a stopped loop that recorded a minute ago reports only the stop', () => {
  const problems = engineProblems({
    autoRunning: false,
    recordedAt: new Date(NOW - 60_000).toISOString(),
    now: NOW
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not running/);
});

test('a fresh install with no history is not stale', () => {
  const problems = engineProblems({ autoRunning: true, recordedAt: null, now: NOW });
  assert.deepEqual(problems, [], 'never-recorded is not the same fact as stopped-recording');
});

test('the staleness bound is the documented default and is overridable', () => {
  const at25h = { autoRunning: true, recordedAt: new Date(NOW - 25 * H).toISOString(), now: NOW };
  assert.equal(DEFAULT_STALE_HOURS, 24);
  assert.equal(engineProblems(at25h).length, 1, '25h must exceed the 24h default');
  assert.deepEqual(engineProblems({ ...at25h, staleHours: 48 }), [], 'a wider bound must forgive it');
  assert.equal(engineProblems({ ...at25h, staleHours: 1 }).length, 1);
});

test('the boundary is exclusive — exactly at the bound is not yet stale', () => {
  const exact = { autoRunning: true, recordedAt: new Date(NOW - 24 * H).toISOString(), now: NOW };
  assert.deepEqual(engineProblems(exact), []);
});

test('an unreadable timestamp is reported, never read as fresh', () => {
  const problems = engineProblems({ autoRunning: true, recordedAt: 'yesterday-ish', now: NOW });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /unreadable timestamp/);
});

test('an unanswerable state is reported rather than passed', () => {
  for (const bad of [null, undefined, 'nope', 7]) {
    assert.deepEqual(engineProblems(bad), ['the engine state could not be read'],
      `${JSON.stringify(bad)} must not be treated as healthy`);
  }
});

test('a nonsense staleHours falls back to the default rather than disabling the check', () => {
  const stale = { autoRunning: true, recordedAt: new Date(NOW - 100 * H).toISOString(), now: NOW };
  for (const bad of [0, -5, NaN, 'soon', null]) {
    assert.equal(engineProblems({ ...stale, staleHours: bad }).length, 1,
      `staleHours=${JSON.stringify(bad)} must not switch the check off`);
  }
});
