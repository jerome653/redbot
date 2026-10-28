/**
 * The rotation: every account gets its daily work, at any hour, without fighting the operator.
 *
 * Measured on cardinal 2026-10-22: in the 30 days to that morning only jordangrowth and ryangrowth12
 * ran a single unattended cycle — the loop is started as ONE account (`autoStart({ account })`) and
 * `src/commands/auto.ts` works only `selectedAccount()`. The other 11 accounts drafted nothing,
 * warmed nothing and published nothing, so their karma could not move.
 *
 * It runs only inside the auto windows, DEFAULT_AUTO_WINDOWS below (Jerome, 2026-10-23: run auto
 * when Clark is not around). From 2026-10-22 it ran at every hour (Jerome, 2026-10-22: "the auto
 * should complete daily task to do if Clark is not able to do it"). The first version rested for the whole operator shift (Clark, 07:00-16:00
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

/** Default shift: Clark, 06:00 to 17:00 in Manila. */
export const DEFAULT_SHIFT = '06-17@Asia/Manila';

/**
 * When the rotation may run at all (Jerome, 2026-10-27: "6am to 5pm dont touch- else you can run
 * auto"; it was 18-24,01-05 from 2026-10-23). REDBOT_AUTO_WINDOWS overrides it. The hour before the
 * shift stays empty so a turn never runs into Clark's day; the hour after it does not need to,
 * because the shift ends at 17:00. Each account's own quiet hours (src/window.ts) still apply
 * inside these windows, so they have to sit outside both the shift and most of this window.
 */
export const DEFAULT_AUTO_WINDOWS = '17-24,00-05@Asia/Manila';

/**
 * Weekends (Saturday/Sunday Asia/Manila) open the window to a full 24h — Clark is away all weekend.
 * REDBOT_AUTO_WINDOWS_WEEKEND overrides it. src/auto-windows.ts pins the same weekend default, and
 * src/test/auto-windows.test.ts asserts the two files agree.
 */
export const DEFAULT_AUTO_WINDOWS_WEEKEND = '00-24@Asia/Manila';

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

/**
 * Parse "HH-HH,HH-HH@Zone" into shift-shaped ranges. Null when any range is unreadable, so a typo
 * refuses to rotate rather than silently running at every hour.
 */
export function parseWindows(text) {
  const m = /^\s*([^@]+)@(\S+)\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const out = [];
  for (const range of m[1].split(',')) {
    const w = parseShift(`${range.trim()}@${m[2]}`);
    if (!w) return null;
    out.push(w);
  }
  return out;
}

/** Is `now` inside any of the windows? */
export function inWindows(windows, now) {
  return windows.some((w) => onShift(w, now));
}

/**
 * Saturday or Sunday in `zone` (Asia/Manila by default) — Clark is away all weekend. Fails closed
 * to false (treat as a weekday, the safer/lower-volume answer) on an unreadable zone. This mirrors
 * src/weekend.ts isWeekend; the .mjs cannot import the TS, so the check is replicated inline.
 */
