/**
 * Part B — account health.
 *
 * One question, answered from recorded facts only: **is this account in a state where
 * posting is defensible right now?**
 *
 * Two sources, both append-only:
 *   data/history.jsonl        what redbot did          (reads, searches, publishes, 429s)
 *   data/observations.jsonl   what was observed after  (karma, visibility, removals)
 *
 * Nothing here infers a hidden platform state. "Not visible signed out" is recorded as
 * exactly that — an observation about what a logged-out browser rendered — and never
 * upgraded into a claim about shadowbanning, filtering or moderator intent, because those
 * are not observable from outside. The health state reacts to the observation; the report
 * repeats the observation.
 *
 * Thresholds live in src/policy.ts with their provenance. Most are `declared` — chosen, not
 * measured — because this account has published nothing yet.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, ensureData } from './config.js';
import { policy } from './policy.js';
import { loadHistory } from './store.js';
import type { HistoryEntry } from './types.js';

export const observationsPath = join(DATA, 'observations.jsonl');

/**
 * An observed fact. `kind` names what was seen, never what it implies.
 */
export type ObservationKind =
  | 'karma'
  | 'account-created'
  | 'reply-visible-signed-in'
  | 'reply-visible-signed-out'
  | 'reply-absent-signed-out'
  | 'reply-absent-signed-in'
  | 'reply-marked-removed'
  | 'reply-marked-deleted'
  | 'reply-vote-count'
  | 'reply-child-count'
  | 'login-refused'
  | 'account-suspended-notice';

export type Checkpoint = 'immediate' | '1h' | '24h' | '7d';

export interface Observation {
  ts: string;
  account: string | null;
  kind: ObservationKind;
  /** How it was seen. A signed-out reading is a different fact from a signed-in one. */
  vector: 'signed-in' | 'signed-out' | 'unauthenticated-http';
  permalink?: string | null;
  checkpoint?: Checkpoint;
  value?: number | string | boolean | null;
  note?: string;
}

export function recordObservation(o: Omit<Observation, 'ts'>): Observation {
  ensureData();
  const full: Observation = { ts: new Date().toISOString(), ...o };
  appendFileSync(observationsPath, JSON.stringify(full) + '\n', 'utf8');
  return full;
}

export function loadObservations(): Observation[] {
  if (!existsSync(observationsPath)) return [];
  return readFileSync(observationsPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l) as Observation; } catch { return null; } })
    .filter((o): o is Observation => o !== null);
}

/* ------------------------------------------------------------------ */

export interface HealthCounters {
  account: string | null;
  readsToday: number;
  searchesToday: number;
  repliesToday: number;
  /** null when no session has been recorded end-to-end yet. */
  avgSessionMs: number | null;
  avgDwellMs: number | null;
  rateLimitHits24h: number;
  loginFailures24h: number;
  /** Observed, never inferred. */
  removalsObserved30d: number;
  absentSignedOut30d: number;
  suspensionNotices: number;
  accountAgeDays: number | null;
  karma: number | null;
  lastReplyAt: string | null;
  lastRateLimitAt: string | null;
  lastRemovalAt: string | null;
}

export type HealthState = 'Healthy' | 'Caution' | 'Cooldown' | 'Stop';

export interface HealthVerdict {
  state: HealthState;
  /** Cooldown and Stop block publishing. Healthy and Caution allow it. */
  mayPublish: boolean;
  reasons: string[];
  /** When a Cooldown lifts, if it lifts on a clock rather than on a decision. */
  resumeAt: string | null;
  counters: HealthCounters;
}

const DAY_MS = 24 * 60 * 60_000;

function sameUtcDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/[, ]/g, '')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Roll up the two logs.
 *
 * `now` is injectable so the state machine is testable without waiting a day.
 */
