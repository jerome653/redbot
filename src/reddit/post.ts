/**
 * Publishing to Reddit — a comment, and a post. The only write paths in redbot.
 *
 * Every call is logged before the submit and after the result, so a submitted-with-no-result
 * entry in history means "unknown outcome — go look by hand", never "retry automatically".
 */
import type { Page } from 'playwright';
import { sel } from './selectors.js';
import { firstVisible, firstUsable } from './scrape.js';
import { pause, sleep, typingDelay } from '../pacing.js';
import { config } from '../config.js';

/**
 * Does a rendered comment node's text contain the body we just posted?
 *
 * Whitespace-normalized SUBSTRING, not equality. The old confirmation used Playwright's
 * `text="<60-char prefix>"`, which is a STRICT full-text-node match — a real comment node holds
 * the whole body (plus an appended disclosure line, plus surrounding chrome), so the prefix
 * never equalled a text node and every genuine success was recorded as a failure (evaluation
 * H2). Matching is done here in Node, on text pulled from the page, so it is unit-testable.
 */
export function commentTextMatches(nodeText: string, body: string): boolean {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const probe = norm(body).slice(0, 60);
  return probe.length > 0 && norm(nodeText).includes(probe);
}

export interface PublishResult {
  ok: boolean;
  error?: string;
  url?: string;
  /**
   * Permalink of the comment itself, when Reddit exposes it on the rendered node.
   *
   * The thread URL is not enough for Part F: checking a reply at 1h / 24h / 7d means looking
   * at THAT comment, and on a busy thread it may not be on the first page of comments. Read
   * here, at the one moment we are certain which node is ours.
   */
  commentPermalink?: string;
  commentId?: string;
}

async function typeHuman(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(typingDelay());
  }
}

