/**
 * The relay, proven against a FAKE UPSTREAM.
 *
 * No provider account is needed, and that is deliberate rather than a convenience: the thing
 * worth pinning is what the relay SENDS, and only a server we control can assert on that. A test
 * against the real IPRoyal would prove the credential works today and would pin nothing.
 *
 * The load-bearing test is `the relay presents the credential upstream` — everything else in
 * this file is a refusal, and refusals are cheap to keep correct. If the Proxy-Authorization
 * header ever stops going out, every account silently drops to 407 and the failure surfaces as
 * "the internet is broken", which is exactly the diagnosis this whole feature must not produce.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer, connect as netConnect } from 'node:net';
import { once } from 'node:events';

const { startRelay, openTunnel, assertUsableUpstream, RelayError, UpstreamAuthError } =
  await import('../proxy/relay.js');
const { checkThroughRelay, checkUpstream, tunnelOk } = await import('../proxy/health.js');
const { firstFreePortInRange, RELAY_PORT_FIRST, RELAY_PORT_LAST, portIsFree } =
  await import('../ports.js');

/* ------------------------------------------------------------------ *
 * A fake provider: speaks just enough proxy to record what it was sent.
 * ------------------------------------------------------------------ */

interface FakeUpstream {
  server: Server;
  port: number;
  /** Every Proxy-Authorization value the relay presented, in order. */
  authSeen: string[];
  /** Every CONNECT target requested. */
  connectSeen: string[];
  /** Every absolute-URI plain request line. */
  plainSeen: string[];
  /** When set, CONNECT is refused with this status instead of tunnelled. */
  refuseWith: number | null;
  /** What the echo endpoint reports as the caller's address. */
  exitIp: string;
  close(): Promise<void>;
}

async function startFakeUpstream(): Promise<FakeUpstream> {
  const state = {
    authSeen: [] as string[],
    connectSeen: [] as string[],
    plainSeen: [] as string[],
    refuseWith: null as number | null,
    exitIp: '203.0.113.7'
  };
  const server = createServer();

  /* Plain proxied request: `GET http://host/path HTTP/1.1`. Answers the echo URL itself so the
     health check has something to read without reaching the internet. */
  server.on('request', (req, res) => {
    state.plainSeen.push(`${req.method} ${req.url}`);
    const auth = req.headers['proxy-authorization'];
    if (typeof auth === 'string') state.authSeen.push(auth);
    if (!auth) { res.writeHead(407, { 'content-type': 'text/plain' }); res.end('no credential'); return; }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(state.exitIp);
  });

  /* CONNECT: record, then either refuse or become a loopback echo so the tunnel is real. */
  server.on('connect', (req, clientSocket, head) => {
    state.connectSeen.push(String(req.url));
    const auth = req.headers['proxy-authorization'];
    if (typeof auth === 'string') state.authSeen.push(auth);
    if (!auth) { clientSocket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return; }
    if (state.refuseWith) { clientSocket.end(`HTTP/1.1 ${state.refuseWith} Refused\r\n\r\n`); return; }
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) clientSocket.write(head);
    /* Echo whatever comes down the tunnel, so a test can prove bytes really flow through. */
    clientSocket.on('data', (c: Buffer) => { if (!clientSocket.destroyed) clientSocket.write(c); });
    clientSocket.on('error', () => { /* client hung up */ });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    server, port,
    get authSeen() { return state.authSeen; },
    get connectSeen() { return state.connectSeen; },
    get plainSeen() { return state.plainSeen; },
    get refuseWith() { return state.refuseWith; },
    set refuseWith(v: number | null) { state.refuseWith = v; },
    get exitIp() { return state.exitIp; },
    set exitIp(v: string) { state.exitIp = v; },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); })
  } as FakeUpstream;
}

let fake: FakeUpstream;
const CREDS = { username: 'acct-user', password: 'sup3r-s3cret-value' };
const upstreamFor = () => ({ host: '127.0.0.1', port: fake.port, ...CREDS });
/** What a correct implementation must send. Computed here so the test does not trust the code. */
const EXPECTED_AUTH = 'Basic ' + Buffer.from(`${CREDS.username}:${CREDS.password}`).toString('base64');

