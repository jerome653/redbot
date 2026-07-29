/**
 * `redbot job` and `redbot work` — the queue from a terminal.
 *
 * These exist so the workstation has something to call. The console does not reimplement job
 * handling; it spawns these, exactly as it already spawns `draft` and `certify`. One
 * implementation, one set of rules, and a queue an operator can still drive by hand when the
 * console is not running.
 */
import {
  createJob, loadJobs, cancelJob, jobCounts, getJob,
  type JobKind, type JobSpec, type Job
} from '../jobs.js';
import { runPass, registeredKinds, PUBLISH_KINDS } from '../scheduler.js';
import { registerAllRunners } from '../runners.js';
import { selectedAccount, loadAccounts } from '../config.js';
import { say } from '../log.js';

const KINDS: JobKind[] = [
  'read', 'search', 'opportunity', 'draft', 'certify',
  'reply', 'reply-comment', 'post', 'vote', 'save', 'follow', 'publish'
];

/**
 * Which account this command acts for.
 *
 * There is no default and no "first account in the file". A queue operation that guesses whose
 * queue it meant is how work lands under the wrong identity, and identity is the one thing this
 * project refuses to infer.
 */
function requireAccount(explicit?: string): string {
  const handle = explicit ?? selectedAccount()?.handle;
  if (!handle) {
    const known = loadAccounts().map((a) => a.handle).join(', ') || '(none configured)';
    throw new Error(
      `No account selected. Set REDBOT_ACCOUNT or pass --account. Known: ${known}`
    );
  }
  return handle;
}

function line(j: Job): string {
  const when = j.runAt && j.state === 'scheduled' ? ` runAt=${j.runAt}` : '';
  const dep = j.after ? ` after=${j.after}` : '';
  const tries = j.attempts > 0 ? ` attempts=${j.attempts}` : '';
  const why = j.detail ? `\n        ${j.detail}` : '';
  return `  ${j.state.padEnd(9)} ${j.kind.padEnd(13)} ${j.id}${when}${dep}${tries}${why}`;
}

export async function jobList(accountArg?: string, filter?: string): Promise<number> {
  const account = requireAccount(accountArg);
  const all = await loadJobs(account);
  const jobs = filter ? all.filter((j) => j.state === filter) : all;

  say.head(`jobs — ${account}`);
  if (!jobs.length) {
    say.step(filter ? `No jobs in state "${filter}".` : 'No jobs yet. Add one with `redbot job add <kind>`.');
    return 0;
  }
  for (const j of jobs) say.info(line(j));

  const c = await jobCounts(account);
  say.step(
    `${c.pending} pending · ${c.scheduled} scheduled · ${c.running} running · ${c.waiting} waiting · ` +
    `${c.completed} completed · ${c.failed} failed · ${c.cancelled} cancelled`
  );
  if (c.waiting > 0) {
    say.step('"waiting" means a person has to decide — nothing is stuck.');
  }
  return 0;
}

export async function jobAdd(kind: string, args: Record<string, string>, accountArg?: string): Promise<number> {
  const account = requireAccount(accountArg);
  if (!KINDS.includes(kind as JobKind)) {
    say.fail(`"${kind}" is not a job kind. One of: ${KINDS.join(', ')}`);
    return 1;
  }

  const spec: JobSpec = {
    kind: kind as JobKind,
    account,
    args,
    ...(args.runAt ? { runAt: args.runAt } : {}),
    ...(args.after ? { after: args.after } : {}),
    ...(args.maxAttempts ? { maxAttempts: Number(args.maxAttempts) } : {}),
    ...(args.everyMinutes ? { everyMinutes: Number(args.everyMinutes) } : {}),
    ...(args.note ? { note: args.note } : {})
  };

  if (spec.runAt && !Number.isFinite(Date.parse(spec.runAt))) {
    say.fail(`runAt "${spec.runAt}" is not a readable date — use an ISO timestamp.`);
    return 1;
  }
  if (spec.after && !await getJob(account, spec.after)) {
    say.fail(`after "${spec.after}" is not a job on ${account}'s queue.`);
    return 1;
  }

  const job = await createJob(spec);
  say.ok(`queued ${job.kind} — ${job.id} (${job.state})`);
  if (PUBLISH_KINDS.includes(job.kind)) {
    say.step('A publish job waits for a person. `redbot work` will not send it.');
  }
  return 0;
}

export async function jobCancel(id: string, accountArg?: string): Promise<number> {
  const account = requireAccount(accountArg);
  const job = await getJob(account, id);
  if (!job) { say.fail(`No job ${id} on ${account}'s queue.`); return 1; }
  try {
    await cancelJob(account, id);
    say.ok(`cancelled ${id}`);
    return 0;
  } catch (e) {
    // Already terminal. Reported rather than swallowed: "cancel" appearing to succeed on a
    // completed job would tell an operator something untrue about what happened.
    say.fail(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

/**
 * `redbot work` — run the queue.
 *
 * One pass by default. `--every N` keeps running, which is the mode the workstation starts.
 * Sequential and single-account by design: every browser action drives the same attached
 * Chrome as the same person.
 */
export async function work(opts: { account?: string; everyMinutes?: number; once?: boolean }): Promise<number> {
  const account = requireAccount(opts.account);
  registerAllRunners();

  say.head(`redbot work — ${account}`);
  say.step(`Runners: ${registeredKinds().join(', ')}`);
  say.warn('Publishing is not one of them. A publish job stops at "waiting" for a person.');

  const pass = async (): Promise<void> => {
    const r = await runPass(account);
    if (r.recovered) say.warn(`recovered ${r.recovered} interrupted job(s)`);
    if (r.ran === 0) say.step('Nothing eligible this pass.');
    else say.ok(`ran ${r.ran} — ${r.completed} completed, ${r.waiting} waiting, ${r.failed} failed`);
  };

  if (opts.once !== false && !opts.everyMinutes) {
    await pass();
    return 0;
  }

  const minutes = Math.max(1, opts.everyMinutes ?? 15);
  say.step(`Running every ${minutes} minutes. Ctrl+C to stop.`);
  for (;;) {
    try {
      await pass();
    } catch (e) {
      // A pass that throws must not kill the worker: the next one may well succeed, and a
      // queue that stops silently is worse than one that logs a bad pass.
      say.fail(`pass failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, minutes * 60_000));
  }
}
