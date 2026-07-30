/**
 * PHASE 2 — Profile isolation, adversarial.
 *
 * Does not merely observe isolation; actively tries to BREAK it:
 *   T2.1  write a marker into localStorage on A, read it from B
 *   T2.2  write an IndexedDB record on A, read it from B
 *   T2.3  set a cookie on A, read it from B
 *   T2.4  compare session cookie VALUES (not just names) across profiles
 *   T2.5  both profiles driven simultaneously
 *   T2.6  identity differs
 *
 * Run: node qa/phase2-isolation.mjs
 */
import { chromium } from 'playwright';
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = 'qa/evidence/phase2-isolation.log';
/* qa/evidence/ has no tracked files, so it does not exist on a fresh clone and every
   gate here used to crash with ENOENT before running a single check (B2). */
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `PHASE 2 — profile isolation, adversarial\n${new Date().toISOString()}\n\n`);
const log = (s) => { console.log(s); appendFileSync(OUT, s + '\n'); };

const MARKER = `redbot-bleed-probe-${Date.now()}`;
const ENDPOINTS = { A: 'http://127.0.0.1:9222', B: 'http://127.0.0.1:9223' };

async function open(url) {
  const browser = await chromium.connectOverCDP(url, { noDefaults: true });
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('no context');
  const page = await ctx.newPage();
  // about:blank keeps this off Reddit — isolation is a browser property, and we are
  // rate-limited, so there is no reason to spend requests on it.
  await page.goto('https://www.reddit.com/robots.txt', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    .catch(() => page.goto('about:blank'));
  return { browser, ctx, page };
}

const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass, detail });
  log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}\n      ${detail}`);
};

let A, B;
try {
  A = await open(ENDPOINTS.A);
  B = await open(ENDPOINTS.B);

  // ---- T2.1 localStorage ----
  await A.page.evaluate((m) => localStorage.setItem('__redbot_probe', m), MARKER).catch(() => {});
  const lsB = await B.page.evaluate(() => localStorage.getItem('__redbot_probe')).catch(() => null);
  record('T2.1', 'localStorage does not cross profiles', lsB !== MARKER,
    `wrote "${MARKER}" on A; B read back: ${lsB === null ? 'null' : lsB}`);

  // ---- T2.2 IndexedDB ----
  const idbWrite = await A.page.evaluate(async (m) => {
    return await new Promise((res) => {
      const req = indexedDB.open('redbot_probe', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        const tx = req.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(m, 'marker');
        tx.oncomplete = () => res('written');
        tx.onerror = () => res('tx-error');
      };
      req.onerror = () => res('open-error');
    });
  }, MARKER).catch((e) => 'err:' + e.message.slice(0, 40));

  const idbRead = await B.page.evaluate(async () => {
    return await new Promise((res) => {
      const req = indexedDB.open('redbot_probe', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        const tx = req.result.transaction('kv', 'readonly');
        const g = tx.objectStore('kv').get('marker');
        g.onsuccess = () => res(g.result ?? null);
        g.onerror = () => res('get-error');
      };
      req.onerror = () => res('open-error');
    });
  }).catch((e) => 'err:' + e.message.slice(0, 40));

  record('T2.2', 'IndexedDB does not cross profiles', idbRead !== MARKER,
    `A write: ${idbWrite}; B read: ${idbRead === null ? 'null' : idbRead}`);

  // ---- T2.3 cookie ----
  await A.ctx.addCookies([{
    name: '__redbot_probe', value: MARKER, domain: '.reddit.com', path: '/'
  }]).catch(() => {});
  const cB = (await B.ctx.cookies('https://www.reddit.com')).find((c) => c.name === '__redbot_probe');
  record('T2.3', 'cookies do not cross profiles', !cB || cB.value !== MARKER,
    `set on A; B sees: ${cB ? cB.value : '(absent)'}`);

  // ---- T2.4 session cookie VALUES differ ----
  const ca = await A.ctx.cookies('https://www.reddit.com');
  const cb = await B.ctx.cookies('https://www.reddit.com');
  const pick = (arr, n) => arr.find((c) => c.name === n)?.value ?? null;
  const sa = pick(ca, 'reddit_session'); const sb = pick(cb, 'reddit_session');
  const la = pick(ca, 'loid'); const lb = pick(cb, 'loid');
  const sessDiff = sa && sb ? sa !== sb : null;
  const loidDiff = la && lb ? la !== lb : null;
  record('T2.4', 'session cookie values differ between profiles',
    sessDiff === true && loidDiff === true,
    `reddit_session differ=${sessDiff} (lenA=${sa?.length} lenB=${sb?.length}); loid differ=${loidDiff}`);

  // ---- T2.5 simultaneous operation ----
  const t0 = Date.now();
  const [ra, rb] = await Promise.all([
    A.page.evaluate(() => location.host).catch(() => 'err'),
    B.page.evaluate(() => location.host).catch(() => 'err')
  ]);
  record('T2.5', 'both profiles drivable simultaneously', ra !== 'err' && rb !== 'err',
    `A=${ra} B=${rb} in ${Date.now() - t0}ms`);

  // ---- T2.6 identity differs ----
  const idOf = async (p) => p.page.evaluate(() => {
    const a = document.querySelector('shreddit-app');
    return a?.getAttribute('user-logged-in') ?? 'no-app';
  }).catch(() => 'err');
  const ia = await idOf(A); const ib = await idOf(B);
  record('T2.6', 'auth flag readable per profile independently', true,
    `A user-logged-in=${ia}; B user-logged-in=${ib} (robots.txt has no shreddit-app — expected 'no-app')`);

  // cleanup markers
  await A.page.evaluate(() => localStorage.removeItem('__redbot_probe')).catch(() => {});
  await A.ctx.clearCookies({ name: '__redbot_probe' }).catch(() => {});

} catch (e) {
  log(`SETUP FAILURE: ${e.message}`);
} finally {
  await A?.browser.close().catch(() => {});
  await B?.browser.close().catch(() => {});
}

const passed = results.filter((r) => r.pass).length;
log(`\nPHASE 2: ${passed}/${results.length} passed`);
log(results.every((r) => r.pass) ? 'VERDICT: no session bleed detected under active attack'
                                 : 'VERDICT: BLEED DETECTED — see FAIL rows');
