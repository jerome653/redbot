/**
 * The authenticating relay — the reason this feature needs code at all.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS, when a command-line flag looks like it would do
 *
 * Two simpler designs were tried first and both are dead:
 *
 *   1. IP-WHITELIST AUTH — let the provider authorise this machine's public IP, then
 *      `--proxy-server=http://host:port` needs no credentials and no code. MEASURED and rejected:
 *      this connection's public IP is DYNAMIC. Two clean runs minutes apart exited from
 *      126.209.19.165 and 180.191.139.234 — different /8. A whitelist entry would go stale with
 *      no warning and every account would fail to launch until somebody re-whitelisted by hand.
 *
 *   2. CREDENTIALS ON THE COMMAND LINE — `--proxy-server="http://user:pass@host"`. Chrome
 *      IGNORES the credentials (chromium-dev; crbug 40471183), and the historical workaround —
 *      a tiny extension supplying them via `chrome.webRequest.onAuthRequired` — is gone:
 *      `--load-extension` was removed from branded Chrome in 137 and this machine runs 150.
 *
 * So Chrome is pointed at `127.0.0.1:<relayPort>`, which speaks proxy to Chrome and adds the
 * credential on the way out. That is all this is: a credential injector on loopback.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE WILL NOT DO
 *
 * - It never binds anything but 127.0.0.1. A relay reachable from the LAN is an open proxy
 *   carrying someone else's traffic out through an IP we are paying to keep clean.
 * - It never starts without a credential. "Fail closed" is the whole posture: a relay that
 *   silently forwarded unauthenticated would get 407s from the provider and look like a network
 *   fault, which is the confusing failure this refuses in favour of a clear one.
 * - It never puts the credential in an error, a log line, or a thrown message. Every failure
 *   below names the PROBLEM, never the value — the same rule src/vault.ts keeps.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect as netConnect, type Socket } from 'node:net';
import { once } from 'node:events';

/** Where the relay dials, and what it presents when it gets there. */
export interface UpstreamProxy {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface RelayOptions {
  /** Loopback port to listen on. 0 asks the OS for a free one — used by the tests. */
  port: number;
  upstream: UpstreamProxy;
  /** Which account this relay serves. Used only in messages, never in a header. */
  label?: string;
}

export class RelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayError';
  }
}

/**
 * A CONNECT that the upstream refused. Its own type because the operator action differs per
 * cause and a generic "socket error" hides that: 407 means the credential is wrong (fix the
 * vault), anything else means the provider is unhappy with the request itself.
 */
export class UpstreamAuthError extends RelayError {
  constructor(public readonly status: number, public readonly upstreamHost: string) {
    super(
      status === 407
        ? `The proxy at ${upstreamHost} rejected the stored credential (HTTP 407). `
          + 'Re-add it with `redbot vault put proxy_auth --scope <handle>` — the username or '
          + 'password is wrong, or the subscription lapsed.'
        : `The proxy at ${upstreamHost} refused the tunnel with HTTP ${status}.`
    );
    this.name = 'UpstreamAuthError';
  }
}

export interface Relay {
  /** The port actually bound — resolved, so `port: 0` is usable. */
  readonly port: number;
  readonly label: string | null;
  /** Total CONNECT/forward attempts, so the console can show a relay that is doing nothing. */
  readonly requests: number;
  /** The most recent failure, for the Accounts card. Null when the last attempt was fine. */
  readonly lastError: string | null;
  close(): Promise<void>;
}

/** `Basic base64(user:pass)`. Built where it is used and never stored anywhere else. */
function authHeader(u: UpstreamProxy): string {
  return 'Basic ' + Buffer.from(`${u.username}:${u.password}`).toString('base64');
}

/**
 * Refuse an unusable upstream BEFORE a browser is pointed at it.
 *
 * An empty username or password is the case that matters: it is what a half-configured vault
 * produces, and forwarding it would earn a 407 on every request — a failure that looks like the
 * provider being down rather than like a setting nobody filled in.
 */
export function assertUsableUpstream(u: UpstreamProxy | null | undefined): asserts u is UpstreamProxy {
  if (!u) throw new RelayError('This account has no proxy configured, so no relay can be started.');
  if (!u.host || !/^[A-Za-z0-9._-]+$/.test(u.host)) {
    throw new RelayError('The proxy host is missing or is not a plain hostname or address.');
  }
  if (!Number.isInteger(u.port) || u.port < 1 || u.port > 65535) {
    throw new RelayError(`The proxy port must be between 1 and 65535 (got ${String(u.port)}).`);
  }
  if (!u.username || !u.password) {
    throw new RelayError(
      'The proxy credential is missing from the vault, so the relay will not start. '
      + 'Without it every request would be refused by the provider and look like a network fault. '
      + 'Add it with `redbot vault put proxy_auth --scope <handle>`.'
    );
  }
}

