/**
 * Vetting an exit address BEFORE an account signs in through it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A GATE AND NOT A DIAGNOSTIC
 *
 * Reddit associates an account with the address it first signs in from, and there is no undo. So
 * the order of operations is not a style choice: everything below has to pass BEFORE the first
 * sign-in, because after it the only remedy is a new account.
 *
 * That single fact sets the posture for the whole module: **fail closed**. A check that could not
 * be established is a FAIL, never a pass. "I could not reach the geolocation service" must not
 * read as "the address is fine" — the two are indistinguishable in their consequences here, and
 * one of them costs an account.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS A FAIL AND WHAT IS ONLY A WARNING, AND WHY THE LINE IS THERE
 *
 * FAIL is reserved for facts with one meaning:
 *   - the address is not in the country/region that was paid for
 *   - the address CHANGES under us          (then it cannot be a permanent identity)
 *   - it equals this machine's own address  (then the proxy is not carrying anything)
 *   - Reddit refuses it                     (then nothing downstream matters)
 *
 * WARN is for signals that are real but whose meaning is genuinely arguable — chiefly an
 * IP-intelligence service flagging the address as `proxy` or `hosting`. An ISP proxy is a
 * datacenter-hosted address with an ISP's ASN, so *some* services flag it by construction. Auto
 * -failing on that would reject the entire product category; hiding it would conceal the single
 * most relevant risk signal available. So it is surfaced loudly and left to a person.
 *
 * Recording that distinction is the point. A gate that fails on everything is ignored, and a
 * gate that passes on everything is decoration.
 */
import { checkUpstream, fetchJsonThroughUpstream } from './health.js';
import { assertUsableUpstream, type UpstreamProxy } from './relay.js';

/** Free tier is HTTP-only, which is exactly the transport the relay forwards. */
export const GEO_URL =
  'http://ip-api.com/json/?fields=status,message,query,country,countryCode,region,regionName,city,isp,org,as,asname,mobile,proxy,hosting,reverse';

/** What ip-api.com answers with. Only the fields requested above. */
export interface GeoRecord {
  status?: string;
  message?: string;
  query?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  isp?: string;
  org?: string;
  as?: string;
  asname?: string;
  reverse?: string;
  mobile?: boolean;
  proxy?: boolean;
  hosting?: boolean;
}

export type Level = 'PASS' | 'FAIL' | 'WARN' | 'UNKNOWN';

export interface Check {
  name: string;
  level: Level;
  detail: string;
}

/** One observation of the exit, taken at a point in time. */
export interface Sample {
  at: string;
  ok: boolean;
  exitIp: string | null;
  ms: number | null;
  detail: string;
}

export interface VetOptions {
  /** Two letters, upper case. The country the address was bought in. */
  expectCountry?: string;
  /** Free text; compared case-insensitively against the region ip-api reports. */
  expectRegion?: string;
  /** How many observations the stability check needs. */
  samples?: number;
  /** Over how many hours to spread them. */
  hours?: number;
}

export interface VetReport {
  startedAt: string;
  finishedAt: string;
  /** Never includes the credential — only where the proxy is. */
  upstream: { host: string; port: number };
  checks: Check[];
  samples: Sample[];
  geo: GeoRecord | null;
  machineIp: string | null;
  verdict: 'PASS' | 'FAIL';
  /** Warnings do not block, but a person must read them before signing in. */
  warnings: string[];
}

/**
 * This machine's own public address, fetched WITHOUT the proxy.
 *
 * Never cached, and that is deliberate rather than lazy: this connection has been observed
 * handing out different public addresses minutes apart, so a value cached at process start can
 * be stale by the time it is compared. A stale comparison here produces the worst possible
 * error — "the proxy is working" when it is not.
 */
