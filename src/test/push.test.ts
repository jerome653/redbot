/**
 * The push sender: cursors, batching, and every answer the service can give.
 *
 * A LOCAL MOCK, NOT THE REAL SERVICE — deliberately, and not only for speed. The deployed
 * service currently answers `503 not_configured` on both write paths because its secrets are
 * pending approval, so a `204` cannot be obtained from it at all. The mock implements the
 * contract from its handover document, which is what the sender must satisfy whenever those
 * secrets land.
 *
 * THE ASSERTION THAT MATTERS MOST is `a batch boundary inside a run of tied timestamps loses
 * nothing`. Measured on the reference database: `thread_prefilter` holds 87 rows sharing ONE
 * `updated_at`. A sender using `WHERE updated_at > :last` that stops mid-run resumes past the
 * whole timestamp and drops the rest — silently, with no gap in any id to notice later. That is
 * the defect this file exists to prevent from ever being introduced.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(ROOT, 'db', 'sqlite', 'migrate.mjs');

/* The database must exist before src/db.ts is first imported, so this runs at module scope. */
const dir = mkdtempSync(join(tmpdir(), 'redbot-push-'));
process.env.REDBOT_DATA = dir;
process.env.REDBOT_DB = join(dir, 'redbot.db');
process.env.REDBOT_INSTALL_ID = '11111111-2222-4333-8444-555555555555';
process.env.REDBOT_MACHINE = 'test-machine';
/* A host that cannot resolve, so a bug that bypasses the injected fetch fails loudly here rather
   than reaching a real service. Every test below supplies its own `fetchImpl`. */
process.env.REDBOT_SYNC_URL = 'https://push.invalid';
process.env.REDBOT_SYNC_PUSH_TOKEN = 'test-token';

const migrated = spawnSync(process.execPath, [RUNNER, 'up'], { encoding: 'utf8' });
if (migrated.status !== 0) {
  throw new Error(`migrate up failed:\n${migrated.stdout}\n${migrated.stderr}`);
}

const { getPool, closePool } = await import('../db.js');
const { pushOnce } = await import('../push/index.js');
const { readPushState, pushStatePath, installId } = await import('../push/state.js');
const { forbiddenKeysIn, forwardFrom, streamByName } = await import('../push/streams.js');
const { assertSendable } = await import('../push/build.js');

/** One recorded request, as the mock saw it. */
interface Seen { path: string; auth: string | null; body: any }

/** A stand-in for the service, answering by a script of statuses. */
function mockService(script: (n: number, body: any) => { status: number; headers?: Record<string, string> }) {
  const seen: Seen[] = [];
  let n = 0;
  const fetchImpl = (async (url: any, init: any) => {
    n += 1;
    const body = JSON.parse(String(init.body));
    seen.push({ path: new URL(String(url)).pathname, auth: init.headers?.authorization ?? null, body });
    const r = script(n, body);
    return new Response(r.status === 204 ? null : JSON.stringify({ statusCode: r.status }), {
      status: r.status, headers: r.headers ?? {}
    });
  }) as unknown as typeof fetch;
  return { seen, fetchImpl, count: () => n };
}

const ok = () => ({ status: 204 });

/**
 * Ids are 12 lowercase hex characters because the schema says so:
 * `CHECK (length(id) = 12 AND id NOT GLOB '*[^0-9a-f]*')`. Found by the constraint rejecting a
 * friendlier fixture id — which is the schema doing its job, so the fixture moved rather than the
 * check. A module-level counter keeps ids unique across calls.
 */
let nextThread = 0;

async function seedThreads(count: number, updatedAt: string): Promise<void> {
  const db = getPool();
  for (let i = 0; i < count; i++) {
    const id = (nextThread++).toString(16).padStart(12, '0');
    await db.query(
      `INSERT INTO threads (id, permalink, title, subreddit, author, upvotes, comment_count,
         age_minutes, body, collected_at, source, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'read',$11,$12)`,
      [id, `/r/x/${id}`, `title ${i}`, 'testsub', 'someone_else', i, i,
        i, 'the body text', updatedAt, updatedAt, updatedAt]
    );
  }
}

before(async () => { /* schema is migrated at module scope */ });

after(async () => {
  try { await closePool(); } catch { /* ignore */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ }
});

describe('identity', () => {
  test('installId is a UUID, and is not the machine id', () => {
    assert.match(installId(), /^[0-9a-f-]{36}$/);
    assert.notEqual(installId(), process.env.REDBOT_MACHINE);
  });

  test('a non-UUID REDBOT_INSTALL_ID is refused rather than silently accepted', async () => {
    const saved = process.env.REDBOT_INSTALL_ID;
    process.env.REDBOT_INSTALL_ID = 'not-a-uuid';
    assert.throws(() => installId(), /not a UUID/);
    process.env.REDBOT_INSTALL_ID = saved;
  });
});

