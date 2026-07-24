/**
 * Evidence-gathering for a DETERMINISTIC auth check.
 *
 * No guessing. Dumps every candidate signal from each profile so the difference between
 * signed-in and signed-out is observed, not assumed.
 *
 * Run: node dist/test/probe-authsignals.js
 */
import { chromium, type Browser } from 'playwright';

const ENDPOINTS = [
  { name: 'A(9222)', url: 'http://127.0.0.1:9222' },
  { name: 'B(9223)', url: 'http://127.0.0.1:9223' }
];

async function dump(name: string, endpoint: string) {
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(endpoint, { noDefaults: true } as never);
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error('no context');
    const page = await ctx.newPage();
    await page.goto('https://www.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4000);

    const signals = await page.evaluate(() => {
      const d = globalThis.document as unknown as Document;
      const attrsOf = (sel: string) => {
        const el = d.querySelector(sel);
        if (!el) return null;
        const out: Record<string, string> = {};
        for (const a of Array.from(el.attributes)) {
          if (a.value.length < 120) out[a.name] = a.value;
        }
        return out;
      };
      const exists = (sel: string) => !!d.querySelector(sel);
      return {
        shredditApp: attrsOf('shreddit-app'),
        userDrawerBtn: exists('#expand-user-drawer-button'),
        loginBtn: exists('a[href*="/login"]'),
        signupBtn: exists('a[href*="/register"]'),
        createPost: exists('a[href*="/submit"]'),
        inbox: exists('a[href*="/message/"], a[href*="/notifications"]'),
        avatar: exists('img[alt*="avatar" i], faceplate-img[alt*="avatar" i]'),
        modLink: exists('a[href*="/mod/"]'),
        karmaEl: exists('[data-testid="karma"], faceplate-number'),
        headerUserLinks: Array.from(d.querySelectorAll('header a[href^="/user/"], nav a[href^="/user/"]'))
          .map((a) => a.getAttribute('href')).slice(0, 5),
        anyUserLinks: Array.from(d.querySelectorAll('a[href^="/user/"]'))
          .map((a) => a.getAttribute('href')).slice(0, 3),
        bodyStart: (d.body?.innerText ?? '').slice(0, 120).replace(/\s+/g, ' ')
      };
    });

    const cookies = await ctx.cookies('https://www.reddit.com');
    const cookieInfo = cookies
      .filter((c) => /session|token|loid|edgebucket/i.test(c.name))
      .map((c) => `${c.name}(len=${c.value.length})`)
      .sort();

    await page.close();
    console.log(`\n===== ${name} =====`);
    console.log('shreddit-app attrs :', JSON.stringify(signals.shredditApp));
    console.log('login link         :', signals.loginBtn, '| signup:', signals.signupBtn);
    console.log('user drawer btn    :', signals.userDrawerBtn);
    console.log('create post link   :', signals.createPost, '| inbox:', signals.inbox);
    console.log('avatar img         :', signals.avatar, '| karma el:', signals.karmaEl);
    console.log('header user links  :', JSON.stringify(signals.headerUserLinks));
    console.log('any user links     :', JSON.stringify(signals.anyUserLinks));
    console.log('cookies            :', cookieInfo.join(' '));
    console.log('body starts        :', signals.bodyStart);
  } catch (e) {
    console.log(`\n===== ${name} ===== ERROR ${e instanceof Error ? e.message.split('\n')[0] : e}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

for (const e of ENDPOINTS) await dump(e.name, e.url);
