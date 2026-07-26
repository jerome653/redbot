/**
 * Jobs and the scheduler.
 *
 * The load-bearing assertions are the refusals: a terminal job cannot be moved, a publish job
 * cannot be completed by the machine, and a dependency that has not completed holds its
 * dependants back. Those are the properties an operator's cancel and an approval gate rest on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-jobs-'));

const { createJob, transition, cancelJob, loadJobs, getJob, runnable, jobCounts, orphaned, accountDir } =
  await import('../jobs.js');
const { runPass, registerRunner, clearRunners, recover, PUBLISH_KINDS } =
  await import('../scheduler.js');

const A = 'acct-one';
const B = 'acct-two';
const T0 = new Date('2026-07-27T10:00:00.000Z');
const at = (mins: number) => new Date(T0.getTime() + mins * 60_000);

test('a new job starts pending and is immediately runnable', () => {
  const j = createJob({ kind: 'read', account: A, args: { subreddit: 'WordPress' } }, T0);
  assert.equal(j.state, 'pending');
  assert.equal(j.attempts, 0);
  assert.ok(runnable(A, T0).some((r) => r.id === j.id));
});

test('a future runAt starts scheduled and is held until its time', () => {
  const j = createJob({ kind: 'search', account: A, runAt: at(60).toISOString() }, T0);
  assert.equal(j.state, 'scheduled');
  assert.ok(!runnable(A, T0).some((r) => r.id === j.id), 'must not run before its time');
  assert.ok(runnable(A, at(61)).some((r) => r.id === j.id), 'must run once its time passes');
});

test('accounts do not share a queue', () => {
  const mine = createJob({ kind: 'read', account: B }, T0);
  assert.ok(loadJobs(B).some((j) => j.id === mine.id));
  assert.ok(!loadJobs(A).some((j) => j.id === mine.id), 'account A must not see account B jobs');
  assert.notEqual(accountDir(A), accountDir(B));
});

test('a handle that would escape the data directory is refused', () => {
  for (const bad of ['../accounts', 'a/b', '..', 'has space', '']) {
    assert.throws(() => accountDir(bad), /usable account handle/, `accepted ${JSON.stringify(bad)}`);
  }
});

test('a cancelled job is immutable — the operator decision is binding', () => {
  const j = createJob({ kind: 'draft', account: A }, T0);
  cancelJob(A, j.id);
  assert.equal(getJob(A, j.id)?.state, 'cancelled');
  assert.throws(() => transition(A, j.id, { state: 'pending' }), /already cancelled/);
  assert.throws(() => transition(A, j.id, { state: 'running' }), /already cancelled/);
});

test('a dependency holds its dependant until it completes', () => {
  const first = createJob({ kind: 'draft', account: A }, T0);
  const second = createJob({ kind: 'certify', account: A, after: first.id }, T0);

  assert.ok(!runnable(A, T0).some((r) => r.id === second.id), 'blocked while the dependency is pending');

  transition(A, first.id, { state: 'running' }, T0);
  transition(A, first.id, { state: 'completed' }, T0);
  assert.ok(runnable(A, T0).some((r) => r.id === second.id), 'runnable once the dependency completes');
});

test('a failed dependency does not release its dependant', () => {
  const first = createJob({ kind: 'draft', account: A }, T0);
  const second = createJob({ kind: 'certify', account: A, after: first.id }, T0);
  transition(A, first.id, { state: 'running' }, T0);
  transition(A, first.id, { state: 'failed', detail: 'model returned nothing' }, T0);
  assert.ok(!runnable(A, T0).some((r) => r.id === second.id));
});

test('an interrupted job is returned to the queue, not adopted silently', () => {
  const j = createJob({ kind: 'read', account: A }, T0);
  transition(A, j.id, { state: 'running' }, T0);

  assert.equal(orphaned(A, at(5)).length, 0, 'a job running for 5 minutes is not orphaned');
  assert.ok(orphaned(A, at(45)).some((o) => o.id === j.id), 'a job running for 45 minutes is');

  const n = recover(A, at(45));
  assert.ok(n >= 1);
  const back = getJob(A, j.id);
  assert.equal(back?.state, 'pending');
  assert.match(back?.detail ?? '', /stopped before it finished/);
});

test('counts report every state, including the empty ones', () => {
  const counts = jobCounts(A);
  for (const k of ['pending', 'scheduled', 'running', 'waiting', 'completed', 'cancelled', 'failed']) {
    assert.equal(typeof counts[k as keyof typeof counts], 'number', `${k} must be reported`);
  }
});

/* ------------------------------------------------------------------ *
 * The scheduler
 * ------------------------------------------------------------------ */