/**
 * Read an upstream's HTTP response head off a raw socket.
 *
 * Hand-rolled because at this point the socket is not an http client — we wrote a CONNECT by
 * hand and must read exactly the status line and headers, then hand the REMAINDER (which may
 * already contain TLS bytes) to the caller untouched. Losing those trailing bytes is the classic
 * way a hand-written tunnel corrupts the first TLS record.
 */
async function readHead(socket: Socket, timeoutMs: number): Promise<{ status: number; rest: Buffer }> {
  return new Promise<{ status: number; rest: Buffer }>((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      cleanup();
      reject(new RelayError('The proxy did not answer the tunnel request in time.'));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) {
        // A response head this large is not a proxy answering; stop rather than buffer forever.
        if (buf.length > 64 * 1024) { cleanup(); reject(new RelayError('The proxy sent an oversized response head.')); }
        return;
      }
      const head = buf.subarray(0, end).toString('latin1');
      const rest = buf.subarray(end + 4);
      const statusLine = head.split('\r\n')[0] ?? '';
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(statusLine);
      cleanup();
      if (!m || !m[1]) { reject(new RelayError('The proxy sent a response this build cannot parse.')); return; }
      resolve({ status: Number(m[1]), rest });
    };
    const onErr = (e: Error) => { cleanup(); reject(new RelayError(`The proxy connection failed: ${e.message}`)); };
    const onEnd = () => { cleanup(); reject(new RelayError('The proxy closed the connection before answering.')); };

    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData); socket.off('error', onErr); socket.off('end', onEnd);
    }
    socket.on('data', onData); socket.on('error', onErr); socket.on('end', onEnd);
  });
}

/**
 * Open an authenticated tunnel through the upstream to `target`.
 *
 * Exported because `health.ts` proves the tunnel with it, using exactly the code path Chrome
 * takes. A health check that used a different route would be checking something else.
 */
export async function openTunnel(
  upstream: UpstreamProxy,
  target: { host: string; port: number },
  timeoutMs = 20_000
): Promise<{ socket: Socket; rest: Buffer }> {
  assertUsableUpstream(upstream);
  const socket = netConnect({ host: upstream.host, port: upstream.port });
  socket.setTimeout(timeoutMs);

  try {
    await Promise.race([
      once(socket, 'connect'),
      once(socket, 'error').then(([e]) => { throw new RelayError(`Could not reach the proxy: ${(e as Error).message}`); })
    ]);
  } catch (e) {
    socket.destroy();
    throw e instanceof RelayError ? e : new RelayError(`Could not reach the proxy: ${String(e)}`);
  }

  const hostPort = `${target.host}:${target.port}`;
  socket.write(
    `CONNECT ${hostPort} HTTP/1.1\r\n`
    + `Host: ${hostPort}\r\n`
    + `Proxy-Authorization: ${authHeader(upstream)}\r\n`
    + 'Proxy-Connection: Keep-Alive\r\n\r\n'
  );

  let head: { status: number; rest: Buffer };
  try { head = await readHead(socket, timeoutMs); }
  catch (e) { socket.destroy(); throw e; }

  if (head.status !== 200) {
    socket.destroy();
    throw new UpstreamAuthError(head.status, upstream.host);
  }
  socket.setTimeout(0);
  return { socket, rest: head.rest };
}

/**
 * Start the relay.
 *
 * Binds 127.0.0.1 explicitly — `listen(port)` alone would bind every interface, which on a
 * laptop that joins untrusted networks is an open proxy with our paid-for exit behind it.
 */
