/**
 * Weekend-aware auto rate (Jerome, 2026-10-24: Clark, the operator, is away all weekend, so the
 * unattended rotation carries the fleet alone Sat/Sun and is allowed to do more).
 *
 * Two weekend behaviours are driven from this one place:
 *   - the auto window opens to a full 24h (src/auto-windows.ts and tools/product/rotation.mjs), and
 *   - each account's daily reply cap is multiplied (policy.weekendReplyMultiplier).
 *
 * "Weekend" is Saturday or Sunday in CLARK'S zone, Asia/Manila — a UTC instant that is still
 * Friday in UTC but already Saturday in Manila counts as the weekend, because it is the operator's
 * calendar that matters here, not UTC's.
 *
 * It FAILS CLOSED, matching src/window.ts. An unreadable zone or any error returns false — the
 * SAFER, lower-volume answer (treat it as a weekday). A weekend wrongly read as a weekday only
 * under-sends; a weekday wrongly read as a weekend over-sends, and over-sending from warming
 * accounts is the exact risk the caps exist to avoid.
 */
import { policy } from './policy.js';

/** True on Saturday or Sunday in `zone` (default Asia/Manila). Fails closed to false. */
export function isWeekend(now: Date, zone = 'Asia/Manila'): boolean {
  try {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(now);
    return day === 'Sat' || day === 'Sun';
  } catch {
    return false;
  }
}

/**
 * The per-account daily reply cap in force at `now`: the weekday base on weekdays, and the base
 * times policy.weekendReplyMultiplier on weekends. Every ceiling enforcer reads this, so the two
 * policy numbers stay the single source of the cap.
 */
export function effectiveMaxRepliesPerDay(now: Date): number {
  const multiplier = isWeekend(now) ? policy.weekendReplyMultiplier.value : 1;
  return policy.maxRepliesPerDay.value * multiplier;
}
