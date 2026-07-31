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
    if (!(await el.isVisible({ timeout: 1200 }).catch(() => false))) continue;

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
