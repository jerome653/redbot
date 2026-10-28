/**
 * Reply-back, part A: which replies to OUR published comments are still waiting for an answer.
 *
 * Measured on production 2026-10-28: of 38 observed published comments, 11 had a reply
 * (`reply-child-count` > 0) and none was ever answered. A back-and-forth is where comment karma
 * builds, and the loop only ever wrote top-level comments. The observe sweep already stores every
 * reply's author and text on the `interactions` row (src/commands/observe.ts); these tests pin the
 * rule that turns those rows into a work list, and the two observe fields the rule depends on.
 *
 * No database rows: the rule is pure, and every input is built here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Draft, HistoryEntry } from '../types.js';
import type { InteractionRecord, ObservedReply } from '../interactions.js';
import { unansweredReplies, isReplyBackEntry, REPLY_BACK_PER_THREAD_MS } from '../reply-back.js';
import { observedReplies } from '../commands/observe.js';

const NOW = new Date('2026-10-28T12:00:00.000Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

function pub(id: string, account: string, over: Partial<Draft> = {}): Draft {
  const permalink = `https://www.reddit.com/r/Wordpress/comments/${id}/t/`;
  return {
    id, threadId: id, permalink, title: 't', body: 'our comment', hasDisclosure: false, lintIssues: [],
    createdAt: ago(600), decidedAt: ago(590), model: 'm', status: 'published', account,
    commentPermalink: `${permalink}comment/c${id}/`, commentId: `t1_c${id}`, ...over
  };
}

function reply(thingId: string, author: string | null, over: Partial<ObservedReply> = {}): ObservedReply {
  return {
    thingId, author, byOriginalPoster: false, byUs: false, body: `a question from ${author}`,
    renderedAge: '2 hr. ago', timestamp: null, score: 1, depth: 1, distinguished: null,
    childAuthors: [], humanLabel: null, ...over
  };
}

function row(draftId: string, account: string, replies: ObservedReply[], over: Partial<InteractionRecord> = {}): InteractionRecord {
  return {
    schemaVersion: '1.0', ts: ago(30), kind: 'checkpoint', draftId, threadId: draftId,
    permalink: `https://www.reddit.com/r/Wordpress/comments/${draftId}/t/`,
    commentPermalink: null, commentId: `t1_c${draftId}`, account, checkpoint: '1h', elapsedMinutes: 560,
    vector: 'signed-in',
    thread: { locked: null, archived: null, postScore: null, commentCount: null, ageHours: null },
    self: { present: true, score: 2, removalNotice: null, directReplyCount: replies.length, via: 'id' },
    replies, note: '', ...over
  };
}

function backRow(parentDraftId: string, parentThingId: string, minutesAgo: number, kind: HistoryEntry['kind'] = 'publish.ok'): HistoryEntry {
  return {
    ts: ago(minutesAgo), kind, account: 'alice', summary: 'reply-back',
    data: { draftId: `r_${parentThingId}`, replyBack: true, parentDraftId, parentThingId }
  };
}

const base = { account: 'alice', fleet: ['alice', 'bob'], now: NOW };

/* ---- the happy path ------------------------------------------------------------------------- */

test('a reply from a stranger under our live comment is unanswered, with its text and author', () => {
  const got = unansweredReplies({ ...base, drafts: [pub('d1', 'alice')], interactions: [row('d1', 'alice', [reply('t1_x', 'stranger')])], history: [] });
  assert.equal(got.length, 1);
  assert.deepEqual(
    { draftId: got[0]!.draftId, parentThingId: got[0]!.parentThingId, author: got[0]!.author, body: got[0]!.body, ourCommentId: got[0]!.ourCommentId },
    { draftId: 'd1', parentThingId: 't1_x', author: 'stranger', body: 'a question from stranger', ourCommentId: 't1_cd1' }
  );
  assert.equal(got[0]!.permalink, 'https://www.reddit.com/r/Wordpress/comments/d1/t/');
});

/* ---- whose replies ---------------------------------------------------------------------------- */

test('only THIS account\'s published comments are looked at — never another fleet account\'s', () => {
  const got = unansweredReplies({ ...base, drafts: [pub('d1', 'bob')], interactions: [row('d1', 'bob', [reply('t1_x', 'stranger')])], history: [] });
  assert.equal(got.length, 0);
});

