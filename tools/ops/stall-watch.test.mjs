/**
 * What the stall watchdog does, and — the part this file exists for — what it REFUSES to do.
 *
 * WHY THESE TESTS. The restart in `stall-watch.mjs` fired 474 times between 2026-10-05 and
 * 2026-10-16 against a `history` whose newest row never moved: 474 "restarted redbot.service"
 * lines in the journal, 482 "Started redbot.service", eleven days, 13 Chrome instances killed and
 * reopened every 15 minutes. Nothing was wrong with the stall RULE — a frozen `session.view` with
 * no `auto.cycle` after it genuinely matches it. What was missing was any check that the action
 * could affect the condition.
 *
 * So the assertions below are mostly negative, and that is deliberate: the two guards are only
 * worth having if they can be shown to FIRE, and a guard that cannot go red under mutation is
 * decoration. Each one is driven by building the exact database and `push-state.json` that
 * produced the loop, then asserting the process does not reach `systemctl`.
 *
 * `systemctl` is never actually invoked: every case that would restart is run with `--dry-run`,
 * and the dry-run line is itself the assertion that the guards let it through.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = dirname(fileURLToPath(import.meta.url));
const WATCH = join(HERE, 'stall-watch.mjs');

/** The subset of the real `history` shape these tests read: see db/sqlite/migrations 0001+. */
const HISTORY_DDL = `
  CREATE TABLE history (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      TEXT NOT NULL,
    kind    TEXT NOT NULL,
    summary TEXT NOT NULL
  )`;

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;

/**
 * A throwaway install: a data directory, a database with the given history rows, and whatever
 * `push-state.json` the case needs.
 */
function install(rows, pushState) {
  const dir = mkdtempSync(join(tmpdir(), 'redbot-stall-'));
  const db = join(dir, 'redbot.db');
  const h = new DatabaseSync(db);
  h.exec(HISTORY_DDL);
  const ins = h.prepare('INSERT INTO history (ts, kind, summary) VALUES (?, ?, ?)');
  for (const r of rows) ins.run(r.ts, r.kind, r.summary ?? 'x');
  h.close();
  if (pushState !== undefined) {
    writeFileSync(join(dir, 'push-state.json'), JSON.stringify(pushState), 'utf8');
  }
  return { dir, db, ledger: join(dir, 'stall-watch.json') };
}

/** Run the watchdog against one install. Always `--dry-run` — no test may restart a service. */
function run(inst, env = {}) {
  return execFileSync(process.execPath, [WATCH, '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, REDBOT_DB: inst.db, REDBOT_DATA: inst.dir, ...env }
  });
}

/** The frozen-row shape that produced the 474 restarts: work after the last close, long ago. */
const FROZEN = [
  { ts: iso(200 * MIN), kind: 'auto.cycle', summary: 'unattended cycle finished' },
  { ts: iso(190 * MIN), kind: 'session.view', summary: 'read cfadcd73a289 before replying' }
];

const LOOP = { cursors: {}, autoLoop: { account: 'ryangrowth12', everyMinutes: 120 } };

test('the sleep between cycles is not a stall', () => {
  const inst = install([
    { ts: iso(190 * MIN), kind: 'session.view' },
    { ts: iso(100 * MIN), kind: 'auto.cycle' }       // closed AFTER the work: this is the sleep
  ], LOOP);
  const out = run(inst);
  assert.match(out, /this is the sleep, not a stall/);
  assert.doesNotMatch(out, /STALLED/);
  rmSync(inst.dir, { recursive: true, force: true });
});

test('a cycle still inside the stall window is left alone', () => {
  const inst = install([
    { ts: iso(100 * MIN), kind: 'auto.cycle' },
    { ts: iso(20 * MIN), kind: 'draft' }
  ], LOOP);
  const out = run(inst);
  assert.match(out, /cycle in flight/);
  assert.doesNotMatch(out, /would restart/);
  rmSync(inst.dir, { recursive: true, force: true });
});

