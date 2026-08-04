/**
 * Is the exit actually working, and what address does the world see?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ONE MODULE AND NOT THREE CHECKS SCATTERED AROUND
 *
 * Four things need this answer and they must not each grow their own version:
 *
 *   `redbot proxy vet`   before an account's FIRST sign-in — the irreversible moment
 *   `launchChrome`       before pointing a browser at the exit
 *   `attach()`           before driving a browser that is already open
 *   `doctor`             when a person asks whether the install is healthy
 *
 * Two of those run BEFORE a relay exists (vetting a freshly bought IP), and two run AFTER
 * (checking the live chain). So there are two entry points over one implementation:
 *
 *   checkUpstream(u)         dial the provider directly — no relay needed
 *   checkThroughRelay(port)  dial 127.0.0.1:<relay> — proves the WHOLE chain
 *
 * `checkThroughRelay` is the one that matters operationally, because it is the only one that
 * proves the thing Chrome will actually use. `checkUpstream` exists so an IP can be judged
 * before any redbot plumbing is committed to it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE EXIT IP IS FETCHED OVER PLAIN HTTP
 *
 * The obvious choice is https, and it is the wrong one HERE. Reading the body of an https
 * response through a CONNECT tunnel means terminating TLS in this process — real work, and work
 * whose failures (cert chains, SNI, TLS versions) would be reported as "your proxy is broken."
 * The question being asked is "what address does a server see", which plain HTTP answers exactly
 * as well, over the same authenticated hop.
 *
 * The tunnel is not left unproven, though: `tunnelOk()` opens a real CONNECT — the exact path
 * Chrome takes for every https origin — so both code paths the browser uses are exercised.
 */
import { connect as netConnect, type Socket } from 'node:net';
import { once } from 'node:events';
import { openTunnel, assertUsableUpstream, RelayError, UpstreamAuthError, type UpstreamProxy } from './relay.js';

/** Where the exit IP is read from. Plain http on purpose — see the header. */
export const DEFAULT_ECHO_URL = 'http://api.ipify.org/';

export interface HealthResult {
  ok: boolean;
  /** The address the echo service saw. Null whenever `ok` is false. */
  exitIp: string | null;
  /** One sentence for a person, never for a log parser. */
  detail: string;
  /** HOW this was established — the `src/ports.ts` evidence discipline, applied to the network. */
  via: 'upstream' | 'relay';
  /** Round trip in ms, recorded because a hosted address and a home line do not answer alike. */
  ms: number | null;
}

/** Collect a whole HTTP response off a socket. Bounded, so a chatty server cannot hang a check. */
async function readAll(socket: Socket, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => { cleanup(); socket.destroy(); reject(new RelayError('The exit-IP check timed out.')); }, timeoutMs);
    const onData = (c: Buffer) => {
      buf = Buffer.concat([buf, c]);
      if (buf.length > 256 * 1024) { cleanup(); socket.destroy(); reject(new RelayError('The exit-IP check got an oversized reply.')); }
    };
    const done = () => { cleanup(); resolve(buf.toString('utf8')); };
    const onErr = (e: Error) => { cleanup(); reject(new RelayError(`The exit-IP check failed: ${e.message}`)); };
    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData); socket.off('end', done); socket.off('close', done); socket.off('error', onErr);
    }
    socket.on('data', onData); socket.on('end', done); socket.on('close', done); socket.on('error', onErr);
  });
}

/**
 * Strip HTTP framing from a response body.
 *
 * MEASURED, and the reason this exists: an HTTP/1.1 server that does not set Content-Length
 * replies with `Transfer-Encoding: chunked`, so the bytes after the head are NOT the body — they
 * are `<hex length>\r\n<data>\r\n…0\r\n\r\n`. Returning them raw made `JSON.parse` fail with
 * "not JSON" against a server that had answered perfectly.
 *
 * It went unnoticed at first because the exit-IP read scans for an IPv4 with a regular
 * expression and finds one whatever the framing around it looks like. Only a caller that parses
 * the body STRICTLY exposed it — which is exactly the kind of defect that would otherwise have
 * surfaced first against the real provider, in the middle of a six-hour vetting window.
 */
