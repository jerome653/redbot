/**
 * Jobs and the scheduler.
 *
 * The load-bearing assertions are the refusals: a terminal job cannot be moved, a publish job
 * cannot be completed by the machine, and a dependency that has not completed holds its
 * dependants back. Those are the properties an operator's cancel and an approval gate rest on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-jobs-'));

const { createJob, claimJob, transition, cancelJob, loadJobs, getJob, runnable, jobCounts, orphaned, accountDir } =
  await import('../jobs.js');
const { runPass, registerRunner, clearRunners, recover, PUBLISH_KINDS } =
  await import('../scheduler.js');

const A = 'acct-one';
const B = 'acct-two';
const T0 = new Date('2026-07-27T10:00:00.000Z');
const at = (mins: number) => new Date(T0.getTime() + mins * 60_000);

test('a new job starts pending and is immediately runnable', async () => {
  const j = await createJob({ kind: 'read', account: A, args: { subreddit: 'WordPress' } }, T0);
  assert.equal(j.state, 'pending');
  assert.equal(j.attempts, 0);
  assert.ok((await runnable(A, T0)).some((r) => r.id === j.id));
});

test('a future runAt starts scheduled and is held until its time', async () => {
  const j = await createJob({ kind: 'search', account: A, runAt: at(60).toISOString() }, T0);
  assert.equal(j.state, 'scheduled');
  assert.ok(!(await runnable(A, T0)).some((r) => r.id === j.id), 'must not run before its time');
  assert.ok((await runnable(A, at(61))).some((r) => r.id === j.id), 'must run once its time passes');
});

test('accounts do not share a queue', async () => {
  const mine = await createJob({ kind: 'read', account: B }, T0);
  assert.ok((await loadJobs(B)).some((j) => j.id === mine.id));
  assert.ok(!(await loadJobs(A)).some((j) => j.id === mine.id), 'account A must not see account B jobs');
  assert.notEqual(accountDir(A), accountDir(B));
});

test('a handle that would escape the data directory is refused', async () => {
  for (const bad of ['../accounts', 'a/b', '..', 'has space', '']) {
    assert.throws(() => accountDir(bad), /usable account handle/, `accepted ${JSON.stringify(bad)}`);
  }
});

test('a cancelled job is immutable — the operator decision is binding', async () => {
  const j = await createJob({ kind: 'draft', account: A }, T0);
  await cancelJob(A, j.id);
  assert.equal((await getJob(A, j.id))?.state, 'cancelled');
  await assert.rejects(async () => transition(A, j.id, { state: 'pending' }), /already cancelled/);
  await assert.rejects(async () => transition(A, j.id, { state: 'running' }), /already cancelled/);
});

test('a dependency holds its dependant until it completes', async () => {
  const first = await createJob({ kind: 'draft', account: A }, T0);
  const second = await createJob({ kind: 'certify', account: A, after: first.id }, T0);

  assert.ok(!(await runnable(A, T0)).some((r) => r.id === second.id), 'blocked while the dependency is pending');

  await transition(A, first.id, { state: 'running' }, T0);
  await transition(A, first.id, { state: 'completed' }, T0);
  assert.ok((await runnable(A, T0)).some((r) => r.id === second.id), 'runnable once the dependency completes');
});

test('a failed dependency does not release its dependant', async () => {
  const first = await createJob({ kind: 'draft', account: A }, T0);
  const second = await createJob({ kind: 'certify', account: A, after: first.id }, T0);
  await transition(A, first.id, { state: 'running' }, T0);
  await transition(A, first.id, { state: 'failed', detail: 'model returned nothing' }, T0);
  assert.ok(!(await runnable(A, T0)).some((r) => r.id === second.id));
});

test('an interrupted job is returned to the queue, not adopted silently', async () => {
  const j = await createJob({ kind: 'read', account: A }, T0);
  await transition(A, j.id, { state: 'running' }, T0);

  assert.equal((await orphaned(A, at(5))).length, 0, 'a job running for 5 minutes is not orphaned');
  assert.ok((await orphaned(A, at(45))).some((o) => o.id === j.id), 'a job running for 45 minutes is');

  const n = await recover(A, at(45));
  assert.ok(n >= 1);
  const back = await getJob(A, j.id);
  assert.equal(back?.state, 'pending');
  assert.match(back?.detail ?? '', /stopped before it finished/);
});

test('counts report every state, including the empty ones', async () => {
  const counts = await jobCounts(A);
  for (const k of ['pending', 'scheduled', 'running', 'waiting', 'completed', 'cancelled', 'failed']) {
    assert.equal(typeof counts[k as keyof typeof counts], 'number', `${k} must be reported`);
  }
});

/* ------------------------------------------------------------------ *
 * Claiming
 *
 * redbot genuinely ships two drivers over one account queue: the `redbot work` terminal loop
 * the README documents, and the operator console's job endpoint, which spawns its own CLI
 * process. Claiming used to be `await getJob()` followed by an unlocked append, so both could read
 * `pending` and both could append `running` — and the second worker would repeat an action that
 * cannot be taken back. A duplicated log row is not the damage; a second vote is.
 * ------------------------------------------------------------------ */

