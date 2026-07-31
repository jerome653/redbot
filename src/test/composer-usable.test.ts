/**
 * `firstUsable` against a REAL browser, and the headless refusal.
 *
 * A real Chromium rather than fakes, because the whole point of this helper is what the BROWSER
 * reports about an element — and the decisive fact was only learnable by asking it: `isEditable()`
 * THROWS on anything that is not a form control, including the submit button. A mock would have
 * been written to whatever I assumed, and the assumption was wrong.
 *
 * The elements below are the shapes a composer actually takes: a contenteditable div (Reddit's),
 * a textarea (the fallback), and the inert states each can be caught in.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { firstUsable, firstVisible } from '../reddit/scrape.js';
import { isHeadlessUA, HeadlessBrowserError } from '../browser.js';

const PAGE = `<!doctype html><body>
  <div id="ce" contenteditable="true">a real composer</div>
  <textarea id="ta"></textarea>
  <textarea id="ro" readonly></textarea>
  <input id="dis" disabled>
  <button id="btn">submit</button>
  <button id="btndis" disabled>submit</button>
  <div id="plain">not a control</div>
  <div id="hidden" contenteditable="true" style="display:none">hidden composer</div>
</body>`;

let browser: Browser;
let page: Page;

before(async () => {
  const f = join(tmpdir(), 'redbot-composer-usable.html');
  writeFileSync(f, PAGE);
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(pathToFileURL(f).href);
});

after(async () => { await browser?.close(); });

/* ---------------------------------------------------------------- the composer */

test('a contenteditable composer is usable', async () => {
  const el = await firstUsable(page, ['#ce']);
  assert.ok(el, 'Reddit\'s composer is a contenteditable div — it must be accepted');
  assert.equal(await el!.textContent(), 'a real composer');
});

test('a textarea composer is usable', async () => {
  assert.ok(await firstUsable(page, ['#ta']));
});

/**
 * THE CASE THIS HELPER EXISTS FOR.
 *
 * `firstVisible` returns a readonly editor — it is visible, after all — and the failure then
 * happens at the typing step, reported as a composer problem when the composer was found.
 */
test('a readonly editor is visible but NOT usable', async () => {
  assert.ok(await firstVisible(page, ['#ro']), 'precondition: it is visible');
  assert.equal(await firstUsable(page, ['#ro']), null, 'and must be rejected as an editor');
});

test('a disabled input is rejected', async () => {
  assert.ok(await firstVisible(page, ['#dis']), 'precondition: it is visible');
  assert.equal(await firstUsable(page, ['#dis']), null);
});

/* ---------------------------------------------------------------- the submit button */

/**
 * The regression a naive version would have introduced.
 *
 * `isEditable()` throws on a <button>. Requiring `isEditable() === true` would reject every
 * submit button — turning a robustness fix into a total publish outage.
 */
test('an enabled button is usable, even though isEditable throws on it', async () => {
  assert.ok(await firstUsable(page, ['#btn']),
    'a button must survive: isEditable throws here, which is not evidence against it');
});

test('a disabled submit button is rejected', async () => {
  assert.ok(await firstVisible(page, ['#btndis']), 'precondition: it is visible');
  assert.equal(await firstUsable(page, ['#btndis']), null,
    'Reddit disables submit until the body is non-empty — clicking it does nothing');
});

test('a plain element is kept, because nothing disproves it', async () => {
  assert.ok(await firstUsable(page, ['#plain']));
});

/* ---------------------------------------------------------------- ordering and visibility */

test('a hidden editor is skipped even though it reports editable', async () => {
  /* isEditable() is true for a display:none contenteditable — visibility still has to gate. */
  assert.equal(await firstUsable(page, ['#hidden']), null);
});

test('candidates are tried in order, and the first usable one wins', async () => {
  const el = await firstUsable(page, ['#missing', '#ro', '#ce']);
  assert.ok(el, 'it should fall past the absent and the readonly to the real composer');
  assert.equal(await el!.textContent(), 'a real composer');
});

test('no usable candidate returns null rather than throwing', async () => {
  assert.equal(await firstUsable(page, ['#missing', '#ro', '#btndis']), null);
});

/**
 * firstUsable must never return something firstVisible would not have.
 *
 * The safety property that makes this swap-in safe: it can only ever narrow.
 */
test('firstUsable is a strict subset of firstVisible', async () => {
  for (const id of ['#ce', '#ta', '#ro', '#dis', '#btn', '#btndis', '#plain', '#hidden']) {
    const usable = await firstUsable(page, [id]);
    if (usable) {
      assert.ok(await firstVisible(page, [id]), `${id} was usable but not visible — impossible`);
    }
  }
});

/* ---------------------------------------------------------------- the headless refusal */

test('isHeadlessUA recognises the user-agent Chrome actually reports', async () => {
  /* Measured: a headless Chrome 150 reports HeadlessChrome/150.0.0.0 through /json/version. */
  assert.equal(isHeadlessUA(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
    + 'HeadlessChrome/150.0.0.0 Safari/537.36'), true);
  assert.equal(isHeadlessUA(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
    + 'Chrome/150.0.7871.187 Safari/537.36'), false, 'a headed Chrome must not be refused');
  /* Unreadable is NOT headless: refusing on that would block a working browser. */
  assert.equal(isHeadlessUA(null), false);
  assert.equal(isHeadlessUA(undefined), false);
  assert.equal(isHeadlessUA(''), false);
});

test('HeadlessBrowserError says what is wrong and what to do', async () => {
  const e = new HeadlessBrowserError('http://127.0.0.1:9222', 'HeadlessChrome/150.0.0.0');
  assert.equal(e.name, 'HeadlessBrowserError');
  assert.match(e.message, /HEADLESS/);
  assert.match(e.message, /block page/, 'the reason it fails silently must be stated');
  assert.match(e.message, /headed Chrome/, 'and the fix');
  assert.equal(e.endpoint, 'http://127.0.0.1:9222');
});
