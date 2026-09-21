/**
 * `alignBrowser` against a REAL browser — the half proxy-align.test.ts says it does not cover.
 *
 * That file opens by saying `alignBrowser` "needs a real Chrome and is proven by a run", and the
 * run was never written down. Measured on d381154 with the function instrumented: across all
 * 1202 tests, ENTER-alignBrowser fired 0 times, the every-tab loop 0 times, the gate 0 times.
 * The one place that LOOKS like coverage is tools/product/browser-start-open.test.mjs, which
 * injects `cover: async () => ({ pagesAligned: 3 })` — a stub that hands back the very number
 * this file exists to measure.
 *
 * Two properties were therefore held by nothing, and both were resolved by hand out of a merge
 * conflict, which is the worst provenance a line can have:
 *
 *   EVERY TAB   `cover` runs over every page in `context.pages()`, not only `[0]`. Reverting it
 *               to `[0]` left the whole suite green.
 *   THE GATE    `coverageRefusal` is evaluated BEFORE the navigation and throws. Neutering it to
 *               `if (refusal && pagesAligned < 0)` left the whole suite green.
 *
 * ---------------------------------------------------------------------------
 * WHY A REAL CHROME, AND NOT A FAKE ENDPOINT
 *
 * Nothing smaller can answer the question. `Emulation.setTimezoneOverride` is a CDP call against
 * a renderer, and what has to be proven is what the renderer then REPORTS. A fake endpoint can
 * only show that the call was issued — which is exactly what the injected stub already shows, and
 * exactly why the seam stayed open. So: a throwaway Chrome on a throwaway profile, and the pages
 * are asked what time it is where they are.
 *
 * HEADLESS IS SAFE HERE AND IS NOT SAFE ELSEWHERE, so the difference is worth stating rather than
 * leaving as a surprise. src/browser.ts refuses a headless user-agent and doctor calls it a FAIL,
 * because Reddit answers a headless browser with a block page served as HTTP 200. That rule is
 * about REDDIT and it lives in `attach()`. Nothing in this file goes near reddit.com: every URL
 * it uses is served by a local http server it starts itself, which is also the reason no test
 * here can put an account in front of Reddit by accident. What is measured — which pages got the
 * override, and whether the gate fired before the navigation — is a property of the CDP call and
 * of a `for` loop, and is the same in both modes.
 *
 * WHY THE BROWSER IS STARTED IN Asia/Manila. This machine's own zone is America/Los_Angeles, and
 * so is the zone a lookup returns for it — so a probe that read America/Los_Angeles back could
 * not tell "the override was applied" from "the override did nothing", which is a dead instrument
 * reporting good news. The browser is therefore started in a zone the host is not in, and covered
 * into a third one. A page answering Asia/Manila was not covered, and there is no second reading.
 *
 * WHY THE PAGES ARE IDENTIFIED BY WHAT THEY ANSWER AND NEVER BY INDEX. `context.pages()` came
 * back in the order two, three, one on a browser whose tabs were created one, two, three — it is
 * neither creation order nor `/json/list` order. Which tab `alignBrowser` treats as `first` is
 * therefore not knowable from here, so every assertion below is over ALL the pages.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { Browser } from 'playwright';

const { alignBrowser, AlignmentError, stopAllAlignments } = await import('../proxy/align.js');
const { chromeCandidates } = await import('../dependencies.js');

/* The product's OWN rule for where Chrome is, honouring REDBOT_CHROME and CHROME_PATH. A second
   list here would be a second rule, and the two would disagree on somebody's machine. */
const CHROME = chromeCandidates(process.env).find((p) => existsSync(p)) ?? null;

/**
 * A machine with no Chrome skips, loudly, and says so in the run.
 *
 * It is stated rather than quietly passed because a skip proves nothing and this file's whole
 * subject is a test that was invisible. On a machine that HAS Chrome — which is every machine
 * redbot runs on, since dependencies.ts reports its absence as a blocker — these run.
 */
const NO_CHROME: string | false = CHROME
  ? false
  : 'no Chrome was found (see chromeCandidates in src/dependencies.ts), so the real-browser'
    + ' properties of alignBrowser cannot be measured on this machine';

/** Where the test browser is told it lives — deliberately not this machine's zone. */
const HOST_ZONE = 'Asia/Manila';
/** What alignBrowser is asked to cover it with — deliberately neither of the other two. */
const COVER_ZONE = 'America/New_York';
/**
 * A zone id Chrome will not accept, which is how a REFUSAL is produced on demand.
 *
 * `Emulation.setTimezoneOverride` answers an unknown id with `Protocol error ... Invalid timezone
 * id`, so `cover` throws, `coverOutcome` finds the page still open and answers `refused`, and
 * nothing is counted. That is the same path any other refusal takes — the cause is manufactured,
 * the branch is the production one.
 */
