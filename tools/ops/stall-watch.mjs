/**
 * Is a cycle stuck part-way through?
 *
 * WHY SILENCE IS NOT THE SIGNAL. The loop sleeps `everyMinutes` between cycles, so "no history row
 * for an hour" is the normal state for most of every hour and says nothing. The failure this
 * watches for has a different shape: a cycle that STARTED, wrote some rows, and never wrote its
 * closing `auto.cycle`.
 *
 * MEASURED 2026-09-28, the run this exists because of: `gate.block` at 05:19:39 was the last row,
 * `reply()` then sat inside `viewThread` with no bound, and 53 minutes later — past the absolute
 * worst case the dwell arithmetic could produce — nothing had been written and no `auto.cycle` had
 * closed the cycle. Process evidence at the time: 76 min wall against 81 s CPU, zero CPU movement
 * across a 5 s sample. src/behavior.ts is bounded now; this catches the next member of that class,
 * which will not be the same line.
 *
 * THE RULE:
 *   T_end  = newest `auto.cycle` | `auto.skip` row   (a cycle finished or was skipped)
 *   T_work = newest cycle-internal row               (read/search/opportunity/draft/...)
 *   stalled when  T_work > T_end  AND  now - T_work > STALL_MINUTES
 *
 * The first clause is what stops this firing during the sleep: while the loop sleeps, the newest
 * row of any kind IS the closing `auto.cycle`, so T_work is never greater than T_end.
 *
 * STALL_MINUTES is 45. The longest gap inside a healthy cycle measured on this install is 10.5 min
 * (draft 05:09:09 -> gate.block 05:19:39, the certification step), and the pre-reply read is now
 * bounded by policy.maxDwellMs at 6 min. 45 leaves four times the largest real gap.
 *
 * ON RESTARTING RATHER THAN ONLY REPORTING: a report nobody reads leaves the loop producing nothing
 * for hours, which is the whole failure. A restart is safe against the one thing that would make it
 * unsafe — double-posting — because both duplicate gates were verified working on 2026-09-28:
 * `ownCommentPresent` reads the live page (gates.ts:336) and gates.ts:358 counts a prior `approved`
 * OR `published` draft for the thread. Pass --dry-run to check without acting.
 *
 * ===========================================================================
 * TWO GUARDS ADDED 2026-10-16, because the restart above ran 474 TIMES IN A ROW.
 *
 * MEASURED. `systemctl restart redbot.service` fired every 15 minutes from 2026-10-05 to
 * 2026-10-16 — 474 "restarted redbot.service" lines in `journalctl -u redbot-stall.service`
 * against 482 "Started redbot.service" — while the newest row in `history` stayed frozen at
 * 2026-10-05T10:14:01Z for all eleven days. Each restart killed and reopened 13 Chrome instances
 * (4.7G peak, 3min 17s CPU per 15-minute cycle).
 *
 * WHY IT COULD NOT STOP. The rule above is a statement about a cycle that is mid-flight. It says
 * nothing about whether a cycle is RUNNING AT ALL, and the two states are indistinguishable from
 * `history` alone: an unattended loop that was never resumed leaves exactly the signature of a
 * hang — a `session.view` with no `auto.cycle` after it — and it leaves it FOREVER, because no
 * loop means no new rows means T_work never moves. `tools/product/server.mjs:2599`
 * (`if (!saved) return;`) returns early when `data/push-state.json` carries no `autoLoop`, so a
 * restart brings back the console and the browsers and starts no cycle. The watchdog then re-read
 * the same frozen row and restarted again.
 *
 * GUARD 1 — IS THERE A LOOP TO RESCUE? `data/push-state.json`'s `autoLoop` is the record of the
 * loop a restart is supposed to bring back; `resumeAutoLoop()` reads that key and nothing else.
 * With no key there is nothing for a restart to resume, so restarting cannot change the condition
 * being tested. That is reported, not acted on.
 *
 * GUARD 2 — DID THE LAST RESTART HELP? A ledger in `data/stall-watch.json` records which T_work a
 * restart was issued for and how many have been issued for that same value. Two is the budget. The
 * invariant it enforces does not depend on guard 1 being right about the cause: AN ACTION THAT DID
 * NOT CHANGE THE THING IT WAS TESTED AGAINST IS NOT REPEATED. T_work moving resets the count,
 * because that is the proof a restart worked.
 *
 * GUARD 3 — A RATE CAP IN WALL TIME, because guards 1 and 2 together are still not enough.
 *
 * MEASURED by `tools/ops/simulate.mjs` SIM 5c, which was written to attack guard 2 and did:
 * **96 restarts across 96 ticks — one every 15 minutes for a simulated day.** Guard 2 is keyed on
 * T_work, so a loop that writes exactly ONE row per boot and then hangs presents a NEWER stale row
 * on every tick. `sameWork` is false each time, the count resets to zero each time, and the budget
 * bounds nothing. That is the 474-restart loop this file was rewritten to end, wearing a different
 * costume: the restarts are no longer identical, they are merely useless.
 *
 * So the ledger also keeps the TIMESTAMPS of recent restarts and refuses once there have been
 * `REDBOT_STALL_MAX_PER_DAY` (8) inside a rolling 24 hours, whatever the history does underneath.
 * Eight is above anything a healthy install produces — a restart is supposed to be rare — and far
 * below the 96 the simulation reached.
 *
 * The three guards answer three different questions and none subsumes another: is there a loop to
 * rescue · did the last restart move the thing it was tested against · and have we been doing this
 * too often to still call it a fix.
 *
 * All three exit 0 and say what they saw. A watchdog that cannot fix something must report it,
 * not hammer it — the eleven days above are what the alternative costs.
 * ===========================================================================
 */
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, chownSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DB = process.env.REDBOT_DB ?? '/srv/projects/redbot/data/redbot.db';
const STALL_MINUTES = Number(process.env.REDBOT_STALL_MINUTES ?? 45);
const DRY = process.argv.includes('--dry-run');

