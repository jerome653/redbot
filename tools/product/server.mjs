/**
 * redbot — product console (read-only).
 *
 * The operator workstation at tools/operator/ answers "is the engine sound".
 * This answers the only question an operator actually has: **should this reply go out?**
 *
 * Three rules this server keeps, because redbot's whole thesis depends on them:
 *
 *   1. It reads. It never writes, never executes, never publishes. There is no command
 *      surface at all — not an allow-list, no exec path exists in this file. Publishing
 *      needs a person at a TTY (`reply` refuses non-interactive stdin by design) and this
 *      console will not pretend otherwise; it hands you the command to run.
 *   2. Every number is joined from an append-only log at request time. Nothing is cached,
 *      nothing is stored, so this file cannot invent a figure the logs do not contain.
 *   3. Absent evidence is reported as absent, never as zero-meaning-fine. "Never measured"
 *      and "measured 0" are different states and are rendered differently.
 *
 * data/operators/ is never served — it holds credentials next to evidence.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DATA = join(ROOT, 'data');

const portArg = process.argv.indexOf('--port');
const PORT = portArg > -1 ? Number(process.argv[portArg + 1]) : 7902;

/* ------------------------------------------------------------------ *
 * reading — every accessor reports absence rather than substituting a default
 * ------------------------------------------------------------------ */
const readJson = (p, fallback) => {
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback; }
  catch { return fallback; }
};
const readLines = (p) => {
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
};
const arr = (v, key) => (Array.isArray(v) ? v : (v && Array.isArray(v[key]) ? v[key] : []));
const meta = (rel) => {
  const p = join(DATA, rel);
  if (!existsSync(p)) return { file: 'data/' + rel, exists: false };
  const s = statSync(p);
  return { file: 'data/' + rel, exists: true, bytes: s.size, modified: s.mtime.toISOString() };
};

/* ------------------------------------------------------------------ *
 * state
 * ------------------------------------------------------------------ */
