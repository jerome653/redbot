/**
 * The product console's UI contract — what must still work after a redesign.
 *
 * WHY THIS EXISTS. `server.test.mjs` covers the HTTP surface and asserts nothing about the
 * page. Every screen, every button and every polling loop in `index.html` had no regression
 * net at all, so a restyle could silently delete the send flow, the ignored-filter or the
 * live log and the suite would stay green.
 *
 * WHAT IT ASSERTS ON, DELIBERATELY: user-visible text, and the network calls a click makes.
 * NOT class names or DOM shape — those are exactly what a redesign is allowed to change. A
 * test pinned to `.card-q` would have to be rewritten alongside the thing it is meant to
 * police, which makes it worthless as a net.
 *
 * State comes from `ui-fixture.mjs` through Playwright route interception, not from Postgres:
 * live data has 0 drafts and 0 certifications, so Review — the screen with the most to lose —
 * cannot be exercised against it at all.
 *
 *   node --test tools/product/ui.test.mjs
 *   REDBOT_UI_SHOTS=<dir> node --test tools/product/ui.test.mjs      (where to write captures)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { makeState, makePulse, OPERATORS, RUN_LOG_IDLE, RUN_HISTORY, SETUP, DEPENDENCIES, CHROME_PROFILES, PORTS } from './ui-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SHOTS = process.env.REDBOT_UI_SHOTS || join(HERE, '.ui-shots');

/** Frozen so `ago()` and the fixture timestamps render identically on every run. */
const NOW = Date.parse('2026-07-28T12:00:00.000Z');

let child = null, browser = null, PORT = 0, DATA = '';

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  PORT = await freePort();
  DATA = mkdtempSync(join(tmpdir(), 'redbot-ui-'));
  child = spawn(process.execPath, [join(HERE, 'server.mjs'), '--port', String(PORT)],
                // REDBOT_DATA is a throwaway directory (a fresh install); REDBOT_DB is inherited
                // from --env-file and takes precedence, so the child still uses the test DATABASE
                // rather than creating an empty unmigrated one inside the temp directory.
                { cwd: ROOT,
                  // The update check is pointed at a repository that cannot exist so this suite
                  // never asks GitHub anything: a render test must not depend on what was
                  // published this morning, and 75 screens must not spend a rate limit.
                  env: { ...process.env, REDBOT_DATA: DATA,
                         REDBOT_UPDATE_REPO: 'redbot-tests/does-not-exist-9f3a' },
                  stdio: ['ignore', 'pipe', 'pipe'] });
  let banner = '';
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`console did not start in 20s. stdout: ${banner}`)), 20_000);
    child.stdout.on('data', (d) => {
      banner += String(d);
      if (banner.includes(`${PORT}`)) { clearTimeout(timer); res(); }
    });
    child.on('error', (e) => { clearTimeout(timer); rej(e); });
    child.on('exit', (c) => { clearTimeout(timer); rej(new Error(`console exited ${c}`)); });
  });
  browser = await chromium.launch();
});

after(async () => {
  try { await browser?.close(); } catch { /* already gone */ }
  try { child?.kill(); } catch { /* already gone */ }
  try { rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ }
});

/**
 * A page with every backend call answered from the fixture.
 *
 * `calls` records each POST so a test can assert what a click actually asked the server to do
 * — the only honest way to check that a redesigned button is still wired to the same endpoint.
 * `errors` collects console output, because a screen that renders and throws is not working.
 */
async function open(opts = {}) {
  const {
    state = makeState(NOW), pulse = makePulse(NOW), runLog = RUN_LOG_IDLE,
    seenGuide = true, viewport = { width: 1600, height: 1000 }, theme = 'dark'
  } = opts;

  const context = await browser.newContext({
    viewport,
    colorScheme: theme === 'light' ? 'light' : 'dark',
    permissions: ['clipboard-write']
  });
  const calls = [];
  const errors = [];

  if (seenGuide) {
    await context.addInitScript(() => {
      try { localStorage.setItem('redbot.seenGuide', '1'); } catch { /* private mode */ }
    });
  }

  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  const json = (route, body) => route.fulfill({
    status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body)
  });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'POST') {
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch { /* not json */ }
      calls.push({ path, body });
      /* Every mutating endpoint answers the way the client's happy path expects. A test that
         needs a refusal overrides this by adding its own route first. */
      if (path === '/api/run') return json(route, { ok: true, code: 0, ms: 10, output: 'done', command: 'redbot x' });
      if (path === '/api/publish') return json(route, { ok: true, code: 0, recorded: true, output: 'published' });
      if (path === '/api/status') return json(route, { ok: true, statuses: {} });
      if (path === '/api/sources/add') return json(route, { ok: true, value: 'Added', storedIn: 'database' });
      if (path === '/api/sources/remove') return json(route, { ok: true });
      if (path === '/api/account/create') return json(route, { ok: true, account: { handle: 'New_Acct', profileDir: 'chrome-profile-c', debugPort: 9224 }, storedIn: 'database' });
      if (path === '/api/account/open') return json(route, { ok: true, handle: 'New_Acct', port: 9224 });
      if (path === '/api/auto/start') return json(route, { ok: true, running: true, account: 'docs-architect', everyMinutes: 60, startedAt: new Date(NOW).toISOString(), log: [] });
      if (path === '/api/auto/stop') return json(route, { ok: true, running: false, account: null, everyMinutes: null, startedAt: null, log: [] });
      if (path === '/api/operator/select') return json(route, { ok: true, selected: body.name || null });
      return json(route, { ok: true });
    }
    /**
     * Paging is a GET, so it has to be recorded here rather than in the POST branch above —
     * and what a Next click ASKS FOR (which list, which offset) is the only way to tell real
     * server-side paging from a browser slicing an array it already had.
     */
    if (path === '/api/page') {
      const q = Object.fromEntries(new URL(req.url()).searchParams);
      calls.push({ path, query: q, body: {} });
      const offset = Number(q.offset) || 0, limit = Number(q.limit) || 25;
      const total = opts.pageTotal ?? 4812;
      const count = Math.max(0, Math.min(limit, total - offset));
      return json(route, {
        list: q.list, total, offset, limit,
        rows: Array.from({ length: count }, (_, i) => ({
          threadId: `t${offset + i}`, title: `thread number ${offset + i}`,
          permalink: `/r/WordPress/comments/${offset + i}`,
          verdict: 'contribute', score: 90 - i,
          thesis: { whyThread: null, whatNew: `what row ${offset + i} would add`, whyNotSilent: null },
          reasons: ['seeded'], subreddit: 'WordPress', comments: 7, ageText: '2 h ago',
          draftId: null, draftStatus: null
        }))
      });
    }
    /* Recorded with its query: Review's page is a parameter of THIS request, because a review
       card is assembled here and there is no lighter thing to ask for. */
    if (path === '/api/state') {
      calls.push({ path, query: Object.fromEntries(new URL(req.url()).searchParams), body: {} });
      return json(route, state);
    }
    if (path === '/api/operators') return json(route, OPERATORS);
    if (path === '/api/pulse') return json(route, pulse);
    if (path === '/api/run/log') return json(route, runLog);
    if (path === '/api/run/history') return json(route, RUN_HISTORY);
    if (path === '/api/actions') return json(route, { running: null, actions: [] });
    if (path === '/api/setup') return json(route, SETUP);
    if (path === '/api/dependencies') return json(route, DEPENDENCIES);
    if (path === '/api/chrome/profiles') return json(route, CHROME_PROFILES);
    if (path === '/api/ports') return json(route, opts.ports || PORTS);
    return json(route, {});
  });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  /* The first paint is driven by load(); wait for a number the fixture guarantees. */
  await page.waitForFunction(() => document.querySelector('#nRev')?.textContent === '3', null, { timeout: 15_000 });
  return { context, page, calls, errors };
}

/** Switch screen through the real tab button, the way a person does. */
async function tab(page, v) {
  /**
   * Setup is no longer a tab. It is the Settings panel behind the gear, so "go to setup" is now a
   * different gesture — and it is routed here rather than fixed at each call site, because every
   * caller means the same thing by it: put that screen in front of me.
   *
   * The wait is on the PANEL, not on `#v-setup`: the section lives inside the panel and is no
   * longer `hidden` itself, so waiting on it would pass before the panel had opened.
   */
  if (v === 'setup') {
    await page.click('#settingsBtn');
    await page.waitForSelector('#settings:not([hidden])', { timeout: 5000 });
    return;
  }
  /**
   * Log is not a tab either. It is a button inside Settings — it is where you go when something
   * has gone wrong, not five times a day, and a permanent tab cost every other tab a share of a
   * row that is now divided equally.
   *
   * Routed here rather than at nine call sites, because every one of them means the same thing:
   * put that screen in front of me. The button closes the panel itself, so the wait is on the
   * screen, exactly as it is for a real tab.
   */
  if (v === 'logs') {
    await page.click('#settingsBtn');
    await page.waitForSelector('#settings:not([hidden])', { timeout: 5000 });
    await page.locator('#v-setup button', { hasText: 'Open the run log' }).first().click();
    await page.waitForFunction(() => !document.querySelector('#v-logs')?.hidden,
                               null, { timeout: 5000 });
    return;
  }
  await page.click(`.step[data-v="${v}"]`);
  await page.waitForFunction((k) => !document.querySelector('#v-' + k)?.hidden, v, { timeout: 5000 });
}

/**
 * Open a Setup wizard step by its title, the way a person does.
 *
 * The wizard collapses finished steps and opens only the current one, so a control can be present
 * and correct while being hidden — which is exactly how it should behave, and exactly what makes a
 * test that assumes a step is open fragile. Two tests below drive controls inside "Sign in to the
 * model"; without this they passed only because that step happened to be the first unfinished one,
 * and inserting any step before it would have broken them for no real reason.
 *
 * Idempotent: a step that is already open is left alone.
 */
async function openStep(page, title) {
  const head = page.locator('#v-setup .wiz-h').filter({ hasText: title }).first();
  await head.waitFor({ state: 'visible', timeout: 5000 });
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await page.waitForFunction(
    (t) => {
      const h = [...document.querySelectorAll('#v-setup .wiz-h')]
        .find((x) => x.textContent.includes(t));
      return !!h && h.getAttribute('aria-expanded') === 'true';
    }, title, { timeout: 5000 });
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, name + '.png') });

/** Did a click reach this endpoint at all? */
const hit = (calls, path) => calls.filter((c) => c.path === path);

/**
 * Poll a condition evaluated in NODE, not in the page.
 *
 * `calls` lives in this process, so `page.waitForFunction` cannot see it — and
 * `waitForFunction(() => true)` resolves on the first tick, which is no wait at all. Several
 * assertions below check what a click ASKED THE SERVER TO DO, and those requests land over
 * the following few hundred milliseconds.
 */
async function until(fn, label, ms = 10_000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms}ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 40));
  }
}

/** Wait until at least `n` requests have reached `path`. */
const untilHit = (calls, path, n = 1, ms) =>
  until(() => hit(calls, path).length >= n, `${n} request(s) to ${path}`, ms);

/* ================================================================== *
 * The shell: badges, banner, health, theme, guide, routing
 * ================================================================== */

