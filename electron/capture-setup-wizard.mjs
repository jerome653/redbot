#!/usr/bin/env node
/**
 * The Setup wizard, rendered against the operator's REAL install.
 *
 * The fixture proves the wizard handles a shape; this proves it handles THIS machine — a real
 * dependency scan, real operators, real tokens. The two disagree in exactly the places that matter:
 * the fixture has no dashboard sync, so steps 5–8 only ever appear here.
 *
 * Read-only. It reads the DOM, expands steps and takes pictures. It never stores a token, never
 * pushes, and never presses anything that writes.
 *
 *   node electron/capture-setup-wizard.mjs
 */
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const realData = join(ROOT, 'data');
const realDb = join(realData, 'redbot.db');

if (!existsSync(realDb)) {
  console.error(`\n  No database at ${realDb}\n`);
  process.exit(1);
}

const userDir = mkdtempSync(join(tmpdir(), 'redbot-wiz-'));
const out = join(HERE, '.shots');
mkdirSync(out, { recursive: true });

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userDir}`],
  cwd: ROOT,
  env: { ...process.env, REDBOT_DATA: realData, REDBOT_DB: realDb, REDBOT_NO_DIALOGS: '1' }
});

const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.waitForSelector('#banner', { timeout: 45_000 });
await page.setViewportSize({ width: 1440, height: 1000 });

/* The first-run guide swallows clicks on a fresh userData. */
await page.evaluate(() => { try { localStorage.setItem('redbot.seenGuide', '1'); } catch { /* private mode */ } });
await page.click('#guideX').catch(() => {});
await page.waitForTimeout(400);

await page.click('.steps .step[data-v="setup"]').catch(() => {});
/* The dependency scan lands after the first paint and redraws the screen. */
await page.waitForFunction(
  () => document.querySelectorAll('#v-setup .wiz').length > 0, null, { timeout: 20_000 });
await page.waitForTimeout(2500);

const read = () => page.evaluate(() => {
  const steps = [...document.querySelectorAll('#v-setup .wiz')].map((w, i) => {
    const h = w.querySelector('.wiz-h');
    return {
      n: i + 1,
      title: w.querySelector('.wiz-title')?.textContent?.trim() ?? '',
      sub: w.querySelector('.wiz-sub')?.textContent?.trim().slice(0, 60) ?? '',
      tag: h?.querySelector('.tag')?.textContent?.trim() ?? '',
      state: w.className.replace('wiz', '').trim() || 'todo',
      open: h?.getAttribute('aria-expanded') === 'true',
      copyButtons: w.querySelectorAll('.cpy button').length
    };
  });
  return {
    steps,
    summary: document.querySelector('#v-setup .wiz-sum')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    cards: [...document.querySelectorAll('#v-setup .collect .collect-h h3')].map((h) => h.textContent.trim())
  };
});

const before = await read();
console.log(`\n  summary    ${before.summary}`);
console.log('\n  #  STATE     OPEN  TAG        COPY  TITLE');
for (const s of before.steps) {
  console.log(`  ${s.n}  ${s.state.padEnd(9)} ${String(s.open).padEnd(5)} ${s.tag.padEnd(10)} ${String(s.copyButtons).padEnd(5)} ${s.title}`);
  if (s.sub) console.log(`     ${''.padEnd(32)}${s.sub}`);
}
console.log(`\n  cards below the wizard: ${JSON.stringify(before.cards)}`);

/**
 * Exactly one step open — UNLESS the install is finished.
 *
 * A wizard with several steps open is not leading anybody anywhere. But a wizard with NONE open is
 * correct once every step is done, which is the state this machine is in; asserting "exactly one"
 * flatly reported a fully configured install as a failure.
 */
const open = before.steps.filter((s) => s.open);
const nowSteps = before.steps.filter((s) => s.state.includes('now'));
const allDone = before.steps.every((s) => s.state.includes('done'));
const openOk = allDone ? open.length === 0 : open.length === 1;
console.log(`\n  open steps: ${open.length} (${open.map((s) => s.n).join(',') || 'none'})`);
console.log(`  current   : ${nowSteps.map((s) => s.n).join(',') || 'none — everything done'}`);
console.log(`  focus     : ${openOk ? 'correct' : 'WRONG — ' + (allDone ? 'finished wizard should collapse' : 'expected exactly one open step')}`);

/**
 * ARE THE STEPS ACTUALLY VISIBLE?
 *
 * Added after a render where all eight cards were present, correctly ordered and correctly stated —
 * and drawn as 1px hairlines with none of their text showing. Every DOM assertion above passed;
 * only the screenshot showed it. `textContent` and `aria-expanded` are true of an element with no
 * height, so a header that collapses to nothing is invisible to exactly the checks that looked
 * hardest. Measuring the box is what turns "the markup is right" into "a person can see it".
 */
const boxes = await page.evaluate(() => [...document.querySelectorAll('#v-setup .wiz')].map((w) => {
  const h = w.querySelector('.wiz-h');
  const t = w.querySelector('.wiz-title');
  const r = (e) => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    card: r(w),
    header: h ? r(h) : null,
    title: t ? r(t) : null,
    headerDisplay: h ? getComputedStyle(h).display : null,
    titleFont: t ? getComputedStyle(t).fontSize : null
  };
}));
/* The CARD is what has to be tall, not just the header inside it: the bug this exists to catch was
   a 2px card wrapping a 75px header, which every child-level measurement called healthy. */
const tooShort = boxes.filter((b) => b.card.h < 40 || !b.header || b.header.h < 30);
console.log('\n  STEP BOXES (the CARD must be as tall as its header, not just contain one)');
for (const [i, b] of boxes.entries()) {
  console.log(`  ${i + 1}  card ${b.card.w}x${b.card.h}  header ${b.header ? b.header.w + 'x' + b.header.h : 'none'}`
    + `  title ${b.title ? b.title.w + 'x' + b.title.h : 'none'}  display=${b.headerDisplay} font=${b.titleFont}`);
}
console.log(`  ${tooShort.length ? 'FAIL — ' + tooShort.length + ' step(s) collapsed' : 'all steps have a real, clickable header'}`);

if (tooShort.length) {
  const chain = await page.evaluate(() => {
    const out = [];
    let e = document.querySelector('#v-setup .wiz');
    while (e && e !== document.documentElement) {
      const c = getComputedStyle(e);
      out.push({
        tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0, 40),
        h: Math.round(e.getBoundingClientRect().height),
        display: c.display, flex: c.flex, minHeight: c.minHeight, overflow: c.overflow,
        position: c.position, contain: c.contain
      });
      e = e.parentElement;
    }
    return out;
  });
  console.log('\n  ANCESTOR CHAIN (why is the card not as tall as its content?)');
  for (const a of chain) {
    console.log(`   ${a.tag}.${a.cls}`.padEnd(34)
      + ` h=${String(a.h).padEnd(6)} display=${String(a.display).padEnd(12)} flex=${String(a.flex).padEnd(12)} minH=${String(a.minHeight).padEnd(6)} pos=${a.position} contain=${a.contain}`);
  }
}

await page.screenshot({ path: join(out, 'wizard-top.png') });
await page.screenshot({ path: join(out, 'wizard-full.png'), fullPage: true });

/* ---- expanding a collapsed step actually works ---- */
const collapsed = before.steps.find((s) => !s.open);
let toggleOk = null;
if (collapsed) {
  await page.evaluate((title) => {
    const h = [...document.querySelectorAll('#v-setup .wiz-h')]
      .find((x) => x.querySelector('.wiz-title')?.textContent?.trim() === title);
    h?.click();
    h?.scrollIntoView({ block: 'center' });
  }, collapsed.title);
  await page.waitForTimeout(500);
  const after = await read();
  const now = after.steps.find((s) => s.title === collapsed.title);
  toggleOk = !!now?.open;
  console.log(`\n  toggling "${collapsed.title}" -> open=${now?.open}`);
  await page.screenshot({ path: join(out, 'wizard-expanded.png') });
}

/**
 * The two steps that exist to be COPIED from.
 *
 * The sign-in command and the install id are the whole reason those steps exist — one is the only
 * thing redbot cannot do for the operator, the other is what a token is minted against. Both are
 * shot individually so a regression in either is visible rather than buried in a full-page image.
 */
for (const title of ['Sign in to the model', 'Copy this install’s id']) {
  const found = await page.evaluate((t) => {
    const h = [...document.querySelectorAll('#v-setup .wiz-h')]
      .find((x) => x.querySelector('.wiz-title')?.textContent?.trim() === t);
    if (!h) return false;
    if (h.getAttribute('aria-expanded') !== 'true') h.click();
    h.scrollIntoView({ block: 'start' });
    return true;
  }, title);
  if (!found) { console.log(`\n  step "${title}" is not present on this install`); continue; }
  await page.waitForTimeout(400);
  const slug = title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  await page.screenshot({ path: join(out, `wizard-${slug}.png`) });
  console.log(`\n  shot step "${title}"`);
}

/* ---- the copy buttons ----
 *
 * Clicking one and reading the clipboard back is the only way to know it copied the right thing;
 * the button label changing to "copied" only proves the handler did not throw. */
const copied = await page.evaluate(async () => {
  const btns = [...document.querySelectorAll('#v-setup .cpy')];
  const results = [];
  for (const box of btns) {
    const code = box.querySelector('code')?.textContent ?? '';
    const btn = box.querySelector('button');
    if (!btn) continue;
    let got = null; let err = null;
    try {
      btn.click();
      await new Promise((r) => setTimeout(r, 120));
      got = await navigator.clipboard.readText();
    } catch (e) { err = String(e && e.message || e); }
    /* Line endings are normalised before comparing: the Windows clipboard hands back CRLF for text
       that was written with LF, so the ONLY multi-line command here (the mint one) compared unequal
       while having been copied perfectly. Comparing raw would have reported a bug that is not one. */
    const norm = (s) => String(s ?? '').replace(/\r\n/g, '\n');
    results.push({ expected: code.slice(0, 60), match: norm(got) === norm(code), label: btn.textContent, err });
  }
  return results;
});
console.log('\n  COPY BUTTONS');
for (const c of copied) {
  console.log(`   match=${String(c.match).padEnd(5)} label="${c.label}" ${c.err ? 'err=' + c.err : ''}`);
  console.log(`     ${c.expected}`);
}

/* Both palettes. The step number, the state tint and the copy blocks all sit on a surface that
   flips with the theme, and the UI suite's theme test only walks the light one. */
for (const want of ['dark', 'light']) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    document.querySelector('#v-setup .wiz')?.scrollIntoView({ block: 'start' });
  }, want);
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(out, `wizard-theme-${want}.png`) });
}
console.log('\n  themes     captured dark and light');

const real = errors.filter((e) => !/Failed to load resource|net::ERR|404|favicon/.test(e));
console.log(`\n  shots      ${out}`);
console.log(`  console    ${real.length ? real.join(' | ') : 'clean — no errors'}\n`);

await app.close();
try { rmSync(userDir, { recursive: true, force: true }); } catch { /* windows lock */ }
const bad = real.length || tooShort.length || !openOk || toggleOk === false || copied.some((c) => !c.match);
process.exit(bad ? 1 : 0);