export function counters(
  account: string | null,
  now: Date = new Date(),
  sources?: { history?: HistoryEntry[]; observations?: Observation[] }
): HealthCounters {
  const history = sources?.history ?? loadHistory();
  const obs = sources?.observations ?? loadObservations();

  const mine = <T extends { account?: string | null }>(rows: T[]) =>
    account ? rows.filter((r) => r.account === account || r.account == null) : rows;

  const h = mine(history);
  const o = mine(obs);

  const today = (ts: string) => sameUtcDay(new Date(ts), now);
  const within = (ts: string, ms: number) => now.getTime() - new Date(ts).getTime() <= ms;

  const publishes = h.filter((e) => e.kind === 'publish.ok');
  const rateLimits = h.filter((e) => e.kind === 'ratelimit');
  const loginFails = h.filter((e) => e.kind === 'login.fail');

  /* session durations: pair each start with the next end */
  const sessionMs: number[] = [];
  let openedAt: number | null = null;
  for (const e of h) {
    if (e.kind === 'session.start') openedAt = new Date(e.ts).getTime();
    else if (e.kind === 'session.end' && openedAt != null) {
      sessionMs.push(new Date(e.ts).getTime() - openedAt);
      openedAt = null;
    }
  }

  const dwells = h
    .filter((e) => e.kind === 'session.view')
    .map((e) => num((e.data as Record<string, unknown> | undefined)?.dwellMs))
    .filter((n): n is number => n !== null);

  const removals = o.filter(
    (x) => x.kind === 'reply-marked-removed' || x.kind === 'reply-absent-signed-in'
  );
  const absentOut = o.filter((x) => x.kind === 'reply-absent-signed-out');

  const latest = (kind: ObservationKind) =>
    [...o].reverse().find((x) => x.kind === kind) ?? null;

  const karmaObs = latest('karma');
  const createdObs = latest('account-created');
  const createdMs = createdObs?.value ? Date.parse(String(createdObs.value)) : NaN;

  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  const lastTs = <T extends { ts: string }>(xs: T[]) => (xs.length ? xs[xs.length - 1]!.ts : null);

  return {
    account,
    readsToday: h.filter((e) => e.kind === 'read' && today(e.ts)).length,
    searchesToday: h.filter((e) => e.kind === 'search' && today(e.ts)).length,
    repliesToday: publishes.filter((e) => today(e.ts)).length,
    avgSessionMs: avg(sessionMs),
    avgDwellMs: avg(dwells),
    rateLimitHits24h: rateLimits.filter((e) => within(e.ts, DAY_MS)).length,
    loginFailures24h: loginFails.filter((e) => within(e.ts, DAY_MS)).length,
    removalsObserved30d: removals.filter((x) => within(x.ts, 30 * DAY_MS)).length,
    absentSignedOut30d: absentOut.filter((x) => within(x.ts, 30 * DAY_MS)).length,
    suspensionNotices: o.filter((x) => x.kind === 'account-suspended-notice').length,
    accountAgeDays: Number.isFinite(createdMs)
      ? Math.floor((now.getTime() - createdMs) / DAY_MS)
      : null,
    karma: karmaObs ? num(karmaObs.value) : null,
    lastReplyAt: lastTs(publishes),
    lastRateLimitAt: lastTs(rateLimits),
    lastRemovalAt: lastTs(removals)
  };
}

/**
 * The state machine.
 *
 * Order matters: Stop wins over Cooldown, Cooldown over Caution. Every branch names the
 * fact that produced it, so a blocked publish can be explained without reading this file.
 */
