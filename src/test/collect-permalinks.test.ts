import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPermalinks, isPromotedLink } from '../reddit/scrape.js';

/**
 * Observed on cardinal 2026-10-17: an unattended cycle stopped at "Collecting up to 15 posts…"
 * from 18:57 UTC with no error and no history row. The loop's Chrome window was minimised,
 * r/cms/new held 12 post links, and `page.mouse.wheel` in collectPermalinks never settled.
 * src/behavior.ts already raced its own wheel for the same reason; this one was not raced.
 */
const link = (href: string) => ({
  getAttribute: async (name: string) => (name === 'href' ? href : null),
  innerText: async () => href
});

/** A feed page: `pages[n]` is what the DOM holds after n wheels have landed. */
const fakeFeed = (pages: string[][], wheel: () => Promise<void>) => {
  let landed = 0;
  return {
    landed: () => landed,
    page: {
      locator: () => ({
        first: () => ({ count: async () => 0 }),
        all: async () => (pages[Math.min(landed, pages.length - 1)] ?? []).map(link)
      }),
      mouse: { wheel: async () => { await wheel(); landed++; } }
    }
  };
};

const hrefs = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => `/r/cms/comments/p${from + i}/post_${from + i}/`);

test('a wheel that NEVER settles does not hang collection; the links already loaded are returned', async () => {
  const feed = fakeFeed([hrefs(12)], () => new Promise<void>(() => { /* never settles */ }));
  const started = Date.now();
  const got = await collectPermalinks(feed.page as never, 15, undefined, undefined, { wheelTimeoutMs: 50 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3_000, `a dead wheel must not block collection, took ${elapsed}ms`);
  assert.equal(got.length, 12, 'the 12 links on the page are still collected');
  assert.ok(got.every((u) => u.includes('/comments/')));
});

test('a wheel that lands still loads more posts: the race does not cut normal scrolling short', async () => {
  const feed = fakeFeed([hrefs(12), [...hrefs(12), ...hrefs(6, 12)]], async () => { /* lands */ });
  const got = await collectPermalinks(feed.page as never, 15, undefined, undefined, { wheelTimeoutMs: 5_000 });
  assert.equal(feed.landed(), 1, 'one wheel was needed and it landed');
  assert.equal(got.length, 15, 'the posts the scroll loaded are collected up to the max');
});

test('a REJECTED wheel still throws, as it did before the race', async () => {
  const feed = fakeFeed([hrefs(3)], async () => { throw new Error('Target page, context or browser has been closed'); });
  await assert.rejects(
    collectPermalinks(feed.page as never, 15, undefined, undefined, { wheelTimeoutMs: 5_000 }),
    /has been closed/
  );
});

test('a full first screen never scrolls', async () => {
  let wheels = 0;
  const feed = fakeFeed([hrefs(20)], async () => { wheels++; });
  const got = await collectPermalinks(feed.page as never, 15);
  assert.equal(got.length, 15);
  assert.equal(wheels, 0);
});

/** Real shapes from the production threads table, 2026-10-18. */
const AD = '/user/CodeRabbitAI/comments/1qoevpq/cut_code_review_time_and_bugs_in_half_sign_up_for/?p=1&impressionid=5498099549689873874&action_bar_refresh_eligible=1';
const PROFILE_POST = 'https://www.reddit.com/user/foxcorecms/comments/1wuesos/foxcorecms_cms/';

test('isPromotedLink: an advert or a profile post is promoted; a subreddit thread is not', () => {
  assert.equal(isPromotedLink(AD), true, 'the impression tracker marks an advert');
  assert.equal(isPromotedLink(PROFILE_POST), true, 'a profile post has no subreddit to answer in');
  assert.equal(isPromotedLink('/u/someone/comments/abc/x/'), true, '/u/ is the short form of /user/');
  assert.equal(isPromotedLink('/r/cms/comments/p1/post_1/?impressionid=1'), true);
  assert.equal(isPromotedLink('/r/cms/comments/p1/post_1/'), false);
  assert.equal(isPromotedLink('https://www.reddit.com/r/Wordpress/comments/p2/x/?p=1'), false);
  assert.equal(isPromotedLink('/r/user/comments/p3/a_sub_called_user/'), false, 'a subreddit NAMED user is a subreddit');
});

test('promoted links in the feed are skipped and do not count towards the max', async () => {
  const feed = fakeFeed([[...hrefs(3), AD, PROFILE_POST, ...hrefs(2, 3)]], async () => { /* lands */ });
  const got = await collectPermalinks(feed.page as never, 5);
  assert.equal(got.length, 5, 'the five subreddit threads fill the max');
  assert.ok(got.every((u) => u.includes('/r/cms/')), `no advert or profile post collected: ${got.join(' ')}`);
});
