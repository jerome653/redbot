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

/* ---------------- the `clean` spec, added 2026-09-28 ---------------- */

/**
 * WHY. Measured across the whole database: 177 `search.preview` rows, **0** `search` rows, and 0
 * of 586 threads carrying `source='search'`. Every search ever run listed candidates and discarded
 * them, because src/commands/auto.ts called the preview and nothing ever called commit.
 *
 * `clean` is the subset an unattended caller may take. commit() warns "you picked them anyway" for
 * flagged candidates and says the mechanical checks "are proxies and a person is entitled to
 * overrule them" — a loop is not a person.
 */
test('the clean spec picks exactly the unflagged candidates', () => {
  const cands = [
    { n: 1, url: 'u1', title: 'a', notes: [], clean: true },
    { n: 2, url: 'u2', title: 'b', notes: ['not a question'], clean: false },
    { n: 3, url: 'u3', title: 'c', notes: [], clean: true },
    { n: 4, url: 'u4', title: null, notes: ['title not readable'], clean: false }
  ];
  const r = parsePicks('clean', cands as Parameters<typeof parsePicks>[1]);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.picked.map((c: { n: number }) => c.n), [1, 3]);
});

test('clean is case- and whitespace-insensitive, like all', () => {
  const cands = [{ n: 1, url: 'u', title: 'a', notes: [], clean: true }];
  for (const spec of ['clean', 'CLEAN', ' Clean ']) {
    assert.deepEqual(parsePicks(spec, cands as Parameters<typeof parsePicks>[1]).picked.map((c: { n: number }) => c.n), [1], spec);
  }
});

test('NO clean candidates is not an error — a quiet query is an ordinary outcome', () => {
  /**
   * The numeric path returns 'no candidates were named' on empty, and that error makes commit()
   * return 1. On the auto path a non-zero exit counts toward the consecutive-failure abort in
   * src/collect-wall.ts, so a search that simply found nothing usable would be read as Reddit
   * refusing us. Measured: one cycle's thirteen queries returned 0,2,3,0,0,0,0,1,1,1 clean.
   */
  const allFlagged = [
    { n: 1, url: 'u1', title: 'a', notes: ['flagged'], clean: false },
    { n: 2, url: 'u2', title: 'b', notes: ['flagged'], clean: false }
  ];
  const r = parsePicks('clean', allFlagged as Parameters<typeof parsePicks>[1]);
  assert.equal(r.error, undefined, 'must not be an error');
  assert.deepEqual(r.picked, []);
});

test('clean never returns a flagged candidate, whatever the notes say', () => {
  /* The guard that matters: `clean` is the stored boolean, not a re-derivation of the notes. */
  const contradictory = [{ n: 1, url: 'u', title: 'a', notes: ['something objected'], clean: false }];
  assert.deepEqual(parsePicks('clean', contradictory as Parameters<typeof parsePicks>[1]).picked, []);
});

test('the numeric and all specs are unchanged by the addition', () => {
  const cands = [
    { n: 1, url: 'u1', title: 'a', notes: [], clean: true },
    { n: 2, url: 'u2', title: 'b', notes: ['x'], clean: false }
  ];
  assert.deepEqual(parsePicks('all', cands as Parameters<typeof parsePicks>[1]).picked.map((c: { n: number }) => c.n), [1, 2],
    'all still means all, flagged included — that path is a person overruling');
  assert.deepEqual(parsePicks('2', cands as Parameters<typeof parsePicks>[1]).picked.map((c: { n: number }) => c.n), [2]);
  assert.ok(parsePicks('9', cands as Parameters<typeof parsePicks>[1]).error, 'and an unknown number is still an error');
});

test('clean carries NO age protection — that lives in the search window and the age ceiling', () => {
  /**
   * This file's header records DEFECT-11: "three drafts aimed at threads seven to eight years old,
   * collected because a bulk `search` committed everything it found." `clean` is a bulk commit, so
   * where age is bounded matters.
   *
   * It is NOT bounded here. `annotate` (src/commands/search.ts:62) receives a title and nothing
   * else — a listing exposes no age, so no note can mention one and `clean` cannot encode one.
   * Age is bounded in two other places: the `t=` window on the search itself
   * (scrape.ts:246 DEFAULT_SEARCH_WINDOW, and the auto path passes 'day'), and the live-age ceiling
   * at selection (src/opportunity.ts, min of maxThreadAgeHoursToPublish and
   * warmingMaxThreadAgeHours). Asserted so that a future reader does not mistake `clean` for a
   * freshness guarantee.
   */
  const ancient = [{ n: 1, url: 'https://reddit.com/r/x/comments/old/', title: 'WordPress plugin conflict breaking checkout, what should I check?', notes: [], clean: true }];
  const r = parsePicks('clean', ancient as Parameters<typeof parsePicks>[1]);
  assert.deepEqual(r.picked.length, 1, 'clean says nothing about age; it cannot');
});