test('a reply written by our own fleet is never answered (any case), nor one by us', () => {
  const replies = [reply('t1_a', 'Bob'), reply('t1_b', 'alice'), reply('t1_c', 'x', { byUs: true })];
  const got = unansweredReplies({ ...base, drafts: [pub('d1', 'alice')], interactions: [row('d1', 'alice', replies)], history: [] });
  assert.deepEqual(got, []);
});

test('a removed or deleted reply is never answered', () => {
  const replies = [
    reply('t1_a', '[deleted]'),
    reply('t1_b', null),
    reply('t1_c', 'x', { body: '[removed]' }),
    reply('t1_d', 'y', { body: 'Comment removed by moderator' }),
    reply('t1_e', 'z', { body: '   ' })
  ];
  const got = unansweredReplies({ ...base, drafts: [pub('d1', 'alice')], interactions: [row('d1', 'alice', replies)], history: [] });
  assert.deepEqual(got, []);
});

test('a moderator or admin comment is not a conversation to join', () => {
  const got = unansweredReplies({ ...base, drafts: [pub('d1', 'alice')], interactions: [row('d1', 'alice', [reply('t1_m', 'Wordpress-ModTeam', { distinguished: 'moderator' })])], history: [] });
  assert.deepEqual(got, []);
});

test('a reply with no thing id cannot be targeted, so it is skipped rather than guessed', () => {
  const got = unansweredReplies({ ...base, drafts: [pub('d1', 'alice')], interactions: [row('d1', 'alice', [reply(null as unknown as string, 'x')])], history: [] });
  assert.deepEqual(got, []);
});

/* ---- already answered ------------------------------------------------------------------------- */

test('a reply that already has a comment by us or the fleet beneath it is answered (also by hand)', () => {
  const replies = [reply('t1_a', 'x', { childAuthors: ['Alice'] }), reply('t1_b', 'y', { childAuthors: ['bob'] })];
  const got = unansweredReplies({ ...base, drafts: [pub('d1', 'alice')], interactions: [row('d1', 'alice', replies)], history: [] });
  assert.deepEqual(got, []);
});

test('a reply-back attempted or published in history is answered — an unknown outcome is never retried', () => {
  const interactions = [row('d1', 'alice', [reply('t1_a', 'x'), reply('t1_b', 'y')])];
  for (const kind of ['publish.ok', 'publish.attempt'] as const) {
    const got = unansweredReplies({ ...base, drafts: [pub('d1', 'alice')], interactions, history: [backRow('d1', 't1_a', 3 * 24 * 60, kind)] });
    assert.deepEqual(got.map((g) => g.parentThingId), ['t1_b'], kind);
  }
});

test('ONE draft per reply, ever: a reply-back draft in ANY state means the reply had its attempt', () => {
  const interactions = [row('d1', 'alice', [reply('t1_a', 'x'), reply('t1_b', 'y')])];
  for (const status of ['pending', 'rejected', 'failed', 'approved'] as const) {
    const rb = pub(replyBackDraftId('t1_a', 'd1'), 'alice', { status });
    const got = unansweredReplies({ ...base, drafts: [pub('d1', 'alice'), rb], interactions, history: [] });
    assert.deepEqual(got.map((g) => g.parentThingId), ['t1_b'], status);
  }
});

test('a declined or pre-save-refused reply-back is never drafted again', () => {
  const interactions = [row('d1', 'alice', [reply('t1_a', 'x'), reply('t1_b', 'y')])];
  for (const kind of ['draft.declined', 'gate.block'] as const) {
    const h: HistoryEntry = { ts: ago(60), kind, account: 'alice', summary: 'reply-back refused', data: { replyBack: true, parentThingId: 't1_a' } };
    const got = unansweredReplies({ ...base, drafts: [pub('d1', 'alice')], interactions, history: [h] });
    assert.deepEqual(got.map((g) => g.parentThingId), ['t1_b'], kind);
  }
  const plain: HistoryEntry = { ts: ago(60), kind: 'gate.block', account: 'alice', summary: 'top-level', data: { parentThingId: 't1_a' } };
  assert.deepEqual(unansweredReplies({ ...base, drafts: [pub('d1', 'alice')], interactions, history: [plain] }).map((g) => g.parentThingId), ['t1_a'], 'a non-reply-back row does not count');
});

