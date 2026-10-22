/**
 * The off-shift rotation: every account gets its daily work while the operator is not on shift.
 *
 * Measured on cardinal 2026-10-22: in the 30 days to that morning only jordangrowth and ryangrowth12
 * ran a single unattended cycle — the loop is started as ONE account (`autoStart({ account })`) and
 * `src/commands/auto.ts` works only `selectedAccount()`. The other 11 accounts drafted nothing,
 * warmed nothing and published nothing, so their karma could not move.
 *
 * The operator works the accounts by hand during the shift (Clark, 07:00-16:00 Manila; set with
 * REDBOT_OPERATOR_SHIFT). Outside it this takes the accounts one at a time, round robin: open the
 * account's own Chrome if it is not running, run ONE `redbot auto --once` as that account (which
 * carries the warmup step for a stage-1 account), close the Chrome it opened, move to the next.
 * A Chrome that was already running is left running — it is not ours to close.
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
 * One tick. Returns what it did, for the loop log and for tests.
 *
 * deps: now() · shift · handles() -> string[] · last() / setLast(h) · browserState(h) -> 'free' |
 * 'running' | 'foreign' | 'unknown' · openBrowser(h) -> { ok, error? } · runCycle(h) -> exit code ·
 * closeBrowser(h) · log(line)
 */
export async function rotationTick(deps) {
  const now = deps.now();
  if (!deps.shift) {
    deps.log('Not rotating: REDBOT_OPERATOR_SHIFT is not "HH-HH@Zone".');
    return { ran: false, why: 'bad-shift' };
  }
  if (onShift(deps.shift, now)) {
    deps.log(`Operator's shift (${deps.shift.from}:00-${deps.shift.to}:00 ${deps.shift.zone}) — the accounts are theirs; resting.`);
    return { ran: false, why: 'on-shift' };
  }
  const handles = await deps.handles();
  const handle = nextHandle(handles, deps.last());
  if (!handle) {
    deps.log('No accounts to rotate through.');
    return { ran: false, why: 'no-accounts' };
  }
  /* Recorded BEFORE the cycle, so an account whose cycle crashes is not retried forever and the
     rest of the list still gets its turn. */
  deps.setLast(handle);

  const state = await deps.browserState(handle);
  let opened = false;
  if (state === 'free') {
    const r = await deps.openBrowser(handle);
    if (!r || !r.ok) {
      deps.log(`${handle}: Chrome would not open (${(r && r.error) || 'no reason given'}) — skipped this turn.`);
      return { ran: false, why: 'open-failed', handle };
    }
    opened = true;
  } else if (state !== 'running') {
    deps.log(`${handle}: its debug port is ${state}, not this account's Chrome — skipped this turn.`);
    return { ran: false, why: `port-${state}`, handle };
  }

  deps.log(`${handle}: running one cycle.`);
  let code = 1;
  try { code = await deps.runCycle(handle); }
  finally {
    if (opened) { try { await deps.closeBrowser(handle); } catch { /* the next open checks the port again */ } }
  }
  deps.log(`${handle}: cycle ended, exit ${code}.`);
  return { ran: true, handle, code, opened };
}
