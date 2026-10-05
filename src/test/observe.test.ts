import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeUrl, checkpointFor, readRemoval } from '../commands/observe.js';

const THREAD = 'https://www.reddit.com/r/Wordpress/comments/1wrudhq/hero_banner/';
const ABS = 'https://www.reddit.com/r/Wordpress/comments/1wrudhq/comment/pcizrg8/';
const REL = '/r/Wordpress/comments/1wrudhq/comment/pcizrg8/';

test('an absolute comment permalink is used as-is', () => {
  assert.equal(observeUrl({ commentPermalink: ABS, publishedUrl: THREAD, permalink: THREAD }), ABS);
});

test('a RELATIVE comment permalink is resolved, not handed to page.goto', () => {
  /* The 2026-09-28 06:43 publish was recorded after the fact and stored Reddit's own relative
     path. page.goto rejects it: "Protocol error (Page.navigate): Cannot navigate to invalid
     URL" — measured, and it is why d_7d762fa0f2b4_muksfd2v could not be observed at all. */
  assert.equal(observeUrl({ commentPermalink: REL, publishedUrl: ABS, permalink: THREAD }), ABS);
});

test('a blank comment permalink does not shadow the published url', () => {
  assert.equal(observeUrl({ commentPermalink: '', publishedUrl: ABS, permalink: THREAD }), ABS);
  assert.equal(observeUrl({ commentPermalink: '   ', publishedUrl: ABS, permalink: THREAD }), ABS);
});

test('with neither comment permalink nor published url, the thread is the target', () => {
  assert.equal(observeUrl({ permalink: THREAD }), THREAD);
  assert.equal(observeUrl({ commentPermalink: null, publishedUrl: null, permalink: THREAD }), THREAD);
});

test('a relative published url and a relative thread permalink are resolved too', () => {
  assert.equal(observeUrl({ publishedUrl: REL, permalink: THREAD }), ABS);
  assert.equal(observeUrl({ permalink: REL }), ABS);
});

test('checkpointFor is unchanged by this edit', () => {
  assert.equal(checkpointFor(0), 'immediate');
  assert.equal(checkpointFor(337), '1h');
  assert.equal(checkpointFor(961), '24h');
  assert.equal(checkpointFor(6 * 24 * 60), '7d');
});

/* ---------------------------------------------------------------------------
 * readRemoval — the three readings measured off the live pages on 2026-09-30.
 *
 * The defect this covers: `present` was recorded as `reply-visible-signed-out = true` for
 * comments Reddit had replaced with a removal stub, and the notice the code already computed was
 * printed and never stored. Four of six published comments were affected; `removalsObserved30d`
 * (src/health.ts:263) counted zero of them against a stop threshold of 2 (src/policy.ts:145).
 * ------------------------------------------------------------------------- */

test('a moderator removal stub is removed, and filed as removed rather than deleted', () => {
  /* t1_pcizrg8, r/Wordpress, read signed-out: author="[deleted]", no own comment slot, text
     "[deleted] • 3d ago Comment removed by moderator". */
  const r = readRemoval({
    ownText: '[deleted] • 3d ago Comment removed by moderator',
    author: '[deleted]',
    hasOwnSlot: false
  });
  assert.equal(r.removed, true);
  assert.equal(r.removalNotice, 'Comment removed by moderator');
  /* The kind the recorder derives from it — `removed` must win over the `[deleted]` marker that
     also appears in the same string, because only `reply-marked-removed` reaches the stop. */
  assert.match(r.removalNotice!, /removed/i);
});

test('an intact comment is not removed, even with a deleted reply in the thread', () => {
  /* t1_pctlrpd, r/webhosting, read signed-out: author intact, own slot present, real body. */
  const r = readRemoval({
    ownText: 'ryangrowth12 • 1d ago Before moving a domain and mailbox over, I\'d check if 365i publishes any uptime/status history',
    author: 'ryangrowth12',
    hasOwnSlot: true
  });
  assert.equal(r.removed, false);
  assert.equal(r.removalNotice, null);
});

test('a nested reply\'s removal does not mark the parent removed', () => {
  /* t1_pcm3zpx is why `ownText` must have nested shreddit-comment subtrees stripped: its whole
     subtree contained its own stub AND a Wordpress-ModTeam reply. With the parent intact and the
     child stripped, the parent reads clean. */
  const r = readRemoval({
    ownText: 'ryangrowth12 • 2d ago Since you\'re already on Kadence, it might be worth checking its free starter templates',
    author: 'ryangrowth12',
    hasOwnSlot: true
  });
  assert.equal(r.removed, false);
});

test('a body lost without any notice is still removed when the author renders as deleted', () => {
  const r = readRemoval({ ownText: '[deleted] • 1d ago', author: '[deleted]', hasOwnSlot: false });
  assert.equal(r.removed, true);
});

test('an account that deleted its own comment is filed as deleted, not removed', () => {
  const r = readRemoval({ ownText: '[deleted] • 2d ago [deleted]', author: 'someone', hasOwnSlot: true });
  assert.equal(r.removalNotice, '[deleted]');
  assert.equal(r.removed, true);
  assert.doesNotMatch(r.removalNotice!, /removed/i);
});
