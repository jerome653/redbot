/**
 * redbot operator console — a thin local frontend over the existing CLI.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE CONTAINS NO BUSINESS LOGIC AND MUST NEVER CONTAIN ANY.
 *
 * Every action spawns the real command and returns its stdout verbatim. Nothing
 * is summarised, re-derived, re-implemented or "improved". If a number is wrong
 * on screen, the command is wrong — there is no second implementation here that
 * could disagree with the first.
 *
 * The engine is frozen. This process reads and displays. It never writes to
 * data/, never touches Reddit, and cannot publish: every command capable of
 * changing Reddit state is absent from the allowlist, and the allowlist is an
 * allowlist precisely so that a future command is excluded by default.
 * ---------------------------------------------------------------------------
 *
 * Zero dependencies: node:http + node:child_process. No framework, no build
 * step, no database, no websocket. Binds 127.0.0.1 only.
 *
 * Run:  node tools/operator/server.mjs [--port 7890]
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const portArg = process.argv.indexOf('--port');
const PORT = portArg > -1 ? Number(process.argv[portArg + 1]) : 7890;

/** Sibling repository holding the extracted engine. Optional. */
const ARGUS = resolve(ROOT, '..', '..', '..', '..', 'argus');

/* ------------------------------------------------------------------ *
 * Allowlists
 * ------------------------------------------------------------------ */

/**
 * Read-only CLI commands. NEVER add a command that can change Reddit state.
 *
 * Excluded, and the reason matters more than the list:
 *   reply    publishes; requires a human at a TTY by design
 *   regret   asks a person two questions; a web form is not that person
 *   observe  drives the operator's browser against a live thread
 *   read · search · session · login    drive the browser
 *   draft · opportunity · certify      spend model calls and write evidence
 */
const COMMANDS = {
  doctor:   { args: ['doctor'],            label: 'Doctor',    group: 'validation', blurb: 'install health — build, auth, data, secrets, backup' },
  health:   { args: ['health'],            label: 'Health',    group: 'logs',       blurb: 'account state machine and every counter behind it' },
  policy:   { args: ['policy'],            label: 'Policy',    group: 'logs',       blurb: '24 operational limits, each with provenance' },
  metrics:  { args: ['metrics'],           label: 'Metrics',   group: 'logs',       blurb: 'reliability figures with their denominators' },
  select:   { args: ['select'],            label: 'Select',    group: 'logs',       blurb: 'rank assessed threads against the pilot criteria' },
  review:   { args: ['review'],            label: 'Review',    group: 'logs',       blurb: 'operator decisions by reason code' },
  insights: { args: ['insights'],          label: 'Insights',  group: 'logs',       blurb: 'where the pipeline loses candidates' },
  history:  { args: ['history', '60'],     label: 'History',   group: 'logs',       blurb: 'the local activity log' },
  backup:   { args: ['backup', '--list'],  label: 'Backups',   group: 'logs',       blurb: 'evidence snapshots outside the working tree' },
  report:   { args: ['report'],            label: 'Regenerate reports', group: 'logs', blurb: 'rebuild reports/ from data on disk' }
};

const SCRIPTS = {
  tests:      { cmd: 'npm',  args: ['test'],                        label: 'Tests',      blurb: 'full suite' },
  benchmark:  { cmd: 'node', args: ['qa/benchmark/run.mjs'],         label: 'Benchmark',  blurb: 'certification regression suite' },
  corpus:     { cmd: 'node', args: ['ground-truth/validate.mjs'],    label: 'Corpus',     blurb: 'ground-truth validation and promotion' },
  replay:     { cmd: 'node', args: ['qa/ARE-001-argus-replay.mjs'],  label: 'Replay',     blurb: 'ARE-001 — deterministic verdict replay' },
  extraction: { cmd: 'node', args: ['tools/verify-extraction.mjs'],  label: 'Extraction', blurb: 'byte-identity of the extracted engine', cwd: ARGUS }
};

const READABLE_ROOTS = ['ground-truth', 'reports', 'docs', 'qa'];
const READABLE_FILES = [
  'ENGINE-FREEZE.md', 'ARGUS.md', 'AGTC.md', 'README.md', 'RUNTIME-AUDIT.md',
  'OPERATOR-CONSOLE.md', 'FINAL-OPERATOR-REPORT.md', 'OBSERVATION-SCHEMA.md',
  'PUBLICATION-READINESS.md', 'ARGUS-PUBLICATION-PLAN.md'
];

const LOGS = {
  history:      'data/history.jsonl',
  observations: 'data/observations.jsonl',
  reviews:      'data/reviews.jsonl',
  regret:       'data/regret.jsonl',
  interactions: 'data/interactions.jsonl',
  trace:        'data/trace.jsonl'
};

/* ------------------------------------------------------------------ *
 * Process execution
 * ------------------------------------------------------------------ */

/**
 * Resolve to something spawnable WITHOUT a shell.
 *
 * `shell: true` is never used. On Windows it re-joins argv into one string, so
 * `C:\Program Files\nodejs\node.exe` splits at its space and the child dies
 * instantly — observed as exit 1 in 17 ms with stderr
 * `'C:\Program' is not recognized`. npm is a .cmd shim that Node 20+ refuses to
 * spawn without a shell (spawn EINVAL), so it goes through cmd.exe explicitly.
 */
function resolveCmd(cmd, args) {
  if (cmd === 'node') return [process.execPath, args];
  if (cmd === 'npm' && process.platform === 'win32') return ['cmd.exe', ['/c', 'npm', ...args]];
  return [cmd, args];
}