function buildState() {
  const drafts = arr(readJson(join(DATA, 'drafts.json'), []), 'drafts');
  const threads = arr(readJson(join(DATA, 'threads.json'), []), 'threads');
  const assessments = arr(readJson(join(DATA, 'assessments.json'), []), 'assessments');
  const gaps = arr(readJson(join(DATA, 'gaps.json'), []), 'gaps');
  const certs = readLines(join(DATA, 'certifications.jsonl'));
  const history = readLines(join(DATA, 'history.jsonl'));
  const observations = readLines(join(DATA, 'observations.jsonl'));
  const reviews = readLines(join(DATA, 'reviews.jsonl'));
  const regret = readLines(join(DATA, 'regret.jsonl'));

  const threadById = new Map(threads.map((t) => [t.id, t]));

  /* certifications grouped per draft, newest last */
  const certsByDraft = new Map();
  for (const c of certs) {
    if (!certsByDraft.has(c.draftId)) certsByDraft.set(c.draftId, []);
    certsByDraft.get(c.draftId).push(c);
  }

  /**
   * Certification stability.
   *
   * Phase 16 measured the same draft certified repeatedly on a byte-identical build:
   * claim counts of 12 and 16, different provenance, different rules fired, same verdict.
   * Where a draft has more than one certification, the spread is reported next to it —
   * a single certification is a sample, and a console that prints one number as "the"
   * answer teaches the operator to trust it more than the evidence allows.
   */
  const spread = (list) => {
    if (list.length < 2) return null;
    const claims = list.map((c) => (c.claims || []).length);
    const fatal = list.map((c) => (c.contradictions || []).filter((x) => x.fatal).length);
    const verdicts = [...new Set(list.map((c) => c.verdict))];
    return {
      runs: list.length,
      claimsMin: Math.min(...claims), claimsMax: Math.max(...claims), claims,
      fatalMin: Math.min(...fatal), fatalMax: Math.max(...fatal),
      verdicts, verdictStable: verdicts.length === 1
    };
  };

  const review = drafts.map((d) => {
    const list = certsByDraft.get(d.id) || [];
    const last = list[list.length - 1] || null;
    const t = threadById.get(d.threadId) || null;
    const a = assessments.find((x) => x.threadId === d.threadId) || null;
    return {
      id: d.id,
      status: d.status,
      /* what YOU did with it, separate from what redbot did: ignored / read / actioned */
      workflow: (readStatuses()[d.id] || { status: 'none' }),
      title: d.title,
      permalink: d.permalink,
      body: d.body,
      createdAt: d.createdAt,
      model: d.model,
      lintIssues: d.lintIssues || [],
      hasDisclosure: !!d.hasDisclosure,
      thread: t && {
        id: t.id, title: t.title, subreddit: t.subreddit, author: t.author,
        upvotes: t.upvotes, commentCount: t.commentCount, ageText: t.ageText,
        ageMinutes: t.ageMinutes, collectedAt: t.collectedAt,
        body: t.body, permalink: t.permalink,
        comments: (t.comments || []).slice(0, 8).map((c) => ({
          author: c.author, body: c.body, upvotes: c.upvotes, byOriginalPoster: c.byOriginalPoster
        }))
      },
      assessment: a && { verdict: a.verdict, score: a.score, thesis: a.thesis, reasons: a.reasons },
      certification: last && {
        verdict: last.verdict,
        certifiedAt: last.certifiedAt,
        model: last.model,
        claims: last.claims || [],
        contradictions: last.contradictions || [],
        epistemic: last.epistemic || [],
        invalidated: last.invalidated || [],
        resolution: last.resolution || null,
        reasons: last.reasons || [],
        fatal: (last.contradictions || []).filter((c) => c.fatal).length
      },
      certificationRuns: list.length,
      stability: spread(list),
      /* The command a person runs. This console cannot run it — see the header. */
      publishCommand: `REDBOT_OPERATOR=<you> node dist/cli.js reply ${d.id}`
    };
  });

  /* ---- accounts: only what the append-only logs actually name ---- */
  const profiles = readdirSync(DATA, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('chrome-profile'))
    .map((e) => e.name);
  const namedInLogs = [...new Set([
    ...observations.map((o) => o.account),
    ...history.map((h) => h.account)
  ].filter(Boolean))];

  /**
   * Configured accounts, from accounts.json. Kept strictly apart from what has been measured:
   * a handle written in a config file is an intention, a karma reading is a fact. The screen
   * shows both and never lets the first stand in for the second.
   */
  const acctFile = readJson(join(DATA, 'accounts.json'), null);
  const configured = (acctFile && acctFile.accounts) || [];
  const rules = (acctFile && acctFile._rules) || [];

  /* union: everything configured, plus anything the logs name that nobody configured */
  const handles = [...new Set([...configured.map((a) => a.handle), ...namedInLogs])];
  const accounts = handles.map((handle) => {
    const cfg = configured.find((c) => c.handle === handle) || null;
    const mine = observations.filter((o) => o.account === handle);
    const karma = [...mine].reverse().find((o) => o.kind === 'karma') || null;
    const published = history.filter((h) => h.account === handle && h.kind === 'reply').length;
    return {
      handle,
      configured: !!cfg,
      role: cfg ? cfg.role : null,
      speaks: cfg ? cfg.speaks : null,
      knows: cfg ? cfg.knows || [] : [],
      subreddits: cfg ? cfg.subreddits || [] : [],
      timezone: cfg ? cfg.timezone : null,
      quietHours: cfg ? cfg.quietHours : null,
      dailyCeiling: cfg ? cfg.dailyCeiling : null,
      profileDir: cfg ? cfg.profileDir : null,
      debugPort: cfg ? cfg.debugPort : null,
      note: cfg ? cfg.note : null,
      /* a profile folder that actually exists on disk, not merely named in the config */
      profileExists: cfg && cfg.profileDir ? existsSync(join(DATA, cfg.profileDir)) : false,
      karma: karma ? karma.value : null,
      karmaMeasuredAt: karma ? karma.ts : null,
      karmaVector: karma ? karma.vector : null,
      karmaNote: karma ? karma.note : null,
      observations: mine.length,
      published,
      /* karma 1 is exactly the profile new-account filters catch — see ACCOUNT-WARMING.md */
      stage: karma && karma.value < 10 ? 'warming' : karma ? 'established' : 'unmeasured'
    };
  });
  const accountRules = rules;
  /* ports and folders already spoken for, so a new account is never handed a clashing one */
  const takenPorts = configured.map((c) => c.debugPort).filter(Boolean);
  const takenDirs = configured.map((c) => c.profileDir).filter(Boolean);

  const published = history.filter((h) => h.kind === 'reply').length;

  /**
   * Where threads are looked for. Configuration, read from disk — the console turns whatever
   * is switched on into the commands to run. It cannot collect anything itself, and nothing
   * here fires on a schedule; a person runs each command.
   */
  const srcFile = readJson(join(DATA, 'sources.json'), null);
  /* named `collect`, not `sources` — `sources` is already the file-provenance list below */
  const collect = srcFile ? {
    maxPerRun: (srcFile._limits && srcFile._limits.maxThreadsPerRun) || null,
    limitNote: (srcFile._limits && srcFile._limits.note) || null,
    subreddits: srcFile.subreddits || [],
    searches: srcFile.searches || [],
    /* how many threads on file came from each place, so a source that never pays off is visible */
    collected: threads.reduce((m, t) => {
      const k = t.subreddit || 'unknown';
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {})
  } : null;

  return {
    generatedAt: new Date().toISOString(),
    collect,

    pulse: {
      waitingOnYou: drafts.filter((d) => d.status === 'pending').length,
      profilesProvisioned: profiles.length,
      accountsInLogs: accounts.length,
      published,
      operatorDecisions: reviews.length,
      regretReadings: regret.length,
      removals: observations.filter((o) => o.kind === 'removal').length
    },

    review,

    /**
     * The fact-checker's own record, read from the log rather than described.
     *
     * The guide panel explains what the check does; these are what it has actually done. They
     * are computed here so the explanation can never drift from the evidence — a guide that
     * says "nothing has passed yet" while the log says otherwise would be worse than no guide.
     */
    argus: (() => {
      const byVerdict = { REJECT: 0, ESCALATE: 0, CERTIFIED: 0 };
      for (const c of certs) if (c.verdict in byVerdict) byVerdict[c.verdict]++;
      const ruleCounts = {};
      for (const c of certs) for (const r of c.reasons || []) ruleCounts[r.rule] = (ruleCounts[r.rule] || 0) + 1;
      const repeated = [...certsByDraft.values()].filter((l) => l.length > 1);
      return {
        runs: certs.length,
        draftsChecked: certsByDraft.size,
        byVerdict,
        everCertified: byVerdict.CERTIFIED > 0,
        topReasons: Object.entries(ruleCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([rule, n]) => ({ rule, n })),
        /** Drafts checked more than once — the only place a stability claim can come from. */
        draftsCheckedTwice: repeated.length,
        claimSpread: repeated.map((l) => l.map((c) => (c.claims || []).length))
      };
    })(),

    discovery: {
      threadsCollected: threads.length,
      assessed: assessments.length,
      contribute: assessments.filter((a) => a.verdict === 'contribute').length,
      skip: assessments.filter((a) => a.verdict === 'skip').length,
      gapsAnalysed: gaps.length,
      drafted: drafts.length,
      items: assessments
        .slice()
        .sort((x, y) => y.score - x.score)
        .map((a) => {
          const t = threadById.get(a.threadId);
          const d = drafts.find((x) => x.threadId === a.threadId);
          return {
            threadId: a.threadId, title: a.title, permalink: a.permalink,
            verdict: a.verdict, score: a.score, thesis: a.thesis, reasons: a.reasons || [],
            subreddit: t ? t.subreddit : null,
            comments: t ? t.commentCount : null,
            ageText: t ? t.ageText : null,
            draftId: d ? d.id : null,
            draftStatus: d ? d.status : null
          };
        })
    },

    accounts,
    profiles,
    accountRules,
    /* everything the "add an account" panel needs to hand over exact, non-clashing commands */
    newAccount: {
      dataDir: DATA,
      nextPort: (takenPorts.length ? Math.max(...takenPorts) : 9221) + 1,
      takenPorts,
      takenDirs,
      suggestedDir: `chrome-profile-${String.fromCharCode(98 + Math.max(0, takenDirs.length - 1))}`
    },

    outcomes: {
      published,
      observations: observations.map((o) => ({ ts: o.ts, account: o.account, kind: o.kind, value: o.value, vector: o.vector, note: o.note })),
      reviews: reviews.length,
      regret: regret.length,
      /* Everything Outcomes exists to show is downstream of a published reply. */
      blockedBy: published === 0 ? 'nothing has been published' : null
    },

    activity: history.slice(-40).reverse().map((h) => ({ ts: h.ts, kind: h.kind, summary: h.summary })),

    sources: [
      meta('drafts.json'), meta('threads.json'), meta('assessments.json'), meta('gaps.json'),
      meta('certifications.jsonl'), meta('history.jsonl'), meta('observations.jsonl'),
      meta('reviews.jsonl'), meta('regret.jsonl'), meta('sources.json')
    ]
  };
}

/* ------------------------------------------------------------------ *
 * Actions
 *
 * The console runs redbot for you. What it will not do is publish without a person
 * deciding — but "a person deciding" is a typed confirmation, not a terminal. The original
 * rule (DEFECT-08) was that an approval must FAIL CLOSED; requiring a shell was one way to
 * get that and it turned out to be the expensive way. A click plus a typed word is a
 * decision, it is recorded, and it is attributable. That is the guarantee kept here.
 *
 * `reply` is not in this list. Publishing has its own endpoint with its own confirmation.
 * ------------------------------------------------------------------ */
const ACTIONS = {
  'find-threads':   { args: (o) => ['read', String(o.subreddit || 'WordPress')], label: 'look for new threads' },
  'find-search':    { args: (o) => ['search', String(o.query || '')],            label: 'run a saved search' },
  'score':          { args: () => ['opportunity'],                               label: 'score what came back' },
  'write':          { args: (o) => ['draft', ...(o.threadId ? [String(o.threadId)] : [])], label: 'write a reply' },
  'check':          { args: (o) => ['certify', ...(o.draftId ? [String(o.draftId)] : []), ...(o.override ? ['--override'] : [])], label: 'fact-check a reply' },
  'check-karma':    { args: () => ['probe-karma'],                               label: 'check karma' },
  /**
   * Publishing. Deliberately named with a leading underscore and NOT reachable from
   * /api/run — the only caller is publish(), which will not proceed without the typed
   * confirmation and which writes the single-use approval token first.
   */
  '__reply':        { args: (o) => ['reply', String(o.draftId || '')],           label: 'send the reply' }
};
const PUBLIC_ACTIONS = Object.keys(ACTIONS).filter((k) => !k.startsWith('__'));

let running = null;   // one at a time — two runs against the same data files corrupt each other

function runAction(key, opts) {
  return new Promise((resolve) => {
    const spec = ACTIONS[key];
    if (!spec) return resolve({ ok: false, error: `unknown action: ${key}` });
    if (running) return resolve({ ok: false, error: `"${running}" is still running` });

    const args = spec.args(opts || {}).filter((a) => a !== '');
    running = key;
    const started = Date.now();
    /**
     * Who runs it, and as whom.
     *
     * The operator (whose Claude credentials pay for the model calls) comes from the shell
     * this server was started in — never from the browser, which cannot be trusted to name
     * a billing identity. The ACCOUNT (whose Reddit browser is driven) does come from the
     * request, because that is a per-click choice, and config.ts validates the name against
     * accounts.json before anything runs.
     */
    const env = { ...process.env };
    if (opts && opts.account) env.REDBOT_ACCOUNT = String(opts.account);
    if (opts && opts.cdp) env.REDBOT_CDP = String(opts.cdp);

    const child = spawn(process.execPath, [join(ROOT, 'dist', 'cli.js'), ...args], {
      cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, 20 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer); running = null;
      resolve({ ok: code === 0, code, ms: Date.now() - started, output: (out + err).slice(-24000), command: `redbot ${args.join(' ')}` });
    });
    child.on('error', (e) => {
      clearTimeout(timer); running = null;
      resolve({ ok: false, error: String(e && e.message || e) });
    });
  });
}