/** How many restarts one unchanged T_work is worth. See GUARD 2. */
const MAX_RESTARTS_PER_WORK_TS = Number(process.env.REDBOT_STALL_MAX_RESTARTS ?? 2);
/** How many restarts are allowed in a rolling 24 hours, whatever T_work does. See GUARD 3. */
const MAX_RESTARTS_PER_DAY = Number(process.env.REDBOT_STALL_MAX_PER_DAY ?? 8);
const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The data directory, derived from the database path so the two can never point at different installs. */
const DATA = process.env.REDBOT_DATA ?? dirname(DB);
const LEDGER = join(DATA, 'stall-watch.json');
const PUSH_STATE = join(DATA, 'push-state.json');

/** Rows a cycle writes while it is working. Anything here means a cycle is mid-flight. */
const WORK_KINDS = [
  'read', 'search', 'search.preview', 'opportunity', 'draft', 'draft.declined', 'draft.rewrite',
  'gate.block', 'session.view', 'publish.attempt', 'publish.unattended', 'publish.refused',
  'publish.ok', 'publish.fail', 'ratelimit'
];
/** Rows that close a cycle. */
const END_KINDS = ['auto.cycle', 'auto.skip', 'auto.error'];

const stamp = () => new Date().toISOString();
const say = (m) => console.log(`${stamp()}  stall-watch  ${m}`);

/**
 * The loop `resumeAutoLoop` would bring back, or null.
 *
 * Unreadable is reported as null — "I cannot prove a loop is registered" — and guard 1 then
 * refuses to restart. That is the safe direction: the failure this exists to stop is restarting
 * when nothing will come back, so an unknown must not be read as a yes.
 */
function registeredLoop() {
  try {
    if (!existsSync(PUSH_STATE)) return null;
    const raw = JSON.parse(readFileSync(PUSH_STATE, 'utf8'));
    const loop = raw?.autoLoop;
    if (!loop || typeof loop !== 'object') return null;
    if (typeof loop.account !== 'string' || !loop.account) return null;
    return loop;
  } catch {
    return null;
  }
}

/**
 * `{ forWorkTs, restarts, firstAt, lastAt, recent }`, or a zeroed ledger when there is none.
 *
 * `recent` is the ISO timestamp of every restart inside the rate window, which is what guard 3
 * counts. Entries outside the window are dropped on read rather than on write: a watchdog that
 * only prunes when it acts would keep a year of timestamps on an install it never restarts.
 */
function readLedger() {
  const empty = { forWorkTs: null, restarts: 0, firstAt: null, lastAt: null, recent: [] };
  try {
    const raw = JSON.parse(readFileSync(LEDGER, 'utf8'));
    const cutoff = Date.now() - RATE_WINDOW_MS;
    const recent = Array.isArray(raw?.recent)
      ? raw.recent.filter((t) => typeof t === 'string' && Date.parse(t) >= cutoff)
      : [];
    return {
      forWorkTs: typeof raw?.forWorkTs === 'string' ? raw.forWorkTs : null,
      restarts: Number.isInteger(raw?.restarts) && raw.restarts >= 0 ? raw.restarts : 0,
      firstAt: typeof raw?.firstAt === 'string' ? raw.firstAt : null,
      lastAt: typeof raw?.lastAt === 'string' ? raw.lastAt : null,
      recent
    };
  } catch {
    return empty;
  }
}

/**
 * Write the ledger, and hand it to whoever owns the data directory.
 *
 * This unit runs as root while the app runs as `samui`. A root-owned file in `data/` is how the
 * sibling install lost its session snapshots silently, so ownership is matched to the directory
 * rather than left wherever the writing process happened to come from. A failed chown is not
 * fatal — root can still read its own file next tick — so it is swallowed.
 */
function writeLedger(next) {
  try {
    writeFileSync(LEDGER, JSON.stringify(next, null, 2) + '\n', 'utf8');
    try {
      const owner = statSync(DATA);
      if (process.getuid && process.getuid() === 0) chownSync(LEDGER, owner.uid, owner.gid);
    } catch { /* ownership is a nicety; the record is the point */ }
  } catch (e) {
    say(`WARNING: the restart ledger could not be written (${e.message}) — the budget cannot be enforced`);
  }
}

