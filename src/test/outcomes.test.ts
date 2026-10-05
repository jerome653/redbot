import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeOutcomes, subredditFromPermalink } from '../outcomes.js';

const WP = 'https://www.reddit.com/r/Wordpress/comments/1wrudhq/comment/pcizrg8/';
const WH = 'https://www.reddit.com/r/webhosting/comments/1wsm1aw/comment/pctlrpd/';

const pub = (over: Partial<Parameters<typeof summarizeOutcomes>[0]['published'][number]> = {}) => ({
  draftId: 'd1', commentId: 't1_pcizrg8', permalink: WP, subreddit: 'Wordpress', ...over
});

/* ---------------------------------------------------------------------------
 * The rule that decides whether the numbers lie.
 *
 * Both rows below are real and both are true of t1_pcizrg8: visible signed-out on 2026-09-28,
 * absent signed-out on 2026-10-01. Counting rows reports it as visible AND removed; taking the
 * first reports a comment that is gone as still up.
 * ------------------------------------------------------------------------- */

test('the LATEST signed-out reading wins, not the first and not both', () => {
  const r = summarizeOutcomes({
    published: [pub()],
    observations: [
      { ts: '2026-09-28T22:47:00.000Z', kind: 'reply-visible-signed-out', vector: 'signed-out', permalink: WP, value: true },
      { ts: '2026-10-01T00:29:00.000Z', kind: 'reply-absent-signed-out', vector: 'signed-out', permalink: WP, value: false }
    ]
  });
  assert.equal(r.comments[0]!.state, 'removed');
  assert.equal(r.comments[0]!.observedAt, '2026-10-01T00:29:00.000Z');
  assert.equal(r.subreddits[0]!.removed, 1);
  assert.equal(r.subreddits[0]!.visible, 0);
  assert.equal(r.subreddits[0]!.published, 1);
});

test('row order in the input cannot change the answer', () => {
  const rows = [
    { ts: '2026-10-01T00:29:00.000Z', kind: 'reply-absent-signed-out', vector: 'signed-out', permalink: WP, value: false },
    { ts: '2026-09-28T22:47:00.000Z', kind: 'reply-visible-signed-out', vector: 'signed-out', permalink: WP, value: true }
  ];
  /* Newest FIRST in the array — a Map overwritten in input order would read this as visible. */
  assert.equal(summarizeOutcomes({ published: [pub()], observations: rows }).comments[0]!.state, 'removed');
});

test('a comment that came back is visible again, and keeps no stale notice', () => {
  const r = summarizeOutcomes({
    published: [pub()],
    observations: [
      { ts: '2026-10-01T00:29:00.000Z', kind: 'reply-absent-signed-out', vector: 'signed-out', permalink: WP, value: false },
      { ts: '2026-10-01T00:29:01.000Z', kind: 'reply-marked-removed', vector: 'signed-out', permalink: WP, value: '"Comment removed by moderator"' },
      { ts: '2026-10-02T00:00:00.000Z', kind: 'reply-visible-signed-out', vector: 'signed-out', permalink: WP, value: true }
    ]
  });
  assert.equal(r.comments[0]!.state, 'visible');
  assert.equal(r.comments[0]!.removalNotice, null);
  assert.deepEqual(r.subreddits[0]!.removalNotices, []);
});

/* ---- signed-in readings must not count ---- */

test('a signed-in reading does not establish public visibility', () => {
  const r = summarizeOutcomes({
    published: [pub()],
    observations: [
      /* Exactly what the four removed comments still report signed in: visible, no notice. */
      { ts: '2026-10-01T00:29:00.000Z', kind: 'reply-visible-signed-in', vector: 'signed-in', permalink: WP, value: true }
    ]
  });
  assert.equal(r.comments[0]!.state, 'unobserved');
  assert.equal(r.subreddits[0]!.observed, 0);
  assert.equal(r.subreddits[0]!.removalRate, null);
});

/* ---- three states, and the denominator ---- */

test('never observed signed-out is unobserved — neither visible nor removed', () => {
  const r = summarizeOutcomes({ published: [pub()], observations: [] });
  assert.equal(r.comments[0]!.state, 'unobserved');
  assert.equal(r.subreddits[0]!.unobserved, 1);
  assert.equal(r.subreddits[0]!.visible, 0);
  assert.equal(r.subreddits[0]!.removed, 0);
});

