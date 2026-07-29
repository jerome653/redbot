/**
 * Signed-out visibility — the only check that establishes anyone else can see it.
 *
 * ## Why this exists
 *
 * `ACCOUNT-WARMING.md` names the failure mode redbot most needs to detect and is least equipped
 * to notice: **a comment posts, is visible to its author while signed in, and is invisible to
 * everyone else.** Checking your own profile does not detect it. Every confirmation redbot
 * performs elsewhere is done through the acting account's own session, so every one of them is
 * blind to exactly this.
 *
 * ## Why it is a browser and not a fetch
 *
 * Measured 2026-07-27, in order:
 *
 *   - `https://www.reddit.com/…` unauthenticated  → Cloudflare interstitial
 *   - `…/.json`                                    → HTTP 403
 *   - `old.reddit.com`                             → HTTP 301, then 403
 *   - headless Chrome, clean profile               → interstitial, never clears
 *   - **headed Chrome, clean profile**             → **interstitial auto-clears in ~2.5s, real page**
 *
 * So the check drives a real browser with no session. It is the same "attach, never launch"
 * lesson from the signed-in path: Reddit serves browsers, not clients.
 *
 * The profile is a throwaway — created empty, used once, and never reused. That is not
 * incidental: a profile that accumulated history would eventually stop being anonymous, and the
 * check would quietly start measuring something else.
 *
 * ## NOT WIRED — read this before trusting the paragraphs above
 *
 * As of 2026-07-27 `checkAnonymousVisibility` has **zero call sites in this repository**, tests
 * included. Nothing runs it. The warming rules it was committed alongside are now enforced in
 * `evaluateGates` (see src/warming.ts), but this function was left behind, and the header above
 * describes a capability the codebase does not currently exercise. It is a design, not a
 * running check. Recorded here rather than quietly left to be discovered, because everything
 * else in this file is written as though it happens.
 *
 * The seam a follow-up should wire it into is the signed-out branch of
 * **`observe(...)` in src/commands/observe.ts** — the `openSignedOut()` helper and the block that
 * records `reply-visible-signed-out` / `reply-absent-signed-out`. That path answers the same
 * question this file exists for, by a weaker method: `browser.newContext()` on the SAME Chrome
 * `attach()` connected to, i.e. a fresh context inside the signed-in browser, with no wait for
 * Reddit's interstitial. This function is the stronger reading — a separate Chrome on a clean
 * profile, waiting the interstitial out, and reporting `wasAnonymous: false` rather than
 * guessing when the reader turns out to be signed in.
 *
 * Swapping it in is NOT a local edit, which is why it is not done here. `config.browser`
 * (cdpEndpoint, profileDir) names the account's own Chrome; an anonymous read needs a second
 * endpoint pointing at a clean-profile instance, so the change spans src/config.ts and
 * src/commands/observe.ts. Until it is made, treat `reply-absent-signed-out` observations as
 * produced by the weaker check.
 */
import type { Browser } from 'playwright';

export interface VisibilityResult {
  /** True only when the artefact was found on a page loaded with no session at all. */
  visible: boolean;
  /** Confirms the reader really was signed out. False here invalidates the whole reading. */
  wasAnonymous: boolean;
  /** What the anonymous reader saw, for the record. */
  observed: string;
  /** Author as the anonymous reader sees it — proves we are looking at the right artefact. */
  author?: string | null;
  /** Seconds spent waiting for Reddit's interstitial to clear. */
  clearedAfterSeconds?: number;
}

/**
 * Read a permalink as a stranger.
 *
 * `browser` must be connected to a Chrome running a **clean profile** — no cookies, no session.
 * The caller owns its lifecycle; this function only reads.
 *
 * A comment permalink is checked by looking for the comment itself rather than the post, since
 * a removed comment leaves the post perfectly visible and that is the case worth catching.
 */
export async function checkAnonymousVisibility(
  browser: Browser,
  permalink: string,
  opts: { commentId?: string; maxWaitSeconds?: number } = {}
): Promise<VisibilityResult> {
  const maxWait = opts.maxWaitSeconds ?? 30;
  const context = browser.contexts()[0];
  if (!context) {
    return { visible: false, wasAnonymous: false, observed: 'the anonymous browser had no context' };
  }
  const page = await context.newPage();

  try {
    await page.goto(permalink, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    /**
     * Wait for the interstitial to clear rather than sleeping a fixed amount. Reddit's challenge
     * auto-submits, and a fixed 4s wait reported "blocked" for a page that was fine at 2.5s —
     * which would have been recorded as "not publicly visible" and read as a shadow removal.
     */
    let cleared: number | undefined;
    const step = 2.5;
    for (let waited = step; waited <= maxWait; waited += step) {
      await page.waitForTimeout(step * 1000);
      if (await page.locator('shreddit-post').count().catch(() => 0) > 0) {
        cleared = waited;
        break;
      }
    }

    /**
     * If the reader turns out to be signed in, the result is worthless — it is the same blind
     * check as everywhere else wearing a different name. Reported as not-anonymous rather than
     * as a visibility answer.
     */
    const signedIn = await page.locator('shreddit-app[user-logged-in="true"]').count().catch(() => 0) > 0;
    if (signedIn) {
      return {
        visible: false,
        wasAnonymous: false,
        observed: 'the "anonymous" browser was signed in — this profile is not clean and the reading proves nothing'
      };
    }

    if (cleared === undefined) {
      return {
        visible: false,
        wasAnonymous: true,
        observed: `Reddit's verification page never cleared within ${maxWait}s — visibility is unestablished, NOT disproven`
      };
    }

    const post = page.locator('shreddit-post').first();
    const author = await post.getAttribute('author').catch(() => null);

    if (opts.commentId) {
      const comment = page.locator(`shreddit-comment[thingid="${opts.commentId}"]`).first();
      const found = await comment.count().catch(() => 0) > 0;
      const text = found ? (await comment.innerText().catch(() => '')) : '';
      // A removed comment often still renders its node with a tombstone in place of the body.
      const tombstoned = /\[removed\]|\[deleted\]|removed by moderator/i.test(text);
      return {
        visible: found && !tombstoned,
        wasAnonymous: true,
        author,
        clearedAfterSeconds: cleared,
        observed: !found
          ? `the comment is absent for a signed-out reader — shadow removal, or it never landed publicly`
          : tombstoned
            ? 'the comment renders as removed/deleted for a signed-out reader'
            : 'the comment is present and readable for a signed-out reader'
      };
    }

    return {
      visible: true,
      wasAnonymous: true,
      author,
      clearedAfterSeconds: cleared,
      observed: `the post is present for a signed-out reader (author ${author ?? 'unknown'})`
    };
  } catch (e) {
    return {
      visible: false,
      wasAnonymous: true,
      observed: `the anonymous read failed: ${e instanceof Error ? e.message : String(e)}`
    };
  } finally {
    await page.close().catch(() => { /* the page may already be gone */ });
  }
}
