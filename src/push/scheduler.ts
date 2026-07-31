/**
 * When a push happens, without anybody asking for one.
 *
 * FOUR TRIGGERS, and they exist for different reasons:
 *
 *   start   — the dashboard learns this install is alive, and gets current numbers immediately.
 *   run end — the only moment the numbers actually change. This is what makes a dashboard feel
 *             live rather than "up to twenty minutes stale".
 *   timer   — a heartbeat. Its job is to make SILENCE meaningful: an install that has pushed
 *             nothing for an hour is either idle or broken, and without a heartbeat those look
 *             identical from the dashboard.
 *   quit    — a final state, so the last thing the dashboard saw is not mid-session.
 *
 * NEVER BLOCKS ANYTHING. Every trigger is fire-and-forget and every failure is swallowed. A push
 * that cannot reach the network must not delay a run, stop a screen rendering, or hold a quit
 * open. The cursor stays put on failure, so the events are simply sent next time.
 *
 * THE OVERLAP GUARD IS THE POINT. Two pushes running at once share one `push-state.json`: the
 * second reads the watermark before the first has written it, re-sends the same events, and then
 * whichever finishes last decides where the cursor ends up. The server de-duplicates, so this
 * costs bandwidth rather than correctness — but a timer firing during a slow backfill would do it
 * on every tick. One in flight at a time, and a trigger that arrives during one is DROPPED rather
 * than queued: there is nothing to catch up on, because the next push sends everything anyway.
 */
import { pushOnce, pushConfig, type PushReport } from './index.js';
import { pushAccounts } from './accounts.js';
import { PushClient } from './client.js';
import { resolveToken } from './index.js';

/** Why this push ran. Reported so a log line can say what woke it. */
export type Trigger = 'start' | 'run-end' | 'timer' | 'quit' | 'manual';

export interface SchedulerOptions {
  /** How often the heartbeat fires. Floored so a typo cannot hammer the service. */
  intervalMs?: number;
  /** Where progress goes. Defaults to nowhere — this must be silent by default. */
  log?: (line: string) => void;
  /** Injected in tests. */
  now?: () => number;
  fetchImpl?: typeof fetch;
}

/** Fifteen minutes. Lower bound of one minute — the service rate-limits at 120 requests/60s. */
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;

export interface PushScheduler {
  /** Fire a push for this reason. Returns the report, or null when it was skipped. */
  trigger(reason: Trigger): Promise<PushReport | null>;
  /** Start the heartbeat. Idempotent. */
  start(): void;
  /** Stop the heartbeat and wait for any push in flight. */
  stop(): Promise<void>;
  /** For tests and status: is a push running right now? */
  readonly busy: boolean;
  /** How many triggers were dropped because one was already running. */
  readonly dropped: number;
}

export function createScheduler(opts: SchedulerOptions = {}): PushScheduler {
  const log = opts.log ?? (() => {});
  const interval = Math.max(MIN_INTERVAL_MS, opts.intervalMs ?? readIntervalFromEnv());
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<PushReport | null> | null = null;
  let dropped = 0;
  let stopped = false;

  async function run(reason: Trigger): Promise<PushReport | null> {
    /* Configuration is checked on every trigger, not once at construction: an operator can paste
       an endpoint and a token on the Setup screen while the app is running, and the next timer
       tick should simply start working. */
    const { baseUrl } = pushConfig();
    if (!baseUrl) return null;
    const { token } = await resolveToken();
    if (!token) return null;

    const report = await pushOnce(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {});

    /* The account list rides along. It is one small request and only sent when the list actually
       changed, so it costs nothing on the overwhelming majority of ticks. */
    try {
      const client = new PushClient({
        baseUrl, token, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {})
      });
      const acc = await pushAccounts(client);
      if (acc.sent) log(`push[${reason}] accounts: ${acc.accounts} as v${acc.listVersion}`);
    } catch (e) {
      log(`push[${reason}] accounts failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const blocked = report.streams.filter((s) => s.stopped);
    if (report.sent) log(`push[${reason}] ${report.sent} event(s)`);
    if (report.fatal) log(`push[${reason}] stopped: ${report.fatal}`);
    else if (blocked.length) log(`push[${reason}] ${blocked.length} stream(s) not delivered`);
    return report;
  }

  async function trigger(reason: Trigger): Promise<PushReport | null> {
    if (stopped && reason !== 'quit') return null;
    if (inFlight) {
      /* Dropped, not queued. The next push sends everything outstanding regardless, so a queue
         would only guarantee a second identical request. */
      dropped += 1;
      return null;
    }
    inFlight = (async () => {
      try {
        return await run(reason);
      } catch (e) {
        /* Swallowed on purpose. A push must never be the reason a run, a screen or a quit fails. */
        log(`push[${reason}] error: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    trigger,
    start() {
      if (timer) return;
      stopped = false;
      timer = setInterval(() => { void trigger('timer'); }, interval);
      /* Never hold the process open for a heartbeat — an Electron main process or a CLI must be
         able to exit with this timer pending. */
      timer.unref?.();
      log(`push scheduler started, every ${Math.round(interval / 1000)}s`);
    },
    async stop() {
      stopped = true;
      if (timer) { clearInterval(timer); timer = null; }
      if (inFlight) { try { await inFlight; } catch { /* already logged */ } }
    },
    get busy() { return inFlight !== null; },
    get dropped() { return dropped; }
  };
}

/** `REDBOT_SYNC_INTERVAL_MS`, when it is a number. Anything else falls back to the default. */
function readIntervalFromEnv(): number {
  const raw = process.env.REDBOT_SYNC_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_MS;
}

export { DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS };
