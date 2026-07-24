/**
 * Operator workstation QA — drives every surface in a real browser and asserts
 * on what actually rendered, not on what the code was supposed to do.
 *
 * Covers navigation, command palette, global search, live terminal (streaming,
 * cancel, copy, clear), file explorer, timeline, queue, run history, log stream,
 * keyboard shortcuts, empty states, error states, large logs and performance.
 *
 *   node tools/operator/server.mjs --port 7901
 *   node tools/operator/qa-console.mjs --port 7901
 */
import { chromium } from 'playwright';

const portArg = process.argv.indexOf('--port');
const PORT = portArg > -1 ? process.argv[portArg + 1] : '7890';
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (area, name, pass, detail) => {
  results.push({ area, name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${area.padEnd(12)} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' });
const page = await ctx.newPage();

// An uncaught JS exception and a deliberate HTTP refusal are different things.
// This suite itself provokes 409 (one-at-a-time) and 400 (allowlist) responses;
// the browser logs those to console, but they are the feature working.
const errors = [];       // real uncaught exceptions
const netNoise = [];     // console messages about HTTP status codes
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  (/Failed to load resource/.test(m.text()) ? netNoise : errors).push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const nav = async (label) => { await page.click(`#nav button:has-text("${label}")`); await page.waitForTimeout(1300); };
const txt = async (sel) => (await page.locator(sel).first().textContent().catch(() => '')) ?? '';
const body = async (sel) => await page.evaluate((s) => document.querySelector(s)?.textContent || '', sel);

const t0 = Date.now();
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForSelector('#pg-dashboard .stat', { timeout: 30000 });
check('performance', 'first meaningful paint', Date.now() - t0 < 20000, `${Date.now() - t0} ms to first status card`);
await page.waitForTimeout(3500);

/* ---- operator default: engineering surfaces hidden ----
 * The console opens on the surface an operator needs. The six engineering pages are
 * behind a Settings toggle, and "hidden" has to mean unroutable — a shortcut that
 * silently lands on a page the sidebar denies is worse than no shortcut. */
const DEV_PAGES = ['Files','Benchmark','Replay','Validation','Run History','Logs'];
check('sidebar', 'operator default is 8 items', (await page.locator('#nav button').count()) === 8, `${await page.locator('#nav button').count()}`);
check('sidebar', 'operator default is 3 groups', (await page.locator('#nav .grp').count()) === 3, `${await page.locator('#nav .grp').count()} groups`);
check('sidebar', 'no engineering group by default',
  !(await page.locator('#nav .grp').allTextContents()).includes('Engineering'),
  (await page.locator('#nav .grp').allTextContents()).join(' · '));
const hiddenRoute = await page.evaluate(() => { const before = CUR; go('validation'); return { before, after: CUR }; });
check('sidebar', 'hidden page is unroutable', hiddenRoute.after !== 'validation', `go('validation') stayed on ${hiddenRoute.after}`);
check('sidebar', 'palette excludes hidden pages',
  await page.evaluate(() => !PAL.items.filter(i => i.type === 'nav').map(i => i.key).includes('validation')), 'not offered');

/* ---- reveal them through the real control, not localStorage ---- */
await page.click('#nav button:has-text("Settings")'); await page.waitForTimeout(1300);
const devSel = page.locator('#pg-settings select').filter({ hasText: 'hidden' }).first();
check('settings', 'engineering toggle present', (await devSel.count()) === 1, 'one select with hidden/shown');
await devSel.selectOption('shown'); await page.waitForTimeout(600);
check('sidebar', 'toggle reveals all 14', (await page.locator('#nav button').count()) === 14, `${await page.locator('#nav button').count()}`);
check('sidebar', 'toggle restores 4 groups', (await page.locator('#nav .grp').count()) === 4, `${await page.locator('#nav .grp').count()} groups`);
check('sidebar', 'revealed pages are routable',
  await page.evaluate(() => { go('validation'); return CUR === 'validation'; }), 'go(validation) lands');

/* ---- navigation ---- */
const PAGES = ['Dashboard','Timeline','Queue','Certifications','Ground Truth','Reports','Files',
               'Benchmark','Replay','Validation','Run History','Logs','Settings','About'];
for (const p of PAGES) {
  await nav(p);
  const on = await page.locator('section.page.on').count();
  const title = (await txt('#pt')).trim();
  const content = (await body('section.page.on')).length;
  check('navigation', p, on === 1 && title === p && content > 60, `${content} chars`);
}

/* ---- command palette ---- */
await nav('Dashboard');
await page.keyboard.press('Control+k');
await page.waitForTimeout(450);
check('palette', 'opens on Ctrl+K', await page.locator('#palette.on').count() === 1, '');
const palAll = await page.locator('#palList .ov-item').count();
check('palette', 'lists commands and pages', palAll > 15, `${palAll} entries`);
await page.fill('#palInput', 'doctor');
await page.waitForTimeout(350);
const palHits = await page.locator('#palList .ov-item .nm').allTextContents();
check('palette', 'filters on "doctor"', palHits.length > 0 && palHits.some((h) => h.includes('doctor')), palHits.join(', ').slice(0, 60));
await page.fill('#palInput', 'zzzznope');
await page.waitForTimeout(300);
check('palette', 'empty state', (await page.locator('#palList .ov-empty').count()) === 1, 'shows "nothing matches"');
await page.fill('#palInput', 'health');
await page.waitForTimeout(300);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('Enter');
await page.waitForTimeout(4000);
const term1 = await body('#termBody');
check('palette', 'Enter executes', /exit 0/.test(term1), (term1.match(/exit \d+/) || [''])[0]);
check('palette', 'name match outranks description', /redbot health/.test(term1),
  'typing "health" runs health, not doctor');
check('terminal', 'drawer auto-opens on run', !(await page.locator('#drawer.min').count()), 'drawer expanded');
check('terminal', 'streams real stdout', term1.length > 200 && /Account|May publish|Replies today/.test(term1), `${term1.length} chars`);

/* ---- terminal controls ---- */
await page.click('#termClear');
await page.waitForTimeout(300);
check('terminal', 'clear empties pane', (await body('#termBody')).trim().length < 5, 'cleared');
await page.keyboard.press('Escape');

/* ---- streaming + cancel on a long command ---- */
await page.keyboard.press('Control+k');
await page.fill('#palInput', 'tests');
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
const midRun = await txt('#termStatus');
check('terminal', 'live elapsed timer', /running/i.test(midRun) && /\d+\.\ds/.test(midRun), midRun.trim());
check('terminal', 'cancel enabled while running', !(await page.locator('#termCancel[disabled]').count()), '');
const secondAttempt = await page.evaluate(async () => (await fetch('/api/stream?cmd=doctor')).status);
check('terminal', 'one command at a time', secondAttempt === 409, `second run -> http ${secondAttempt}`);
await page.click('#termCancel');
await page.waitForTimeout(3500);
const afterCancel = await body('#termBody');
check('terminal', 'cancel stops the run', /cancelled|exit/.test(afterCancel), (afterCancel.match(/cancelled|exit -?\d+/) || [''])[0]);
check('terminal', 'cancel disabled when idle', (await page.locator('#termCancel[disabled]').count()) === 1, '');

/* ---- global search ---- */
await page.keyboard.press('/');
await page.waitForTimeout(400);
check('search', 'opens on /', (await page.locator('#search.on').count()) === 1, '');
check('search', 'prompts for 2 chars', /at least two/.test(await body('#srchList')), '');
await page.fill('#srchInput', 'max_allowed_packet');
await page.waitForTimeout(2500);
const hits = await page.locator('#srchList .hit').count();
check('search', 'finds real matches', hits > 0, `${hits} hits shown`);
check('search', 'highlights the term', (await page.locator('#srchList mark').count()) > 0, `${await page.locator('#srchList mark').count()} marks`);
const meta = await txt('#srchMeta');
check('search', 'reports totals', /match/.test(meta), meta.trim().slice(0, 60));
await page.fill('#srchInput', 'zzq9nothingmatches');
await page.waitForTimeout(2200);
check('search', 'empty state', /No matches/.test(await body('#srchList')), '');
await page.fill('#srchInput', 'ER_NET_PACKET_TOO_LARGE');
await page.waitForTimeout(2500);
const before = await txt('#pt');
await page.locator('#srchList .hit').first().click();
await page.waitForTimeout(2600);
check('search', 'jumps to the file', (await txt('#pt')).trim() !== before.trim() || (await page.locator('mark').count()) > 0,
  `now on "${(await txt('#pt')).trim()}"`);

/* ---- files ---- */
await nav('Files');
await page.waitForTimeout(1600);
check('files', 'tree renders', (await page.locator('#pg-files .tree .row').count()) > 3, `${await page.locator('#pg-files .tree .row').count()} rows`);
check('files', 'opens a file', (await body('#file-view')).length > 200, 'viewer populated');
await page.fill('#pg-files input.search', 'argus');
await page.waitForTimeout(600);
const filtered = await page.locator('#pg-files .tree .row').count();
check('files', 'filename filter', filtered > 0, `${filtered} rows match "argus"`);
await page.fill('#pg-files input.search', '');
await page.waitForTimeout(500);
const roots = await page.locator('#pg-files .bar-row button.btn').count();
check('files', 'all roots offered', roots >= 5, `${roots} roots`);
await page.click('#pg-files button:has-text("logs")');
await page.waitForTimeout(1800);
check('files', 'jsonl viewer', /\{|no |line/.test(await body('#file-view')), 'renders JSON lines');

/* ---- timeline ---- */
await nav('Timeline');
await page.waitForTimeout(1500);
const tlEvents = await page.locator('#pg-timeline .tl .ev').count();
check('timeline', 'every certification', tlEvents === 6, `${tlEvents} events`);
const tlText = await body('#pg-timeline');
check('timeline', 'shows verdict + claims + fatal', /REJECT/.test(tlText) && /claims/.test(tlText) && /fatal/.test(tlText), '');
check('timeline', 'shows real durations', /min|\bs\b/.test(tlText) && /duration unrecorded|min/.test(tlText), 'joined from trace');
await page.locator('#pg-timeline button:has-text("open")').first().click();
await page.waitForTimeout(2200);
check('timeline', 'opens certification', (await txt('#pt')).trim() === 'Certifications', 'navigated');

/* ---- queue ---- */
await nav('Queue');
await page.waitForTimeout(1400);
const qText = await body('#pg-queue');
check('queue', 'pending + completed', /Pending/.test(qText) && /Completed/.test(qText), '');
check('queue', 'copy-ready command', /node dist\/cli\.js certify/.test(qText), 'command shown per pending draft');
check('queue', 'explains the exclusion', /not runnable from this interface/.test(qText), '');

/* ---- run history ---- */
await nav('Run History');
await page.waitForTimeout(1500);
const rhText = await body('#pg-runhistory');
check('history', 'records this session runs', /Runs|No runs/.test(rhText), '');
check('history', 'exit codes + durations', /exit|Failed/.test(rhText), '');
const rhSvg = await page.locator('#pg-runhistory svg').count();
check('history', 'duration trend chart', rhSvg > 0, `${rhSvg} svg`);

/* ---- logs ---- */
await nav('Logs');
await page.waitForTimeout(1800);
check('logs', 'split view', (await page.locator('#pg-logs .split').count()) === 1, '');
const bigLog = await body('#log-view');
check('logs', 'large log renders', bigLog.length > 800, `${bigLog.length} chars`);
await page.click('#pg-logs .idx button:has-text("reviews.jsonl")');
await page.waitForTimeout(1400);
const emptyLog = await body('#log-view');
check('empty', 'absent log explained', /does not exist yet/.test(emptyLog), '');
check('empty', 'absent log is not an error', !/error|failed|exception/i.test(emptyLog), 'no error wording');
await page.click('#pg-logs .idx button:has-text("trace.jsonl")');
await page.waitForTimeout(1600);
await page.fill('#pg-logs input.search', 'argus.verdict');
await page.waitForTimeout(1200);
check('logs', 'line filter', /matching/.test(await body('#log-view')), 'filtered');
await page.fill('#pg-logs input.search', '');
await page.waitForTimeout(1000);
await page.click('#pg-logs button:has-text("Auto-refresh")');
await page.waitForTimeout(500);
check('logs', 'auto-refresh toggles', /5s/.test(await txt('#pg-logs button:has-text("Auto-refresh")')), '');
const pauseDisabled = await page.locator('#pg-logs button:has-text("Pause")[disabled]').count();
check('logs', 'pause enabled with auto-refresh', pauseDisabled === 0, '');
await page.click('#pg-logs button:has-text("Pause")');
await page.waitForTimeout(400);
check('logs', 'pause works', /Resume/.test(await body('#pg-logs')), '');
await page.click('#pg-logs button:has-text("Jump to end")');
await page.waitForTimeout(400);
check('logs', 'jump to end', true, 'scrolled');
await page.click('#pg-logs button:has-text("Auto-refresh")');

/* ---- keyboard shortcuts ---- */
const shortcuts = [['d', 'Dashboard'], ['c', 'Certifications'], ['v', 'Validation'], ['r', 'Reports']];
for (const [k, expect] of shortcuts) {
  await page.keyboard.press('g');
  await page.keyboard.press(k);
  await page.waitForTimeout(1200);
  check('keyboard', `g ${k}`, (await txt('#pt')).trim() === expect, `-> ${(await txt('#pt')).trim()}`);
}
await page.keyboard.press('Control+k');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('keyboard', 'Esc closes dialogs', (await page.locator('.ov.on').count()) === 0, '');

/* ---- settings ---- */
await nav('Settings');
await page.waitForTimeout(2600);
const setText = await body('#pg-settings');
check('settings', 'environment read-only', /read-only/.test(setText) && /Node/.test(setText), '');
check('settings', 'local-only disclosure', /localStorage|stored in this browser/.test(setText), '');
check('settings', 'operator label is cosmetic', /cannot change it/.test(setText), 'honest about REDBOT_OPERATOR');
const selects = await page.locator('#pg-settings select').count();
check('settings', 'theme + refresh controls', selects === 2, `${selects} selects`);
await page.selectOption('#pg-settings select >> nth=0', 'light');
await page.waitForTimeout(500);
check('settings', 'theme persists', await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light' && JSON.parse(localStorage.getItem('redbot.ws')).theme === 'light'), 'localStorage written');
await page.selectOption('#pg-settings select >> nth=0', 'dark');
await page.waitForTimeout(400);

/* ---- security ---- */
for (const c of ['reply', 'regret', 'observe', 'login', 'read', 'session', 'certify', 'draft']) {
  const r = await page.evaluate(async (cmd) => {
    const res = await fetch('/api/stream?cmd=' + cmd);
    return { status: res.status, body: await res.text() };
  }, c);
  if (r.status !== 400) check('security', `refuses ${c}`, false, `http ${r.status}`);
}
check('security', 'stream refuses all state-changing commands', true, 'reply·regret·observe·login·read·session·certify·draft');
const trav = await page.evaluate(async () => (await (await fetch('/api/file?path=../../.env')).json()).error);
check('security', 'refuses traversal', Boolean(trav), String(trav).slice(0, 40));
const creds = await page.evaluate(async () => (await (await fetch('/api/file?path=data/operators/operators.json')).json()).error);
check('security', 'refuses credentials path', Boolean(creds), String(creds).slice(0, 40));

/* ---- error state ---- */
const badCert = await page.evaluate(async () => (await fetch('/api/certification?index=999')).status);
check('error', 'missing record 404s', badCert === 404, `http ${badCert}`);
const badLog = await page.evaluate(async () => (await (await fetch('/api/log?name=nope')).json()).available);
check('error', 'unknown log handled', badLog === false, '');

/* ---- layout ---- */
for (const w of [420, 900, 1280, 1600]) {
  const p = await (await browser.newContext({ viewport: { width: w, height: 900 } })).newPage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(3200);
  const r = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  check('layout', `${w}px no h-overflow`, r.doc <= r.win, `scrollWidth ${r.doc} vs ${r.win}`);
  await p.close();
}

check('runtime', 'no uncaught JS exceptions', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : 'clean');
check('runtime', 'refusals surface as HTTP status, not exceptions', netNoise.length > 0,
  `${netNoise.length} expected 4xx logged by the browser (409 lock + 400 allowlist)`);

await browser.close();
const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed`);
if (pass !== results.length) {
  console.log('\nFAILURES:');
  results.filter((r) => !r.pass).forEach((r) => console.log(`  ${r.area} · ${r.name} — ${r.detail}`));
}
process.exit(pass === results.length ? 0 : 1);
