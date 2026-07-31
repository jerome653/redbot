/**
 * Account sync — the two-way half.
 *
 * TWO PROPERTIES CARRY THIS FILE, and both are safety rather than function:
 *
 *   1. NOTHING MACHINE-LOCAL LEAVES. `accounts` still carries `profile_dir` and `debug_port` as a
 *      legacy fallback, holding the SAME values as `account_machines` on a one-machine install —
 *      so `SELECT *` looks right and would ship a folder name and a TCP port to every other
 *      computer. Migration 0013 records what that costs: on the development machine port 9222 is
 *      held by Lenovo Vantage's Edge WebView, "which speaks the debugging protocol fluently and
 *      would be driven as though it were the account's own Chrome".
 *
 *   2. A PULL NEVER DESTROYS. An account absent from an incoming list is reported, never removed.
 *      `deleteConsoleAccount` already refuses an account with jobs or drafts unless a caller
 *      passes `confirm: true`, and a sync must not become the one path around that guard.
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

const dir = mkdtempSync(join(tmpdir(), 'redbot-acct-sync-'));
process.env.REDBOT_DATA = dir;
process.env.REDBOT_DB = join(dir, 'redbot.db');
process.env.REDBOT_INSTALL_ID = '99999999-8888-4777-8666-555555555555';
process.env.REDBOT_MACHINE = 'sync-test';
process.env.REDBOT_SYNC_URL = 'https://push.invalid';
process.env.REDBOT_SYNC_PUSH_TOKEN = 'ingest-token';

const migrated = spawnSync(process.execPath, [RUNNER, 'up'], { encoding: 'utf8' });
if (migrated.status !== 0) throw new Error(`migrate up failed:\n${migrated.stderr}`);

const { getPool, closePool } = await import('../db.js');
const {
  portableAccounts, listFingerprint, pushAccounts, pullAccounts, applyAccounts, PORTABLE_FIELDS
} = await import('../push/accounts.js');
const { PushClient } = await import('../push/client.js');
const { readPushState } = await import('../push/state.js');

function mock(handler: (req: { method: string; path: string; headers: any; body: any }) => {
  status: number; body?: any; headers?: Record<string, string>;
}) {
  const seen: any[] = [];
  const fetchImpl = (async (url: any, init: any = {}) => {
    const req = {
      method: init.method ?? 'GET',
      path: new URL(String(url)).pathname,
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(String(init.body)) : null
    };
    seen.push(req);
    const r = handler(req);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) }
    });
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

async function seedAccount(handle: string, over: Record<string, unknown> = {}): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO accounts (handle, role, speaks, knows, subreddits, timezone,
       quiet_start, quiet_end, daily_ceiling, profile_dir, debug_port, note, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [handle, over.role ?? 'support desk', over.speaks ?? 'things', '[]',
      over.subreddits ?? '["WordPress"]', 'Asia/Manila', 0, 8, over.daily_ceiling ?? 1,
      /* Machine-local, and present exactly as a real install has them. */
      over.profile_dir ?? 'chrome-profile-a', over.debug_port ?? 9223,
      over.note ?? 'seeded', '2026-07-01T00:00:00.000Z',
      over.updated_at ?? '2026-07-01T00:00:00.000Z']
  );
}

before(() => { /* migrated at module scope */ });
after(async () => {
  try { await closePool(); } catch { /* ignore */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ }
});