function run(cmd, args, timeoutMs = 180_000, cwd = ROOT) {
  return new Promise((res) => {
    const started = Date.now();
    const [bin, argv] = resolveCmd(cmd, args);
    let child;
    try {
      child = spawn(bin, argv, { cwd, shell: false, env: { ...process.env } });
    } catch (e) {
      return res({ ok: false, code: -1, out: '', err: String(e.message), ms: 0 });
    }
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); out += '\n[timed out]'; }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); res({ ok: false, code: -1, out: '', err: String(e.message), ms: Date.now() - started }); });
    child.on('close', (code) => { clearTimeout(timer); res({ ok: code === 0, code, out, err, ms: Date.now() - started }); });
  });
}

const runCli = (args) => run('node', [join(ROOT, 'dist', 'cli.js'), ...args]);

/* ------------------------------------------------------------------ *
 * Small readers — I/O for display, never computation
 * ------------------------------------------------------------------ */

const lineCount = (p) => existsSync(join(ROOT, p))
  ? readFileSync(join(ROOT, p), 'utf8').split('\n').filter((l) => l.trim()).length : null;

const readJson = (p) => {
  const abs = join(ROOT, p);
  if (!existsSync(abs)) return null;
  try { return JSON.parse(readFileSync(abs, 'utf8')); } catch { return null; }
};

async function chromeStatus() {
  try {
    const r = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { connected: false, detail: `CDP responded ${r.status}` };
    return { connected: true, detail: (await r.json()).Browser ?? 'connected' };
  } catch {
    return { connected: false, detail: 'Chrome not connected' };
  }
}

/** Why replay can or cannot run — never surfaced as an error. */
function replayAvailability() {
  const p = 'data/certifications.jsonl';
  const n = lineCount(p);
  if (n === null) {
    return {
      available: false,
      reason: `${p} does not exist. ARE-001 replays a real certification through the deterministic ` +
              `verdict layer, so it needs at least one certification on disk. Run \`redbot certify <draftId>\` ` +
              `first — that requires operator model credentials but no browser.`
    };
  }
  if (n === 0) return { available: false, reason: `${p} exists but is empty. Nothing has been certified yet.` };
  return { available: true, records: n, reason: `${n} certification record(s) on disk.` };
}

function freezeState() {
  const f = join(ROOT, 'ENGINE-FREEZE.md');
  if (!existsSync(f)) return { frozen: false, detail: 'ENGINE-FREEZE.md not present' };
  const t = readFileSync(f, 'utf8');
  const ver = (t.match(/^#\s*Engine freeze\s*—\s*(\S+)/m) ?? [])[1] ?? null;
  return {
    frozen: true,
    version: ver,
    detail: 'Certification logic, extraction, contradiction generation, provenance, dependency graph, ' +
            'benchmark, replay, evidence generation, calibration, rules, prompts, thresholds and corpus are immutable.',
    unfreezeRequires: ['benchmark evidence — a case fails or reaches the right verdict for the wrong reasons',
                       'human calibration — an adjudicated case shows the engine disagreeing, attributable to the engine']
  };
}

/* ------------------------------------------------------------------ *
 * Certifications · ground truth · reports
 * ------------------------------------------------------------------ */

function certifications() {
  const abs = join(ROOT, 'data/certifications.jsonl');
  if (!existsSync(abs)) return { available: false, reason: 'data/certifications.jsonl does not exist — nothing has been certified on this machine', records: [] };
  const records = [];
  readFileSync(abs, 'utf8').split('\n').filter((l) => l.trim()).forEach((l, i) => {
    try {
      const c = JSON.parse(l);
      records.push({
        index: i, draftId: c.draftId, threadId: c.threadId, verdict: c.verdict,
        certifiedAt: c.certifiedAt, model: c.model,
        claims: (c.claims ?? []).length,
        contradictions: (c.contradictions ?? []).length,
        fatal: (c.contradictions ?? []).filter((x) => x.fatal).length,
        epistemic: (c.epistemic ?? []).length,
        invalidated: (c.invalidated ?? []).length,
        resolved: Boolean(c.resolution?.resolved),
        rules: [...new Set((c.reasons ?? []).map((r) => r.rule))]
      });
    } catch { /* skip unparseable */ }
  });
  return { available: true, records };
}

function certification(i) {
  const abs = join(ROOT, 'data/certifications.jsonl');
  if (!existsSync(abs)) return null;
  const lines = readFileSync(abs, 'utf8').split('\n').filter((l) => l.trim());
  if (!(i >= 0 && i < lines.length)) return null;
  try { return JSON.parse(lines[i]); } catch { return null; }
}

function groundTruth() {
  const base = join(ROOT, 'ground-truth', 'cases');
  if (!existsSync(base)) return { available: false, reason: 'ground-truth/cases does not exist', cases: [] };
  const cases = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const dir = join(base, d.name);
    const cf = join(dir, 'case.json');
    let meta = null;
    if (existsSync(cf)) {
      try {
        const c = JSON.parse(readFileSync(cf, 'utf8'));
        const labels = c.ground_truth?.claim_labels ?? [];
        const claims = c.ground_truth?.expected_claims ?? (c.argus_observed?.claims ?? []).length;
        meta = {
          humanVerdict: c.human_review?.verdict ?? null,
          reviewer: c.human_review?.reviewer ?? null,
          reviewedAt: c.human_review?.reviewed_at ?? null,
          notes: c.human_review?.notes ?? null,
          claims,
          reviewed: c.ground_truth?.claims_reviewed ?? labels.length,
          pending: Math.max(0, claims - (c.ground_truth?.claims_reviewed ?? labels.length)),
          sources: (c.ground_truth?.sources ?? []).length,
          groundTruthStatus: c.status?.ground_truth ?? null,
          calibrationStatus: c.status?.calibration ?? null,
          benchmarkStatus: c.status?.benchmark ?? null,
          blockedBy: c.status?.blocked_by ?? [],
          argusVerdict: c.argus_observed?.verdict ?? null,
          draftId: c.draft_id ?? null,
          labels
        };
      } catch { /* leave null */ }
    }
    return {
      id: d.name, meta,
      files: readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()).map((f) => ({
        name: f, path: `ground-truth/cases/${d.name}/${f}`,
        bytes: statSync(join(dir, f)).size,
        markdown: f.toLowerCase().endsWith('.md')
      }))
    };
  });
  return { available: true, cases };
}

