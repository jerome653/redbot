/**
 * The relay manager — the module `launchChrome` asks "may this browser open, and through what?"
 *
 * ---------------------------------------------------------------------------
 * WHAT IS WORTH PINNING HERE, AND WHY IT IS THE REFUSALS
 *
 * The happy path is one line of consequence (`--proxy-server=http://127.0.0.1:<port>`). Every
 * other outcome is a REFUSAL, and each refusal exists because the alternative is a browser that
 * opens, looks perfectly normal, and signs an account in from the operator's own address. Reddit
 * ties an account to the address it first appears from and there is no undo, so a refusal that
 * silently stopped refusing would not fail loudly — it would fail once, permanently, on an
 * account nobody can get back.
 *
 * So: a fake upstream, no provider account, and every branch asserted.
 *
 * The fake is a real `node:http` server speaking proxy, not a stub. That distinction is recorded
 * in PROXY-PLAN §1e as a defect that produced a FALSE PASS: a `net.createServer()` with
 * 'connect'/'request' handlers registered on it handles nothing, because those are http.Server
 * events — and the run still printed PASS off zero observations.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(ROOT, 'db', 'sqlite', 'migrate.mjs');

/* The database must exist before src/db.ts is first imported — it caches the connection and the
   derived schema map. Same bootstrap as db-facade.test.ts. */
const dir = mkdtempSync(join(tmpdir(), 'redbot-relay-'));
process.env.REDBOT_DB = join(dir, 'redbot.db');
process.env.REDBOT_DATA = dir;
process.env.REDBOT_VAULT_KEY = randomBytes(32).toString('base64');
const migrated = spawnSync(process.execPath, [RUNNER, 'up'], { encoding: 'utf8' });
if (migrated.status !== 0) throw new Error(`migrate up failed:\n${migrated.stdout}\n${migrated.stderr}`);

const { getPool, closePool } = await import('../db.js');
const { ensureRelay, relayFor, stopRelay, stopAllRelays } = await import('../proxy/manager.js');
const { saveVettedProxy, setRelayPort, loadAccountProxy, recentExitObservations } =
  await import('../db/proxies.js');
const { saveProxyCredential } = await import('../proxy/credential.js');
const { RELAY_PORT_FIRST, RELAY_PORT_LAST, firstFreePortInRange } = await import('../ports.js');

const MACHINE = 'test-machine';
const HANDLE = 'Striking_Mousse6841';
const PINNED = '198.51.100.20';

/* ------------------------------------------------------------------ *
 * A fake provider. Answers any plain proxied GET with whatever address
 * it is currently pretending to be, and demands a credential first.
 * ------------------------------------------------------------------ */
interface Fake {
  server: Server;
  port: number;
  authSeen: string[];
  exitIp: string;
  close(): Promise<void>;
}

async function startFake(): Promise<Fake> {
  const state = { authSeen: [] as string[], exitIp: PINNED };
  const server = createServer();
  server.on('request', (req, res) => {
    const auth = req.headers['proxy-authorization'];
    if (typeof auth === 'string') state.authSeen.push(auth);
    if (!auth) { res.writeHead(407, { 'content-type': 'text/plain' }); res.end('no credential'); return; }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(state.exitIp);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  return {
    server,
    port: typeof addr === 'object' && addr ? addr.port : 0,
    get authSeen() { return state.authSeen; },
    get exitIp() { return state.exitIp; },
    set exitIp(v: string) { state.exitIp = v; },
    close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); })
  };
}

let fake: Fake;

/**
 * Narrow to the one outcome that lets a browser open, or fail the test with the actual reason.
 *
 * `assert.equal(r.ok, true)` reads better and is worse: it is not an assertion signature, so
 * every later line still has to cope with the failure shapes, and the message it prints on a
 * refusal is "false !== true" rather than the sentence the refusal wrote.
 */
function live(r: Awaited<ReturnType<typeof ensureRelay>>): { relayPort: number; exitIp: string } {
  if (!r.proxied) throw new Error('the account came back unproxied');
  if (!r.ok) throw new Error(r.error);
  return { relayPort: r.relayPort, exitIp: r.exitIp };
}

before(async () => {
  fake = await startFake();
  await getPool().query('INSERT INTO accounts (handle, knows, subreddits) VALUES ($1,$2,$3)',
    [HANDLE, JSON.stringify([]), JSON.stringify(['WordPress'])]);
});

