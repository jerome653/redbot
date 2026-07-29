/**
 * Deep telemetry — why the pipeline did what it did.
 *
 * **Why this is not `history.jsonl`.** That file is the account's activity record: what redbot
 * did to Reddit, as the account. It feeds the health state machine and the reliability metrics,
 * and it is the thing a person reads when asking "what has this account been doing". Pouring
 * engineering telemetry into it would inflate those counters with events that never touched
 * Reddit — a stage timing is not an action, and counting it as one would corrupt the only log
 * that is supposed to answer for the account's behaviour.
 *
 * So: two logs, two jobs.
 *
 *   data/history.jsonl   what the account did          (account record — never noisy)
 *   data/trace.jsonl     why the pipeline decided so   (engineering telemetry — verbose)
 *
 * Every event carries a `runId`, so one invocation's events group together, and a stage, so
 * the funnel can be reconstructed without parsing prose. `redbot insights` reads this file.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA, ensureData } from './config.js';

import { getPool } from './db.js';
import { insertTrace, selectTrace } from './db/logs.js';

export const tracePath = join(DATA, 'trace.jsonl');

export type Stage =
  | 'collect' | 'gap' | 'opportunity' | 'draft' | 'gate' | 'review' | 'publish' | 'observe' | 'system';

export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface TraceEvent {
  ts: string;
  runId: string;
  stage: Stage;
  /** Short machine-readable name, e.g. 'thread.dropped', 'headroom.corrected'. */
  event: string;
  level: Level;
  threadId?: string;
  draftId?: string;
  /** Wall-clock milliseconds, when the event measures something. */
  ms?: number;
  data?: Record<string, unknown>;
}

/** One id per process. Set once so a run's events can be grouped after the fact. */
export const runId = randomUUID().slice(0, 8);

/**
 * `REDBOT_TRACE=off` disables writing. On by default: a telemetry file that has to be
 * switched on is a telemetry file that is empty on the day you need it.
 */
const enabled = process.env.REDBOT_TRACE !== 'off';

export function trace(
  stage: Stage,
  event: string,
  data?: Record<string, unknown>,
  opts?: { level?: Level; threadId?: string; draftId?: string; ms?: number }
): void {
  if (!enabled) return;
  ensureData();
  const e: TraceEvent = {
    ts: new Date().toISOString(),
    runId,
    stage,
    event,
    level: opts?.level ?? 'info',
    ...(opts?.threadId ? { threadId: opts.threadId } : {}),
    ...(opts?.draftId ? { draftId: opts.draftId } : {}),
    ...(opts?.ms != null ? { ms: opts.ms } : {}),
    ...(data && Object.keys(data).length ? { data } : {})
  };
  // Fire-and-forget on purpose. `trace()` is called from dozens of synchronous places and
  // its whole contract is that telemetry never takes the run down with it — making it async
  // would push an await into every one of those call sites and change control flow to record
  // a debug line. The write is tracked instead, and `flushTrace()` waits for it before exit,
  // so nothing is lost to a process that finishes faster than the round trip.
  const p = insertTrace(getPool(), e).catch(() => { /* telemetry is never fatal */ });
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

/** Writes still in flight. */
const pending = new Set<Promise<unknown>>();

/**
 * Wait for outstanding trace writes. Called once at CLI exit — without it a short
 * command can exit with its own telemetry still on the wire.
 */
export async function flushTrace(): Promise<void> {
  await Promise.allSettled([...pending]);
}

/** Time an operation and record how long it took, whether it succeeded or threw. */
export async function timed<T>(
  stage: Stage,
  event: string,
  fn: () => Promise<T>,
  meta?: { threadId?: string; data?: Record<string, unknown> }
): Promise<T> {
  const t0 = Date.now();
  try {
    const out = await fn();
    trace(stage, event, { ...meta?.data, ok: true }, { ms: Date.now() - t0, ...(meta?.threadId ? { threadId: meta.threadId } : {}) });
    return out;
  } catch (e) {
    trace(
      stage,
      event,
      { ...meta?.data, ok: false, error: e instanceof Error ? e.message.slice(0, 200) : String(e) },
      { ms: Date.now() - t0, level: 'error', ...(meta?.threadId ? { threadId: meta.threadId } : {}) }
    );
    throw e;
  }
}

export async function loadTrace(): Promise<TraceEvent[]> {
  return selectTrace(getPool());
}
