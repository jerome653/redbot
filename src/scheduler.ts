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
 * `maxAttempts` allows — including after a crash, which is a ceiling `recover()` has to apply
 * itself because the catch block in `runOne` is exactly the code a dead process never reaches.
 *
 * A pass does not assume it is the only one. Jobs are taken with `claimJob()`, which hands a
 * job to exactly one worker; a job this pass did not win is skipped, not run.
 */
import { record } from './log.js';
import {
  loadJobs, runnable, transition, claimJob, createJob, orphaned,
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
 *
 * `reply-comment` and `post` were ADDED 2026-07-27 after a gap found while testing. Both have
 * working runners, so the scheduler would have executed them — putting **public content**
 * under the operator's name with no certification, no approval prompt and no token, purely
 * because they were not called "publish". The line this project draws is not about the word:
 *
 *   - votes, saves, follows change a relationship and are reversible in one click
 *   - a post or a reply is a **public statement** and is not
 *
 * Everything in the second category stops for a person. Testing one means a human authorises
 * that specific action, which is exactly the guarantee — not an exception to it.
 */
export const PUBLISH_KINDS: readonly JobKind[] = ['publish', 'reply', 'reply-comment', 'post'];

export interface PassResult {
  ran: number;
  completed: number;
  failed: number;
  waiting: number;
  recovered: number;
  requeued: number;
}

/**
 * Deal with jobs interrupted by a process that died.
 *
 * Called at the start of every pass rather than only at startup: a worker can die at any point,
 * and a scheduler that only recovers on boot leaves work stranded until someone restarts it.
 *
 * The retry ceiling is applied HERE as well as in `runOne`'s catch block, and that duplication
 * is the point. A crash never reaches a catch block, so the ceiling used to exist only for
 * failures polite enough to throw: an orphan came back as `pending` with no comparison against
 * `maxAttempts` at all, was picked up, crashed the worker again, and was requeued again, for as
 * long as whatever killed the process kept killing it. A job that kills its worker is the LAST
 * thing that should be retried without limit.
 *
 * The comparison matches `runOne` exactly — `attempts` counts attempts already made, so a job
 * with `attempts` still within `maxAttempts` has a try left and anything beyond it does not.
 *
 * Returns the number of orphans dealt with, requeued and failed alike: the operator's question
 * is "how much work did a dead process leave behind", not "how much of it survived".
 */
export async function recover(account: string, now: Date = new Date()): Promise<number> {
  let n = 0;
  for (const job of await orphaned(account, now)) {
    const allowed = job.maxAttempts ?? 0;

    if (job.attempts > allowed) {
      const why =
        `the process running this job stopped before it finished, and its ${job.attempts} ` +
        `attempt(s) already exhausted maxAttempts=${allowed} — not requeued`;
      await transition(account, job.id, { state: 'failed', detail: why }, now);
      await record('job.failed', `${job.kind} job ${job.id} failed: ${why}`, {
        account, jobId: job.id, attempts: job.attempts, level: 'error'
      });
      n++;
      continue;
    }

    await transition(account, job.id, {
      state: 'pending',
      detail: 'the process running this job stopped before it finished — returned to the queue'
    }, now);
    await record('job.recovered', `recovered ${job.kind} job ${job.id}`, {
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
 * row whose meaning changes. `runAt` is computed from the COMPLETION time, which means a job
 * that overran its own interval does not immediately fire again.
 *
 * `completedAt` is a separate argument from the pass clock because those two are not the same
 * instant and the difference is the whole point. This used to be handed the pass timestamp,
 * captured before the runner ran, so a `everyMinutes: 15` job that took 40 minutes scheduled
 * its successor 25 minutes in the past — due on the very next pass, back to back, exactly the
 * behaviour the paragraph above says cannot happen. The doc was right and the code was wrong.
 */
async function scheduleRepeat(job: Job, completedAt: Date): Promise<Job | null> {
  if (!job.everyMinutes || job.everyMinutes <= 0) return null;
  const next = new Date(completedAt.getTime() + job.everyMinutes * 60_000).toISOString();
  const spec = {
    kind: job.kind,
    account: job.account,
    runAt: next,
    maxAttempts: job.maxAttempts,
    everyMinutes: job.everyMinutes,
    ...(job.args ? { args: job.args } : {}),
    ...(job.note ? { note: job.note } : {})
  };
  return await createJob(spec, completedAt);
}

/**
 * `skipped` means another worker claimed the job first. It is not an outcome of the job — this
 * pass simply did not run it — so it is reported separately from failure and is not counted.
 */
type RunOutcome = 'completed' | 'failed' | 'waiting' | 'skipped';

async function runOne(job: Job, now: Date): Promise<RunOutcome> {
  const account = job.account;

  /**
   * Publishing stops here, before a runner is even looked up. Written as a guard on the kind
   * rather than as "no runner is registered" so that registering one by mistake cannot open
   * the path.
   */
  if (PUBLISH_KINDS.includes(job.kind)) {
    await transition(account, job.id, {
      state: 'waiting',
      detail: 'ready for a person to approve — redbot does not publish on its own'
    }, now);
    return 'waiting';
  }

  const runner = runners.get(job.kind);
  if (!runner) {
    await transition(account, job.id, {
      state: 'failed',
      detail: `no runner is registered for "${job.kind}" jobs`
    }, now);
    return 'failed';
  }

  /**
   * The claim, not a state write. Between `runnable()` listing this job and this line, another
   * worker — the console spawns its own CLI process for the same queue — may already have taken
   * it. `claimJob` settles that with one atomic filesystem operation; null means we lost, and
   * losing means moving on, never running anyway.
   */
  const claimed = await claimJob(account, job.id, now);
  if (!claimed) return 'skipped';

  const attempts = claimed.attempts;

  /**
   * How long the runner actually took, measured on the real clock.
   *
   * The pass timestamp `now` stays the clock for every RECORDED state, so the log is
   * reproducible and a test can drive the scheduler from a fixed date. But a duration is not a
   * timestamp: a recurring job's next run has to be spaced from when this one finished, and the
   * pass timestamp was captured before the runner ran. Measuring the elapsed time and adding it
   * to the pass clock gives the completion instant without any helper reaching behind its
   * caller's back for the wall clock — the defect that made the gates suite expire on a
   * calendar boundary.
   */
  const startedMs = Date.now();

  try {
    await runner(claimed);
    const completedAt = new Date(now.getTime() + (Date.now() - startedMs));
    await transition(account, job.id, { state: 'completed' }, now);
    await scheduleRepeat(job, completedAt);
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
      await transition(account, job.id, {
        state: 'pending',
        attempts,
        runAt: new Date(now.getTime() + delayMinutes * 60_000).toISOString(),
        detail: `attempt ${attempts} failed (${why}) — retrying in ${delayMinutes}m`
      }, now);
      await record('job.retry', `${job.kind} job ${job.id} retrying`, {
        account, jobId: job.id, attempts, why
      });
      return 'failed';
    }

    await transition(account, job.id, { state: 'failed', attempts, detail: why }, now);
    await record('job.failed', `${job.kind} job ${job.id} failed: ${why}`, {
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

  result.recovered = await recover(account, now);

  for (const job of await runnable(account, now)) {
    // Re-read: an earlier job in this pass may have cancelled or completed a dependency.
    const fresh = (await loadJobs(account)).find((j) => j.id === job.id);
    if (!fresh || (fresh.state !== 'pending' && fresh.state !== 'scheduled')) continue;

    const outcome = await runOne(fresh, now);
    // Counted after the fact, because until the claim is settled this pass does not know
    // whether the job is its work at all. A job another worker took was not "ran by us".
    if (outcome === 'skipped') continue;

    result.ran++;
    if (outcome === 'completed') result.completed++;
    else if (outcome === 'waiting') result.waiting++;
    else result.failed++;
  }

  return result;
}
