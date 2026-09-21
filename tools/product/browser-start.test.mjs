/**
 * The order a browser start follows — proven without a browser.
 *
 * WHAT THIS PINS, and why it did not exist before. `detectFromBrowser` and
 * `recordAccountDetection` both shipped with ZERO production callers: every reference to either,
 * outside its own definition, was a comment or a test. Both halves were green. Nothing connected
 * them, and nothing could have said so, because the only code that would have joined them lived
 * inside the HTTP server that spawns Chrome — and a decision reachable only by spawning Chrome is
 * a decision nobody writes a test for.
 *
 * So the four rules below are asserted against injected dependencies, and the one that has to
 * cross a real schema is asserted against the real database:
 *
 *   - detection THROWS        -> the browser is closed and never sent to Reddit, and no zone is
 *                                substituted from anywhere;
 *   - detection SUCCEEDS      -> it is persisted, and the row reads back with every field intact
 *                                through the REAL `recordAccountDetection` and the REAL table;
 *   - the alignment check     -> is fed the DETECTED country, never the one on the exit record;
 *   - measured vs vetted      -> a browser reporting a different country from its exit is refused,
 *                                which is the failure a proxy cannot detect from Node at all.
 *
 * The database half matters more than it looks. The three contract breaks between these two
 * modules (`via`, `ip`, `country`) were all invisible to the compiler and to both existing
 * suites, because no test ever carried a real detection into the real table. One does now.
 *
 * Run alone as:  node --env-file=db/sqlite/.env.test --test tools/product/browser-start.test.mjs
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startAlignedBrowser } from './browser-start.mjs';

const ENDPOINT = 'http://127.0.0.1:9223';
const LOGIN = 'https://www.reddit.com/login';

/**
 * One detection, exactly as `detectFromBrowser` returns it.
 *
 * Measured values, copied from src/test/proxy-detect.test.ts's SAN_JOSE fixture so the two suites
 * cannot drift into describing different providers. `via` carries the TRANSPORT, which is the
 * detector's spelling of that field and the whole reason 0018 gained a `transport` column.
 */
const MEASURED = {
  at: '2026-09-21T00:00:00.000Z',
  ip: '203.0.113.166',
  countryCode: 'US',
  country: 'United States',
  regionName: 'California',
  city: 'San Jose',
  timezone: 'America/Los_Angeles',
  offsetSeconds: -25200,
  proxy: true,
  hosting: true,
  via: 'renderer fetch of ip-api.com from a local http origin (probe @ http://127.0.0.1:9223)'
};

/** An exit that was vetted in some country. Only the fields this order actually reads. */
const exitIn = (country, region) => ({
  proxied: true, ok: true, relayPort: 41000, exitIp: '203.0.113.166',
  proxy: { country, region }
});

/**
 * Dependencies that record what they were asked, so the ORDER and the ARGUMENTS are assertable.
 *
 * `seq` is the load-bearing one: detection must happen before the override, or the lookup reads
 * back redbot's own assertion instead of the exit.
 */
function harness(over = {}) {
  const seq = [];
  const calls = { closed: 0, covered: [], refusal: [], recorded: [] };
  const deps = {
    waitForDebugPort: async () => { seq.push('wait'); return true; },
    detect: async (o) => { seq.push('detect'); return { ...MEASURED, ...(o && {}) }; },
    record: async (h, d) => { seq.push('record'); calls.recorded.push([h, d]); return { ok: true, timezone: d.timezone, locationId: 7, storedIn: ['database', 'seed-file'] }; },
    refusal: (...a) => { seq.push('refusal'); calls.refusal.push(a); return null; },
    cover: async (o) => { seq.push('cover'); calls.covered.push(o); return { pagesAligned: 2 }; },
    close: async () => { seq.push('close'); calls.closed++; },
    loginUrl: LOGIN,
    ...over
  };
  return { deps, calls, seq };
}

const start = (deps, over = {}) => startAlignedBrowser(deps, {
  endpoint: ENDPOINT, account: { handle: 'probe' }, exit: null, proxied: false, ...over
});

