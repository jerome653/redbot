/**
 * `search` became two steps on 2026-07-24: preview, then commit what a person picked.
 *
 * The tests that matter are about the boundary between them — a selection parser that
 * silently drops or invents an entry would put threads into the corpus that nobody chose,
 * which is the failure the split exists to prevent (DEFECT-11: three drafts aimed at threads
 * seven to eight years old, collected because a bulk `search` committed everything it found).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _parsePicks as parsePicks, _annotate as annotate } from '../commands/search.js';

const CANDIDATES = [1, 2, 3, 4, 5].map((n) => ({
  n, url: `https://reddit.com/r/x/comments/${n}`, title: `thread ${n}`, notes: [], clean: n % 2 === 1
}));

test('a list of numbers picks exactly those, in the order given', () => {
  const { picked, error } = parsePicks('3,1', CANDIDATES);
  assert.equal(error, undefined);
  assert.deepEqual(picked.map((c) => c.n), [3, 1]);
});

test('a range expands', () => {
  const { picked } = parsePicks('2-4', CANDIDATES);
  assert.deepEqual(picked.map((c) => c.n), [2, 3, 4]);
});

test('duplicates collapse rather than collecting a thread twice', () => {
  const { picked } = parsePicks('2,2,2-3', CANDIDATES);
  assert.deepEqual(picked.map((c) => c.n), [2, 3]);
});

test('"all" means every candidate previewed, including the flagged ones', () => {
  const { picked } = parsePicks('all', CANDIDATES);
  assert.equal(picked.length, CANDIDATES.length);
});

test('an out-of-range pick is an error, not a silent skip', () => {
  const { picked, error } = parsePicks('9', CANDIDATES);
  assert.equal(picked.length, 0);
  assert.match(error!, /no candidate 9/);
});

test('a non-numeric pick is an error, not an empty collection', () => {
  const { error } = parsePicks('first', CANDIDATES);
  assert.match(error!, /not a number/);
});

test('an empty spec collects nothing and says so', () => {
  const { picked, error } = parsePicks('  ', CANDIDATES);
  assert.equal(picked.length, 0);
  assert.ok(error);
});

/* ------------------------------------------------------------------ *
 * Annotation — proxies that inform, never decide
 * ------------------------------------------------------------------ */

test('an announcement-tagged title is flagged before anything is opened', () => {
  const a = annotate('[Guide] How to speed up your WordPress site');
  assert.equal(a.clean, false);
  assert.ok(a.notes.length);
});

test('a plain question in the declared vocabulary raises no objection', () => {
  const a = annotate('Why does my WordPress plugin conflict break checkout after a host migration?');
  assert.equal(a.clean, true, a.notes.join('; '));
});

/**
 * The shape check normally reads title AND body; a listing exposes only the title. Measured
 * while writing these tests: "WordPress plugin conflict is breaking my checkout after a host
 * migration" — a real help request — is flagged, because without a question mark or an
 * explicit ask the title alone carries no question. That is a false positive the preview must
 * own out loud rather than hide, since the whole point of the step is that a person overrules
 * it.
 */
test('a help request with no question mark is flagged, and the note says the body was not read', () => {
  const a = annotate('WordPress plugin conflict is breaking my checkout after a host migration');
  assert.equal(a.clean, false);
  assert.ok(a.notes.some((n) => /title only/i.test(n)), `notes must disclose the limitation: ${a.notes.join('; ')}`);
});

test('a title the listing did not expose is reported as unchecked, not as clean', () => {
  const a = annotate(null);
  assert.equal(a.clean, false);
  assert.match(a.notes[0]!, /nothing could be checked/);
});
