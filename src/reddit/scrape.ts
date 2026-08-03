/**
 * Reading Reddit: browse a subreddit, run a search, open a thread and collect it.
 */
import type { Page, Locator } from 'playwright';
import { config } from '../config.js';
import { sel } from './selectors.js';
import { pause, sleep } from '../pacing.js';
import { threadId } from '../store.js';
import type { Thread, Comment } from '../types.js';

/** First selector in the list that resolves to a visible element. */
export async function firstVisible(page: Page | Locator, candidates: readonly string[]) {
  for (const s of candidates) {
    const loc = (page as Page).locator ? (page as Page).locator(s) : (page as Locator).locator(s);
    const el = loc.first();
    if (await el.isVisible({ timeout: 1200 }).catch(() => false)) return el;
  }
  return null;
}

/**
 * First selector that resolves to an element you can actually ACT on.
 *
 * ---------------------------------------------------------------------------
 * WHY VISIBLE IS NOT ENOUGH FOR A CONTROL.
 *
 * `firstVisible` is right for reading text. It is wrong for the composer and the submit button,
 * because a control can be perfectly visible and completely inert: a readonly editor while the
 * page is still settling, a submit button Reddit has disabled until the body is non-empty. Handing
 * one of those back produces a failure at the point of USE, far from the selector that chose it —
 * and for the composer that surfaced as `[no-composer]`, which reads as "the element is missing"
 * when the element was found and simply could not be typed into.
 *
 * REJECTS ONLY WHAT IS PROVABLY UNUSABLE. Measured on Chrome 150 through Playwright:
 *
 *   element                 isVisible   isEditable   isEnabled
 *   contenteditable div     true        true         true
 *   textarea                true        true         true
 *   textarea[readonly]      true        FALSE        true
 *   input[disabled]         true        FALSE        false
 *   button                  true        THROWS       true
 *   button[disabled]        true        THROWS       false
 *   plain div               true        THROWS       true
 *
 * So `isEditable` THROWS on anything that is not a form control — including the submit button. A
 * check that demanded `isEditable() === true` would therefore reject the very button it was added
 * to protect. This treats a throw as "cannot tell" and keeps the element; only an explicit `false`
 * from either probe disqualifies it.
 *
 * That makes the result a strict subset of `firstVisible`'s: everything it returns, this returns,
 * minus the elements the browser itself reports as not editable or not enabled. It cannot start
 * rejecting a composer that used to work.
 * ---------------------------------------------------------------------------
 */
export async function firstUsable(page: Page | Locator, candidates: readonly string[]) {
  for (const s of candidates) {
    const loc = (page as Page).locator ? (page as Page).locator(s) : (page as Locator).locator(s);
    const el = loc.first();
    if (!(await el.isVisible({ timeout: 1200 }).catch(() => false))) {
      /**
       * NOT VISIBLE IS NOT THE SAME AS NOT THERE — the Tier-0 blocker, and it was only half fixed.
       *
       * Playwright's `isVisible()` is false for an element with no layout box, which Reddit's
       * composer legitimately has until it is interacted with. TIER0-BLOCKER-2026-07-27 recorded
       * the first-ever publish dying at `[no-composer]` for exactly this, and its fix — a
       * `firstUsable` that separates "no layout box" from "hidden" — was verified live the same
       * day. It was verified on `tier0/composer-firstusable`, which was never merged.
       *
       * What DID reach the release line, as 79be049, is a different function that happens to
       * share the name: it demands `isVisible()` first and then adds editable/enabled checks, so
       * it is a strict SUBSET of `firstVisible` and cannot see a zero-box composer at all. Two
       * fixes, one name, and the document still says RESOLVED — so the blocker read as closed
       * while the shipping line never had the half that closes it.
       *
       * This is the missing half, and it is purely additive: every path below only runs where the
       * old code had already given up and returned null. It cannot reject anything that used to
       * work. An element is kept only when the browser itself says it is present and not hidden
       * — `display`, `visibility`, the `hidden` attribute and `aria-disabled` are the four ways a
       * page says "not for you"; a zero-size box is not one of them.
       */
      if ((await el.count().catch(() => 0)) === 0) continue;
      const present = await el
        .evaluate((node: Element) => {
          const cs = getComputedStyle(node);
          return (
            cs.display !== 'none' &&
            cs.visibility !== 'hidden' &&
            !node.hasAttribute('hidden') &&
            node.getAttribute('aria-disabled') !== 'true'
          );
        })
        .catch(() => false);
      if (!present) continue;
      /* Present but unrendered: return it without the editable/enabled probes below, which need a
         laid-out element to answer and would throw or report false on this one. */
      return el;
    }

    /* `null` means the probe could not answer (it threw) — which is not evidence against the
       element, so it is kept. Only an explicit false rules it out. */
    const editable = await el.isEditable({ timeout: 600 }).catch(() => null);
    if (editable === false) continue;
    const enabled = await el.isEnabled({ timeout: 600 }).catch(() => null);
    if (enabled === false) continue;

    return el;
  }
  return null;
}