test('unobserved comments stay out of the removal rate', () => {
  const r = summarizeOutcomes({
    published: [
      pub({ draftId: 'd1', permalink: WP }),
      pub({ draftId: 'd2', permalink: WP.replace('pcizrg8', 'pcm3zpx') }),
      pub({ draftId: 'd3', permalink: WP.replace('pcizrg8', 'pco7ssf') })
    ],
    observations: [
      { ts: '2026-10-01T00:29:00.000Z', kind: 'reply-absent-signed-out', vector: 'signed-out', permalink: WP, value: false }
    ]
  });
  const wp = r.subreddits.find((s) => s.subreddit === 'Wordpress')!;
  assert.equal(wp.published, 3);
  assert.equal(wp.removed, 1);
  assert.equal(wp.unobserved, 2);
  assert.equal(wp.observed, 1);
  /* 1/1, not 1/3 — a rate over comments nobody looked at is not a rate. */
  assert.equal(wp.removalRate, 1);
});

/* ---- the real shape of the first six ---- */

test('the measured 2026-10-01 census: r/Wordpress 4/4 removed, r/webhosting 2/2 visible', () => {
  const ids = ['pcizrg8', 'pcm3zpx', 'pco7ssf', 'pcup48f'];
  const whIds = ['pctlrpd', 'pcvqay2'];
  const r = summarizeOutcomes({
    published: [
      ...ids.map((i, n) => pub({ draftId: 'w' + n, commentId: 't1_' + i, permalink: WP.replace('pcizrg8', i) })),
      ...whIds.map((i, n) => pub({ draftId: 'h' + n, commentId: 't1_' + i, permalink: WH.replace('pctlrpd', i), subreddit: 'webhosting' }))
    ],
    observations: [
      ...ids.flatMap((i) => [
        { ts: '2026-10-01T00:29:00.000Z', kind: 'reply-absent-signed-out', vector: 'signed-out', permalink: WP.replace('pcizrg8', i), value: false },
        { ts: '2026-10-01T00:29:01.000Z', kind: 'reply-marked-removed', vector: 'signed-out', permalink: WP.replace('pcizrg8', i), value: '"Comment removed by moderator"' }
      ]),
      ...whIds.map((i) => ({ ts: '2026-10-01T00:30:00.000Z', kind: 'reply-visible-signed-out', vector: 'signed-out', permalink: WH.replace('pctlrpd', i), value: true }))
    ]
  });
  const wp = r.subreddits.find((s) => s.subreddit === 'Wordpress')!;
  const wh = r.subreddits.find((s) => s.subreddit === 'webhosting')!;
  assert.equal(wp.published, 4);
  assert.equal(wp.removed, 4);
  assert.equal(wp.removalRate, 1);
  assert.deepEqual(wp.removalNotices, ['Comment removed by moderator']);
  assert.equal(wh.published, 2);
  assert.equal(wh.visible, 2);
  assert.equal(wh.removalRate, 0);
  /* Worst first — the row that needs reading is the one at the top. */
  assert.equal(r.subreddits[0]!.subreddit, 'Wordpress');
});

/* ---- keying and attribution ---- */

test('a trailing slash or a different origin still matches the same comment', () => {
  const r = summarizeOutcomes({
    published: [pub({ permalink: WP })],
    observations: [
      { ts: '2026-10-01T00:29:00.000Z', kind: 'reply-absent-signed-out', vector: 'signed-out', permalink: '/r/Wordpress/comments/1wrudhq/comment/pcizrg8', value: false }
    ]
  });
  assert.equal(r.comments[0]!.state, 'removed');
});

test('the notice is stored verbatim, unwrapped from its JSON quoting', () => {
  const r = summarizeOutcomes({
    published: [pub()],
    observations: [
      { ts: '2026-10-01T00:29:00.000Z', kind: 'reply-absent-signed-out', vector: 'signed-out', permalink: WP, value: false },
      { ts: '2026-10-01T00:29:01.000Z', kind: 'reply-marked-removed', vector: 'signed-out', permalink: WP, value: '"Comment removed by moderator"' }
    ]
  });
  assert.equal(r.comments[0]!.removalNotice, 'Comment removed by moderator');
});

test('subredditFromPermalink reads the community, and abstains when it cannot', () => {
  assert.equal(subredditFromPermalink(WP), 'Wordpress');
  assert.equal(subredditFromPermalink('/r/webhosting/comments/x/comment/y/'), 'webhosting');
  assert.equal(subredditFromPermalink('https://example.com/nothing'), null);
  assert.equal(subredditFromPermalink(null), null);
});
