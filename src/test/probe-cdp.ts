/**
 * Diagnostic 3: attach to a manually-launched Chrome over CDP and see whether Reddit
 * serves real content.
 *
 * The hypothesis: Reddit blocks browsers *launched by Playwright* (which adds automation
 * flags), not browsers that Playwright merely attaches to.
 *
 * Prereq: Chrome started by hand with --remote-debugging-port=9222
 * Run: node dist/test/probe-cdp.js [subreddit]
 */
import { chromium } from 'playwright';
import { sel } from '../reddit/selectors.js';

const sub = process.argv[2] ?? 'wordpress';
const endpoint = process.argv[3] ?? 'http://127.0.0.1:9222';

const browser = await chromium.connectOverCDP(endpoint);
console.log(`attached: ${endpoint}`);
console.log(`contexts: ${browser.contexts().length}`);

const ctx = browser.contexts()[0];
if (!ctx) throw new Error('no browser context available over CDP');

// our own tab — never hijack one that is already open
const page = await ctx.newPage();

try {
  const url = `https://www.reddit.com/r/${sub}/hot/`;
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(6000);

  const title = await page.title();
  const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ');
  const blocked = /blocked by network security|please wait for verification|whoa there|are you a robot/i.test(text);
  const anchors = await page.locator('a[href*="/comments/"]').count().catch(() => 0);

  let best = 0;
  let bestSel = '';
  for (const s of sel.postLink) {
    const n = await page.locator(s).count().catch(() => 0);
    if (n > best) { best = n; bestSel = s; }
  }

  console.log(`\n== CDP-attached Chrome`);
  console.log(`   status  : ${resp?.status()}`);
  console.log(`   title   : ${title || '(empty)'}`);
  console.log(`   blocked : ${blocked ? 'YES' : 'no'}`);
  console.log(`   /comments/ anchors : ${anchors}`);
  console.log(`   postLink matches   : ${best}  ${bestSel}`);
  console.log(`   text    : ${text}`);

  if (best > 0) {
    console.log('\n   sample titles:');
    const links = await page.locator(bestSel).all();
    for (const l of links.slice(0, 5)) {
      const t = (await l.innerText().catch(() => ''))?.trim().replace(/\s+/g, ' ');
      const h = await l.getAttribute('href').catch(() => null);
      if (t) console.log(`     - ${t.slice(0, 70)}  ${h?.slice(0, 60) ?? ''}`);
    }
  }
} finally {
  await page.close();
  await browser.close(); // detaches; does NOT close the human's Chrome
}
