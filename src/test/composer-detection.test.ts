/**
 * The composer is detected the same way it is typed into.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS PINS, and it survived being "fixed" because two functions shared a name.
 *
 * TIER0-BLOCKER-2026-07-27 records the first-ever publish attempt dying at `[no-composer]` on a
 * page whose composer was fine: Reddit's editor has no layout box until it is interacted with,
 * and Playwright's `isVisible()` is false for an element with no layout box. Its fix — a
 * `firstUsable` that separates "no layout box" from "hidden" — was verified live the same day,
 * on `tier0/composer-firstusable`. That branch was never merged.
 *
 * What reached the release line, as 79be049, was a DIFFERENT function with the same name: it
 * required `isVisible()` first and added editable/enabled checks, making it a strict subset of
 * `firstVisible`. So the document said RESOLVED, `grep firstUsable` answered yes, and the half
 * that actually closes the blocker was absent for a week.
 *
 * Worse, only `post.ts` was moved onto it. `thread-state.ts` — which is what `evaluateGates`
 * READS — kept `firstVisible`. The two halves of the publish path therefore disagreed about
 * whether a composer existed, and the gate always resolved that against publishing.
 *
 * These tests are about the RELATIONSHIP between the two finders, which is the thing that broke.
 * They use a real page through Playwright because "no layout box" is a browser fact and cannot be
 * faked in a unit test without assuming the answer.
 * ---------------------------------------------------------------------------
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { firstVisible, firstUsable } from '../reddit/scrape.js';

let browser: Browser;
let page: Page;

/** Every shape the composer detection has to tell apart, on one page. */
const FIXTURE = `
<!doctype html><html><body>
  <div id="normal" contenteditable="true">typed into normally</div>

  <!-- The Tier-0 case: in the DOM, styled, but with no layout box. isVisible() says false. -->
  <div id="zerobox" contenteditable="true" style="width:0;height:0;overflow:hidden"></div>

  <!-- Genuinely hidden, four ways. None of these may be treated as present. -->
  <div id="display-none"   contenteditable="true" style="display:none"></div>
  <div id="visibility-hidden" contenteditable="true" style="visibility:hidden"></div>
  <div id="hidden-attr"    contenteditable="true" hidden></div>
  <div id="aria-disabled"  contenteditable="true" aria-disabled="true"></div>

  <!-- Present and laid out, but the browser reports it unusable. -->
  <textarea id="readonly" readonly>cannot type here</textarea>
</body></html>`;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setContent(FIXTURE);
});
after(async () => { await browser?.close(); });

describe('a composer with no layout box', () => {
  test('is invisible to firstVisible — the measurement the blocker rests on', async () => {
    /* If this ever goes green, Playwright changed and the rest of this file needs rereading. */
    assert.equal(await firstVisible(page, ['#zerobox']), null,
      'isVisible() now sees a zero-box element — the premise of the Tier-0 fix has changed');
  });

  test('is FOUND by firstUsable — a composer that is there is not missing', async () => {
    assert.notEqual(await firstUsable(page, ['#zerobox']), null,
      'the zero-box composer reads as absent — this is the Tier-0 blocker, unfixed');
  });
});

describe('firstUsable is a superset of firstVisible, never a subset', () => {
  /**
   * The regression that produced the outage: `firstUsable` was rewritten as a NARROWER check
   * while its name and its callers implied a wider one. Anything the old finder could see, the
   * new one must still see — otherwise moving a call site from one to the other silently loses
   * detections, which is exactly how `thread-state.ts` and `post.ts` came to disagree.
   */
  for (const id of ['normal', 'zerobox']) {
    test(`#${id}: anything firstVisible finds, firstUsable finds`, async () => {
      const visible = await firstVisible(page, [`#${id}`]);
      if (visible === null) return;                       // nothing to be a superset of
      assert.notEqual(await firstUsable(page, [`#${id}`]), null,
        `firstVisible found #${id} and firstUsable did not — firstUsable has narrowed`);
    });
  }
});

describe('what must still be refused', () => {
  /* The fallback must not turn "hidden" into "present". Each of these is a page saying no. */
  for (const id of ['display-none', 'visibility-hidden', 'hidden-attr']) {
    test(`#${id} is not a usable composer`, async () => {
      assert.equal(await firstUsable(page, [`#${id}`]), null,
        `#${id} was accepted — the zero-box fallback is treating hidden as present`);
    });
  }

  test('aria-disabled is consulted only when the element has no layout box — a known asymmetry', async () => {
    /**
     * MEASURED, not assumed: `#aria-disabled` reports isVisible=true, isEditable=true,
     * isEnabled=true (54ms, Chromium via Playwright). So it takes the VISIBLE path, where
     * `aria-disabled` is not consulted at all — that is 79be049's behaviour and predates the
     * zero-box fallback added here.
     *
     * The asymmetry is real: the same attribute disqualifies an unrendered element and not a
     * rendered one. It is recorded rather than removed because closing it means teaching the
     * visible path a new refusal, and that path is what `post.ts` types into. A gate that starts
     * rejecting composers which currently work would trade a false "missing" for a false
     * "unusable" — the same outage in the other direction, on the one code path with no
     * production exposure to catch it (post.ts is Experimental, "Never executed").
     *
     * This test states what IS true so the day someone changes it, it is a decision.
     */
    assert.notEqual(await firstUsable(page, ['#aria-disabled']), null,
      'the visible path now honours aria-disabled — deliberate? then this test is the record');
  });

  test('a readonly control is refused — visible is not the same as typeable', async () => {
    assert.equal(await firstUsable(page, ['#readonly']), null);
  });
});

test('the first usable candidate wins, and an unusable one does not shadow it', async () => {
  /* Selector lists are ordered fallbacks. A hidden element earlier in the list must not stop the
     real composer later in it from being found. */
  const found = await firstUsable(page, ['#display-none', '#hidden-attr', '#normal']);
  assert.notEqual(found, null, 'a hidden earlier candidate swallowed the real one');
  assert.equal(await found!.getAttribute('id'), 'normal');
});