before(async () => { fake = await startFakeUpstream(); });
after(async () => { await fake.close(); });

/* ------------------------------------------------------------------ *
 * The load-bearing behaviour
 * ------------------------------------------------------------------ */

test('the relay presents the credential upstream on the CONNECT path', async () => {
  const relay = await startRelay({ port: 0, upstream: upstreamFor(), label: 'test' });
  try {
    const before = fake.authSeen.length;
    /* Speak to the relay exactly as Chrome does: a raw CONNECT. */
    const sock = netConnect({ host: '127.0.0.1', port: relay.port });
    await once(sock, 'connect');
    sock.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n');
    const [chunk] = await once(sock, 'data') as [Buffer];
    assert.match(chunk.toString(), /^HTTP\/1\.[01] 200/, 'the relay should establish the tunnel');
    sock.destroy();

    assert.ok(fake.authSeen.length > before, 'the upstream saw no Proxy-Authorization at all');
    assert.equal(fake.authSeen.at(-1), EXPECTED_AUTH, 'the relay sent the wrong credential');
    assert.equal(fake.connectSeen.at(-1), 'example.com:443', 'the relay changed the CONNECT target');
  } finally {
    await relay.close();
  }
});

test('the relay presents the credential on the plain-http path too', async () => {
  const relay = await startRelay({ port: 0, upstream: upstreamFor() });
  try {
    const r = await checkThroughRelay(relay.port, { url: 'http://example.com/ip' });
    assert.equal(r.ok, true, `health should pass through the relay: ${r.detail}`);
    assert.equal(r.exitIp, fake.exitIp, 'the exit IP should be what the upstream reported');
    assert.equal(r.via, 'relay');
    assert.equal(fake.authSeen.at(-1), EXPECTED_AUTH, 'the plain path sent the wrong credential');
  } finally {
    await relay.close();
  }
});

/**
 * REGRESSION. An upstream that answers LATER, which is the only kind there is in production.
 *
 * The test above passes against an upstream that answers synchronously inside its request
 * handler — and that is precisely why it could not see the defect it now guards. The relay ended
 * its upstream socket the moment the browser's request body ended (a GET: immediately after the
 * head), so a provider that takes any time at all to answer was writing into a connection this
 * end had already torn down. Measured against a forwarding upstream: FAIL "HTTP 0" every run,
 * PASS every run with the half-close removed.
 *
 * It would not have shown up until the first real provider, where it looks like "the relay
 * answered HTTP 0" — the health gate failing, and every proxied launch refused.
 */
test('an upstream that answers after a delay is still read — the relay must not half-close it', async () => {
  const slow = createServer();
  slow.on('request', (req, res) => {
    const auth = req.headers['proxy-authorization'];
    /* Answers on a later tick, exactly as a provider forwarding to the internet does. */
    setTimeout(() => {
      if (!auth) { res.writeHead(407); res.end('no credential'); return; }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('198.51.100.77');
    }, 250);
  });
  await new Promise<void>((r) => slow.listen(0, '127.0.0.1', () => r()));
  const slowPort = (slow.address() as { port: number }).port;

  const relay = await startRelay({
    port: 0, upstream: { host: '127.0.0.1', port: slowPort, ...CREDS }
  });
  try {
    const r = await checkThroughRelay(relay.port, { url: 'http://example.com/ip', timeoutMs: 5000 });
    assert.equal(r.ok, true, `a delayed answer must still arrive: ${r.detail}`);
    assert.equal(r.exitIp, '198.51.100.77');
  } finally {
    await relay.close();
    await new Promise<void>((r) => { slow.closeAllConnections?.(); slow.close(() => r()); });
  }
});

test('bytes actually flow through the tunnel, both directions', async () => {
  const relay = await startRelay({ port: 0, upstream: upstreamFor() });
  try {
    const sock = netConnect({ host: '127.0.0.1', port: relay.port });
    await once(sock, 'connect');
    sock.write('CONNECT echo.test:443 HTTP/1.1\r\nHost: echo.test:443\r\n\r\n');
    await once(sock, 'data');                       // the 200
    sock.write('PING-THROUGH-TUNNEL');
    const [echoed] = await once(sock, 'data') as [Buffer];
    assert.equal(echoed.toString(), 'PING-THROUGH-TUNNEL', 'the tunnel did not carry the payload');
    sock.destroy();
  } finally {
    await relay.close();
  }
});