describe('the portable projection', () => {
  test('carries the description and nothing about where it runs', async () => {
    await seedAccount('Striking_Mousse6841');
    const list = await portableAccounts();
    assert.equal(list.length, 1);
    const a = list[0]!;

    assert.equal(a.handle, 'Striking_Mousse6841');
    assert.equal(a.role, 'support desk');
    assert.equal(a.timezone, 'Asia/Manila');

    /* The row HAS these columns and they are populated — the projection must still drop them. */
    for (const local of ['profile_dir', 'debug_port']) {
      assert.equal(local in a, false, `${local} must never be in the portable projection`);
    }
    assert.equal(PORTABLE_FIELDS.includes('profile_dir' as never), false);
    assert.equal(PORTABLE_FIELDS.includes('debug_port' as never), false);
  });

  test('the row really does hold the machine-local values being excluded', async () => {
    // Without this the test above could pass because the columns are empty rather than dropped.
    const r = await getPool().query<{ profile_dir: string; debug_port: number }>(
      'SELECT profile_dir, debug_port FROM accounts WHERE handle = $1', ['Striking_Mousse6841']
    );
    assert.equal(r.rows[0]!.profile_dir, 'chrome-profile-a');
    assert.equal(r.rows[0]!.debug_port, 9223);
  });

  test('JSON-in-TEXT fields reach the wire as STRINGS, not rehydrated values', async () => {
    /**
     * REGRESSION. `src/db.ts` rehydrates JSON-held-in-TEXT columns, so `subreddits` arrives from
     * the façade as the ARRAY `["WordPress"]`. The wire contract promises the string — the
     * receiving side's `activity.data` allow-list parses that field, so an object where a string
     * was promised breaks a path their suite already validated.
     *
     * Caught by a phantom `update` on every pull: `String(["WordPress"])` is `WordPress` while
     * `String('["WordPress"]')` is `["WordPress"]`, so an identical account compared unequal.
     */
    const viaFacade = await getPool().query<Record<string, unknown>>(
      'SELECT subreddits, knows FROM accounts WHERE handle = $1', ['Striking_Mousse6841']
    );
    assert.ok(Array.isArray(viaFacade.rows[0]!.subreddits),
      'precondition: the façade really does rehydrate this column');

    const [a] = await portableAccounts();
    assert.equal(typeof a!.subreddits, 'string', 'the wire form must be the JSON string');
    assert.equal(typeof a!.knows, 'string');
    assert.equal(a!.subreddits, '["WordPress"]');
    // And not double-encoded, which would be the obvious over-correction.
    assert.notEqual(a!.subreddits, '"[\\"WordPress\\"]"');
    assert.deepEqual(JSON.parse(String(a!.subreddits)), ['WordPress']);
  });

  test('the fingerprint moves when content changes, not only when the count does', async () => {
    const before = listFingerprint(await portableAccounts());
    await getPool().query(
      'UPDATE accounts SET role = $1, updated_at = $2 WHERE handle = $3',
      ['reviews', '2026-07-02T00:00:00.000Z', 'Striking_Mousse6841']
    );
    const after = listFingerprint(await portableAccounts());
    assert.notEqual(before, after, 'an edit with no new row must still count as a change');
  });
});

describe('pushing the list', () => {
  test('sends the whole list, and the envelope matches the contract', async () => {
    const m = mock(() => ({ status: 204 }));
    const client = new PushClient({ baseUrl: 'https://push.invalid', token: 'ingest-token', fetchImpl: m.fetchImpl });
    const r = await pushAccounts(client);

    assert.equal(r.sent, true);
    assert.equal(r.accounts, 1);
    const req = m.seen.at(-1)!;
    assert.equal(req.method, 'POST');
    assert.equal(req.path, '/v2/accounts');
    assert.equal(req.headers.authorization, 'Bearer ingest-token');
    assert.equal(req.body.v, 1);
    assert.equal(req.body.kind, 'accounts.list');
    assert.equal(req.body.installId, process.env.REDBOT_INSTALL_ID);
    assert.ok(Number.isInteger(req.body.listVersion) && req.body.listVersion >= 0);
    assert.equal(req.body.accounts.length, 1);
  });

  test('nothing machine-local reaches the wire', async () => {
    const m = mock(() => ({ status: 204 }));
    const client = new PushClient({ baseUrl: 'https://push.invalid', token: 't', fetchImpl: m.fetchImpl });
    await pushAccounts(client, { force: true });
    const body = JSON.stringify(m.seen.at(-1)!.body);
    for (const forbidden of ['profile_dir', 'debug_port', 'chrome-profile-a', '9223']) {
      assert.equal(body.includes(forbidden), false, `${forbidden} must not appear in the payload`);
    }
  });

  test('an unchanged list is not re-sent', async () => {
    const m = mock(() => ({ status: 204 }));
    const client = new PushClient({ baseUrl: 'https://push.invalid', token: 't', fetchImpl: m.fetchImpl });
    const r = await pushAccounts(client);
    assert.equal(r.sent, false);
    assert.match(r.skipped ?? '', /unchanged/);
    assert.equal(m.seen.length, 0, 'no request at all when nothing changed');
  });

  test('listVersion increases when the list changes, and never goes backwards', async () => {
    const v1 = readPushState().accountsListVersion ?? 0;
    await seedAccount('Quirky_Owl_8028', { profile_dir: 'chrome-profile-b', debug_port: 9224 });
    const m = mock(() => ({ status: 204 }));
    const client = new PushClient({ baseUrl: 'https://push.invalid', token: 't', fetchImpl: m.fetchImpl });
    const r = await pushAccounts(client);
    assert.equal(r.sent, true);
    assert.equal(r.accounts, 2);
    assert.ok(r.listVersion > v1, `${r.listVersion} must exceed ${v1}`);
  });

  test('a refused push does not advance the stored version', async () => {
    const before = readPushState().accountsListVersion;
    await seedAccount('Third_Account', { updated_at: '2026-07-09T00:00:00.000Z' });
    const m = mock(() => ({ status: 503 }));
    const client = new PushClient({ baseUrl: 'https://push.invalid', token: 't', fetchImpl: m.fetchImpl });
    const r = await pushAccounts(client);
    assert.equal(r.sent, false);
    assert.match(r.stopped ?? '', /503/);
    assert.equal(readPushState().accountsListVersion, before,
      'a rejected list must be re-sent next time, so the version must not move');
  });
});

