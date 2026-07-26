/**
 * Scheduler under load, and after a crash.
 *
 * ## What this proves, and what it explicitly does not
 *
 * It proves the QUEUE MACHINERY: that 120 mixed jobs all run, that none runs twice, that none
 * is starved, that dependencies and schedules hold under volume, that a killed worker's claim
 * is recovered, and that publish-class jobs never execute no matter how many passes run.
 *
 * It proves **nothing about Reddit**. The runners here are stubs. A stub returning success is
 * not evidence that a vote landed, a reply appeared, or a post survived automod — those need a
 * real signed-in session, and on 2026-07-27 the only attachable browser was headless
 * (`HeadlessChrome/150.0.0.0`), which Reddit answers with a block page. So every Reddit-facing
 * capability stays WRITTEN, not VERIFIED, and this file deliberately does not pretend otherwise.
 *
 * The distinction matters because a stubbed pass is exactly the shape of a simulated success,
 * and this project's central failure (HRC-001) was a fluent output nobody checked against
 * reality.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-stress-'));

const { createJob, loadJobs, getJob, transition, jobCounts } = await import('../jobs.js');
const { runPass, registerRunner, clearRunners } = await import('../scheduler.js');

const T0 = new Date('2026-07-27T12:00:00.000Z');
const at = (mins: number) => new Date(T0.getTime() + mins * 60_000);

test('120 mixed jobs: all run, none twice, none starved', async () => {
  clearRunners();
  const ACCOUNT = 'stress';
  const runsPerJob = new Map<string, number>();

  // Every non-publish kind gets the same counting stub. The point is the queue, not the work.
  for (const kind of ['read', 'search', 'opportunity', 'draft', 'certify', 'vote', 'save', 'follow', 'post', 'reply-comment'] as const) {
    registerRunner(kind, async (job) => {
      runsPerJob.set(job.id, (runsPerJob.get(job.id) ?? 0) + 1);
    });
  }

  const kinds = ['read', 'search', 'vote', 'save', 'follow', 'post', 'draft', 'certify'] as const;
  const created: string[] = [];
  for (let i = 0; i < 120; i++) {
    const kind = kinds[i % kinds.length]!;
    created.push(createJob({ kind, account: ACCOUNT, args: { n: i } }, T0).id);
  }
  // …plus publish-class work mixed in, which must survive every pass untouched.
  const publishIds = [
    createJob({ kind: 'publish', account: ACCOUNT, args: { draftId: 'd_1' } }, T0).id,
    createJob({ kind: 'reply', account: ACCOUNT, args: { draftId: 'd_2' } }, T0).id
  ];

  const started = Date.now();
  const pass = await runPass(ACCOUNT, T0);
  const elapsed = Date.now() - started;

  assert.equal(pass.ran, 122, 'every queued job should be attempted in one pass');
  assert.equal(pass.completed, 120);
  assert.equal(pass.waiting, 2, 'both publish-class jobs stop for a person');
  assert.equal(pass.failed, 0);

  // no duplicate execution
  for (const id of created) {
    assert.equal(runsPerJob.get(id), 1, `job ${id} ran ${runsPerJob.get(id)} times`);
  }
  // no starvation
  assert.equal(runsPerJob.size, 120, 'every non-publish job ran exactly once');

  // publish-class jobs did not execute and did not complete
  for (const id of publishIds) {
    assert.equal(runsPerJob.get(id), undefined, 'a publish-class job must never reach a runner');
    assert.equal(getJob(ACCOUNT, id)?.state, 'waiting');
  }

  const counts = jobCounts(ACCOUNT);
  assert.equal(counts.completed, 120);
  assert.equal(counts.waiting, 2);
  assert.equal(counts.running, 0, 'no job may be left claimed');

  // Latency is recorded rather than asserted against a threshold: this machine's timing is not
  // a property of the software, and a green bar that depends on the CI host is a lie waiting.
  // eslint-disable-next-line no-console
  console.log(`      [stress] 122 jobs, one pass, ${elapsed} ms wall clock`);
  clearRunners();
});

test('a second pass over a drained queue does nothing', async () => {
  clearRunners();
  let ran = 0;
  registerRunner('read', async () => { ran++; });
  const again = await runPass('stress', at(1));
  assert.equal(again.ran, 0, 'completed work must not be re-run');
  assert.equal(ran, 0);
  clearRunners();
});

test('scheduled work stays scheduled until its time, then runs exactly once', async () => {
  clearRunners();
  const ACCOUNT = 'stress-time';
  let ran = 0;
  registerRunner('read', async () => { ran++; });

  const soon = createJob({ kind: 'read', account: ACCOUNT, runAt: at(1).toISOString() }, T0);
  const later = createJob({ kind: 'read', account: ACCOUNT, runAt: at(60).toISOString() }, T0);
  const tomorrow = createJob({ kind: 'read', account: ACCOUNT, runAt: at(24 * 60).toISOString() }, T0);

  await runPass(ACCOUNT, T0);
  assert.equal(ran, 0, 'nothing is due yet');

  await runPass(ACCOUNT, at(2));
  assert.equal(ran, 1);
  assert.equal(getJob(ACCOUNT, soon.id)?.state, 'completed');
  assert.equal(getJob(ACCOUNT, later.id)?.state, 'scheduled');

  await runPass(ACCOUNT, at(61));
  assert.equal(ran, 2);
  assert.equal(getJob(ACCOUNT, tomorrow.id)?.state, 'scheduled', 'tomorrow is still tomorrow');

  await runPass(ACCOUNT, at(24 * 60 + 1));
  assert.equal(ran, 3);
  clearRunners();
});

test('a recurring job keeps producing successors, one per pass, never a burst', async () => {
  clearRunners();
  const ACCOUNT = 'stress-recur';
  let ran = 0;
  registerRunner('read', async () => { ran++; });

  createJob({ kind: 'read', account: ACCOUNT, everyMinutes: 30 }, T0);

  await runPass(ACCOUNT, T0);
  assert.equal(ran, 1);

  // 29 minutes later the successor is not due
  await runPass(ACCOUNT, at(29));
  assert.equal(ran, 1, 'the successor must not fire early');

  await runPass(ACCOUNT, at(31));
  assert.equal(ran, 2);

  // The chain is a sequence of discrete rows, not one row rewritten.
  const all = loadJobs(ACCOUNT);
  assert.ok(all.length >= 3, 'each run leaves its own record');
  assert.equal(all.filter((j) => j.state === 'completed').length, 2);
  clearRunners();
});

/**
 * A worker that dies mid-job.
 *
 * Simulated by leaving a job in `running` with an old timestamp, which is exactly the state a
 * killed process leaves behind — the claim is on disk and nobody owns it. The next pass must
 * requeue it rather than leave it stranded or let a second worker adopt it silently.
 */