let db;
try {
  db = new DatabaseSync(DB, { readOnly: true });
} catch (e) {
  say(`cannot open ${DB}: ${e.message} — nothing checked`);
  process.exit(0);          // not a stall; do not restart on our own blindness
}

const newest = (kinds) => {
  const marks = kinds.map(() => '?').join(',');
  const r = db.prepare(`select ts from history where kind in (${marks}) order by ts desc limit 1`).get(...kinds);
  return r ? { ts: r.ts, ms: Date.parse(r.ts) } : null;
};

const work = newest(WORK_KINDS);
const end = newest(END_KINDS);
const tWork = work ? work.ms : null;
const tEnd = end ? end.ms : null;

if (tWork === null) {
  say('no cycle rows at all — nothing to judge');
  process.exit(0);
}
if (tEnd !== null && tEnd >= tWork) {
  say(`idle: last cycle closed ${Math.round((Date.now() - tEnd) / 60000)}m ago — this is the sleep, not a stall`);
  process.exit(0);
}

const idleMin = (Date.now() - tWork) / 60000;
if (idleMin <= STALL_MINUTES) {
  say(`cycle in flight, last row ${idleMin.toFixed(1)}m ago (limit ${STALL_MINUTES}m) — working`);
  process.exit(0);
}

const last = db.prepare('select ts, kind, summary from history order by ts desc limit 1').get();
say(`STALLED: ${idleMin.toFixed(1)}m since the last row and no auto.cycle closed it`);
say(`  last row: ${last.ts} ${last.kind} — ${String(last.summary).slice(0, 90)}`);

/* ---- GUARD 1: a restart can only bring back a loop that is written down ---- */
const loop = registeredLoop();
if (!loop) {
  say('NOT RESTARTING: no autoLoop in push-state.json, so a restart would resume no cycle and');
  say('  this same frozen row would be read again in 15 minutes. Start the loop to clear this:');
  say('  POST /api/auto/start {"account":"<handle>","everyMinutes":<n>} on the console port.');
  process.exit(0);
}

/* ---- GUARD 2: a restart that did not move T_work is not repeated ---- */
const ledger = readLedger();
const sameWork = ledger.forWorkTs === work.ts;
const spent = sameWork ? ledger.restarts : 0;

if (spent >= MAX_RESTARTS_PER_WORK_TS) {
  say(`NOT RESTARTING: ${spent} restart(s) have already been issued for this exact row (${work.ts})`);
  say(`  and it has not moved, so restarting is not what fixes this. First restart ${ledger.firstAt}.`);
  say(`  Clear ${LEDGER} after fixing the cause, or raise REDBOT_STALL_MAX_RESTARTS deliberately.`);
  process.exit(0);
}

/* ---- GUARD 3: too many restarts in 24h is not a fix, whatever the history says ---- */
if (ledger.recent.length >= MAX_RESTARTS_PER_DAY) {
  say(`NOT RESTARTING: ${ledger.recent.length} restart(s) already issued in the last 24h`);
  say(`  (cap ${MAX_RESTARTS_PER_DAY}). The rows keep moving, so guard 2 keeps resetting — which means`);
  say('  the loop is starting, writing something, and dying again. Restarting it is not the fix.');
  say(`  Oldest in the window: ${ledger.recent[0]}. Clear ${LEDGER} once the cause is found.`);
  process.exit(0);
}

if (DRY) {
  say(`--dry-run: would restart redbot.service (restart ${spent + 1} of ${MAX_RESTARTS_PER_WORK_TS} for this row,`
      + ` ${ledger.recent.length + 1} of ${MAX_RESTARTS_PER_DAY} in 24h)`);
  process.exit(0);
}

/* RECORDED BEFORE THE ACTION, not after. A restart that kills this process mid-flight — which is
   exactly what restarting the service it supervises can do — must still have been counted, or the
   budget resets itself every tick and guard 2 is decoration. */
const now = stamp();
writeLedger({
  forWorkTs: work.ts,
  restarts: spent + 1,
  firstAt: sameWork && ledger.firstAt ? ledger.firstAt : now,
  lastAt: now,
  /* The rate window, appended rather than replaced. This is the only part of the ledger that
     survives T_work moving, which is exactly why guard 3 can bound what guard 2 cannot. */
  recent: [...ledger.recent, now]
});

try {
  execFileSync('/usr/bin/systemctl', ['restart', 'redbot.service'], { stdio: 'inherit' });
  say(`restarted redbot.service (${spent + 1} of ${MAX_RESTARTS_PER_WORK_TS} for row ${work.ts},`
      + ` ${ledger.recent.length + 1} of ${MAX_RESTARTS_PER_DAY} in 24h)`);
} catch (e) {
  say(`restart FAILED: ${e.message}`);
  process.exit(1);
}
