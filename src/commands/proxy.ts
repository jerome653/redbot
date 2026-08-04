/**
 * `redbot proxy vet` — check an exit address before any account signs in through it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CREDENTIAL IS NOT AN ARGUMENT
 *
 * `--pass hunter2` would put the password in the shell history file, in the process list where
 * every other user on the machine can read it with `ps`, and in any terminal recording. So it is
 * taken from the ENVIRONMENT, or from the vault for an account that already has one. The same
 * rule `redbot vault set` follows for exactly the same reason.
 *
 * WHEN THIS RUNS. Before the first sign-in, which is the only moment it can help — Reddit ties an
 * account to the address it first appeared from and there is no undo. That is also why the
 * default is a SIX HOUR window: the one property a rented dedicated address has and a rotating
 * pool does not is that it stays put, and a single check cannot tell them apart.
 */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from '../config.js';
import { vetUpstream, type Sample, type VetReport, type Check } from '../proxy/vet.js';
import { RelayError, type UpstreamProxy } from '../proxy/relay.js';
import { getPool, closePool } from '../db.js';
import { saveVettedProxy, recordExitObservation } from '../db/proxies.js';
import { saveProxyCredential } from '../proxy/credential.js';

const ENV = {
  host: 'REDBOT_PROXY_HOST',
  port: 'REDBOT_PROXY_PORT',
  user: 'REDBOT_PROXY_USER',
  pass: 'REDBOT_PROXY_PASS'
} as const;

function usage(): string {
  return [
    'Check an exit address before an account signs in through it.',
    '',
    '  redbot proxy vet [<handle>] [--samples N] [--hours H] [--country US] [--region "New York"] [--quick]',
    '',
    'With no handle it only reports — nothing is written, which is how an address is judged',
    'before it is bought. With a handle, a PASS BINDS that account to this exit: the address,',
    'its country and region, its network, and the credential (sealed in the vault) are stored,',
    'and from then on that account\'s browser launches through it and refuses to launch without',
    'it. A FAIL writes nothing.',
    '',
    'The proxy is read from the environment, never from arguments — a password in a command line',
    'lands in your shell history and in the process list:',
    '',
    `  $env:${ENV.host}="198.51.100.20"`,
    `  $env:${ENV.port}="12323"`,
    `  $env:${ENV.user}="your-proxy-username"`,
    `  $env:${ENV.pass}="your-proxy-password"`,
    '  node dist/cli.js proxy vet --country US --region "New York"',
    '',
    'Defaults: 8 checks spread over 6 hours. --quick takes one check and reports stability as',
    'NOT ESTABLISHED, which is fine for a smoke test and not enough to sign in on.'
  ].join('\n');
}

/** Read the proxy from the environment. Refuses rather than guessing at anything missing. */
function upstreamFromEnv(): UpstreamProxy {
  const host = process.env[ENV.host]?.trim();
  const portRaw = process.env[ENV.port]?.trim();
  const username = process.env[ENV.user] ?? '';
  const password = process.env[ENV.pass] ?? '';
  const missing = [
    !host && ENV.host,
    !portRaw && ENV.port,
    !username && ENV.user,
    !password && ENV.pass
  ].filter(Boolean) as string[];

  if (missing.length) {
    throw new RelayError(
      `These are not set: ${missing.join(', ')}.\n\n${usage()}`
    );
  }
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RelayError(`${ENV.port} must be a port number between 1 and 65535 (got "${portRaw}").`);
  }
  return { host: host as string, port, username, password };
}

const MARK: Record<Check['level'], string> = {
  PASS: 'PASS', FAIL: 'FAIL', WARN: 'WARN', UNKNOWN: '????'
};

