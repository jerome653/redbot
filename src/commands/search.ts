/**
 * `redbot search "<query>"`
 *
 * Runs a Reddit search and collects the results into data/threads.json.
 */
import { attach, isBrowserUp, isBlocked, NoBrowserError } from '../browser.js';
import { runSearch, collectPermalinks, collectThread } from '../reddit/scrape.js';
import { sel } from '../reddit/selectors.js';
import { config } from '../config.js';
import { saveThreads } from '../store.js';
import { record, say } from '../log.js';
import type { Thread } from '../types.js';

export async function search(query: string | undefined, limit?: number): Promise<number> {
  if (!query) {
    say.fail('Usage: redbot search "<query>"');
    return 1;
  }
  const max = limit ?? config.limits.maxThreadsPerRead;

  say.head(`redbot search "${query}"`);
  if (!(await isBrowserUp())) {
    say.fail(new NoBrowserError(config.browser.cdpEndpoint).message);
    return 1;
  }
  const s = await attach();
  const threads: Thread[] = [];

  try {
    await runSearch(s.page, query);
    say.step(`Collecting up to ${max} results…`);

    const links = await collectPermalinks(s.page, max, sel.searchScope);
    say.step(`Found ${links.length} result links.`);

    let skipped = 0;
    for (const [i, link] of links.entries()) {
      // One unreachable thread must not end the run — isolate every fetch.
      try {
        const t = await collectThread(s.page, link, 'search', query);
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
    record('search', `"${query}": ${threads.length} threads, ${added} new`, {
      query, collected: threads.length, added
    });
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    say.fail(msg);
    record('error', `search "${query}" failed: ${msg}`);
    return 1;
  } finally {
    await s.close();
  }
}
