import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  feedUrl,
  searchUrl,
  DEFAULT_FEED_SORT,
  DEFAULT_SEARCH_WINDOW,
  FEED_SORTS,
  SEARCH_WINDOWS
} from '../reddit/scrape.js';

/**
 * WHAT THIS PINS: redbot collected threads it could never reply to, by construction.
 *
 * The publish gate refuses a thread over `maxThreadAgeHoursToPublish` = 72h. Both readers were
 * pointed at feeds that surface posts older than that:
 *
 * - the subreddit reader defaulted to `/hot/`, and a post becomes hot by ACCUMULATING votes, so
 *   the sort is an age filter pointing the wrong way. Measured on r/WordPress 2026-08-11:
 *   `/hot` → 0 of 20 survived the prefilter; `--sort new` → 12 of 35 survived.
 * - the search read `sort=relevance` with no `t=` window at all, which is Reddit's "all time".
 *   That is where the seven- and eight-YEAR-old threads of DEFECT-11 came from.
 *
 * The window is `week` and not `day` because a thread has to be FOUND before it can be answered
 * and collection is manual; a week is the smallest window Reddit offers that is wider than the
 * 72h ceiling, so it costs nothing at the gate and leaves slack for when collection runs.
 */
describe('the collector reads feeds it can actually reply to', () => {
  const BASE = 'https://www.reddit.com';

  test('a subreddit feed defaults to new, not hot', () => {
    assert.equal(DEFAULT_FEED_SORT, 'new');
    assert.equal(feedUrl(BASE, 'WordPress'), 'https://www.reddit.com/r/WordPress/new/');
  });

  test('hot is still reachable — this is a default, not a ban', () => {
    assert.equal(feedUrl(BASE, 'WordPress', 'hot'), 'https://www.reddit.com/r/WordPress/hot/');
  });

  test('an r/ prefix is accepted and never doubled', () => {
    assert.equal(feedUrl(BASE, 'r/WordPress'), 'https://www.reddit.com/r/WordPress/new/');
    assert.equal(feedUrl(BASE, '/r/WordPress'), 'https://www.reddit.com/r/WordPress/new/');
  });

  test('an unknown sort is refused, not passed through', () => {
    /* `/r/x/nwe/` is a 404-ish page that collects zero links and reports "found 0 posts" — a
       typo would read as a quiet subreddit. Fail closed and name the valid values instead. */
    assert.throws(() => feedUrl(BASE, 'WordPress', 'nwe'), /nwe/);
    assert.throws(() => feedUrl(BASE, 'WordPress', 'nwe'), /new/);
    assert.ok(FEED_SORTS.includes('new') && FEED_SORTS.includes('hot'));
  });

  test('a search carries a time window, and it defaults to week', () => {
    assert.equal(DEFAULT_SEARCH_WINDOW, 'week');
    const u = new URL(searchUrl(BASE, 'wordpress checkout broken'));
    assert.equal(u.searchParams.get('t'), 'week');
    assert.equal(u.searchParams.get('sort'), 'relevance');
    assert.equal(u.searchParams.get('q'), 'wordpress checkout broken');
  });

  test('the query is encoded, not concatenated', () => {
    const u = new URL(searchUrl(BASE, 'a&b=c d?'));
    assert.equal(u.searchParams.get('q'), 'a&b=c d?');
  });

  test('all-time is expressible, and it drops the parameter rather than sending t=all', () => {
    const u = new URL(searchUrl(BASE, 'x', { time: 'all' }));
    assert.equal(u.searchParams.get('t'), null);
  });

  test('an unknown window is refused — Reddit ignores a bad t= and silently searches all time', () => {
    assert.throws(() => searchUrl(BASE, 'x', { time: 'fortnight' }), /fortnight/);
    assert.throws(() => searchUrl(BASE, 'x', { time: 'fortnight' }), /week/);
    assert.ok(SEARCH_WINDOWS.includes('week') && SEARCH_WINDOWS.includes('all'));
  });

  test('a search sort can be changed and is validated too', () => {
    const u = new URL(searchUrl(BASE, 'x', { sort: 'new' }));
    assert.equal(u.searchParams.get('sort'), 'new');
    assert.throws(() => searchUrl(BASE, 'x', { sort: 'newest' }), /newest/);
  });
});