export function isWeekend(now, zone = 'Asia/Manila') {
  try {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(now);
    return day === 'Sat' || day === 'Sun';
  } catch {
    return false;
  }
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
 * Who the rotation holds, and which turn holds it. A turn releases only its own hold, so a late
 * release from an older turn can never clear a newer turn's. `live` is true from the start of a
 * turn until its Chrome is closed and the hold released — Stop does not end a turn, it ends the loop.
 */
export function holdRegistry() {
  let held = null, by = null, live = false;
  return {
    holds: (h) => held === h,
    held: () => held,
    hold: (h) => { const token = {}; held = h; by = token; return token; },
    release: (h, token) => { if (by === token && held === h) { held = null; by = null; } },
    get live() { return live; },
    set live(v) { live = !!v; }
  };
}

/**
 * One tick. Returns what it did, for the loop log and for tests.
 *
 * deps: now() · shift · needs(now) -> need rows (src/rotation-need.ts fleetNeeds) · last() /
 * setLast(h) · browserState(h) -> 'free' | 'running' | 'foreign' | 'unknown' · openBrowser(h) ->
 * { ok, error? } · runCycle(h) -> exit code · closeBrowser(h) · log(line)
 * Optional: busy(h) -> true while a console button drives that account · hold(h) -> token /
 * release(h, token) bracket the whole turn so the buttons refuse that account · alive() -> false once Stop was
 * pressed, checked after the (slow) Chrome open and before the cycle starts.
 */
export async function rotationTick(deps) {
  const now = deps.now();
  if (!deps.shift) {
    deps.log('Not rotating: REDBOT_OPERATOR_SHIFT is not "HH-HH@Zone".');
    return { ran: false, why: 'bad-shift' };
  }
  /* `windows` absent = no window gate (tests of the shift logic); null = unreadable, refuse. On a
   * weekend the full-24h weekendWindows apply when the caller wired them (server.mjs does). */
  const activeWindows = isWeekend(now) && deps.weekendWindows !== undefined ? deps.weekendWindows : deps.windows;
  if (activeWindows === null) {
    deps.log('Not rotating: REDBOT_AUTO_WINDOWS/REDBOT_AUTO_WINDOWS_WEEKEND is not "HH-HH,HH-HH@Zone".');
    return { ran: false, why: 'bad-windows' };
  }
  if (activeWindows && !inWindows(activeWindows, now)) {
    deps.log('Outside the auto windows — resting, no Chrome opened.');
    return { ran: false, why: 'off-window' };
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
    return { ran: false, why: 'nothing-due', tally: tally(needs) };
  }

  /* Why each due account was passed over, carried out of the tick: 'none-available' alone was all
     the 25 Oct gap could have said, and it does not say which gate held every account. */
  const skipped = [];
  for (const need of queue) {
    const handle = need.handle;
    if (deps.busy && deps.busy(handle)) {
      deps.log(`${handle}: a console button is driving its Chrome — skipped this turn.`);
      skipped.push({ handle, why: 'busy' });
      continue;
    }
    /* Held straight after the busy check with no await between, so a button cannot start on this
       account while its port is being probed; released in the finally on every path. */
    const token = deps.hold ? deps.hold(handle) : undefined;
    let opened = false;
    try {
      const state = await deps.browserState(handle);
      if (state === 'running' && operatorOn) {
        deps.log(`${handle}: its Chrome is open during the operator's shift — theirs, left alone.`);
        skipped.push({ handle, why: 'operator' });
        continue;
      }
      if (state !== 'free' && state !== 'running') {
        deps.log(`${handle}: its debug port is ${state}, not this account's Chrome — skipped this turn.`);
        skipped.push({ handle, why: String(state) });
        continue;
      }
      /* Recorded BEFORE the cycle, so an account whose cycle crashes does not win every tie after. */
      deps.setLast(handle);
      if (state === 'free') {
        const r = await deps.openBrowser(handle);
        if (!r || !r.ok) {
          deps.log(`${handle}: Chrome would not open (${(r && r.error) || 'no reason given'}) — skipped this turn.`);
          skipped.push({ handle, why: `open failed: ${(r && r.error) || 'no reason given'}` });
          continue;
        }
        opened = true;
      }
      /* Stop can land while Chrome is opening; a cycle started after it would run unsupervised. */
      if (deps.alive && !deps.alive()) {
        deps.log(`${handle}: stopped while its Chrome was opening — no cycle run.`);
        return { ran: false, why: 'stopped', handle };
      }

      deps.log(`${handle}: ${need.servedToday} of ${need.target} today — running one cycle.`);
      const code = await deps.runCycle(handle);
      deps.log(`${handle}: cycle ended, exit ${code}.`);
      return { ran: true, handle, code, opened };
    } finally {
      if (opened) { try { await deps.closeBrowser(handle); } catch { /* the next open checks the port again */ } }
      if (deps.release) deps.release(handle, token);
    }
  }
  deps.log(`${queue.length} account(s) due, none available this tick.`);
  return { ran: false, why: 'none-available', skipped };
}

/** One line for a tick's outcome — the ledger row's summary and /api/pulse's lastTick. */
export function tickSummary(r) {
  if (r.ran) return `${r.handle} ran one cycle, exit ${r.code}.`;
  if (r.why === 'nothing-due') return `Nothing due (${r.tally || 'no tally'}).`;
  if (r.why === 'none-available') return `Due accounts, none available: ${(r.skipped || []).map((s) => `${s.handle}: ${s.why}`).join('; ')}.`;
  if (r.why === 'error') return `Tick failed: ${r.error}`;
  return `Not run: ${r.why}${r.handle ? ` (${r.handle})` : ''}.`;
}

/**
 * The rotation's decisions, written down (history kind 'rotation.tick', migration 0024).
 *
 * On 2026-10-25 the loop ran no turn from 06:54Z to 15:04Z and the reason existed only in autoLog,
 * which a restart threw away. Every tick is a decision, but a loop resting through the night makes
 * the same one 144 times a day, so a row is written when the outcome CHANGES — why + handle; a
 * drifting tally is not a change — plus a heartbeat at most every `heartbeatMs`, so a quiet stretch
 * still proves the loop was alive. `last()` is the newest outcome whether written or not.
 */
export function tickLedger({ write, heartbeatMs = 3_600_000 }) {
  let lastKey = null, lastWrittenAt = -Infinity, latest = null;
  return {
    note(r, nowMs = Date.now()) {
      const key = `${r.why || (r.ran ? 'ran' : '?')}|${r.handle || ''}`;
      latest = { at: new Date(nowMs).toISOString(), why: r.ran ? 'ran' : r.why, handle: r.handle || null, summary: tickSummary(r) };
      const changed = key !== lastKey;
      if (!changed && nowMs - lastWrittenAt < heartbeatMs) return null;
      lastKey = key; lastWrittenAt = nowMs;
      const row = { ...latest, ...(changed ? {} : { heartbeat: true }), ...(r.skipped ? { skipped: r.skipped } : {}), ...(r.ran ? { code: r.code } : {}) };
      try { write(row); } catch { /* the ledger must never stop the loop it records */ }
      return row;
    },
    last: () => latest
  };
}

/**
 * The loop, with a watchdog. Moved out of server.mjs so it can be tested with a hand-cranked clock.
 *
 * `tick(current)` runs one turn; `current()` turns false once this runner is retired, and the
 * server passes it as rotationTick's `alive`, so a retired runner can never start a cycle.
 * `progress()` is called by the server on every line a cycle child prints: a 46-minute cycle that
 * talks (cardinal, 2026-10-25T15:04Z) is working, not stuck. Past `stallMs` with neither a finished
 * tick nor a line of output, `onStall` reports it and the loop is recovered — by killing the cycle
 * child when there is one (its close resolves the tick and the same runner carries on), otherwise
 * by retiring the stuck runner and starting a new one. Never both, so never two cycles.
 */
export function runRotationLoop({ tick, alive, gapMs, stallMs, onResult, onStall, killChild,
  now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  every = (fn, ms) => setInterval(fn, ms), stopEvery = (h) => clearInterval(h) }) {
  let gen = 0, lastProgress = now();
  const progress = () => { lastProgress = now(); };
  async function run(mine) {
    const current = () => alive() && mine === gen;
    while (current()) {
      let r;
      try { r = await tick(current); }
      catch (e) { r = { ran: false, why: 'error', error: String(e && e.message ? e.message : e) }; }
      if (mine !== gen) return;                     // retired while stuck: its result is not the loop's
      progress();
      try { onResult(r); } catch { /* reporting must not end the loop */ }
      if (!current()) break;
      await sleep(gapMs);
    }
  }
  const watch = every(() => {
    if (!alive()) { stopEvery(watch); return; }
    const idle = now() - lastProgress;
    if (idle <= stallMs) return;
    progress();
    const killed = killChild();
    try { onStall(idle, killed); } catch { /* the recovery below still runs */ }
    if (!killed) { gen += 1; run(gen); }
  }, Math.min(60_000, stallMs));
  run(gen);
  return { progress };
}
