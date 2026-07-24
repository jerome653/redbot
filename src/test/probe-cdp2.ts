/**
 * Diagnostic 5: which Playwright-over-CDP configuration avoids the block?
 *
 * Raw CDP works (probe-raw). Playwright connectOverCDP with defaults does not (probe-cdp).
 * The difference is what Playwright applies to the context it attaches to. `noDefaults`
 * exists precisely to suppress that.
 *
 * Prereq: Chrome started by hand with --remote-debugging-port=9222
 * Run: node dist/test/probe-cdp2.js
 */
import { chromium, type Page } from 'playwright';

const url = 'https://www.reddit.com/r/wordpress/hot/';
const endpoint = 'http://127.0.0.1:9222';

async function check(label: string, getPage: () => Promise<{ page: Page; cleanup: () => Promise<void> }>) {
  try {
    const { page, cleanup } = await getPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(6000);
      const title = await page.title();
      const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 120).replace(/\s+/g, ' ');
      const blocked = /blocked by network security|please wait for verification/i.test(text);
      const anchors = await page.locator('a[href*="/comments/"]').count().catch(() => 0);
      console.log(`\n== ${label}`);
      console.log(`   title   : ${title || '(empty)'}`);
      console.log(`   blocked : ${blocked ? 'YES' : 'no'}`);
      console.log(`   anchors : ${anchors}`);
      if (blocked) console.log(`   text    : ${text}`);
    } finally {
      await cleanup();
    }
  } catch (e) {
    console.log(`\n== ${label}\n   ERROR ${e instanceof Error ? e.message.split('\n')[0] : e}`);
  }
}

// 1. noDefaults + reuse the page that already exists in the browser
await check('noDefaults:true, existing page', async () => {
  const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true } as any);
  const ctx = browser.contexts()[0]!;
  const existing = ctx.pages()[0];
  const page = existing ?? (await ctx.newPage());
  return { page, cleanup: async () => { await browser.close(); } };
});

// 2. noDefaults + a new page
await check('noDefaults:true, new page', async () => {
  const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true } as any);
  const ctx = browser.contexts()[0]!;
  const page = await ctx.newPage();
  return { page, cleanup: async () => { await page.close(); await browser.close(); } };
});

// 3. defaults + existing page (isolates whether it is newPage or the defaults)
await check('defaults, existing page', async () => {
  const browser = await chromium.connectOverCDP(endpoint);
  const ctx = browser.contexts()[0]!;
  const existing = ctx.pages()[0];
  const page = existing ?? (await ctx.newPage());
  return { page, cleanup: async () => { await browser.close(); } };
});
