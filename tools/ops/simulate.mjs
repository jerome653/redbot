/**
 * What happens to this install after it has been running for a month, not for a cycle.
 *
 * ---------------------------------------------------------------------------
 * WHY A SIMULATOR RATHER THAN A TEST.
 *
 * `npm test` answers "does this function do what it says". It cannot answer "does this install
 * survive 4,380 cycles", because every failure of that kind is a RATE multiplied by a DURATION
 * and the test suite has neither. Every defect this file exists to catch was invisible on cycle
 * one and fatal on cycle ten thousand:
 *
 *   * a table that gains 698 rows per cycle and is never pruned
 *   * a read of that table with no LIMIT, in a command an operator runs when worried
 *   * one append-only log file per process, in a process designed to run for days
 *
 * The rates below are MEASURED on this install, not assumed, and each one names where it came
 * from. A projection from an invented rate is worth nothing.
 *
 *   node tools/ops/simulate.mjs            run every simulation, print a verdict each
 *   node tools/ops/simulate.mjs --json     the same, as JSON
 *
 * EXIT 0 when every simulation passes, 1 when any fails. That is what makes it usable as a gate
 * before starting the unattended loop rather than a report somebody reads afterwards.
 *
 * ---------------------------------------------------------------------------
 * THE BUDGETS ARE DECLARED, AND THAT IS THE POINT.
 *
 * "Is 648 MB a lot" is not a question code can answer, so this file does not pretend to. It
 * states a budget, says where the number came from, and reports the measured projection against
 * it. A budget somebody disagrees with is a line to edit; a projection with no budget is a
 * number nobody acts on.
 */
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DB = process.env.REDBOT_DB ?? join(ROOT, 'data', 'redbot.db');
const DATA = process.env.REDBOT_DATA ?? dirname(DB);
const JSON_OUT = process.argv.includes('--json');

/** How often the unattended loop runs, in minutes. The value `autoStart` defaults callers to. */
const INTERVAL_MIN = Number(process.env.SIM_INTERVAL_MIN ?? 120);
/** Horizons reported for every growth simulation. */
const HORIZONS = [[7, '7d'], [30, '30d'], [90, '90d'], [365, '1y']];

/* ---------------- budgets, declared ---------------- */
const BUDGET = {
  /** The database after a year. Past this a `VACUUM` is a maintenance window, not a command. */
  dbBytesAt1y: 250_000_000,
  /** Rows any single unbounded SELECT may return. Above this a read is a hazard, not a query. */
  unboundedRows: 100_000,
  /** One run-log file after a year. Past this, opening it in the console is a denial of service. */
  runLogBytesAt1y: 50_000_000,
  /** Restarts the watchdog may issue in a day, however the history moves underneath it. */
  restartsPerDay: 8
};

const results = [];
const say = (s) => { if (!JSON_OUT) console.log(s); };
function verdict(name, pass, detail, facts = {}) {
  results.push({ name, pass, detail, ...facts });
  say(`${pass ? '  PASS  ' : '  FAIL  '}${name}`);
  for (const line of String(detail).split('\n')) say(`          ${line}`);
}

/* ================================================================== *
 * SIM 1 — the scheduler over 30 days
 *
 * The question: at a 120-minute interval with quiet hours and a daily ceiling, does the loop
 * ever exceed its cap, and does the day roll over in the ACCOUNT'S timezone rather than UTC?
 *
 * Driven through the real `checkWindow`, with `repliesToday` maintained the way `counters()`
 * maintains it — bucketed by the account's local day. Run at the WORST CASE (every allowed cycle
 * produces a publishable reply), because a cap is a claim about the worst case and nothing else.
 * ================================================================== */