after(async () => {
  await stopAllRelays();
  await fake.close();
  await closePool();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds the file briefly */ }
});

/** Put the account into the fully-bound state, the way a passing `proxy vet` leaves it. */
async function bindAccount(pin = PINNED): Promise<void> {
  await saveVettedProxy(getPool(), HANDLE, {
    host: '127.0.0.1', port: fake.port, label: 'fake ISP · test',
    pinnedExitIp: pin, country: 'US', region: 'New York', asn: 'AS64500 Example', rdns: null
  });
  await saveProxyCredential(HANDLE, { username: 'acct-user', password: 'p@ss:word/with:colons' });
}

/* ------------------------------------------------------------------ *
 * Not proxied — the state every account is in today
 * ------------------------------------------------------------------ */

test('an account with no exit configured is not proxied, and no relay is started', async () => {
  const r = await ensureRelay(getPool(), HANDLE, { machine: MACHINE });
  assert.equal(r.proxied, false);
  assert.equal(relayFor(HANDLE), null);
});

test('an exit that is switched off is not proxied either', async () => {
  await bindAccount();
  await getPool().query('UPDATE account_proxies SET enabled = 0 WHERE handle = $1', [HANDLE]);
  const r = await ensureRelay(getPool(), HANDLE, { machine: MACHINE });
  assert.equal(r.proxied, false);
  assert.equal(relayFor(HANDLE), null);
  await getPool().query('UPDATE account_proxies SET enabled = 1 WHERE handle = $1', [HANDLE]);
});

/* ------------------------------------------------------------------ *
 * The refusals
 * ------------------------------------------------------------------ */

test('an exit that has never been vetted is refused, and says which command fixes it', async () => {
  await bindAccount();
  await getPool().query('UPDATE account_proxies SET pinned_exit_ip = NULL WHERE handle = $1', [HANDLE]);
  const r = await ensureRelay(getPool(), HANDLE, { machine: MACHINE });
  assert.equal(r.proxied, true);
  assert.equal(r.ok, false);
  assert.match(r.error, /never been checked/i);
  assert.match(r.error, /proxy vet/);
  assert.equal(relayFor(HANDLE), null);
});

test('a vetted exit with no stored credential is refused rather than forwarded blank', async () => {
  await bindAccount();
  await getPool().query('DELETE FROM credentials WHERE name = $1', ['proxy_auth']);
  const r = await ensureRelay(getPool(), HANDLE, { machine: MACHINE });
  assert.equal(r.proxied, true);
  assert.equal(r.ok, false);
  assert.match(r.error, /no proxy credential/i);
  assert.equal(relayFor(HANDLE), null);
});

test('an unreachable exit is refused, and the relay it started is not left behind', async () => {
  await bindAccount();
  /* A port nothing is listening on. The relay itself starts fine — it is the check THROUGH it
     that fails, which is the case worth pinning: a listening relay is not a working exit. */
  await getPool().query('UPDATE account_proxies SET proxy_port = 1 WHERE handle = $1', [HANDLE]);
  const r = await ensureRelay(getPool(), HANDLE, { machine: MACHINE, timeoutMs: 2000 });
  assert.equal(r.proxied, true);
  assert.equal(r.ok, false);
  assert.match(r.error, /could not be reached/i);
  assert.equal(relayFor(HANDLE), null, 'a relay started for a failed check must be closed again');
});

/* ------------------------------------------------------------------ *
 * The one that works
 * ------------------------------------------------------------------ */

test('a healthy vetted exit starts a relay, presents the credential, and reports the exit IP', async () => {
  await bindAccount();
  fake.exitIp = PINNED;
  const before = fake.authSeen.length;

  const r = live(await ensureRelay(getPool(), HANDLE, { machine: MACHINE }));
  assert.equal(r.exitIp, PINNED);
  assert.ok(r.relayPort >= RELAY_PORT_FIRST && r.relayPort <= RELAY_PORT_LAST,
    `relay port ${r.relayPort} is outside ${RELAY_PORT_FIRST}-${RELAY_PORT_LAST}`);

  /* The load-bearing assertion of the whole feature: the provider was shown a credential the
     browser never held. A password with colons in it survives, because the vault stores JSON
     rather than "user:pass". */
  const seen = fake.authSeen.slice(before);
  assert.ok(seen.length > 0, 'the upstream saw no request at all');
  const decoded = Buffer.from((seen[0] ?? '').replace(/^Basic /, ''), 'base64').toString('utf8');
  assert.equal(decoded, 'acct-user:p@ss:word/with:colons');

  const state = relayFor(HANDLE);
  assert.ok(state, 'the relay should still be up after a passing check');
  assert.equal(state.port, r.relayPort);
  assert.equal(state.exitIp, PINNED);
  assert.equal(state.matchedPin, true);
});

