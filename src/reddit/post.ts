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

export async function publishComment(page: Page, permalink: string, body: string): Promise<PublishResult> {
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

    // Confirm by looking for our own text back on the page.
    const probe = body.slice(0, 60);
    const landed = await page
      .locator(`text=${JSON.stringify(probe)}`)
      .first()
      .isVisible({ timeout: 8000 })
      .catch(() => false);

    if (!landed) {
      return { ok: false, error: 'submitted but the comment was not found on the page afterwards' };
    }

    // Identify our own node so later checkpoints can look at this comment specifically.
    // Absent attributes are reported as absent — never guessed from the thread URL.
    const ours = await page.evaluate((needle: string) => {
      const nodes = Array.from(document.querySelectorAll('shreddit-comment'));
      const hit = nodes.find((n) => (n as HTMLElement).innerText.includes(needle));
      if (!hit) return null;
      return {
        permalink: hit.getAttribute('permalink'),
        id: hit.getAttribute('thingid') ?? hit.getAttribute('thing-id') ?? hit.getAttribute('id')
      };
    }, probe).catch(() => null);

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
