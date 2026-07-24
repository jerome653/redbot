/**
 * PHASE 3 + 8 — reading across subreddits, instrumented.
 *
 * Measures rather than assumes:
 *   - threads collected vs attempted, per subreddit
 *   - field completeness (title/body/upvotes/comments/age/author)
 *   - navigation interval actually achieved
 *   - time/loads until rate limiting, if it happens
 *
 * Deliberately paced to the corrected envelope. Small sample per subreddit so the whole
 * matrix fits inside one safe run.
 *
 * Run: node qa/phase3-read.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, appendFileSync } from 'node:fs';

const OUT = 'qa/evidence/phase3-read.log';
writeFileSync(OUT, `PHASE 3 — reading, instrumented\n${new Date().toISOString()}\n\n`);
const log = (s) => { console.log(s); appendFileSync(OUT, s + '\n'); };

const SUBS = ['WordPress', 'webdev', 'programming', 'SEO', 'smallbusiness'];
const PER_SUB = 3;
const MIN_MS = 3200, MAX_MS = 7000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pace = () => wait(MIN_MS + Math.random() * (MAX_MS - MIN_MS));

let loads = 0;
const t0 = Date.now();
let firstLimitAt = null;

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { noDefaults: true });
const ctx = browser.contexts()[0];
const page = await ctx.newPage();

const limited = async () => {
  const t = (await page.locator('body').innerText().catch(() => '')).slice(0, 300);
  return /HTTP ERROR 429|too many requests|This page isn.t working|blocked by network/i.test(t);
};

const rows = [];

for (const sub of SUBS) {
  const subStart = Date.now();
  let attempted = 0, ok = 0, skipped = 0;
  const missing = { title: 0, body: 0, upvotes: 0, comments: 0, age: 0, author: 0 };

  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    loads++;
    await pace();

    if (await limited()) {
      firstLimitAt ??= { loads, minutes: ((Date.now() - t0) / 60000).toFixed(1) };
      log(`r/${sub}: RATE LIMITED at load ${loads}`);
      rows.push({ sub, attempted: 0, ok: 0, skipped: 0, note: 'rate limited' });
      break;
    }

    // collect links from the feed container only
    const links = await page.evaluate(() => {
      const root = document.querySelector('shreddit-feed') ?? document.querySelector('main') ?? document;
      return [...root.querySelectorAll('a[href*="/comments/"]')]
        .map((a) => a.getAttribute('href'))
        .filter(Boolean)
        .filter((h, i, arr) => arr.indexOf(h) === i)
        .slice(0, 12);
    }).catch(() => []);

    for (const href of links.slice(0, PER_SUB)) {
      attempted++;
      const url = href.startsWith('http') ? href : 'https://www.reddit.com' + href;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40_000 });
        loads++;
        await pace();
        if (await limited()) {
          firstLimitAt ??= { loads, minutes: ((Date.now() - t0) / 60000).toFixed(1) };
          log(`  RATE LIMITED at load ${loads}`);
          break;
        }
        const f = await page.evaluate(() => {
          const post = document.querySelector('shreddit-post');
          const g = (n) => post?.getAttribute(n) ?? null;
          const title = document.querySelector('h1')?.textContent?.trim() ?? null;
          const body = document.querySelector('div[slot="text-body"]')?.textContent?.trim() ?? null;
          return { title, body, score: g('score'), comments: g('comment-count'),
                   created: g('created-timestamp'), author: g('author') };
        }).catch(() => null);

        if (!f || !f.title) { skipped++; continue; }
        ok++;
        if (!f.title) missing.title++;
        if (!f.body) missing.body++;
        if (f.score === null) missing.upvotes++;
        if (f.comments === null) missing.comments++;
        if (!f.created) missing.age++;
        if (!f.author) missing.author++;
      } catch (e) {
        skipped++;
      }
    }
  } catch (e) {
    log(`r/${sub}: FAILED ${e.message.slice(0, 70)}`);
  }

  const secs = ((Date.now() - subStart) / 1000).toFixed(0);
  rows.push({ sub, attempted, ok, skipped, missing, secs });
  log(`r/${sub.padEnd(14)} attempted=${attempted} ok=${ok} skipped=${skipped} ${secs}s  ` +
      `missing: body=${missing.body} ups=${missing.upvotes} comments=${missing.comments} age=${missing.age} author=${missing.author}`);
  if (firstLimitAt) break;
}

await page.close().catch(() => {});
await browser.close().catch(() => {});

const mins = ((Date.now() - t0) / 60000).toFixed(1);
const totalOk = rows.reduce((s, r) => s + (r.ok || 0), 0);
const totalAtt = rows.reduce((s, r) => s + (r.attempted || 0), 0);

log(`\n--- PHASE 3 SUMMARY ---`);
log(`subreddits covered : ${rows.length}/${SUBS.length}`);
log(`threads ok/attempt : ${totalOk}/${totalAtt}`);
log(`page loads         : ${loads} in ${mins} min  (~${(loads / (mins || 1)).toFixed(1)} loads/min)`);
log(`rate limited       : ${firstLimitAt ? `YES at load ${firstLimitAt.loads}, +${firstLimitAt.minutes} min` : 'no'}`);