async function simScheduler() {
  const { checkWindow } = await import(join(ROOT, 'dist', 'window.js'));
  const { policy } = await import(join(ROOT, 'dist', 'policy.js'));
  const cap = policy.maxRepliesPerDay.value;

  const account = {
    handle: 'sim', timezone: 'America/Los_Angeles', quietHours: [0, 8], dailyCeiling: 10
  };
  const dayKey = (d) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: account.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(d);

  const perDay = new Map();
  let allowed = 0, skipped = 0;
  const skipRules = new Map();
  const start = Date.UTC(2026, 9, 17, 0, 0, 0);
  const cycles = Math.floor((30 * 24 * 60) / INTERVAL_MIN);

  for (let i = 0; i < cycles; i++) {
    const now = new Date(start + i * INTERVAL_MIN * 60_000);
    const k = dayKey(now);
    const repliesToday = perDay.get(k) ?? 0;
    const v = checkWindow({ account, repliesToday, now });
    if (v.allowed) { allowed++; perDay.set(k, repliesToday + 1); }
    else { skipped++; skipRules.set(v.rule, (skipRules.get(v.rule) ?? 0) + 1); }
  }

  const counts = [...perDay.values()];
  const over = counts.filter((n) => n > cap);
  const days = perDay.size;

  verdict(
    'SIM 1 — 30 days of scheduling never exceeds the daily cap',
    over.length === 0,
    `cap ${cap}/day · ${cycles} cycles at ${INTERVAL_MIN}min · ${allowed} acted, ${skipped} skipped\n`
    + `days counted ${days} · max in any day ${Math.max(...counts, 0)} · days over cap ${over.length}\n`
    + `skip reasons: ${[...skipRules].map(([r, n]) => `${r}=${n}`).join(', ')}`,
    { cap, cycles, allowed, skipped, maxPerDay: Math.max(...counts, 0), days }
  );

  /* A loop that skips every cycle forever is the failure mode this install spent eleven days in,
     and it writes an `auto.skip` row each time. Reaching the cap is the intended ceiling; never
     acting at all is not. */
  verdict(
    'SIM 1b — the loop actually acts, rather than skipping forever',
    allowed > 0 && allowed >= days,
    `${allowed} acting cycles across ${days} days (at least one per day expected)`,
    { allowed, days }
  );
}

/* ================================================================== *
 * SIM 2 — table growth from the measured per-cycle rate
 * ================================================================== */