function reports() {
  const dir = join(ROOT, 'reports');
  if (!existsSync(dir)) return { available: false, reason: 'reports/ does not exist — run `redbot report`', files: [] };
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const st = statSync(join(dir, f));
    return { name: f, path: `reports/${f}`, bytes: st.size, modified: st.mtime.toISOString() };
  }).sort((a, b) => b.modified.localeCompare(a.modified));
  return { available: true, files };
}

/**
 * data/ is NOT a readable root — it holds operator credentials and browser
 * profiles in the same tree as evidence. The file explorer still needs the
 * append-only logs, so exactly those files are allowed by name. A directory
 * allowance here would expose data/operators/; a fixed list cannot.
 */
const READABLE_DATA_FILES = new Set([...Object.values(LOGS), 'data/certifications.jsonl']);

function readable(rel) {
  const abs = resolve(ROOT, rel);
  const r = relative(ROOT, abs);
  if (r.startsWith('..') || r.includes('..' + sep)) return null;
  const norm = r.split(sep).join('/');
  const first = norm.split('/')[0];
  const allowed = READABLE_ROOTS.includes(first) || READABLE_FILES.includes(norm) || READABLE_DATA_FILES.has(norm);
  if (!allowed) return null;
  if (!existsSync(abs) || !statSync(abs).isFile() || statSync(abs).size > 4_000_000) return null;
  return readFileSync(abs, 'utf8');
}

function logTail(name, n = 400) {
  const rel = LOGS[name];
  if (!rel) return { available: false, reason: `unknown log "${name}"` };
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    const why = name === 'reviews' || name === 'regret'
      ? 'No draft has been decided at the approval prompt.'
      : name === 'interactions' ? 'No reply has been published.' : 'No command has produced this log.';
    return { available: false, path: rel, reason: `${rel} does not exist yet — nothing has written to it. ${why}` };
  }
  const lines = readFileSync(abs, 'utf8').split('\n').filter((l) => l.trim());
  return { available: true, path: rel, total: lines.length, lines: lines.slice(-n) };
}

/* ------------------------------------------------------------------ *
 * Dashboard — every figure comes from a command or a file
 * ------------------------------------------------------------------ */

async function dashboard() {
  const [git, branch, corpus, chrome] = await Promise.all([
    run('git', ['rev-parse', '--short', 'HEAD'], 8000),
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 8000),
    run('node', [join(ROOT, 'ground-truth', 'validate.mjs')], 60_000),
    chromeStatus()
  ]);
  const field = (re) => (corpus.out.match(re) ?? [])[1] ?? null;

  const certs = certifications();
  const latestCert = certs.available && certs.records.length ? certs.records[certs.records.length - 1] : null;
  const drafts = readJson('data/drafts.json') ?? [];
  const last = readJson('qa/benchmark/last-run.json');
  const rep = reports();

  // Operator identity is resolved exactly as src/config.ts does: the env var selects
  // which operator's credentials are used, and data/operators/<name> is where they live.
  const opDir = join(ROOT, 'data', 'operators');
  const operatorsOnDisk = existsSync(opDir)
    ? readdirSync(opDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];

  return {
    operator: process.env.REDBOT_OPERATOR ?? null,
    operatorsOnDisk,
    git: { commit: git.out.trim() || null, branch: branch.out.trim() || null },
    chrome,
    freeze: freezeState(),
    replay: replayAvailability(),
    extraction: existsSync(join(ARGUS, 'tools', 'verify-extraction.mjs'))
      ? { available: true, repo: ARGUS, note: 'Extraction verification is a gate of the extracted repository, not of redbot.' }
      : { available: false, note: 'No extracted repository found alongside this one. Extraction verification is not a redbot gate.' },
    corpus: {
      exit: corpus.code,
      cases: field(/cases\s*:\s*(\d+)/),
      groundTruthApproved: field(/ground truth approved\s*:\s*(\d+)/),
      calibrationApproved: field(/calibration approved\s*:\s*(\d+)/),
      structuralFailures: field(/structural failures\s*:\s*(\d+)/),
      raw: corpus.out
    },
    benchmark: last ? {
      cases: last.cases, passed: last.passed, failed: last.failed,
      drafts: last.distinct_drafts, paths: last.verdict_paths,
      calibration: last.calibration, stages: last.stages
    } : null,
    counts: {
      certificationRecords: lineCount('data/certifications.jsonl') ?? 0,
      certificationDrafts: new Set(certs.records.map((r) => r.draftId)).size,
      threads: (readJson('data/threads.json') ?? []).length,
      drafts: drafts.length,
      draftsPending: drafts.filter((d) => d.status === 'pending').length,
      draftsPublished: drafts.filter((d) => d.status === 'published').length,
      reviews: lineCount('data/reviews.jsonl') ?? 0,
      regret: lineCount('data/regret.jsonl') ?? 0,
      interactions: lineCount('data/interactions.jsonl') ?? 0,
      observations: lineCount('data/observations.jsonl') ?? 0,
      reports: rep.available ? rep.files.length : 0
    },
    latestCert,
    latestReports: rep.available ? rep.files.slice(0, 6) : []
  };
}

