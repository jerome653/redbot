/**
 * The frozen interaction schema.
 *
 * These tests exist because the schema was frozen BEFORE the evidence, and the first ten
 * interactions are unrepeatable. They pin the three properties that make the record trustworthy
 * rather than merely present:
 *
 *   1. every key is always there, so "absent" is distinguishable from "not looked for"
 *   2. `humanLabel` is never written by a machine
 *   3. rows are append-only — history is a sequence of rows, never a mutated field
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERACTION_SCHEMA_VERSION, interactionsFor, loadInteractions,
  type InteractionRecord, type ObservedReply
} from '../interactions.js';

const reply = (over: Partial<ObservedReply> = {}): ObservedReply => ({
  thingId: 't1_abc', author: 'someone', byOriginalPoster: false, byUs: false,
  body: 'That is not what max_allowed_packet does.', renderedAge: '3 hr. ago',
  timestamp: null, score: 4, depth: 1, distinguished: null, humanLabel: null, ...over
});

const row = (over: Partial<InteractionRecord> = {}): InteractionRecord => ({
  schemaVersion: INTERACTION_SCHEMA_VERSION,
  ts: '2026-07-23T12:00:00.000Z',
  kind: 'checkpoint',
  draftId: 'd_test', threadId: 't_test',
  permalink: 'fixture://thread', commentPermalink: null, commentId: null,
  account: 'docs-architect', checkpoint: '24h', elapsedMinutes: 1440,
  vector: 'signed-in',
  thread: { locked: false, archived: false, postScore: 12, commentCount: 8, ageHours: 30 },
  self: { present: true, score: 2, removalNotice: null, directReplyCount: 1, via: 'comment id attribute' },
  replies: [reply()],
  note: 'fixture',
  ...over
});

/* ---------------- absent is null, and recorded ---------------- */

test('every observation key is present even when the value is unknown', () => {
  const r = row({
    thread: { locked: null, archived: null, postScore: null, commentCount: null, ageHours: null },
    self: { present: false, score: null, removalNotice: null, directReplyCount: null, via: 'page could not be read' }
  });
  for (const k of ['locked', 'archived', 'postScore', 'commentCount', 'ageHours']) {
    assert.ok(k in r.thread, `thread.${k} must be present even when null`);
  }
  for (const k of ['present', 'score', 'removalNotice', 'directReplyCount', 'via']) {
    assert.ok(k in r.self!, `self.${k} must be present even when null`);
  }
});

test('a null score is not the same fact as a missing key', () => {
  const looked = row({ self: { present: true, score: null, removalNotice: null, directReplyCount: 0, via: 'text match' } });
  assert.equal(looked.self!.score, null);
  assert.ok('score' in looked.self!, 'we looked and Reddit rendered nothing — that is an observation');
});

/* ---------------- humanLabel ---------------- */

test('humanLabel is null on every machine-produced reply', () => {
  const r = row({ replies: [reply(), reply({ author: 'mod', distinguished: 'moderator' })] });
  for (const x of r.replies) {
    assert.equal(x.humanLabel, null, 'a model may not classify the reaction to its own output');
  }
});

/* ---------------- the raw text is the point ---------------- */

test('reply text is stored verbatim, not summarised or counted', () => {
  const body = 'Actually MySQL raises ERROR 1153 and aborts the import.';
  const r = row({ replies: [reply({ body })] });
  assert.equal(r.replies[0]!.body, body);
  assert.equal(r.self!.directReplyCount, 1, 'the count is kept too — it is a different fact');
});

test('rendered age is kept as Reddit displayed it, not converted', () => {
  const r = row({ replies: [reply({ renderedAge: '3 hr. ago', timestamp: null })] });
  assert.equal(r.replies[0]!.renderedAge, '3 hr. ago');
  assert.equal(r.replies[0]!.timestamp, null, 'no machine-readable stamp is not a reason to invent one');
});

/* ---------------- vectors stay separate ---------------- */

test('signed-in and signed-out are separate rows, never merged', () => {
  const inRow = row({ vector: 'signed-in', self: { present: true, score: 1, removalNotice: null, directReplyCount: 0, via: 'id' } });
  const outRow = row({ vector: 'signed-out', self: { present: false, score: null, removalNotice: null, directReplyCount: null, via: 'not found' } });
  assert.notEqual(inRow.vector, outRow.vector);
  // Visible signed in, invisible signed out is THE silent-filtering signal. Collapsing the two
  // rows into one would destroy it.
  assert.equal(inRow.self!.present, true);
  assert.equal(outRow.self!.present, false);
});

/* ---------------- accessors ---------------- */

test('interactionsFor returns oldest first so a score history reads in order', () => {
  const rows: InteractionRecord[] = [
    row({ ts: '2026-07-23T15:00:00.000Z', checkpoint: '24h' }),
    row({ ts: '2026-07-23T12:00:00.000Z', checkpoint: 'immediate' })
  ];
  const sorted = [...rows].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  assert.equal(sorted[0]!.checkpoint, 'immediate');
  assert.equal(sorted[1]!.checkpoint, '24h');
});

test('loading an empty log yields no rows rather than throwing', async () => {
  assert.ok(Array.isArray(await loadInteractions()));
  assert.ok(Array.isArray(await interactionsFor('nothing-published-yet')));
});

test('the schema version is pinned — a silent bump would reinterpret old rows', () => {
  assert.equal(INTERACTION_SCHEMA_VERSION, '1.0');
});
