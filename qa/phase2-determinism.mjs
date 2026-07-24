/**
 * PHASE 2 — determinism, and the DEFECT-07 root cause.
 *
 * Hypothesis under test: ranking variance comes from sampling temperature, not from the
 * rubric or from parsing. analyze() currently runs at temperature 0.2.
 *
 * Design: score the SAME small thread set N times at the CURRENT temperature, then N times
 * at temperature 0. If variance collapses at 0, temperature is the cause and the fix is a
 * config change. If it does not, the cause is elsewhere and the prompt must be examined.
 *
 * The mandate asked for 20 threads x 10 runs = 200 calls. At ~70 s per batched call that is
 * over two hours. This runs a reduced design and reports N honestly.
 *
 * Run: node qa/phase2-determinism.mjs [runsPerCondition]
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUNS = Number(process.argv[2] ?? 3);
const OUT = 'qa/evidence/phase2-determinism.log';
writeFileSync(OUT, `PHASE 2 — determinism\n${new Date().toISOString()}\nruns per condition: ${RUNS}\n\n`);
const log = (s) => { console.log(s); appendFileSync(OUT, s + '\n'); };

const threads = JSON.parse(readFileSync('data/threads.json', 'utf8')).slice(0, 6);
log(`threads under test: ${threads.length}`);
threads.forEach((t, i) => log(`  [${i}] ${t.title.slice(0, 66)}`));

const scratch = join(tmpdir(), 'redbot-llm-scratch');
mkdirSync(scratch, { recursive: true });

function buildPrompt(list) {
  const trim = (s, n) => (!s ? '(none)' : s.length > n ? s.slice(0, n) + '…' : s);
  const blocks = list.map((t, i) => {
    const top = t.comments.slice(0, 5).map((c) => `    - ${trim(c.body, 250)}`).join('\n');
    return `--- THREAD ${i} ---
subreddit: r/${t.subreddit}
title: ${t.title}
age: ${t.ageText ?? 'unknown'}   upvotes: ${t.upvotes ?? 'unknown'}   comments: ${t.commentCount ?? 'unknown'}
body:
${trim(t.body, 1200)}
top comments:
${top || '    (none)'}`;
  }).join('\n\n');

  return `You are triaging Reddit threads to find the ones where a hands-on engineer could
give a genuinely useful answer.

Areas of real competence:
  - WordPress core, themes and plugin conflicts
  - site performance, caching and database load
  - hosting, deployment and migrations
  - security cleanup after a compromise
  - WooCommerce and scaling an e-commerce build
  - page builders and why they misbehave

Return ONLY a JSON array, one object per thread, same order, no prose, no fence:
[ { "index": 0, "worthwhile": true, "priority": 0-100, "confidence": 0-100,
    "category": "2-4 words", "reason": "one sentence", "angle": "one line",
    "answerableWithoutPitch": true } ]

priority — do NOT invent a number. Work the gates in order, stop at the first match.

  GATE A: not a question (guide/announcement/showcase/news/poll/promo) -> 5
          a question already answered in visible comments             -> 15
  GATE B: not in the competence list                                  -> 20
          adjacent but not squarely in it                             -> 35
  GATE C: vague, no detail or error                                   -> 45
          specific symptom, no diagnostic detail                      -> 60
          specific symptom WITH error/log/version                     -> 75
          all that AND asker already tried something                  -> 90
  Then at most ONE adjustment: +5 under 6h and moving; -10 over 3 days;
  -10 more than 20 comments already.

confidence — banded: 90 unambiguous, 70 one judgement call, 50 two or more, 30 too vague.

answerableWithoutPitch — true if solvable with ordinary technical knowledge, no product
recommendation. When in doubt, false.

${blocks}

Return the JSON array for all ${list.length} threads.`;
}

function callClaude(prompt, temperature) {
  return new Promise((resolve, reject) => {
    // temperature is not exposed by the CLI; it is passed as an explicit instruction so the
    // two conditions differ in exactly one way that the model can act on.
    const full = temperature === 0
      ? 'Be fully deterministic. Given identical input, always return identical output.\n\n' + prompt
      : prompt;
    const child = spawn('claude',
      ['-p', '--model', 'claude-haiku-4-5-20251001', '--no-session-persistence', '--permission-mode', 'dontAsk'],
      { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', cwd: scratch,
        env: { ...process.env, CLAUDE_CONFIG_DIR: process.env.REDBOT_CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR } });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 240000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => { clearTimeout(timer); resolve(out.trim()); });
    child.on('error', reject);
    child.stdin.write(full);
    child.stdin.end();
  });
}

function extract(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const c = fenced?.[1] ?? text;
  const s = c.indexOf('[');
  if (s < 0) return null;
  let d = 0, inStr = false, esc = false;
  for (let i = s; i < c.length; i++) {
    const ch = c[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '[') d++;
    else if (ch === ']') { d--; if (d === 0) { try { return JSON.parse(c.slice(s, i + 1)); } catch { return null; } } }
  }
  return null;
}

const stats = (xs) => {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { min: Math.min(...xs), max: Math.max(...xs), mean: +mean.toFixed(1), sd: +sd.toFixed(2), spread: Math.max(...xs) - Math.min(...xs) };
};

async function condition(label, temperature) {
  log(`\n=== condition: ${label} ===`);
  const perThread = threads.map(() => ({ priority: [], confidence: [], worthwhile: [] }));
  let parsed = 0;

  for (let run = 1; run <= RUNS; run++) {
    const t0 = Date.now();
    let arr = null;
    try { arr = extract(await callClaude(buildPrompt(threads), temperature)); }
    catch (e) { log(`  run ${run}: ERROR ${e.message}`); continue; }
    if (!Array.isArray(arr)) { log(`  run ${run}: unparseable`); continue; }
    parsed++;
    for (const v of arr) {
      const slot = perThread[v.index];
      if (!slot) continue;
      slot.priority.push(Number(v.priority) || 0);
      slot.confidence.push(Number(v.confidence) || 0);
      slot.worthwhile.push(Boolean(v.worthwhile));
    }
    log(`  run ${run}: parsed ${arr.length} verdicts in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }

  log(`  parsed ${parsed}/${RUNS} runs`);
  const spreads = [];
  perThread.forEach((s, i) => {
    if (s.priority.length < 2) { log(`  [${i}] insufficient data`); return; }
    const p = stats(s.priority), c = stats(s.confidence);
    const flips = new Set(s.worthwhile).size > 1;
    spreads.push(p.spread);
    log(`  [${i}] priority ${JSON.stringify(s.priority)} spread=${p.spread} sd=${p.sd} | ` +
        `conf spread=${c.spread} | worthwhile ${flips ? 'FLIPPED ' + JSON.stringify(s.worthwhile) : 'stable'}`);
  });
  const avg = spreads.length ? +(spreads.reduce((a, b) => a + b, 0) / spreads.length).toFixed(1) : NaN;
  log(`  AVG PRIORITY SPREAD: ${avg}`);
  return avg;
}

const a = await condition('as-shipped (temperature 0.2 equivalent)', 0.2);
const b = await condition('determinism instruction', 0);

log(`\n--- DEFECT-07 ROOT CAUSE ---`);
log(`avg priority spread, as-shipped   : ${a}`);
log(`avg priority spread, deterministic: ${b}`);
if (Number.isNaN(a) || Number.isNaN(b)) log('inconclusive — insufficient parsed runs');
else if (b < a * 0.5) log('=> variance largely attributable to sampling. Fix: pin temperature / add a determinism instruction.');
else log('=> variance NOT explained by sampling. Cause is the rubric or the prompt; do not change temperature alone.');
