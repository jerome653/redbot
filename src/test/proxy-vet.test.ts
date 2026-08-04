/**
 * The vetting gate.
 *
 * The judgement functions are tested against FIXED records rather than against a live provider,
 * because the classification rules are the part most likely to be wrong and they must be
 * exercisable without buying anything or reaching the internet.
 *
 * The load-bearing tests here are the FAIL-CLOSED ones. This gate exists to stand between an
 * operator and an irreversible mistake, so the dangerous defect is not "it rejected a good
 * address" — it is "it passed something it could not actually check." Every unknown below is
 * asserted to come back FAIL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

/* Types come from a static `import type` — `type X` is not valid inside a destructuring
   pattern, and the value side has to stay dynamic to match how the other suites load modules. */
import type { GeoRecord } from '../proxy/vet.js';

const {
  judgeGeo, judgeSamples, judgeDistinctFromMachine, verdictFor, vetUpstream, GEO_URL
} = await import('../proxy/vet.js');
const { RelayError } = await import('../proxy/relay.js');

const US: GeoRecord = {
  status: 'success', query: '198.51.100.20', country: 'United States', countryCode: 'US',
  regionName: 'New York', city: 'New York', isp: 'Comcast Cable', as: 'AS7922 Comcast',
  reverse: 'static-198-51-100-20.example.net', proxy: false, hosting: true, mobile: false
};

const sample = (over: Partial<{ ok: boolean; exitIp: string | null; ms: number | null }> = {}) => ({
  at: new Date().toISOString(), ok: true, exitIp: '198.51.100.20', ms: 120, detail: '', ...over
});

/* ------------------------------------------------------------------ *
 * FAIL CLOSED — the reason this module exists
 * ------------------------------------------------------------------ */

test('a geolocation lookup that FAILED is a FAIL, never a shrug', () => {
  const checks = judgeGeo(null, { expectCountry: 'US' });
  assert.equal(checks[0]?.level, 'FAIL', 'an unreadable address must not pass');
  assert.match(checks[0]?.detail ?? '', /unknown|could not be looked up/i);
});

test('an errored geolocation record is a FAIL and repeats the reason', () => {
  const checks = judgeGeo({ status: 'fail', message: 'reserved range' }, {});
  assert.equal(checks[0]?.level, 'FAIL');
  assert.match(checks[0]?.detail ?? '', /reserved range/);
});

test("a machine address that could not be read is a FAIL, not a pass", () => {
  const c = judgeDistinctFromMachine('198.51.100.20', null);
  assert.equal(c.level, 'FAIL', 'unproven is not the same as fine');
  assert.match(c.detail, /Unproven is not the same as fine/i);
});

test('an exit equal to this computer is a FAIL that says traffic is not proxied', () => {
  const c = judgeDistinctFromMachine('203.0.113.9', '203.0.113.9');
  assert.equal(c.level, 'FAIL');
  assert.match(c.detail, /NOT going through the proxy/i);
});

test('an unknown exit address is a FAIL', () => {
  assert.equal(judgeDistinctFromMachine(null, '203.0.113.9').level, 'FAIL');
});

test('an UNKNOWN check drags the whole verdict to FAIL', () => {
  const { verdict } = verdictFor([
    { name: 'a', level: 'PASS', detail: '' },
    { name: 'b', level: 'UNKNOWN', detail: '' }
  ]);
  assert.equal(verdict, 'FAIL');
});

/* ------------------------------------------------------------------ *
 * Stability — what a rotating pool cannot pass
 * ------------------------------------------------------------------ */

test('one address across every check passes stability', () => {
  const checks = judgeSamples([sample(), sample(), sample()], 3);
  const stab = checks.find((c) => c.name === 'stability');
  assert.equal(stab?.level, 'PASS');
  assert.match(stab?.detail ?? '', /198\.51\.100\.20/);
});

test('an address that CHANGES fails stability and names both addresses', () => {
  const checks = judgeSamples([sample(), sample({ exitIp: '203.0.113.77' })], 2);
  const stab = checks.find((c) => c.name === 'stability');
  assert.equal(stab?.level, 'FAIL');
  assert.match(stab?.detail ?? '', /198\.51\.100\.20/);
  assert.match(stab?.detail ?? '', /203\.0\.113\.77/);
  assert.match(stab?.detail ?? '', /cannot be a permanent identity/i);
});

test('too few observations is a FAIL — an unfinished window proves nothing', () => {
  const checks = judgeSamples([sample(), sample()], 8);
  const stab = checks.find((c) => c.name === 'stability');
  assert.equal(stab?.level, 'FAIL');
  assert.match(stab?.detail ?? '', /NOT been demonstrated/i);
});

test('an exit that dropped mid-window fails reachability', () => {
  const checks = judgeSamples([sample(), sample({ ok: false, exitIp: null })], 2);
  assert.equal(checks.find((c) => c.name === 'reachable')?.level, 'FAIL');
});

test('an exit that never answered fails and does not pretend to judge anything else', () => {
  const checks = judgeSamples([sample({ ok: false, exitIp: null })], 1);
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.level, 'FAIL');
});

/* ------------------------------------------------------------------ *
 * Location and classification
 * ------------------------------------------------------------------ */

