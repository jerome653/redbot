/**
 * Observe every turn: the removal brake is only as good as the last observation.
 *
 * Measured on cardinal: the last `observe` history row was 2026-10-01 while 11 `publish.ok` rows came
 * after it. src/health.ts stops an account on removals, but removals are only learned by `observe`,
 * and nothing ran it unattended. These tests pin the wiring:
 *
 *   - dueForObservation picks ONE account's published drafts, inside 8 days, whose current
 *     checkpoint has no observation yet, capped so a turn stays short;
 *   (the step and cycle wiring is tested in observe-step.test.ts, with auto.ts)
 *
 * No database rows: every seam is stubbed. observe-brake.test.ts drives the real health path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Draft } from '../types.js';
import { dueForObservation, observeUrl, OBSERVE_CAP } from '../commands/observe.js';

const NOW = new Date('2026-10-22T12:00:00.000Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

function pub(id: string, account: string | undefined, minutesAgo: number, over: Partial<Draft> = {}): Draft {
  const permalink = `https://www.reddit.com/r/Wordpress/comments/${id}/t/`;
  return {
    id, threadId: id, permalink, title: 't', body: 'b', hasDisclosure: false, lintIssues: [],
    createdAt: ago(minutesAgo + 5), decidedAt: ago(minutesAgo), model: 'm', status: 'published',
    commentPermalink: `${permalink}comment/c${id}/`, ...(account ? { account } : {}), ...over
  };
}

/* ---- due selection --------------------------------------------------------------------------- */

test('only the selected account\'s published drafts are due — never another account\'s', () => {
  const drafts = [pub('a1', 'alice', 60), pub('b1', 'bob', 60), pub('n1', undefined, 60)];
  const due = dueForObservation(drafts, [], { account: 'alice', now: NOW });
  assert.deepEqual(due.map((d) => d.draft.id), ['a1']);
});

test('the account match ignores case (handles are compared case-insensitively everywhere else)', () => {
  const due = dueForObservation([pub('a1', 'Alice', 60)], [], { account: 'alice', now: NOW });
  assert.equal(due.length, 1);
});

test('unpublished drafts are never due', () => {
  const drafts = [pub('p1', 'alice', 60, { status: 'pending' }), pub('f1', 'alice', 60, { status: 'failed' })];
  assert.equal(dueForObservation(drafts, [], { account: 'alice', now: NOW }).length, 0);
});

test('only drafts published within the last 8 days are due', () => {
  const day = 24 * 60;
  const drafts = [pub('in', 'alice', 7 * day + 23 * 60), pub('out', 'alice', 8 * day + 1)];
  assert.deepEqual(dueForObservation(drafts, [], { account: 'alice', now: NOW }).map((d) => d.draft.id), ['in']);
});

test('a draft whose CURRENT checkpoint is already observed is skipped; the next checkpoint makes it due again', () => {
  const d = pub('a1', 'alice', 120);          // 120 min -> checkpoint '1h'
  const url = observeUrl(d);
  const seen1h = [{ permalink: url, checkpoint: '1h' as const }];
  assert.equal(dueForObservation([d], seen1h, { account: 'alice', now: NOW }).length, 0, '1h already recorded');

  const seenImmediate = [{ permalink: url, checkpoint: 'immediate' as const }];
  const due = dueForObservation([d], seenImmediate, { account: 'alice', now: NOW });
  assert.equal(due.length, 1, 'an earlier checkpoint does not count for this one');
  assert.equal(due[0]!.checkpoint, '1h');
  assert.equal(due[0]!.url, url);

  const otherLink = [{ permalink: 'https://www.reddit.com/r/x/comments/zz/t/', checkpoint: '1h' as const }];
  assert.equal(dueForObservation([d], otherLink, { account: 'alice', now: NOW }).length, 1, 'another permalink does not count');
});

test('capped per call, newest first, so a turn stays short', () => {
  const drafts = [10, 20, 30, 40, 50].map((m) => pub(`d${m}`, 'alice', m));
  const due = dueForObservation(drafts, [], { account: 'alice', now: NOW });
  assert.equal(OBSERVE_CAP, 3);
  assert.deepEqual(due.map((d) => d.draft.id), ['d10', 'd20', 'd30']);
  assert.equal(dueForObservation(drafts, [], { account: 'alice', now: NOW, cap: 1 }).length, 1);
});

