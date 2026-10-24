/**
 * Fleet warming-readiness — the alarm that was missing.
 *
 * `doctor` checks whether the INSTALL is sound and `health <account>` checks ONE account, but
 * nothing ever reported, across the whole fleet, that an account was in a state where warming
 * can produce nothing. That gap is why the engine ran for months while most accounts posted
 * zero: an account with no declared subreddits is refused everywhere (warmup.ts:106), and an
 * account under the karma floor whose every declared subreddit is karma-floored
 * (autopublish.ts:194) can neither post in those subs nor earn the karma that would unlock them.
 * Both conditions are legal and silent — no check went red. This makes them go red.
 *
 * Pure and synchronous over supplied facts so it is testable without a database. The caller in
 * doctor.ts loads the accounts and observations and hands them in.
 */
import type { AccountRecord } from "./config.js";
import type { Observation } from "./health.js";

export interface FleetWarmingInput {
  accounts: AccountRecord[];
  observations: Observation[];
  /** Subreddits an under-floor account is refused from (KARMA_FLOOR_SUBS ∪ any dynamic set). */
  floorSubs: ReadonlySet<string>;
  /** policy.cautionKarmaBelow.value — at or above this an account is no longer "under floor". */
  cautionKarmaBelow: number;
}

export interface FleetWarmingResult {
  status: "PASS" | "WARN";
  detail: string;
  /** Accounts with no declared subreddits — cannot publish anywhere. */
  emptySubs: string[];
  /** Under-floor accounts whose EVERY declared subreddit is karma-floored — cannot earn out. */
  trapped: string[];
}

/** Latest karma per account (case-insensitive handle), chosen by newest observation ts. */
function latestKarmaByAccount(observations: Observation[]): Map<string, number> {
  const karma = new Map<string, number>();
  const bestTs = new Map<string, string>();
  for (const o of observations) {
    if (o.kind !== "karma" || !o.account) continue;
    const key = o.account.toLowerCase();
    const value = typeof o.value === "number" ? o.value : Number(o.value);
    if (!Number.isFinite(value)) continue;
    const prev = bestTs.get(key);
    if (prev === undefined || o.ts > prev) {
      bestTs.set(key, o.ts);
      karma.set(key, value);
    }
  }
  return karma;
}

export function assessFleetWarming(input: FleetWarmingInput): FleetWarmingResult {
  const karma = latestKarmaByAccount(input.observations);
  const emptySubs: string[] = [];
  const trapped: string[] = [];

  for (const account of input.accounts) {
    const subs = (account.subreddits ?? []).map((s) => s.toLowerCase());
    if (subs.length === 0) {
      emptySubs.push(account.handle);
      continue;
    }
    const k = karma.get(account.handle.toLowerCase());
    const underFloor = k === undefined || k < input.cautionKarmaBelow;
    const everySubFloored = subs.every((s) => input.floorSubs.has(s));
    if (underFloor && everySubFloored) trapped.push(account.handle);
  }

  const problems: string[] = [];
  if (emptySubs.length) {
    problems.push(
      `${emptySubs.length} with no subreddits (${emptySubs.join(", ")}) — cannot publish anywhere`
    );
  }
  if (trapped.length) {
    problems.push(
      `${trapped.length} under karma ${input.cautionKarmaBelow} whose every subreddit is karma-floored ` +
        `(${trapped.join(", ")}) — cannot post to earn karma`
    );
  }

  if (problems.length === 0) {
    return {
      status: "PASS",
      detail: `${input.accounts.length} account(s): every account can warm`,
      emptySubs,
      trapped,
    };
  }
  return { status: "WARN", detail: problems.join("; "), emptySubs, trapped };
}