/* ------------------------------------------------------------------ *
 * Setting up an account, without a terminal.
 *
 * The person's only job is to type their own Reddit password into a real Chrome window.
 * Everything around that — picking a free port, making the folder, launching Chrome with
 * the right flags, writing the config — is clerical, and asking a non-technical operator to
 * paste PowerShell to do clerical work is how a tool ends up unused.
 *
 * What is NOT automated, deliberately: the sign-in itself. redbot never sees or stores a
 * password, and an account nobody signed into is not really yours.
 * ------------------------------------------------------------------ */
const accountsPath = join(DATA, 'accounts.json');

function chromeBinary() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.CHROME_PATH
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
}

function createAccount(body) {
  const handle = String(body.handle || '').trim();
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(handle)) {
    return { ok: false, error: 'A Reddit username is 3–20 characters: letters, numbers, underscore or dash.' };
  }
  const file = readJson(accountsPath, null);
  if (!file || !Array.isArray(file.accounts)) return { ok: false, error: 'accounts.json is missing or malformed.' };
  if (file.accounts.some((a) => a.handle.toLowerCase() === handle.toLowerCase())) {
    return { ok: false, error: `${handle} is already set up.` };
  }
  const ports = file.accounts.map((a) => a.debugPort).filter(Boolean);
  const dirs = file.accounts.map((a) => a.profileDir).filter(Boolean);
  const port = (ports.length ? Math.max(...ports) : 9221) + 1;
  let dir, i = dirs.length;
  do { dir = `chrome-profile-${String.fromCharCode(97 + i)}`; i++; } while (dirs.includes(dir));

  const entry = {
    handle,
    role: String(body.role || 'Support'),
    speaks: String(body.speaks || ''),
    knows: Array.isArray(body.knows) ? body.knows.map(String) : [],
    subreddits: Array.isArray(body.subreddits) && body.subreddits.length ? body.subreddits.map(String) : ['WordPress'],
    timezone: String(body.timezone || 'Asia/Manila'),
    quietHours: [0, 8],
    dailyCeiling: 1,
    profileDir: dir,
    debugPort: port,
    createdBy: 'console',
    createdAt: new Date().toISOString(),
    note: String(body.note || 'Added from the console.')
  };
  file.accounts.push(entry);
  writeFileSync(accountsPath, JSON.stringify(file, null, 2), 'utf8');
  return { ok: true, account: entry };
}

