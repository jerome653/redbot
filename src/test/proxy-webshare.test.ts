/**
 * Webshare, without a network — the parsing, the US filter, the timezone enrichment and the ways
 * it is allowed to fail.
 *
 * `fetchUsProxies` takes an injectable `fetchImpl` for exactly this: the real call to Webshare is
 * proven by hitting the live endpoint, but everything the function DECIDES about a response is
 * pure and is decided here, against the shape the live /proxy/list/ actually returned (the three
 * US proxies this feature was built from are the fixture, so the test is pinned to real data).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { fetchUsProxies } = await import('../proxy/webshare.js');

/** A stand-in for a fetch Response — only the three members the module reads. */
function fakeRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as unknown as Response;
}

/** The last-4 of the Authorization header a call carried, so a test can prove where the key went. */
function authOf(init: RequestInit | undefined): string | undefined {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers.Authorization;
}

/** The real rows the live API returned on 2026-08-12, with the fields the module reads. */
const LIVE_PAGE = {
  count: 3, next: null, previous: null,
  results: [
    { id: 'd-1', username: 'svqdjfsl', password: 'hpoc99s7tvt4', proxy_address: '31.56.127.193',
      port: 7684, valid: true, last_verification: '2026-08-12T01:18:37Z', country_code: 'US',
      city_name: 'Seattle', asn_name: 'Leaseweb Usa, Inc.' },
    { id: 'd-2', username: 'svqdjfsl', password: 'hpoc99s7tvt4', proxy_address: '198.23.243.226',
      port: 6361, valid: true, country_code: 'US', city_name: 'Los Angeles', asn_name: 'Hostpapa' },
    { id: 'd-3', username: 'svqdjfsl', password: 'hpoc99s7tvt4', proxy_address: '38.154.185.97',
      port: 6370, valid: true, country_code: 'US', city_name: 'Piscataway', asn_name: 'B2 Net Solutions Inc.' }
  ]
};

test('a US list is parsed, credentials carried, and each exit given the timezone of its city', async () => {
  const fetchImpl: typeof fetch = async () => fakeRes(200, LIVE_PAGE);
  const proxies = await fetchUsProxies('my-secret-key', { fetchImpl });

  assert.equal(proxies.length, 3);
  const [p0, p1, p2] = proxies;
  assert.ok(p0 && p1 && p2, 'three proxies must come back');

  // The address/port/credentials the exit form fills from.
  assert.deepEqual(
    { host: p0.host, port: p0.port, username: p0.username, password: p0.password },
    { host: '31.56.127.193', port: 7684, username: 'svqdjfsl', password: 'hpoc99s7tvt4' });
  assert.equal(p0.asn, 'Leaseweb Usa, Inc.');
  assert.equal(p0.valid, true);

  // The point of the whole feature: city -> the account timezone the operator copies.
  assert.equal(p0.timezone, 'America/Los_Angeles', 'Seattle is Pacific');
  assert.equal(p1.timezone, 'America/Los_Angeles', 'Los Angeles is Pacific');
  assert.equal(p2.timezone, 'America/New_York', 'Piscataway is Eastern');
});

test('the request carries the token as a header and asks for direct-mode US proxies', async () => {
  const calls: Array<{ url: string; auth: string | undefined }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), auth: authOf(init) });
    return fakeRes(200, LIVE_PAGE);
  };
  await fetchUsProxies('my-secret-key', { fetchImpl });

  assert.equal(calls.length, 1);
  const first = calls[0];
  assert.ok(first);
  assert.match(first.url, /mode=direct/, 'mode=direct is required by the API');
  assert.match(first.url, /country_code__in=US/, 'the US filter must be in the query');
  // The key travels ONLY in the Authorization header — never the URL, where it would land in logs.
  assert.equal(first.auth, 'Token my-secret-key');
  assert.doesNotMatch(first.url, /my-secret-key/, 'the key must never be in the URL');
});

test('pages are followed so a plan with more than one page is fully listed', async () => {
  const [r0, r1, r2] = LIVE_PAGE.results;
  const page1 = { next: 'https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&country_code__in=US&page=2',
    results: [r0] };
  const page2 = { next: null, results: [r1, r2] };
  let n = 0;
  const fetchImpl: typeof fetch = async () => fakeRes(200, n++ === 0 ? page1 : page2);

  const proxies = await fetchUsProxies('k', { fetchImpl });
  assert.equal(proxies.length, 3, 'both pages must be aggregated');
});

test('a non-US row is dropped defensively, even if the filter let it through', async () => {
  const mixed = { next: null, results: [
    LIVE_PAGE.results[0],
    { id: 'x', username: 'u', password: 'p', proxy_address: '1.2.3.4', port: 80, valid: true, country_code: 'CA', city_name: 'Toronto' }
  ]};
  const proxies = await fetchUsProxies('k', { fetchImpl: async () => fakeRes(200, mixed) });
  assert.equal(proxies.length, 1, 'the Canadian exit must not be listed under a US feature');
  assert.equal(proxies[0]?.country, 'US');
});

test('a city the table does not know gets a null timezone, never a guess', async () => {
  const odd = { next: null, results: [
    { id: 'z', username: 'u', password: 'p', proxy_address: '9.9.9.9', port: 9, valid: false, country_code: 'US', city_name: 'Nowheresville' }
  ]};
  const proxies = await fetchUsProxies('k', { fetchImpl: async () => fakeRes(200, odd) });
  const [p] = proxies;
  assert.ok(p);
  assert.equal(p.timezone, null, 'an unknown city must not be handed a confident zone');
  assert.equal(p.valid, false);
});

test('a rejected key throws a message that says so and never echoes the key', async () => {
  const fetchImpl: typeof fetch = async () => fakeRes(401, { detail: 'Invalid token.' });
  await assert.rejects(
    () => fetchUsProxies('bad-key-value', { fetchImpl }),
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      assert.match(msg, /rejected the API key/i);
      assert.match(msg, /401/);
      assert.doesNotMatch(msg, /bad-key-value/, 'the key must never appear in an error');
      return true;
    });
});

test('an empty key is refused before any request is made', async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => { called = true; return fakeRes(200, LIVE_PAGE); };
  await assert.rejects(() => fetchUsProxies('   ', { fetchImpl }), /No Webshare API key/);
  assert.equal(called, false, 'no request may go out without a key');
});
