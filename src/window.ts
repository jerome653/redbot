/**
 * When an account is allowed to act.
 *
 * `quietHours` and `dailyCeiling` have been sitting in accounts.json being read by nothing.
 * A limit nobody enforces is decoration, and the specific failure it invites — an unattended
 * run working an account at 3am past its daily count — is the exact pattern that gets
 * accounts caught. So this module is the single place that answers "may this account act
 * right now", and everything unattended has to ask it first.
 *
 * Two properties it keeps deliberately:
 *
 *   - It FAILS CLOSED. An account with no configuration, an unparseable timezone, or a
 *     malformed quiet range is refused, not waved through. Being unable to tell whether
 *     something is allowed is not the same as it being allowed.
 *   - It decides nothing about quality. Whether a reply is any good is the fact-checker's
 *     job and then a person's. This only answers "is now an acceptable time".
 */
import type { AccountRecord } from './config.js';
import { policy } from './policy.js';

export interface WindowVerdict {
  allowed: boolean;
  /** Short sentence naming the reason, always populated — including when allowed. */
  detail: string;
  /** Which rule refused, for logs and tests. */
  rule?: 'no-account' | 'quiet-hours' | 'daily-ceiling' | 'bad-timezone' | 'bad-quiet-range';
  /** Local hour used for the decision, so a surprising verdict can be traced. */
  localHour?: number;
}

/**
 * The account's own local hour. Uses the IANA zone on the record rather than the machine's,
 * because an account's quiet hours are about where its person is supposed to be, not where
 * the server happens to run.
 */
export function localHourFor(zone: string | undefined, now: Date): number | null {
  if (!zone) return null;
  try {
    const s = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, hour: '2-digit', hour12: false
    }).format(now);
    const h = Number(s);
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
  } catch {
    return null;   // an unknown zone is a refusal, not a fallback to server time
  }
}

/**
 * Is `hour` inside [from, to)? The range may wrap midnight — [22, 7) means 22:00 to 06:59,
 * which is the normal shape for quiet hours and the case a naive `from <= h && h < to`
 * gets wrong.
 */
export function inQuietRange(hour: number, from: number, to: number): boolean {
  if (from === to) return false;              // an empty range silences nothing
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

export interface WindowInput {
  account: AccountRecord | null;
  /** Replies already published by this account today, counted from the record. */
  repliesToday: number;
  now?: Date;
}

export function checkWindow(input: WindowInput): WindowVerdict {
  const { account, repliesToday } = input;
  const now = input.now ?? new Date();

  if (!account) {
    return { allowed: false, rule: 'no-account', detail: 'No account selected — set REDBOT_ACCOUNT.' };
  }

  /* ---- the account's own clock ---- */

  /**
   * EVALUATED FOR EVERY ACCOUNT, and that placement is the whole point.
   *
   * This check used to live INSIDE `if (quiet)` below, which made an unreadable timezone a
   * refusal only for accounts that happened to declare quiet hours. Everything else fell through
   * to the tail of this function, where `hour` was recomputed and a null was dropped by
   * `...(hour === null ? {} : { localHour: hour })` — so the verdict came back `allowed: true`,
   * with no localHour and nothing anywhere saying the zone could not be read.
   *
   * It was reachable from data, not merely in theory. `quietHours` is optional on AccountRecord
   * (src/config.ts), and src/db/accounts.ts only populates it when BOTH quiet_start and quiet_end
   * are non-null — so any row with either column NULL yields a record with no quietHours, and the
   * timezone refusal was never evaluated for it.
   *
   * Nothing had been let through yet only because all 8 live rows carry quiet hours. 0018 makes
   * a NULL timezone the normal state for an account nobody has measured, which is exactly the
   * moment a latent fail-open would have become a live one.
   *
   * Read ONCE, here, and reused below. The second call at the tail was the thing that made the
   * silent drop possible; with the zone resolved up front, an allowed verdict always carries the
   * hour it was decided on.
   */
  const hour = localHourFor(account.timezone, now);
  if (hour === null) {
    return { allowed: false, rule: 'bad-timezone', detail: `${account.handle}: timezone "${account.timezone ?? '(unset)'}" is not a zone I can read.` };
  }

  /* ---- quiet hours ---- */
  const quiet = account.quietHours;
  if (quiet) {
    if (!Array.isArray(quiet) || quiet.length !== 2 ||
        !quiet.every((n) => Number.isInteger(n) && n >= 0 && n <= 23)) {
      return { allowed: false, rule: 'bad-quiet-range', detail: `${account.handle}: quietHours is not two hours between 0 and 23.` };
    }
    if (inQuietRange(hour, quiet[0]!, quiet[1]!)) {
      return {
        allowed: false, rule: 'quiet-hours', localHour: hour,
        detail: `${account.handle}: quiet hours — it is ${hour}:00 where this account lives (quiet ${quiet[0]}:00–${quiet[1]}:00).`
      };
    }
  }

  /**
   * The ceiling. The account's own number wins where it is set, but never upward — the
   * global maximum stays a hard cap so a typo in a config file cannot license a spree.
   */
  const configured = Number.isInteger(account.dailyCeiling) ? account.dailyCeiling! : policy.maxRepliesPerDay.value;
  const ceiling = Math.min(configured, policy.maxRepliesPerDay.value);
  if (repliesToday >= ceiling) {
    return {
      allowed: false, rule: 'daily-ceiling',
      detail: `${account.handle}: already replied ${repliesToday} time(s) today, ceiling is ${ceiling}.`
    };
  }

  return {
    allowed: true,
    localHour: hour,
    detail: `${account.handle}: clear to act — ${repliesToday} of ${ceiling} replies used today.`
  };
}