async function textOf(scope: Page | Locator, candidates: readonly string[]): Promise<string | null> {
  const el = await firstVisible(scope, candidates);
  if (!el) return null;
  const t = await el.innerText().catch(() => null);
  return t ? t.trim() : null;
}

function toInt(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /(-?[\d.]+)\s*([km])?/i.exec(raw.replace(/,/g, ''));
  if (!m || !m[1]) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const suffix = m[2]?.toLowerCase();
  if (suffix === 'k') return Math.round(n * 1_000);
  if (suffix === 'm') return Math.round(n * 1_000_000);
  return Math.round(n);
}

/**
 * Collect post permalinks from the listing on screen.
 *
 * `scope` matters: on a search page the whole document also contains home-feed and sidebar
 * widgets, and collecting from the document root pulls in unrelated posts. Measured
 * 2026-07-22 — an unscoped search for "elementor slow loading" returned "Dog breeds",
 * "Tile Up daily puzzle" and other feed items alongside the real results.
 */
/**
 * The listing entries themselves — permalink plus the title as it appears in the list.
 *
 * `collectPermalinks` returns URLs, which is all `read` needs. `search` needs enough to show
 * a person what it found BEFORE opening anything, so the same crawl also keeps the link text.
 * Titles on a Reddit listing are the link text; when a layout change empties it the entry is
 * kept with a null title rather than dropped — a candidate you cannot preview is still a
 * candidate, and silently losing it would misreport what the search returned.
 */
export interface Listing {
  url: string;
  title: string | null;
}

export async function collectListings(
  page: Page,
  max: number,
  scope?: readonly string[]
): Promise<Listing[]> {
  const urls = await collectPermalinks(page, max, scope, (href, text) => titles.set(href, text));
  return urls.map((url) => ({ url, title: titles.get(url) ?? null }));
}

/** Populated as a side effect of the crawl above; keyed by absolute permalink. */
const titles = new Map<string, string | null>();

export async function collectPermalinks(
  page: Page,
  max: number,
  scope?: readonly string[],
  onLink?: (href: string, text: string | null) => void
): Promise<string[]> {
  const found = new Set<string>();
  let idleRounds = 0;

  // Resolve the container once; fall back to the page if the layout changed.
  let root: Page | Locator = page;
  let scopeUsed = '(whole page)';
  if (scope) {
    for (const s of scope) {
      const el = page.locator(s).first();
      if (await el.count().then((n) => n > 0).catch(() => false)) {
        root = el; scopeUsed = s; break;
      }
    }
  }
  if (scope && scopeUsed === 'main') {
    // 'main' is the last-resort container and still contains sidebar/feed widgets.
    console.warn('  !   collecting from <main> — expect some unrelated posts');
  }

  while (found.size < max && idleRounds < 3) {
    const before = found.size;

    for (const s of sel.postLink) {
      const links = await root.locator(s).all().catch(() => []);
      for (const link of links) {
        const href = await link.getAttribute('href').catch(() => null);
        if (href && href.includes('/comments/')) {
          const abs = href.startsWith('http') ? href : config.redditBase + href;
          if (onLink && !found.has(abs)) {
            const text = await link.innerText().catch(() => null);
            const label = text?.trim() || (await link.getAttribute('aria-label').catch(() => null))?.trim() || null;
            onLink(abs, label);
          }
          found.add(abs);
        }
        if (found.size >= max) break;
      }
      if (found.size >= max) break;
    }

    if (found.size === before) idleRounds++;
    else idleRounds = 0;

    if (found.size < max) {
      await page.mouse.wheel(0, 1200 + Math.floor(Math.random() * 900));
      await sleep(900);
    }
  }
  return [...found].slice(0, max);
}

export async function openSubreddit(page: Page, subreddit: string, sort = 'hot'): Promise<void> {
  const name = subreddit.replace(/^\/?r\//i, '');
  await page.goto(`${config.redditBase}/r/${name}/${sort}/`, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000
  });
  await pause();
}

export async function runSearch(page: Page, query: string): Promise<void> {
  const url = `${config.redditBase}/search/?q=${encodeURIComponent(query)}&sort=relevance`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await pause();
}

/**
 * A community (subreddit) result, as the search page reports it.
 *
 * `weeklyVisitors` and `weeklyContributions` are what Reddit actually publishes here — NOT the
 * subscriber count. They are named for what they are because the difference decides things: a
 * subreddit with 800k subscribers and 300 weekly contributions is a dead room, and calling the
 * number "members" would hide exactly the case a person is choosing between.
 */
export interface CommunityCandidate {
  /** Bare name, no `r/` prefix — the shape `addSource('subreddit', …)` expects. */
  name: string;
  permalink: string;
  description: string;
  weeklyVisitors: number | null;
  weeklyContributions: number | null;
}