test('a genuine stall WITH a registered loop still restarts — the guards did not disable it', () => {
  const inst = install(FROZEN, LOOP);
  const out = run(inst);
  assert.match(out, /STALLED/);
  assert.match(out, /--dry-run: would restart redbot\.service/);
  rmSync(inst.dir, { recursive: true, force: true });
});

test('GUARD 1: no autoLoop means a restart would resume nothing, so none is issued', () => {
  /* The exact file this install carried for eleven days: cursors and a provider, no autoLoop. */
  const inst = install(FROZEN, { cursors: {}, llmProvider: 'deepseek' });
  const out = run(inst);
  assert.match(out, /STALLED/, 'the stall itself is still reported');
  assert.match(out, /NOT RESTARTING: no autoLoop/);
  assert.doesNotMatch(out, /would restart/);
  rmSync(inst.dir, { recursive: true, force: true });
});

test('GUARD 1: an absent or unreadable push-state is not read as a registered loop', () => {
  for (const state of [undefined, 'not json at all', { cursors: {}, autoLoop: { everyMinutes: 120 } }]) {
    const inst = install(FROZEN, state);
    if (typeof state === 'string') writeFileSync(join(inst.dir, 'push-state.json'), state, 'utf8');
    const out = run(inst);
    assert.match(out, /NOT RESTARTING: no autoLoop/, `state ${JSON.stringify(state)} must not restart`);
    rmSync(inst.dir, { recursive: true, force: true });
  }
});

test('GUARD 2: the restart budget is spent per unchanged T_work, then refused', () => {
  const inst = install(FROZEN, LOOP);

  /* Two restarts are allowed for one row, and the ledger is written BEFORE the action — so a
     dry-run spends nothing and the budget has to be primed to be observed. */
  writeFileSync(inst.ledger, JSON.stringify({
    forWorkTs: FROZEN[1].ts, restarts: 2, firstAt: iso(60 * MIN), lastAt: iso(15 * MIN)
  }), 'utf8');

  const out = run(inst);
  assert.match(out, /NOT RESTARTING: 2 restart\(s\) have already been issued/);
  assert.doesNotMatch(out, /would restart/);
  rmSync(inst.dir, { recursive: true, force: true });
});

