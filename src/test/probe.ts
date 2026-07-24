/**
 * Diagnostic: what does reddit.com actually serve, under which launch mode?
 * Run: node dist/test/probe.js [subreddit]
 *
 * Tries each mode in turn and reports whether real post links are reachable.
 */
import { chromium, type LaunchOptions } from 'playwright';
import { sel } from '../reddit/selectors.js';

const sub = process.argv[2] ?? 'wordpress';

interface Mode {
  name: string;
  opts: LaunchOptions;
}

const modes: Mode[] = [
  { name: 'chromium headless', opts: { headless: true } },
  { name: 'chromium headed', opts: { headless: false } },
  { name: 'real chrome headless', opts: { headless: true, channel: 'chrome' } },
  { name: 'real chrome headed', opts: { headless: false, channel: 'chrome' } }
];

const url = `https://www.reddit.com/r/${sub}/hot/`;

for (const mode of modes) {
  let browser;
  try {
    browser = await chromium.launch(mode.opts);
  } catch (e) {
    console.log(`\n== ${mode.name}: cannot launch (${e instanceof Error ? e.message.split('\n')[0] : e})`);
    continue;
  }

  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(5000);

    const title = await page.title();
    const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 120).replace(/\s+/g, ' ');
    const anchors = await page.locator('a[href*="/comments/"]').count();

    let best = 0;
    for (const s of sel.postLink) {
      const n = await page.locator(s).count().catch(() => 0);
      if (n > best) best = n;
    }

    const blocked = /blocked by network security|whoa there|are you a robot/i.test(text);

    console.log(`\n== ${mode.name}`);
    console.log(`   status  : ${resp?.status()}`);
    console.log(`   title   : ${title || '(empty)'}`);
    console.log(`   blocked : ${blocked ? 'YES' : 'no'}`);
    console.log(`   /comments/ anchors : ${anchors}`);
    console.log(`   postLink matches   : ${best}`);
    console.log(`   text    : ${text}`);
  } catch (e) {
    console.log(`\n== ${mode.name}: error ${e instanceof Error ? e.message.split('\n')[0] : e}`);
  } finally {
    await browser.close();
  }
}
