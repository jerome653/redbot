import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeUrl, checkpointFor } from '../commands/observe.js';

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