test('a job is claimed by exactly one worker, and the loser is refused', async () => {
  const ACCOUNT = 'claim-race';
  const j = await createJob({ kind: 'vote', account: ACCOUNT, args: { permalink: '/r/x/1' } }, T0);

  const first = await claimJob(ACCOUNT, j.id, T0);
  const second = await claimJob(ACCOUNT, j.id, T0);

  assert.ok(first, 'the first worker must get the job');
  assert.equal(first.state, 'running');
  assert.equal(first.attempts, 1, 'a claim counts as an attempt');
  assert.equal(second, null, 'the second worker must be refused, not handed the same job');

  // The old version counted `running` rows in jobs.jsonl, because a second claim appended a
  // second row even while the folded state still read "running" and looked fine. There are no
  // append rows now — the claim IS the row — so the equivalent evidence is the attempt counter:
  // a second successful claim would have incremented it, whatever the state says.
  const after = await getJob(ACCOUNT, j.id);
  assert.equal(after?.attempts, 1, 'a second claim would have counted a second attempt');
  assert.equal(after?.state, 'running');
});

test('a running job cannot be claimed again', async () => {
  const ACCOUNT = 'claim-reclaim';
  const j = await createJob({ kind: 'read', account: ACCOUNT }, T0);
  await transition(ACCOUNT, j.id, { state: 'running' }, T0);

  // running -> running used to be appended silently, which is how a second worker adopted a
  // job that was already in flight.
  await assert.rejects(async () => transition(ACCOUNT, j.id, { state: 'running' }, T0), /already running/);
});

test('a claim is freed when the job leaves running, so a recovered job can be re-claimed', async () => {
  const ACCOUNT = 'claim-release';
  const j = await createJob({ kind: 'read', account: ACCOUNT }, T0);

  assert.ok(await claimJob(ACCOUNT, j.id, T0), 'the first claim wins');
  assert.equal(await claimJob(ACCOUNT, j.id, T0), null, 'and holds while the job runs');

  // exactly what recover() does to a job whose worker died
  await transition(ACCOUNT, j.id, { state: 'pending', detail: 'the process stopped' }, at(45));

  const again = await claimJob(ACCOUNT, j.id, at(45));
  assert.ok(again, 'a requeued job must be claimable again — a lock left behind strands the job');
  assert.equal(again.attempts, 2, 'and the earlier attempt still counts');
});

test('a claim is refused for a job that is not eligible', async () => {
  const ACCOUNT = 'claim-ineligible';

  const stopped = await createJob({ kind: 'read', account: ACCOUNT }, T0);
  await cancelJob(ACCOUNT, stopped.id);
  assert.equal(await claimJob(ACCOUNT, stopped.id, T0), null, 'a cancelled job may never be claimed');

  const later = await createJob({ kind: 'read', account: ACCOUNT, runAt: at(60).toISOString() }, T0);
  assert.equal(await claimJob(ACCOUNT, later.id, T0), null, 'nor one that is not due yet');
  assert.ok(await claimJob(ACCOUNT, later.id, at(61)), 'and it is claimable once its time comes');
});

/**
 * REPLACES: 'a claim abandoned before its running row is taken over, but only once it is
 * provably so'.
 *
 * That test hand-wrote a `.claim` lock file to reproduce the one case the file lock could
 * strand — a process killed between taking the claim and writing its `running` row, leaving a
 * lock on a job that is still `pending`, which `orphaned()` never reports. `stealAbandonedClaim`
 * existed solely to recover it.
 *
 * The scenario is now unrepresentable rather than merely fixed. The claim and the state change
 * are a single UPDATE, so a claim cannot exist without the `running` row it belongs to, and
 * there is no artifact left behind to strand the job. What is worth asserting is that
 * atomicity, which is what the old defect was the absence of.
 */
test('a claim and its running row are the same write — no claim can outlive its state', async () => {
  const ACCOUNT = 'claim-atomic';
  const j = await createJob({ kind: 'read', account: ACCOUNT }, T0);

  const taken = await claimJob(ACCOUNT, j.id, T0);
  assert.ok(taken, 'the claim must succeed');

  // Read back independently: the instant the claim returns, the persisted state is already
  // `running`. Under the lock file there was a window where a claim existed and this still
  // said `pending`, and that window is what stranded jobs.
  assert.equal((await getJob(ACCOUNT, j.id))?.state, 'running',
    'a claimed job is running on disk immediately, with no intermediate state to be killed in');

  // And because the state IS the claim, leaving `running` is the only thing that frees it —
  // there is no separate artifact that could survive and block a requeued job forever.
  await transition(ACCOUNT, j.id, { state: 'pending', detail: 'the process stopped' }, at(45));
  assert.ok(await claimJob(ACCOUNT, j.id, at(45)),
    'nothing is left behind to strand the job once it returns to the queue');
});