test('the ordered country passes and a different one fails', () => {
  assert.equal(judgeGeo(US, { expectCountry: 'US' }).find((c) => c.name === 'country')?.level, 'PASS');
  const wrong = judgeGeo({ ...US, countryCode: 'DE', country: 'Germany' }, { expectCountry: 'US' });
  const c = wrong.find((x) => x.name === 'country');
  assert.equal(c?.level, 'FAIL');
  assert.match(c?.detail ?? '', /timezone would contradict/i);
});

test('a region that does not match what was ordered is a FAIL', () => {
  const checks = judgeGeo(US, { expectCountry: 'US', expectRegion: 'California' });
  assert.equal(checks.find((c) => c.name === 'region')?.level, 'FAIL');
});

test('no expected region is a WARN, not a silent pass', () => {
  const checks = judgeGeo(US, { expectCountry: 'US' });
  const r = checks.find((c) => c.name === 'region');
  assert.equal(r?.level, 'WARN');
  assert.match(r?.detail ?? '', /New York/);
});

test('a proxy-flagged address WARNS rather than failing — and says why it matters', () => {
  const checks = judgeGeo({ ...US, proxy: true }, { expectCountry: 'US' });
  const p = checks.find((c) => c.name === 'proxy flag');
  assert.equal(p?.level, 'WARN', 'auto-failing here would reject the whole product category');
  assert.match(p?.detail ?? '', /Reddit may use the same signal/i);
  /* And it must not drag the verdict down on its own. */
  assert.equal(verdictFor(checks.filter((c) => c.level !== 'FAIL')).verdict, 'PASS');
});

test('consumer-shaped reverse DNS is surfaced as a warning', () => {
  const checks = judgeGeo({ ...US, reverse: 'c-73-92-1-2.hsd1.ca.comcast.net' }, { expectCountry: 'US' });
  const r = checks.find((c) => c.name === 'rDNS shape');
  assert.equal(r?.level, 'WARN');
  assert.match(r?.detail ?? '', /consumer access line/i);
});

test('a hosted rDNS produces no consumer-line warning', () => {
  const checks = judgeGeo(US, { expectCountry: 'US' });
  assert.equal(checks.find((c) => c.name === 'rDNS shape'), undefined);
});

test('the ASN and ISP are always recorded, because provenance is evidence', () => {
  const n = judgeGeo(US, { expectCountry: 'US' }).find((c) => c.name === 'network');
  assert.match(n?.detail ?? '', /AS7922/);
  assert.match(n?.detail ?? '', /Comcast/);
});

/* ------------------------------------------------------------------ *
 * Verdict shape
 * ------------------------------------------------------------------ */

test('warnings are reported but do not block', () => {
  const { verdict, warnings } = verdictFor([
    { name: 'country', level: 'PASS', detail: '' },
    { name: 'proxy flag', level: 'WARN', detail: 'flagged' }
  ]);
  assert.equal(verdict, 'PASS');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /proxy flag/);
});

/* ------------------------------------------------------------------ *
 * End to end against a fake provider — including the credential rule
 * ------------------------------------------------------------------ */

test('vetUpstream runs the whole gate and never puts the credential in its report', async () => {
  const PASSWORD = 'sup3r-s3cret-do-not-log';
  const fake = createServer();
  fake.on('request', (req, res) => {
    if (!req.headers['proxy-authorization']) { res.writeHead(407); res.end(); return; }
    if (String(req.url).includes('ip-api.com')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(US));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('198.51.100.20');
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  const port = (fake.address() as { port: number }).port;

  try {
    const report = await vetUpstream(
      { host: '127.0.0.1', port, username: 'u', password: PASSWORD },
      { samples: 3, hours: 0, expectCountry: 'US', expectRegion: 'New York' },
      undefined,
      async () => { /* no real waiting in a test */ }
    );

    assert.equal(report.samples.length, 3);
    assert.equal(report.samples.every((s) => s.exitIp === '198.51.100.20'), true);
    assert.equal(report.checks.find((c) => c.name === 'stability')?.level, 'PASS');
    assert.equal(report.checks.find((c) => c.name === 'country')?.level, 'PASS');
    assert.equal(report.checks.find((c) => c.name === 'region')?.level, 'PASS');

    /* THE RULE: a report is written to disk and may be pasted into a ticket. */
    const serialised = JSON.stringify(report);
    assert.equal(serialised.includes(PASSWORD), false, 'the password reached the report');
    assert.equal(serialised.includes('Basic '), false, 'the encoded credential reached the report');
    assert.equal(report.upstream.host, '127.0.0.1');
    assert.equal(Object.hasOwn(report.upstream, 'password'), false, 'the report carries a credential field');
  } finally {
    fake.closeAllConnections?.();
    await new Promise<void>((r) => fake.close(() => r()));
  }
});

test('vetUpstream refuses an upstream with no credential', async () => {
  await assert.rejects(
    () => vetUpstream({ host: '127.0.0.1', port: 8080, username: '', password: '' }),
    (e: unknown) => e instanceof RelayError
  );
});

test('the geolocation URL asks for the classification fields the gate reads', () => {
  for (const field of ['countryCode', 'regionName', 'as', 'reverse', 'proxy', 'hosting', 'mobile']) {
    assert.ok(GEO_URL.includes(field), `GEO_URL must request ${field} — the gate reads it`);
  }
});
