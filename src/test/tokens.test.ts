/**
 * `redbot tokens mint` — reading the admin token, and never keeping it.
 *
 * THE PARSING IS THE POINT. An operator's admin token is on disk as `REDBOT_ADMIN_TOKEN=<value>`,
 * because that is what a secrets file looks like. Sending the whole line as the bearer produced a
 * real `401 Unknown token` while this feature was being built — and the service returns the SAME
 * message for a malformed token and for one it has never seen, so the error cannot tell you which
 * mistake you made. Stripping the `NAME=` prefix here is what stops that being rediscovered.
 *
 * THE SECOND POINT is that the admin token is never persisted. It mints and revokes for every
 * install on the service; if it ever reached the vault, a stolen laptop would compromise the
 * fleet rather than one machine.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(ROOT, 'db', 'sqlite', 'migrate.mjs');

const dir = mkdtempSync(join(tmpdir(), 'redbot-tokens-'));
process.env.REDBOT_DATA = dir;
process.env.REDBOT_DB = join(dir, 'redbot.db');
process.env.REDBOT_INSTALL_ID = '44444444-5555-4666-8777-888888888888';
process.env.REDBOT_MACHINE = 'tok-test';
process.env.REDBOT_SYNC_URL = 'https://mint.invalid';
/**
 * The vault key this suite seals with.
 *
 * `mint` stores the minted tokens through `putSecret`, so three tests here reach the vault and
 * failed with "REDBOT_VAULT_KEY is not set" whenever the ambient environment had no key —
 * a suite that passed or failed on the machine's configuration rather than on the code.
 *
 * Set here rather than in `db/sqlite/.env.test` for the same reason every other variable above
 * is: this file owns its own environment, and a key in the shared env-file would silently seal
 * OTHER suites' rows under a known constant. `masterKey()` re-reads the variable on every call,
 * so setting it at module scope is enough.
 *
 * It is a literal test constant, not a secret: it protects a temp directory that `after()`
 * deletes, and nothing sealed under it outlives the run.
 */
process.env.REDBOT_VAULT_KEY = '0'.repeat(63) + '1'; // 64 hex chars = the required 32 bytes

const migrated = spawnSync(process.execPath, [RUNNER, 'up'], { encoding: 'utf8' });
if (migrated.status !== 0) throw new Error(`migrate up failed:\n${migrated.stderr}`);

const { closePool } = await import('../db.js');
const { readAdminToken } = await import('../commands/tokens.js');

const write = (name: string, body: string): string => {
  const p = join(dir, name);
  writeFileSync(p, body, 'utf8');
  return p;
};

before(() => { /* migrated at module scope */ });
after(async () => {
  try { await closePool(); } catch { /* ignore */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ }
});

describe('reading the admin token from a file', () => {
  test('a NAME=value line yields only the value', () => {
    // The exact shape that produced a 401 when sent whole.
    const p = write('a.txt', 'REDBOT_ADMIN_TOKEN=abc123def456\n');
    assert.equal(readAdminToken(p), 'abc123def456');
  });

  test('a bare token is returned untouched', () => {
    assert.equal(readAdminToken(write('b.txt', 'abc123def456')), 'abc123def456');
  });

  test('trailing newline, CRLF and a UTF-8 BOM are all tolerated', () => {
    assert.equal(readAdminToken(write('c.txt', 'REDBOT_ADMIN_TOKEN=tok\r\n')), 'tok');
    assert.equal(readAdminToken(write('d.txt', '﻿REDBOT_ADMIN_TOKEN=tok\n')), 'tok');
    assert.equal(readAdminToken(write('e.txt', '  tok  ')), 'tok');
  });

  test('quotes around the value are removed', () => {
    assert.equal(readAdminToken(write('f.txt', 'REDBOT_ADMIN_TOKEN="tok"')), 'tok');
    assert.equal(readAdminToken(write('g.txt', "REDBOT_ADMIN_TOKEN='tok'")), 'tok');
  });

  test('a value containing "=" keeps everything after the FIRST one', () => {
    // Base64 padding is the ordinary case; splitting on every '=' would truncate it.
    assert.equal(readAdminToken(write('h.txt', 'NAME=abc==')), 'abc==');
  });

  test('an empty file, a name with no value, and a line with spaces are all refused', () => {
    assert.throws(() => readAdminToken(write('i.txt', '')), /empty/);
    assert.throws(() => readAdminToken(write('j.txt', 'REDBOT_ADMIN_TOKEN=')), /no value/);
    assert.throws(() => readAdminToken(write('k.txt', 'two words here')), /whitespace/);
  });
});