export function decodeBody(head: string, raw: string): string {
  if (!/^transfer-encoding:\s*chunked/im.test(head)) {
    const m = /^content-length:\s*(\d+)/im.exec(head);
    return m && m[1] ? raw.slice(0, Number(m[1])) : raw;
  }
  let out = '';
  let rest = raw;
  for (;;) {
    const nl = rest.indexOf('\r\n');
    if (nl === -1) break;
    /* The size line may carry chunk extensions after a ';' — everything before it is the size. */
    const size = parseInt((rest.slice(0, nl).split(';')[0] ?? '').trim(), 16);
    if (!Number.isFinite(size) || size <= 0) break;          // 0 terminates; NaN means malformed
    out += rest.slice(nl + 2, nl + 2 + size);
    rest = rest.slice(nl + 2 + size + 2);                     // skip the chunk's trailing CRLF
  }
  return out;
}

/** The first thing that looks like an IPv4 address. ipify returns the bare address. */
function firstIpv4(body: string): string | null {
  const m = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/.exec(body);
  if (!m || !m[1]) return null;
  const parts = m[1].split('.').map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? m[1] : null;
}

/**
 * One plain-HTTP request through a proxy hop.
 *
 * `auth` is supplied when talking to the PROVIDER directly and omitted when talking to our own
 * relay — the relay adds the credential itself, and sending a second one would be the caller
 * quietly duplicating the thing relay.ts exists to own.
 */
export async function fetchThroughProxy(
  proxyHost: string, proxyPort: number, url: string, auth: string | null, timeoutMs: number
): Promise<{ status: number; body: string }> {
  const socket = netConnect({ host: proxyHost, port: proxyPort });
  socket.setTimeout(timeoutMs);
  try {
    await Promise.race([
      once(socket, 'connect'),
      once(socket, 'error').then(([e]) => { throw new RelayError(`Could not reach ${proxyHost}:${proxyPort}: ${(e as Error).message}`); })
    ]);
  } catch (e) {
    socket.destroy();
    throw e instanceof RelayError ? e : new RelayError(String(e));
  }

  const host = new URL(url).host;
  socket.write(
    `GET ${url} HTTP/1.1\r\n`
    + `Host: ${host}\r\n`
    + (auth ? `Proxy-Authorization: ${auth}\r\n` : '')
    + 'User-Agent: redbot-health/1\r\n'
    + 'Accept: */*\r\n'
    + 'Connection: close\r\n\r\n'
  );

  const raw = await readAll(socket, timeoutMs);
  const split = raw.indexOf('\r\n\r\n');
  const head = split === -1 ? raw : raw.slice(0, split);
  const framed = split === -1 ? '' : raw.slice(split + 4);
  const m = /^HTTP\/1\.[01] (\d{3})/.exec(head);
  return { status: m && m[1] ? Number(m[1]) : 0, body: decodeBody(head, framed) };
}

/** `Basic base64(user:pass)` — built here, never stored, never logged. */
function authFor(u: UpstreamProxy): string {
  return 'Basic ' + Buffer.from(`${u.username}:${u.password}`).toString('base64');
}

/**
 * Fetch a URL THROUGH the provider and parse it as JSON.
 *
 * Exported for the vetting gate, which needs more than the address: it needs the country, the
 * region, the ASN and whether an IP-intelligence service already classifies the address as a
 * proxy. All of that comes back from one plain-HTTP call, so it shares this transport rather
 * than growing a second one that could drift from what the relay actually does.
 *
 * Plain HTTP, deliberately — the same reasoning as the exit-IP read above: terminating TLS in
 * this process to read a body would add failure modes that get misreported as "your proxy is
 * broken."
 */