test('the bar reports every screen\'s count, and the banner says nothing has been sent', async () => {
  const { context, page, errors } = await open();
  try {
    /* Today's badge counts outstanding ACTIONS, not accounts: 2 accounts, one karma-checked
       2 days ago (>= 7d not due) — the arithmetic lives in load(). Asserted as "a number",
       because pinning the formula here would make this test a copy of the implementation. */
    assert.match(await page.textContent('#nTod'), /^\d+$/);
    assert.equal(await page.textContent('#nRev'), '3', 'three pending, the ignored one excluded');
    assert.equal(await page.textContent('#nDisc'), '16');
    assert.equal(await page.textContent('#nAcc'), '2');
    assert.equal(await page.textContent('#nOut'), '0');

    const banner = await page.textContent('#banner');
    assert.match(banner, /Nothing has been sent yet/i,
      'published === 0 must read as "nothing sent", never as a zero that looks measured');

    await shot(page, '00-shell-dark');
    assert.deepEqual(errors, [], 'the shell must render with a clean console');
  } finally { await context.close(); }
});

/**
 * Everything above the active screen — the bar, and whatever strip carries the headline
 * figures. Walks the live children rather than cloning, because innerText on a DETACHED node
 * falls back to textContent and drags in the whole <script> body.
 */
const chromeText = (page) => page.evaluate(() =>
  [...document.body.children]
    .filter((n) => n.tagName !== 'SECTION' && n.tagName !== 'SCRIPT'
                   && !['guide', 'settings', 'scrim', 'toast'].includes(n.id))
    .map((n) => n.innerText || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase());

test('the headline figures live on the tabs, and the waiting count clicks through', async () => {
  /**
   * THE TICKER IS GONE, AND THIS TEST NOW PINS WHAT REPLACED IT.
   *
   * Five figures used to sit in the ledge between the logo and the controls. Every one that
   * mattered daily is also a badge on the tab that owns it, so the strip was a second reading of
   * the same numbers — and being flexible-width it decided where the navigation wrapped, so the
   * tabs moved depending on how many figures rendered.
   *
   * What survives is the contract underneath it: the state of the work must be readable WITHOUT
   * choosing a screen, and the figure that means WORK must still take you to that work. The tabs
   * carry both. `decided` and `removals` are no longer in the chrome — they were never daily, and
   * they live on Results beside the record they describe.
   */
  const { context, page } = await open();
  try {
    const txt = await chromeText(page);
    /* Lower case: `chromeText` lowercases what it collects, so these are the tab labels as that
       helper sees them, not as they are written in the markup. */
    for (const [what, label, n] of [
      ['pending replies', 'review', '3'],
      ['accounts', 'accounts', '2'],
      ['published', 'results', '0']
    ]) {
      assert.match(txt, new RegExp(`${label}[^0-9]{0,4}${n}`),
        `the chrome must report ${what} = ${n} on its tab; got: ${txt}`);
    }

    /* The version sits beside the name, and it comes from the SERVER (APP_VERSION in server.mjs)
       rather than from a constant in the page — a hand-maintained version string is one that lies
       after the first release nobody edited it for. */
    assert.match(txt, /v9\.9\.9/, `the running version must be shown in the chrome; got: ${txt}`);

    /* The tab badge is the click now — and it was always the more obvious target than a figure
       in a strip. */
    await tab(page, 'today');
    await page.locator('.step[data-v="review"]').click();
    await page.waitForFunction(() => !document.querySelector('#v-review')?.hidden,
                               null, { timeout: 5000 });
    assert.ok(await page.isHidden('#v-today'), 'the waiting figure must lead to Review');
  } finally { await context.close(); }
});

test('the health chip shows the problem the pulse reports, and names it on click', async () => {
  const { context, page } = await open();
  try {
    await page.waitForFunction(() => /problem/.test(document.querySelector('#pulseChip')?.textContent || ''),
                               null, { timeout: 8000 });
    const chip = await page.textContent('#pulseChip');
    assert.match(chip, /1 problem/, 'one problem in the fixture must surface in the bar');
    const title = await page.getAttribute('#pulseChip', 'title');
    assert.match(title, /browser folder is missing/, 'the chip must carry the reason, not just a count');
  } finally { await context.close(); }
});

test('the theme toggle flips the document theme both ways', async () => {
  const { context, page } = await open();
  try {
    await page.click('#theme');
    const a = await page.getAttribute('html', 'data-theme');
    assert.ok(a === 'light' || a === 'dark', `expected a theme, got ${a}`);
    await page.click('#theme');
    const b = await page.getAttribute('html', 'data-theme');
    assert.notEqual(b, a, 'a second press must flip it back');
  } finally { await context.close(); }
});

/**
 * The guide never opens itself — not even on a first visit.
 *
 * This assertion is the REVERSE of the one it replaces, and the reversal is the point. The
 * walkthrough used to open on a first visit, which in a desktop app means every reinstall and
 * every freshly handed-over machine begins with a full-screen overlay in front of the screen the
 * person opened the app to look at. `seenGuide: false` is left in deliberately: it is the exact
 * condition that used to trigger it, so this test fails the moment the behaviour comes back.
 */
test('the guide never opens unasked, not even on a first visit', async () => {
  const first = await open({ seenGuide: false });
  try {
    /* Given time to do the wrong thing rather than checked instantly — an overlay that appears
       after the first render would otherwise pass. */
    await first.page.waitForTimeout(2500);
    assert.ok(await first.page.isHidden('#guide'), 'the walkthrough opened by itself');
    await shot(first.page, '01-no-guide-on-first-visit');
  } finally { await first.context.close(); }

  const again = await open({ seenGuide: true });
  try {
    assert.ok(await again.page.isHidden('#guide'), 'it must not reopen unasked');
  } finally { await again.context.close(); }
});

test('the guide answers ? and Escape, and reports the fact-checker\'s real record', async () => {
  const { context, page } = await open();
  try {
    await page.keyboard.press('?');
    await page.waitForSelector('#guide:not([hidden])', { timeout: 5000 });

    /* The figures in the guide are read from state, so the explanation cannot drift from
       the evidence. Fixture: 4 runs over 3 drafts, 1 certified. */
    const stat = await page.textContent('#g-argus');
    assert.match(stat, /4/, 'the guide must report the real run count');
    assert.match(stat, /3 different replies/, 'and how many drafts those runs covered');

    /* state:'hidden' is load-bearing — waitForSelector defaults to waiting for VISIBLE, so
       '#guide[hidden]' would wait for a hidden element to become visible and always time out. */
    await page.keyboard.press('Escape');
    await page.waitForSelector('#guide', { state: 'hidden', timeout: 5000 });
  } finally { await context.close(); }
});

test('every screen is reachable from the bar and renders its own heading', async () => {
  const { context, page, errors } = await open();
  try {
    for (const [v, expect] of [
      ['today', /Growing the accounts/i],
      ['accounts', /Accounts/i],
      ['discovery', /Threads redbot found/i],
      ['outcomes', /What happened after sending/i],
      ['logs', /command has run|probe-karma/i],
      ['review', /what they asked/i]
    ]) {
      await tab(page, v);
      const txt = await page.textContent(`#v-${v}`);
      assert.match(txt, expect, `screen "${v}" did not render its own content`);
    }
    assert.deepEqual(errors, [], 'navigating every screen must not throw');
  } finally { await context.close(); }
});

/* ================================================================== *
 * Review — the screen with the most to lose
 * ================================================================== */

test('the queue hides ignored replies behind a toggle that says how many', async () => {
  const { context, page } = await open();
  try {
    await tab(page, 'review');
    const list = await page.textContent('#stackList');
    assert.ok(!list.includes('Which page builder'), 'an ignored reply must leave the queue');
    assert.match(list, /show 1 ignored/i, 'and the toggle must say how many are hidden');

    await page.click('text=show 1 ignored');
    await page.waitForFunction(
      () => document.querySelector('#stackList')?.textContent.includes('Which page builder'),
      null, { timeout: 5000 });
    assert.match(await page.textContent('#stackList'), /hide 1 ignored/i,
      'the toggle must offer the way back');
  } finally { await context.close(); }
});

test('Review puts the verdict before the reply, and shows the asker\'s own words', async () => {
  const { context, page, errors } = await open();
  try {
    await tab(page, 'review');
    const body = await page.textContent('#split');

    /* Their side: the question, its metadata, and the comments already on the thread. */
    assert.match(body, /Every time I import our staging database/, 'the thread body must be shown');
    assert.match(body, /r\/Wordpress/, 'with where it came from');
    assert.match(body, /11 comments/);
    assert.match(body, /Host will not let me touch my\.cnf/, 'and the replies already on it');
    assert.match(body, /the asker/, 'a comment by the original poster must be marked as theirs');

    /* Our side: plain English, not the engine's vocabulary. */
    assert.match(body, /Do not send/, 'REJECT must render as plain English');
    assert.ok(!/REJECT/.test(body), 'the engine\'s own word must not reach the screen');
    assert.match(body, /6 separate statements/);
    assert.match(body, /1 shown to be wrong/);

    /* The findings, grouped and truncated to the first whole sentence. */
    assert.match(body, /Proven wrong/, 'the rule must be named in words');
    assert.match(body, /The default is 16M on the 5\.7 line/, 'lead with the first whole sentence');
    assert.match(body, /the technical detail/, 'the rest stays one click away');

    /* Verdict must precede the reply in document order — the whole thesis of this screen.
       Lower-cased first: the section labels are text-transform:uppercase, so innerText
       returns "THE REPLY ITSELF" and an exact match silently finds nothing. */
    const order = await page.evaluate(() => {
      const t = document.querySelector('#split').innerText.toLowerCase();
      return { verdict: t.indexOf('do not send'), reply: t.indexOf('the reply itself') };
    });
    assert.ok(order.verdict > -1 && order.reply > -1, 'both must be present');
    assert.ok(order.verdict < order.reply,
      'the verdict must come BEFORE the reply — reading the reply first makes you judge how it sounds');

    /* The reply itself, and the three gates. */
    assert.match(body, /split the dump so no single statement is oversized/, 'the reply text must be shown');
    assert.match(body, /does not mention our company anywhere/);
    assert.match(body, /fact-check: do not send/);

    await shot(page, '02-review-reject');
    assert.deepEqual(errors, [], 'Review must render with a clean console');
  } finally { await context.close(); }
});

test('a reply checked twice reports the spread instead of one number', async () => {
  const { context, page } = await open();
  try {
    await tab(page, 'review');
    const body = await page.textContent('#split');
    assert.match(body, /checked 2 times/, 'a repeated check must be disclosed');
    assert.match(body, /6, 9/, 'and the differing claim counts named');
  } finally { await context.close(); }
});

test('the other two verdicts render in plain English too', async () => {
  const { context, page } = await open();
  try {
    await tab(page, 'review');

    await page.click('text=Checkout intermittently 502s under load');
    await page.waitForFunction(() => /Needs a look/.test(document.querySelector('#split')?.textContent || ''),
                               null, { timeout: 5000 });
    const esc = await page.textContent('#split');
    assert.match(esc, /Needs a look/, 'ESCALATE');
    assert.match(esc, /1 thing\(s\) flagged by the safety check/, 'a lint issue must be reported honestly');
    await shot(page, '03-review-escalate');

    await page.click('text=Why does wp_options keep growing?');
    await page.waitForFunction(() => /Holds up/.test(document.querySelector('#split')?.textContent || ''),
                               null, { timeout: 5000 });
    const ok = await page.textContent('#split');
    assert.match(ok, /Holds up/, 'CERTIFIED');
    assert.match(ok, /You still decide/, 'and it must not read as permission');
    await shot(page, '04-review-certified');
  } finally { await context.close(); }
});

test('the workflow marks post the draft id and the status they claim', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'review');
    await page.click('text=Mark as read');
    await untilHit(calls, '/api/status');
    const posts = hit(calls, '/api/status');
    assert.ok(posts.length >= 1, 'marking must reach /api/status');
    assert.equal(posts[0].body.draftId, 'draft-reject-1');
    assert.equal(posts[0].body.status, 'read');
  } finally { await context.close(); }
});