describe('the forbidden-key guard', () => {
  test('finds a forbidden key at any depth, case-insensitively', () => {
    assert.deepEqual(forbiddenKeysIn({ a: 1 }), []);
    assert.deepEqual(forbiddenKeysIn({ profile_dir: 'x' }), ['profile_dir']);
    assert.deepEqual(forbiddenKeysIn({ a: { b: [{ DEBUG_PORT: 9222 }] } }), ['a.b[0].DEBUG_PORT']);
    assert.deepEqual(forbiddenKeysIn([{ data: { cookies: 'x' } }]), ['[0].data.cookies']);
  });

  test('an exact-name match only — session_id and selected_at are fine', () => {
    // The service matches the exact key, so near-misses must not be treated as violations or
    // legitimate columns would start failing batches.
    assert.deepEqual(forbiddenKeysIn({ session_id: 'x', selected_at: 'y' }), []);
    assert.deepEqual(forbiddenKeysIn({ session: 'x' }), ['session']);
  });

  test('assertSendable refuses rather than quietly stripping', () => {
    const env = {
      v: 1 as const, installId: 'i', stream: 'thread', sentAt: 'now',
      events: [{ op: 'upsert' as const, cursor: { id: 1 }, data: { profile_dir: 'chrome-profile-a' } }]
    };
    assert.throws(() => assertSendable(env), /forbidden key/);
  });
});

describe('the keyset cursor', () => {
  test('a two-column cursor compares the tiebreak, not just the timestamp', () => {
    const spec = streamByName('thread')!;
    const { sql } = forwardFrom(spec, { updated_at: 'T', id: 'x' }, 10);
    // Without the second clause a batch boundary inside a tied timestamp drops the remainder.
    assert.match(sql, /"updated_at" > \$1 OR \("updated_at" = \$2 AND "id" > \$3\)/);
    assert.match(sql, /ORDER BY "updated_at", "id"/);
  });

  test('a single-column cursor is a plain greater-than', () => {
    const { sql } = forwardFrom(streamByName('activity')!, { id: 5 }, 10);
    assert.match(sql, /WHERE "id" > \$1 ORDER BY "id"/);
  });
});

describe('sending', () => {
  test('a batch boundary inside a run of tied timestamps loses nothing', async () => {
    // 25 threads sharing ONE updated_at, pushed one at a time: 24 mid-tie resumes.
    await seedThreads(25, '2026-07-30T00:00:00.000Z');
    const m = mockService(ok);
    const r = await pushOnce({ only: ['thread'], batchSize: 1, fetchImpl: m.fetchImpl });

    assert.equal(r.fatal, undefined, r.fatal);
    assert.equal(r.sent, 25, 'every tied row must be sent exactly once');
    assert.equal(m.count(), 25);

    const ids = m.seen.flatMap((s) => s.body.events.map((e: any) => e.data.id));
    assert.equal(new Set(ids).size, 25, 'no row sent twice');
    assert.deepEqual(ids, [...ids].sort(), 'sent in cursor order');
  });

  test('the envelope matches the contract', async () => {
    const m = mockService(ok);
    // Cursor is already at the end from the previous test, so add one more row.
    await seedThreads(1, '2026-07-30T00:00:01.000Z');
    await pushOnce({ only: ['thread'], batchSize: 10, fetchImpl: m.fetchImpl });

    const req = m.seen.at(-1)!;
    assert.equal(req.path, '/v2/events/thread');
    assert.equal(req.auth, 'Bearer test-token', 'the token travels in a header, never a query');
    assert.equal(req.body.v, 1);
    assert.equal(req.body.installId, process.env.REDBOT_INSTALL_ID);
    assert.equal(req.body.machine, 'test-machine');
    assert.equal(req.body.stream, 'thread');
    assert.match(req.body.sentAt, /^\d{4}-\d\d-\d\dT/);
    assert.ok(Array.isArray(req.body.events) && req.body.events.length > 0);

    const ev = req.body.events[0];
    assert.equal(ev.op, 'upsert');
    assert.deepEqual(Object.keys(ev.cursor).sort(), ['id', 'updated_at']);
    // The allow-list is the privacy boundary: none of these may appear.
    for (const gone of ['permalink', 'title', 'body', 'author', 'age_text']) {
      assert.equal(gone in ev.data, false, `${gone} must never be sent`);
    }
    assert.equal(ev.data.subreddit, 'testsub');
  });

  test('the cursor is written to disk, so a second run sends nothing', async () => {
    const m = mockService(ok);
    const r = await pushOnce({ only: ['thread'], batchSize: 50, fetchImpl: m.fetchImpl });
    assert.equal(r.sent, 0, 'everything was already acknowledged');
    assert.equal(m.count(), 0, 'no request is made when there is nothing to send');
    assert.equal(existsSync(pushStatePath()), true);
    const state = JSON.parse(readFileSync(pushStatePath(), 'utf8'));
    assert.ok(state.cursors.thread.updated_at, 'the watermark names where it got to');
  });
});

