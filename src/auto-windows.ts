/**
 * When unattended work may run at all (Jerome, 2026-10-23: "run auto when Clark is not around ...
 * auto can run from 1am to 5am and 6pm to 12 midnight"; Clark works 06:00-17:00 Manila).
 *
 * The rotation reads the same rule in tools/product/rotation.mjs (parseWindows / inWindows); this
 * is the copy the single-account `redbot auto --every` loop reads, because that loop runs from
 * dist/ and cannot import the console's .mjs. src/test/auto-windows.test.ts pins the two defaults
 * together. Each account's own quiet hours (src/window.ts) still apply inside these windows.
 */
import { isWeekend } from './weekend.js';

export const DEFAULT_AUTO_WINDOWS = '18-24,01-05@Asia/Manila';

/**
 * Weekends (Saturday/Sunday in Asia/Manila) open the window to a full 24h — Clark is away all
 * weekend, so auto carries the fleet alone. REDBOT_AUTO_WINDOWS_WEEKEND overrides it. The weekday
 * window above is unchanged. tools/product/rotation.mjs pins the same weekend default.
 */
export const DEFAULT_AUTO_WINDOWS_WEEKEND = '00-24@Asia/Manila';

interface Range { from: number; to: number }

function parse(text: string): { ranges: Range[]; zone: string } | null {
  const m = /^\s*([^@]+)@(\S+)\s*$/.exec(text);
  if (!m || !m[1] || !m[2]) return null;
  const zone = m[2];
  try { new Intl.DateTimeFormat('en-GB', { timeZone: zone }); } catch { return null; }
  const ranges: Range[] = [];
  for (const part of m[1].split(',')) {
    const r = /^\s*(\d{1,2})-(\d{1,2})\s*$/.exec(part);
    if (!r) return null;
    const from = Number(r[1]), to = Number(r[2]);
    if (from > 23 || to > 24 || from === to) return null;
    ranges.push({ from, to });
  }
  return { ranges, zone };
}

function hourIn(zone: string, now: Date): number {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }).format(now));
  return h === 24 ? 0 : h;
}

/**
 * Null when `now` is inside the auto windows; otherwise the reason to rest. Unreadable windows are
 * a reason too, so a typo can never turn into "run at every hour".
 */
export function offWindowReason(now: Date, env: Record<string, string | undefined> = process.env): string | null {
  const text = isWeekend(now)
    ? (env.REDBOT_AUTO_WINDOWS_WEEKEND || DEFAULT_AUTO_WINDOWS_WEEKEND)
    : (env.REDBOT_AUTO_WINDOWS || DEFAULT_AUTO_WINDOWS);
  const w = parse(text);
  if (!w) return `REDBOT_AUTO_WINDOWS="${text}" is not "HH-HH,HH-HH@Zone" — not running.`;
  const h = hourIn(w.zone, now);
  const inside = w.ranges.some((r) => (r.from < r.to ? h >= r.from && h < r.to : h >= r.from || h < r.to));
  return inside ? null : `Outside the auto windows (${text}) — resting this cycle.`;
}