describe('a browser is measured before it is used', () => {
  let DATA;
  let accounts;
  let db;
  let locs;

  before(async () => {
    /* Its own throwaway seed directory, so the real data/ is untouched and the seed-file mirror
       written by recordAccountDetection lands somewhere disposable. */
    DATA = mkdtempSync(join(tmpdir(), 'redbot-start-'));
    process.env.REDBOT_DATA = DATA;
    accounts = await import('../../dist/console-accounts.js');
    db = await import('../../dist/db.js');
    locs = await import('../../dist/db/locations.js');
    assert.equal(db.dbUnavailableReason(), null,
      'the persistence test is about a real row, so it is meaningless without the database');
  });

  after(() => { rmSync(DATA, { recursive: true, force: true }); });

  /* Scoped to this file's own handles, so a re-run starts clean without disturbing anything else
     in the shared test database. account_locations cascades from the account row. */
  const forget = (handle) =>
    db.getPool().query('DELETE FROM accounts WHERE lower(handle) = lower($1)', [handle]);

  /* ---------------------------------------------------------------- *
   * Detection failure: refuse, and close the window
   * ---------------------------------------------------------------- */

  test('when detection THROWS the browser is closed, and nothing is assumed in its place', async () => {
    /* The one rule with no test at all before this. The alternative to closing is a window sitting
       on about:blank that looks like the feature worked — and the first thing a person does with
       one of those is sign into it, which is the single moment the account's identity is fixed. */
    const { deps, calls, seq } = harness({
      detect: async () => { throw new Error('the browser could not reach http://ip-api.com/json/'); }
    });
    const r = await start(deps);

    assert.equal(r.ok, false, 'a launch that could not establish a location must not succeed');
    assert.equal(r.closed, true, 'we spawned it, so we own closing it');
    assert.equal(calls.closed, 1, 'and it is closed exactly once');

    assert.equal(calls.covered.length, 0, 'nothing was covered, so nothing reached Reddit');
    assert.equal(calls.recorded.length, 0, 'and a failed detection writes no evidence');
    assert.ok(!seq.includes('cover'), 'the browser was never sent anywhere');

    assert.match(r.error, /could not establish where/i, 'the sentence names what failed');
    assert.match(r.error, /nothing was assumed in its place/i);
    /* No fallback zone reached the caller by any route — this is the defect the change deletes. */
    assert.equal(r.location, undefined, 'a refusal carries no location, not even a plausible one');
    assert.ok(!/Asia\/Manila|America\/Los_Angeles/.test(r.error),
      'and it must not quote a zone it did not measure');
  });

  test('a detection that comes back with no timezone is a FAILED one, not a partial one', async () => {
    const { deps, calls } = harness({
      detect: async () => ({ ...MEASURED, timezone: null })
    });
    const r = await start(deps);
    assert.equal(r.ok, false);
    assert.equal(r.closed, true);
    assert.equal(calls.recorded.length, 0, 'a record with no zone must never be stored');
    assert.equal(calls.covered.length, 0);
  });

  test('a measurement that cannot be RECORDED is not acted on either', async () => {
    /* The evidence and the announced zone move together or neither does. Covering a browser with
       a zone nothing wrote down would re-create exactly the un-provenanced value 0018 abolished,
       except now with a browser already open on it. */
    const { deps, calls } = harness({
      record: async () => ({ ok: false, error: 'Recording a detection needs the database.' })
    });
    const r = await start(deps);
    assert.equal(r.ok, false);
    assert.equal(r.closed, true);
    assert.equal(calls.covered.length, 0, 'an unrecorded measurement must not be announced');
    assert.match(r.error, /could not record/i);
    assert.match(r.error, /America\/Los_Angeles/, 'and it says which zone it is declining to use');
  });

  /* ---------------------------------------------------------------- *
   * The order, and what is announced
   * ---------------------------------------------------------------- */

  test('DETECTION happens before the override, or it measures our own assertion', async () => {
    const { deps, seq } = harness();
    const r = await start(deps);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(seq, ['wait', 'detect', 'record', 'refusal', 'cover'],
      'wait -> detect -> record -> check -> cover. setTimezoneOverride changes what the renderer '
      + 'reports, so a lookup taken after it agrees with itself and means nothing');
    assert.ok(seq.indexOf('detect') < seq.indexOf('cover'), 'stated again on its own, because this is the whole invariant');
  });

  test('the browser is covered from what was MEASURED, and only then sent to Reddit', async () => {
    const { deps, calls } = harness();
    const r = await start(deps);
    assert.equal(r.ok, true);
    assert.equal(calls.covered.length, 1);
    const c = calls.covered[0];
    assert.equal(c.timezone, 'America/Los_Angeles', 'the zone is the measured one, verbatim');
    assert.equal(c.locale, 'en-US', 'and the locale is built from the DETECTED country code');
    assert.equal(c.openUrl, LOGIN, 'Reddit is where it goes LAST, after it is covered');
    assert.equal(r.locale, 'en-US');
    assert.equal(r.pagesAligned, 2, 'a hook that never fired must stay visible');
  });

  test('an UNPROXIED browser is covered too — the fence is no longer proxy-only', async () => {
    /* A deliberate behaviour change, not a side effect. alignBrowser installs webrtcFence on the
       browser CONTEXT, and that fence has until now reached proxied browsers only. On this
       machine account_proxies holds zero rows, so before this it reached nothing at all. */
    const { deps, calls } = harness();
    const r = await start(deps, { exit: null, proxied: false });
    assert.equal(r.ok, true);
    assert.equal(calls.covered.length, 1, 'an unproxied browser gets the same covering as a proxied one');
    assert.equal(calls.covered[0].openUrl, LOGIN,
      'and it too is spawned blank and navigated afterwards, rather than starting on Reddit');
  });

  /* ---------------------------------------------------------------- *
   * The two checks, and which value each is fed
   * ---------------------------------------------------------------- */

  test('the alignment check is fed the DETECTED country, never the exit record\'s', async () => {
    /* The exit record says GB. The browser says US. The check must be asked about US — the old
       call passed `exit.proxy.country` from the database, which could only ever catch a typing
       mistake, because both of its inputs were stored values. */
    const { deps, calls } = harness();
    await start(deps, { exit: exitIn('GB', 'London'), proxied: true });

    assert.equal(calls.refusal.length, 1, 'the check still runs — it is defence in depth, not dead weight');
    const [handle, timezone, country, region] = calls.refusal[0];
    assert.equal(handle, 'probe');
    assert.equal(timezone, 'America/Los_Angeles', 'the MEASURED zone');
    assert.equal(country, 'US', 'the MEASURED country');
    assert.notEqual(country, 'GB', 'and emphatically NOT the one on the exit record');
    assert.equal(region, 'California', 'the measured region too, so the sentence names a real place');
  });

  test('a browser reporting a different country from its vetted exit is refused and closed', async () => {
    /* This is the check the previous one CANNOT be. With both of its inputs measured, the
       alignment check can only test the provider's answer for self-consistency. Comparing the
       measurement against the exit record is what catches a browser going around its own proxy —
       which from Node is indistinguishable from one going through it. */
    const { deps, calls } = harness();
    const r = await start(deps, { exit: exitIn('GB', 'London'), proxied: true });

    assert.equal(r.ok, false, 'two instruments describing different places is a reason to stop');
    assert.equal(r.closed, true);
    assert.equal(calls.covered.length, 0, 'it never reached Reddit');
    assert.match(r.error, /vetted in GB/, 'the sentence names what was paid for');
    assert.match(r.error, /is in US/, 'and what was measured');
    assert.match(r.error, /San Jose/, 'and where, because that is what makes it actionable');
  });

  test('when the exit and the measurement AGREE, the launch proceeds', async () => {
    const { deps, calls } = harness();
    const r = await start(deps, { exit: exitIn('US', 'California'), proxied: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(calls.covered.length, 1);
    assert.equal(calls.closed, 0, 'a good launch closes nothing');
  });

  test('an exit record with no country does not manufacture a refusal', async () => {
    /* 0016 allows a proxy row with no country. Comparing against a blank would refuse every such
       account for a field nobody filled in, which is a different failure from a mismatch. */
    const { deps } = harness();
    const r = await start(deps, { exit: exitIn(null, null), proxied: true });
    assert.equal(r.ok, true, 'unknown is not a mismatch');
  });

  test('a refusal from the alignment check itself closes the browser and is passed through', async () => {
    const { deps, calls } = harness({ refusal: () => 'probe announces a zone that is not in its country.' });
    const r = await start(deps);
    assert.equal(r.ok, false);
    assert.equal(r.closed, true);
    assert.equal(calls.covered.length, 0);
    assert.equal(r.error, 'probe announces a zone that is not in its country.',
      'the check owns its own wording — this must not rewrite it');
  });

  /* ---------------------------------------------------------------- *
   * The seam: a real detection, through the real writer, into the real table
   * ---------------------------------------------------------------- */

  test('a successful detection is PERSISTED, and the stored row reads back whole', async () => {
    /**
     * The test that would have caught all three contract breaks. It uses the REAL
     * `recordAccountDetection` and the REAL `account_locations`, because every one of `via`, `ip`
     * and `country` was invisible to the compiler and to both existing suites — the two halves
     * were only ever exercised apart.
     */
    const handle = 'start-probe-ok';
    await forget(handle);
    const made = await accounts.createConsoleAccount({ handle, role: 'Support', speaks: '', subreddits: [] });
    assert.equal(made.ok, true, JSON.stringify(made));

    const { deps } = harness({ record: (h, d) => accounts.recordAccountDetection(h, d) });
    const r = await startAlignedBrowser(deps, {
      endpoint: ENDPOINT, account: { handle }, exit: null, proxied: false
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.recorded.timezone, 'America/Los_Angeles');
    assert.ok(r.recorded.locationId > 0, 'the evidence row must be identified back to the caller');

    const row = await locs.latestAccountLocation(db.getPool(), handle);
    assert.ok(row, 'the detection must be retrievable — this is the round trip that was never made');

    assert.equal(row.timezone, 'America/Los_Angeles');
    assert.equal(row.ip, '203.0.113.166');
    assert.equal(row.countryCode, 'US');
    assert.equal(row.regionName, 'California');
    assert.equal(row.city, 'San Jose');
    assert.equal(row.offsetSeconds, -25200);
    assert.equal(row.proxy, true, 'true is not null');
    assert.equal(row.hosting, true);

    /* CONTRACT BREAK 1 — `via` is the OCCASION, and the enum accepts it. */
    assert.equal(row.via, 'launch',
      'the closed domain shared with account_exit_ips, so the two ledgers read side by side');

    /* CONTRACT BREAK 2 — the TRANSPORT survives, in its own column, un-truncated. */
    assert.match(row.transport, /renderer fetch of ip-api\.com from a local http origin/,
      'the route the measurement travelled — the property the whole detection turns on');
    assert.notEqual(row.transport, row.via, 'two questions, two answers, two columns');

    /* CONTRACT BREAK 3 — `country` used to be measured and silently dropped. */
    assert.equal(row.country, 'United States',
      'the full name the detector measures — it had nowhere to go, and no error said so');

    /* And the column moved in the same transaction: the row is the evidence FOR the column. */
    const col = await db.getPool().query(
      'SELECT timezone FROM accounts WHERE lower(handle) = lower($1)', [handle]);
    assert.equal(col.rows[0].timezone, 'America/Los_Angeles',
      'an account that was unschedulable is schedulable again — that is what makes 0018 survivable');
  });

  test('a detection with NO ip is still a detection, and still stores', async () => {
    /* The `ip` decision, asserted rather than described. The provider record that produces this is
       one carrying a good zone and a good country but no `query`. Under the original NOT NULL
       column it refused — and on the launch path a refusal means declining to open a browser over
       a corroborating field nothing downstream reads. */
    const handle = 'start-probe-noip';
    await forget(handle);
    await accounts.createConsoleAccount({ handle, role: 'Support', speaks: '', subreddits: [] });

    const { deps } = harness({
      detect: async () => ({ ...MEASURED, ip: null }),
      record: (h, d) => accounts.recordAccountDetection(h, d)
    });
    const r = await startAlignedBrowser(deps, {
      endpoint: ENDPOINT, account: { handle }, exit: null, proxied: false
    });
    assert.equal(r.ok, true, `a zone was measured, so this is a detection: ${JSON.stringify(r)}`);

    const row = await locs.latestAccountLocation(db.getPool(), handle);
    assert.equal(row.ip, null, 'null says "not attributable", and says it visibly');
    assert.equal(row.timezone, 'America/Los_Angeles', 'while the thing that WAS measured is kept');
  });
});
