/**
 * `redbot read <subreddit>`
 *
 * Browses a subreddit, opens each post, collects it into data/threads.json.
 * Works with a saved session; falls back to logged-out reading if there is none.
 */
import { attach, isBrowserUp, isBlocked, NoBrowserError } from '../browser.js';
import {
  openSubreddit, collectPermalinks, collectThread, feedSort, DEFAULT_FEED_SORT
} from '../reddit/scrape.js';
import { sel } from '../reddit/selectors.js';
import { config } from '../config.js';
import { saveThreads } from '../store.js';
import { record, say } from '../log.js';
import type { Thread } from '../types.js';

/**
 * `sort` matters more than it looks, and it used to default to `hot`, which is where warming
 * goes to die: measured 2026-07-27, the YOUNGEST thread in r/WordPress's hot feed was 2.7h old,
 * because a thread has to accumulate engagement before it becomes hot. The warming protocol
 * wants threads under 2h — so from `hot`, the rule could never be satisfied and `warmup`
 * reported zero targets forever. The publish gate says the same thing one step later: 72h and
 * the thread is a footprint, not a reply. Measured on r/WordPress 2026-08-11, `/hot` → 0 of 20
 * survived the prefilter and `--sort new` → 12 of 35 did.
 *
 * So the default is `new` (`DEFAULT_FEED_SORT`) and `hot` is one flag away — `redbot read
 * r/WordPress --sort hot`.
 */
export async function read(subreddit: string | undefined, limit?: number, sort?: string): Promise<number> {
  if (!subreddit) {
    say.fail('Usage: redbot read <subreddit>');
    return 1;
  }
  const name = subreddit.replace(/^\/?r\//i, '');
  const max = limit ?? config.limits.maxThreadsPerRead;

  /* Checked BEFORE a browser is attached: a typo'd sort renders as a page with no posts, which
     reads as "the subreddit is quiet" instead of "that is not a sort". */
  let feed: string;
  try {
    feed = feedSort(sort ?? DEFAULT_FEED_SORT);
  } catch (e) {
    say.fail(e instanceof Error ? e.message : String(e));
    return 1;
  }

  say.head(`redbot read r/${name} · ${feed}`);
  if (!(await isBrowserUp())) {
    say.fail(new NoBrowserError(config.browser.cdpEndpoint).message);
    return 1;
  }
  const s = await attach();
  const threads: Thread[] = [];

  try {
    await openSubreddit(s.page, name, feed);

    // A block page renders as a normal document, so collection would otherwise scrape an
    // interstitial and count it as "0 threads" while hammering Reddit. `isBlocked` was imported
    // but never called on this path (evaluation L4); check it before collecting.
    if (await isBlocked(s.page)) {
      await record('login.fail', `block page while opening r/${name}`, { subreddit: name });
      say.fail('Reddit served a block page. Open reddit.com by hand in that Chrome window once, then retry.');
      return 1;
    }

    say.step(`Collecting up to ${max} posts…`);

    const links = await collectPermalinks(s.page, max, sel.feedScope);
    say.step(`Found ${links.length} post links.`);

    let skipped = 0;
    for (const [i, link] of links.entries()) {
      // One unreachable thread must not end the run — isolate every fetch.
      try {
        const t = await collectThread(s.page, link, 'read');
        if (t) {
          threads.push(t);
          say.step(`  [${i + 1}/${links.length}] ${t.title.slice(0, 70)}`);
        } else {
          skipped++;
          say.step(`  [${i + 1}/${links.length}] skipped — no title found`);
        }
      } catch (e) {
        skipped++;
        const why = e instanceof Error ? e.message.slice(0, 60) : String(e);
        say.step(`  [${i + 1}/${links.length}] skipped — ${why}`);
      }
    }
    if (skipped) say.warn(`${skipped} thread(s) skipped and not counted.`);

    const added = await saveThreads(threads);
    say.ok(`Collected ${threads.length} threads (${added} new). Next: redbot analyze`);
    /* The sort is recorded because `insights` splits a "too old" drop into a FEED cause and a
       STALE cause, and "which feed did this batch come from" is the evidence for that split. */
    await record('read', `r/${name}: ${threads.length} threads, ${added} new`, {
      subreddit: name, collected: threads.length, added, sort: feed
    });
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    say.fail(msg);
    await record('error', `read r/${name} failed: ${msg}`);
    return 1;
  } finally {
    await s.close();
  }
}