/** Open the community search. Separate from `runSearch`, which searches POSTS. */
export async function runCommunitySearch(page: Page, query: string): Promise<void> {
  const url = `${config.redditBase}/search/?q=${encodeURIComponent(query)}&type=communities`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await pause();
}

/**
 * Read the community results off the page. Opens nothing — the listing carries every field.
 *
 * MEASURED against live Reddit 2026-08-03 (20 results for "wordpress"). The two counts are read
 * from `faceplate-number`'s `number` attribute rather than its rendered text, because the text is
 * abbreviated ("1.4K") and cannot be turned back into 1,441.
 *
 * ORDER IS NOT TRUSTED to identify which count is which. The units render visitors-then-
 * contributions today, but that is a layout fact and layouts move; the surrounding label is the
 * only thing that says what a number MEANS. A count whose label cannot be read comes back null,
 * because a number attributed to the wrong thing is worse than a missing one — it is the shape
 * that makes a dead subreddit look busy.
 */
export async function collectCommunities(page: Page): Promise<CommunityCandidate[]> {
  for (const s of sel.communityResult) {
    const units = page.locator(s);
    if (!(await units.count().catch(() => 0))) continue;

    const out: CommunityCandidate[] = [];
    const n = await units.count();
    for (let i = 0; i < n; i++) {
      const u = units.nth(i);
      const href = await u.locator(sel.communityLink[0]!).first()
        .getAttribute('href').catch(() => null);
      const m = /^\/r\/([A-Za-z0-9_]{2,21})\/?$/.exec(href ?? '');
      if (!m) continue;                       // a link that is not a community is not a result

      const counts = u.locator(sel.communityCount[0]!);
      let visitors: number | null = null;
      let contributions: number | null = null;
      const cn = await counts.count().catch(() => 0);
      for (let c = 0; c < cn; c++) {
        const el = counts.nth(c);
        const raw = await el.getAttribute('number').catch(() => null);
        const value = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
        if (value === null) continue;
        /* The label lives on the parent, alongside the rendered number. */
        const label = (await el.evaluate((e) => e.parentElement?.textContent ?? '')
          .catch(() => '')).toLowerCase();
        if (label.includes('visitor')) visitors = value;
        else if (label.includes('contribution')) contributions = value;
      }

      out.push({
        name: m[1]!,
        permalink: `${config.redditBase}/r/${m[1]!}/`,
        description: ((await u.locator('p').first().textContent().catch(() => '')) ?? '')
          .replace(/\s+/g, ' ').trim().slice(0, 400),
        weeklyVisitors: visitors,
        weeklyContributions: contributions
      });
    }
    if (out.length) return out;
  }
  return [];
}

/** Open one thread and pull out everything worth keeping. */
export async function collectThread(
  page: Page,
  permalink: string,
  source: 'read' | 'search',
  query?: string
): Promise<Thread | null> {
  await page.goto(permalink, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await pause();

  const title = await textOf(page, sel.postTitle);
  if (!title) return null;

  const body = await textOf(page, sel.postBody);

  const post = await firstVisible(page, sel.postUnit);
  const attr = async (name: string) =>
    post ? await post.getAttribute(name).catch(() => null) : null;

  const createdRaw = await attr('created-timestamp');
  let ageMinutes: number | null = null;
  let ageText: string | null = null;
  if (createdRaw) {
    const t = Date.parse(createdRaw);
    if (!Number.isNaN(t)) {
      ageMinutes = Math.max(0, Math.round((Date.now() - t) / 60_000));
      ageText = ageMinutes < 60 ? `${ageMinutes} min ago`
        : ageMinutes < 1440 ? `${Math.round(ageMinutes / 60)} hr ago`
        : `${Math.round(ageMinutes / 1440)} d ago`;
    }
  }

  const upvotes = toInt(await attr('score'));
  const commentCount = toInt(await attr('comment-count'));
  const author = await attr('author');

  const comments: Comment[] = [];
  for (const s of sel.commentNode) {
    const nodes = await page.locator(s).all().catch(() => []);
    if (!nodes.length) continue;
    for (const node of nodes.slice(0, config.limits.maxCommentsPerThread)) {
      const text = await textOf(node, sel.commentBody);
      if (!text) continue;
      const depthRaw = await node.getAttribute('depth').catch(() => null);
      const cAuthor = await node.getAttribute('author').catch(() => null);
      comments.push({
        author: cAuthor,
        body: text.slice(0, 2000),
        depth: depthRaw ? Number(depthRaw) || 0 : 0
      });
    }
    if (comments.length) break;
  }

  const subMatch = /\/r\/([^/]+)\//.exec(permalink);

  return {
    id: threadId(permalink),
    permalink,
    title,
    subreddit: subMatch?.[1] ?? 'unknown',
    author,
    upvotes,
    commentCount,
    ageText,
    ageMinutes,
    body: body ? body.slice(0, 6000) : null,
    comments,
    collectedAt: new Date().toISOString(),
    source,
    ...(query ? { query } : {})
  };
}