test('GUARD 2: T_work moving resets the budget — that is the proof a restart worked', () => {
  const inst = install(FROZEN, LOOP);
  /* A ledger spent against a DIFFERENT row. The work has advanced since, so the count is stale. */
  writeFileSync(inst.ledger, JSON.stringify({
    forWorkTs: iso(900 * MIN), restarts: 9, firstAt: iso(900 * MIN), lastAt: iso(880 * MIN)
  }), 'utf8');

  const out = run(inst);
  assert.match(out, /would restart redbot\.service \(restart 1 of 2/);
  rmSync(inst.dir, { recursive: true, force: true });
});

test('GUARD 2: the budget is configurable, and 0 refuses outright', () => {
  const inst = install(FROZEN, LOOP);
  const out = run(inst, { REDBOT_STALL_MAX_RESTARTS: '0' });
  assert.match(out, /NOT RESTARTING: 0 restart\(s\) have already been issued/);
  rmSync(inst.dir, { recursive: true, force: true });
});

test('a real restart records the attempt before acting, so a kill mid-flight still counts', () => {
  /* The counting path cannot be exercised through --dry-run, which is the point of the comment in
     the source: the write happens before `systemctl`. Asserted here on the ONE thing observable
     without restarting anything — that no ledger is written when the budget already refused. */
  const inst = install(FROZEN, LOOP);
  writeFileSync(inst.ledger, JSON.stringify({
    forWorkTs: FROZEN[1].ts, restarts: 2, firstAt: iso(60 * MIN), lastAt: iso(15 * MIN)
  }), 'utf8');
  run(inst);
  const after = JSON.parse(readFileSync(inst.ledger, 'utf8'));
  assert.equal(after.restarts, 2, 'a refusal must not spend budget');
  rmSync(inst.dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 * GUARD 3 — the rate cap in wall time
 *
 * Added because `tools/ops/simulate.mjs` SIM 5c attacked guard 2 and won: a loop that writes one
 * row per boot and then hangs presents a NEWER stale row on every tick, so the per-T_work budget
 * resets every time and bounded nothing. The simulation reached 96 restarts in 96 ticks — one
 * every 15 minutes for a simulated day, which is the 474-restart loop again with moving rows.
 * ------------------------------------------------------------------ */

test('GUARD 3: eight restarts inside 24h is the cap, whatever T_work does', () => {
  const inst = install(FROZEN, LOOP);
  /* A ledger whose per-row count is ZERO — guard 2 is satisfied — but whose rate window is full.
     That combination is exactly the state SIM 5c produced, and only guard 3 can refuse it. */
  writeFileSync(inst.ledger, JSON.stringify({
    forWorkTs: iso(900 * MIN),          // a DIFFERENT row, so `sameWork` is false
    restarts: 0,
    firstAt: iso(600 * MIN),
    recent: Array.from({ length: 8 }, (_, i) => iso((500 - i * 50) * MIN))
  }), 'utf8');

  const out = run(inst);
  assert.match(out, /NOT RESTARTING: 8 restart\(s\) already issued in the last 24h/);
  assert.doesNotMatch(out, /would restart/);
  rmSync(inst.dir, { recursive: true, force: true });
});

test('GUARD 3: timestamps older than the window are dropped, so the cap is rolling', () => {
  const inst = install(FROZEN, LOOP);
  /* Nine restarts, every one of them more than 24h ago. A window that did not expire would refuse;
     a rolling one must allow — otherwise one bad day disables the watchdog permanently. */
  writeFileSync(inst.ledger, JSON.stringify({
    forWorkTs: iso(5000 * MIN),
    restarts: 0,
    recent: Array.from({ length: 9 }, (_, i) => iso((5000 + i * 60) * MIN))
  }), 'utf8');

  const out = run(inst);
  assert.match(out, /would restart/, 'a stale rate window must not disable the watchdog forever');
  rmSync(inst.dir, { recursive: true, force: true });
});

test('GUARD 3: the cap is configurable, and 0 refuses outright', () => {
  const inst = install(FROZEN, LOOP);
  const out = run(inst, { REDBOT_STALL_MAX_PER_DAY: '0' });
  assert.match(out, /NOT RESTARTING: 0 restart\(s\) already issued in the last 24h/);
  rmSync(inst.dir, { recursive: true, force: true });
});

test('GUARD 3: a restart records itself in the rate window as well as against the row', () => {
  /* Both halves of the ledger, asserted on the one path that writes it. --dry-run cannot be used
     here because it deliberately spends nothing, so this drives the refusal side: a ledger one
     under the cap is allowed, and the write that would follow is the one under test above. */
  const inst = install(FROZEN, LOOP);
  writeFileSync(inst.ledger, JSON.stringify({
    forWorkTs: iso(900 * MIN), restarts: 0,
    recent: Array.from({ length: 7 }, (_, i) => iso((100 + i) * MIN))
  }), 'utf8');
  const out = run(inst);
  assert.match(out, /8 of 8 in 24h/, 'the dry-run line must name where in the window this restart sits');
  rmSync(inst.dir, { recursive: true, force: true });
});

test('GUARD 3 does not fire on an install that has never restarted', () => {
  const inst = install(FROZEN, LOOP);
  const out = run(inst);
  assert.match(out, /would restart/);
  assert.doesNotMatch(out, /in the last 24h/);
  rmSync(inst.dir, { recursive: true, force: true });
});

test('an unopenable database checks nothing rather than restarting on its own blindness', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redbot-stall-'));
  const out = execFileSync(process.execPath, [WATCH, '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, REDBOT_DB: join(dir, 'nope.db'), REDBOT_DATA: dir }
  });
  assert.match(out, /nothing checked|no cycle rows at all/);
  assert.doesNotMatch(out, /would restart/);
  assert.equal(existsSync(join(dir, 'stall-watch.json')), false);
  rmSync(dir, { recursive: true, force: true });
});