test('Fact-check it runs the check for THIS draft, with the override', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'review');
    await page.click('text=Check it again');
    await until(() => hit(calls, '/api/run').some((c) => c.body.key === 'check'), 'the check to run');
    const runs = hit(calls, '/api/run').filter((c) => c.body.key === 'check');
    assert.ok(runs.length >= 1, 'the button must reach /api/run with key=check');
    assert.equal(runs[0].body.draftId, 'draft-reject-1', 'and name the draft on screen');
    assert.equal(runs[0].body.override, true);
  } finally { await context.close(); }
});

test('sending needs the typed word, and refuses without it', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'review');
    await page.click('text=Send it…');
    await page.waitForSelector('input[placeholder="SEND"]', { timeout: 5000 });

    /* The refusal path first: an empty box must not publish. A fixed pause, not a poll —
       the assertion is that nothing happens, so there is no event to wait for. */
    await page.click('text=Confirm and send');
    await page.waitForTimeout(800);
    assert.equal(hit(calls, '/api/publish').length, 0,
      'an unconfirmed send must never reach /api/publish');

    /* A REJECT verdict must warn before it obeys. */
    const panel = await page.textContent('#split');
    assert.match(panel, /The fact-check says do not send this one/i);

    await page.fill('input[placeholder="SEND"]', 'SEND');
    await page.fill('input[placeholder="why you are sending it"]', 'checked by hand');
    await page.click('text=Confirm and send');
    await untilHit(calls, '/api/publish');

    const pub = hit(calls, '/api/publish');
    assert.equal(pub.length, 1, 'the confirmed send must reach /api/publish exactly once');
    assert.equal(pub[0].body.draftId, 'draft-reject-1');
    assert.equal(pub[0].body.confirm, 'SEND');
    assert.equal(pub[0].body.reason, 'checked by hand', 'the reason must be carried, not dropped');
    await shot(page, '05-review-send');
  } finally { await context.close(); }
});

/* ================================================================== *
 * Threads
 * ================================================================== */

test('Threads counts its funnel and finds each source\'s threads whatever the casing', async () => {
  const { context, page, errors } = await open();
  try {
    await tab(page, 'discovery');
    const txt = await page.textContent('#v-discovery');
    assert.match(txt, /48 collected/);
    assert.match(txt, /16 looked at/);
    assert.match(txt, /9 worth answering/);

    /* The pinned defect: a source added as "wordpress" is stored by Reddit as "Wordpress",
       and an exact-key lookup reported "0 on file" above the very threads it had collected. */
    assert.match(txt, /16 on file/, 'r/wordpress must find its 16 threads despite the casing');
    assert.match(txt, /9 on file/, 'and r/woocommerce its 9');
    assert.ok(!/0 on file/.test(txt), 'no configured source may report zero while holding threads');

    assert.match(txt, /Site dies on import/, 'the assessment table must list its rows');
    assert.match(txt, /answer it/);
    assert.match(txt, /leave it/);
    await shot(page, '06-threads');
    assert.deepEqual(errors, [], 'Threads must render with a clean console');
  } finally { await context.close(); }
});

test('a source can be added, and the collect button runs every switched-on source then scores', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'discovery');
    await page.fill('input[aria-label="Subreddit name or search phrase"]', 'Wordpress_Help');
    await page.click('text=Add it');
    await untilHit(calls, '/api/sources/add');
    const added = hit(calls, '/api/sources/add');
    assert.equal(added.length, 1, 'Add it must reach /api/sources/add');
    assert.equal(added[0].body.value, 'Wordpress_Help');

    /* Two subreddits and one search are switched on in the fixture; crm is off.
       Collecting is a CHAIN — read, read, search, then score — so the wait is for the last
       link. Asserting after the first would pass against a button that stopped early, which
       is precisely the regression worth catching. */
    await page.click('text=/Collect from \\d+ sources?/');
    await until(() => hit(calls, '/api/run').some((c) => c.body.key === 'score'),
                'the collect chain to reach scoring');

    const runs = hit(calls, '/api/run');
    const reads = runs.filter((c) => c.body.key === 'find-threads').map((c) => c.body.subreddit);
    const searches = runs.filter((c) => c.body.key === 'find-search').map((c) => c.body.query);
    const scored = runs.filter((c) => c.body.key === 'score');

    assert.deepEqual(reads, ['wordpress', 'woocommerce'], 'only switched-on subreddits are read');
    assert.ok(!reads.includes('crm'), 'a source switched off must not be collected');
    assert.deepEqual(searches, ['mysql server has gone away wordpress']);
    assert.equal(scored.length, 1, 'scoring must run once, after the collecting');

    /**
     * Every browser-driving call must NAME the account it runs as.
     *
     * These calls carried no account at all, so the child fell through to config.browser's
     * default debug port — 9222, which on the machine this was found on was answered by
     * Lenovo Vantage's Edge. Collection drove THAT browser and reported "0 post links" as
     * though Reddit had served nothing. The server refuses the omission now; this asserts the
     * console does not rely on being refused.
     */
    const drives = runs.filter((c) => c.body.key === 'find-threads' || c.body.key === 'find-search');
    assert.ok(drives.length > 0, 'precondition: the chain made browser-driving calls');
    for (const c of drives) {
      assert.equal(c.body.account, 'docs-architect',
                   `${c.body.key} must carry the account, defaulting to the first configured one`);
    }
  } finally { await context.close(); }
});

test('collecting runs as the account picked, not a hidden default', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'discovery');
    /* The picker is the only thing that decides whose Chrome gets driven, so a change to it
       must reach the wire. Asserted on the request, not on the selected option. */
    await page.selectOption('select[aria-label="Which account collects"]', 'sgen-support');
    await page.click('text=/Collect from \\d+ sources?/');
    await until(() => hit(calls, '/api/run').some((c) => c.body.key === 'score'),
                'the collect chain to reach scoring');

    const drives = hit(calls, '/api/run')
      .filter((c) => c.body.key === 'find-threads' || c.body.key === 'find-search');
    assert.ok(drives.length > 0, 'precondition: the chain made browser-driving calls');
    for (const c of drives) {
      assert.equal(c.body.account, 'sgen-support', 'the picked account must be the one sent');
    }
  } finally { await context.close(); }
});

test('an account card opens an editor, and saving sends only the descriptive fields', async () => {
  const { context, page, calls, errors } = await open();
  try {
    await tab(page, 'accounts');

    // Closed until asked for — the card is a read-out first, a form second.
    assert.equal(await page.locator('input[aria-label="Role for docs-architect"]').count(), 0,
                 'the editor must not be open before Edit is pressed');

    await page.click('button[aria-label="Edit docs-architect"]');
    await page.waitForSelector('input[aria-label="Role for docs-architect"]', { timeout: 5000 });

    /* Pre-filled from the record: an editor that opens blank invites someone to wipe a field
       they only meant to leave alone. */
    assert.equal(await page.inputValue('input[aria-label="Role for docs-architect"]'), 'docs engineer');
    assert.equal(await page.inputValue('input[aria-label="Subreddits for docs-architect"]'),
                 'WordPress, Wordpress_Help');
    assert.equal(await page.inputValue('input[aria-label="Quiet hours for docs-architect"]'), '23-7');

    // The two that must NOT be editable here.
    assert.equal(await page.locator('input[aria-label="Sign-in folder for docs-architect"]').count(), 0);
    assert.equal(await page.locator('input[aria-label="Daily ceiling for docs-architect"]').count(), 1);

    await page.fill('input[aria-label="Role for docs-architect"]', 'docs lead');
    await page.fill('input[aria-label="Subreddits for docs-architect"]', 'woocommerce, WordPress');
    await page.fill('input[aria-label="Daily ceiling for docs-architect"]', '3');
    await page.click('text=Save changes');
    await untilHit(calls, '/api/account/update');

    const sent = hit(calls, '/api/account/update')[0].body;
    assert.equal(sent.handle, 'docs-architect', 'the edit must name the account it belongs to');
    assert.equal(sent.role, 'docs lead');
    assert.deepEqual(sent.subreddits, ['woocommerce', 'WordPress'], 'a comma list becomes a real list');
    assert.equal(sent.dailyCeiling, 3, 'a ceiling is sent as a number, not a string');
    assert.deepEqual(sent.quietHours, [23, 7]);
    /* Never sent, so a bug in the server's allow-list could not be reached from here anyway. */
    assert.ok(!('debugPort' in sent), 'the debug port must not be sent from the browser');
    assert.ok(!('profileDir' in sent), 'the profile folder must not be sent from the browser');
    assert.ok(!('karma' in sent), 'a measured fact is not an editable field');

    assert.deepEqual(errors, [], 'editing must run with a clean console');
  } finally { await context.close(); }
});

test('the editor says where the un-editable fields are changed instead', async () => {
  const { context, page } = await open();
  try {
    await tab(page, 'accounts');
    await page.click('button[aria-label="Edit docs-architect"]');
    await page.waitForSelector('input[aria-label="Role for docs-architect"]', { timeout: 5000 });
    const txt = await page.textContent('#v-accounts');
    /* Leaving them out silently reads as "these cannot be changed at all", which is false. */
    assert.match(txt, /not editable here/i, 'the omission must be explained');
    assert.match(txt, /accounts\.json/, 'and it must say where they ARE changed');
    assert.match(txt, /signed out/i, 'and why it is not a button');
  } finally { await context.close(); }
});

test('Cancel closes the editor without sending anything', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'accounts');
    await page.click('button[aria-label="Edit docs-architect"]');
    await page.waitForSelector('input[aria-label="Role for docs-architect"]', { timeout: 5000 });
    await page.fill('input[aria-label="Role for docs-architect"]', 'discarded');
    await page.click('text=Cancel');
    await page.waitForFunction(
      () => !document.querySelector('input[aria-label="Role for docs-architect"]'), null, { timeout: 5000 });
    assert.equal(hit(calls, '/api/account/update').length, 0, 'Cancel must not save');
  } finally { await context.close(); }
});

test('no screen offers a Chrome-profile picker, because none of them drive one', async () => {
  const { context, page, errors } = await open();
  try {
    await tab(page, 'accounts');

    /* The wizard had one for a while. It recorded an answer that nothing ever read: redbot
       attaches to its OWN Chrome on debugPort with --user-data-dir=profileDir, and no code
       path consults the everyday-profile answer. A control that changes nothing reads as one
       that does — it invites "so is my real login being used?", and the answer was always no. */
    assert.equal(await page.locator('select[aria-label*="Chrome profile"]').count(), 0,
                 'the wizard must not offer a picker that drives nothing');

    await page.click('button[aria-label="Edit docs-architect"]');
    await page.waitForSelector('input[aria-label="Role for docs-architect"]', { timeout: 5000 });
    assert.equal(await page.locator('select[aria-label*="Chrome profile"]').count(), 0,
                 'and neither must the editor');

    /* What DOES decide the browser is still stated on the card, and still not editable. */
    const txt = await page.textContent('#v-accounts');
    assert.match(txt, /Sign-in folder/, 'the folder that is actually driven stays visible');
    assert.match(txt, /not editable here/i);

    assert.deepEqual(errors, [], 'the accounts screen must render clean without it');
    await shot(page, 'accounts-editor-no-chrome-picker');
  } finally { await context.close(); }
});

