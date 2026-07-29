/**
 * The per-account work queue.
 *
 * ## The claim, and why the lock file is gone
 *
 * Two drivers exist for one account queue: the `redbot work` loop, and the operator
 * console's job endpoint, which spawns its own CLI process. The old implementation
 * settled that race with an O_EXCL lock file per job, plus `stealAbandonedClaim` to
 * recover the microsecond window where a worker died between creating the lock and
 * writing the `running` row.
 *
 * A row-level claim removes both. `claimJobRow` is ONE statement:
 *
 *     UPDATE … SET state='running' WHERE id=… AND state IN ('pending','scheduled') …
 *
 * Postgres takes a row lock for the duration, so of two concurrent callers exactly one
 * sees a claimable row and the other's WHERE matches nothing and returns zero rows.
 * The claim and the state change are the same write, so the window the lock file's
 * takeover logic existed to repair cannot open at all.
 *
 * The guarantee is unchanged and the failure mode it protects against is the same one:
 * not a duplicated log row, but the same vote, the same follow, performed twice.
 */
import type { Db } from '../db.js';
import { withTransaction } from '../db.js';
import type { Job, JobSpec, JobState, TransitionInput } from '../jobs.js';
import { TERMINAL } from '../jobs.js';
import type { AccountRecord } from '../config.js';

interface JobRow {
  id: string;
  account: string;
  kind: Job['kind'];
  state: JobState;
  args: Record<string, string | number | boolean> | null;
  run_at: Date | null;
  after_id: string | null;
  max_attempts: number;
  every_minutes: number | null;
  note: string | null;
  attempts: number;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  detail: string | null;
  code: number | null;
}

const SELECT = `
  SELECT id, account, kind, state, args, run_at, after_id, max_attempts, every_minutes,
         note, attempts, created_at, updated_at, started_at, finished_at, detail, code
    FROM redbot.jobs`;

function toJob(r: JobRow): Job {
  const j: Job = {
    id: r.id,
    account: r.account,
    kind: r.kind,
    state: r.state,
    attempts: r.attempts,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    maxAttempts: r.max_attempts
  };
  if (r.args && Object.keys(r.args).length) j.args = r.args;
  if (r.run_at !== null) j.runAt = r.run_at.toISOString();
  if (r.after_id !== null) j.after = r.after_id;
  if (r.every_minutes !== null) j.everyMinutes = r.every_minutes;
  if (r.note !== null) j.note = r.note;
  if (r.started_at !== null) j.startedAt = r.started_at.toISOString();
  if (r.finished_at !== null) j.finishedAt = r.finished_at.toISOString();
  if (r.detail !== null) j.detail = r.detail;
  if (r.code !== null) j.code = r.code;
  return j;
}

/**
 * jobs.account is a foreign key, so the account row must exist before a job can.
 *
 * A handle reaches here from accounts.json, a CLI argument or an HTTP body, and the
 * queue must not refuse work just because nobody has described the account in the
 * config file yet. The row is created with the handle alone and enriched when
 * accounts.json does describe it — never the other way round, so a sync can add
 * detail but this can never overwrite it with blanks.
 */
export async function ensureAccount(db: Db, handle: string, from?: AccountRecord): Promise<void> {
  if (from) {
    await db.query(
      `INSERT INTO redbot.accounts
         (handle, role, speaks, knows, subreddits, timezone, quiet_start, quiet_end,
          daily_ceiling, profile_dir, debug_port, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (handle) DO UPDATE SET
         role = EXCLUDED.role, speaks = EXCLUDED.speaks, knows = EXCLUDED.knows,
         subreddits = EXCLUDED.subreddits, timezone = EXCLUDED.timezone,
         quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end,
         daily_ceiling = EXCLUDED.daily_ceiling, profile_dir = EXCLUDED.profile_dir,
         debug_port = EXCLUDED.debug_port, note = EXCLUDED.note`,
      [handle, from.role ?? null, from.speaks ?? null, from.knows ?? [], from.subreddits ?? [],
       from.timezone ?? null, from.quietHours?.[0] ?? null, from.quietHours?.[1] ?? null,
       from.dailyCeiling ?? null, from.profileDir ?? null, from.debugPort ?? null, from.note ?? null]
    );
    return;
  }
  await db.query(
    'INSERT INTO redbot.accounts (handle) VALUES ($1) ON CONFLICT (handle) DO NOTHING',
    [handle]
  );
}

