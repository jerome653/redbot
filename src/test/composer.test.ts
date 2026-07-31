import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { firstUsable } from '../reddit/scrape.js';

/**
 * The composer defect, frozen as a regression.
 *
 * MEASURED 2026-07-27, r/Wordpress `1v7uai9`, signed in, thread open: `shreddit-composer` was
 * present, `aria-disabled="false"` and holding its own `contenteditable`, with a bounding box of
 * **0 × 0** — its `faceplate-form` and `comment-composer-host` ancestors are laid out
 * `display: inline`. Playwright's `isVisible()` is box-based, so the publish gate reported
 * `[no-composer]` on a thread anyone could comment on, and `publishComment` would have stopped at
 * "comment editor did not open".
 *
 * These tests hold the two halves of the fix together: a zero-box element is usable, and a
 * genuinely hidden or disabled one is still refused. If the second half ever regresses, the gates
 * stop failing closed and that is worse than the bug being fixed here.
 */

interface FakeEl {
  visible?: boolean;
  count?: number;
  display?: string;
  visibility?: string;
  attrs?: Record<string, string>;
  hidden?: boolean;
}

/** A Page stub that answers only what firstUsable asks, with the real predicate executed. */
function fakePage(elements: Record<string, FakeEl>): Page {
  return {
    locator(selector: string) {
      const e: FakeEl = elements[selector] ?? { count: 0 };
      const el = {
        isVisible: async () => e.visible === true,
        count: async () => e.count ?? (e.visible ? 1 : 0),
        async evaluate(fn: (node: Element) => boolean): Promise<boolean> {
          const node = {
            hasAttribute: (a: string) => (a === 'hidden' ? e.hidden === true : a in (e.attrs ?? {})),
            getAttribute: (a: string) => e.attrs?.[a] ?? null
          } as unknown as Element;
          const g = globalThis as unknown as { getComputedStyle?: unknown };
          const saved = g.getComputedStyle;
          g.getComputedStyle = () => ({ display: e.display ?? 'block', visibility: e.visibility ?? 'visible' });
          try {
            return fn(node);
          } finally {
            g.getComputedStyle = saved;
          }
        },
        first() {
          return this;
        }
      };
      return el;
    }
  } as unknown as Page;
}

test('a present, enabled, zero-box composer is usable — the case that blocked the first publish', async () => {
  const page = fakePage({
    'shreddit-composer div[contenteditable="true"]': { count: 1, attrs: { 'aria-disabled': 'false' } }
  });
  const found = await firstUsable(page, ['shreddit-composer div[contenteditable="true"]']);
  assert.ok(found, 'a live composer with no layout box must be found');
  assert.equal(found.via, 'zero-box', 'and must report HOW it was found, not pretend it was visible');
});

test('a visible element is still reported as visible — the normal path is unchanged', async () => {
  const page = fakePage({ 'div[contenteditable="true"]': { visible: true } });
  const found = await firstUsable(page, ['div[contenteditable="true"]']);
  assert.equal(found?.via, 'visible');
});

test('display:none is refused — zero-size is not the same fact as hidden', async () => {
  const page = fakePage({ 'shreddit-composer': { count: 1, display: 'none' } });
  assert.equal(await firstUsable(page, ['shreddit-composer']), null);
});

test('visibility:hidden is refused', async () => {
  const page = fakePage({ 'shreddit-composer': { count: 1, visibility: 'hidden' } });
  assert.equal(await firstUsable(page, ['shreddit-composer']), null);
});

test('the hidden attribute is refused', async () => {
  const page = fakePage({ 'shreddit-composer': { count: 1, hidden: true } });
  assert.equal(await firstUsable(page, ['shreddit-composer']), null);
});

test('aria-disabled="true" is refused — a disabled composer is a refusal, not a fallback', async () => {
  const page = fakePage({ 'shreddit-composer': { count: 1, attrs: { 'aria-disabled': 'true' } } });
  assert.equal(await firstUsable(page, ['shreddit-composer']), null);
});

test('nothing on the page resolves to null, so the gate still fails closed', async () => {
  const page = fakePage({});
  assert.equal(await firstUsable(page, ['shreddit-composer', 'textarea[name="comment"]']), null);
});

test('candidate order beats visibility — the precise zero-box submit wins over a visible stray', async () => {
  /**
   * `sel.commentSubmit` lists `button[slot="submit-button"]` first because it is the composer's
   * own submit; `button:has-text("Comment")` is last because it also matches buttons elsewhere on
   * the page. On the measured page the precise one is zero-box and two of the loose ones are
   * visible. A visible-first sweep would click the wrong button on the only write path.
   */
  const page = fakePage({
    'button[slot="submit-button"]': { count: 1, attrs: { 'aria-disabled': 'false' } },
    'button:has-text("Comment")': { visible: true, count: 3 }
  });
  const found = await firstUsable(page, ['button[slot="submit-button"]', 'button:has-text("Comment")']);
  assert.equal(found?.via, 'zero-box', 'the first candidate must win even though a later one is visible');
});

test('a later candidate is used when the earlier one is absent', async () => {
  const page = fakePage({ 'button:has-text("Comment")': { visible: true } });
  const found = await firstUsable(page, ['button[slot="submit-button"]', 'button:has-text("Comment")']);
  assert.equal(found?.via, 'visible');
});