test('reply.ts tags every reply-back publish row and passes the reply context to both gate runs', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../src/commands/reply.ts', import.meta.url), 'utf8');
  assert.match(src, /const backTag = back \? \{ replyBack: true, parentDraftId: back\.parentDraftId, parentThingId: back\.parentThingId \} : \{\};/);
  assert.match(src, /record\('publish\.attempt', [^\n]*\n[^\n]*\.\.\.backTag/, 'the attempt row is tagged — without it an unknown outcome could be retried and double-post');
  assert.match(src, /record\('publish\.ok', [^\n]*\n[^\n]*\.\.\.backTag/, 'the publish.ok row is tagged');
  assert.match(src, /replyBack: await replyBackInput\(\)/, 'pre-gate gets the reply context');
  assert.match(src, /replyBack: await replyBackInput\(live\)/, 'final gate gets the reply context with the live re-read');
});

test('at most one reply-back per comment thread per day', () => {
  const interactions = [row('d1', 'alice', [reply('t1_a', 'x'), reply('t1_b', 'y')]), row('d2', 'alice', [reply('t1_c', 'z')])];
  const drafts = [pub('d1', 'alice'), pub('d2', 'alice')];
  const recent = unansweredReplies({ ...base, drafts, interactions, history: [backRow('d1', 't1_a', 60)] });
  assert.deepEqual(recent.map((g) => g.parentThingId), ['t1_c'], 'd1 answered an hour ago — d1 rests, d2 does not');
  const later = unansweredReplies({ ...base, drafts, interactions, history: [backRow('d1', 't1_a', REPLY_BACK_PER_THREAD_MS / 60_000 + 1)] });
  assert.deepEqual(later.map((g) => g.parentThingId).sort(), ['t1_b', 't1_c']);
});

test('one candidate per comment thread — the turn answers one person per thread', () => {
  const got = unansweredReplies({ ...base, drafts: [pub('d1', 'alice')], interactions: [row('d1', 'alice', [reply('t1_a', 'x'), reply('t1_b', 'y')])], history: [] });
  assert.equal(got.length, 1);
});

/* ---- which observation counts ----------------------------------------------------------------- */

test('the LATEST signed-in observation decides: a reply gone since is not answered', () => {
  const old = row('d1', 'alice', [reply('t1_a', 'x')], { ts: ago(600) });
  const fresh = row('d1', 'alice', [], { ts: ago(30) });
  const out = row('d1', 'alice', [reply('t1_a', 'x')], { ts: ago(10), vector: 'signed-out' });
  assert.deepEqual(unansweredReplies({ ...base, drafts: [pub('d1', 'alice')], interactions: [old, fresh, out], history: [] }), []);
});

test('nothing is answered under OUR comment once it is removed or no longer visible', () => {
  const removed = row('d1', 'alice', [reply('t1_a', 'x')], { self: { present: true, score: null, removalNotice: 'Comment removed by moderator', directReplyCount: 1, via: 'id' } });
  const absent = row('d2', 'alice', [reply('t1_b', 'y')], { self: { present: false, score: null, removalNotice: null, directReplyCount: null, via: 'not found' } });
  const got = unansweredReplies({ ...base, drafts: [pub('d1', 'alice'), pub('d2', 'alice')], interactions: [removed, absent], history: [] });
  assert.deepEqual(got, []);
});

test('rows written before childAuthors existed still count: unknown is not "answered"', () => {
  const legacy = reply('t1_a', 'x');
  delete (legacy as Partial<ObservedReply>).childAuthors;
  const got = unansweredReplies({ ...base, drafts: [pub('d1', 'alice')], interactions: [row('d1', 'alice', [legacy])], history: [] });
  assert.equal(got.length, 1);
});

test('newest observation first, so the freshest conversation is answered first', () => {
  const interactions = [row('d1', 'alice', [reply('t1_a', 'x')], { ts: ago(300) }), row('d2', 'alice', [reply('t1_b', 'y')], { ts: ago(20) })];
  const got = unansweredReplies({ ...base, drafts: [pub('d1', 'alice'), pub('d2', 'alice')], interactions, history: [] });
  assert.deepEqual(got.map((g) => g.draftId), ['d2', 'd1']);
});

/* ---- the history contract part B writes ------------------------------------------------------- */

test('isReplyBackEntry reads data.replyBack and the parent ids, nothing else', () => {
  assert.deepEqual(isReplyBackEntry(backRow('d1', 't1_a', 5)), { parentDraftId: 'd1', parentThingId: 't1_a' });
  assert.equal(isReplyBackEntry({ ts: ago(5), kind: 'publish.ok', account: 'alice', summary: '', data: { draftId: 'd9' } }), null);
  assert.equal(isReplyBackEntry({ ts: ago(5), kind: 'publish.ok', account: 'alice', summary: '', data: { replyBack: true } }), null);
});

/* ---- observe carries the two facts the rule needs --------------------------------------------- */

test('observedReplies carries childAuthors through, and marks OP and us', () => {
  const out = observedReplies(
    [{ thingId: 't1_a', author: 'OP', body: 'why?', renderedAge: null, timestamp: null, score: null, depth: 1, distinguished: null, childAuthors: ['alice'] }],
    { opAuthor: 'op', me: 'Alice' }
  );
  assert.equal(out[0]!.byOriginalPoster, true);
  assert.equal(out[0]!.byUs, false);
  assert.deepEqual(out[0]!.childAuthors, ['alice']);
  assert.equal(out[0]!.humanLabel, null);
});

/* ---- part B: the reply context the publish path hands the gates ------------------------------ */

import { replyContext, replyBackDraftId, parseReplyBackDraftId } from '../reply-back.js';

test('a reply-back draft id round-trips its parent reply and parent draft', () => {
  const id = replyBackDraftId('t1_x', 'd_7d76_muk', NOW);
  assert.deepEqual(parseReplyBackDraftId(id), { parentThingId: 't1_x', parentDraftId: 'd_7d76_muk' });
  assert.equal(parseReplyBackDraftId('d_1'), null);
  assert.equal(parseReplyBackDraftId('rb_t1_x'), null);
  assert.equal(parseReplyBackDraftId('rb_t1_x.d1'), null, 'a stamp is required');
});

test('replyContext: the reply\'s age is its own timestamp, else the first look that saw it', () => {
  const ids = { parentThingId: 't1_x', parentDraftId: 'd1' };
  const rows = [row('d1', 'alice', [reply('t1_x', 's')], { ts: ago(100) }), row('d1', 'alice', [reply('t1_x', 's')], { ts: ago(400) })];
  const ctx = { ...base, selfId: 'rb_self', drafts: [], history: [] };
  assert.equal(replyContext(ids, { ...ctx, interactions: rows }).seenAt, ago(400));
  const stamped = [row('d1', 'alice', [reply('t1_x', 's', { timestamp: ago(900) })], { ts: ago(100) })];
  assert.equal(replyContext(ids, { ...ctx, interactions: stamped }).seenAt, ago(900));
  assert.equal(replyContext(ids, { ...ctx, interactions: [] }).seenAt, null);
});

test('replyContext: answered by history, by a fleet child on record or LIVE, or in flight — never by itself', () => {
  const ids = { parentThingId: 't1_x', parentDraftId: 'd1' };
  const ctx = { ...base, selfId: 'rb_self', drafts: [] as Draft[], history: [] as HistoryEntry[], interactions: [row('d1', 'alice', [reply('t1_x', 's')])] };
  assert.equal(replyContext(ids, ctx).answered, null);
  assert.ok(replyContext(ids, { ...ctx, history: [backRow('d1', 't1_x', 9000, 'publish.attempt')] }).answered);
  assert.ok(replyContext(ids, { ...ctx, interactions: [row('d1', 'alice', [reply('t1_x', 's', { childAuthors: ['Bob'] })])] }).answered);
  assert.ok(replyContext(ids, { ...ctx, liveAnswerers: ['bob'] }).answered, 'the live page wins');
  assert.equal(replyContext(ids, { ...ctx, liveAnswerers: ['stranger'] }).answered, null);
  const other = pub('rb_t1_x.d1.zz', 'alice', { status: 'approved' });
  assert.ok(replyContext(ids, { ...ctx, drafts: [other] }).answered, 'another reply-back in flight');
  const self = pub('rb_t1_x.d1.self', 'alice', { status: 'approved' });
  const selfRow = { ...backRow('d1', 't1_x', 1, 'publish.attempt'), data: { draftId: self.id, replyBack: true, parentDraftId: 'd1', parentThingId: 't1_x' } };
  assert.equal(replyContext(ids, { ...ctx, selfId: self.id, drafts: [self], history: [selfRow] }).answered, null);
});

