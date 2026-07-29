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

  // Content-producing kinds are deliberately absent: `post` and `reply-comment` are
  // publish-class and stop for a person, so putting them in the rotation would be measuring
  // the approval gate rather than queue throughput. They get their own assertion below.
  const kinds = ['read', 'search', 'vote', 'save', 'follow', 'opportunity', 'draft', 'certify'] as const;
  const created: string[] = [];
  for (let i = 0; i < 120; i++) {
    const kind = kinds[i % kinds.length]!;
    created.push((await createJob({ kind, account: ACCOUNT, args: { n: i } }, T0)).id);
  }
  // …plus every publish-class kind mixed in, which must survive every pass untouched.
  const publishIds = [
    (await createJob({ kind: 'publish', account: ACCOUNT, args: { draftId: 'd_1' } }, T0)).id,
    (await createJob({ kind: 'reply', account: ACCOUNT, args: { draftId: 'd_2' } }, T0)).id,
    (await createJob({ kind: 'reply-comment', account: ACCOUNT, args: { body: 'x' } }, T0)).id,
    (await createJob({ kind: 'post', account: ACCOUNT, args: { title: 'x' } }, T0)).id
  ];

  const started = Date.now();
  const pass = await runPass(ACCOUNT, T0);
  const elapsed = Date.now() - started;

  assert.equal(pass.ran, 124, "every queued job should be attempted in one pass");
  assert.equal(pass.completed, 120);
  assert.equal(pass.waiting, 4, 'all four publish-class jobs stop for a person');
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
    assert.equal((await getJob(ACCOUNT, id))?.state, 'waiting');
  }

  const counts = await jobCounts(ACCOUNT);
  assert.equal(counts.completed, 120);
  assert.equal(counts.waiting, 4);
  assert.equal(counts.running, 0, 'no job may be left claimed');

  // Latency is recorded rather than asserted against a threshold: this machine's timing is not
  // a property of the software, and a green bar that depends on the CI host is a lie waiting.
  // eslint-disable-next-line no-console
  console.log(`      [stress] 124 jobs, one pass, ${elapsed} ms wall clock`);
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

  const soon = await createJob({ kind: 'read', account: ACCOUNT, runAt: at(1).toISOString() }, T0);
  const later = await createJob({ kind: 'read', account: ACCOUNT, runAt: at(60).toISOString() }, T0);
  const tomorrow = await createJob({ kind: 'read', account: ACCOUNT, runAt: at(24 * 60).toISOString() }, T0);

  await runPass(ACCOUNT, T0);
  assert.equal(ran, 0, 'nothing is due yet');

  await runPass(ACCOUNT, at(2));
  assert.equal(ran, 1);
  assert.equal((await getJob(ACCOUNT, soon.id))?.state, 'completed');
  assert.equal((await getJob(ACCOUNT, later.id))?.state, 'scheduled');

  await runPass(ACCOUNT, at(61));
  assert.equal(ran, 2);
  assert.equal((await getJob(ACCOUNT, tomorrow.id))?.state, 'scheduled', 'tomorrow is still tomorrow');

  await runPass(ACCOUNT, at(24 * 60 + 1));
  assert.equal(ran, 3);
  clearRunners();
});

test('a recurring job keeps producing successors, one per pass, never a burst', async () => {
  clearRunners();
  const ACCOUNT = 'stress-recur';
  let ran = 0;
  registerRunner('read', async () => { ran++; });

  await createJob({ kind: 'read', account: ACCOUNT, everyMinutes: 30 }, T0);

  await runPass(ACCOUNT, T0);
  assert.equal(ran, 1);

  // 29 minutes later the successor is not due
  await runPass(ACCOUNT, at(29));
  assert.equal(ran, 1, 'the successor must not fire early');

  await runPass(ACCOUNT, at(31));
  assert.equal(ran, 2);

  // The chain is a sequence of discrete rows, not one row rewritten.
  const all = await loadJobs(ACCOUNT);
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

  const j = await createJob({ kind: 'read', account: ACCOUNT }, T0);
  await transition(ACCOUNT, j.id, { state: 'running' }, T0);   // the process dies here

  const r = await runPass(ACCOUNT, at(45));
  assert.equal(r.recovered, 1, 'the orphaned claim must be recovered');
  assert.equal(ran, 1, 'and then actually run');
  assert.equal((await getJob(ACCOUNT, j.id))?.state, 'completed');
  clearRunners();
});

/**
 * A worker that dies on the job's LAST permitted attempt.
 *
 * The retry ceiling used to live only in `runOne`'s catch block, which is precisely the code a
 * process death never reaches: `recover()` returned every orphan to `pending` without ever
 * comparing `attempts` to `maxAttempts`. So a job that crashed its worker was requeued, crashed
 * the next worker, and was requeued again, forever — unbounded retry on the one failure mode
 * where it does the most damage. The job here has already burned both attempts that
 * `maxAttempts: 1` allows, so recovery must fail it rather than hand it out again.
 */
