/**
 * Reply-back, part B2: the turn's step. It drafts one answer to one waiting reply and hands it to
 * the SAME publish seam every comment uses (auto.ts factCheckThenPublish), so the gates decide.
 * No database rows: every seam is stubbed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const NOW = new Date('2026-10-28T12:00:00.000Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

/* ---- part B: the turn's step ------------------------------------------------------------------ */

import { replyBackStep, type ReplyBackStepDeps } from '../commands/auto.js';

const cand = { draftId: 'd1', threadId: 'd1', permalink: 'p', ourCommentId: null, ourCommentPermalink: null, parentThingId: 't1_x', author: 's', body: 'q?', renderedAge: null, observedAt: ago(5) };
const stepDeps = (over: Partial<ReplyBackStepDeps> = {}, seen: string[] = []): ReplyBackStepDeps => ({
  enabled: () => true, account: () => 'alice',
  find: async () => [cand],
  draft: async () => ({ draftId: 'rb_t1_x.d1.z', why: 'saved' }),
  publish: async (id) => { seen.push(id); },
  status: async () => 'published',
  rec: async () => undefined,
  ...over
});

test('replyBackStep hands the draft to the SAME publish seam as every comment, once', async () => {
  const seen: string[] = [];
  const r = await replyBackStep(stepDeps({}, seen));
  assert.deepEqual(seen, ['rb_t1_x.d1.z']);
  assert.deepEqual({ published: r.published, draftId: r.draftId }, { published: true, draftId: 'rb_t1_x.d1.z' });
});

test('replyBackStep: a refused publish is reported as not published, so the turn goes on', async () => {
  assert.equal((await replyBackStep(stepDeps({ status: async () => 'pending' }))).published, false);
});

test('replyBackStep: off, no account, nothing waiting, a decline, or a throw — nothing published', async () => {
  const seen: string[] = [];
  assert.equal((await replyBackStep(stepDeps({ enabled: () => false }, seen))).ran, false);
  assert.equal((await replyBackStep(stepDeps({ account: () => null }, seen))).ran, false);
  assert.equal((await replyBackStep(stepDeps({ find: async () => [] }, seen))).published, false);
  assert.equal((await replyBackStep(stepDeps({ draft: async () => ({ draftId: null, why: 'declined' }) }, seen))).published, false);
  assert.equal((await replyBackStep(stepDeps({ find: async () => { throw new Error('boom'); } }, seen))).published, false);
  assert.deepEqual(seen, []);
});