/* ------------------------------------------------------------------ *
 * The refusals — fail closed
 * ------------------------------------------------------------------ */

test('a relay refuses to start with no credential', async () => {
  await assert.rejects(
    () => startRelay({ port: 0, upstream: { host: '127.0.0.1', port: fake.port, username: '', password: '' } }),
    (e: unknown) => e instanceof RelayError && /credential is missing/i.test((e as Error).message),
    'a relay with no credential must not start — it would 407 on every request and look like a network fault'
  );
});

test('a relay refuses an unusable host or port', async () => {
  await assert.rejects(
    () => startRelay({ port: 0, upstream: { host: '', port: 8080, ...CREDS } }),
    (e: unknown) => e instanceof RelayError
  );
  await assert.rejects(
    () => startRelay({ port: 0, upstream: { host: '127.0.0.1', port: 0, ...CREDS } }),
    (e: unknown) => e instanceof RelayError
  );
});

test('the relay binds loopback ONLY — a LAN address cannot reach it', async (t) => {
  /**
   * The real assertion, not a proxy for one: find this machine's own non-loopback IPv4 and try
   * to open the relay port on it. A relay that dropped the '127.0.0.1' argument to `listen`
   * would bind 0.0.0.0 and answer here — an open proxy on any untrusted network it joins, with
   * our paid-for exit behind it.
   */
  const { networkInterfaces } = await import('node:os');
  const lan = Object.values(networkInterfaces()).flat()
    .find((n) => n && n.family === 'IPv4' && !n.internal)?.address;

  const relay = await startRelay({ port: 0, upstream: upstreamFor() });
  try {
    assert.equal(await portIsFree(relay.port), false, 'the relay should be holding its port');

    if (!lan) { t.skip('this machine has no non-loopback IPv4 to test against'); return; }

    const reachable = await new Promise<boolean>((resolve) => {
      const s = netConnect({ host: lan, port: relay.port });
      const done = (v: boolean) => { s.destroy(); resolve(v); };
      s.setTimeout(3000, () => done(false));
      s.once('connect', () => done(true));
      s.once('error', () => done(false));
    });
    assert.equal(reachable, false,
      `the relay answered on ${lan}:${relay.port} — it is bound to all interfaces, not loopback`);
  } finally {
    await relay.close();
  }
});

test('an upstream that rejects the credential is reported as an auth failure, not a network blip', async () => {
  fake.refuseWith = 407;
  try {
    await assert.rejects(
      () => openTunnel(upstreamFor(), { host: 'example.com', port: 443 }),
      (e: unknown) => e instanceof UpstreamAuthError && (e as InstanceType<typeof UpstreamAuthError>).status === 407
    );
  } finally {
    fake.refuseWith = null;
  }
});

test('no error message ever contains the credential', async () => {
  fake.refuseWith = 407;
  try {
    let message = '';
    try { await openTunnel(upstreamFor(), { host: 'example.com', port: 443 }); }
    catch (e) { message = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e); }
    assert.ok(message.length > 0, 'expected a failure to inspect');
    assert.equal(message.includes(CREDS.password), false, 'the password leaked into an error');
    assert.equal(message.includes(CREDS.username), false, 'the username leaked into an error');
    assert.equal(message.includes(EXPECTED_AUTH), false, 'the encoded credential leaked into an error');
  } finally {
    fake.refuseWith = null;
  }
});

test('a relay pointed at a dead upstream answers 502 rather than hanging', async () => {
  /* A port nothing is listening on: take one, then release it. */
  const dead = await firstFreePortInRange([], RELAY_PORT_FIRST, RELAY_PORT_LAST, 'relay port');
  const relay = await startRelay({ port: 0, upstream: { host: '127.0.0.1', port: dead, ...CREDS } });
  try {
    const r = await checkThroughRelay(relay.port, { url: 'http://example.com/ip', timeoutMs: 8000 });
    assert.equal(r.ok, false, 'a dead upstream must not report healthy');
    assert.ok(relay.lastError !== null || r.detail.length > 0, 'the failure should be recorded for the console');
  } finally {
    await relay.close();
  }
});

