/**
 * `redbot read <subreddit>`
 *
 * Browses a subreddit, opens each post, collects it into data/threads.json.
 * Works with a saved session; falls back to logged-out reading if there is none.
 */
import { attach, isBrowserUp, isBlocked, NoBrowserError } from '../browser.js';
import { openSubreddit, collectPermalinks, collectThread } from '../reddit/scrape.js';
import { sel } from '../reddit/selectors.js';
import { config } from '../config.js';
import { saveThreads } from '../store.js';
import { record, say } from '../log.js';
import type { Thread } from '../types.js';

export async function read(subreddit: string | undefined, limit?: number): Promise<number> {
  if (!subreddit) {
    say.fail('Usage: redbot read <subreddit>');
    return 1;
  }
  const name = subreddit.replace(/^\/?r\//i, '');
  const max = limit ?? config.limits.maxThreadsPerRead;

  say.head(`redbot read r/${name}`);
  if (!(await isBrowserUp())) {
    say.fail(new NoBrowserError(config.browser.cdpEndpoint).message);
    return 1;
  }
  const s = await attach();
  const threads: Thread[] = [];

  try {
    await openSubreddit(s.page, name);
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

    const added = saveThreads(threads);
    say.ok(`Collected ${threads.length} threads (${added} new). Next: redbot analyze`);
    record('read', `r/${name}: ${threads.length} threads, ${added} new`, {
      subreddit: name, collected: threads.length, added
    });
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    say.fail(msg);
    record('error', `read r/${name} failed: ${msg}`);
    return 1;
  } finally {
    await s.close();
  }
}