export async function machinePublicIp(timeoutMs = 10_000): Promise<string | null> {
  try {
    const res = await fetch('https://api.ipify.org/?format=json', { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const j = (await res.json()) as { ip?: string };
    return typeof j.ip === 'string' ? j.ip : null;
  } catch {
    return null;
  }
}

/** rDNS shapes that consumer access lines wear and hosted allocations generally do not. */
const CONSUMER_RDNS = /(\bdynamic\b|\bdhcp\b|\bdsl\b|\bcable\b|\bpppoe\b|\bbroadband\b|\bres\b|hsd1|customer|client|user|dial)/i;

/**
 * Judge one geolocation record.
 *
 * Split out so it can be tested against fixed records rather than against the internet — the
 * classification rules are the part most likely to be got wrong, and they must not need a live
 * provider to exercise.
 */
export function judgeGeo(geo: GeoRecord | null, opts: VetOptions): Check[] {
  const checks: Check[] = [];
  if (!geo || geo.status !== 'success') {
    /* FAIL, not UNKNOWN-and-shrug: without this record we know neither the country nor the ASN,
       and proceeding would mean signing in from an address we cannot describe. */
    checks.push({
      name: 'location and network',
      level: 'FAIL',
      detail: geo?.message
        ? `The address could not be looked up: ${geo.message}`
        : 'The address could not be looked up at all, so its country and network are unknown.'
    });
    return checks;
  }

  const want = (opts.expectCountry ?? 'US').toUpperCase();
  const got = (geo.countryCode ?? '').toUpperCase();
  checks.push(got === want
    ? { name: 'country', level: 'PASS', detail: `${geo.country ?? got} (${got}) — as ordered.` }
    : { name: 'country', level: 'FAIL', detail: `Expected ${want}, got ${got || 'nothing'}. The browser timezone would contradict the address.` });

  if (opts.expectRegion) {
    const gotRegion = geo.regionName ?? '';
    const match = gotRegion.toLowerCase().includes(opts.expectRegion.toLowerCase());
    checks.push(match
      ? { name: 'region', level: 'PASS', detail: `${gotRegion}${geo.city ? `, ${geo.city}` : ''} — as ordered.` }
      : { name: 'region', level: 'FAIL', detail: `Expected ${opts.expectRegion}, got ${gotRegion || 'nothing'}. Pick the timezone from what the address actually reports, not from the order.` });
  } else {
    checks.push({
      name: 'region',
      level: 'WARN',
      detail: `Reported ${geo.regionName ?? 'nowhere'}${geo.city ? `, ${geo.city}` : ''}. No expected region was given, so this could not be confirmed — set the account timezone from this value.`
    });
  }

  checks.push({
    name: 'network',
    level: 'PASS',
    detail: `${geo.as ?? 'unknown ASN'} · ${geo.isp ?? 'unknown ISP'}${geo.reverse ? ` · rDNS ${geo.reverse}` : ' · no rDNS'}`
  });

  /* The classification signals. WARN by design — see the header. */
  if (geo.proxy) {
    checks.push({ name: 'proxy flag', level: 'WARN', detail: 'An IP-intelligence service already classifies this address as a proxy. Reddit may use the same signal.' });
  } else {
    checks.push({ name: 'proxy flag', level: 'PASS', detail: 'Not currently classified as a proxy.' });
  }
  if (geo.hosting) {
    checks.push({ name: 'hosting flag', level: 'WARN', detail: 'Classified as a hosting/datacenter address. Expected for an ISP proxy, but it is the weaker end of the range.' });
  }
  if (geo.mobile) {
    checks.push({ name: 'mobile flag', level: 'WARN', detail: 'Reported as a mobile carrier address, which is not what an ISP proxy should be.' });
  }
  if (geo.reverse && CONSUMER_RDNS.test(geo.reverse)) {
    checks.push({
      name: 'rDNS shape',
      level: 'WARN',
      detail: `Reverse DNS "${geo.reverse}" looks like a consumer access line rather than a hosted allocation — worth asking the provider about, since a dedicated ISP lease should not look like somebody's house.`
    });
  }
  return checks;
}

/** Judge a set of observations. Stability is the check a rotating pool cannot pass by accident. */
export function judgeSamples(samples: Sample[], wanted: number): Check[] {
  const good = samples.filter((s) => s.ok && s.exitIp);
  if (good.length === 0) {
    return [{ name: 'reachable', level: 'FAIL', detail: 'The exit never answered. Nothing else could be checked.' }];
  }
  const checks: Check[] = [];
  checks.push(good.length === samples.length
    ? { name: 'reachable', level: 'PASS', detail: `${good.length}/${samples.length} checks answered.` }
    : { name: 'reachable', level: 'FAIL', detail: `${good.length}/${samples.length} checks answered — the exit dropped during the window, which is what it would do mid-session.` });

  const seen = [...new Set(good.map((s) => s.exitIp))];
  if (good.length < wanted) {
    checks.push({
      name: 'stability',
      level: 'FAIL',
      detail: `Only ${good.length} of ${wanted} observations were taken, so a permanent address has NOT been demonstrated.`
    });
  } else if (seen.length === 1) {
    checks.push({ name: 'stability', level: 'PASS', detail: `One address across ${good.length} checks: ${seen[0]}.` });
  } else {
    checks.push({
      name: 'stability',
      level: 'FAIL',
      detail: `The address CHANGED during the window — saw ${seen.length}: ${seen.join(', ')}. This cannot be a permanent identity for an account.`
    });
  }

  const times = good.map((s) => s.ms).filter((n): n is number => typeof n === 'number');
  if (times.length >= 2) {
    const lo = Math.min(...times), hi = Math.max(...times);
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    checks.push({
      name: 'latency',
      level: 'PASS',
      detail: `${avg}ms average (${lo}–${hi}ms). Recorded as evidence, not as a pass mark — a hosted address answers more evenly than a home line relaying for a stranger.`
    });
  }
  return checks;
}

/** Take one observation: the exit address and how long it took. */
export async function sampleOnce(upstream: UpstreamProxy): Promise<Sample> {
  const at = new Date().toISOString();
  const r = await checkUpstream(upstream);
  return { at, ok: r.ok, exitIp: r.exitIp, ms: r.ms, detail: r.detail };
}

/** Read the address's location and network classification, through the proxy. */
export async function probeGeo(upstream: UpstreamProxy): Promise<GeoRecord | null> {
  const r = await fetchJsonThroughUpstream<GeoRecord>(upstream, GEO_URL);
  return r.ok ? r.value : null;
}

/** Compare the exit against this machine's own address. FAIL CLOSED when either is unknown. */
export function judgeDistinctFromMachine(exitIp: string | null, machineIp: string | null): Check {
  if (!exitIp) {
    return { name: 'not this computer', level: 'FAIL', detail: 'The exit address is unknown, so it cannot be shown to differ from this computer.' };
  }
  if (!machineIp) {
    return {
      name: 'not this computer',
      level: 'FAIL',
      detail: 'This computer’s own public address could not be read, so the comparison could not be made. Unproven is not the same as fine.'
    };
  }
  return exitIp === machineIp
    ? { name: 'not this computer', level: 'FAIL', detail: `The exit address equals this computer's own (${exitIp}). Traffic is NOT going through the proxy.` }
    : { name: 'not this computer', level: 'PASS', detail: `Exit ${exitIp} differs from this computer's ${machineIp}.` };
}

/** The overall verdict. Any FAIL fails; WARNs are surfaced and do not block. */
export function verdictFor(checks: Check[]): { verdict: 'PASS' | 'FAIL'; warnings: string[] } {
  const failed = checks.some((c) => c.level === 'FAIL' || c.level === 'UNKNOWN');
  return {
    verdict: failed ? 'FAIL' : 'PASS',
    warnings: checks.filter((c) => c.level === 'WARN').map((c) => `${c.name}: ${c.detail}`)
  };
}

/**
 * Run the whole gate.
 *
 * `onSample` reports progress, because the stability window is hours long and a command that
 * prints nothing for six hours is one people kill.
 */
export async function vetUpstream(
  upstream: UpstreamProxy,
  opts: VetOptions = {},
  onSample?: (s: Sample, i: number, total: number) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<VetReport> {
  assertUsableUpstream(upstream);
  const startedAt = new Date().toISOString();
  const total = Math.max(1, opts.samples ?? 8);
  const hours = Math.max(0, opts.hours ?? 6);
  const gapMs = total > 1 ? Math.round((hours * 3_600_000) / (total - 1)) : 0;

  const samples: Sample[] = [];
  for (let i = 0; i < total; i++) {
    const s = await sampleOnce(upstream);
    samples.push(s);
    onSample?.(s, i, total);
    if (i < total - 1 && gapMs > 0) await sleep(gapMs);
  }

  const geo = await probeGeo(upstream);
  const machineIp = await machinePublicIp();
  const lastGood = [...samples].reverse().find((s) => s.ok && s.exitIp)?.exitIp ?? null;

  const checks: Check[] = [
    ...judgeSamples(samples, total),
    judgeDistinctFromMachine(lastGood, machineIp),
    ...judgeGeo(geo, opts)
  ];
  const { verdict, warnings } = verdictFor(checks);

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    upstream: { host: upstream.host, port: upstream.port },   // never the credential
    checks,
    samples,
    geo,
    machineIp,
    verdict,
    warnings
  };
}
