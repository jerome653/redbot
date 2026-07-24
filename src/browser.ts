/**
 * Browser access.
 *
 * MEASURED 2026-07-22 — see certification/evidence/2026-07-22-reddit-access.md
 *
 *   Playwright LAUNCHING the browser  ->  Reddit serves a block page. All four modes:
 *                                          chromium/chrome x headless/headed.
 *   Playwright ATTACHING to a Chrome  ->  works, on a profile that has been used by a
 *   the operator started themselves       human at least once.
 *
 * So redbot does not launch browsers. The operator runs one Chrome with a debugging port,
 * logs into Reddit in it once, and redbot attaches to that. This is also the truest reading
 * of "assist a human in a real browser session" — it is genuinely their session.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config } from './config.js';

export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Detaches. Never closes the operator's Chrome. */
  close: () => Promise<void>;
}

export class NoBrowserError extends Error {
  constructor(endpoint: string) {
    super(
      `No debuggable Chrome at ${endpoint}.\n\n` +
      `Start one (once per session), then re-run:\n\n` +
      `  & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" \`\n` +
      `      --remote-debugging-port=9222 \`\n` +
      `      --user-data-dir="${config.browser.profileDir}" \`\n` +
      `      --no-first-run --no-default-browser-check\n\n` +
      `Then run \`redbot login\` and sign in to Reddit in that window.`
    );
    this.name = 'NoBrowserError';
  }
}

/** Is a debuggable Chrome listening? */
export async function isBrowserUp(endpoint = config.browser.cdpEndpoint): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Attach to the operator's Chrome and open our own tab.
 *
 * `noDefaults` keeps Playwright from applying its context overrides to a browser it did not
 * launch — the documented option for attaching to a daily-driver browser.
 */
export async function attach(): Promise<Session> {
  const endpoint = config.browser.cdpEndpoint;
  if (!(await isBrowserUp(endpoint))) throw new NoBrowserError(endpoint);

  const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true } as never);
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close();
    throw new Error('Attached, but the browser reported no context. Is the window still open?');
  }

  // Our own tab. Never take over one the operator is using.
  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    close: async () => {
      await page.close().catch(() => {});
      await browser.close().catch(() => {});   // detach only
    }
  };
}

export interface Identity {
  loggedIn: boolean;
  username: string | null;
  /** how the answer was reached, so a wrong answer is debuggable */
  via: string;
}

/**
 * Who is signed in — deterministic, not inferred from page copy.
 *
 * Observed on two live profiles, 2026-07-22 (see probe-authsignals):
 *   - `shreddit-app[user-logged-in]` is "true" / "false". This is Reddit's own flag.
 *   - the header profile link is `/user/<name>/communities` and names the SIGNED-IN account.
 *
 * Two earlier attempts failed and are recorded so they are not repeated:
 *   - `#expand-user-drawer-button` exists while logged OUT  -> false positives
 *   - "Log In" / "Sign Up" body text renders while logged IN -> false negatives
 *   - the first `a[href^="/user/"]` on the page is a POST AUTHOR, not the account
 */
export async function whoAmI(page: Page): Promise<Identity> {
  const read = () => page.evaluate(() => {
    const app = document.querySelector('shreddit-app');
    const flag = app?.getAttribute('user-logged-in');

    // The header profile link names the SIGNED-IN account. Anywhere else on the page an
    // /user/ link is a post author — reading one of those reports the wrong identity.
    const candidates = [
      'header a[href^="/user/"]',
      'nav a[href^="/user/"]',
      'a[href^="/user/"][href$="/communities"]',
      '#expand-user-drawer-button a[href^="/user/"]',
      'faceplate-tracker[source="nav"] a[href^="/user/"]'
    ];
    let href: string | null = null;
    for (const sel of candidates) {
      const el = document.querySelector<HTMLAnchorElement>(sel);
      if (el) { href = el.getAttribute('href'); break; }
    }
    const name = href
      ? href.replace(/^\/user\//, '').replace(/\/(communities|posts|comments)\/?$/, '').replace(/\/$/, '')
      : null;

    return { flag: (flag ?? null) as string | null, name: (name || null) as string | null };
  }).catch(() => ({ flag: null as string | null, name: null as string | null }));

  // The header hydrates after first paint. Poll briefly rather than read once and give up —
  // measured: a single immediate read returns the flag but not yet the username.
  let result = await read();
  for (let i = 0; i < 6 && result.flag === 'true' && !result.name; i++) {
    await page.waitForTimeout(700);
    result = await read();
  }

  if (result.flag === 'true') {
    return {
      loggedIn: true,
      username: result.name,
      via: result.name ? 'shreddit-app[user-logged-in] + header profile link' : 'shreddit-app[user-logged-in]'
    };
  }
  if (result.flag === 'false') {
    return { loggedIn: false, username: null, via: 'shreddit-app[user-logged-in]=false' };
  }
  return { loggedIn: false, username: null, via: 'shreddit-app not found — page may not have rendered' };
}

/** Convenience wrapper. Prefer whoAmI() when the username matters. */
export async function isLoggedIn(page: Page): Promise<boolean> {
  return (await whoAmI(page)).loggedIn;
}

/** True when Reddit served a bot-block or challenge page instead of content. */
export async function isBlocked(page: Page): Promise<boolean> {
  const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 300);
  return /blocked by network security|please wait for verification|whoa there|are you a robot/i.test(text);
}

/**
 * True when Reddit is rate-limiting us.
 *
 * DEFECT-02: measured 2026-07-22 — sustained reading produced HTTP 429, which Chrome
 * renders as an error page rather than throwing. Detected here so a run can back off
 * instead of continuing to hammer and failing every remaining thread.
 */
export async function isRateLimited(page: Page): Promise<boolean> {
  const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 400);
  return /HTTP ERROR 429|too many requests|This page isn.t working/i.test(text);
}