describe('what the service can answer', () => {
  test('503 not_configured keeps the cursor — the current live behaviour', async () => {
    await seedThreads(3, '2026-07-30T10:00:00.000Z');
    const before = readPushState().cursors.thread;
    const m = mockService(() => ({ status: 503 }));
    const r = await pushOnce({ only: ['thread'], batchSize: 10, fetchImpl: m.fetchImpl });

    assert.equal(r.sent, 0);
    assert.deepEqual(readPushState().cursors.thread, before,
      'a 503 must not advance the cursor, or those events are lost forever');
    assert.match(r.streams[0]!.stopped ?? '', /503/);
  });

  test('a 5xx also keeps the cursor', async () => {
    const before = readPushState().cursors.thread;
    const m = mockService(() => ({ status: 500 }));
    await pushOnce({ only: ['thread'], batchSize: 10, fetchImpl: m.fetchImpl });
    assert.deepEqual(readPushState().cursors.thread, before);
  });

  test('401 stops the whole run, not just one stream', async () => {
    const m = mockService(() => ({ status: 401 }));
    const r = await pushOnce({ batchSize: 10, fetchImpl: m.fetchImpl });
    assert.match(r.fatal ?? '', /401/);
    assert.equal(m.count(), 1, 'it must not try every stream with a token it knows is bad');
  });

  test('400 stops its own stream and leaves the cursor alone', async () => {
    const before = readPushState().cursors.thread;
    const m = mockService(() => ({ status: 400 }));
    const r = await pushOnce({ only: ['thread'], batchSize: 10, fetchImpl: m.fetchImpl });
    assert.equal(r.fatal, undefined, 'a malformed batch is not a reason to stop everything');
    assert.deepEqual(readPushState().cursors.thread, before);
  });

  test('429 keeps the cursor and reports the wait', async () => {
    const before = readPushState().cursors.thread;
    const m = mockService(() => ({ status: 429, headers: { 'retry-after': '32' } }));
    const r = await pushOnce({ only: ['thread'], batchSize: 10, fetchImpl: m.fetchImpl });
    assert.equal(r.sent, 0);
    assert.deepEqual(readPushState().cursors.thread, before);
    assert.match(r.streams[0]!.stopped ?? '', /429/);
  });

  test('413 halves the batch instead of giving up', async () => {
    // Refuse anything over two events, accept the rest: the sender must find the size itself.
    const m = mockService((_n, body) => (body.events.length > 2 ? { status: 413 } : { status: 204 }));
    const r = await pushOnce({ only: ['thread'], batchSize: 8, fetchImpl: m.fetchImpl });
    assert.equal(r.sent, 3, 'the three pending rows arrive despite the first refusal');
    assert.ok(m.count() > 1, 'it retried with a smaller batch');
    assert.ok(m.seen.every((s) => s.body.events.length <= 8));
  });
});

describe('configuration', () => {
  test('with no REDBOT_SYNC_URL the run refuses instead of guessing an endpoint', async () => {
    const saved = process.env.REDBOT_SYNC_URL;
    delete process.env.REDBOT_SYNC_URL;
    const r = await pushOnce({ only: ['thread'], batchSize: 5 });
    assert.match(r.fatal ?? '', /REDBOT_SYNC_URL is not set/);
    process.env.REDBOT_SYNC_URL = saved;
  });

  test('a dry run transmits nothing and advances nothing', async () => {
    await seedThreads(2, '2026-07-30T20:00:00.000Z');
    const before = JSON.stringify(readPushState());
    const m = mockService(ok);
    const r = await pushOnce({ only: ['thread'], dryRun: true, batchSize: 5, fetchImpl: m.fetchImpl });
    assert.ok(r.sent > 0, 'it still reports what WOULD be sent');
    assert.equal(m.count(), 0, 'nothing was transmitted');
    assert.equal(JSON.stringify(readPushState()), before, 'no watermark moved');
  });
});