const UNUSABLE_ZONE = 'Nowhere/Fictional';

const TAB_ONE = '/tab-one';
const TAB_TWO = '/tab-two';
const TAB_THREE = '/tab-three';
/** Where the covered browser is sent. Local, because a launch control must never reach Reddit. */
const LANDED = '/landed';
/** Where a REFUSED browser must never be sent. Local for the same reason, and never requested. */
const FORBIDDEN = '/must-not-land';

let chrome: ChildProcess | null = null;
let profileDir = '';
let endpoint = '';
let origin = '';
let httpServer: Server | null = null;
/** Every path the local origin was asked for, in order. The record both tests read. */
const served: string[] = [];

const asked = (path: string): number => served.filter((u) => u === path).length;

async function waitUntil(
  what: string, ok: () => Promise<boolean> | boolean, ms = 30_000
): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    if (await ok()) return;
    if (Date.now() > until) throw new Error(`${what} did not happen within ${ms}ms`);
    await new Promise((r) => setTimeout(r, 125));
  }
}

/**
 * What every page in that browser currently answers — asked over a SECOND CDP connection.
 *
 * Deliberately not through the connection `alignBrowser` holds: a reading taken through the same
 * client that applied the override would not distinguish an override the renderer accepted from
 * one only this process believes in. Both questions are answered in the page's own JavaScript.
 */
async function everyPageAnswers(): Promise<{ url: string; zone: string; rtc: string }[]> {
  const { chromium } = await import('playwright');
  const probe: Browser = await chromium.connectOverCDP(endpoint, { timeout: 30_000 });
  try {
    const ctx = probe.contexts()[0];
    if (!ctx) return [];
    const out: { url: string; zone: string; rtc: string }[] = [];
    for (const p of ctx.pages()) {
      out.push({
        url: p.url(),
        zone: await p.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
        /* The fence is applied by `cover` itself, page by page, so its presence in an ALREADY
           LOADED document is a second signature of that page having been covered — and one that
           does not go through CDP at all. `context.addInitScript` cannot account for it: that
           runs on new documents, and these three were loaded before redbot attached. */
        rtc: await p.evaluate(() => {
          try { new RTCPeerConnection(); return 'NOT FENCED'; } catch (e) { return (e as Error).name; }
        })
      });
    }
    return out;
  } finally {
    await probe.close().catch(() => {});
  }
}

before(async () => {
  if (!CHROME) return;

  profileDir = mkdtempSync(join(tmpdir(), 'redbot-align-test-'));

  httpServer = createServer((req, res) => {
    served.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>${req.url}</title><body>${req.url}`);
  });
  await new Promise<void>((r) => httpServer!.listen(0, '127.0.0.1', () => r()));
  const addr = httpServer!.address();
  const localPort = typeof addr === 'object' && addr ? addr.port : 0;
  assert.ok(localPort > 0, 'the local origin did not get a port');
  origin = `http://127.0.0.1:${localPort}`;

  /* --remote-debugging-port=0 and then READ which port it took, rather than picking a number.
     Several agents share this machine and a fixed port is how two of them end up driving one
     browser. Chrome writes the real one to DevToolsActivePort in the profile it was given. */
  chrome = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    `${origin}${TAB_ONE}`
  ], { env: { ...process.env, TZ: HOST_ZONE }, detached: true, stdio: 'ignore' });
  chrome.unref();

  const portFile = join(profileDir, 'DevToolsActivePort');
  let port = 0;
  await waitUntil('the test browser announced its debugging port', () => {
    try {
      const first = readFileSync(portFile, 'utf8').split(String.fromCharCode(10))[0]?.trim();
      if (first && Number(first) > 0) { port = Number(first); return true; }
    } catch { /* not written yet */ }
    return false;
  });
  endpoint = `http://127.0.0.1:${port}`;
  await waitUntil('the test browser answered on its debugging port', async () => {
    try { return (await fetch(`${endpoint}/json/version`)).ok; } catch { return false; }
  });

  /* TWO MORE TABS, opened the way a person's browser already has several. This is the whole
     difference the every-tab property is about: on a browser redbot spawned there is exactly one
     page, and `[0]` and "all of them" are the same set. */
  for (const path of [TAB_TWO, TAB_THREE]) {
    const made = await fetch(`${endpoint}/json/new?${origin}${path}`, { method: 'PUT' });
    assert.ok(made.ok, `the test browser refused to open ${path}: HTTP ${made.status}`);
  }

  /* All three present AND loaded before anything is measured — a page still in flight would make
     "only one tab was covered" and "the other two had not arrived yet" the same observation. */
  await waitUntil('all three tabs opened', async () => {
    const list = await (await fetch(`${endpoint}/json/list`)).json() as { type: string }[];
    return list.filter((t) => t.type === 'page').length === 3;
  });
  await waitUntil('all three tabs loaded from the local origin',
    () => asked(TAB_ONE) >= 1 && asked(TAB_TWO) >= 1 && asked(TAB_THREE) >= 1);
}, { timeout: 120_000 });