/**
 * A folder that exists is not a folder anybody is signed in to.
 *
 * redbot now CREATES the Chrome profile folder when it allocates the name, which fixed a pulled
 * account reporting `Sign-in folder chrome-profile-c missing` — but it also broke the old reading
 * of "exists". A directory made a second ago holds no Reddit session, and `src/push/accounts.ts`
 * warns in as many words against anything that "looks ready and cannot post". Both fixture accounts
 * have `profileExists: true`; only one has ever been used, and the screen must not call them the
 * same thing.
 */
test('the accounts screen separates a signed-in profile from an empty folder', async () => {
  /**
   * Its OWN state, rather than a change to the shared fixture.
   *
   * The first version of this flipped `sgen-support` to the `empty` state in ui-fixture.mjs, which
   * silently stole the only account covering "a profile folder that is not on disk must be
   * flagged" — that assertion went from meaningful to unsatisfiable and the suite failed. One
   * fixture account cannot demonstrate two mutually exclusive states, so this test brings its own.
   */
  const state = makeState(NOW);
  state.accounts = state.accounts.map((a) => (a.handle === 'sgen-support'
    ? { ...a, profileExists: true, profileState: 'empty' }
    : a));

  const { context, page, errors } = await open({ state });
  try {
    await tab(page, 'accounts');
    const txt = await page.textContent('#v-accounts');

    /**
     * THE WORDING CHANGED, AND THE REASON IS THE POINT OF THIS TEST.
     *
     * `used` was rendered as "signed-in profile", which was a fair inference while only a person
     * ever opened the browser. Boot opening every account's Chrome ended that: Chrome writes
     * `Local State` and `Default` the moment it starts, so a folder nobody has logged into is
     * `used` after the first launch. Measured — chrome-profile-a held Local State, Default and
     * Crashpad while the window sat on reddit.com/login, and the card claimed a session.
     *
     * The disk cannot answer "is this signed in"; only the running browser can. So the label now
     * says what the disk proves. These assertions pin the honest wording — and the negative one
     * below is the load-bearing half: `used` must never again claim a session.
     */
    assert.match(txt, /Chrome has used this folder/, 'a used folder must be reported as exactly that');
    assert.doesNotMatch(txt, /signed-in profile/,
      'the disk cannot prove a Reddit session — only the running browser can');
    assert.match(txt, /created, never opened/,
      'an empty folder must NOT be reported as ready just because it exists');
    /* And it must say what to do about it, not merely label it. */
    assert.match(txt, /Chrome has never written to it/);

    const cards = await page.evaluate(() => [...document.querySelectorAll('#v-accounts .card')]
      .map((c) => ({
        handle: c.querySelector('.chead b')?.textContent ?? '',
        text: c.textContent ?? ''
      })));
    const used = cards.find((c) => c.handle === 'docs-architect');
    const empty = cards.find((c) => c.handle === 'sgen-support');
    assert.ok(used && empty, 'both accounts should render');
    assert.match(used.text, /Chrome has used this folder/);
    assert.doesNotMatch(used.text, /created, never opened/,
      'a folder a browser has written to must not be labelled as untouched');
    assert.match(empty.text, /created, never opened/);
    assert.doesNotMatch(empty.text, /signed-in profile/,
      'an unused folder must not claim a session');

    assert.deepEqual(errors, [], 'the accounts screen must render clean');
    await shot(page, 'accounts-profile-states');
  } finally { await context.close(); }
});

/**
 * The third state, on the shared fixture: a folder that is not there at all.
 *
 * Kept beside the test above so the pair is obvious — `missing` and `empty` are different facts
 * and the screen must not collapse them. This is the state a dashboard pull used to leave behind.
 */
test('a profile folder that was never created still reads as missing', async () => {
  const { context, page, errors } = await open();
  try {
    await tab(page, 'accounts');
    const txt = await page.textContent('#v-accounts');
    assert.match(txt, /missing/, 'an absent folder must be flagged as absent');
    assert.doesNotMatch(txt, /created, not signed in yet/,
      'an absent folder must not be described as one redbot made');
    assert.deepEqual(errors, [], 'the accounts screen must render clean');
  } finally { await context.close(); }
});

/* ------------------------------------------------------------------ *
 * The port, and what is on it, on the account card
 * ------------------------------------------------------------------ */

test('each card says which port it is on and whether that port is really its browser', async () => {
  const { context, page, errors } = await open();
  try {
    await tab(page, 'accounts');
    await page.waitForSelector('button[aria-label="Stop docs-architect"]', { timeout: 5000 });
    const txt = await page.textContent('#v-accounts');

    assert.match(txt, /9222/, 'the port must be on the card, not only in a config file');
    assert.match(txt, /running/, 'the account whose own browser holds the port reads as running');

    /* The case the screen exists for. A port that answers the debugging protocol but belongs
       to another program looks healthy to anything that only checks reachability. */
    assert.match(txt, /taken by something else/i, 'a stranger must be named as a stranger');
    assert.match(txt, /msedgewebview2\.exe/, 'and identified, so it can be dealt with');
    assert.match(txt, /signed out/i, 'with the consequence stated');

    assert.deepEqual(errors, [], 'the accounts screen must render clean');
    await shot(page, 'accounts-port-status');
  } finally { await context.close(); }
});

test('a running account offers Stop, a stopped one offers Start', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'accounts');
    await page.waitForSelector('button[aria-label="Stop docs-architect"]', { timeout: 5000 });

    /* docs-architect is running in the fixture, sgen-support's port is held by a stranger —
       so neither offers the other's button, and neither is offered a meaningless one. */
    assert.equal(await page.locator('button[aria-label="Start docs-architect"]').count(), 0,
                 'a browser already running must not offer to start again');
    assert.equal(await page.locator('button[aria-label="Stop sgen-support"]').count(), 0,
                 'and a port held by a stranger must never offer a Stop that would kill it');

    await page.click('button[aria-label="Stop docs-architect"]');
    await untilHit(calls, '/api/account/stop');
    assert.equal(hit(calls, '/api/account/stop')[0].body.handle, 'docs-architect',
                 'stop must name the account, never just the port');
  } finally { await context.close(); }
});

test('an account whose browser is not running offers to start it', async () => {
  /* Same screen, one state changed — the fixture is the only difference. */
  const ports = {
    at: PORTS.at, suggestion: 9225,
    ports: [{ handle: 'docs-architect', port: 9222, state: 'free', ours: false, profileOnDisk: true,
              detail: "Nothing is listening on 9222. This account's browser is not running." }]
  };
  const { context, page, calls } = await open({ ports });
  try {
    await tab(page, 'accounts');
    await page.waitForSelector('button[aria-label="Start docs-architect"]', { timeout: 5000 });
    assert.match(await page.textContent('#v-accounts'), /not running/i);

    await page.click('button[aria-label="Start docs-architect"]');
    await untilHit(calls, '/api/account/open');
    assert.equal(hit(calls, '/api/account/open')[0].body.handle, 'docs-architect');
  } finally { await context.close(); }
});

test('changing a port offers a free one, and sends what was typed', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'accounts');
    await page.waitForSelector('button[aria-label="Change port for docs-architect"]', { timeout: 5000 });
    await page.click('button[aria-label="Change port for docs-architect"]');

    const box = 'input[aria-label="New port for docs-architect"]';
    await page.waitForSelector(box, { timeout: 5000 });
    /* Pre-filled with a port the server has already checked is free, so the ordinary path is
       "press the button", not "guess a number and be told no". */
    assert.equal(await page.inputValue(box), '9225', 'the suggestion must be offered, not left blank');

    await page.fill(box, '9310');
    await page.click('button[aria-label="Use this port for docs-architect"]');
    await untilHit(calls, '/api/account/port');
    const sent = hit(calls, '/api/account/port')[0].body;
    assert.equal(sent.handle, 'docs-architect');
    assert.equal(sent.port, 9310, 'the port must be sent as a number, not a string');
  } finally { await context.close(); }
});

test('“Pick a free one” asks the server to choose rather than guessing in the browser', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'accounts');
    await page.waitForSelector('button[aria-label="Change port for docs-architect"]', { timeout: 5000 });
    await page.click('button[aria-label="Change port for docs-architect"]');
    await page.waitForSelector('button[aria-label="Pick a free port for docs-architect"]', { timeout: 5000 });
    await page.click('button[aria-label="Pick a free port for docs-architect"]');

    await untilHit(calls, '/api/account/port');
    const sent = hit(calls, '/api/account/port')[0].body;
    assert.equal(sent.auto, true, 'only the server can bind-test a port; the browser must not pretend to');
    assert.equal('port' in sent, false, 'and it must not send a number it invented');
  } finally { await context.close(); }
});

test('a refused port keeps the form open and offers the one that would work', async () => {
  const { context, page } = await open();
  try {
    await page.route('**/api/account/port', (route) => route.fulfill({
      status: 400, contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'Port 80 is already in use on this machine. Chrome would not be able to take it.', suggestion: 9226 })
    }));

    await tab(page, 'accounts');
    await page.click('button[aria-label="Change port for docs-architect"]');
    const box = 'input[aria-label="New port for docs-architect"]';
    await page.waitForSelector(box, { timeout: 5000 });
    await page.fill(box, '80');
    await page.click('button[aria-label="Use this port for docs-architect"]');

    /* A refusal that leaves you where you were, with a number that works, is a form you can
       finish. Closing on failure would mean re-opening it to try again. */
    await page.waitForFunction(() => /already in use/i.test(document.querySelector('#v-accounts').textContent),
                               null, { timeout: 5000 });
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="New port for docs-architect"]')?.value === '9226',
      null, { timeout: 5000 });
    await shot(page, 'accounts-port-refused');
  } finally { await context.close(); }
});

test('an account shared from another machine says so, and offers to set itself up here', async () => {
  /* The state a second computer is in: the description arrived through the shared database,
     the Reddit session did not — it is locked to the machine it was made on. */
  const ports = {
    at: PORTS.at, suggestion: 9225, machine: 'test-laptop',
    boundHere: ['docs-architect'],
    ports: [
      PORTS.ports[0],
      { handle: 'sgen-support', port: 9223, state: 'free', ours: false, profileOnDisk: false,
        detail: 'Nothing is listening on 9223.' }
    ]
  };
  const { context, page, calls, errors } = await open({ ports });
  try {
    await tab(page, 'accounts');
    await page.waitForSelector('button[aria-label="Set up sgen-support on this machine"]', { timeout: 5000 });

    const txt = await page.textContent('#v-accounts');
    assert.match(txt, /not set up on this machine/i, 'the card must not imply a browser it has not got');
    assert.match(txt, /cannot travel/i, 'and must say why signing in again is unavoidable');

    /* The dangerous button. Start would open a signed-out window on a folder that holds no
       login, and look like it worked. */
    assert.equal(await page.locator('button[aria-label="Start sgen-support"]').count(), 0,
                 'an account with no browser here must not offer to start one');
    /* The account that IS bound here is unaffected — same screen, both states at once. */
    assert.equal(await page.locator('button[aria-label="Stop docs-architect"]').count(), 1);

    await page.click('button[aria-label="Set up sgen-support on this machine"]');
    await untilHit(calls, '/api/account/setup-here');
    assert.equal(hit(calls, '/api/account/setup-here')[0].body.handle, 'sgen-support');

    assert.deepEqual(errors, [], 'the shared-account state must render clean');
    await shot(page, 'accounts-not-set-up-here');
  } finally { await context.close(); }
});

