/**
 * `redbot read <subreddit>`
 *
 * Browses a subreddit, opens each post, collects it into data/threads.json.
 * Works with a saved session; falls back to logged-out reading if there is none.
 */
import { attach, isBrowserUp, isBlocked, isRateLimited, NoBrowserError } from '../browser.js';
import {
  openSubreddit, collectPermalinks, collectThread, feedSort, DEFAULT_FEED_SORT
} from '../reddit/scrape.js';
import { collectRun } from '../reddit/collect-run.js';
import { sel } from '../reddit/selectors.js';
import { config } from '../config.js';
import { sleep } from '../pacing.js';
import { saveThreads } from '../store.js';
import { record, say } from '../log.js';

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

  try {
    await openSubreddit(s.page, name, feed);

    /* Arriving into a 429 is different from meeting one halfway down the list: there is nothing
       collected to keep, and every link we are about to open would meet the same wall. Back off
       once — the budget the config has described since DEFECT-02 — and only then give up. */
    for (let attempt = 0; await isRateLimited(s.page); attempt++) {
      await record('ratelimit', `429 opening r/${name}`, { subreddit: name, status: 'blocked' });
      if (attempt >= config.budget.maxRateLimitRetries) {
        say.fail(`Rate-limited on r/${name}. Nothing collected; try again in a few minutes.`);
        return 1;
      }
      say.warn(`Rate-limited. Waiting ${Math.round(config.budget.rateLimitBackoffMs / 1000)}s before one retry…`);
      await sleep(config.budget.rateLimitBackoffMs);
      await openSubreddit(s.page, name, feed);
    }

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

    /* The loop lives in reddit/collect-run.ts, which is where a 429 stopped being a skip. */
    const out = await collectRun(links, {
      fetch: (link) => collectThread(s.page, link, 'read'),
      rateLimited: () => isRateLimited(s.page),
      onRateLimit: (link, hit) => record('ratelimit', `429 while collecting r/${name}`, {
        subreddit: name, threadUrl: link, status: 'blocked', hit
      }),
      onThread: (t, i, total) => say.step(`  [${i + 1}/${total}] ${t.title.slice(0, 70)}`),
      onSkip: (_l, i, total, why) => say.step(`  [${i + 1}/${total}] skipped — ${why}`),
      onBackoff: (ms) => say.warn(`Rate-limited. Waiting ${Math.round(ms / 1000)}s before one retry…`)
    });

    if (out.skipped) say.warn(`${out.skipped} thread(s) skipped and not counted.`);
    if (out.stoppedEarly) {
      say.warn(`Rate-limited — stopped with ${out.notAttempted} post(s) unopened rather than hammering Reddit.`);
    }

    const added = await saveThreads(out.threads);
    say.ok(`Collected ${out.threads.length} threads (${added} new). Next: redbot analyze`);
    /* The sort is recorded because `insights` splits a "too old" drop into a FEED cause and a
       STALE cause, and "which feed did this batch come from" is the evidence for that split.
       `rateLimited` rides along so a thin batch can be told from a throttled one afterwards. */
    await record('read', `r/${name}: ${out.threads.length} threads, ${added} new`, {
      subreddit: name, collected: out.threads.length, added, sort: feed,
      ...(out.rateLimitHits ? { rateLimitHits: out.rateLimitHits, stoppedEarly: out.stoppedEarly } : {})
    });
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    say.fail(msg);
    /* A navigation that dies ON a 429 arrives here as ERR_HTTP_RESPONSE_CODE_FAILURE and used to
       be filed as a generic error — invisible to the two counters that read `ratelimit` rows. */
    const throttled = await isRateLimited(s.page).catch(() => false);
    if (throttled) await record('ratelimit', `429 during read of r/${name}`, { subreddit: name, status: 'blocked' });
    await record('error', `read r/${name} failed: ${msg}`);
    return 1;
  } finally {
    await s.close();
  }
}