describe('pulling the list', () => {
  const remote = (accounts: any[], listVersion = 7, etag = '"v7"') => mock((req) => {
    if (req.method === 'GET' && req.path === '/v2/accounts') {
      if (req.headers['if-none-match'] === etag) return { status: 304 };
      return {
        status: 200,
        headers: { etag },
        body: { v: 1, installId: 'x', kind: 'accounts.list', listVersion, accounts }
      };
    }
    return { status: 404 };
  });

  test('the share token is used, not the ingest token', async () => {
    const m = remote([]);
    const client = new PushClient({ baseUrl: 'https://push.invalid', token: 'share-token', fetchImpl: m.fetchImpl });
    await pullAccounts(client, {});
    assert.equal(m.seen.at(-1)!.headers.authorization, 'Bearer share-token');
  });

  test('plans creates, updates and no-ops against what is already here', async () => {
    const m = remote([
      { handle: 'Striking_Mousse6841', role: 'reviews', speaks: 'things', subreddits: '["WordPress"]', timezone: 'Asia/Manila', quiet_start: 0, quiet_end: 8, daily_ceiling: 1, note: 'seeded' },
      { handle: 'Quirky_Owl_8028', role: 'CHANGED', speaks: 'things', subreddits: '["WordPress"]', timezone: 'Asia/Manila', quiet_start: 0, quiet_end: 8, daily_ceiling: 1, note: 'seeded' },
      { handle: 'Brand_New_One', role: 'support desk', speaks: 'x', subreddits: '["WordPress"]', timezone: 'Asia/Manila', quiet_start: 0, quiet_end: 8, daily_ceiling: 1 }
    ]);
    const client = new PushClient({ baseUrl: 'https://push.invalid', token: 's', fetchImpl: m.fetchImpl });
    const r = await pullAccounts(client, {});

    const by = Object.fromEntries(r.plan.map((p) => [p.handle, p]));
    assert.equal(by['Striking_Mousse6841']!.action, 'unchanged');
    assert.equal(by['Quirky_Owl_8028']!.action, 'update');
    assert.deepEqual(by['Quirky_Owl_8028']!.changed, ['role']);
    assert.equal(by['Brand_New_One']!.action, 'create');
    assert.equal(r.listVersion, 7);
  });

  test('an account missing from the list is REPORTED, never removed', async () => {
    // 'Third_Account' exists locally and is absent from the incoming list.
    const m = remote([
      { handle: 'Striking_Mousse6841', role: 'reviews', speaks: 'things', subreddits: '["WordPress"]', timezone: 'Asia/Manila', quiet_start: 0, quiet_end: 8, daily_ceiling: 1, note: 'seeded' }
    ]);
    const client = new PushClient({ baseUrl: 'https://push.invalid', token: 's', fetchImpl: m.fetchImpl });
    const r = await pullAccounts(client, {});

    assert.ok(r.withdrawn.includes('Third_Account'), 'it must be named');
    assert.ok(r.withdrawn.includes('Quirky_Owl_8028'));
    assert.equal(r.plan.some((p) => p.handle === 'Third_Account'), false, 'and not planned for change');

    // The row is still there. This is the assertion that stops a sync deleting somebody's work.
    const still = await getPool().query('SELECT handle FROM accounts WHERE handle = $1', ['Third_Account']);
    assert.equal(still.rows.length, 1, 'a pull must never delete a local account');
  });

  test('a handle that differs only in CASE is never created twice', async () => {
    /**
     * REGRESSION, and the one that would have produced real damage. `accounts.handle` is
     * `TEXT PRIMARY KEY` with no `COLLATE NOCASE`, so SQLite compares it byte-for-byte: a remote
     * `striking_mousse6841` against a local `Striking_Mousse6841` looks ABSENT, gets planned as a
     * create, and the INSERT SUCCEEDS. Two rows, two Chrome profiles, two debug ports — one
     * Reddit account posting as itself twice. Reddit treats the spellings as one user.
     */
    const m = remote([
      { handle: 'striking_mousse6841', role: 'reviews', speaks: 'things',
        subreddits: '["WordPress"]', timezone: 'Asia/Manila',
        quiet_start: 0, quiet_end: 8, daily_ceiling: 1, note: 'seeded' }
    ]);
    const client = new PushClient({ baseUrl: 'https://push.invalid', token: 's', fetchImpl: m.fetchImpl });
    const r = await pullAccounts(client, {});

    const creates = r.plan.filter((p) => p.action === 'create');
    assert.deepEqual(creates, [], 'a case-variant handle must not be planned as a new account');
    const entry = r.plan.find((p) => p.handle.toLowerCase() === 'striking_mousse6841');
    assert.ok(entry, 'it is still planned');
    assert.equal(entry!.handle, 'Striking_Mousse6841',
      'and carries the LOCAL spelling, so an update hits the existing row');
    assert.equal(r.withdrawn.includes('Striking_Mousse6841'), false,
      'nor may it look withdrawn just because the case differs');
  });

  test('the same account listed twice is planned once', async () => {
    const m = remote([
      { handle: 'Dup_Account', role: 'a', speaks: 'x', subreddits: '[]', timezone: 'Asia/Manila', quiet_start: 0, quiet_end: 8, daily_ceiling: 1 },
      { handle: 'dup_account', role: 'b', speaks: 'y', subreddits: '[]', timezone: 'Asia/Manila', quiet_start: 0, quiet_end: 8, daily_ceiling: 1 }
    ]);
    const client = new PushClient({ baseUrl: 'https://push.invalid', token: 's', fetchImpl: m.fetchImpl });
    const r = await pullAccounts(client, {});
    const dup = r.plan.filter((p) => p.handle.toLowerCase() === 'dup_account');
    assert.equal(dup.length, 1, 'a list naming one account twice must not be applied twice');
  });

  test('an unchanged list costs a 304 and no plan', async () => {
    const m = remote([], 7, '"v7"');
    const client = new PushClient({ baseUrl: 'https://push.invalid', token: 's', fetchImpl: m.fetchImpl });
    const r = await pullAccounts(client, { etag: '"v7"' });
    assert.equal(r.notModified, true);
    assert.equal(r.plan.length, 0);
  });

  test('a failed read changes nothing and says why', async () => {
    const m = mock(() => ({ status: 401, body: { error: 'unauthorised' } }));
    const client = new PushClient({ baseUrl: 'https://push.invalid', token: 'wrong', fetchImpl: m.fetchImpl });
    const r = await pullAccounts(client, {});
    assert.equal(r.fetched, false);
    assert.match(r.stopped ?? '', /401/);
    assert.equal(r.plan.length, 0);
  });
});

describe('applying a pulled list', () => {
  test('creates the account locally and derives nothing from the sender', async () => {
    const incoming = [{
      handle: 'Applied_Acct', role: 'support desk', speaks: 'errors', knows: '[]',
      subreddits: '["WordPress"]', timezone: 'Asia/Manila',
      quiet_start: 1, quiet_end: 7, daily_ceiling: 3, note: 'from sync'
    }];
    const r = await applyAccounts(incoming, [{ handle: 'Applied_Acct', action: 'create' }]);
    assert.equal(r.errors.length, 0, r.errors.join('; '));
    assert.equal(r.applied, 1);

    const row = await getPool().query<Record<string, unknown>>(
      'SELECT * FROM accounts WHERE handle = $1', ['Applied_Acct']
    );
    assert.equal(row.rows.length, 1);
    const a = row.rows[0]!;
    assert.equal(a.role, 'support desk');
    assert.equal(a.timezone, 'Asia/Manila');
    assert.equal(Number(a.daily_ceiling), 3, 'the ceiling arrives, which create() alone does not set');
    assert.equal(Number(a.quiet_start), 1);
  });
});