test('a console that cannot ask which accounts are bound claims nothing', async () => {
  /* boundHere is null when the database could not be reached. "I could not tell" is not "no" —
     showing every account as unavailable because a query failed would be a worse lie than the
     one this feature removes. */
  const ports = { at: PORTS.at, suggestion: 9225, machine: 'test-laptop', boundHere: null, ports: PORTS.ports };
  const { context, page } = await open({ ports });
  try {
    await tab(page, 'accounts');
    await page.waitForSelector('button[aria-label="Stop docs-architect"]', { timeout: 5000 });
    const txt = await page.textContent('#v-accounts');
    assert.doesNotMatch(txt, /not set up on this machine/i,
                        'an unanswerable question must not be reported as a negative answer');
  } finally { await context.close(); }
});

/* ------------------------------------------------------------------ *
 * Paging — the screen must show a page, not a table
 * ------------------------------------------------------------------ */

/** A state whose Threads screen reports thousands of rows but carries only the first page. */
function bigThreads(now, pageRows = 25, total = 4812, offset = 0) {
  const state = makeState(now);
  state.discovery = {
    ...state.discovery,
    threadsCollected: total, assessed: total, contribute: total - 900, skip: 900,
    gapsAnalysed: 120, drafted: 40,
    total, offset, limit: 25,
    items: Array.from({ length: pageRows }, (_, i) => ({
      threadId: `t${offset + i}`,
      title: `thread number ${offset + i}`,
      permalink: `/r/WordPress/comments/${offset + i}`,
      verdict: i % 3 === 0 ? 'skip' : 'contribute',
      score: 90 - i,
      thesis: { whyThread: null, whatNew: `what row ${offset + i} would add`, whyNotSilent: null },
      reasons: ['seeded'],
      subreddit: 'WordPress', comments: 7, ageText: '2 h ago',
      draftId: null, draftStatus: null
    }))
  };
  return state;
}

test('the Threads screen renders one page and says how many there are altogether', async () => {
  const { context, page, errors } = await open({ state: bigThreads(NOW) });
  try {
    await tab(page, 'discovery');

    /* The assertion that separates paging from hiding: 4,812 rows exist, 25 are in the DOM.
       Rendering them all is what made a big table unloadable in the first place. */
    const rendered = await page.locator('#v-discovery tbody tr').count();
    assert.equal(rendered, 25, `one page must be rendered, got ${rendered} rows`);

    const txt = await page.textContent('#v-discovery');
    /* A page of 25 with no total reads as "there are 25". The count is the whole point. */
    assert.match(txt, /Showing 1–25 of 4,812/, 'the range and the true total must both be shown');

    assert.deepEqual(errors, [], 'the paged screen must render clean');
    await shot(page, 'threads-paged');
  } finally { await context.close(); }
});

test('Newer is disabled on the first page, and Older asks the server for the next one', async () => {
  const { context, page, calls } = await open({ state: bigThreads(NOW) });
  try {
    await tab(page, 'discovery');
    /* Disabled rather than absent: a control that vanishes at the ends moves the other one
       under the pointer just as you reach for it. */
    assert.equal(await page.locator('button[aria-label="Previous page of threads"]').isDisabled(), true);
    assert.equal(await page.locator('button[aria-label="Next page of threads"]').isDisabled(), false);

    await page.click('button[aria-label="Next page of threads"]');
    await until(async () => calls.some((c) => c.path === '/api/page'), 'the next page to be requested');

    /* The page is cut by the DATABASE. A browser that asked for everything and sliced it would
       have made this request unnecessary — and would still be loading the whole table. */
    const req = calls.find((c) => c.path === '/api/page');
    assert.equal(req.query.list, 'threads');
    assert.equal(req.query.offset, '25', 'Older must advance by exactly one page');
    assert.equal(req.query.limit, '25');
  } finally { await context.close(); }
});

test('the last page disables Older, and the range reports the tail honestly', async () => {
  /* 4,812 rows, 25 to a page: the final page starts at 4,800 and holds 12. */
  const { context, page } = await open({ state: bigThreads(NOW, 12, 4812, 4800) });
  try {
    await tab(page, 'discovery');
    const txt = await page.textContent('#v-discovery');
    assert.match(txt, /Showing 4,801–4,812 of 4,812/, 'a short last page must not claim a full one');
    assert.equal(await page.locator('button[aria-label="Next page of threads"]').isDisabled(), true);
    assert.equal(await page.locator('button[aria-label="Previous page of threads"]').isDisabled(), false);
  } finally { await context.close(); }
});

test('a list that fits on one page shows no pager at all', async () => {
  const { context, page } = await open({ state: bigThreads(NOW, 4, 4, 0) });
  try {
    await tab(page, 'discovery');
    /* Controls that can only ever be disabled are noise. */
    assert.equal(await page.locator('button[aria-label="Next page of threads"]').count(), 0);
    assert.equal(await page.locator('button[aria-label="Previous page of threads"]').count(), 0);
    assert.match(await page.textContent('#v-discovery'), /thread number 0/, 'the rows are still there');
  } finally { await context.close(); }
});

/* ------------------------------------------------------------------ *
 * The rest of the tabs — Results, Review, and the log's real limit
 * ------------------------------------------------------------------ */

function bigOutcomes(now, pageRows = 25, total = 1340, offset = 0) {
  const state = makeState(now);
  state.outcomes = {
    ...state.outcomes,
    observationsTotal: total, observationsOffset: offset, observationsLimit: 25,
    /* Counted over the WHOLE table by the server. The page below holds none of these
       checkpoints, which is exactly the case that used to read "not run". */
    checkpoints: [
      { checkpoint: '24h', taken: 300, latestTs: new Date(now - 3600_000).toISOString() },
      { checkpoint: '7d', taken: 120, latestTs: new Date(now - 7200_000).toISOString() }
    ],
    observations: Array.from({ length: pageRows }, (_, i) => ({
      ts: new Date(now - (offset + i) * 60_000).toISOString(),
      account: 'docs-architect', kind: 'karma', vector: 'comment',
      value: 200 + i, note: `reading ${offset + i}`, checkpoint: null, permalink: null
    }))
  };
  return state;
}

/* ------------------------------------------------------------------ *
 * The busy toast — it stays while the work does
 *
 * The ordinary toast leaves after 1.9s. That is right for "Saved" and wrong for a collect that
 * drives a real Chrome for minutes: the message vanished and left no way to tell "working" from
 * "nothing happened", which is exactly when somebody presses the button again.
 *
 * So these assert the property the feature is FOR — still on screen after the transient toast
 * would have gone — not merely that a toast appeared.
 * ------------------------------------------------------------------ */

/** Hold /api/run open so the click is genuinely mid-flight while we assert. */
async function withSlowRun(page, ms, fn) {
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/api/run', async (route) => {
    await gate;
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, code: 0, ms, output: 'done', command: 'redbot collect' })
    });
  });
  try { return await fn(() => release()); } finally { release(); }
}

test('a slow action keeps its toast up past the point a normal one would have gone', async () => {
  const { context, page } = await open();
  try {
    await tab(page, 'discovery');
    await withSlowRun(page, 90_000, async (finish) => {
      await page.click('text=/Collect from \\d+ source/');
      await page.waitForSelector('#toast.busy', { timeout: 5000 });

      /* The whole point. A transient toast is gone by 1.9s; this one is still here at 3s
         because the work it names has not finished. */
      await page.waitForTimeout(3000);
      assert.equal(await page.locator('#toast.busy').isVisible(), true,
                   'the busy toast must outlive the 1.9s transient timeout');
      assert.equal(await page.getAttribute('#toast', 'aria-busy'), 'true',
                   'and say so to a screen reader, not only visually');
      /* A spinner is what separates "still going" from "stuck on screen" — a motionless
         message that never left looks identical to one that failed to dismiss. */
      assert.equal(await page.locator('#toast .spin').count(), 1, 'it must show it is alive');

      await shot(page, 'toast-busy');
      finish();
    });

    /* And it DOES clear once the work is over — a spinner left up forever is the worse lie. */
    await page.waitForFunction(() => !document.querySelector('#toast.busy'), null, { timeout: 10_000 });
  } finally { await context.close(); }
});

test('the busy toast names the step, so it says what is taking the time', async () => {
  const { context, page } = await open();
  try {
    await tab(page, 'discovery');
    await withSlowRun(page, 90_000, async (finish) => {
      await page.click('text=/Collect from \\d+ source/');
      await page.waitForSelector('#toast.busy', { timeout: 5000 });
      await until(async () => /r\/|Reading|Collect/i.test(await page.textContent('#toast')),
                  'the toast to name the step it is on');
      finish();
    });
  } finally { await context.close(); }
});

test('a finished message never steals the screen from work still running', async () => {
  /* Two things at once is the ordinary case — a poll landing mid-collect. If the transient
     toast could overwrite the busy one, the run would look finished while it was still going. */
  const { context, page } = await open();
  try {
    await tab(page, 'discovery');
    await withSlowRun(page, 90_000, async (finish) => {
      await page.click('text=/Collect from \\d+ source/');
      await page.waitForSelector('#toast.busy', { timeout: 5000 });

      /* A REAL transient toast, through the path a person would take: pressing "Add it" with
         an empty box answers "Type a name first". Reaching into the page's internals would
         test the helper; this tests the screen. */
      await page.click('text=Add it');
      await page.waitForTimeout(400);
      assert.equal(await page.locator('#toast.busy').count(), 1,
                   'a transient toast must not replace one that is still working');
      assert.doesNotMatch(await page.textContent('#toast'), /Type a name first/,
                          'nor overwrite its text');
      finish();
    });
  } finally { await context.close(); }
});

test('a failed action clears the spinner instead of leaving it spinning forever', async () => {
  const { context, page } = await open();
  try {
    await page.route('**/api/run', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'the collector could not start' })
    }));
    await tab(page, 'discovery');
    await page.click('text=/Collect from \\d+ source/');

    /* Fail-closed for the UI: an error path that forgot to end the toast would hang a spinner
       on screen permanently, which reads as "still working" forever. */
    await page.waitForFunction(() => !document.querySelector('#toast.busy'), null, { timeout: 15_000 });
    assert.equal(await page.locator('#toast .spin').count(), 0, 'no spinner may survive a failure');
  } finally { await context.close(); }
});

test('starting a browser holds a toast for the whole open-and-recheck', async () => {
  /* Not a doAction path — this one had no feedback at all, and it spawns a process then
     re-reads who owns the port, which costs seconds. */
  const { context, page } = await open({
    ports: { at: PORTS.at, suggestion: 9225, machine: 'test', boundHere: ['docs-architect'],
             ports: [{ handle: 'docs-architect', port: 9222, state: 'free', ours: false,
                       profileOnDisk: true, detail: 'Nothing is listening on 9222.' }] }
  });
  try {
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route('**/api/account/open', async (route) => {
      await gate;
      return route.fulfill({ status: 200, contentType: 'application/json',
                             body: JSON.stringify({ ok: true, handle: 'docs-architect', port: 9222 }) });
    });

    await tab(page, 'accounts');
    await page.click('button[aria-label="Start docs-architect"]');
    await page.waitForSelector('#toast.busy', { timeout: 5000 });
    assert.match(await page.textContent('#toast'), /Opening Chrome/i,
                 'it must say which slow thing is happening');
    release();
    await page.waitForFunction(() => !document.querySelector('#toast.busy'), null, { timeout: 10_000 });
  } finally { await context.close(); }
});


test('the busy toast offers Stop, and Stop asks the server to kill the run', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'discovery');
    await withSlowRun(page, 90_000, async (finish) => {
      await page.click('text=/Collect from \\d+ source/');
      await page.waitForSelector('#toast.busy', { timeout: 5000 });

      const stop = page.locator('#toast .stopbtn');
      assert.equal(await stop.count(), 1, 'a long run must be interruptible from where it is announced');
      await stop.click();

      /* The browser cannot cancel this by dropping its fetch — the run is a process on the
         machine. Stopping has to be a request of its own, or the work carries on unwatched. */
      await untilHit(calls, '/api/run/stop');
      assert.equal(await stop.textContent(), 'Stopping…', 'and it must say it heard you');
      assert.equal(await stop.isDisabled(), true, 'pressed twice is still one kill');
      finish();
    });
  } finally { await context.close(); }
});