after(async () => {
  await stopAllAlignments().catch(() => {});
  if (chrome && typeof chrome.pid === 'number') {
    try { process.kill(chrome.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  if (httpServer) await new Promise<void>((r) => httpServer!.close(() => r()));
  if (profileDir) rmSync(profileDir, { recursive: true, force: true });
}, { timeout: 30_000 });

/* ------------------------------------------------------------------ *
 * EVERY TAB, not only the first
 * ------------------------------------------------------------------ */

test('every tab that was already open is covered, not only the first', { skip: NO_CHROME }, async () => {
  const landedBefore = asked(LANDED);

  const aligned = await alignBrowser({
    endpoint,
    handle: 'Align_EveryTab',
    timezone: COVER_ZONE,
    locale: 'en-US',
    openUrl: `${origin}${LANDED}`,
    connectTimeoutMs: 30_000
  });

  assert.equal(aligned.pagesAligned, 3,
    `three tabs were open before redbot attached and ${aligned.pagesAligned} were covered. `
    + 'Covering only context.pages()[0] leaves the rest announcing the host machine\'s clock, '
    + 'which is the contradiction between clock and address this module exists to remove.');

  const answers = await everyPageAnswers();
  assert.equal(answers.length, 3, 'the browser should still have its three tabs');
  for (const page of answers) {
    assert.equal(page.zone, COVER_ZONE,
      `${page.url} answers ${page.zone}. The browser was started in ${HOST_ZONE}, so a tab still `
      + 'saying that is a tab the override never reached.');
    assert.equal(page.rtc, 'NotAllowedError',
      `${page.url} still constructs an RTCPeerConnection, so the fence never reached it either — `
      + 'a page that was not covered leaks a public address the proxy never carried.');
  }

  /* AND THE NAVIGATION DID HAPPEN. This assertion is also the live control for the gate test
     below: that one proves a path was never requested, and "never requested" and "this server
     records nothing" are the same observation unless something here is recorded. */
  assert.equal(asked(LANDED), landedBefore + 1,
    'a covered browser is sent where it was told to go, exactly once');
});

/* ------------------------------------------------------------------ *
 * THE GATE, and that it sits BEFORE the navigation
 * ------------------------------------------------------------------ */

test('a browser that could not be covered is refused BEFORE it is navigated', { skip: NO_CHROME }, async () => {
  const thrown = await alignBrowser({
    endpoint,
    handle: 'Align_Gate',
    timezone: UNUSABLE_ZONE,
    locale: null,
    openUrl: `${origin}${FORBIDDEN}`,
    connectTimeoutMs: 30_000
  }).then(() => null, (e: unknown) => e);

  assert.ok(thrown instanceof AlignmentError,
    'a browser whose pages all refused the timezone override must not be handed back as usable; '
    + `alignBrowser returned ${thrown === null ? 'an AlignedBrowser' : String(thrown)}`);
  assert.match((thrown as Error).message, /refused the timezone override/,
    'the refusal names WHICH failure it was — a page that shut mid-flight reads differently, and '
    + 'telling somebody their browser refused when the tab merely closed sends them hunting a '
    + 'fault that is not there');

  /* THE ORDER, WHICH IS THE POINT. A gate that fires after the navigation has already let an
     uncovered browser arrive, and Reddit fixes an account to the identity it first appears from.
     The preceding test proves this same server does record a landing when one happens. */
  assert.equal(asked(FORBIDDEN), 0,
    `the refused browser was navigated to ${FORBIDDEN} anyway — the gate must be evaluated before `
    + 'the goto, not after it');

  const urls = (await everyPageAnswers()).map((p) => p.url);
  assert.ok(!urls.some((u) => u.endsWith(FORBIDDEN)),
    `a tab ended up on ${FORBIDDEN}: ${urls.join(', ')}`);
});
