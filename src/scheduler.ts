/**
 * The scheduler — the engine that moves jobs.
 *
 * It does three things and nothing else: pick the jobs that are eligible, run each one through
 * its registered runner, and record what happened. Deciding *what* a job does belongs to the
 * runner; deciding *whether it may happen at all* belongs to the gates that already exist.
 *
 * ## The line it does not cross
 *
 * A `publish` job is driven to `waiting` and left there. The scheduler has no path that
 * completes a publish, by construction rather than by configuration: `PUBLISH_KINDS` is
 * consulted before a runner is looked up, and there is a test asserting a publish job is still
 * `waiting` after a full pass with a runner registered that would have completed it. The
 * existing guarantees are untouched — the single-use console token, the gate matrix, the Argus
 * REJECT block, and the fact that a person types SEND.
 *
 * ## Restart safety
 *
 * State lives in the append-only job log, never in this process. A worker that dies leaves a
 * job in `running`; `recover()` finds those on the next pass and returns them to `pending` with
 * the interruption recorded. Nothing is lost and nothing is silently retried more than its
 * `maxAttempts` allows.
 */
import { record } from './log.js';
import {
  loadJobs, runnable, transition, createJob, orphaned,
  type Job, type JobKind
} from './jobs.js';

/** A runner does the work and returns nothing. Throwing is how it reports failure. */
export type JobRunner = (job: Job) => Promise<void>;

const runners = new Map<JobKind, JobRunner>();

export function registerRunner(kind: JobKind, run: JobRunner): void {
  runners.set(kind, run);
}

export function registeredKinds(): JobKind[] {
  return [...runners.keys()].sort();
}

/** Test seam. Registration is process-global, so a test that adds one must be able to undo it. */
export function clearRunners(): void {
  runners.clear();
}

/**
 * Kinds the scheduler may never carry to completion.
 *
 * Publishing is the only action that reaches the outside world irreversibly, and the project's
 * central finding is that no automated check measures truth. So the machine does every
 * reversible part — collect, score, draft, certify — and stops.
 *
 * `reply` is here alongside `publish` because it IS a publish: `redbot reply` is the command
 * that sends a draft to Reddit. Without this entry a queued `reply` would fall through to "no
 * runner is registered" and read as a wiring bug rather than as the deliberate refusal it is —
 * and the day somebody fixed that "bug" by adding a runner, redbot would publish unattended.
 */
export const PUBLISH_KINDS: readonly JobKind[] = ['publish', 'reply'];

export interface PassResult {
  ran: number;
  completed: number;
  failed: number;
  waiting: number;
  recovered: number;
  requeued: number;
}

/**
 * Return interrupted jobs to the queue.
 *
 * Called at the start of every pass rather than only at startup: a worker can die at any point,
 * and a scheduler that only recovers on boot leaves work stranded until someone restarts it.
 */
export function recover(account: string, now: Date = new Date()): number {
  let n = 0;
  for (const job of orphaned(account, now)) {
    transition(account, job.id, {
      state: 'pending',
      detail: 'the process running this job stopped before it finished — returned to the queue'
    }, now);
    record('job.recovered', `recovered ${job.kind} job ${job.id}`, {
      account, jobId: job.id, kind: job.kind
    });
    n++;
  }
  return n;
}

/**
 * A recurring job schedules its successor rather than looping in place.
 *
 * The successor is a new row, so the log reads as a history of discrete runs instead of one
 * row whose meaning changes. `runAt` is computed from the completion time, which means a job
 * that overran its own interval does not immediately fire again.
 */
function scheduleRepeat(job: Job, now: Date): Job | null {
  if (!job.everyMinutes || job.everyMinutes <= 0) return null;
  const next = new Date(now.getTime() + job.everyMinutes * 60_000).toISOString();
  const spec = {
    kind: job.kind,
    account: job.account,
    runAt: next,
    maxAttempts: job.maxAttempts,
    everyMinutes: job.everyMinutes,
    ...(job.args ? { args: job.args } : {}),
    ...(job.note ? { note: job.note } : {})
  };
  return createJob(spec, now);
}

async function runOne(job: Job, now: Date): Promise<'completed' | 'failed' | 'waiting'> {
  const account = job.account;

  /**
   * Publishing stops here, before a runner is even looked up. Written as a guard on the kind
   * rather than as "no runner is registered" so that registering one by mistake cannot open
   * the path.
   */
  if (PUBLISH_KINDS.includes(job.kind)) {
    transition(account, job.id, {
      state: 'waiting',
      detail: 'ready for a person to approve — redbot does not publish on its own'
    }, now);
    return 'waiting';
  }

  const runner = runners.get(job.kind);
  if (!runner) {
    transition(account, job.id, {
      state: 'failed',
      detail: `no runner is registered for "${job.kind}" jobs`
    }, now);
    return 'failed';
  }

  const attempts = job.attempts + 1;
  transition(account, job.id, { state: 'running', attempts }, now);

  try {
    await runner({ ...job, attempts });
    // `now` throughout, never `new Date()`. The pass timestamp is the scheduler's clock, and a
    // helper reaching for the wall clock behind its caller's back is precisely the defect that
    // made the gates suite expire on a calendar boundary.
    transition(account, job.id, { state: 'completed' }, now);
    scheduleRepeat(job, now);
    return 'completed';
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    const allowed = job.maxAttempts ?? 0;

    if (attempts <= allowed) {
      /**
       * Back off before retrying. A failure caused by rate limiting and retried immediately
       * produces more rate limiting, which is a failure mode this codebase has already
       * measured once (HTTP 429 after roughly 75 page loads in a few minutes).
       */
      const delayMinutes = Math.min(30, 2 ** attempts);
      transition(account, job.id, {
        state: 'pending',
        attempts,
        runAt: new Date(now.getTime() + delayMinutes * 60_000).toISOString(),
        detail: `attempt ${attempts} failed (${why}) — retrying in ${delayMinutes}m`
      }, now);
      record('job.retry', `${job.kind} job ${job.id} retrying`, {
        account, jobId: job.id, attempts, why
      });
      return 'failed';
    }

    transition(account, job.id, { state: 'failed', attempts, detail: why }, now);
    record('job.failed', `${job.kind} job ${job.id} failed: ${why}`, {
      account, jobId: job.id, attempts, level: 'error'
    });
    return 'failed';
  }
}

/**
 * One pass over an account's queue.
 *
 * Sequential on purpose. Every runner drives the same attached browser as the same Reddit
 * account, so two jobs in flight would interleave page navigations and produce exactly the
 * kind of unattributable mess this project exists to avoid.
 */
export async function runPass(account: string, now: Date = new Date()): Promise<PassResult> {
  const result: PassResult = {
    ran: 0, completed: 0, failed: 0, waiting: 0, recovered: 0, requeued: 0
  };

  result.recovered = recover(account, now);

  for (const job of runnable(account, now)) {
    // Re-read: an earlier job in this pass may have cancelled or completed a dependency.
    const fresh = loadJobs(account).find((j) => j.id === job.id);
    if (!fresh || (fresh.state !== 'pending' && fresh.state !== 'scheduled')) continue;

    result.ran++;
    const outcome = await runOne(fresh, now);
    if (outcome === 'completed') result.completed++;
    else if (outcome === 'waiting') result.waiting++;
    else result.failed++;
  }

  return result;
}
