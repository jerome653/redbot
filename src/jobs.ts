/**
 * The job record — every operator action, as a durable row.
 *
 * Until now an action was a process: you typed a command, it ran, and the only trace was a
 * history line written after the fact. That works for one person at one terminal and fails at
 * everything the workstation needs — showing what is queued, resuming after a restart,
 * scheduling for later, retrying a failure, or telling two accounts apart.
 *
 * A job is the durable form of an intention. It exists before it runs, survives the process
 * that runs it, and records what happened. Nothing here executes anything: this module is the
 * model and the store, `scheduler.ts` is the engine.
 *
 * ## Rules this keeps
 *
 * - **Per account, never shared.** Jobs live under `data/accounts/<handle>/jobs.jsonl`. Two
 *   accounts cannot see, claim, or corrupt each other's work. `accounts.json` already carries
 *   the rule "two accounts never post in the same thread"; separate stores make that structural
 *   rather than a note.
 * - **Append-only.** A job's history is a sequence of appended states, not a mutated row. The
 *   current state is a fold over the log, so a crash mid-write loses at most the last append
 *   and never rewrites an earlier truth.
 * - **Publishing is not a job type that runs unattended.** `publish` jobs reach `waiting` and
 *   stop there. A person still approves in the console and the existing single-use token still
 *   authorises the send. The scheduler cannot complete a publish on its own, and there is a
 *   test that says so.
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from './config.js';

/**
 * Job states.
 *
 * `waiting` is the one that carries weight: it means the job did everything a machine may do
 * and is now blocked on a person. A publish job that has passed its gates sits in `waiting`
 * forever until an operator acts. It is not a failure and it is not a stall.
 */
export type JobState =
  | 'pending'      // created, eligible to run when its preconditions are met
  | 'scheduled'    // has a runAt in the future
  | 'running'      // claimed by a worker
  | 'waiting'      // blocked on a human decision — the scheduler will not advance it
  | 'completed'
  | 'cancelled'
  | 'failed';

export const TERMINAL: readonly JobState[] = ['completed', 'cancelled', 'failed'];

export type JobKind =
  | 'read' | 'search' | 'opportunity' | 'draft' | 'certify'
  | 'reply' | 'reply-comment' | 'post'
  | 'vote' | 'save' | 'follow'
  | 'publish';

export interface JobSpec {
  kind: JobKind;
  account: string;
  /** Free-form arguments for the runner — thread id, query, draft id, direction. */
  args?: Record<string, string | number | boolean>;
  /** ISO time this job may first run. Absent means "as soon as possible". */
  runAt?: string;
  /** This job stays `pending` until the named job reaches `completed`. */
  after?: string;
  /** How many times a failure may be retried. 0 means one attempt, no retry. */
  maxAttempts?: number;
  /** Minutes between repeats. Set only for jobs that should recur. */
  everyMinutes?: number;
  note?: string;
}

export interface Job extends JobSpec {
  id: string;
  state: JobState;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Why it is in its current state. Always populated for failed/cancelled/waiting. */
  detail?: string;
  /** Exit code of the underlying command, when one ran. */
  code?: number;
}

/* ------------------------------------------------------------------ *
 * Store — one append-only log per account
 * ------------------------------------------------------------------ */

export function accountDir(account: string): string {
  // The handle comes from accounts.json, but it reaches here through HTTP bodies and CLI
  // arguments too. Anything that is not a plain handle would escape the data directory.
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(account)) {
    throw new Error(`"${account}" is not a usable account handle`);
  }
  const dir = join(DATA, 'accounts', account);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function jobsPath(account: string): string {
  return join(accountDir(account), 'jobs.jsonl');
}

/** Every appended record, oldest first. Unreadable lines are skipped, never guessed at. */
function readLog(account: string): Job[] {
  const p = jobsPath(account);
  if (!existsSync(p)) return [];
  const out: Job[] = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s) as Job); } catch { /* a torn line is not a job */ }
  }
  return out;
}

/**
 * Current state of every job: the last append wins.
 *
 * Insertion order is preserved so the workstation shows jobs in the order they were created
 * rather than the order they were last touched — a list that reorders itself while you read it
 * is unusable.
 */
export function loadJobs(account: string): Job[] {
  const byId = new Map<string, Job>();
  for (const rec of readLog(account)) byId.set(rec.id, rec);
  return [...byId.values()];
}

