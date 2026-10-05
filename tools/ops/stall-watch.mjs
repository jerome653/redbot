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
 */
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';

const DB = process.env.REDBOT_DB ?? '/srv/projects/redbot/data/redbot.db';
const STALL_MINUTES = Number(process.env.REDBOT_STALL_MINUTES ?? 45);
const DRY = process.argv.includes('--dry-run');

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
  return r ? Date.parse(r.ts) : null;
};

const tWork = newest(WORK_KINDS);
const tEnd = newest(END_KINDS);

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

if (DRY) {
  say('--dry-run: would restart redbot.service');
  process.exit(0);
}

try {
  execFileSync('/usr/bin/systemctl', ['restart', 'redbot.service'], { stdio: 'inherit' });
  say('restarted redbot.service');
} catch (e) {
  say(`restart FAILED: ${e.message}`);
  process.exit(1);
}
