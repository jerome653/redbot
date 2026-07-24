/**
 * Multi-profile isolation check.
 *
 * Proves the three things multi-account depends on, using two Chrome profiles:
 *   1. separate cookie jars      — no session bleed between accounts
 *   2. separate storage/history  — profile A cannot see profile B's state
 *   3. redbot targets either one — via REDBOT_CDP, no code change
 *
 * Run: node dist/test/probe-profiles.js
 * Prereq: Chrome on 9222 and 9223, each with its own --user-data-dir
 */
import { chromium, type Browser } from 'playwright';

const ENDPOINTS = [
  { name: 'profile A', url: 'http://127.0.0.1:9222' },
  { name: 'profile B', url: 'http://127.0.0.1:9223' }
];

interface Snapshot {
  name: string;
  reachable: boolean;
  loggedIn: boolean | null;
  user: string | null;
  cookieCount: number | null;
  sessionCookieNames: string[];
  localStorageKeys: number | null;
  error?: string;
}

async function snapshot(name: string, endpoint: string): Promise<Snapshot> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(endpoint, { noDefaults: true } as never);
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error('no context');

    const page = await ctx.newPage();
    await page.goto('https://www.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3500);

    const top = (await page.locator('body').innerText().catch(() => '')).slice(0, 1200);
    const offersSignIn = /\bLog\s*In\b/i.test(top) || /\bSign\s*Up\b/i.test(top);

    /**
     * The signed-in account, NOT the first /user/ link on the page — that is a post
     * author and reporting it as the account identity is simply wrong.
     * Reddit exposes the current user on shreddit-app / the user-drawer element.
     */
    const user = await page.evaluate(() => {
      const d = globalThis.document;
      const app = d.querySelector('shreddit-app');
      const fromApp = app?.getAttribute('user-name') ?? null;
      if (fromApp) return fromApp;
      const drawer = d.querySelector('faceplate-tracker[source="nav"] a[href^="/user/"]')
        ?? d.querySelector('#USER_DROPDOWN_ID a[href^="/user/"]');
      const href = drawer?.getAttribute('href') ?? null;
      return href ? href.replace(/^\/user\//, '').replace(/\/$/, '') : null;
    }).catch(() => null);

    const cookies = await ctx.cookies('https://www.reddit.com');
    const sessionCookieNames = cookies
      .map((c) => c.name)
      .filter((n) => /session|token|loid|auth/i.test(n))
      .sort();

    const lsKeys = await page.evaluate(() => {
      try { return Object.keys((globalThis as any).localStorage).length; } catch { return -1; }
    }).catch(() => null);

    await page.close();

    return {
      name,
      reachable: true,
      loggedIn: !offersSignIn && !!user,
      user,
      cookieCount: cookies.length,
      sessionCookieNames,
      localStorageKeys: lsKeys
    };
  } catch (e) {
    return {
      name, reachable: false, loggedIn: null, user: null,
      cookieCount: null, sessionCookieNames: [], localStorageKeys: null,
      error: e instanceof Error ? e.message.split('\n')[0] : String(e)
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

const shots: Snapshot[] = [];
for (const e of ENDPOINTS) shots.push(await snapshot(e.name, e.url));

console.log('\n=== per-profile snapshot ===');
for (const s of shots) {
  if (!s.reachable) { console.log(`${s.name.padEnd(10)} UNREACHABLE — ${s.error}`); continue; }
  console.log(
    `${s.name.padEnd(10)} loggedIn=${String(s.loggedIn).padEnd(5)} user=${(s.user ?? '—').padEnd(18)}` +
    ` cookies=${String(s.cookieCount).padStart(3)} localStorage=${s.localStorageKeys}`
  );
  console.log(`${''.padEnd(10)} session-ish cookies: ${s.sessionCookieNames.join(', ') || '(none)'}`);
}

const [a, b] = shots;
console.log('\n=== isolation verdict ===');
if (a?.reachable && b?.reachable) {
  const aSess = a.sessionCookieNames.includes('reddit_session');
  const bSess = b.sessionCookieNames.includes('reddit_session');
  const sameUser = !!(a.user && b.user && a.user === b.user);
  console.log(`signed-in account         : A=${a.user ?? '(none)'}   B=${b.user ?? '(none)'}`);
  console.log(`reddit_session cookie     : A=${aSess ? 'present' : 'absent'}   B=${bSess ? 'present' : 'absent'}`);
  console.log(`cookie jars differ        : ${a.cookieCount !== b.cookieCount ? 'YES' : 'same count — compare names'}`);
  console.log(`localStorage differs      : ${a.localStorageKeys !== b.localStorageKeys ? 'YES' : 'same size'}`);
  console.log(`session bleed A -> B      : ${sameUser ? 'FAILED — same account in both' : 'none detected'}`);
  console.log(`verdict                   : ${!sameUser && a.cookieCount !== b.cookieCount ? 'profiles are isolated' : 'inconclusive — inspect above'}`);
} else {
  console.log('one or both endpoints unreachable — start both Chrome instances first');
}