export async function publishComment(page: Page, permalink: string, body: string): Promise<PublishResult> {
  try {
    await page.goto(permalink, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await pause();

    // The composer is sometimes collapsed behind a trigger button.
    const editorBefore = await firstUsable(page, sel.commentEditor);
    if (!editorBefore) {
      const trigger = await firstVisible(page, sel.commentBoxTrigger);
      if (!trigger) {
        return { ok: false, error: 'comment composer not found — logged out, or thread locked?' };
      }
      await trigger.click();
      await pause();
    }

    const editor = await firstUsable(page, sel.commentEditor);
    if (!editor) return { ok: false, error: 'comment editor did not open, or opened read-only' };

    await editor.click();
    await sleep(400);
    await typeHuman(page, body);
    await pause();

    const submit = await firstUsable(page, sel.commentSubmit);
    if (!submit) return { ok: false, error: 'submit button not found, or still disabled' };

    await submit.click();
    await sleep(3500);

    /**
     * Confirm by finding OUR just-posted comment node and reading its own identity off it. The
     * matching is done in Node with `commentTextMatches` (a normalized substring), so it survives
     * the disclosure line and re-wrapping that made the old strict-text confirmation fail on
     * every real success (evaluation H2). Absent attributes are reported as absent — never
     * guessed from the thread URL. Give the node a moment to render before giving up.
     */
    type CommentNode = { text: string; permalink: string | null; id: string | null };
    const readNodes = (): Promise<CommentNode[]> => page.evaluate(() =>
      Array.from(document.querySelectorAll('shreddit-comment')).map((n) => ({
        text: (n as HTMLElement).innerText,
        permalink: n.getAttribute('permalink'),
        id: n.getAttribute('thingid') ?? n.getAttribute('thing-id') ?? n.getAttribute('id')
      }))
    ).catch(() => [] as CommentNode[]);

    let ours: CommentNode | undefined;
    for (let attempt = 0; attempt < 4 && !ours; attempt++) {
      if (attempt) await sleep(2000);
      const nodes = await readNodes();
      ours = nodes.find((n) => commentTextMatches(n.text, body));
    }

    if (!ours) {
      return { ok: false, error: 'submitted but the comment was not found on the page afterwards' };
    }

    const abs = ours.permalink
      ? (ours.permalink.startsWith('http') ? ours.permalink : config.redditBase + ours.permalink)
      : undefined;

    return {
      ok: true,
      url: page.url(),
      ...(abs ? { commentPermalink: abs } : {}),
      ...(ours.id ? { commentId: ours.id } : {})
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const redditBase = config.redditBase;

/* ------------------------------------------------------------------ *
 * Creating a post — the SECOND write path
 * ------------------------------------------------------------------ */

export interface SubmitResult {
  ok: boolean;
  error?: string;
  /** The new post's permalink, read off the page redbot landed on. Absent when unconfirmed. */
  postPermalink?: string;
  /** Where the browser ended up, whatever happened. */
  url?: string;
}

/**
 * Publish a new post to a subreddit.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SHAPED EXACTLY LIKE `publishComment` AND NOT MORE CONVENIENTLY.
 *
 * A post is a bigger public statement than a comment — it is attributable, it sits at the top of
 * a subreddit, and it cannot be quietly edited away. So it gets the SAME contract, not a lighter
 * one: fill, submit, and then CONFIRM by reading redbot's own result off the page. The confirm is
 * the part that matters. `submitted-with-no-result` in history means "unknown outcome — go look
 * by hand", never "retry automatically", because a retry on a post that actually landed is a
 * duplicate on somebody's subreddit and cannot be taken back.
 *
 * CONFIRMATION IS BY NAVIGATION, WHICH IS WHAT REDDIT ACTUALLY DOES. On a successful submit the
 * composer navigates to the new post's permalink (`/r/<sub>/comments/<id>/<slug>/`). That URL is
 * the evidence, and the title is checked against it so a redirect to some other page cannot be
 * mistaken for success. A submit that leaves the browser on the submit page is reported as
 * unconfirmed rather than as a failure — it may have landed.
 *
 * FLAIR IS NOT GUESSED. Many subreddits refuse a submission without one, and picking a flair on
 * a person's behalf is choosing how their post is categorised in a room they have to live in.
 * When submit stays disabled the flair requirement is the most likely reason, and that is what
 * the error says — it does not silently click the first option.
 * ---------------------------------------------------------------------------
 */
export async function publishPost(
  page: Page,
  subreddit: string,
  title: string,
  body: string
): Promise<SubmitResult> {
  const clean = String(subreddit || '').replace(/^\/?r\//i, '').trim();
  if (!/^[A-Za-z0-9_]{2,21}$/.test(clean)) {
    return { ok: false, error: `"${subreddit}" is not a subreddit name` };
  }
  if (!title.trim()) return { ok: false, error: 'a post needs a title' };

  try {
    const submitUrl = `${config.redditBase}/r/${clean}/submit/?type=TEXT`;
    await page.goto(submitUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await pause();

    const titleField = await firstUsable(page, sel.postTitleField);
    if (!titleField) {
      return { ok: false, error: `no title field on ${submitUrl} — signed out, or r/${clean} does not accept text posts?`, url: page.url() };
    }
    await titleField.click();
    await sleep(300);
    await typeHuman(page, title);
    await pause();

    /* The body is optional on Reddit; a title-only post is legitimate. Absent field is only an
       error when there is a body to put in it. */
    const bodyField = await firstUsable(page, sel.postBodyField);
    if (body.trim()) {
      if (!bodyField) {
        return { ok: false, error: 'no body field on the submit page, and this post has a body', url: page.url() };
      }
      await bodyField.click();
      await sleep(300);
      await typeHuman(page, body);
      await pause();
    }

    const submit = await firstUsable(page, sel.postSubmitButton);
    if (!submit) {
      /* Most often the flair requirement. Named as a likely cause rather than asserted as one. */
      const hasFlair = Boolean(await firstVisible(page, sel.flairButton));
      return {
        ok: false,
        url: page.url(),
        error: hasFlair
          ? `the Post button is not available — r/${clean} shows a Flair control, and many subreddits refuse a submission without one. Choose a flair in the browser, then send again.`
          : 'the Post button was not found, or is still disabled'
      };
    }

    const before = page.url();
    await submit.click();

    /**
     * Confirm by NAVIGATION plus title, and give it several looks before giving up.
     *
     * `/comments/` in the path is what separates a landed post from a submit page that simply
     * re-rendered. The title check is what separates it from a redirect to somewhere else
     * entirely — a rule page, a sign-in wall, the subreddit front page.
     */
    const wanted = title.trim().toLowerCase().slice(0, 60);
    let landed: string | null = null;
    for (let attempt = 0; attempt < 6 && !landed; attempt++) {
      await sleep(2000);
      const now = page.url();
      if (now !== before && /\/comments\//.test(now)) {
        const heading = (await page.locator(sel.postTitle[0]!).first().textContent().catch(() => '')) ?? '';
        if (heading.trim().toLowerCase().includes(wanted.slice(0, 30))) landed = now;
      }
    }

    if (!landed) {
      return {
        ok: false,
        url: page.url(),
        error: 'submitted, but no post page appeared afterwards — the outcome is UNKNOWN. Check the account on Reddit by hand before sending again; a retry could duplicate a post that landed.'
      };
    }

    return { ok: true, url: landed, postPermalink: landed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
