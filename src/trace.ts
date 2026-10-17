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
 *   the `trace` table     why the pipeline decided so   (engineering telemetry — verbose)
 *
 * Every event carries a `runId`, so one invocation's events group together, and a stage, so
 * the funnel can be reconstructed without parsing prose. `redbot insights` reads this file.
 */
import { randomUUID } from 'node:crypto';
import { ensureData } from './config.js';

import { getPool } from './db.js';
import { insertTrace, selectTrace, countLog } from './db/logs.js';

/* `tracePath` WAS HERE and is gone. It named `data/trace.jsonl`, nothing read it outside its own
   definition, and no code has written that file since trace moved into the database — yet
   src/commands/status.ts was still telling operators to go and look at it. A dead constant is
   harmless; a dead constant quoted in the UI is a false instruction. */

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

/**
 * How many trace rows may be materialised by one read.
 *
 * MEASURED, not chosen by feel. `tools/ops/simulate.mjs` SIM 3: this table holds 46,084 rows today
 * and the loop adds 698 per cycle, so at the 120-minute interval it reaches ~3.1 MILLION inside a
 * year. `loadTrace()` had no limit — `src/db/logs.ts` `tail()` returns `ORDER BY id` with no LIMIT
 * when none is given — and its two callers are `redbot doctor` and `redbot insights`, which are
 * precisely the commands somebody runs when the install is already misbehaving.
 *
 * 20,000 is above any window either caller reasons over and ~4 MB of rows rather than ~650 MB.
 */
export const TRACE_READ_MAX = Number(process.env.REDBOT_TRACE_READ_MAX ?? 20_000);

/** How many trace rows exist ALTOGETHER. A COUNT, so it stays cheap as the table grows. */
export async function traceTotal(): Promise<number> {
  return countLog(getPool(), 'trace');
}

/**
 * The newest `limit` trace events, oldest-first.
 *
 * BOUNDED, AND THE BOUND IS VISIBLE. Returning a window silently would be worse than returning
 * everything: both callers print `events.length` as a total — "46,084 trace event(s) across 31
 * run(s)" — and a capped read would turn that sentence into a smaller number with the same
 * wording, which is a figure that changed meaning without saying so. So `traceTotal()` exists
 * beside this, and both callers were changed to report "newest N of M".
 */
export async function loadTrace(limit: number = TRACE_READ_MAX): Promise<TraceEvent[]> {
  const n = Math.floor(Number(limit));
  return selectTrace(getPool(), Number.isFinite(n) && n > 0 ? { limit: n } : { limit: TRACE_READ_MAX });
}
