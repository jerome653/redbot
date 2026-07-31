/**
 * The push scheduler: when it fires, when it refuses to, and what it never does.
 *
 * THE ASSERTION THAT MATTERS is the overlap guard. Two pushes at once share one
 * `push-state.json`: the second reads the watermark before the first writes it, re-sends the same
 * events, and whichever finishes last decides where the cursor lands. The receiving service
 * de-duplicates so this costs bandwidth rather than correctness — but a heartbeat firing during a
 * slow backfill would do it on every tick, forever.
 *
 * THE SECOND is that nothing here can break the app. A push happens on the path that finishes a
 * run and on the path that quits; if either could throw or hang, a network outage would stop runs
 * completing and stop the app closing.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(ROOT, 'db', 'sqlite', 'migrate.mjs');

const dir = mkdtempSync(join(tmpdir(), 'redbot-sched-'));
process.env.REDBOT_DATA = dir;
process.env.REDBOT_DB = join(dir, 'redbot.db');
process.env.REDBOT_INSTALL_ID = '33333333-4444-4555-8666-777777777777';
process.env.REDBOT_MACHINE = 'sched-test';
process.env.REDBOT_SYNC_URL = 'https://push.invalid';
process.env.REDBOT_SYNC_PUSH_TOKEN = 'sched-token';

const migrated = spawnSync(process.execPath, [RUNNER, 'up'], { encoding: 'utf8' });
if (migrated.status !== 0) throw new Error(`migrate up failed:\n${migrated.stderr}`);

const { getPool, closePool } = await import('../db.js');
const { createScheduler, MIN_INTERVAL_MS, DEFAULT_INTERVAL_MS } = await import('../push/scheduler.js');

let nextId = 0;
async function seedThread(updatedAt = '2026-07-30T00:00:00.000Z'): Promise<void> {
  const id = (nextId++).toString(16).padStart(12, '0');
  await getPool().query(
    `INSERT INTO threads (id, permalink, title, subreddit, upvotes, comment_count, age_minutes,
       body, collected_at, source, created_at, updated_at)
     VALUES ($1,$2,$3,'testsub',1,1,1,'b',$4,'read',$5,$6)`,
    [id, `/r/x/${id}`, 't', updatedAt, updatedAt, updatedAt]
  );
}

/** A fetch that answers 204 after `delayMs`, counting calls. */
function slowOk(delayMs: number) {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, delayMs));
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

before(() => { /* migrated at module scope */ });
after(async () => {
  try { await closePool(); } catch { /* ignore */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ }
});

describe('the overlap guard', () => {
  test('a trigger arriving during a push is dropped, not queued', async () => {
    await seedThread();
    const net = slowOk(150);
    const s = createScheduler({ fetchImpl: net.fetchImpl });

    const first = s.trigger('start');
    // Fire three more while the first is still in the air.
    const during = await Promise.all([s.trigger('timer'), s.trigger('run-end'), s.trigger('timer')]);
    const report = await first;

    assert.ok(report, 'the first push ran');
    assert.deepEqual(during, [null, null, null], 'every concurrent trigger returned null');
    assert.equal(s.dropped, 3, 'and was counted as dropped');
    assert.equal(s.busy, false, 'the guard clears when the push finishes');
    await s.stop();
  });

  test('after one finishes, the next trigger runs normally', async () => {
    await seedThread('2026-07-30T01:00:00.000Z');
    const net = slowOk(0);
    const s = createScheduler({ fetchImpl: net.fetchImpl });
    const a = await s.trigger('run-end');
    assert.ok(a, 'ran');
    const b = await s.trigger('timer');
    assert.ok(b, 'the guard did not latch');
    await s.stop();
  });
});

describe('when it does nothing', () => {
  test('no endpoint means no request and no noise', async () => {
    const saved = process.env.REDBOT_SYNC_URL;
    delete process.env.REDBOT_SYNC_URL;
    const net = slowOk(0);
    const lines: string[] = [];
    const s = createScheduler({ fetchImpl: net.fetchImpl, log: (l) => lines.push(l) });
    const r = await s.trigger('start');
    assert.equal(r, null);
    assert.equal(net.calls(), 0, 'an unconfigured install must not touch the network');
    assert.deepEqual(lines, [], 'and must not log — a dashboard nobody set up should be invisible');
    await s.stop();
    process.env.REDBOT_SYNC_URL = saved;
  });

  test('no token means no request', async () => {
    const saved = process.env.REDBOT_SYNC_PUSH_TOKEN;
    delete process.env.REDBOT_SYNC_PUSH_TOKEN;
    const net = slowOk(0);
    const s = createScheduler({ fetchImpl: net.fetchImpl });
    assert.equal(await s.trigger('start'), null);
    assert.equal(net.calls(), 0);
    await s.stop();
    process.env.REDBOT_SYNC_PUSH_TOKEN = saved;
  });

  test('configuration is re-read per trigger, so pasting a token starts it working', async () => {
    const saved = process.env.REDBOT_SYNC_URL;
    delete process.env.REDBOT_SYNC_URL;
    const net = slowOk(0);
    const s = createScheduler({ fetchImpl: net.fetchImpl });

    assert.equal(await s.trigger('timer'), null, 'off while unconfigured');
    process.env.REDBOT_SYNC_URL = saved;          // as if somebody used the Setup screen
    await seedThread('2026-07-30T02:00:00.000Z');
    assert.ok(await s.trigger('timer'), 'on again without a restart');
    await s.stop();
  });
});

describe('failure never escapes', () => {
  test('a network error is swallowed, and the trigger still resolves', async () => {
    await seedThread('2026-07-30T03:00:00.000Z');
    const dead = (async () => { throw new Error('ENOTFOUND push.invalid'); }) as unknown as typeof fetch;
    const lines: string[] = [];
    const s = createScheduler({ fetchImpl: dead, log: (l) => lines.push(l) });
    // The contract is that this RESOLVES. A rejection here would propagate into the run-completion
    // handler and the quit path, which is exactly what must not happen.
    const r = await s.trigger('run-end');
    assert.ok(r === null || r.sent === 0, 'nothing was sent');
    await s.stop();
  });

  test('a thrown error inside the push does not reject the trigger', async () => {
    const boom = (() => { throw new Error('synchronous explosion'); }) as unknown as typeof fetch;
    const lines: string[] = [];
    const s = createScheduler({ fetchImpl: boom, log: (l) => lines.push(l) });
    await assert.doesNotReject(() => s.trigger('quit'));
    await s.stop();
  });
});

describe('the heartbeat', () => {
  test('the interval has a floor, so a typo cannot hammer the service', () => {
    const s = createScheduler({ intervalMs: 1 });
    // 120 requests / 60 s is the documented rate limit; a 1 ms timer would exhaust it instantly.
    assert.ok(MIN_INTERVAL_MS >= 60_000);
    assert.ok(DEFAULT_INTERVAL_MS > MIN_INTERVAL_MS);
    void s.stop();
  });

  test('start is idempotent and stop is safe to call twice', async () => {
    const s = createScheduler({ fetchImpl: slowOk(0).fetchImpl });
    s.start(); s.start();
    await s.stop();
    await s.stop();
    assert.equal(s.busy, false);
  });

  test('stop waits for a push already in flight', async () => {
    await seedThread('2026-07-30T04:00:00.000Z');
    const s = createScheduler({ fetchImpl: slowOk(120).fetchImpl });
    void s.trigger('timer');
    assert.equal(s.busy, true, 'precondition: one is in the air');
    await s.stop();
    assert.equal(s.busy, false, 'stop did not return until it landed');
  });
});