/** Opens that account's own Chrome. Detached — closing the console must not close it. */
function launchChrome(handle) {
  const file = readJson(accountsPath, null);
  const a = (file && file.accounts || []).find((x) => x.handle === handle);
  if (!a) return { ok: false, error: `${handle} is not set up.` };
  const bin = chromeBinary();
  if (!bin) return { ok: false, error: 'Chrome could not be found in the usual place. Set CHROME_PATH and try again.' };
  const dir = join(DATA, a.profileDir);
  try {
    const child = spawn(bin, [
      `--remote-debugging-port=${a.debugPort}`,
      `--user-data-dir=${dir}`,
      '--no-first-run', '--no-default-browser-check',
      'https://www.reddit.com/login'
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, handle, port: a.debugPort, profileDir: a.profileDir };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* ------------------------------------------------------------------ *
 * The unattended loop.
 *
 * Held separately from `running` (the one-at-a-time action lock) because this is long-lived
 * by design and must not block a person from pressing a button. It is a child process, not a
 * timer in here — so if this console is closed or crashes, the loop is unaffected, and
 * killing the loop cannot take the console down with it.
 * ------------------------------------------------------------------ */
let autoProc = null;
let autoLog = [];

function autoStart({ account, everyMinutes }) {
  if (autoProc) return { ok: false, error: 'The unattended loop is already running.' };
  if (!account) return { ok: false, error: 'Choose which account it should run as.' };
  const every = Math.max(15, Number(everyMinutes) || 60);
  autoLog = [];
  const child = spawn(process.execPath, [join(ROOT, 'dist', 'cli.js'), 'auto', '--every', String(every)], {
    cwd: ROOT, env: { ...process.env, REDBOT_ACCOUNT: String(account) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const keep = (d) => {
    autoLog.push(String(d).replace(/\[[0-9;]*m/g, ''));
    if (autoLog.length > 400) autoLog = autoLog.slice(-400);   // bounded: this runs for days
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('close', (code) => { keep(`\n[loop stopped, exit ${code}]\n`); autoProc = null; });
  child.on('error', (e) => { keep(`\n[loop failed to start: ${e.message}]\n`); autoProc = null; });
  autoProc = { child, account: String(account), every, startedAt: new Date().toISOString() };
  return { ok: true, ...autoStatus() };
}

function autoStop() {
  if (!autoProc) return { ok: false, error: 'The loop is not running.' };
  try { autoProc.child.kill(); } catch { /* already gone */ }
  autoProc = null;
  return { ok: true, ...autoStatus() };
}

function autoStatus() {
  return {
    running: !!autoProc,
    account: autoProc ? autoProc.account : null,
    everyMinutes: autoProc ? autoProc.every : null,
    startedAt: autoProc ? autoProc.startedAt : null,
    log: autoLog.join('').split('\n').filter(Boolean).slice(-40)
  };
}

/* ---- per-reply workflow state: ignore / read / actioned ---- */
const statusPath = join(DATA, 'ui-status.json');
const readStatuses = () => readJson(statusPath, {});
function setStatus(draftId, status, note) {
  const allowed = ['none', 'ignored', 'read', 'actioned'];
  if (!allowed.includes(status)) return { ok: false, error: `status must be one of ${allowed.join(', ')}` };
  const all = readStatuses();
  if (status === 'none') delete all[draftId];
  else all[draftId] = { status, note: note || '', at: new Date().toISOString() };
  writeFileSync(statusPath, JSON.stringify(all, null, 2), 'utf8');
  return { ok: true, statuses: all };
}

/* ---- publishing: the one action that reaches the outside world ---- */
function publish(body) {
  const { draftId, confirm, reason } = body || {};
  if (!draftId) return Promise.resolve({ ok: false, error: 'no draft named' });
  /* fail closed: anything other than the exact word is a refusal, never an approval */
  if (confirm !== 'SEND') return Promise.resolve({ ok: false, error: 'not confirmed — type SEND exactly' });
  /* The decision is recorded first, and separately. If the send then fails, the fact that a
     person approved it must still be on the record. */
  appendFileSync(join(DATA, 'decisions.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), draftId, decision: 'approved', reason: reason || '', via: 'console' }) + '\n', 'utf8');

  /* One draft, five minutes, consumed on read — see takeConsoleApproval in src/ask.ts */
  const dir = join(DATA, 'approvals');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${draftId}.json`),
    JSON.stringify({ draftId, decision: 'approved', note: reason || '', at: new Date().toISOString() }, null, 2), 'utf8');

  return runAction('__reply', { draftId, account: body.account })
    .then((r) => ({ ...r, recorded: true }));
}

/* ------------------------------------------------------------------ */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  if (req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { return send(400, JSON.stringify({ error: 'bad JSON' })); }

      if (url.pathname === '/api/run') {
        if (!PUBLIC_ACTIONS.includes(body.key)) {
          return send(400, JSON.stringify({ ok: false, error: `"${body.key}" cannot be run from here` }));
        }
        const r = await runAction(body.key, body);
        return send(r.ok ? 200 : 409, JSON.stringify(r));
      }
      if (url.pathname === '/api/status') {
        const r = setStatus(body.draftId, body.status, body.note);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/auto/start') {
        const r = autoStart(body);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/auto/stop') {
        const r = autoStop();
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/sources/add') {
        const kind = body.kind === 'search' ? 'search' : 'subreddit';
        const value = String(body.value || '').trim().replace(/^\/?r\//i, '');
        if (!value) return send(400, JSON.stringify({ ok: false, error: 'Nothing to add.' }));
        if (kind === 'subreddit' && !/^[A-Za-z0-9_]{2,21}$/.test(value)) {
          return send(400, JSON.stringify({ ok: false, error: 'A subreddit name is 2–21 characters: letters, numbers or underscore.' }));
        }
        const file = readJson(join(DATA, 'sources.json'), null);
        if (!file) return send(400, JSON.stringify({ ok: false, error: 'sources.json is missing.' }));
        const list = kind === 'search' ? (file.searches ||= []) : (file.subreddits ||= []);
        const key = kind === 'search' ? 'query' : 'name';
        if (list.some((x) => String(x[key]).toLowerCase() === value.toLowerCase())) {
          return send(400, JSON.stringify({ ok: false, error: `${value} is already on the list.` }));
        }
        list.push({ [key]: value, why: String(body.why || 'Added from the console.'), enabled: true });
        writeFileSync(join(DATA, 'sources.json'), JSON.stringify(file, null, 2), 'utf8');
        return send(200, JSON.stringify({ ok: true, kind, value }));
      }
      if (url.pathname === '/api/sources/remove') {
        const kind = body.kind === 'search' ? 'search' : 'subreddit';
        const value = String(body.value || '');
        const file = readJson(join(DATA, 'sources.json'), null);
        if (!file) return send(400, JSON.stringify({ ok: false, error: 'sources.json is missing.' }));
        const key = kind === 'search' ? 'query' : 'name';
        const list = kind === 'search' ? (file.searches || []) : (file.subreddits || []);
        const i = list.findIndex((x) => String(x[key]) === value);
        if (i < 0) return send(400, JSON.stringify({ ok: false, error: 'Not on the list.' }));
        list.splice(i, 1);
        writeFileSync(join(DATA, 'sources.json'), JSON.stringify(file, null, 2), 'utf8');
        return send(200, JSON.stringify({ ok: true }));
      }
      if (url.pathname === '/api/account/create') {
        const r = createAccount(body);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/account/open') {
        const r = launchChrome(String(body.handle || ''));
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/publish') {
        const r = await publish(body);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      return send(404, JSON.stringify({ error: 'not found' }));
    });
    return;
  }

  if (req.method !== 'GET') return send(405, JSON.stringify({ error: 'unsupported method' }));

  /**
   * Live health. Polled by the console so a disconnect is visible where the work happens,
   * rather than surfacing later as a command that mysteriously fails.
   *
   * Everything here is probed at request time. Nothing is remembered between calls, so this
   * cannot report a browser as reachable because it was reachable a minute ago.
   */
  if (url.pathname === '/api/pulse') {
    const file = readJson(accountsPath, null);
    const accts = (file && file.accounts) || [];
    Promise.all(accts.map(async (a) => {
      let up = false, detail = 'no debugging port answered';
      try {
        const res = await fetch(`http://127.0.0.1:${a.debugPort}/json/version`, { signal: AbortSignal.timeout(1200) });
        up = res.ok;
        if (up) { const j = await res.json().catch(() => ({})); detail = j.Browser || 'connected'; }
      } catch { up = false; }
      return {
        handle: a.handle, port: a.debugPort, browserUp: up, detail,
        profileOnDisk: existsSync(join(DATA, a.profileDir || ''))
      };
    })).then((browsers) => {
      const problems = [];
      for (const b of browsers) {
        if (!b.profileOnDisk) problems.push(`${b.handle}: its browser folder is missing`);
        else if (!b.browserUp) problems.push(`${b.handle}: browser is not open`);
      }
      if (!existsSync(join(ROOT, 'dist', 'cli.js'))) problems.push('redbot is not built — run npm run build');
      send(200, JSON.stringify({
        at: new Date().toISOString(), running, browsers, problems,
        auto: autoStatus(),
        healthy: problems.length === 0
      }));
    }).catch((e) => send(500, JSON.stringify({ error: String(e && e.message || e) })));
    return;
  }

  if (url.pathname === '/api/actions') {
    return send(200, JSON.stringify({
      running,
      actions: PUBLIC_ACTIONS.map((key) => ({ key, label: ACTIONS[key].label }))
    }));
  }

  if (url.pathname === '/api/state') {
    try { return send(200, JSON.stringify(buildState())); }
    catch (e) { return send(500, JSON.stringify({ error: String(e && e.message || e) })); }
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const f = join(HERE, 'index.html');
    if (!existsSync(f)) return send(404, 'index.html missing', 'text/plain');
    return send(200, readFileSync(f), TYPES['.html']);
  }

  send(404, JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(
    `redbot product console\n` +
    `  http://localhost:${PORT}\n` +
    `  read-only — no command surface exists in this server.\n` +
    `  Publishing needs a person at a terminal: node dist/cli.js reply <draftId>\n` +
    `  Ctrl+C to stop.\n`
  );
});
