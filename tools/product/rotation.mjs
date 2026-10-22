/**
 * The rotation: every account gets its daily work, at any hour, without fighting the operator.
 *
 * Measured on cardinal 2026-10-22: in the 30 days to that morning only jordangrowth and ryangrowth12
 * ran a single unattended cycle — the loop is started as ONE account (`autoStart({ account })`) and
 * `src/commands/auto.ts` works only `selectedAccount()`. The other 11 accounts drafted nothing,
 * warmed nothing and published nothing, so their karma could not move.
 *
 * It runs at EVERY hour (Jerome, 2026-10-22: "the auto should complete daily task to do if Clark is
 * not able to do it"). The first version rested for the whole operator shift (Clark, 07:00-16:00
 * Manila; REDBOT_OPERATOR_SHIFT), and the off-shift hours overlap every account's quiet hours
 * (0-8 America/Los_Angeles = 15:00-23:00 Manila), so only ~8 h a day were usable and a 30-45 min
 * cycle per turn gave each account under one turn a night. Simulated: 2.3 comments/day across 13
 * accounts, the stage-1 target met on 0% of days.
 *
 * So each tick now picks the account that most NEEDS work (src/rotation-need.ts decides "due": not
 * in its quiet hours, under its daily target, past its spacing), least-served today first, ties by
 * round robin. Nothing due means nothing opens. During the shift an account whose Chrome is
 * already running is the operator's and is left alone; off shift a running Chrome is used and left
 * open, as before. A Chrome this opened is closed again after the turn.
 */

/** Default shift: 07:00 to 16:00 in Manila. */
export const DEFAULT_SHIFT = '07-16@Asia/Manila';

/**
 * Parse "HH-HH@Zone" (end exclusive). Returns null for anything else; an unreadable shift must
 * not silently become "never on shift", so the caller treats null as a refusal to rotate.
 */
export function parseShift(text) {
  const m = /^\s*(\d{1,2})-(\d{1,2})@([A-Za-z_]+(?:\/[A-Za-z_+-]+)*)\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const from = Number(m[1]), to = Number(m[2]);
  if (from > 23 || to > 24 || from === to) return null;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: m[3] }); } catch { return null; }
  return { from, to, zone: m[3] };
}

/** The hour (0-23) in `zone` at `now`. */
export function hourIn(zone, now) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }).format(now));
  return h === 24 ? 0 : h;
}

/** Is `now` inside the shift? Handles a shift that wraps midnight. */
export function onShift(shift, now) {
  const h = hourIn(shift.zone, now);
  return shift.from < shift.to ? h >= shift.from && h < shift.to : h >= shift.from || h < shift.to;
}

/** The handle after `last` in `handles`, wrapping; the first when `last` is unknown. */
export function nextHandle(handles, last) {
  if (!handles.length) return null;
  const i = handles.indexOf(last);
  return handles[(i + 1) % handles.length];
}

/**
 * The due accounts in the order they should be worked: fewest publishes today first, ties broken
 * by the round robin that starts after `last`. Not-due accounts are dropped here, so nothing
 * downstream can open a Chrome for an account in its quiet hours or done for the day.
 *
 * needs: [{ handle, due, rule, why, servedToday, target }] in the fleet's order.
 */
export function orderByNeed(needs, last) {
  const n = needs.length;
  const li = needs.findIndex((x) => x.handle === last);
  const rr = (i) => (i - li - 1 + n) % n;   // li = -1 (unknown) starts at the first account
  return needs
    .map((x, i) => ({ x, pos: rr(i) }))
    .filter(({ x }) => x.due)
    .sort((a, b) => a.x.servedToday - b.x.servedToday || a.pos - b.pos)
    .map(({ x }) => x);
}

/** "3 quiet-hours, 2 done-for-today" — one line for a tick that found nothing to do. */
function tally(needs) {
  const by = {};
  for (const x of needs) by[x.rule] = (by[x.rule] || 0) + 1;
  return Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ');
}

/**
 * One tick. Returns what it did, for the loop log and for tests.
 *
 * deps: now() · shift · needs(now) -> need rows (src/rotation-need.ts fleetNeeds) · last() /
 * setLast(h) · browserState(h) -> 'free' | 'running' | 'foreign' | 'unknown' · openBrowser(h) ->
 * { ok, error? } · runCycle(h) -> exit code · closeBrowser(h) · log(line)
 */
export async function rotationTick(deps) {
  const now = deps.now();
  if (!deps.shift) {
    deps.log('Not rotating: REDBOT_OPERATOR_SHIFT is not "HH-HH@Zone".');
    return { ran: false, why: 'bad-shift' };
  }
  const operatorOn = onShift(deps.shift, now);
  const needs = await deps.needs(now);
  if (!needs.length) {
    deps.log('No accounts to rotate through.');
    return { ran: false, why: 'no-accounts' };
  }
  const queue = orderByNeed(needs, deps.last());
  if (!queue.length) {
    /* Decided from the history table alone: no port probe, no Chrome. */
    deps.log(`Nothing due (${tally(needs)}) — no Chrome opened.`);
    return { ran: false, why: 'nothing-due' };
  }

  for (const need of queue) {
    const handle = need.handle;
    const state = await deps.browserState(handle);
    if (state === 'running' && operatorOn) {
      deps.log(`${handle}: its Chrome is open during the operator's shift — theirs, left alone.`);
      continue;
    }
    if (state !== 'free' && state !== 'running') {
      deps.log(`${handle}: its debug port is ${state}, not this account's Chrome — skipped this turn.`);
      continue;
    }
    /* Recorded BEFORE the cycle, so an account whose cycle crashes does not win every tie after. */
    deps.setLast(handle);
    let opened = false;
    if (state === 'free') {
      const r = await deps.openBrowser(handle);
      if (!r || !r.ok) {
        deps.log(`${handle}: Chrome would not open (${(r && r.error) || 'no reason given'}) — skipped this turn.`);
        continue;
      }
      opened = true;
    }

    deps.log(`${handle}: ${need.servedToday} of ${need.target} today — running one cycle.`);
    let code = 1;
    try { code = await deps.runCycle(handle); }
    finally {
      if (opened) { try { await deps.closeBrowser(handle); } catch { /* the next open checks the port again */ } }
    }
    deps.log(`${handle}: cycle ended, exit ${code}.`);
    return { ran: true, handle, code, opened };
  }
  deps.log(`${queue.length} account(s) due, none available this tick.`);
  return { ran: false, why: 'none-available' };
}