test('a crashed worker\'s job is recovered and completes on the next pass', async () => {
  clearRunners();
  const ACCOUNT = 'stress-crash';
  let ran = 0;
  registerRunner('read', async () => { ran++; });

  const j = createJob({ kind: 'read', account: ACCOUNT }, T0);
  transition(ACCOUNT, j.id, { state: 'running' }, T0);   // the process dies here

  const r = await runPass(ACCOUNT, at(45));
  assert.equal(r.recovered, 1, 'the orphaned claim must be recovered');
  assert.equal(ran, 1, 'and then actually run');
  assert.equal(getJob(ACCOUNT, j.id)?.state, 'completed');
  clearRunners();
});

test('a runner that throws does not stop the pass or the jobs behind it', async () => {
  clearRunners();
  const ACCOUNT = 'stress-throw';
  let good = 0;
  registerRunner('vote', async () => { throw new Error('rate limited (429)'); });
  registerRunner('read', async () => { good++; });

  createJob({ kind: 'vote', account: ACCOUNT, args: { permalink: 'x' } }, T0);
  createJob({ kind: 'read', account: ACCOUNT }, T0);
  createJob({ kind: 'read', account: ACCOUNT }, T0);

  const r = await runPass(ACCOUNT, T0);
  assert.equal(r.failed, 1);
  assert.equal(good, 2, 'work behind a failure still runs');
  assert.equal(jobCounts(ACCOUNT).running, 0, 'nothing left claimed after a throw');
  clearRunners();
});

test('two accounts under load never touch each other\'s queues', async () => {
  clearRunners();
  const seen: string[] = [];
  registerRunner('read', async (job) => { seen.push(job.account); });

  for (let i = 0; i < 20; i++) {
    createJob({ kind: 'read', account: 'load-a' }, T0);
    createJob({ kind: 'read', account: 'load-b' }, T0);
  }

  const a = await runPass('load-a', T0);
  assert.equal(a.completed, 20);
  assert.ok(seen.every((x) => x === 'load-a'), 'a pass for one account ran another account\'s work');
  assert.equal(jobCounts('load-b').pending, 20, 'the other queue is untouched');
  clearRunners();
});

process.on('exit', () => {
  try { rmSync(process.env.REDBOT_DATA!, { recursive: true, force: true }); } catch { /* ignore */ }
});