/**
 * Ids used to be `j_<millis>_<seq>` with `seq` starting at 0 in every process, and the console
 * spawns a fresh CLI process for each job it adds. Two adds in the same millisecond from
 * different processes therefore minted the same id — and because `loadJobs` folds the log
 * last-append-wins per id, the collision did not error, it silently DELETED the earlier job
 * from the queue.
 *
 * A second process is simulated by importing the module a second time under a different URL:
 * ESM gives each import its own instance with its own zeroed counter, which is exactly the
 * state a freshly spawned CLI starts in. Both share `config.js`, so both write the same store.
 */
test('two processes creating a job in the same millisecond do not collide', async () => {
  const modUrl = new URL('../jobs.js', import.meta.url).href;
  const worker = (await import(`${modUrl}?process=worker`)) as typeof import('../jobs.js');
  const console_ = (await import(`${modUrl}?process=console`)) as typeof import('../jobs.js');

  const ACCOUNT = 'id-collision';
  const a = await worker.createJob({ kind: 'read', account: ACCOUNT, note: 'from the work loop' }, T0);
  const b = await console_.createJob({ kind: 'read', account: ACCOUNT, note: 'from the console' }, T0);

  assert.notEqual(a.id, b.id, 'same millisecond, first job of each process — ids must still differ');

  const queue = await loadJobs(ACCOUNT);
  assert.equal(queue.length, 2, 'a collision does not fail loudly, it swallows a job');
  assert.deepEqual(queue.map((j) => j.note).sort(), ['from the console', 'from the work loop']);
});

/* ------------------------------------------------------------------ *
 * The scheduler
 * ------------------------------------------------------------------ */

test('a runner that succeeds completes its job', async () => {
  clearRunners();
  const seen: string[] = [];
  registerRunner('read', async (job) => { seen.push(job.id); });

  const j = await createJob({ kind: 'read', account: 'sched-ok' }, T0);
  const r = await runPass('sched-ok', T0);

  assert.equal(r.completed, 1);
  assert.deepEqual(seen, [j.id]);
  assert.equal((await getJob('sched-ok', j.id))?.state, 'completed');
  clearRunners();
});

test('a kind with no runner fails loudly instead of sitting forever', async () => {
  clearRunners();
  const j = await createJob({ kind: 'search', account: 'sched-norunner' }, T0);
  const r = await runPass('sched-norunner', T0);
  assert.equal(r.failed, 1);
  const done = await getJob('sched-norunner', j.id);
  assert.equal(done?.state, 'failed');
  assert.match(done?.detail ?? '', /no runner is registered/);
});

test('a failure inside maxAttempts is retried with a delay, and exhausts', async () => {
  clearRunners();
  registerRunner('draft', async () => { throw new Error('model unavailable'); });

  const j = await createJob({ kind: 'draft', account: 'sched-retry', maxAttempts: 1 }, T0);

  await runPass('sched-retry', T0);
  const first = await getJob('sched-retry', j.id);
  assert.equal(first?.state, 'pending', 'still pending — a retry remains');
  assert.equal(first?.attempts, 1);
  assert.match(first?.detail ?? '', /retrying in/);
  assert.ok(first?.runAt, 'a retry must be delayed, not immediate');

  // far enough ahead that the back-off has elapsed
  await runPass('sched-retry', at(120));
  const second = await getJob('sched-retry', j.id);
  assert.equal(second?.state, 'failed', 'the retry is spent');
  assert.equal(second?.attempts, 2);
  assert.equal(second?.detail, 'model unavailable');
  clearRunners();
});

/**
 * The one that matters most in the whole file.
 *
 * A publish runner is registered here that would complete the job if it were ever called. The
 * job must still end the pass in `waiting`, because the guard is on the kind and runs before
 * any runner lookup. If this test ever fails, redbot has become capable of unattended
 * publishing and the change that did it must be reverted, not accommodated.
 */