test('a stopped run reads as stopped, not as a failure', async () => {
  const { context, page } = await open();
  try {
    /* What the server sends back once the child it killed has closed. */
    await page.route('**/api/run', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: false, stopped: true, code: 1, error: 'Stopped.', output: '' })
    }));
    await tab(page, 'discovery');
    await page.click('text=/Collect from \\d+ source/');

    await page.waitForFunction(() => !document.querySelector('#toast.busy'), null, { timeout: 15_000 });
    const txt = await page.textContent('#v-discovery');
    /* Reporting a person's own decision back to them as an error is the thing to avoid. */
    assert.match(txt, /Stopped/, 'the run log must say it stopped');
    assert.doesNotMatch(txt, /Failed: Stopped/, 'and never dress that up as a failure');
  } finally { await context.close(); }
});

test('the send flow offers no Stop at all', async () => {
  /* Submitting and confirming are two steps. A kill between them leaves a live comment on
     Reddit that redbot has no record of — so there is nothing here to press, and the server
     refuses it too. A button that only ever gets refused is a button that lies. */
  const { context, page } = await open();
  try {
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route('**/api/publish', async (route) => {
      await gate;
      return route.fulfill({ status: 200, contentType: 'application/json',
                             body: JSON.stringify({ ok: true, recorded: true, output: 'sent' }) });
    });

    await tab(page, 'review');
    await page.click('text=Send it…');
    await page.fill('input[aria-label="Type SEND to confirm"]', 'SEND');
    await page.click('text=Confirm and send');
    await page.waitForSelector('#toast.busy', { timeout: 5000 });

    assert.equal(await page.locator('#toast .stopbtn').count(), 0,
                 'a reply mid-send must not offer a Stop that cannot be honoured');
    await shot(page, 'toast-send-no-stop');
    release();
  } finally { await context.close(); }
});

test('a refused Stop puts the button back rather than lying about it', async () => {
  const { context, page } = await open();
  try {
    await page.route('**/api/run/stop', (route) => route.fulfill({
      status: 409, contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'A reply that is being sent cannot be stopped part-way.' })
    }));
    await tab(page, 'discovery');
    await withSlowRun(page, 90_000, async (finish) => {
      await page.click('text=/Collect from \\d+ source/');
      await page.waitForSelector('#toast .stopbtn', { timeout: 5000 });
      await page.click('#toast .stopbtn');

      /* Refused means still running. Leaving it disabled on "Stopping…" would show work as
         being torn down when it is carrying on. */
      await page.waitForFunction(
        () => { const b = document.querySelector('#toast .stopbtn'); return b && !b.disabled; },
        null, { timeout: 8000 });
      assert.equal(await page.locator('#toast .stopbtn').textContent(), 'Stop');
      assert.equal(await page.locator('#toast.busy').count(), 1, 'and the run is still announced');
      finish();
    });
  } finally { await context.close(); }
});


test('the Dropped panel names which rule caught the threads, and what is merely unread', async () => {
  /* 101 collected, 30 assessed -> 71 never assessed. 62 of those were filtered (with reasons
     now on record) and 9 were KEPT and simply not analysed yet. Attributing all 71 to a rule
     would be the made-up figure this panel used to refuse to print. */
  const state = makeState(NOW);
  state.discovery = {
    ...state.discovery,
    threadsCollected: 101, assessed: 30, contribute: 22, skip: 8,
    gapsAnalysed: 30, drafted: 4, total: 30, offset: 0, limit: 25,
    prefilter: {
      total: 62,
      byKind: [
        { kind: 'outside-pilot', n: 41 },
        { kind: 'too-old', n: 15 },
        { kind: 'not-a-question', n: 6 }
      ]
    }
  };
  const { context, page, errors } = await open({ state });
  try {
    await tab(page, 'discovery');
    const txt = await page.textContent('#v-discovery');

    assert.match(txt, /outside the pilot subreddits/, 'the rule an operator can act on must be named');
    assert.match(txt, /41/, 'with its real count');
    assert.match(txt, /older than the 72h ceiling/);
    assert.match(txt, /not a question/);

    /* The honest remainder: 71 - 62 = 9 nothing rejected. */
    assert.match(txt, /kept, not looked at yet/, 'and threads awaiting analysis are not called filtered');
    assert.doesNotMatch(txt, /no breakdown is shown/, 'the apology is gone now the reasons exist');

    assert.deepEqual(errors, [], 'the panel must render clean');
    await shot(page, 'threads-dropped-breakdown');
  } finally { await context.close(); }
});

test('with no reasons on record it says so rather than showing an empty split', async () => {
  /* Not the same as "nothing was dropped": the reasons are written when `redbot opportunity`
     runs, and before that the total is all this screen can honestly show. */
  const state = makeState(NOW);
  state.discovery = { ...state.discovery, threadsCollected: 40, assessed: 5, skip: 1, prefilter: null };
  const { context, page } = await open({ state });
  try {
    await tab(page, 'discovery');
    const txt = await page.textContent('#v-discovery');
    assert.match(txt, /No reasons are on record yet/);
    assert.match(txt, /redbot opportunity/, 'and says what would produce them');
    assert.doesNotMatch(txt, /kept, not looked at yet/, 'no split may be shown without the data for it');
  } finally { await context.close(); }
});


test('Results renders one page of measurements and says how many exist', async () => {
  const { context, page, errors } = await open({ state: bigOutcomes(NOW) });
  try {
    await tab(page, 'outcomes');
    const rows = await page.locator('#v-outcomes tbody tr').count();
    assert.equal(rows, 25, `one page must be rendered, got ${rows}`);
    assert.match(await page.textContent('#v-outcomes'), /Showing 1–25 of 1,340/);
    assert.deepEqual(errors, [], 'the paged Results screen must render clean');
    await shot(page, 'outcomes-paged');
  } finally { await context.close(); }
});

test('a checkpoint whose readings are off-page still reads as taken, not "not run"', async () => {
  /* THE TRAP. This panel used to derive from the observation list, so once that became one
     page a checkpoint with three hundred readings — none of them recent enough to be on it —
     would report "not run". A screen confidently stating the opposite of the record is worse
     than a slow screen, so the tally is a GROUP BY over the whole table. */
  const { context, page } = await open({ state: bigOutcomes(NOW) });
  try {
    await tab(page, 'outcomes');
    const txt = await page.textContent('#v-outcomes');
    assert.match(txt, /420 taken/, 'the header counts every reading, not the page');
    /* The page below holds only `karma` rows with no checkpoint at all, so these two can only
       be reading "read" from the whole-table tally. */
    assert.match(txt, /24hread/, 'a checkpoint with readings off-page must still read as taken');
    assert.match(txt, /7dread/);
    /* And the negative still has to work: these two genuinely have no readings, so reporting
       them as taken would be the opposite mistake. */
    assert.match(txt, /immediatenot run/, 'a checkpoint with no readings must still say so');
    assert.match(txt, /1hnot run/);
  } finally { await context.close(); }
});

test('Older on Results asks the server for the next page of observations', async () => {
  const { context, page, calls } = await open({ state: bigOutcomes(NOW) });
  try {
    await tab(page, 'outcomes');
    await page.click('button[aria-label="Next page of observations"]');
    await until(async () => calls.some((c) => c.path === '/api/page' && c.query?.list === 'observations'),
                'the observations page to be requested');
    const req = calls.find((c) => c.path === '/api/page' && c.query.list === 'observations');
    assert.equal(req.query.offset, '25');
  } finally { await context.close(); }
});

test('Review counts the whole queue, not the page it is showing', async () => {
  /* The one number on that screen a person acts on. A page of 2 drafts out of 340 waiting must
     not say "2" — that is the difference between "I am nearly done" and "I have not started". */
  const state = makeState(NOW);
  state.reviewTotal = 400;
  state.reviewPending = 340;
  state.reviewOffset = 0;
  state.reviewLimit = 25;
  const { context, page } = await open({ state });
  try {
    await tab(page, 'review');
    await page.waitForSelector('#stackN', { timeout: 5000 });
    assert.equal((await page.textContent('#stackN')).trim(), '340',
                 'the queue size comes from the database, not from what is rendered');
  } finally { await context.close(); }
});

test('Review falls back to the page count when the server sends no total', async () => {
  /* An older server, or no database. Showing nothing would be worse than showing the page. */
  const state = makeState(NOW);
  delete state.reviewPending;
  const { context, page } = await open({ state });
  try {
    await tab(page, 'review');
    await page.waitForSelector('#stackN', { timeout: 5000 });
    const shown = Number((await page.textContent('#stackN')).trim());
    assert.ok(Number.isFinite(shown), 'it must still show a number rather than blank');
  } finally { await context.close(); }
});

test('paging Review asks /api/state for that page, since the cards are assembled there', async () => {
  const state = makeState(NOW);
  state.reviewTotal = 400; state.reviewPending = 340; state.reviewOffset = 0; state.reviewLimit = 25;
  const { context, page, calls } = await open({ state });
  try {
    await tab(page, 'review');
    await page.waitForSelector('button[aria-label="Next page of review"]', { timeout: 5000 });
    await page.click('button[aria-label="Next page of review"]');
    /* A review card carries its certification, its thread and its assessment — all assembled by
       /api/state — so the page is a parameter of that request, not a lighter separate one. */
    await until(async () => calls.some((c) => c.path === '/api/state' && c.query?.reviewOffset === '25'),
                'the next review page to be requested');
  } finally { await context.close(); }
});

/* ------------------------------------------------------------------ *
 * Removing an account
 * ------------------------------------------------------------------ */

test('removing an account asks first, and says the sign-in folder is kept', async () => {
  const { context, page, calls, errors } = await open();
  try {
    await tab(page, 'accounts');
    await page.click('button[aria-label="Edit docs-architect"]');
    await page.waitForSelector('button[aria-label="Remove docs-architect"]', { timeout: 5000 });

    await page.click('button[aria-label="Remove docs-architect"]');
    await page.waitForSelector('button[aria-label="Confirm removing docs-architect"]', { timeout: 5000 });

    /* The folder holds the only copy of that Reddit session — no password is stored anywhere.
       A person deciding whether to press this needs to know it is not what they are deleting. */
    const txt = await page.textContent('#v-accounts');
    assert.match(txt, /record only/i, 'it must say what is removed');
    assert.match(txt, /chrome-profile-a/, 'and name the folder it keeps');
    assert.match(txt, /stays on disk/i, 'and say plainly that it stays');

    assert.equal(hit(calls, '/api/account/remove').length, 0, 'asking must not have removed anything yet');
    await shot(page, 'accounts-remove-confirm');

    await page.click('button[aria-label="Confirm removing docs-architect"]');
    await untilHit(calls, '/api/account/remove');
    const sent = hit(calls, '/api/account/remove')[0].body;
    assert.equal(sent.handle, 'docs-architect');
    assert.notEqual(sent.confirm, true, 'the first press must not pre-confirm destroying history');

    assert.deepEqual(errors, [], 'removing must run with a clean console');
  } finally { await context.close(); }
});

