/**
 * The case that matters most is the EMPTY one.
 *
 * An install with no accounts reported `healthy: true` and painted "all connected" green, above its
 * own banner listing the two things still missing. The loop that finds problems had nothing to
 * iterate, and nothing-found was read as nothing-wrong. Every other assertion here is ordinary; the
 * first two are the regression.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetProblems } from './fleet-posture.mjs';

const ok = (over = {}) => ({
  handle: 'docs-architect', port: 9226, state: 'running', browserUp: true, profileOnDisk: true,
  exit: { state: 'live', word: 'exit live', place: 'Seattle, US', ip: '31.56.127.193', detail: '' },
  ...over
});

test('NO ACCOUNTS is a problem, not a clean bill of health', () => {
  const p = fleetProblems([]);
  assert.equal(p.length, 1, 'an empty fleet must not produce an empty problem list');
  assert.match(p[0], /no account is configured/);
});

test('an unreadable account list is not the same claim as an empty one', () => {
  for (const bad of [null, undefined, 'nope', 42]) {
    const p = fleetProblems(bad);
    assert.equal(p.length, 1);
    assert.match(p[0], /could not be read/, `${bad} must not read as "no accounts"`);
  }
});

test('a fully working single account produces no problems', () => {
  assert.deepEqual(fleetProblems([ok()]), []);
});

test('each browser fault is reported, and ownership outranks the folder', () => {
  assert.match(fleetProblems([ok({ state: 'foreign' })])[0], /held by something else/);
  assert.match(fleetProblems([ok({ state: 'unknown' })])[0], /could not be identified/);
  assert.match(fleetProblems([ok({ profileOnDisk: false })])[0], /browser folder is missing/);
  assert.match(fleetProblems([ok({ browserUp: false, state: 'free' })])[0], /browser is not open/);

  // A foreign port with a missing folder reports the foreign port — the dangerous one.
  const both = fleetProblems([ok({ state: 'foreign', profileOnDisk: false })]);
  assert.match(both[0], /held by something else/);
});

test('a moved exit is a problem even when the browser itself is fine', () => {
  const p = fleetProblems([ok({ exit: { state: 'changed', detail: 'Answering from 203.0.113.9, not the vetted 31.56.127.193.' } })]);
  assert.equal(p.length, 1);
  assert.match(p[0], /exit CHANGED/);
  assert.match(p[0], /203\.0\.113\.9/);
});

test('a dead exit under a running browser is reported as loading nothing', () => {
  const p = fleetProblems([ok({ exit: { state: 'stranded', detail: '' } })]);
  assert.match(p[0], /exit is down/);
});

test('an unreadable exit is NOT a problem — absence of an answer is not a fault', () => {
  assert.deepEqual(fleetProblems([ok({ exit: { state: 'unknown', detail: '' } })]), []);
  // Nor is simply having no proxy configured: that is a choice, stated elsewhere.
  assert.deepEqual(fleetProblems([ok({ exit: { state: 'none', detail: '' } })]), []);
});

test('problems accumulate across accounts', () => {
  const p = fleetProblems([ok({ browserUp: false, state: 'free' }), ok({ handle: 'jrum_sgen', state: 'foreign', port: 9224 })]);
  assert.equal(p.length, 2);
});