export function getJob(account: string, id: string): Job | undefined {
  return loadJobs(account).find((j) => j.id === id);
}

function append(account: string, job: Job): Job {
  appendFileSync(jobsPath(account), JSON.stringify(job) + '\n', 'utf8');
  return job;
}

let seq = 0;

/**
 * `now` is injected rather than read from the clock. The gates suite expired in place once
 * because a helper called `Date.now()` where a caller had already been handed the time; the
 * same mistake here would make every scheduling test depend on the minute it ran.
 */
export function createJob(spec: JobSpec, now: Date = new Date()): Job {
  const ts = now.toISOString();
  const scheduled = Boolean(spec.runAt && Date.parse(spec.runAt) > now.getTime());
  const job: Job = {
    ...spec,
    id: `j_${now.getTime().toString(36)}_${(seq++).toString(36)}`,
    state: scheduled ? 'scheduled' : 'pending',
    attempts: 0,
    createdAt: ts,
    updatedAt: ts
  };
  return append(spec.account, job);
}

export interface TransitionInput {
  state: JobState;
  detail?: string;
  code?: number;
  attempts?: number;
  runAt?: string;
}

/**
 * Move a job to a new state.
 *
 * A terminal job is immutable. Without that rule a retry loop can resurrect a cancelled job,
 * and an operator's cancel would be advisory rather than binding.
 */
export function transition(
  account: string,
  id: string,
  next: TransitionInput,
  now: Date = new Date()
): Job {
  const current = getJob(account, id);
  if (!current) throw new Error(`no job ${id} for ${account}`);
  if (TERMINAL.includes(current.state)) {
    throw new Error(`job ${id} is already ${current.state} and cannot be moved to ${next.state}`);
  }

  const ts = now.toISOString();
  const updated: Job = {
    ...current,
    ...(next.runAt ? { runAt: next.runAt } : {}),
    state: next.state,
    attempts: next.attempts ?? current.attempts,
    updatedAt: ts,
    ...(next.detail !== undefined ? { detail: next.detail } : {}),
    ...(next.code !== undefined ? { code: next.code } : {}),
    ...(next.state === 'running' ? { startedAt: ts } : {}),
    ...(TERMINAL.includes(next.state) ? { finishedAt: ts } : {})
  };
  return append(account, updated);
}

export function cancelJob(account: string, id: string, why = 'cancelled by the operator'): Job {
  return transition(account, id, { state: 'cancelled', detail: why });
}

/**
 * Jobs eligible to run right now, in creation order.
 *
 * Three things hold a job back and each is checked explicitly rather than folded into one
 * boolean, because "why is this not running" is the question an operator actually asks:
 * a future `runAt`, an unfinished `after` dependency, or a state that is not pending.
 */
export function runnable(account: string, now: Date = new Date()): Job[] {
  const all = loadJobs(account);
  const byId = new Map(all.map((j) => [j.id, j]));

  return all.filter((j) => {
    if (j.state !== 'pending' && j.state !== 'scheduled') return false;
    if (j.runAt && Date.parse(j.runAt) > now.getTime()) return false;
    if (j.after) {
      const dep = byId.get(j.after);
      if (!dep || dep.state !== 'completed') return false;
    }
    return true;
  });
}

/** Counts by state, for the workstation header. Absent states are reported as 0, not omitted. */
export function jobCounts(account: string): Record<JobState, number> {
  const counts: Record<JobState, number> = {
    pending: 0, scheduled: 0, running: 0, waiting: 0, completed: 0, cancelled: 0, failed: 0
  };
  for (const j of loadJobs(account)) counts[j.state]++;
  return counts;
}

/**
 * Jobs left `running` by a process that died.
 *
 * A crash leaves a claim nobody owns, and on restart that job is neither running nor eligible.
 * Reporting them separately lets the scheduler requeue them deliberately instead of a worker
 * silently adopting work it did not start.
 */
export function orphaned(account: string, now: Date = new Date(), staleMinutes = 30): Job[] {
  return loadJobs(account).filter((j) => {
    if (j.state !== 'running') return false;
    const started = Date.parse(j.startedAt ?? j.updatedAt);
    if (!Number.isFinite(started)) return true;
    return now.getTime() - started > staleMinutes * 60_000;
  });
}