test('“Keep it” backs out of a removal without sending anything', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'accounts');
    await page.click('button[aria-label="Edit docs-architect"]');
    await page.waitForSelector('button[aria-label="Remove docs-architect"]', { timeout: 5000 });
    await page.click('button[aria-label="Remove docs-architect"]');
    await page.waitForSelector('button[aria-label="Confirm removing docs-architect"]', { timeout: 5000 });
    await page.click('text=Keep it');
    await page.waitForFunction(
      () => !document.querySelector('button[aria-label="Confirm removing docs-architect"]'), null, { timeout: 5000 });
    assert.equal(hit(calls, '/api/account/remove').length, 0, 'backing out must not remove anything');
  } finally { await context.close(); }
});

test('an account with history reports what would be destroyed before it is', async () => {
  const { context, page, calls, errors } = await open();
  try {
    /* The server answers 409 with real counts. Registered before the catch-all so this test
       sees the refusal path rather than the happy one. */
    await page.route('**/api/account/remove', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      calls.push({ path: '/api/account/remove', body });
      if (body.confirm === true) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, handle: 'docs-architect', removedFrom: ['database', 'seed-file'], profileDirKept: 'chrome-profile-a' }) });
      }
      return route.fulfill({ status: 409, contentType: 'application/json',
        body: JSON.stringify({ ok: false, needsConfirm: true, handle: 'docs-architect',
          dependents: { jobs: 47, drafts: 12 },
          error: 'docs-architect has history: 47 job records would be deleted with it, 12 drafts would stop saying who wrote them. Nothing has been removed.' }) });
    });

    await tab(page, 'accounts');
    await page.click('button[aria-label="Edit docs-architect"]');
    await page.waitForSelector('button[aria-label="Remove docs-architect"]', { timeout: 5000 });
    await page.click('button[aria-label="Remove docs-architect"]');
    await page.click('button[aria-label="Confirm removing docs-architect"]');

    await page.waitForSelector('button[aria-label="Remove docs-architect anyway"]', { timeout: 5000 });
    const txt = await page.textContent('#v-accounts');
    /* A real count, not a scary maybe — the number is what makes the decision possible. */
    assert.match(txt, /47 job records/, 'the count must be shown, not summarised');
    assert.match(txt, /12 drafts/);
    assert.match(txt, /kept either way/i, 'and the folder must still be accounted for');
    await shot(page, 'accounts-remove-history-warning');

    await page.click('button[aria-label="Remove docs-architect anyway"]');
    await untilHit(calls, '/api/account/remove', 2);
    assert.equal(hit(calls, '/api/account/remove')[1].body.confirm, true,
                 'only the second press may carry the confirmation');

    /* Chromium logs EVERY non-2xx fetch as a console error, so the 409 this test exists to
       exercise shows up here by definition. Filtering exactly that one line keeps the real
       assertion — nothing threw, and the refusal was handled rather than crashed through —
       instead of dropping the check because a deliberate refusal made it noisy. */
    const thrown = errors.filter((e) => !/status of 409/.test(e));
    assert.deepEqual(thrown, [], 'a refusal must be an answer the screen handles, not a fault');
  } finally { await context.close(); }
});

/* ================================================================== *
 * Setup — what an install needs before it can run at all
 * ================================================================== */

test('Setup names what is missing rather than only what is present', async () => {
  const { context, page, errors } = await open();
  try {
    await tab(page, 'setup');
    const txt = await page.textContent('#v-setup');

    assert.match(txt, /Database/, 'the machine half must be reported');
    assert.match(txt, /Credentials vault/);
    assert.match(txt, /abc123def456/, 'the sealing key id identifies which key opened the vault');
    // The fixture chose the API path and stored no key — the screen must say so, not imply ready.
    assert.match(txt, /Anthropic API key/);
    assert.match(txt, /no key stored/, 'a missing key must be reported as missing');
    assert.match(txt, /not signed in/, 'an operator without a login folder must be flagged');
    assert.deepEqual(errors, [], 'Setup must render with a clean console');
  } finally { await context.close(); }
});

test('storing an API key sends it in the body and never renders it back', async () => {
  const { context, page, calls } = await open();
  const SECRET = 'sk-ant-fixture-not-a-real-key-9999';
  try {
    await tab(page, 'setup');
    await openStep(page, 'Sign in to the model');
    await page.fill('input[aria-label="Anthropic API key"]', SECRET);
    await page.click('text=Store it');
    await untilHit(calls, '/api/vault/key');

    const put = hit(calls, '/api/vault/key');
    assert.equal(put.length, 1, 'Store it must reach /api/vault/key');
    assert.equal(put[0].body.value, SECRET, 'the key travels in the POST body');

    /**
     * The key must not survive anywhere a screenshot or a support ticket could pick it up.
     * `src/commands/vault.ts` refuses to print a stored secret and offers no `get` at all;
     * a console that pasted it back into the DOM would undo that decision.
     */
    /**
     * Read the LIVE DOM, not `page.content()` and not a fresh `inputValue` lookup.
     *
     * Both of those pass whatever the code does, which was the first version of this test:
     * `page.content()` serialises HTML, and a value assigned in JS is not an attribute, so a
     * field still holding the key looks identical to a cleared one; and re-rendering the screen
     * replaces the input, so re-querying the selector always finds an empty new element. The
     * check has to walk every live input's `.value` — that is the thing a screenshot would show.
     *
     * Verified to fail when the clearing is removed, so it is a net rather than decoration.
     */
    await until(async () => await page.evaluate(
      (s) => ![...document.querySelectorAll('input')].some((i) => i.value.includes(s)), SECRET),
      'the key to be gone from every input on the page');

    const leaked = await page.evaluate((s) => ({
      inputs: [...document.querySelectorAll('input')].some((i) => i.value.includes(s)),
      text: document.body.innerText.includes(s),
      html: document.documentElement.outerHTML.includes(s)
    }), SECRET);
    assert.equal(leaked.inputs, false, 'the key must not remain in any input');
    assert.equal(leaked.text, false, 'the key must never be rendered as text');
    assert.equal(leaked.html, false, 'the key must not be written into the markup');
  } finally { await context.close(); }
});

test('choosing the Claude-login path hides the API key form entirely', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'setup');
    await openStep(page, 'Sign in to the model');
    await page.selectOption('select[aria-label="How redbot reaches the model"]', 'cli');
    await untilHit(calls, '/api/llm/provider');
    assert.equal(hit(calls, '/api/llm/provider')[0].body.provider, 'cli');
  } finally { await context.close(); }
});

/* ================================================================== *
 * Accounts
 * ================================================================== */

test('Accounts separates what is configured from what has been measured', async () => {
  const { context, page, errors } = await open();
  try {
    await tab(page, 'accounts');
    const txt = await page.textContent('#v-accounts');

    assert.match(txt, /docs-architect/);
    assert.match(txt, /sgen-support/);
    assert.match(txt, /still growing/, 'karma 1 is the warming stage');
    assert.match(txt, /2 sign-in folders on disk, 2 accounts actually measured/,
      'folders and measurements must be reported separately, never smoothed into one');
    assert.match(txt, /Under 10 karma/, 'the account Reddit filters catch must say so');
    assert.match(txt, /chrome-profile-b/);
    assert.match(txt, /missing/, 'a profile folder that is not on disk must be flagged');
    assert.match(txt, /The standing rules/);
    await shot(page, '07-accounts');
    assert.deepEqual(errors, [], 'Accounts must render with a clean console');
  } finally { await context.close(); }
});

test('the operator picker chooses who pays, and can only choose a registered one', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'accounts');
    const txt = await page.textContent('#v-accounts');
    assert.match(txt, /Model calls billed to/);
    assert.match(txt, /own login/, 'the selected operator\'s standing must be stated');

    await page.selectOption('select.opsel', 'shared-box');
    await untilHit(calls, '/api/operator/select');
    const sel = hit(calls, '/api/operator/select');
    assert.equal(sel.length, 1);
    assert.equal(sel[0].body.name, 'shared-box');
  } finally { await context.close(); }
});

test('the add-account wizard walks create then open then check', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'accounts');
    await page.fill('input[aria-label="Their Reddit username"]', 'New_Acct');
    await page.click('text=Set it up');
    await page.waitForFunction(
      () => /Ready\./.test(document.querySelector('#v-accounts')?.textContent || ''),
      null, { timeout: 6000 });

    const created = hit(calls, '/api/account/create');
    assert.equal(created.length, 1);
    assert.equal(created[0].body.handle, 'New_Acct');

    await page.click('text=Open the browser');
    await untilHit(calls, '/api/account/open');
    assert.equal(hit(calls, '/api/account/open').length, 1, 'step 2 must open that account\'s Chrome');

    await page.click('text=Check the account');
    await until(() => hit(calls, '/api/run').some((c) => c.body.key === 'check-karma'),
                'the karma probe');
    const probe = hit(calls, '/api/run').filter((c) => c.body.key === 'check-karma');
    assert.ok(probe.length >= 1, 'step 3 must probe karma');
    assert.equal(probe[0].body.account, 'New_Acct',
      'and name the account — omitting it drove the default debug port, which was the wrong browser');
  } finally { await context.close(); }
});

/* ================================================================== *
 * Today
 * ================================================================== */

test('Today plans per account against measured karma, and never invents a number', async () => {
  const { context, page, errors } = await open();
  try {
    await tab(page, 'today');
    const txt = await page.textContent('#v-today');

    assert.match(txt, /docs-architect/);
    assert.match(txt, /getting known/, 'karma 212 is stage 2');
    /* The measurement and the target it is being planned against must BOTH be on screen;
       how they are worded ("500 needed" vs "212 / 500 karma") is presentation. */
    assert.match(txt, /212/, 'the measured karma must be shown');
    assert.match(txt, /500/, 'and the target it is being planned against');
    assert.match(txt, /brand new/, 'karma 1 is stage 1');
    assert.match(txt, /Write .*comments/, 'the daily instruction must be there');
    assert.match(txt, /signed-out window/, 'the only way to see a quiet removal');
    assert.match(txt, /Never, at any point/);
    assert.match(txt, /vote manipulation/);
    assert.match(txt, /redbot cannot do this part/,
      'the tool must say plainly what it cannot count');
    await shot(page, '08-today');
    assert.deepEqual(errors, [], 'Today must render with a clean console');
  } finally { await context.close(); }
});

/**
 * The day's checklist has to be startable, not just readable.
 *
 * Every line on it was a `<div>` with a `[ ]` in front — "Write 3 comments" is the entire job of
 * the product and it was a caption. This pins the two halves of the fix: the steps redbot CAN
 * start are buttons that land on the screen that does the work, and the one it cannot start
 * honestly (checking a comment from a signed-out browser redbot does not drive) is still text.
 * A button that cannot work is worse than a sentence.
 */
test('the day\'s checklist starts the work, and lands on the screen that does it', async () => {
  const { context, page } = await open();
  try {
    await tab(page, 'today');
    await page.waitForSelector('#v-today button.todo', { timeout: 5000 });

    const write = page.locator('#v-today button.todo').filter({ hasText: /comments/i }).first();
    assert.ok(await write.isVisible(), '"Write N comments" must be a control');

    await write.click();
    await page.waitForFunction(() => !document.querySelector('#v-discovery')?.hidden,
                               null, { timeout: 5000 });
    assert.ok(await page.isHidden('#v-today'), 'it must land on Threads, not just toast');

    /* The account is chosen for the person, so Threads collects as the account whose row they
       clicked rather than as whoever was last used there. */
    const chosen = await page.evaluate(() => localStorage.getItem('redbot.collectAccount'));
    assert.equal(chosen, 'docs-architect', 'the clicked account must be the one Threads collects as');
  } finally { await context.close(); }
});

