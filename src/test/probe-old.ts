/**
 * Diagnostic 2: is old.reddit.com reachable from a Playwright-driven browser?
 * Run: node dist/test/probe-old.js [subreddit]
 */
import { chromium } from 'playwright';

const sub = process.argv[2] ?? 'wordpress';

const targets = [
  `https://old.reddit.com/r/${sub}/`,
  `https://www.reddit.com/r/${sub}/hot/`
];

const browser = await chromium.launch({ headless: true });
try {
  for (const url of targets) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(2500);
      const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 120).replace(/\s+/g, ' ');
      const blocked = /blocked by network security|whoa there|are you a robot/i.test(text);

      const oldLinks = await page.locator('a.title[href*="/comments/"], a[data-click-id="body"]').count().catch(() => 0);
      const anyComments = await page.locator('a[href*="/comments/"]').count().catch(() => 0);

      console.log(`\n== ${url}`);
      console.log(`   status  : ${resp?.status()}`);
      console.log(`   title   : ${(await page.title()) || '(empty)'}`);
      console.log(`   blocked : ${blocked ? 'YES' : 'no'}`);
      console.log(`   post links (old layout) : ${oldLinks}`);
      console.log(`   any /comments/ anchors  : ${anyComments}`);
      console.log(`   text    : ${text}`);
    } catch (e) {
      console.log(`\n== ${url}\n   error: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