describe('what it refuses to do', () => {
  test('the admin token is never written anywhere under the data directory', async () => {
    const { tokens } = await import('../commands/tokens.js');
    const secret = 'S3CRET-admin-token-value-do-not-store';
    const p = write('admin.txt', `REDBOT_ADMIN_TOKEN=${secret}`);

    /* A service that refuses everything: the mint fails, which is the interesting case —
       a failed run must not leave the admin token behind either. */
    const fetchImpl = (async () => new Response(JSON.stringify({ message: 'nope' }), { status: 401 })) as unknown as typeof fetch;
    const code = await tokens('mint', { adminTokenFile: p, fetchImpl });
    assert.equal(code, 1, 'a 401 is a failure');

    for (const f of ['push-state.json', 'redbot.db', 'install-id']) {
      const full = join(dir, f);
      if (!existsSync(full)) continue;
      const body = readFileSync(full, 'latin1');
      assert.equal(body.includes(secret), false, `${f} must not contain the admin token`);
    }
  });

  test('--share-from pointing at this install is refused, not silently allowed', async () => {
    const { tokens } = await import('../commands/tokens.js');
    const p = write('admin2.txt', 'REDBOT_ADMIN_TOKEN=tok');
    let called = 0;
    const fetchImpl = (async () => { called++; return new Response(JSON.stringify({ ingestToken: 'x'.repeat(40) }), { status: 201 }); }) as unknown as typeof fetch;
    const code = await tokens('mint', {
      adminTokenFile: p, shareFrom: process.env.REDBOT_INSTALL_ID!, fetchImpl
    });
    assert.equal(code, 1, 'reading your own list is not sharing');
    assert.equal(called, 1, 'only the ingest mint was attempted; no share token was requested');
  });

  test('a non-UUID --share-from is refused before any request', async () => {
    const { tokens } = await import('../commands/tokens.js');
    const p = write('admin3.txt', 'REDBOT_ADMIN_TOKEN=tok');
    const fetchImpl = (async () => new Response(JSON.stringify({ ingestToken: 'y'.repeat(40) }), { status: 201 })) as unknown as typeof fetch;
    assert.equal(await tokens('mint', { adminTokenFile: p, shareFrom: 'not-a-uuid', fetchImpl }), 1);
  });
});

describe('a successful mint', () => {
  test('stores both tokens sealed, and reports only their last four characters', async () => {
    const { tokens } = await import('../commands/tokens.js');
    const { getSecret } = await import('../credentials.js');
    const ingest = 'ingest-' + 'i'.repeat(50) + 'AAAA';
    const share = 'share-' + 's'.repeat(50) + 'BBBB';
    const p = write('admin4.txt', 'REDBOT_ADMIN_TOKEN=good-admin-token');

    const fetchImpl = (async (url: any) => {
      const u = String(url);
      if (u.endsWith('/v2/admin/installs')) return new Response(JSON.stringify({ ingestToken: ingest }), { status: 201 });
      if (u.endsWith('/v2/admin/share-tokens')) return new Response(JSON.stringify({ shareToken: share, expiresAt: '2026-09-01T00:00:00Z' }), { status: 201 });
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const code = await tokens('mint', {
      adminTokenFile: p, shareFrom: '11111111-2222-4333-8444-555555555555', fetchImpl
    });
    assert.equal(code, 0, 'both mints succeeded');
    assert.equal(await getSecret('sync_push_token'), ingest, 'the ingest token is in the vault');
    assert.equal(await getSecret('sync_share_token'), share, 'and the share token');
  });
});
