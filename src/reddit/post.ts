/**
 * Publishing a comment. The only write path in redbot.
 *
 * Every call is logged before the submit and after the result, so a submitted-with-no-result
 * entry in history means "unknown outcome — go look by hand", never "retry automatically".
 */
import type { Page } from 'playwright';
import { sel } from './selectors.js';
import { firstUsable, type Usable } from './scrape.js';
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

/**
 * Put a control into use, by the route its own shape allows.
 *
 * A visible control is clicked exactly as before — the normal path is unchanged. A zero-box one
 * cannot be: Playwright's mouse click needs a hit target, and `scrollIntoViewIfNeeded` on the
 * composer times out (measured 2026-07-27), because the element has no layout box to scroll to.
 * It is focused and clicked at the DOM level instead, which is the only route to an element the
 * page renders but does not lay out. `typeHuman` types into whatever holds focus, so focusing
 * the contenteditable is what makes the keystrokes land in it.
 */
async function activate({ el, via }: Usable): Promise<void> {
  if (via === 'visible') {
    await el.click();
    return;
  }
  await el.evaluate((node: HTMLElement) => {
    node.focus();
    node.click();
  });
}

export async function publishComment(page: Page, permalink: string, body: string): Promise<PublishResult> {
  try {
    await page.goto(permalink, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await pause();

    // The composer is sometimes collapsed behind a trigger button — and on a current thread page
    // it is present, enabled and zero-size, which a visibility test reads as absent. `firstUsable`
    // separates "no box" from "hidden"; `activate` drives each accordingly.
    let editor = await firstUsable(page, sel.commentEditor);
    if (!editor) {
      const trigger = await firstUsable(page, sel.commentBoxTrigger);
      if (!trigger) {
        return { ok: false, error: 'comment composer not found — logged out, or thread locked?' };
      }
      await activate(trigger);
      await pause();
      editor = await firstUsable(page, sel.commentEditor);
    }
    if (!editor) return { ok: false, error: 'comment editor did not open' };

    await activate(editor);
    await sleep(400);
    await typeHuman(page, body);
    await pause();

    const submit = await firstUsable(page, sel.commentSubmit);
    if (!submit) return { ok: false, error: 'submit button not found' };

    await activate(submit);
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
