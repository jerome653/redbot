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
 * - **One job, one worker.** A job is not moved into `running` by writing a row; it is CLAIMED
 *   through `claimJob()`, and the claim is decided by a single atomic filesystem operation.
 *   This project genuinely ships two drivers for the same account queue — the `redbot work`
 *   terminal loop and the console's job endpoint, which spawns its own CLI process — so
 *   "read the state, then append running" was two processes running the same irreversible
 *   browser action.
 * - **Publishing is not a job type that runs unattended.** `publish` jobs reach `waiting` and
 *   stop there. A person still approves in the console and the existing single-use token still
 *   authorises the send. The scheduler cannot complete a publish on its own, and there is a
 *   test that says so.
 */
import {
  appendFileSync, readFileSync, writeFileSync, unlinkSync, renameSync, existsSync, mkdirSync
} from 'node:fs';
import { randomBytes } from 'node:crypto';
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

import { getPool } from './db.js';
import { insertJob, selectJobs, selectJob, transitionJob, claimJobRow, countsByState } from './db/jobs.js';
import { loadAccounts } from './config.js';

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

/**
 * Current state of every job, in creation order.
 *
 * The JSONL era folded an append-only log last-write-wins per id; the table holds that
 * folded state directly. Creation order is preserved for the same reason it always was:
 * a queue that reorders itself while you read it is unusable.
 */
export async function loadJobs(account: string): Promise<Job[]> {
  accountDir(account);                       // validates the handle, as it always did
  return selectJobs(getPool(), account);
}

export async function getJob(account: string, id: string): Promise<Job | undefined> {
  return selectJob(getPool(), account, id);
}

let seq = 0;

/**
 * What makes an id unique BETWEEN processes, not just within one.
 *
 * The id used to be `j_<millis>_<seq>` with `seq` starting at 0 in every process. The console
 * spawns a fresh CLI process per job-add, so every console-created job was seq 0 — two adds in
 * the same millisecond from different processes minted the SAME id, and because `loadJobs` folds
 * the log last-append-wins per id, the earlier job silently disappeared from the queue.
 *
 * pid alone is not enough (pids are recycled, and two machines can share one), so three random
 * bytes ride along. Collision now needs the same millisecond, the same pid AND the same 1-in-16M
 * draw. Not cryptographic — it is an identity, not a secret.
 */
const PROCESS_TAG = `${process.pid.toString(36)}${randomBytes(3).toString('hex')}`;

/**
 * `now` is injected rather than read from the clock. The gates suite expired in place once
 * because a helper called `Date.now()` where a caller had already been handed the time; the
 * same mistake here would make every scheduling test depend on the minute it ran.
 */
