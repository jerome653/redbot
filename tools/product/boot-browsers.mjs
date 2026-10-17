/**
 * WHICH accounts are expected to have a browser open — one answer, two readers.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN MODULE.
 *
 * `electron/main.mjs` decides which browsers to open at boot. `tools/product/server.mjs` decides
 * which of them being closed is a PROBLEM. Those are the same question asked twice, and when the
 * boot default changed from "all of them" to "the one the loop runs as", only the first answer
 * moved — so `/api/pulse` immediately reported twelve accounts as `browser is not open` and
 * `healthy: false` on an install that was working exactly as intended.
 *
 * MEASURED 2026-10-17, within a minute of the boot change landing: 12 problems, every one of them
 * a deliberate state described as a fault. That is worse than the bug it replaced — a health
 * signal that cries wolf twelve times is a health signal nobody reads, and the last defect in this
 * file's neighbourhood was `/api/pulse` answering `healthy: true` for eleven days.
 *
 * So the rule lives here, both callers import it, and `fleet-posture.mjs` is told what to expect
 * rather than assuming everything.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS AND IS NOT A FAULT, once an account is not expected to be open.
 *
 * Only `browser is not open` stops being one. Everything else still is, because none of them are
 * a consequence of choosing not to open it:
 *
 *   * a port held by SOMETHING ELSE is a fault whether or not we meant to use it — it is how
 *     redbot came to drive Lenovo Vantage's Edge WebView2 on 9222;
 *   * a missing sign-in folder is a fault: the account cannot be opened on demand either;
 *   * an exit that CHANGED or died is a fault about the account's identity, not its window.
 */

/** The default, matching `REDBOT_BOOT_BROWSERS`'s own default in electron/main.mjs. */
export const DEFAULT_WANT = 'loop';

/**
 * @param {object} s
 * @param {string[]} s.handles            every account bound to this machine
 * @param {string} [s.want]               `REDBOT_BOOT_BROWSERS`: 'loop' | 'all' | 'a,b,c'
 * @param {string|null} [s.loopAccount]   the account in push-state.json's `autoLoop`, or null
 * @returns {{ expected: Set<string>|null, why: string }}
 *   `expected` is a set of LOWER-CASED handles, or null meaning "no restriction — all of them".
 *   Null is not an empty set: one means everything is expected, the other means nothing is, and
 *   conflating them is how a selection becomes a fleet-wide outage or a fleet-wide false alarm.
 */
export function bootBrowserSelection({ handles, want = DEFAULT_WANT, loopAccount = null }) {
  const all = (Array.isArray(handles) ? handles : []).map((h) => String(h).toLowerCase());
  const w = String(want ?? DEFAULT_WANT).trim();

  if (w === 'all') return { expected: null, why: 'REDBOT_BOOT_BROWSERS=all' };

  if (w === 'loop') {
    /* No loop registered is no basis to choose. Choosing anyway would silently stop opening an
       account somebody relies on, which is a worse failure than opening one too many — so this
       falls back to everything, and says which case it is. */
    if (!loopAccount) return { expected: null, why: 'no loop registered' };
    return {
      expected: new Set([String(loopAccount).toLowerCase()]),
      why: `${loopAccount} is the account the loop runs as`
    };
  }

  if (!w) return { expected: null, why: 'no selection given' };

  const named = new Set(w.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
  return { expected: named, why: `REDBOT_BOOT_BROWSERS names ${named.size} handle(s)` };
}

/**
 * Whether one account's browser being closed is a fault or a deliberate state.
 *
 * `expected === null` means every account is expected open, which is the pre-2026-10-17 behaviour
 * and what an install with no loop still gets.
 */
export function expectedOpen(expected, handle) {
  if (!expected) return true;
  return expected.has(String(handle).toLowerCase());
}
