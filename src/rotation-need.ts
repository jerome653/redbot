/**
 * Which accounts the rotation should work, and how much each has been served today.
 *
 * tools/product/rotation.mjs picks the account that most needs work; this decides "needs". It
 * reads only the history table, so a tick that finds nothing due opens no Chrome at all.
 *
 * An account is DUE when all three hold:
 *   - checkWindow allows it now — its quiet hours, its timezone and its ceiling, the very same
 *     verdict the cycle will ask for, so the rotation never opens a Chrome the cycle then refuses;
 *   - it has published fewer than its daily target today, target = min(2, the ceiling checkWindow
 *     enforces) — 2 is the bottom of the Today screen's stage-1 "2 to 4" a day;
 *   - its last publish is at least policy.minMinutesBetweenReplies ago.
 *
 * It grants nothing. Every gate on the publish path (fact-check, publish bar, pace, spacing,
 * ceiling, health) still decides in the cycle; this only chooses whose turn it is.
 */
import type { AccountRecord } from './config.js';
import { primeAccounts, loadAccounts } from './config.js';
import { checkWindow, dailyCeilingFor } from './window.js';
import { counters, loadObservations } from './health.js';
import { loadHistory } from './store.js';
import { policy } from './policy.js';

/** Publishes a day the rotation works an account up to. Never above the account's ceiling. */
export const ROTATION_DAILY_TARGET = 2;

export function dailyTargetFor(account: AccountRecord): number {
  return Math.min(ROTATION_DAILY_TARGET, dailyCeilingFor(account));
}

export interface AccountNeed {
  handle: string;
  due: boolean;
  /** 'due', 'done-for-today', 'spacing', or the checkWindow rule that refused. */
  rule: string;
  why: string;
  /** publish.ok rows today, in the account's own day — the least-served ordering key. */
  servedToday: number;
  target: number;
}

export function accountNeed(
  account: AccountRecord,
  c: { repliesToday: number; lastReplyAt: string | null },
  now: Date
): AccountNeed {
  const base = { handle: account.handle, servedToday: c.repliesToday, target: dailyTargetFor(account) };
  const v = checkWindow({ account, repliesToday: c.repliesToday, now });
  if (!v.allowed) return { ...base, due: false, rule: v.rule ?? 'window', why: v.detail };
  if (c.repliesToday >= base.target) {
    return { ...base, due: false, rule: 'done-for-today', why: `${account.handle}: ${c.repliesToday} of ${base.target} done today.` };
  }
  const spacingMs = policy.minMinutesBetweenReplies.value * 60_000;
  if (c.lastReplyAt) {
    const since = now.getTime() - new Date(c.lastReplyAt).getTime();
    if (since < spacingMs) {
      return {
        ...base, due: false, rule: 'spacing',
        why: `${account.handle}: last publish ${Math.round(since / 60_000)} min ago, spacing is ${policy.minMinutesBetweenReplies.value} min.`
      };
    }
  }
  return { ...base, due: true, rule: 'due', why: `${account.handle}: ${c.repliesToday} of ${base.target} today — due.` };
}

/**
 * Every account's need, in the fleet's order (the round robin's order). History and observations
 * are loaded ONCE and shared, rather than once per account through `counters`' default loader.
 * "Today" is the account's own day (its timezone), the same day its quiet hours run in.
 */
export async function fleetNeeds(now: Date = new Date()): Promise<AccountNeed[]> {
  await primeAccounts();
  const accounts = loadAccounts();
  const [history, observations] = await Promise.all([loadHistory(), loadObservations()]);
  const out: AccountNeed[] = [];
  for (const a of accounts) {
    const c = await counters(a.handle, now, { history, observations }, a.timezone, accounts.length);
    out.push(accountNeed(a, c, now));
  }
  return out;
}