export async function createJob(spec: JobSpec, now: Date = new Date()): Promise<Job> {
  const ts = now.toISOString();
  const scheduled = Boolean(spec.runAt && Date.parse(spec.runAt) > now.getTime());
  const job: Job = {
    ...spec,
    id: `j_${now.getTime().toString(36)}_${PROCESS_TAG}_${(seq++).toString(36)}`,
    state: scheduled ? 'scheduled' : 'pending',
    attempts: 0,
    createdAt: ts,
    updatedAt: ts
  };
  // The account row must exist before the job's foreign key will accept it. It is
  // enriched from accounts.json when that file describes this handle.
  const described = loadAccounts().find((a) => a.handle.toLowerCase() === spec.account.toLowerCase());
  return insertJob(getPool(), job, described);
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
 *
 * A running job cannot be moved to `running` either. That used to be allowed silently, which
 * meant a second worker could append its own claim over a live one and both would drive the
 * browser. Re-claiming is not a state change, it is a bug, so it is refused loudly.
 */
export async function transition(
  account: string,
  id: string,
  next: TransitionInput,
  now: Date = new Date()
): Promise<Job> {
  return transitionJob(account, id, next, now);
}

export async function cancelJob(account: string, id: string, why = 'cancelled by the operator'): Promise<Job> {
  return await transition(account, id, { state: 'cancelled', detail: why });
}

/* ------------------------------------------------------------------ *
 * Claiming — exactly one worker per job
 *
 * Two drivers exist for one account queue: the `redbot work` loop the README documents, and the
 * operator console's job endpoint, which spawns its own CLI process. `await getJob()` then
 * `append(running)` is a read-then-write with a gap in the middle, so both could read `pending`
 * and both could append a claim. The consequence is not a duplicated log row — it is the same
 * vote, the same follow, the same irreversible browser action performed twice.
 *
 * `takeConsoleApproval()` in ask.ts already had to solve "exactly one of two racing readers
 * wins", and it does it the only way that actually holds: one atomic filesystem operation
 * decides the winner and the loser gets an error, rather than both sides checking first.
 *
 * That precedent uses `rename` because it has a token file sitting there to rename away. A job
 * has no such file, and `rename` cannot be borrowed directly: it REPLACES its destination, so
 * two racing renames both "succeed" and pick no winner. The exclusive-create flag `wx` is the
 * same guarantee for the case where the winner must create the token rather than consume it —
 * O_EXCL is atomic on every local filesystem, so of two processes exactly one creates the file
 * and the other gets EEXIST.
 *
 * The claim is taken BEFORE the state is re-read, not after: checking first and locking second
 * is the original defect with more steps.
 * ------------------------------------------------------------------ */

/**
 * Take exclusive ownership of a job and move it to `running`. Returns the claimed job,
 * or null when this worker did not get it.
 *
 * Null is not an error and not a failure — it means another worker is already on this
 * job, and the correct response is to move to the next one. A caller that treats null
 * as "run it anyway" has reintroduced the defect.
 *
 * ONE STATEMENT. See src/db/jobs.ts for why the lock file, `claimsDir`, `claimPath`
 * and `stealAbandonedClaim` are gone: the claim and the state change are now the same
 * write, so the crash window their takeover logic repaired cannot open.
 *
 * The usual crashed-worker case is unchanged: that job is `running` in the table, so
 * `orphaned()` finds it after the staleness window and the scheduler's `recover()`
 * moves it out of `running`.
 */
export async function claimJob(account: string, id: string, now: Date = new Date()): Promise<Job | null> {
  return claimJobRow(getPool(), account, id, now);
}

/**
 * Kept as a no-op so callers that released a claim still read correctly.
 *
 * There is no separate claim to drop any more — leaving `running` IS releasing it,
 * because the state is the claim. Removing the call sites instead would have scattered
 * this explanation across the scheduler.
 */
export function releaseClaim(_account: string, _id: string): void {
  /* the row state is the claim; nothing to release */
}

/**
 * Jobs eligible to run right now, in creation order.
 *
 * Three things hold a job back and each is checked explicitly rather than folded into one
 * boolean, because "why is this not running" is the question an operator actually asks:
 * a future `runAt`, an unfinished `after` dependency, or a state that is not pending.
 */
export async function runnable(account: string, now: Date = new Date()): Promise<Job[]> {
  const all = await loadJobs(account);
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
export async function jobCounts(account: string): Promise<Record<JobState, number>> {
  return countsByState(getPool(), account);
}

/**
 * Jobs left `running` by a process that died.
 *
 * A crash leaves a claim nobody owns, and on restart that job is neither running nor eligible.
 * Reporting them separately lets the scheduler requeue them deliberately instead of a worker
 * silently adopting work it did not start.
 */
export async function orphaned(account: string, now: Date = new Date(), staleMinutes = 30): Promise<Job[]> {
  return (await loadJobs(account)).filter((j) => {
    if (j.state !== 'running') return false;
    const started = Date.parse(j.startedAt ?? j.updatedAt);
    if (!Number.isFinite(started)) return true;
    return now.getTime() - started > staleMinutes * 60_000;
  });
}