export function assess(c: HealthCounters, now: Date = new Date()): HealthVerdict {
  const reasons: string[] = [];
  const stop: string[] = [];
  const cooldown: Array<{ why: string; until: number | null }> = [];
  const caution: string[] = [];

  /* ---- Stop ---- */
  if (c.suspensionNotices > 0) {
    stop.push(
      `a suspension notice was observed ${c.suspensionNotices}x — ACCOUNT-WARMING: a suspension means stop. ` +
      `Replacing the account from this machine would be ban evasion.`
    );
  }
  if (c.removalsObserved30d >= policy.removalsBeforeStop.value) {
    stop.push(
      `${c.removalsObserved30d} removals observed in 30 days (threshold ${policy.removalsBeforeStop.value}) — ` +
      `that is a pattern, not noise`
    );
  }
  if (c.loginFailures24h >= policy.loginFailuresBeforeStop.value) {
    stop.push(`${c.loginFailures24h} login failures in 24h — stop rather than probe an account that may be restricted`);
  }

  /* ---- Cooldown ---- */
  if (c.lastRateLimitAt) {
    const until = new Date(c.lastRateLimitAt).getTime() + policy.rateLimitCooldownMs.value;
    if (until > now.getTime()) {
      cooldown.push({ why: `rate-limited at ${c.lastRateLimitAt}; cooling off`, until });
    }
  }
  if (c.lastRemovalAt) {
    const until = new Date(c.lastRemovalAt).getTime() + policy.removalCooldownMs.value;
    if (until > now.getTime()) {
      cooldown.push({ why: `a removal was observed at ${c.lastRemovalAt}; a person should look at why before posting again`, until });
    }
  }
  if (c.repliesToday >= policy.maxRepliesPerDay.value) {
    cooldown.push({
      why: `${c.repliesToday} replies today, daily ceiling is ${policy.maxRepliesPerDay.value} (${policy.maxRepliesPerDay.why})`,
      until: null
    });
  }
  if (c.lastReplyAt) {
    const until = new Date(c.lastReplyAt).getTime() + policy.minMinutesBetweenReplies.value * 60_000;
    if (until > now.getTime()) {
      cooldown.push({
        why: `last reply was at ${c.lastReplyAt}; spacing is ${policy.minMinutesBetweenReplies.value} min (provisional)`,
        until
      });
    }
  }

  /* ---- Caution ---- */
  if (c.karma != null && c.karma < policy.cautionKarmaBelow.value) {
    caution.push(`karma ${c.karma} is below ${policy.cautionKarmaBelow.value} — new-account filters apply`);
  }
  if (c.karma == null) {
    caution.push('karma has never been measured on this account — run `redbot probe-karma`');
  }
  if (c.accountAgeDays != null && c.accountAgeDays < policy.cautionAccountAgeDays.value) {
    caution.push(`account is ${c.accountAgeDays} days old, under the ${policy.cautionAccountAgeDays.value}-day threshold`);
  }
  if (c.absentSignedOut30d > 0) {
    caution.push(
      `${c.absentSignedOut30d} reply/replies were not visible to a signed-out browser in the last 30 days ` +
      `(observation only — this does not establish why)`
    );
  }
  if (c.repliesToday === policy.maxRepliesPerDay.value - 1) {
    caution.push(`${c.repliesToday} replies today — one below the daily ceiling`);
  }

  if (stop.length) {
    reasons.push(...stop, ...cooldown.map((x) => x.why), ...caution);
    return { state: 'Stop', mayPublish: false, reasons, resumeAt: null, counters: c };
  }

  if (cooldown.length) {
    reasons.push(...cooldown.map((x) => x.why), ...caution);
    const clocked = cooldown.map((x) => x.until).filter((u): u is number => u !== null);
    // A cooldown with no clock (the daily ceiling) does not resolve on a timer.
    const resumeAt = clocked.length === cooldown.length
      ? new Date(Math.max(...clocked)).toISOString()
      : null;
    return { state: 'Cooldown', mayPublish: false, reasons, resumeAt, counters: c };
  }

  if (caution.length) {
    return { state: 'Caution', mayPublish: true, reasons: caution, resumeAt: null, counters: c };
  }

  return { state: 'Healthy', mayPublish: true, reasons: ['no counter is near a threshold'], resumeAt: null, counters: c };
}

export function health(account: string | null, now: Date = new Date()): HealthVerdict {
  return assess(counters(account, now), now);
}