test('the allocated relay port is written to this machine, and reused next time', async () => {
  const first = relayFor(HANDLE);
  assert.ok(first);

  const row = await loadAccountProxy(getPool(), HANDLE, MACHINE);
  assert.equal(row?.relayPort, first.port, 'the port must survive a restart, so it is on the row');

  const again = live(await ensureRelay(getPool(), HANDLE, { machine: MACHINE }));
  assert.equal(again.relayPort, first.port, 'a second launch must not move the relay');
});

test('every check appends to the exit ledger, matched or not', async () => {
  const seen = await recentExitObservations(getPool(), HANDLE, 20);
  const launches = seen.filter((o) => o.via === 'launch');
  assert.ok(launches.length >= 2, `expected the launch checks to be recorded, saw ${launches.length}`);
  assert.equal(launches[0]?.exitIp, PINNED);
  assert.equal(launches[0]?.matchedPin, true);
});

/* ------------------------------------------------------------------ *
 * Drift — the event the whole ledger exists for
 * ------------------------------------------------------------------ */

test('an exit answering from a different address refuses the launch and names both', async () => {
  await stopRelay(HANDLE);
  await bindAccount();
  fake.exitIp = '203.0.113.99';

  const r = await ensureRelay(getPool(), HANDLE, { machine: MACHINE });
  assert.equal(r.proxied, true);
  assert.equal(r.ok, false);
  assert.match(r.error, /198\.51\.100\.20/);
  assert.match(r.error, /203\.0\.113\.99/);
  assert.equal(relayFor(HANDLE), null, 'a drifted exit must not be left carrying traffic');

  const seen = await recentExitObservations(getPool(), HANDLE, 5);
  assert.equal(seen[0]?.exitIp, '203.0.113.99');
  assert.equal(seen[0]?.matchedPin, false, 'the mismatch is recorded as a mismatch, not dropped');

  fake.exitIp = PINNED;
});

/* ------------------------------------------------------------------ *
 * Allocation
 * ------------------------------------------------------------------ */

test('a recorded port another program has taken is replaced rather than failed on', async () => {
  await stopRelay(HANDLE);
  await bindAccount();

  /* Squat on the recorded port with something that is not us — the Lenovo Vantage case from
     src/ports.ts, one band up. */
  const squatter = createServer();
  /* Squat a port that is ACTUALLY FREE, rather than assuming the first one is.
     This suite hard-coded RELAY_PORT_FIRST and, on 2026-08-14, died in its own setup with
     EADDRINUSE because an unrelated project's preview server held 9400 — taking the next test
     down with it. The one test whose whole subject is "somebody else has this port" must not be
     the test that cannot cope with somebody else having that port. */
  const held = await firstFreePortInRange([], RELAY_PORT_FIRST, RELAY_PORT_LAST, 'relay port');
  await setRelayPort(getPool(), HANDLE, held, MACHINE);
  await new Promise<void>((r) => squatter.listen(held, '127.0.0.1', () => r()));

  try {
    const r = live(await ensureRelay(getPool(), HANDLE, { machine: MACHINE }));
    assert.notEqual(r.relayPort, held, 'it must not try to bind a port somebody else holds');
    const row = await loadAccountProxy(getPool(), HANDLE, MACHINE);
    assert.equal(row?.relayPort, r.relayPort, 'the new port is recorded');
  } finally {
    await new Promise<void>((r) => squatter.close(() => r()));
  }
});

test('stopping the relay takes the listener down', async () => {
  assert.ok(relayFor(HANDLE));
  assert.equal(await stopRelay(HANDLE), true);
  assert.equal(relayFor(HANDLE), null);
  assert.equal(await stopRelay(HANDLE), false, 'stopping twice is not an error');
});