function render(report: VetReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`  exit check — ${report.upstream.host}:${report.upstream.port}`);
  lines.push(`  ${report.startedAt} → ${report.finishedAt}`);
  lines.push('');
  for (const c of report.checks) {
    lines.push(`  ${MARK[c.level].padEnd(5)} ${c.name.padEnd(20)} ${c.detail}`);
  }
  lines.push('');
  lines.push(report.verdict === 'PASS'
    ? '  VERDICT: PASS — nothing here refuses the address.'
    : '  VERDICT: FAIL — do NOT sign an account in through this address.');

  if (report.warnings.length) {
    lines.push('');
    lines.push('  Warnings — these do not block, and they are the part worth reading:');
    for (const w of report.warnings) lines.push(`    · ${w}`);
  }

  if (report.verdict === 'PASS') {
    lines.push('');
    lines.push('  A PASS means the address is stable, in the right place, and Reddit was not asked yet.');
    lines.push('  Load Reddit through it in a browser, signed OUT, before signing anything in.');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Bind the account to an exit that has just PASSED.
 *
 * Everything written here comes from the report — nothing is taken from what was ordered. The
 * distinction is the point of a gate: a person who bought "New York" and received New Jersey must
 * end up with an account whose timezone matches the ADDRESS, not the invoice, because it is the
 * address a page can read.
 *
 * The credential is sealed last. Written in the other order, a failure to store it would leave an
 * account marked enabled with no way to authenticate — which is the state that produces a 407 on
 * every request and reads to a person as "the internet is broken".
 */
async function bind(handle: string, upstream: UpstreamProxy, report: VetReport, label?: string): Promise<void> {
  const geo = report.geo;
  const pin = report.samples.find((s) => s.ok && s.exitIp)?.exitIp;
  if (!pin) throw new RelayError('The check passed but recorded no address, so nothing was written.');

  const country = (geo?.countryCode ?? '').toUpperCase();
  await saveVettedProxy(getPool(), handle, {
    host: upstream.host,
    port: upstream.port,
    label: label ?? null,
    pinnedExitIp: pin,
    /* Only a shape the column will accept. `exit_country` CHECKs two upper-case letters, so a
       lookup that answered with nothing must store nothing rather than fail the whole write. */
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    region: geo?.regionName ? geo.regionName.slice(0, 64) : null,
    asn: geo?.as ? geo.as.slice(0, 64) : null,
    rdns: geo?.reverse ? geo.reverse.slice(0, 253) : null
  });
  await recordExitObservation(getPool(), handle, pin, 'vet', true);
  await saveProxyCredential(handle, { username: upstream.username, password: upstream.password });
}

export async function proxy(sub?: string, opts: {
  handle?: string;
  samples?: string; hours?: string; country?: string; region?: string; quick?: boolean;
} = {}): Promise<number> {
  if (sub !== 'vet') {
    console.log(usage());
    return sub ? 1 : 0;
  }

  let upstream: UpstreamProxy;
  try { upstream = upstreamFromEnv(); }
  catch (e) { console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`); return 1; }

  const samples = opts.quick ? 1 : Math.max(1, Number(opts.samples ?? 8) || 8);
  const hours = opts.quick ? 0 : Math.max(0, Number(opts.hours ?? 6) || 6);

  const dir = join(DATA, 'proxy-vet');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const trail = join(dir, `${stamp}.jsonl`);

  console.log(`\n  Checking ${upstream.host}:${upstream.port} — ${samples} check(s) over ${hours}h.`);
  if (samples > 1) console.log(`  Progress is written to ${trail} as it goes, so a crash does not lose the window.`);
  console.log('');

  const report = await vetUpstream(upstream, {
    samples, hours,
    ...(opts.country ? { expectCountry: opts.country } : {}),
    ...(opts.region ? { expectRegion: opts.region } : {})
  }, (s: Sample, i: number, total: number) => {
    console.log(`  [${i + 1}/${total}] ${s.at} ${s.ok ? s.exitIp : 'no answer'}${s.ms != null ? ` (${s.ms}ms)` : ''}${s.ok ? '' : ` — ${s.detail}`}`);
    /* Appended per sample, not written at the end: six hours of observations must survive the
       process being killed, and a partial trail is still evidence. */
    appendFileSync(trail, JSON.stringify(s) + '\n', 'utf8');
  });

  const out = join(dir, `${stamp}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log(render(report));
  console.log(`  Full record: ${out}\n`);

  /**
   * The write half of the gate.
   *
   * Deliberately after the report is on screen and on disk: if the database write fails, the
   * evidence of a six-hour window still exists and can be acted on. The other order would mean a
   * failed INSERT threw away the only record that the address had been measured at all.
   */
  const handle = opts.handle?.trim();
  if (handle) {
    if (report.verdict !== 'PASS') {
      console.log(`  ${handle} was NOT bound to this address — the check did not pass.\n`);
      return 1;
    }
    try {
      await bind(handle, upstream, report);
      const pin = report.samples.find((s) => s.ok && s.exitIp)?.exitIp;
      console.log(`  ${handle} is now bound to ${pin}.`);
      console.log('  Its browser will launch through that address from now on, and will REFUSE to');
      console.log('  launch if the address ever answers as something else.');
      console.log(`  Set its timezone to match ${report.geo?.regionName ?? 'the region above'} before signing in.\n`);
    } catch (e) {
      console.error(`\n  The check passed but ${handle} could not be bound to it: ${
        e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    } finally {
      await closePool().catch(() => {});
    }
  }

  return report.verdict === 'PASS' ? 0 : 1;
}