test('a step redbot cannot honestly start stays text, not a dead button', async () => {
  const { context, page } = await open();
  try {
    await tab(page, 'today');
    await page.waitForSelector('#v-today button.todo', { timeout: 5000 });

    const signedOut = page.locator('#v-today .todo').filter({ hasText: /signed-out window/i }).first();
    assert.ok(await signedOut.isVisible(), 'the signed-out check must still be on the list');
    const tag = await signedOut.evaluate((n) => n.tagName);
    assert.equal(tag, 'DIV', 'it needs a browser redbot does not drive — it must not look clickable');
  } finally { await context.close(); }
});

test('Check karma now probes the account whose card it sits on', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'today');
    await page.click('text=Check karma now >> nth=1');
    await until(() => hit(calls, '/api/run').some((c) => c.body.key === 'check-karma'),
                'the karma probe');
    const probe = hit(calls, '/api/run').filter((c) => c.body.key === 'check-karma');
    assert.ok(probe.length >= 1);
    assert.equal(probe[0].body.account, 'sgen-support',
      'the second card must probe the second account, not whichever is first');
  } finally { await context.close(); }
});

test('the unattended loop starts with an account and an interval, and never publishes', async () => {
  const { context, page, calls } = await open();
  try {
    await tab(page, 'today');
    const txt = await page.textContent('#v-today');
    assert.match(txt, /never publishes/, 'the loop must state its own limit');
    assert.match(txt, /Approving and sending stays yours/);

    await page.click('text=Start the loop');
    await untilHit(calls, '/api/auto/start');
    const started = hit(calls, '/api/auto/start');
    assert.equal(started.length, 1);
    assert.equal(started[0].body.account, 'docs-architect');
    assert.equal(started[0].body.everyMinutes, 60, 'the default interval must be carried');
  } finally { await context.close(); }
});

test('the loop shows a stop button and its tail while it is running', async () => {
  const { context, page, calls } = await open({
    pulse: makePulse(NOW, {
      auto: { running: true, account: 'docs-architect', everyMinutes: 60,
              startedAt: new Date(NOW).toISOString(),
              log: ['collecting from r/wordpress', 'scored 4 threads'] }
    })
  });
  try {
    await page.waitForFunction(
      () => /running as/.test(document.querySelector('#v-today')?.textContent || ''),
      null, { timeout: 8000 });
    const txt = await page.textContent('#v-today');
    assert.match(txt, /running as docs-architect/);
    assert.match(txt, /scored 4 threads/, 'the loop\'s own output must be visible');

    await page.click('text=Stop the loop');
    await untilHit(calls, '/api/auto/stop');
    assert.equal(hit(calls, '/api/auto/stop').length, 1);
  } finally { await context.close(); }
});

/* ================================================================== *
 * Results and the Log
 * ================================================================== */

test('Results reports an empty screen rather than a screen of zeroes', async () => {
  const { context, page, errors } = await open();
  try {
    await tab(page, 'outcomes');
    const txt = await page.textContent('#v-outcomes');
    assert.match(txt, /(nothing has been sent|no reply has been published)/i,
      'the screen must state the absence in words');
    /* `exist(s)`: the sentence now has a plural subject ("votes, replies and removals") after the
       two explanatory paragraphs here were cut to one line and the reasoning moved to the
       walkthrough. What this asserts is that the empty state still SAYS WHY it is empty rather
       than being blank — that is the property, not the conjugation. */
    assert.match(txt, /only exists? after something is sent/,
      'the empty state must explain itself, not just be blank');
    assert.match(txt, /karma/, 'what HAS been measured still shows');
    assert.match(txt, /212/);

    /**
     * All four checkpoints must be NAMED even though none has run. "The 24h reading has not
     * been taken" and "there was nothing to take it on" are different facts, and a screen
     * that simply omits the row cannot tell you which one you are looking at.
     */
    for (const cp of ['immediate', '1h', '24h', '7d']) {
      assert.match(txt, new RegExp(cp.replace('.', '\\.')), `checkpoint ${cp} must be listed`);
    }
    assert.equal((txt.match(/not run/g) || []).length, 4,
      'every checkpoint must report "not run" — the fixture has no checkpoint readings');
    assert.ok(!/\b0 votes\b|\bestimated\b|\bprojected\b/i.test(txt),
      'an unreached checkpoint must never be dressed up as a measured zero');
    await shot(page, '09-results');
    assert.deepEqual(errors, [], 'Results must render with a clean console');
  } finally { await context.close(); }
});

test('the Log screen reconstructs the run from the server, and lists past runs', async () => {
  const { context, page, errors } = await open();
  try {
    await tab(page, 'logs');
    await page.waitForFunction(
      () => /karma 212/.test(document.querySelector('#logStream')?.textContent || ''),
      null, { timeout: 8000 });

    assert.match(await page.textContent('#logCmd'), /redbot probe-karma/,
      'the log must name the command that produced it');
    assert.match(await page.textContent('#logMeta'), /finished · exit 0/);
    assert.match(await page.textContent('#logStream'), /attaching to chrome-profile-a/);

    /* Past runs are reachable, and an interrupted one is labelled as such. */
    const opts = await page.$$eval('#logPick option', (n) => n.map((o) => o.textContent));
    assert.match(opts[0], /Live \/ most recent/, 'the useful default stays first');
    assert.ok(opts.some((o) => /interrupted/.test(o)),
      'a run with no footer must be listed as interrupted, not as complete');
    assert.match(await page.textContent('#logCap'), /2 kept \(newest 500\)/);

    await shot(page, '10-logs');
    assert.deepEqual(errors, [], 'the Log must render with a clean console');
  } finally { await context.close(); }
});

test('a run already in flight is picked up on load and followed', async () => {
  const { context, page } = await open({
    runLog: { ...RUN_LOG_IDLE, running: true, done: false, code: null }
  });
  try {
    /* The buffer lives on the server, so a reload must re-attach rather than show an idle
       console — which reads as "it stopped". */
    await page.waitForFunction(() => !document.querySelector('#v-logs')?.hidden,
                               null, { timeout: 8000 });
    assert.equal(await page.textContent('#nLog'), '●', 'the bar must mark a live run');
  } finally { await context.close(); }
});

/* ================================================================== *
 * Responsive — the sweep that caught two shipped defects
 * ================================================================== */

const WIDTHS = [
  { w: 1920, h: 1080, name: '1920' },
  { w: 1280, h: 900, name: '1280' },
  { w: 768, h: 1024, name: '768' },
  { w: 390, h: 844, name: '390' }
];

for (const { w, h, name } of WIDTHS) {
  test(`nothing overflows sideways at ${name}px, on any screen`, async () => {
    const { context, page } = await open({ viewport: { width: w, height: h } });
    try {
      for (const v of ['today', 'accounts', 'review', 'discovery', 'outcomes', 'logs']) {
        await tab(page, v);
        const over = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 1, `${v} at ${name}px overflows by ${over}px`);
        await shot(page, `resp-${name}-${v}`);
      }
    } finally { await context.close(); }
  });
}

/**
 * The document-level sweep above cannot see this class of defect, and shipped past it.
 *
 * `body > section.sheet` is `overflow-y:auto`, and CSS computes the OTHER axis to `auto` too
 * when one axis is non-visible. So a child wider than the phone did not grow the document —
 * it scrolled inside the pane, `documentElement.scrollWidth` stayed exactly the viewport
 * width, and every assertion above passed while half the Accounts screen sat off the right
 * edge of a 390px phone.
 *
 * Measured on the shipped CSS at a 360px viewport: `.grid2` was 312px wide while its computed
 * `grid-template-columns` read `1080px`, and `.cards` rendered 1080px wide with its right edge
 * at x=1104 — while `documentElement.scrollWidth` sat at exactly 360.
 *
 * Cause, confirmed by re-arming that one declaration at runtime and watching the overflow come
 * back (0px -> 94px at 390px): the `@media (max-width:1200px)` collapse used
 * `grid-template-columns:1fr`, whose track minimum is `auto` — so the track could not shrink
 * below its content's min-content width. `minmax(0,1fr)` gives it a real zero floor.
 *
 * Asserted on the SECTION, not the document, so the next person to add a wide child inside a
 * scrolling pane hears about it.
 */
for (const { w, h, name } of [{ w: 390, h: 844, name: '390' }, { w: 768, h: 1024, name: '768' }]) {
  test(`no screen scrolls sideways inside its own pane at ${name}px`, async () => {
    const { context, page } = await open({ viewport: { width: w, height: h } });
    try {
      for (const v of ['today', 'accounts', 'review', 'discovery', 'outcomes', 'logs']) {
        await tab(page, v);
        const over = await page.evaluate(() => {
          const sec = [...document.querySelectorAll('body > section')].find((s) => !s.hidden);
          if (!sec) return { id: null, over: 0 };
          return { id: sec.id, over: sec.scrollWidth - sec.clientWidth };
        });
        assert.ok(over.over <= 1,
          `${v} at ${name}px: ${over.id} scrolls sideways by ${over.over}px inside its own pane`);
      }
    } finally { await context.close(); }
  });
}

test('the Threads table is not collapsed to a hairline on a wide screen', async () => {
  /**
   * The shipped defect this pins: `body > section` is a bounded column flex container, and a
   * scroll container's automatic minimum size is 0 — so the table's wrapper was squeezed to
   * 2px tall while rendering at its full width inside. The data was all there and clipped to
   * a hairline, which looked exactly like "no threads collected" under a heading reporting 48.
   *
   * Only reproducible at >= 1200px: below that a media query switches to display:block.
   */
  const { context, page } = await open({ viewport: { width: 1900, height: 1000 } });
  try {
    await tab(page, 'discovery');
    const height = await page.evaluate(() => {
      const t = document.querySelector('#v-discovery table');
      return t ? t.closest('div').getBoundingClientRect().height : -1;
    });
    assert.ok(height > 100, `the table's box collapsed to ${height}px — the hairline defect is back`);
  } finally { await context.close(); }
});

test('no caption drops below the readability floor on a phone', async () => {
  /**
   * Measured 2026-07-24: 22 elements rendered between 10.08px and 10.96px at phone widths —
   * the uppercase mono captions that say what the number above them MEANS. The fix must be
   * carried through any restyle, so it is asserted rather than trusted.
   */
  const { context, page } = await open({ viewport: { width: 390, height: 844 } });
  try {
    const offenders = [];
    for (const v of ['today', 'accounts', 'review', 'discovery', 'outcomes']) {
      await tab(page, v);
      const small = await page.evaluate(() => {
        const out = [];
        for (const n of document.querySelectorAll('body *')) {
          if (n.offsetParent === null && n !== document.body) continue;
          const direct = [...n.childNodes]
            .filter((c) => c.nodeType === 3 && c.textContent.trim())
            .map((c) => c.textContent.trim()).join(' ');
          if (!direct) continue;
          const px = parseFloat(getComputedStyle(n).fontSize);
          if (px < 11) out.push({ px: Math.round(px * 100) / 100, text: direct.slice(0, 40) });
        }
        return out;
      });
      for (const s of small) offenders.push(`${v}: ${s.px}px "${s.text}"`);
    }
    assert.deepEqual(offenders, [],
      `text below the 11px floor on a phone:\n  ${offenders.join('\n  ')}`);
  } finally { await context.close(); }
});

test('light theme renders every screen without a console error', async () => {
  const { context, page, errors } = await open({ theme: 'light' });
  try {
    for (const v of ['today', 'accounts', 'review', 'discovery', 'outcomes', 'logs']) {
      await tab(page, v);
      await shot(page, `light-${v}`);
    }
    assert.deepEqual(errors, [], 'the light theme must render as cleanly as the dark one');
  } finally { await context.close(); }
});