export async function fetchJsonThroughUpstream<T>(
  upstream: UpstreamProxy, url: string, timeoutMs = 20_000
): Promise<{ ok: true; value: T } | { ok: false; detail: string }> {
  try {
    assertUsableUpstream(upstream);
    const { status, body } = await fetchThroughProxy(upstream.host, upstream.port, url, authFor(upstream), timeoutMs);
    if (status === 407) return { ok: false, detail: new UpstreamAuthError(407, upstream.host).message };
    if (status !== 200) return { ok: false, detail: `The lookup answered HTTP ${status}.` };
    try { return { ok: true, value: JSON.parse(body) as T }; }
    catch { return { ok: false, detail: 'The lookup replied with something that is not JSON.' }; }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Turn any failure into a HealthResult rather than a throw: every caller wants to REPORT it. */
function asFailure(e: unknown, via: HealthResult['via']): HealthResult {
  const detail = e instanceof UpstreamAuthError || e instanceof RelayError
    ? e.message
    : `The exit could not be checked: ${e instanceof Error ? e.message : String(e)}`;
  return { ok: false, exitIp: null, detail, via, ms: null };
}

/**
 * Check the provider directly. Used by `proxy vet`, before any relay exists.
 */
export async function checkUpstream(
  upstream: UpstreamProxy, opts: { url?: string; timeoutMs?: number } = {}
): Promise<HealthResult> {
  const url = opts.url ?? DEFAULT_ECHO_URL;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const started = Date.now();
  try {
    assertUsableUpstream(upstream);
    const { status, body } = await fetchThroughProxy(upstream.host, upstream.port, url, authFor(upstream), timeoutMs);
    if (status === 407) return asFailure(new UpstreamAuthError(407, upstream.host), 'upstream');
    if (status !== 200) {
      return { ok: false, exitIp: null, via: 'upstream', ms: Date.now() - started,
               detail: `The proxy answered HTTP ${status} instead of serving the exit-IP check.` };
    }
    const ip = firstIpv4(body);
    return ip
      ? { ok: true, exitIp: ip, detail: `Exit address ${ip}, via the provider directly.`, via: 'upstream', ms: Date.now() - started }
      : { ok: false, exitIp: null, via: 'upstream', ms: Date.now() - started,
          detail: 'The exit-IP service replied with something that is not an address.' };
  } catch (e) {
    return asFailure(e, 'upstream');
  }
}

/**
 * Check the whole chain: this process → relay → provider → internet.
 *
 * This is the one `launchChrome`, `attach()` and `doctor` call, because it is the only one that
 * proves what the browser will actually get.
 */
export async function checkThroughRelay(
  relayPort: number, opts: { url?: string; timeoutMs?: number } = {}
): Promise<HealthResult> {
  const url = opts.url ?? DEFAULT_ECHO_URL;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const started = Date.now();
  try {
    const { status, body } = await fetchThroughProxy('127.0.0.1', relayPort, url, null, timeoutMs);
    if (status === 502) {
      return { ok: false, exitIp: null, via: 'relay', ms: Date.now() - started,
               detail: 'The relay is listening but could not reach the provider. The credential or the subscription is the usual cause.' };
    }
    if (status !== 200) {
      return { ok: false, exitIp: null, via: 'relay', ms: Date.now() - started,
               detail: `The relay answered HTTP ${status} instead of serving the exit-IP check.` };
    }
    const ip = firstIpv4(body);
    return ip
      ? { ok: true, exitIp: ip, detail: `Exit address ${ip}, through this account's relay.`, via: 'relay', ms: Date.now() - started }
      : { ok: false, exitIp: null, via: 'relay', ms: Date.now() - started,
          detail: 'The exit-IP service replied with something that is not an address.' };
  } catch (e) {
    return asFailure(e, 'relay');
  }
}

/**
 * Prove the CONNECT path specifically — the one Chrome uses for every https origin.
 *
 * Separate from the exit-IP read because they fail for different reasons and an operator needs
 * to know which: a working tunnel with a failed IP read is a broken echo service, whereas a
 * failed tunnel is a broken exit.
 */
export async function tunnelOk(
  upstream: UpstreamProxy, target = { host: 'www.reddit.com', port: 443 }, timeoutMs = 20_000
): Promise<{ ok: boolean; detail: string; ms: number | null }> {
  const started = Date.now();
  try {
    const { socket } = await openTunnel(upstream, target, timeoutMs);
    socket.destroy();
    return { ok: true, detail: `Tunnel to ${target.host}:${target.port} established.`, ms: Date.now() - started };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
      ms: null
    };
  }
}