test('an orphan that has exhausted its attempts is failed, not requeued forever', async () => {
  clearRunners();
  const ACCOUNT = 'stress-orphan-ceiling';
  let ran = 0;
  registerRunner('read', async () => { ran++; });

  const j = await createJob({ kind: 'read', account: ACCOUNT, maxAttempts: 1 }, T0);
  await transition(ACCOUNT, j.id, { state: 'running', attempts: 2 }, T0);   // the process dies here

  const r = await runPass(ACCOUNT, at(45));

  assert.equal(r.recovered, 1, 'the orphan is still accounted for');
  const after = await getJob(ACCOUNT, j.id);
  assert.equal(after?.state, 'failed', 'an exhausted orphan must not go back to pending');
  assert.match(after?.detail ?? '', /exhausted maxAttempts/);
  assert.equal(ran, 0, 'and it must not be run again');

  // terminal means terminal — a later pass must not resurrect it either
  await runPass(ACCOUNT, at(120));
  assert.equal((await getJob(ACCOUNT, j.id))?.state, 'failed');
  assert.equal(ran, 0);
  clearRunners();
});

/** The other half of the ceiling: an orphan with a try left is still recovered, not condemned. */
test('an orphan that still has attempts left is requeued and runs', async () => {
  clearRunners();
  const ACCOUNT = 'stress-orphan-retry';
  let ran = 0;
  registerRunner('read', async () => { ran++; });

  const j = await createJob({ kind: 'read', account: ACCOUNT, maxAttempts: 2 }, T0);
  await transition(ACCOUNT, j.id, { state: 'running', attempts: 1 }, T0);

  const r = await runPass(ACCOUNT, at(45));
  assert.equal(r.recovered, 1);
  assert.equal(ran, 1, 'a job with a retry left must still be retried');
  assert.equal((await getJob(ACCOUNT, j.id))?.state, 'completed');
  clearRunners();
});

/**
 * A recurring job that overran its own interval.
 *
 * `scheduleRepeat` is documented as spacing the successor from the COMPLETION time, so that a
 * job taking longer than its interval does not fire again immediately. It was handed the pass
 * timestamp instead — captured before the runner ran — so the successor was due `everyMinutes`
 * after the pass STARTED, which for an overrunning job is already in the past.
 *
 * The runner sleeps on the real clock, so the only thing asserted is the direction: the gap
 * must be strictly larger than the bare interval. Nothing here depends on how fast this machine
 * is, which is the same reason the throughput test above records its latency instead of
 * asserting a threshold.
 */
test('a recurring job is spaced from its completion, not from the start of the pass', async () => {
  clearRunners();
  const ACCOUNT = 'stress-overrun';
  registerRunner('read', async () => { await new Promise((r) => setTimeout(r, 40)); });

  const j = await createJob({ kind: 'read', account: ACCOUNT, everyMinutes: 60 }, T0);
  await runPass(ACCOUNT, T0);
  assert.equal((await getJob(ACCOUNT, j.id))?.state, 'completed');

  const successor = (await loadJobs(ACCOUNT)).find((x) => x.id !== j.id);
  assert.ok(successor, 'a successor must be scheduled');
  assert.ok(successor.runAt, 'and it must carry the time it is due');

  const gap = Date.parse(successor.runAt) - T0.getTime();
  assert.ok(
    gap > 60 * 60_000,
    `the successor must be spaced from when the run finished, not from when the pass began (gap ${gap} ms)`
  );
  clearRunners();
});

test('a runner that throws does not stop the pass or the jobs behind it', async () => {
  clearRunners();
  const ACCOUNT = 'stress-throw';
  let good = 0;
  registerRunner('vote', async () => { throw new Error('rate limited (429)'); });
  registerRunner('read', async () => { good++; });

  await createJob({ kind: 'vote', account: ACCOUNT, args: { permalink: 'x' } }, T0);
  await createJob({ kind: 'read', account: ACCOUNT }, T0);
  await createJob({ kind: 'read', account: ACCOUNT }, T0);

  const r = await runPass(ACCOUNT, T0);
  assert.equal(r.failed, 1);
  assert.equal(good, 2, 'work behind a failure still runs');
  assert.equal((await jobCounts(ACCOUNT)).running, 0, 'nothing left claimed after a throw');
  clearRunners();
});

test('two accounts under load never touch each other\'s queues', async () => {
  clearRunners();
  const seen: string[] = [];
  registerRunner('read', async (job) => { seen.push(job.account); });

  for (let i = 0; i < 20; i++) {
    await createJob({ kind: 'read', account: 'load-a' }, T0);
    await createJob({ kind: 'read', account: 'load-b' }, T0);
  }

  const a = await runPass('load-a', T0);
  assert.equal(a.completed, 20);
  assert.ok(seen.every((x) => x === 'load-a'), 'a pass for one account ran another account\'s work');
  assert.equal((await jobCounts('load-b')).pending, 20, 'the other queue is untouched');
  clearRunners();
});

process.on('exit', async () => {
  try { rmSync(process.env.REDBOT_DATA!, { recursive: true, force: true }); } catch { /* ignore */ }
});