export async function startRelay(opts: RelayOptions): Promise<Relay> {
  assertUsableUpstream(opts.upstream);
  const upstream = opts.upstream;

  let requests = 0;
  let lastError: string | null = null;
  const note = (e: unknown) => {
    lastError = e instanceof Error ? e.message : String(e);
  };

  /**
   * Every socket this relay owns, so `close()` can actually end them.
   *
   * MEASURED, and the reason this Set exists: a CONNECT socket is UPGRADED, which detaches it
   * from the http server's own connection tracking — so `server.closeAllConnections()` does not
   * touch it and `server.close()` waited **120 seconds** for a tunnel nobody was using. That is
   * the visible symptom. The real defect it exposed is worse: teardown was wired to 'error'
   * only, so a browser closing a tab normally left the socket to the PROVIDER open forever.
   * Over a session that is a connection leak against the paid exit, not just a slow shutdown.
   */
  const live = new Set<Socket>();
  const track = (s: Socket) => { live.add(s); s.once('close', () => live.delete(s)); };

  const server: Server = createServer();

  /* Chrome sends CONNECT for every https:// origin — this is the path that carries essentially
     all of Reddit. */
  server.on('connect', (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    requests++;
    const [rawHost, rawPort] = String(req.url ?? '').split(':');
    const host = rawHost ?? '';
    const port = Number(rawPort ?? 443);
    if (!host || !Number.isInteger(port)) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    clientSocket.on('error', () => { /* the browser went away; the teardown below handles it */ });
    track(clientSocket);

    openTunnel(upstream, { host, port })
      .then(({ socket: upSocket, rest }) => {
        lastError = null;
        track(upSocket);
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        /* Order matters: anything the upstream already sent (`rest`), then anything Chrome sent
           ahead of our reply (`head`), before the pipes are joined. Dropping either truncates
           the first TLS record and the page fails with a protocol error. */
        if (rest.length) clientSocket.write(rest);
        if (head && head.length) upSocket.write(head);
        upSocket.pipe(clientSocket);
        clientSocket.pipe(upSocket);

        /**
         * A tunnel is TWO sockets and they live and die together.
         *
         * 'close' and 'end' as well as 'error' — wiring only 'error' is what left the upstream
         * socket open every time a tab closed normally, which is both a leak against the
         * provider and the 120-second `close()` this Set was added for.
         */
        const drop = () => { upSocket.destroy(); clientSocket.destroy(); };
        for (const ev of ['error', 'close', 'end'] as const) {
          upSocket.on(ev, drop);
          clientSocket.on(ev, drop);
        }
      })
      .catch((e: unknown) => {
        note(e);
        /* 502 rather than a silent destroy: Chrome renders a proxy error the person can see,
           instead of a page that hangs with no explanation. */
        clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      });
  });

  /* Plain http:// still happens — captive-portal probes, some telemetry, and any http link a
     person clicks. Forwarded with the same credential so it cannot slip out unproxied. */
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    requests++;
    const target = String(req.url ?? '');
    if (!/^http:\/\//i.test(target)) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('This is redbot’s proxy relay. It only forwards proxied requests.');
      return;
    }
    const upReq = netConnect({ host: upstream.host, port: upstream.port }, () => {
      const headers = [`${req.method ?? 'GET'} ${target} HTTP/1.1`];
      for (const [k, v] of Object.entries(req.headers)) {
        if (/^proxy-authorization$/i.test(k)) continue;              // ours is the only one
        if (Array.isArray(v)) for (const one of v) headers.push(`${k}: ${one}`);
        else if (v != null) headers.push(`${k}: ${v}`);
      }
      headers.push(`Proxy-Authorization: ${authHeader(upstream)}`);
      upReq.write(headers.join('\r\n') + '\r\n\r\n');
      /**
       * `end: false`, and it is not a tidiness flag — without it this path does not work.
       *
       * A plain `req.pipe(upReq)` ends the upstream socket as soon as the browser's request body
       * ends, which for a GET is immediately after the head. The provider then has its connection
       * half-closed before it has answered, and whatever it writes back arrives on a socket the
       * other end has already torn down. The caller sees an empty reply — `HTTP 0`.
       *
       * MEASURED, both directions, against an upstream that forwards to the real internet and so
       * answers ~300ms later, the way every real proxy does:
       *
       *   req.pipe(upReq)                 exit-IP check through the relay: FAIL "HTTP 0"  (2/2 runs)
       *   req.pipe(upReq, {end:false})    exit-IP check through the relay: 180.191.139.234 (2/2)
       *
       * It survived until now because the only upstream this had ever been run against was a fake
       * that answers SYNCHRONOUSLY inside its request handler — the response is written before the
       * FIN can take effect, so the bug is invisible. Against a provider it would have surfaced as
       * "the relay answered HTTP 0", the health gate failing, and every proxied launch refused.
       *
       * Half-closing after a request is an HTTP/1.0 idiom in any case; a keep-alive connection is
       * finished by the response, not by the client shutting down its writing half.
       */
      req.pipe(upReq, { end: false });
    });
    upReq.on('data', (chunk: Buffer) => { if (!res.socket?.destroyed) res.socket?.write(chunk); });
    upReq.on('error', (e) => {
      note(e);
      if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('proxy unreachable'); }
    });
    /* The response is written straight to the socket above, so end the http layer's own
       bookkeeping when the upstream finishes. */
    upReq.on('end', () => { try { res.socket?.end(); } catch { /* already gone */ } });
  });

  server.on('clientError', (_e, socket) => {
    if (socket && !socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : opts.port;

  return {
    port: boundPort,
    label: opts.label ?? null,
    get requests() { return requests; },
    get lastError() { return lastError; },
    close: () => new Promise<void>((resolve) => {
      /**
       * Destroy the tracked sockets FIRST, then let the server close.
       *
       * `closeAllConnections()` alone is not enough and that is measured, not assumed: an
       * upgraded CONNECT socket is no longer tracked by the http server, so it survives that
       * call and `server.close()` then waited 120 seconds on it. The Set is the only thing that
       * can see those sockets.
       *
       * A relay that will not stop is a relay that outlives the console that owns it — and the
       * whole safety story here is that quitting redbot takes the exit with it.
       */
      for (const s of live) s.destroy();
      live.clear();
      server.closeAllConnections?.();
      server.close(() => resolve());
    })
  };
}