test('a runner that succeeds completes its job', async () => {
  clearRunners();
  const seen: string[] = [];
  registerRunner('read', async (job) => { seen.push(job.id); });

  const j = createJob({ kind: 'read', account: 'sched-ok' }, T0);
  const r = await runPass('sched-ok', T0);

  assert.equal(r.completed, 1);
  assert.deepEqual(seen, [j.id]);
  assert.equal(getJob('sched-ok', j.id)?.state, 'completed');
  clearRunners();
});

test('a kind with no runner fails loudly instead of sitting forever', async () => {
  clearRunners();
  const j = createJob({ kind: 'search', account: 'sched-norunner' }, T0);
  const r = await runPass('sched-norunner', T0);
  assert.equal(r.failed, 1);
  const done = getJob('sched-norunner', j.id);
  assert.equal(done?.state, 'failed');
  assert.match(done?.detail ?? '', /no runner is registered/);
});

test('a failure inside maxAttempts is retried with a delay, and exhausts', async () => {
  clearRunners();
  registerRunner('draft', async () => { throw new Error('model unavailable'); });

  const j = createJob({ kind: 'draft', account: 'sched-retry', maxAttempts: 1 }, T0);

  await runPass('sched-retry', T0);
  const first = getJob('sched-retry', j.id);
  assert.equal(first?.state, 'pending', 'still pending — a retry remains');
  assert.equal(first?.attempts, 1);
  assert.match(first?.detail ?? '', /retrying in/);
  assert.ok(first?.runAt, 'a retry must be delayed, not immediate');

  // far enough ahead that the back-off has elapsed
  await runPass('sched-retry', at(120));
  const second = getJob('sched-retry', j.id);
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

  const j = createJob({ kind: 'publish', account: 'sched-publish', args: { draftId: 'd_x' } }, T0);
  const r = await runPass('sched-publish', T0);

  assert.equal(called, false, 'a publish runner must never be invoked by the scheduler');
  assert.equal(r.waiting, 1);
  assert.equal(r.completed, 0);
  const after = getJob('sched-publish', j.id);
  assert.equal(after?.state, 'waiting');
  assert.match(after?.detail ?? '', /person to approve/);

  // and it stays waiting across further passes — never drifts to completed
  await runPass('sched-publish', at(600));
  assert.equal(getJob('sched-publish', j.id)?.state, 'waiting');
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
  const j = createJob({ kind: 'reply', account: 'sched-reply', args: { draftId: 'd_y' } }, T0);
  const r = await runPass('sched-reply', T0);

  assert.equal(r.waiting, 1);
  assert.equal(r.failed, 0, 'a reply must not fail as an unwired kind');
  const after = getJob('sched-reply', j.id);
  assert.equal(after?.state, 'waiting');
  assert.match(after?.detail ?? '', /person to approve/);
  assert.ok(PUBLISH_KINDS.includes('reply'));
});

test('a recurring job schedules a successor instead of looping in place', async () => {
  clearRunners();
  registerRunner('read', async () => {});

  const j = createJob({ kind: 'read', account: 'sched-repeat', everyMinutes: 60 }, T0);
  await runPass('sched-repeat', T0);

  const all = loadJobs('sched-repeat');
  assert.equal(getJob('sched-repeat', j.id)?.state, 'completed');
  const successor = all.find((x) => x.id !== j.id && x.kind === 'read');
  assert.ok(successor, 'a successor job must exist');
  assert.equal(successor.state, 'scheduled');
  assert.equal(successor.everyMinutes, 60);
  assert.ok(!runnable('sched-repeat', T0).some((x) => x.id === successor.id), 'successor waits its turn');
  clearRunners();
});

test('a cancelled job is skipped by the pass rather than run', async () => {
  clearRunners();
  let ran = 0;
  registerRunner('read', async () => { ran++; });

  const j = createJob({ kind: 'read', account: 'sched-cancel' }, T0);
  cancelJob('sched-cancel', j.id);
  const r = await runPass('sched-cancel', T0);

  assert.equal(ran, 0);
  assert.equal(r.ran, 0);
  clearRunners();
});

test('the job log survives a reload — state is on disk, not in the process', () => {
  const j = createJob({ kind: 'read', account: 'sched-durable' }, T0);
  transition('sched-durable', j.id, { state: 'running' }, T0);
  transition('sched-durable', j.id, { state: 'completed' }, T0);
  assert.ok(existsSync(join(accountDir('sched-durable'), 'jobs.jsonl')));
  assert.equal(loadJobs('sched-durable').find((x) => x.id === j.id)?.state, 'completed');
});

process.on('exit', () => {
  try { rmSync(process.env.REDBOT_DATA!, { recursive: true, force: true }); } catch { /* ignore */ }
});