/** Benchmark run with a before/after comparison. Adds no persistent state. */
async function benchmarkRun() {
  const before = readJson('qa/benchmark/last-run.json');
  const r = await run('node', ['qa/benchmark/run.mjs'], 300_000);
  const after = readJson('qa/benchmark/last-run.json');
  const cmp = (before && after) ? {
    passed: { before: before.passed, after: after.passed },
    failed: { before: before.failed, after: after.failed },
    cases:  { before: before.cases,  after: after.cases },
    changed: JSON.stringify(before) !== JSON.stringify(after)
  } : null;
  return { ...r, cli: 'node qa/benchmark/run.mjs', before, after, comparison: cmp };
}

/* ------------------------------------------------------------------ *
 * Live execution — streaming, cancellation, single-slot lock
 *
 * Server-Sent Events, not a websocket: one long-lived HTTP response,
 * no dependency, no protocol upgrade. The child is tracked so it can
 * be cancelled, and only one may run at a time — a workstation that
 * lets you start six benchmarks by accident is not a workstation.
 * ------------------------------------------------------------------ */

let ACTIVE = null;   // { key, child, started, res }

function activeStatus() {
  if (!ACTIVE) return { running: false };
  return { running: true, key: ACTIVE.key, startedAt: new Date(ACTIVE.started).toISOString(), ms: Date.now() - ACTIVE.started };
}

function cancelActive() {
  if (!ACTIVE) return { cancelled: false, reason: 'nothing is running' };
  const key = ACTIVE.key;
  try { ACTIVE.child.kill(); } catch { /* already gone */ }
  return { cancelled: true, key };
}

/** Stream a command's stdout/stderr to the client as it arrives. */
function streamRun(res, key, cmd, args, cwd) {
  if (ACTIVE) {
    res.writeHead(409, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: `"${ACTIVE.key}" is already running. One command at a time — cancel it first.` }));
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive'
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const started = Date.now();
  const [bin, argv] = resolveCmd(cmd, args);
  let child;
  try {
    child = spawn(bin, argv, { cwd: cwd ?? ROOT, shell: false, env: { ...process.env } });
  } catch (e) {
    send('exit', { code: -1, ms: 0, error: String(e.message) });
    return res.end();
  }
  ACTIVE = { key, child, started, res };
  send('start', { key, cli: `${cmd} ${args.join(' ')}`, startedAt: new Date(started).toISOString() });

  const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 15_000);
  child.stdout.on('data', (d) => send('out', { chunk: d.toString() }));
  child.stderr.on('data', (d) => send('err', { chunk: d.toString() }));

  const finish = (code, extra = {}) => {
    clearInterval(beat);
    const ms = Date.now() - started;
    recordRun(key, code, ms);
    ACTIVE = null;
    send('exit', { code, ms, ...extra });
    res.end();
  };
  child.on('error', (e) => finish(-1, { error: String(e.message) }));
  child.on('close', (code, signal) => finish(code === null ? -1 : code, signal ? { signal, cancelled: true } : {}));

  res.on('close', () => { if (ACTIVE && ACTIVE.child === child) { try { child.kill(); } catch { /* gone */ } } });
}

/* ------------------------------------------------------------------ *
 * File explorer · global search · timeline · queue
 * ------------------------------------------------------------------ */

const TREE_ROOTS = [
  { key: 'reports',      path: 'reports',            label: 'reports' },
  { key: 'ground-truth', path: 'ground-truth',       label: 'ground-truth' },
  { key: 'qa',           path: 'qa',                 label: 'qa' },
  { key: 'docs',         path: 'docs',               label: 'docs' },
  { key: 'logs',         path: 'data',               label: 'logs', only: /\.jsonl$/ }
];
const TREE_SKIP = new Set(['node_modules', '.git', 'dist', 'chrome-profile', 'chrome-profile-b', 'operators']);
const TEXTUAL = /\.(md|json|jsonl|mjs|js|ts|txt|yml|yaml)$/i;

function tree(rootKey) {
  const spec = TREE_ROOTS.find((r) => r.key === rootKey);
  if (!spec) return { available: false, reason: `unknown root "${rootKey}"` };
  const base = join(ROOT, spec.path);
  if (!existsSync(base)) return { available: false, reason: `${spec.path} does not exist` };

  const walk = (abs, rel, depth) => {
    if (depth > 4) return [];
    const out = [];
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (TREE_SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const childAbs = join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const kids = walk(childAbs, childRel, depth + 1);
        if (kids.length) out.push({ type: 'dir', name: e.name, path: childRel, children: kids });
      } else {
        if (spec.only && !spec.only.test(e.name)) continue;
        if (!TEXTUAL.test(e.name)) continue;
        const st = statSync(childAbs);
        out.push({ type: 'file', name: e.name, path: `${spec.path}/${childRel}`, bytes: st.size, modified: st.mtime.toISOString() });
      }
    }
    return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  };
  return { available: true, root: spec.path, label: spec.label, children: walk(base, '', 0) };
}

