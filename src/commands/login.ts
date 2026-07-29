/**
 * `redbot login`
 *
 * redbot does not handle your password and does not store a session file. The session
 * lives in the Chrome profile you started. This command just opens Reddit in that browser,
 * waits for you to sign in, and confirms it worked.
 */
import { attach, whoAmI, isBlocked, isBrowserUp, NoBrowserError } from '../browser.js';
import { config } from '../config.js';
import { ask } from '../ask.js';
import { record, say } from '../log.js';

export async function login(): Promise<number> {
  say.head('redbot login');

  if (!(await isBrowserUp())) {
    say.fail(new NoBrowserError(config.browser.cdpEndpoint).message);
    return 1;
  }

  const s = await attach();
  try {
    say.step('Opening Reddit in your browser…');
    await s.page.goto(`${config.redditBase}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    if (await isBlocked(s.page)) {
      say.fail('Reddit served a block page to this browser profile.');
      say.step('Open reddit.com in that Chrome window by hand once, then re-run `redbot login`.');
      await record('error', 'login blocked by Reddit bot protection');
      return 1;
    }

    const me = await whoAmI(s.page);
    if (me.loggedIn) {
      say.ok(`Signed in as: ${me.username ?? '(username not readable)'}`);
      say.step(`confirmed via ${me.via}`);
      await record('login', `signed in as ${me.username ?? 'unknown'}`, { username: me.username, via: me.via });
      return 0;
    }

    say.step('Sign in to Reddit in that browser window.');
    say.step('redbot never sees your password — the session stays in Chrome.');
    await ask('\n  Press Enter once you are signed in… ');

    await s.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await s.page.waitForTimeout(2500);
    const after = await whoAmI(s.page);

    if (!after.loggedIn) {
      say.fail('Logged in: false');
      say.step(`checked via ${after.via}`);
      await record('error', 'login not confirmed', { via: after.via });
      return 1;
    }

    say.ok(`Signed in as: ${after.username ?? '(username not readable)'}`);
    say.step(`confirmed via ${after.via}`);
    say.step('The session lives in your Chrome profile and persists across runs.');
    say.step('Next: redbot read <subreddit>');
    await record('login', `signed in as ${after.username ?? 'unknown'}`, { username: after.username });
    return 0;
  } finally {
    await s.close();
  }
}
