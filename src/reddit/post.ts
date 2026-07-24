/**
 * Publishing a comment. The only write path in redbot.
 *
 * Every call is logged before the submit and after the result, so a submitted-with-no-result
 * entry in history means "unknown outcome — go look by hand", never "retry automatically".
 */
import type { Page } from 'playwright';
import { sel } from './selectors.js';
import { firstVisible } from './scrape.js';
import { pause, sleep, typingDelay } from '../pacing.js';
import { config } from '../config.js';

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
 * Normalise text the way a human comparing two strings would — case-fold, drop markdown
 * punctuation, collapse whitespace. The rendered DOM is NOT the source: `**bold**` renders as
 * `bold`, links lose their `(url)`, backticks vanish, and a disclosure line is appended. An
 * exact match on raw source therefore never finds the landed comment (H2), which flipped every
 * real success to `failed` and let the duplicate gate re-post it. Comparison happens on this
 * normalised form on both sides.
 */
function normText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_`~#>\[\]()]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function publishComment(
  page: Page,
  permalink: string,
  body: string,
  author?: string
): Promise<PublishResult> {
  try {
    await page.goto(permalink, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await pause();

    // The composer is sometimes collapsed behind a trigger button.
    const editorBefore = await firstVisible(page, sel.commentEditor);
    if (!editorBefore) {
      const trigger = await firstVisible(page, sel.commentBoxTrigger);
      if (!trigger) {
        return { ok: false, error: 'comment composer not found — logged out, or thread locked?' };
      }
      await trigger.click();
      await pause();
    }

    const editor = await firstVisible(page, sel.commentEditor);
    if (!editor) return { ok: false, error: 'comment editor did not open' };

    await editor.click();
    await sleep(400);
    await typeHuman(page, body);
    await pause();

    const submit = await firstVisible(page, sel.commentSubmit);
    if (!submit) return { ok: false, error: 'submit button not found' };

    await submit.click();
    await sleep(3500);

    /**
     * Confirm the comment landed by finding OUR node — matched on author (when we know the
     * username) and on a normalised fragment of the body, never on an exact source-text match.
     * A distinctive slice from the MIDDLE of the reply is used as the fragment: the opening is
     * often a generic greeting shared with other comments, and the end may carry the appended
     * disclosure. Absent attributes are reported as absent, never guessed from the thread URL.
     */
    // A distinctive slice from the MIDDLE of the reply: the opening is often a generic greeting
    // shared with other comments, and the end may carry the appended disclosure.
    const needle = normText(body).slice(20, 90).trim() || normText(body).slice(0, 60);
    const ours = await page.evaluate(
      ({ needle, author }: { needle: string; author: string | null }) => {
        // Same normalisation as normText() in post.ts; a test asserts the two stay in step.
        const normalise = (s: string): string => s
          .toLowerCase()
          .replace(/[*_`~#>\[\]()]/g, ' ')
          .replace(/https?:\/\/\S+/g, ' ')
          .replace(/[^a-z0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const nodes = Array.from(document.querySelectorAll('shreddit-comment')) as HTMLElement[];
        const mine = author
          ? nodes.filter((n) => (n.getAttribute('author') || '').toLowerCase() === author.toLowerCase())
          : nodes;
        const pool = mine.length ? mine : nodes;
        const hit = pool.find((n) => needle && normalise(n.innerText).includes(needle));
        if (!hit) return null;
        return {
          permalink: hit.getAttribute('permalink'),
          id: hit.getAttribute('thingid') ?? hit.getAttribute('thing-id') ?? hit.getAttribute('id')
        };
      },
      { needle, author: author ?? null }
    ).catch(() => null);

    if (!ours) {
      return { ok: false, error: 'submitted but our comment could not be located on the page afterwards' };
    }

    const abs = ours?.permalink
      ? (ours.permalink.startsWith('http') ? ours.permalink : config.redditBase + ours.permalink)
      : undefined;

    return {
      ok: true,
      url: page.url(),
      ...(abs ? { commentPermalink: abs } : {}),
      ...(ours?.id ? { commentId: ours.id } : {})
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const redditBase = config.redditBase;