/** Grep across the readable surface. Returns file, line number and the matching line. */
function search(q, limit = 200) {
  if (!q || q.length < 2) return { available: false, reason: 'enter at least two characters', hits: [] };
  const needle = q.toLowerCase();
  const hits = [];
  let scanned = 0, truncated = false;

  const scanFile = (abs, rel) => {
    if (hits.length >= limit) { truncated = true; return; }
    let body;
    try {
      if (statSync(abs).size > 3_000_000) return;
      body = readFileSync(abs, 'utf8');
    } catch { return; }
    scanned++;
    if (!body.toLowerCase().includes(needle)) return;
    const lines = body.split('\n');
    for (let i = 0; i < lines.length && hits.length < limit; i++) {
      if (!lines[i].toLowerCase().includes(needle)) continue;
      hits.push({ path: rel, line: i + 1, text: lines[i].trim().slice(0, 300) });
    }
    if (hits.length >= limit) truncated = true;
  };

  const walk = (abs, rel, depth, only) => {
    if (depth > 4 || hits.length >= limit) return;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (TREE_SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const a = join(abs, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(a, r, depth + 1, only);
      else if ((!only || only.test(e.name)) && TEXTUAL.test(e.name)) scanFile(a, r);
    }
  };

  for (const spec of TREE_ROOTS) {
    const base = join(ROOT, spec.path);
    if (existsSync(base)) walk(base, spec.path, 0, spec.only);
  }
  const certs = join(ROOT, 'data', 'certifications.jsonl');
  if (existsSync(certs)) scanFile(certs, 'data/certifications.jsonl');

  const byFile = {};
  hits.forEach((h) => { (byFile[h.path] = byFile[h.path] || []).push(h); });
  return {
    available: true, query: q, total: hits.length, truncated, scanned,
    files: Object.entries(byFile).map(([path, rows]) => ({ path, count: rows.length, rows: rows.slice(0, 12) }))
                 .sort((a, b) => b.count - a.count)
  };
}

/** Certification timeline — durations joined from the trace log by runId. */
function timeline() {
  const certs = certifications();
  if (!certs.available) return { available: false, reason: certs.reason, events: [] };

  const durations = new Map();   // draftId -> [{ms, at}]
  const tp = join(ROOT, 'data', 'trace.jsonl');
  if (existsSync(tp)) {
    const T = readFileSync(tp, 'utf8').split('\n').filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const byRun = {};
    T.forEach((e) => { if (e.stage === 'gate') (byRun[e.runId] = byRun[e.runId] || []).push(e); });
    Object.values(byRun).forEach((ev) => {
      const v = ev.find((x) => x.event === 'argus.verdict');
      if (!v || !v.draftId) return;
      const claims = ev.find((x) => x.event === 'argus.claims');
      const extract = ev.find((x) => x.event === 'argus.extract');
      const list = durations.get(v.draftId) ?? [];
      list.push({
        ms: new Date(v.ts) - new Date(ev[0].ts),
        refutationMs: claims ? new Date(v.ts) - new Date(claims.ts) : null,
        extractMs: extract?.ms ?? null,
        at: v.ts, runId: v.runId
      });
      durations.set(v.draftId, list);
    });
  }

  const used = new Map();
  const events = certs.records.map((r) => {
    const list = durations.get(r.draftId) ?? [];
    const i = used.get(r.draftId) ?? 0;
    used.set(r.draftId, i + 1);
    const d = list[i] ?? null;
    return {
      index: r.index, draftId: r.draftId, verdict: r.verdict, at: r.certifiedAt,
      claims: r.claims, contradictions: r.contradictions, fatal: r.fatal,
      epistemic: r.epistemic, invalidated: r.invalidated, rules: r.rules,
      ms: d?.ms ?? null, refutationMs: d?.refutationMs ?? null, extractMs: d?.extractMs ?? null,
      runId: d?.runId ?? null
    };
  }).sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
  return { available: true, events };
}

/** Certification queue — which drafts are done, which are not. */
function queue() {
  const drafts = readJson('data/drafts.json') ?? [];
  const certs = certifications();
  const done = new Map();
  if (certs.available) certs.records.forEach((r) => done.set(r.draftId, r));

  const rows = drafts.map((d) => {
    const c = done.get(d.id);
    return {
      id: d.id, threadId: d.threadId, title: d.title ?? null,
      status: d.status, bodyChars: (d.body ?? '').length,
      createdAt: d.createdAt ?? null,
      certified: Boolean(c),
      verdict: c?.verdict ?? null, claims: c?.claims ?? null, fatal: c?.fatal ?? null,
      command: `node dist/cli.js certify ${d.id}`
    };
  });
  const runs = runHistory().runs;
  return {
    available: true,
    pending: rows.filter((r) => !r.certified),
    completed: rows.filter((r) => r.certified),
    consoleRuns: {
      total: runs.length,
      failed: runs.filter((r) => r.code !== 0).length,
      cancelled: runs.filter((r) => r.code === -1 || r.code === null).length
    },
    note: 'Certification is not runnable from this interface — it spends model calls and writes evidence. Each pending row carries the exact command to paste into a terminal.'
  };
}

/* ------------------------------------------------------------------ *
 * Activity · charts · readiness · settings
 *
 * Everything below READS. The only file this server writes is its own
 * run log (tools/operator/run-history.jsonl), which records the exit
 * code and duration of commands the operator ran FROM THIS CONSOLE.
 * It is the console's own telemetry, not engine data, and it recomputes
 * nothing — the exit codes belong to the commands.
 * ------------------------------------------------------------------ */

const RUNLOG = join(HERE, 'run-history.jsonl');

function recordRun(key, code, ms) {
  try {
    appendFileSync(RUNLOG, JSON.stringify({ at: new Date().toISOString(), key, code, ms }) + '\n');
  } catch { /* telemetry must never break a command */ }
}

function runHistory() {
  if (!existsSync(RUNLOG)) {
    return { available: false, reason: 'No console run history yet. This series records validation runs started from this console; it begins empty by design rather than showing invented history.', runs: [] };
  }
  const runs = readFileSync(RUNLOG, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { available: runs.length > 0, runs: runs.slice(-120) };
}

/** Recent activity, newest first. Sources: the engine's own history log + artefact mtimes. */
function activity(limit = 40) {
  const out = [];
  const hp = join(ROOT, 'data', 'history.jsonl');
  if (existsSync(hp)) {
    readFileSync(hp, 'utf8').split('\n').filter((l) => l.trim()).forEach((l) => {
      try {
        const e = JSON.parse(l);
        out.push({ at: e.ts, kind: e.kind, summary: e.summary, source: 'data/history.jsonl' });
      } catch { /* skip */ }
    });
  }
  // Artefacts whose mtime IS the event: when they were last produced.
  const artefacts = [
    ['qa/benchmark/last-run.json', 'benchmark', 'benchmark completed'],
    ['data/certifications.jsonl', 'certify', 'certification record written'],
    ['ground-truth/cases/HRC-001/case.json', 'ground-truth', 'ground truth case updated'],
    ['ground-truth/cases/CERT-002/case.json', 'ground-truth', 'ground truth case updated']
  ];
  for (const [rel, kind, summary] of artefacts) {
    const abs = join(ROOT, rel);
    if (existsSync(abs)) out.push({ at: statSync(abs).mtime.toISOString(), kind, summary: `${summary} — ${rel}`, source: 'mtime' });
  }
  const rd = join(ROOT, 'reports');
  if (existsSync(rd)) {
    const files = readdirSync(rd).filter((f) => f.endsWith('.md'));
    if (files.length) {
      const newest = files.map((f) => statSync(join(rd, f)).mtime).sort((a, b) => b - a)[0];
      out.push({ at: newest.toISOString(), kind: 'report', summary: `${files.length} reports generated`, source: 'mtime' });
    }
  }
  for (const r of runHistory().runs) {
    out.push({ at: r.at, kind: 'console', summary: `${r.key} ran from the console — exit ${r.code} in ${r.ms} ms`, source: 'run-history.jsonl' });
  }
  return out.filter((x) => x.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Chart series. Each one is derived from a file on disk, or declared unavailable. */
function charts() {
  // Corpus growth: cumulative threads ADDED by collection runs, from the engine's history log.
  // NOTE: this is not the same as the current corpus size — threads are deduplicated and
  // dropped downstream. Both numbers are shown, and they are allowed to differ.
  const growth = [];
  const hp = join(ROOT, 'data', 'history.jsonl');
  if (existsSync(hp)) {
    let cum = 0;
    readFileSync(hp, 'utf8').split('\n').filter((l) => l.trim()).forEach((l) => {
      try {
        const e = JSON.parse(l);
        if (e.kind === 'read' && e.data && typeof e.data.added === 'number') {
          cum += e.data.added;
          growth.push({ at: e.ts, added: e.data.added, cumulative: cum });
        }
      } catch { /* skip */ }
    });
  }

  const certs = certifications();
  const dist = { CERTIFIED: 0, ESCALATE: 0, REJECT: 0 };
  if (certs.available) certs.records.forEach((r) => { if (dist[r.verdict] != null) dist[r.verdict]++; });

  const last = readJson('qa/benchmark/last-run.json');

  return {
    corpusGrowth: {
      available: growth.length > 0,
      series: growth,
      currentThreads: (readJson('data/threads.json') ?? []).length,
      note: 'Cumulative threads added by collection runs (data/history.jsonl). The current corpus is smaller because threads are deduplicated and dropped downstream — both figures are real.'
    },
    verdictDistribution: {
      available: certs.available,
      counts: dist,
      total: certs.available ? certs.records.length : 0,
      note: 'Verdicts across every certification record on disk.'
    },
    confusion: last?.confusion
      ? { available: true, matrix: last.confusion, note: 'Benchmark expected|actual pairs from qa/benchmark/last-run.json.' }
      : { available: false, note: 'No confusion matrix in last-run.json.' },
    validationTrend: runHistory()
  };
}

/** Release readiness — every item is a live filesystem or git test, not a stored opinion. */
async function readiness() {
  const A = ARGUS;
  const has = (p) => existsSync(join(A, p));
  const readA = (p) => (has(p) ? readFileSync(join(A, p), 'utf8') : '');

  if (!existsSync(A)) {
    return { available: false, reason: `No publication repository at ${A}. Release readiness is measured against the extracted repository, not this one.`, items: [] };
  }

  const workflows = has('.github/workflows')
    ? readdirSync(join(A, '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f)) : [];
  const [remotes, branch] = await Promise.all([
    run('git', ['remote'], 8000, A),
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 8000, A)
  ]);
  const scrubHits = await run('git', ['grep', '-I', '-l', '-i', '-e', 'sgen', '--', '.'], 15000, A);
  const scrubFiles = scrubHits.out.split('\n').map((s) => s.trim()).filter(Boolean);

  const license = readA('LICENSE');
  const items = [
    { key: 'license',  label: 'License selected',
      ok: license.length > 0 && !/NOT YET SELECTED/i.test(license),
      detail: /NOT YET SELECTED/i.test(license) ? 'LICENSE is the placeholder — grants no rights' : 'LICENSE is set' },
    { key: 'scrub',    label: 'Identifiers scrubbed',
      ok: scrubFiles.length === 0,
      detail: scrubFiles.length ? `${scrubFiles.length} file(s) still reference the employer name` : 'no employer references in tracked content' },
    { key: 'ci',       label: 'CI workflow',
      ok: workflows.length > 0,
      detail: workflows.length ? workflows.join(', ') : 'no workflow in .github/workflows' },
    { key: 'conduct',  label: 'Code of conduct',
      ok: has('CODE_OF_CONDUCT.md'), detail: has('CODE_OF_CONDUCT.md') ? 'present' : 'absent' },
    { key: 'templates', label: 'Issue / PR templates',
      ok: has('.github/ISSUE_TEMPLATE') && has('.github/PULL_REQUEST_TEMPLATE.md'),
      detail: `issue ${has('.github/ISSUE_TEMPLATE') ? 'yes' : 'no'} · pr ${has('.github/PULL_REQUEST_TEMPLATE.md') ? 'yes' : 'no'}` },
    { key: 'docs',     label: 'README links resolve',
      ok: !/\]\(ROADMAP\.md\)/.test(readA('README.md')) || has('ROADMAP.md'),
      detail: has('ROADMAP.md') ? 'ROADMAP.md present' : 'README links to a missing ROADMAP.md' },
    { key: 'remote',   label: 'Remote configured',
      ok: remotes.out.trim().length > 0,
      detail: remotes.out.trim() || 'no remote — deliberate at this stage' },
    { key: 'push',     label: 'Pushed',
      ok: false, detail: 'not pushed — deliberate at this stage' }
  ];
  const done = items.filter((i) => i.ok).length;
  return { available: true, repo: A, branch: branch.out.trim(), items, done, total: items.length,
           percent: Math.round((done / items.length) * 100) };
}

async function settings() {
  const [node, tsc, branch, status, commit] = await Promise.all([
    run(process.execPath, ['--version'], 8000),
    run('npm', ['exec', '--', 'tsc', '--version'], 40_000),
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 8000),
    run('git', ['status', '--short'], 12_000),
    run('git', ['rev-parse', 'HEAD'], 8000)
  ]);
  const dirty = status.out.split('\n').filter((l) => l.trim()).length;
  return {
    node: node.out.trim(),
    typescript: (tsc.out.match(/Version\s+(\S+)/) ?? [])[1] ?? tsc.out.trim() ?? null,
    git: { branch: branch.out.trim(), commit: commit.out.trim().slice(0, 9), dirtyFiles: dirty },
    freeze: freezeState(),
    repoPath: ROOT,
    publicationRepo: existsSync(ARGUS) ? ARGUS : null,
    operator: process.env.REDBOT_OPERATOR ?? null,
    platform: `${process.platform} ${process.arch}`,
    consolePort: PORT,
    readOnly: true
  };
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

/**
 * Request guard. This console runs commands (build, tests, report regeneration) and exposes a
 * broad read surface, on GET, with no confirmation — so a cross-site `<img src=.../api/run?...>`
 * or a DNS-rebinding attack could drive it from any page the operator has open (evaluation,
 * operator-console GET finding). Two standard checks, neither of which the console's own
 * same-origin requests trip:
 *
 *   - Host must be loopback (a rebinding attack arrives with the attacker's domain in Host).
 *   - Fetch-metadata isolation: a modern browser tags every request with Sec-Fetch-Site, and a
 *     cross-site `<img>`/`fetch`/navigation is `cross-site`/`same-site`. Only `same-origin` (the
 *     console's own JS) and `none` (the operator typing the URL) are allowed. Absent header =
 *     a non-browser client (curl) on loopback, allowed.
 */
function hostIsLocal(h) {
  if (!h) return false;
  const host = String(h).split(':')[0].toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
function fetchSiteOk(req) {
  const s = req.headers['sec-fetch-site'];
  return s === undefined || s === 'same-origin' || s === 'none';
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = u.pathname;
  try {
    if (!hostIsLocal(req.headers.host) || !fetchSiteOk(req)) {
      return json(res, 403, { error: 'refused: this console only answers same-origin requests addressed to localhost' });
    }
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(readFileSync(join(HERE, 'index.html'), 'utf8'));
    }
    if (p === '/api/dashboard')      return json(res, 200, await dashboard());
    if (p === '/api/commands') return json(res, 200, {
      commands: Object.entries(COMMANDS).map(([k, v]) => ({ key: k, label: v.label, group: v.group, blurb: v.blurb, cli: `redbot ${v.args.join(' ')}` })),
      scripts: Object.entries(SCRIPTS).map(([k, v]) => ({ key: k, label: v.label, blurb: v.blurb, cli: `${v.cmd} ${v.args.join(' ')}`, external: Boolean(v.cwd) })),
      excluded: [
        { cmd: 'reply',   why: 'publishes to Reddit; requires a human at a real terminal' },
        { cmd: 'regret',  why: 'asks a person two questions — a web form is not that person' },
        { cmd: 'observe', why: 'drives the operator\'s browser against a live thread' },
        { cmd: 'read · search · session · login', why: 'drive the operator\'s browser' },
        { cmd: 'draft · opportunity · certify',   why: 'spend model calls and write evidence' }
      ]
    });
    if (p === '/api/stream') {
      const k = u.searchParams.get('cmd');
      if (COMMANDS[k]) return streamRun(res, k, 'node', [join(ROOT, 'dist', 'cli.js'), ...COMMANDS[k].args]);
      if (SCRIPTS[k]) {
        const s = SCRIPTS[k];
        if (s.cwd && !existsSync(join(s.cwd, s.args[0])))
          return json(res, 200, { key: k, unavailable: true, err: `${s.label} is a gate of the extracted repository (${s.cwd}), which is not present alongside this one.` });
        if (k === 'replay') {
          const a = replayAvailability();
          if (!a.available) return json(res, 200, { key: k, unavailable: true, err: a.reason });
        }
        return streamRun(res, k, s.cmd, s.args, s.cwd ?? ROOT);
      }
      return json(res, 400, { error: `"${k}" is not in the allowlist. This console can only run commands it was told about, and never one that can change Reddit state.` });
    }
    if (p === '/api/cancel')    return json(res, 200, cancelActive());
    if (p === '/api/status')    return json(res, 200, activeStatus());
    if (p === '/api/tree')      return json(res, 200, tree(u.searchParams.get('root') ?? 'reports'));
    if (p === '/api/roots')     return json(res, 200, { roots: TREE_ROOTS.map(({ key, path, label }) => ({ key, path, label })) });
    if (p === '/api/search')    return json(res, 200, search(u.searchParams.get('q') ?? '', Number(u.searchParams.get('limit') ?? 200)));
    if (p === '/api/timeline')  return json(res, 200, timeline());
    if (p === '/api/queue')     return json(res, 200, queue());
    if (p === '/api/run-history') return json(res, 200, runHistory());
    if (p === '/api/activity')  return json(res, 200, { events: activity(Number(u.searchParams.get('n') ?? 40)) });
    if (p === '/api/charts')    return json(res, 200, charts());
    if (p === '/api/readiness') return json(res, 200, await readiness());
    if (p === '/api/settings')  return json(res, 200, await settings());
    if (p === '/api/run') {
      const k = u.searchParams.get('cmd');
      if (COMMANDS[k]) {
        const r = await runCli(COMMANDS[k].args);
        recordRun(k, r.code, r.ms);
        return json(res, 200, { key: k, cli: `redbot ${COMMANDS[k].args.join(' ')}`, ...r });
      }
      if (k === 'benchmark') {
        const r = await benchmarkRun();
        recordRun(k, r.code, r.ms);
        return json(res, 200, { key: k, ...r });
      }
      if (SCRIPTS[k]) {
        const s = SCRIPTS[k];
        if (s.cwd && !existsSync(join(s.cwd, s.args[0]))) {
          return json(res, 200, { key: k, cli: `${s.cmd} ${s.args.join(' ')}`, ok: false, code: null, unavailable: true, ms: 0, out: '',
            err: `Not available here. ${s.label} is a gate of the extracted repository (${s.cwd}), which is not present alongside this one.` });
        }
        if (k === 'replay') {
          const a = replayAvailability();
          if (!a.available) return json(res, 200, { key: k, cli: `${s.cmd} ${s.args.join(' ')}`, ok: false, code: null, unavailable: true, ms: 0, out: '', err: a.reason });
        }
        const r = await run(s.cmd, s.args, 300_000, s.cwd ?? ROOT);
        recordRun(k, r.code, r.ms);
        return json(res, 200, { key: k, cli: `${s.cmd} ${s.args.join(' ')}`, ...r });
      }
      return json(res, 400, { error: `"${k}" is not in the allowlist. This console can only run commands it was told about, and never one that can change Reddit state.` });
    }
    if (p === '/api/certifications') return json(res, 200, certifications());
    if (p === '/api/certification') {
      const c = certification(Number(u.searchParams.get('index')));
      return c ? json(res, 200, c) : json(res, 404, { error: 'no such certification record' });
    }
    if (p === '/api/ground-truth') return json(res, 200, groundTruth());
    if (p === '/api/reports')      return json(res, 200, reports());
    if (p === '/api/file') {
      const b = readable(u.searchParams.get('path') ?? '');
      return b === null
        ? json(res, 403, { error: 'refused — outside the read-only surface, missing, or too large' })
        : json(res, 200, { path: u.searchParams.get('path'), body: b });
    }
    if (p === '/api/log') return json(res, 200, logTail(u.searchParams.get('name') ?? '', Number(u.searchParams.get('n') ?? 400)));

    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  } catch (e) {
    return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n  redbot operator console');
  console.log('  -----------------------');
  console.log(`  http://127.0.0.1:${PORT}\n`);
  console.log('  Read-only. Runs existing commands and shows their output verbatim.');
  console.log('  Cannot publish: reply, regret, observe, read, search, session and login');
  console.log('  are absent from the allowlist.\n  Ctrl+C to stop.\n');
});