export async function insertJob(db: Db, job: Job, from?: AccountRecord): Promise<Job> {
  await ensureAccount(db, job.account, from);
  await db.query(
    `INSERT INTO redbot.jobs
       (id, account, kind, state, args, run_at, after_id, max_attempts, every_minutes, note,
        attempts, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      job.id, job.account, job.kind, job.state, JSON.stringify(job.args ?? {}),
      job.runAt ?? null, job.after ?? null, job.maxAttempts ?? 0, job.everyMinutes ?? null,
      job.note ?? null, job.attempts, job.createdAt, job.updatedAt
    ]
  );
  return job;
}

export async function selectJobs(db: Db, account: string): Promise<Job[]> {
  const r = await db.query<JobRow>(`${SELECT} WHERE account = $1 ORDER BY created_at, id`, [account]);
  return r.rows.map(toJob);
}

export async function selectJob(db: Db, account: string, id: string): Promise<Job | undefined> {
  const r = await db.query<JobRow>(`${SELECT} WHERE account = $1 AND id = $2`, [account, id]);
  return r.rows[0] ? toJob(r.rows[0]) : undefined;
}

/**
 * Move a job to a new state, under a row lock.
 *
 * The read and the write are one transaction with SELECT … FOR UPDATE, so the
 * terminal-job and already-running checks cannot be raced past — the old
 * read-then-append had a gap between them.
 */
export async function transitionJob(
  account: string, id: string, next: TransitionInput, now: Date
): Promise<Job> {
  return withTransaction(async (tx) => {
    const cur = await tx.query<JobRow>(
      `${SELECT} WHERE account = $1 AND id = $2 FOR UPDATE`, [account, id]
    );
    const row = cur.rows[0];
    if (!row) throw new Error(`no job ${id} for ${account}`);
    if (TERMINAL.includes(row.state)) {
      throw new Error(`job ${id} is already ${row.state} and cannot be moved to ${next.state}`);
    }
    if (next.state === 'running' && row.state === 'running') {
      throw new Error(`job ${id} is already running and cannot be claimed again`);
    }

    const ts = now.toISOString();
    const r = await tx.query<JobRow>(
      // Every use of $3 is cast to the enum. A bare $3 binds as `text`, and while
      // `state = $3` works in assignment context, `$3 = 'running'` inside a CASE has
      // none — Postgres refuses with "operator does not exist: text = job_state".
      `UPDATE redbot.jobs SET
         state       = $3::redbot.job_state,
         attempts    = COALESCE($4, attempts),
         detail      = COALESCE($5, detail),
         code        = COALESCE($6, code),
         run_at      = COALESCE($7::timestamptz, run_at),
         started_at  = CASE WHEN $3::redbot.job_state = 'running'
                            THEN $8::timestamptz ELSE started_at END,
         finished_at = CASE WHEN $3::redbot.job_state = ANY($9::redbot.job_state[])
                            THEN $8::timestamptz ELSE finished_at END,
         updated_at  = $8::timestamptz
       WHERE account = $1 AND id = $2
       RETURNING id, account, kind, state, args, run_at, after_id, max_attempts, every_minutes,
                 note, attempts, created_at, updated_at, started_at, finished_at, detail, code`,
      [account, id, next.state, next.attempts ?? null, next.detail ?? null,
       next.code ?? null, next.runAt ?? null, ts, [...TERMINAL]]
    );
    return toJob(r.rows[0]!);
  });
}

/**
 * Claim a job, atomically. Returns the claimed job, or null when this worker lost.
 *
 * Null is not an error: another worker is on it, and the correct response is to move
 * to the next job. The WHERE clause carries every precondition — claimable state, and
 * its own schedule — so a caller working from a stale `runnable()` list cannot start a
 * job before its time.
 */
export async function claimJobRow(db: Db, account: string, id: string, now: Date): Promise<Job | null> {
  const ts = now.toISOString();
  const r = await db.query<JobRow>(
    `UPDATE redbot.jobs SET
       state = 'running', attempts = attempts + 1, started_at = $3::timestamptz, updated_at = $3::timestamptz
     WHERE account = $1 AND id = $2
       AND state IN ('pending','scheduled')
       AND (run_at IS NULL OR run_at <= $3::timestamptz)
     RETURNING id, account, kind, state, args, run_at, after_id, max_attempts, every_minutes,
               note, attempts, created_at, updated_at, started_at, finished_at, detail, code`,
    [account, id, ts]
  );
  return r.rows[0] ? toJob(r.rows[0]) : null;
}

export async function countsByState(db: Db, account: string): Promise<Record<JobState, number>> {
  const counts: Record<JobState, number> = {
    pending: 0, scheduled: 0, running: 0, waiting: 0, completed: 0, cancelled: 0, failed: 0
  };
  const r = await db.query<{ state: JobState; n: string }>(
    'SELECT state, count(*)::text AS n FROM redbot.jobs WHERE account = $1 GROUP BY state',
    [account]
  );
  for (const row of r.rows) counts[row.state] = Number(row.n);
  return counts;
}