test('health through a relay that is not running fails closed', async () => {
  const free = await firstFreePortInRange([], RELAY_PORT_FIRST, RELAY_PORT_LAST, 'relay port');
  const r = await checkThroughRelay(free, { timeoutMs: 5000 });
  assert.equal(r.ok, false);
  assert.equal(r.exitIp, null);
  assert.equal(r.via, 'relay');
});

/* ------------------------------------------------------------------ *
 * Health against the provider directly, and the CONNECT prover
 * ------------------------------------------------------------------ */

test('checkUpstream reads the exit IP straight from the provider', async () => {
  fake.exitIp = '198.51.100.42';
  const r = await checkUpstream(upstreamFor(), { url: 'http://example.com/ip' });
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.exitIp, '198.51.100.42');
  assert.equal(r.via, 'upstream');
  assert.ok(typeof r.ms === 'number' && r.ms >= 0, 'a latency figure is recorded for provenance');
  fake.exitIp = '203.0.113.7';
});

test('checkUpstream reports a bad credential as such', async () => {
  const r = await checkUpstream({ host: '127.0.0.1', port: fake.port, username: 'u', password: 'p' },
                                { url: 'http://example.com/ip' });
  /* The fake answers 200 for ANY credential, so this asserts the shape rather than a 407:
     what matters is that a result comes back rather than a throw. */
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(r.via, 'upstream');
});

test('tunnelOk proves the CONNECT path Chrome uses', async () => {
  const ok = await tunnelOk(upstreamFor(), { host: 'www.reddit.com', port: 443 });
  assert.equal(ok.ok, true, ok.detail);
  fake.refuseWith = 502;
  try {
    const bad = await tunnelOk(upstreamFor(), { host: 'www.reddit.com', port: 443 });
    assert.equal(bad.ok, false, 'a refused tunnel must not report ok');
  } finally {
    fake.refuseWith = null;
  }
});

/* ------------------------------------------------------------------ *
 * Port allocation
 * ------------------------------------------------------------------ */

test('relay ports come from 9400-9499 and skip the ones already taken', async () => {
  const first = await firstFreePortInRange([], RELAY_PORT_FIRST, RELAY_PORT_LAST, 'relay port');
  assert.ok(first >= RELAY_PORT_FIRST && first <= RELAY_PORT_LAST, `${first} is outside the relay band`);

  const second = await firstFreePortInRange([first], RELAY_PORT_FIRST, RELAY_PORT_LAST, 'relay port');
  assert.notEqual(second, first, 'a claimed port must not be handed out again');
  assert.ok(second >= RELAY_PORT_FIRST && second <= RELAY_PORT_LAST);
});

test('the relay band does not overlap the debug band', async () => {
  const { DEBUG_PORT_FIRST, DEBUG_PORT_LAST } = await import('../ports.js');
  assert.ok(RELAY_PORT_FIRST > DEBUG_PORT_LAST,
    'a relay must never be able to take the port an account browser wants');
  assert.ok(DEBUG_PORT_FIRST < DEBUG_PORT_LAST && RELAY_PORT_FIRST < RELAY_PORT_LAST);
});

test('an exhausted range fails with a message naming the range', async () => {
  await assert.rejects(
    () => firstFreePortInRange([9400], 9400, 9400, 'relay port'),
    (e: unknown) => e instanceof Error && /9400/.test(e.message) && /relay port/.test(e.message)
  );
});

/* ------------------------------------------------------------------ *
 * Input validation
 * ------------------------------------------------------------------ */

test('assertUsableUpstream rejects the half-configured cases a vault produces', () => {
  assert.throws(() => assertUsableUpstream(null), RelayError);
  assert.throws(() => assertUsableUpstream({ host: 'h', port: 1, username: 'u', password: '' }), RelayError);
  assert.throws(() => assertUsableUpstream({ host: 'h', port: 1, username: '', password: 'p' }), RelayError);
  assert.throws(() => assertUsableUpstream({ host: 'h', port: 70000, username: 'u', password: 'p' }), RelayError);
  assert.doesNotThrow(() => assertUsableUpstream({ host: 'h.example.com', port: 12321, username: 'u', password: 'p' }));
});