test('the scheduler cannot publish, even with a publish runner registered', async () => {
  clearRunners();
  let called = false;
  registerRunner('publish', async () => { called = true; });

  const j = await createJob({ kind: 'publish', account: 'sched-publish', args: { draftId: 'd_x' } }, T0);
  const r = await runPass('sched-publish', T0);

  assert.equal(called, false, 'a publish runner must never be invoked by the scheduler');
  assert.equal(r.waiting, 1);
  assert.equal(r.completed, 0);
  const after = await getJob('sched-publish', j.id);
  assert.equal(after?.state, 'waiting');
  assert.match(after?.detail ?? '', /person to approve/);

  // and it stays waiting across further passes — never drifts to completed
  await runPass('sched-publish', at(600));
  assert.equal((await getJob('sched-publish', j.id))?.state, 'waiting');
  assert.ok(PUBLISH_KINDS.includes('publish'));
  clearRunners();
});

/**
 * `reply` is the CLI command that sends a draft to Reddit, so a queued reply is a publish and
 * must stop for a person exactly like one. Asserted separately because the failure mode is
 * subtle: without it a reply job falls through to "no runner is registered", which reads as a
 * wiring bug — and the obvious fix for that bug is to add a runner, which would be unattended
 * publishing introduced by someone trying to be helpful.
 */
test('a queued reply is treated as a publish, not as a missing runner', async () => {
  clearRunners();
  const j = await createJob({ kind: 'reply', account: 'sched-reply', args: { draftId: 'd_y' } }, T0);
  const r = await runPass('sched-reply', T0);

  assert.equal(r.waiting, 1);
  assert.equal(r.failed, 0, 'a reply must not fail as an unwired kind');
  const after = await getJob('sched-reply', j.id);
  assert.equal(after?.state, 'waiting');
  assert.match(after?.detail ?? '', /person to approve/);
  assert.ok(PUBLISH_KINDS.includes('reply'));
});

/**
 * Anything that puts PUBLIC CONTENT on Reddit stops for a person.
 *
 * Found 2026-07-27 while testing: `reply-comment` and `post` both had working runners and were
 * absent from PUBLISH_KINDS, so the scheduler would have executed them — a public statement
 * under the operator's name with no certification, no approval and no token, purely because
 * they were not called "publish". A vote or a follow is reversible in one click; a post is not.
 */
test('every content-producing kind stops for a person, not just the ones called publish', async () => {
  clearRunners();
  const ran: string[] = [];
  for (const kind of ['reply-comment', 'post'] as const) {
    registerRunner(kind, async () => { ran.push(kind); });
  }

  const a = await createJob({ kind: 'reply-comment', account: 'content', args: { body: 'x' } }, T0);
  const b = await createJob({ kind: 'post', account: 'content', args: { title: 'x' } }, T0);
  const r = await runPass('content', T0);

  assert.deepEqual(ran, [], 'a content runner must never be invoked by the scheduler');
  assert.equal(r.waiting, 2);
  assert.equal((await getJob('content', a.id))?.state, 'waiting');
  assert.equal((await getJob('content', b.id))?.state, 'waiting');
  clearRunners();
});

test('a recurring job schedules a successor instead of looping in place', async () => {
  clearRunners();
  registerRunner('read', async () => {});

  const j = await createJob({ kind: 'read', account: 'sched-repeat', everyMinutes: 60 }, T0);
  await runPass('sched-repeat', T0);

  const all = await loadJobs('sched-repeat');
  assert.equal((await getJob('sched-repeat', j.id))?.state, 'completed');
  const successor = all.find((x) => x.id !== j.id && x.kind === 'read');
  assert.ok(successor, 'a successor job must exist');
  assert.equal(successor.state, 'scheduled');
  assert.equal(successor.everyMinutes, 60);
  assert.ok(!(await runnable('sched-repeat', T0)).some((x) => x.id === successor.id), 'successor waits its turn');
  clearRunners();
});

test('a cancelled job is skipped by the pass rather than run', async () => {
  clearRunners();
  let ran = 0;
  registerRunner('read', async () => { ran++; });

  const j = await createJob({ kind: 'read', account: 'sched-cancel' }, T0);
  await cancelJob('sched-cancel', j.id);
  const r = await runPass('sched-cancel', T0);

  assert.equal(ran, 0);
  assert.equal(r.ran, 0);
  clearRunners();
});

test('job state survives a reload — it is in the database, not in the process', async () => {
  const j = await createJob({ kind: 'read', account: 'sched-durable' }, T0);
  await transition('sched-durable', j.id, { state: 'running' }, T0);
  await transition('sched-durable', j.id, { state: 'completed' }, T0);

  // Was: assert jobs.jsonl exists. The store is Postgres now, so durability is asserted by
  // reading the state back through a fresh query rather than by the presence of a file.
  assert.equal((await loadJobs('sched-durable')).find((x) => x.id === j.id)?.state, 'completed');
  assert.equal((await getJob('sched-durable', j.id))?.state, 'completed');
});

process.on('exit', async () => {
  try { rmSync(process.env.REDBOT_DATA!, { recursive: true, force: true }); } catch { /* ignore */ }
});