function simTableGrowth() {
  if (!existsSync(DB)) { verdict('SIM 2 — table growth', false, `no database at ${DB}`); return; }
  const db = new DatabaseSync(DB, { readOnly: true });
  const one = (sql) => Object.values(db.prepare(sql).get() ?? {})[0];

  /* The rate comes from this install's own record: rows divided by the cycles that wrote them. */
  const cyclesSoFar = one("SELECT count(*) AS n FROM history WHERE kind = 'auto.cycle'");
  const historyRows = one('SELECT count(*) AS n FROM history');
  const traceRows = one('SELECT count(*) AS n FROM trace');
  /* dbstat is a virtual table compiled into SQLite; `pgsize` is bytes actually occupied. */
  let traceBytes = 0;
  try { traceBytes = one("SELECT sum(pgsize) AS n FROM dbstat WHERE name = 'trace'") ?? 0; } catch { traceBytes = 0; }
  db.close();

  if (!cyclesSoFar) {
    verdict('SIM 2 — table growth', false,
      'no auto.cycle rows on record, so there is no measured rate to project from');
    return;
  }

  const tracePerCycle = traceRows / cyclesSoFar;
  const historyPerCycle = historyRows / cyclesSoFar;
  const bytesPerTraceRow = traceRows ? traceBytes / traceRows : 0;
  const cyclesPerDay = (24 * 60) / INTERVAL_MIN;
  const dbNow = statSync(DB).size;

  const lines = [
    `measured: ${cyclesSoFar} cycles -> ${traceRows.toLocaleString()} trace (${tracePerCycle.toFixed(0)}/cycle),`
    + ` ${historyRows.toLocaleString()} history (${historyPerCycle.toFixed(0)}/cycle)`,
    `trace costs ${bytesPerTraceRow.toFixed(0)} bytes/row (dbstat) · db is ${(dbNow / 1e6).toFixed(0)} MB now`
  ];
  /**
   * THE RETENTION CAP IS WHAT BOUNDS THIS, so it is read from the code rather than assumed.
   *
   * `src/commands/auto.ts` prunes once per cycle to `TRACE_KEEP`. Without that the projection
   * below is the whole answer and it ends at ~672 MB; with it the table plateaus and the
   * projection is only interesting up to the point it reaches the cap.
   */
  const autoSrc = readFileSync(join(ROOT, 'src', 'commands', 'auto.ts'), 'utf8');
  const keepM = /REDBOT_TRACE_KEEP\s*\?\?\s*([0-9_]+)/.exec(autoSrc);
  const keep = keepM ? Number(keepM[1].replace(/_/g, '')) : Infinity;
  const prunes = /pruneTrace\(/.test(autoSrc);

  const otherBytes = Math.max(0, dbNow - traceBytes);
  let at1y = dbNow;
  for (const [days, label] of HORIZONS) {
    const cy = cyclesPerDay * days;
    const grown = traceRows + cy * tracePerCycle;
    /* Capped when the loop prunes: the table cannot hold more than `keep` rows at the end of any
       cycle, so the projection is min(grown, keep) rather than the raw sum. */
    const rows = prunes ? Math.min(grown, keep) : grown;
    const bytes = otherBytes + rows * bytesPerTraceRow;
    if (days === 365) at1y = bytes;
    lines.push(`  ${label.padEnd(4)} ${Math.round(cy).toLocaleString().padStart(6)} cycles`
      + ` -> trace ${Math.round(rows).toLocaleString().padStart(10)} rows`
      + (prunes && grown > keep ? ' (at cap)' : '')
      + ` · db ~${(bytes / 1e6).toFixed(0)} MB`);
  }

  verdict(
    'SIM 2 — the database stays inside its one-year budget',
    at1y <= BUDGET.dbBytesAt1y,
    lines.join('\n')
    + `\nretention: ${prunes ? `pruned every cycle to ${keep.toLocaleString()} rows` : 'NONE — the table grows forever'}`
    + `\nbudget ${(BUDGET.dbBytesAt1y / 1e6).toFixed(0)} MB at 1y`,
    { tracePerCycle, historyPerCycle, bytesAt1y: Math.round(at1y), keep, prunes }
  );
}

/* ================================================================== *
 * SIM 3 — an unbounded read of a growing table
 *
 * Not a projection: the call is either bounded or it is not, and this asserts which. The row
 * count is then what says how bad an unbounded one is.
 * ================================================================== */
async function simUnboundedReads() {
  if (!existsSync(DB)) { verdict('SIM 3 — unbounded reads', false, `no database at ${DB}`); return; }
  const db = new DatabaseSync(DB, { readOnly: true });
  const traceRows = Object.values(db.prepare('SELECT count(*) AS n FROM trace').get() ?? {})[0];
  db.close();

  const cyclesPerDay = (24 * 60) / INTERVAL_MIN;
  const perCycle = 698;   // SIM 2 measures this; repeated here only to size the projection
  const at1y = traceRows + cyclesPerDay * 365 * perCycle;

  /* `loadTrace()` is the call. Bounded means it passes a limit to `selectTrace`; src/db/logs.ts
     `tail()` returns `ORDER BY id` with no LIMIT when none is given. Read as source rather than
     executed, because executing the unbounded version is the thing being guarded against. */
  const src = readFileSync(join(ROOT, 'src', 'trace.js').replace(/\.js$/, '.ts'), 'utf8');
  const call = /export async function loadTrace\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(src);
  const body = call ? call[1] : '';
  const bounded = /limit/i.test(body);

  verdict(
    'SIM 3 — loadTrace() is bounded, so a grown trace table cannot be loaded whole',
    bounded,
    `trace is ${traceRows.toLocaleString()} rows now and ~${Math.round(at1y).toLocaleString()} at 1y\n`
    + `loadTrace() body: ${body.trim().replace(/\s+/g, ' ').slice(0, 120) || '(not found)'}\n`
    + `callers: src/insights.ts, src/commands/doctor.ts — both run on an operator's command\n`
    + `budget ${BUDGET.unboundedRows.toLocaleString()} rows for any unbounded read`,
    { traceRows, rowsAt1y: Math.round(at1y), bounded }
  );
}

/* ================================================================== *
 * SIM 4 — the run log of a process that runs for days
 *
 * Rate measured from the longest real `auto` run on this disk, not assumed.
 * ================================================================== */
function simRunLog() {
  const dir = join(DATA, 'run-logs');
  if (!existsSync(dir)) { verdict('SIM 4 — run-log growth', false, `no run-logs at ${dir}`); return; }

  /* The longest-running `auto` log: its last `at` is milliseconds since the run began, so the
     file carries its own duration and the rate needs no clock. */
  let best = null;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    let head, lastAt = 0, lines = 0;
    try {
      const raw = readFileSync(join(dir, f), 'utf8');
      const rows = raw.split('\n').filter((l) => l.trim());
      head = JSON.parse(rows[0]);
      if (head.key !== 'auto') continue;
      lines = rows.length;
      for (let i = rows.length - 1; i >= 1; i--) {
        try { const o = JSON.parse(rows[i]); if (typeof o.at === 'number') { lastAt = o.at; break; } } catch { /* torn */ }
      }
      const size = statSync(join(dir, f)).size;
      const hours = lastAt / 3_600_000;
      if (hours > 0.5 && (!best || hours > best.hours)) best = { f, size, hours, lines };
    } catch { /* unreadable: not a measurement */ }
  }

  if (!best) {
    verdict('SIM 4 — run-log growth', false,
      'no `auto` run longer than 30 minutes on disk, so there is no measured rate to project from');
    return;
  }

  const bph = best.size / best.hours;
  const lph = best.lines / best.hours;
  const at1y = bph * 24 * 365;
  const lines = [
    `measured on ${best.f}: ${best.size.toLocaleString()} bytes, ${best.lines.toLocaleString()} lines,`
    + ` over ${best.hours.toFixed(1)}h -> ${Math.round(bph).toLocaleString()} bytes/h`,
    ...HORIZONS.map(([d, l]) =>
      `  ${l.padEnd(4)} ${(bph * 24 * d / 1e6).toFixed(1).padStart(7)} MB`
      + ` · ${Math.round(lph * 24 * d).toLocaleString().padStart(11)} lines in ONE file`),
    `budget ${(BUDGET.runLogBytesAt1y / 1e6).toFixed(0)} MB for a single file at 1y`
  ];

  /* The projection is what the rate WOULD produce in one file. What bounds a file now is the
     rotation cap in src/run-log.ts, so that is what this asserts — the rate is reported beside it
     because it is what makes the cap necessary. */
  const rl = readFileSync(join(ROOT, 'src', 'run-log.ts'), 'utf8');
  const capM = /RUN_LOG_MAX_BYTES\s*=\s*Number\(process\.env\.REDBOT_RUN_LOG_MAX_BYTES\s*\?\?\s*([0-9_]+)\)/.exec(rl);
  const fileCap = capM ? Number(capM[1].replace(/_/g, '')) : Infinity;
  const rolls = /function roll\(\)/.test(rl);

  verdict('SIM 4 — one run-log file stays inside its budget',
    rolls && fileCap <= BUDGET.runLogBytesAt1y,
    lines.join('\n')
    + `\nrotation: ${rolls ? `rolls at ${(fileCap / 1e6).toFixed(0)} MB` : 'NONE — one file for the whole run'}`
    + `\n  -> ${rolls ? `~${Math.ceil(at1y / fileCap)} file(s) a year, each openable` : 'a single file of the size above'}`,
    { bytesPerHour: Math.round(bph), bytesAt1y: Math.round(at1y), fileCap, rolls });

  /* THE CONTRADICTION, asserted rather than described: the live buffer is capped because `auto`
     prints for days, and the on-disk reader of the same file is not. */
  const server = readFileSync(join(ROOT, 'tools', 'product', 'server.mjs'), 'utf8');
  const liveCap = /RUN_LOG_MAX\s*=\s*(\d+)/.exec(server);
  const readerFn = /function runLogRead\(file\)\s*\{([\s\S]*?)\n\}/.exec(server);
  const readerBody = readerFn ? readerFn[1] : '';
  const readerBounded = /RUN_LOG_READ_MAX|slice\(-|\.slice\(\s*-/.test(readerBody);

  verdict(
    'SIM 4b — the on-disk run-log reader is bounded like the live buffer is',
    readerBounded,
    `live buffer cap: RUN_LOG_MAX = ${liveCap ? liveCap[1] : '(not found)'} lines\n`
    + `runLogRead(): ${readerBounded ? 'bounded' : 'returns every line of the file, with no cap'}\n`
    + `the file it reads is the one measured above`,
    { liveCap: liveCap ? Number(liveCap[1]) : null, readerBounded }
  );
}

/* ================================================================== *
 * SIM 5 — the watchdog across a long, adversarial timeline
 *
 * Four histories, each run through the real `stall-watch.mjs` with `--dry-run`, counting how many
 * restarts it WOULD issue. The third is the one worth having: a loop that writes exactly one row
 * per boot and then hangs moves `T_work` every time, so a per-T_work budget resets on every
 * restart and cannot bound anything.
 * ================================================================== */
function simWatchdog() {
  const WATCH = join(HERE, 'stall-watch.mjs');
  const HISTORY_DDL = `CREATE TABLE history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL)`;
  const MIN = 60_000;
  const LOOP = { cursors: {}, autoLoop: { account: 'sim', everyMinutes: INTERVAL_MIN } };

  /** One tick: build the install, run the watchdog, say whether it would restart. */
  function tick(rows, state, ledger) {
    const dir = mkdtempSync(join(tmpdir(), 'redbot-sim-'));
    try {
      const db = join(dir, 'redbot.db');
      const h = new DatabaseSync(db);
      h.exec(HISTORY_DDL);
      const ins = h.prepare('INSERT INTO history (ts, kind, summary) VALUES (?,?,?)');
      for (const r of rows) ins.run(r.ts, r.kind, 'x');
      h.close();
      writeFileSync(join(dir, 'push-state.json'), JSON.stringify(state), 'utf8');
      if (ledger) writeFileSync(join(dir, 'stall-watch.json'), JSON.stringify(ledger), 'utf8');
      const out = execFileSync(process.execPath, [WATCH, '--dry-run'], {
        encoding: 'utf8', env: { ...process.env, REDBOT_DB: db, REDBOT_DATA: dir }
      });
      let next = ledger;
      try { next = JSON.parse(readFileSync(join(dir, 'stall-watch.json'), 'utf8')); } catch { /* none written */ }
      return { would: /would restart/.test(out), out, ledger: next };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

  /* (a) healthy: every cycle closes. No restart, ever. */
  const healthy = tick([
    { ts: iso(150 * MIN), kind: 'draft' }, { ts: iso(140 * MIN), kind: 'auto.cycle' }
  ], LOOP, null);

  /* (b) permanent hang, 24h of ticks. The budget must stop it. */
  const frozen = [
    { ts: iso(2000 * MIN), kind: 'auto.cycle' }, { ts: iso(1990 * MIN), kind: 'session.view' }
  ];
  let ledger = null, restartsB = 0;
  for (let i = 0; i < Math.floor((24 * 60) / 15); i++) {
    const r = tick(frozen, LOOP, ledger);
    /* --dry-run does not spend the budget, so the spend is modelled here exactly as the real
       path does it: written before the action, including the rolling rate window guard 3 reads. */
    if (r.would) {
      restartsB++;
      const spent = ledger && ledger.forWorkTs === frozen[1].ts ? ledger.restarts : 0;
      ledger = {
        forWorkTs: frozen[1].ts, restarts: spent + 1, firstAt: iso(0), lastAt: iso(0),
        recent: [...((ledger && ledger.recent) || []), iso(0)]
      };
    }
  }

  /* (c) THE ADVERSARIAL ONE: one new row per boot, then a hang. T_work moves every time. */
  let ledgerC = null, restartsC = 0;
  const ticksPerDay = Math.floor((24 * 60) / 15);
  for (let i = 0; i < ticksPerDay; i++) {
    const rows = [
      { ts: new Date(Date.now() - (3000 - i) * MIN).toISOString(), kind: 'auto.cycle' },
      /* each tick, a NEWER work row than the last — and still 100 minutes stale */
      { ts: new Date(Date.now() - 100 * MIN + i * 1000).toISOString(), kind: 'session.view' }
    ];
    const r = tick(rows, LOOP, ledgerC);
    if (r.would) {
      restartsC++;
      const spent = ledgerC && ledgerC.forWorkTs === rows[1].ts ? ledgerC.restarts : 0;
      ledgerC = {
        forWorkTs: rows[1].ts, restarts: spent + 1, firstAt: iso(0), lastAt: iso(0),
        /* Appended, never reset on a new T_work — which is the whole mechanism under test. */
        recent: [...((ledgerC && ledgerC.recent) || []), iso(0)]
      };
    }
  }

  verdict('SIM 5a — a healthy loop is never restarted', !healthy.would,
    healthy.out.split('\n').filter(Boolean).pop() ?? '(no output)');

  verdict('SIM 5b — a permanent hang is restarted a bounded number of times in a day',
    restartsB <= BUDGET.restartsPerDay,
    `${restartsB} restart(s) across ${Math.floor((24 * 60) / 15)} ticks (budget ${BUDGET.restartsPerDay}/day)`,
    { restartsB });

  verdict('SIM 5c — a loop writing one row per boot cannot drive unbounded restarts',
    restartsC <= BUDGET.restartsPerDay,
    `${restartsC} restart(s) across ${ticksPerDay} ticks (budget ${BUDGET.restartsPerDay}/day)\n`
    + 'each tick presents a NEWER stale row, so a per-row budget resets every time',
    { restartsC });
}

/* ================================================================== *
 * SIM 6 — how long a decision takes once the history is a year old
 *
 * `counters()` runs TWICE per cycle: once in src/commands/auto.ts so `checkWindow` knows
 * `repliesToday`, once in src/commands/draft.ts. It reads the WHOLE history, which grows ~36 rows
 * a cycle and is never pruned, so its cost is a function of how long the install has been up —
 * the exact shape no unit test can see.
 *
 * MEASURED before the fix, on a database seeded to 159,000 history rows (one year at this
 * interval): loadHistory 1,148 ms and **counters() 27,674 ms**. The gap was `sameLocalDay`
 * constructing a fresh `Intl.DateTimeFormat` per row, per filter pass.
 *
 * Seeded into a THROWAWAY database, never the live one.
 * ================================================================== */
async function simDecisionLatency() {
  const rows = Number(process.env.SIM_HISTORY_ROWS ?? 159_000);
  const BUDGET_MS = 5_000;

  const dir = mkdtempSync(join(tmpdir(), 'redbot-sim-hist-'));
  const db = join(dir, 'redbot.db');
  try {
    /* The real schema, from the real migrations — a hand-rolled history table would not carry the
       CHECKs or the indexes, and the indexes are half of what is being measured. */
    execFileSync(process.execPath, [join(ROOT, 'db', 'sqlite', 'migrate.mjs'), 'up'], {
      env: { ...process.env, REDBOT_DB: db }, stdio: 'ignore'
    });

    const h = new DatabaseSync(db);
    h.exec('BEGIN');
    const ins = h.prepare("INSERT INTO history (ts, kind, account, summary) VALUES (?, 'read', 'sim', 'x')");
    const base = Date.now();
    for (let i = 0; i < rows; i++) {
      ins.run(new Date(base - i * 1000).toISOString().replace(/(\.\d{3})Z$/, '$1Z'));
    }
    h.exec('COMMIT');
    h.close();

    /* A child process, because `counters()` caches per-zone formatters for the life of a process
       and measuring it in this one would hand it a cache warmed by another simulation. */
    const script = `
      process.env.REDBOT_DB = ${JSON.stringify(db)};
      const { counters } = await import(${JSON.stringify(join(ROOT, 'dist', 'health.js'))});
      const { loadHistory } = await import(${JSON.stringify(join(ROOT, 'dist', 'store.js'))});
      const t0 = Date.now(); const h = await loadHistory(); const load = Date.now() - t0;
      const t1 = Date.now(); await counters('sim', new Date(), undefined, 'America/Los_Angeles');
      const first = Date.now() - t1;
      const t2 = Date.now(); await counters('sim', new Date(), undefined, 'America/Los_Angeles');
      console.log(JSON.stringify({ rows: h.length, load, first, second: Date.now() - t2 }));
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script],
      { encoding: 'utf8', env: { ...process.env, REDBOT_DB: db } });
    const m = /\{[^\n]*\}/.exec(out);
    const got = m ? JSON.parse(m[0]) : null;

    if (!got) { verdict('SIM 6 — decision latency', false, `could not measure: ${out.slice(0, 200)}`); return; }

    verdict(
      'SIM 6 — a decision still takes under five seconds after a year of history',
      got.first <= BUDGET_MS && got.second <= BUDGET_MS,
      `${got.rows.toLocaleString()} history rows (one year at ${INTERVAL_MIN}min)\n`
      + `  loadHistory  ${got.load.toLocaleString().padStart(7)} ms\n`
      + `  counters()   ${got.first.toLocaleString().padStart(7)} ms   (cold)\n`
      + `  counters()   ${got.second.toLocaleString().padStart(7)} ms   (warm)\n`
      + `runs twice per cycle — auto.ts for the window, draft.ts for the gates\n`
      + `budget ${BUDGET_MS.toLocaleString()} ms`,
      got
    );
  } catch (e) {
    verdict('SIM 6 — decision latency', false, `could not run: ${e && e.message ? e.message : e}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ================================================================== *
 * SIM 7 — the cost of asking how many threads are collected
 *
 * `src/commands/auto.ts` asks that twice per cycle. It used to ask by loading the entire corpus —
 * every thread and every comment — and taking `.length`, which at one year of this install's own
 * collection rate (12.3 threads / 102.6 comments per cycle) measured 2,044 ms and 366 MB of heap
 * per call. Two of those per cycle, both discarded, for one integer.
 *
 * Seeded into a throwaway database at the real measured rate.
 * ================================================================== */
async function simCorpusCount() {
  const BUDGET_MS = 250;
  const threads = Number(process.env.SIM_THREADS ?? 53_688);
  const perThread = 8;

  const dir = mkdtempSync(join(tmpdir(), 'redbot-sim-corp-'));
  const db = join(dir, 'redbot.db');
  try {
    execFileSync(process.execPath, [join(ROOT, 'db', 'sqlite', 'migrate.mjs'), 'up'], {
      env: { ...process.env, REDBOT_DB: db }, stdio: 'ignore'
    });
    const h = new DatabaseSync(db);
    h.exec('BEGIN');
    const ti = h.prepare("INSERT INTO threads (id,permalink,title,subreddit,collected_at,source,body,comment_count) VALUES (?,?,?,?,?,'read',?,?)");
    const ci = h.prepare('INSERT INTO thread_comments (thread_id,position,body,depth) VALUES (?,?,?,?)');
    const now = new Date().toISOString().replace(/(\.\d{3})Z$/, '$1Z');
    for (let i = 0; i < threads; i++) {
      const id = String(i).padStart(12, '0');
      ti.run(id, '/r/x/' + id, 'Thread ' + i, 'Wordpress', now, 'Body text for thread ' + i, perThread);
      for (let j = 0; j < perThread; j++) ci.run(id, j, 'A comment body of ordinary length ' + i + ' ' + j, 0);
    }
    h.exec('COMMIT');
    h.close();

    const script = `
      process.env.REDBOT_DB = ${JSON.stringify(db)};
      const { countThreads, loadThreads } = await import(${JSON.stringify(join(ROOT, 'dist', 'store.js'))});
      const t0 = Date.now(); const n = await countThreads(); const count = Date.now() - t0;
      const t1 = Date.now(); const all = await loadThreads(); const load = Date.now() - t1;
      console.log(JSON.stringify({ n, count, load, heapMb: Math.round(process.memoryUsage().heapUsed / 1e6), loaded: all.length }));
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script],
      { encoding: 'utf8', env: { ...process.env, REDBOT_DB: db }, maxBuffer: 1 << 24 });
    const m = /\{[^\n]*\}/.exec(out);
    const got = m ? JSON.parse(m[0]) : null;
    if (!got) { verdict('SIM 7 — corpus count', false, `could not measure: ${out.slice(0, 200)}`); return; }

    /* The count must AGREE with the load, or the cheap path is cheap because it is wrong. */
    const agrees = got.n === got.loaded;
    verdict(
      'SIM 7 — asking how many threads exist is cheap after a year of collection',
      agrees && got.count <= BUDGET_MS,
      `${got.n.toLocaleString()} threads · ${(got.n * perThread).toLocaleString()} comments\n`
      + `  countThreads()  ${String(got.count).padStart(6)} ms\n`
      + `  loadThreads()   ${String(got.load).padStart(6)} ms   ${got.heapMb} MB heap — what auto.ts used to do, twice a cycle\n`
      + `  agree on the figure: ${agrees ? 'yes' : `NO (${got.n} vs ${got.loaded})`}\n`
      + `budget ${BUDGET_MS} ms`,
      got
    );
  } catch (e) {
    verdict('SIM 7 — corpus count', false, `could not run: ${e && e.message ? e.message : e}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ================================================================== */
say('redbot — long-runtime simulation');
say('--------------------------------');
say(`database     ${DB}`);
say(`interval     ${INTERVAL_MIN} min  (${((24 * 60) / INTERVAL_MIN).toFixed(0)} cycles/day)`);
say('');

await simScheduler();
simTableGrowth();
await simUnboundedReads();
simRunLog();
simWatchdog();
await simDecisionLatency();
await simCorpusCount();

const failed = results.filter((r) => !r.pass);
if (JSON_OUT) console.log(JSON.stringify({ results, failed: failed.length }, null, 2));
else {
  say('');
  say(failed.length
    ? `VERDICT: ${failed.length} of ${results.length} simulation(s) FAILED`
    : `VERDICT: all ${results.length} simulations pass`);
  for (const f of failed) say(`  - ${f.name}`);
}
process.exit(failed.length ? 1 : 0);
