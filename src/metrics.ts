/**
 * Part G — reliability metrics, derived from the append-only history.
 *
 * Every number here is a count of recorded events. Where there are no events, the value is
 * `null` and the sample size is 0 — not zero, not "100%", not an estimate. A rate over a
 * sample of one is reported with its denominator so nobody reads it as a rate.
 *
 * This is the input to the readiness report. If a criterion in that report has a null here,
 * it is an unknown and must be written as one.
 */
import { loadHistory } from './store.js';
import { loadDrafts } from './store.js';
import type { HistoryEntry } from './types.js';

export interface Rate {
  /** null when the denominator is 0. */
  value: number | null;
  numerator: number;
  denominator: number;
}

const rate = (numerator: number, denominator: number): Rate => ({
  value: denominator > 0 ? numerator / denominator : null,
  numerator,
  denominator
});

export interface Metrics {
  window: { from: string | null; to: string | null; days: number };
  sessions: {
    started: number;
    completed: number;
    successRate: Rate;
    avgDurationMs: number | null;
    distinctDays: number;
  };
  drafts: {
    generated: number;
    lintClean: number;
    approved: number;
    rejected: number;
    approvalRate: Rate;
  };
  publishing: {
    attempts: number;
    succeeded: number;
    failed: number;
    successRate: Rate;
    blockedByGates: number;
  };
  reliability: {
    pageLoads: number;
    rateLimitHits: number;
    rateLimitPer100Loads: Rate;
    selectorMisses: number;
    browserCrashes: number;
    errors: number;
  };
  login: {
    successes: number;
    failures: number;
    /** Longest run of days with a successful identity read and no failure. */
    longestCleanRunDays: number | null;
  };
}

const CRASH = /target closed|browser has been closed|protocol error|websocket|disconnected/i;

function dayKey(ts: string): string {
  return ts.slice(0, 10);
}

export function computeMetrics(history: HistoryEntry[] = loadHistory()): Metrics {
  const drafts = loadDrafts();

  const first = history[0]?.ts ?? null;
  const last = history[history.length - 1]?.ts ?? null;
  const days = first && last
    ? Math.max(1, Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000))
    : 0;

  const of = (kind: string) => history.filter((e) => e.kind === kind);

  /* ---- sessions ---- */
  const starts = of('session.start');
  const ends = of('session.end');
  const completed = ends.filter(
    (e) => (e.data as Record<string, unknown> | undefined)?.completed !== false
  ).length;

  const durations: number[] = [];
  let openedAt: number | null = null;
  for (const e of history) {
    if (e.kind === 'session.start') openedAt = Date.parse(e.ts);
    else if (e.kind === 'session.end' && openedAt != null) {
      durations.push(Date.parse(e.ts) - openedAt);
      openedAt = null;
    }
  }

  const sessionDays = new Set(starts.map((e) => dayKey(e.ts)));

  /* ---- login persistence ---- */
  const logins = of('login');
  const loginFails = of('login.fail');
  const loginDays = [...new Set(logins.map((e) => dayKey(e.ts)))].sort();
  const failDays = new Set(loginFails.map((e) => dayKey(e.ts)));

  let longestRun: number | null = null;
  if (loginDays.length) {
    let run = 0;
    let best = 0;
    for (const d of loginDays) {
      if (failDays.has(d)) { run = 0; continue; }
      run++;
      best = Math.max(best, run);
    }
    longestRun = best;
  }

  /* ---- page loads: reads and searches both load pages; use collected counts where present ---- */
  const pageLoads = history.reduce((sum, e) => {
    const d = e.data as Record<string, unknown> | undefined;
    const collected = typeof d?.collected === 'number' ? d.collected : 0;
    if (e.kind === 'read' || e.kind === 'search') return sum + collected + 1;
    if (e.kind === 'observe' || e.kind === 'publish.attempt') return sum + 1;
    return sum;
  }, 0);

  const rateLimits = of('ratelimit').length;
  const errors = of('error');

  return {
    window: { from: first, to: last, days },
    sessions: {
      started: starts.length,
      completed,
      successRate: rate(completed, starts.length),
      avgDurationMs: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
      distinctDays: sessionDays.size
    },
    drafts: {
      generated: drafts.length,
      lintClean: drafts.filter((d) => d.lintIssues.length === 0).length,
      approved: drafts.filter((d) => d.status === 'approved' || d.status === 'published').length,
      rejected: drafts.filter((d) => d.status === 'rejected').length,
      approvalRate: rate(
        drafts.filter((d) => d.status === 'approved' || d.status === 'published').length,
        drafts.filter((d) => d.status !== 'pending').length
      )
    },
    publishing: {
      attempts: of('publish.attempt').length,
      succeeded: of('publish.ok').length,
      failed: of('publish.fail').length,
      successRate: rate(of('publish.ok').length, of('publish.attempt').length),
      blockedByGates: of('gate.block').length
    },
    reliability: {
      pageLoads,
      rateLimitHits: rateLimits,
      rateLimitPer100Loads: rate(rateLimits * 100, pageLoads),
      selectorMisses: of('selector.miss').length,
      browserCrashes: errors.filter((e) => CRASH.test(e.summary)).length,
      errors: errors.length
    },
    login: {
      successes: logins.length,
      failures: loginFails.length,
      longestCleanRunDays: longestRun
    }
  };
}

/** "3/4 (75%)" or "no data (0 samples)" — never a bare percentage over an empty sample. */
export function formatRate(r: Rate): string {
  if (r.value === null) return 'no data (0 samples)';
  return `${r.numerator}/${r.denominator} (${Math.round(r.value * 100)}%)`;
}
