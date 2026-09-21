/**
 * What the browser says about where it is — the rules, without a browser.
 *
 * `detectFromBrowser` needs a real Chrome and is proven by a run; everything it DECIDES about a
 * provider's answer is pure and is decided here, against fixed records rather than the internet.
 * Same split as `judgeGeo` in vet.ts, and for the same reason: the parsing rules are the part
 * most likely to be got wrong, and they must not need a live provider to exercise.
 *
 * The load-bearing one is the refusal. A location record with no timezone is the shape that would
 * let a browser announce one part of the world from an address in another — so it is not a record
 * with a gap in it, it is not a record at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { parseGeoRecord, DetectionError, detectFromBrowser, locationFromBody } =
  await import('../proxy/detect.js');
const { timezoneMatchesCountry } = await import('../proxy/align.js');

/** Measured from the box this was built on, 2026-09-21, through the live free tier. */
const SAN_JOSE = {
  status: 'success',
  query: '203.0.113.166',
  country: 'United States',
  countryCode: 'US',
  region: 'CA',
  regionName: 'California',
  city: 'San Jose',
  timezone: 'America/Los_Angeles',
  offset: -25200,
  isp: 'Datacamp Limited',
  org: 'CDN77',
  as: 'AS60068 Datacamp Limited',
  asname: 'DATACAMP',
  mobile: false,
  proxy: true,
  hosting: true,
  reverse: 'unn-149-22-84-166.datapacket.com'
};

const AT = '2026-09-21T00:00:00.000Z';

/* ------------------------------------------------------------------ *
 * A full success record maps, field for field
 * ------------------------------------------------------------------ */

test('every field of a real success record arrives, with the timezone intact', () => {
  const loc = parseGeoRecord(SAN_JOSE, AT);
  assert.ok(loc, 'a success record with a timezone must parse');
  assert.equal(loc.at, AT, 'the timestamp is the one injected, so this test has no clock');
  assert.equal(loc.ip, '203.0.113.166');
  assert.equal(loc.countryCode, 'US');
  assert.equal(loc.country, 'United States');
  assert.equal(loc.regionName, 'California');
  assert.equal(loc.city, 'San Jose');
  assert.equal(loc.timezone, 'America/Los_Angeles', 'the IANA string, straight from the provider');
  assert.equal(loc.offsetSeconds, -25200, 'the offset is a number of seconds, not a string');
  assert.equal(loc.proxy, true);
  assert.equal(loc.hosting, true);
  assert.match(loc.via, /ip-api/i, 'how it was obtained, so a wrong answer is debuggable');
});

test('the offset survives being zero — 0 is a value, not a missing field', () => {
  /* The bug this pins: `raw.offset || null` reads UTC as "no offset". London in winter is 0. */
  const loc = parseGeoRecord({ ...SAN_JOSE, timezone: 'Europe/London', countryCode: 'GB', offset: 0 }, AT);
  assert.ok(loc);
  assert.equal(loc.offsetSeconds, 0, 'zero is an offset, not an absence');
});

/* ------------------------------------------------------------------ *
 * FAIL CLOSED — a record that cannot be established is not a record
 * ------------------------------------------------------------------ */

test('a lookup the provider itself reports as failed is null, never a shrug', () => {
  assert.equal(parseGeoRecord({ status: 'fail', message: 'reserved range' }, AT), null);
  assert.equal(parseGeoRecord({ status: 'fail', message: 'private range' }, AT), null);
});

test('a NON-success status is refused on its own, not by some other field being absent', () => {
  /* Written after a mutation survived. The two cases above are shaped like a real ip-api
     failure — which carries no timezone — so deleting the status check entirely left them
     both still passing, killed by the timezone guard instead. These records are complete in
     every other respect, so the ONLY thing that can refuse them is the status itself. */
  assert.equal(parseGeoRecord({ ...SAN_JOSE, status: 'fail', message: 'reserved range' }, AT), null);
  assert.equal(parseGeoRecord({ ...SAN_JOSE, status: 'error' }, AT), null);
  assert.equal(parseGeoRecord({ ...SAN_JOSE, status: 'SUCCESS' }, AT), null, 'the provider writes it lower case');
  const { status, ...noStatus } = SAN_JOSE;
  assert.equal(status, 'success', 'the fixture really did have one to remove');
  assert.equal(parseGeoRecord(noStatus, AT), null, 'no status at all is not a success');
});

test('a success record with NO timezone is null — the missing field is the whole point', () => {
  /* This is the fail-closed choice, and it is deliberate. The timezone is what this detection
     exists to obtain: without it nothing downstream can tell whether the browser's announced
     zone contradicts the address, and a record carrying `timezone: null` would travel as an
     answer. A refusal cannot be mistaken for one. */
  const { timezone, ...noZone } = SAN_JOSE;
  assert.equal(timezone, 'America/Los_Angeles', 'the fixture really did have one to remove');
  assert.equal(parseGeoRecord(noZone, AT), null, 'no timezone, no record');
  assert.equal(parseGeoRecord({ ...SAN_JOSE, timezone: '' }, AT), null, 'empty string is not a zone');
  assert.equal(parseGeoRecord({ ...SAN_JOSE, timezone: 123 }, AT), null, 'a number is not a zone');
});

test('a success record with NO countryCode is null — the other half of the invariant', () => {
  /* timezoneMatchesCountry needs both sides. One without the other answers `unknown`, and an
     `unknown` that arrived as a successful detection is the reading this refuses to produce. */
  const { countryCode, ...noCountry } = SAN_JOSE;
  assert.equal(parseGeoRecord(noCountry, AT), null);
  assert.equal(parseGeoRecord({ ...SAN_JOSE, countryCode: 'USA' }, AT), null, 'a country code is two letters');
});

test('garbage is null and does not throw — the parser is a gate, not a hazard', () => {
  for (const junk of ['a string', null, undefined, [], [SAN_JOSE], {}, 42, true, 'null']) {
    assert.equal(parseGeoRecord(junk, AT), null, `${JSON.stringify(junk)} must parse to null`);
  }
});

/* ------------------------------------------------------------------ *
 * The invariant the whole change buys
 * ------------------------------------------------------------------ */

test('a detected US location agrees with itself — timezone and country match', () => {
  /* This is the reason for the change. Before it, the zone was picked from a curated city table
     and the country came from the provider, so the two could disagree with nobody noticing. Now
     both come from the same record, and that record has to be self-consistent or it is wrong. */
  const loc = parseGeoRecord(SAN_JOSE, AT);
  assert.ok(loc);
  assert.equal(timezoneMatchesCountry(loc.timezone, loc.countryCode), 'yes');
});

/* ------------------------------------------------------------------ *
 * The error type
 * ------------------------------------------------------------------ */

test('DetectionError is its own type and names what failed', () => {
  const e = new DetectionError('the page never answered');
  assert.ok(e instanceof Error);
  assert.ok(e instanceof DetectionError, 'catchable by type, not by string matching');
  assert.equal(e.name, 'DetectionError');
  assert.match(e.message, /never answered/);
});

/* ------------------------------------------------------------------ *
 * detectFromBrowser — the fail-closed edge, without touching the internet
 *
 * The live measurement belongs to a run against a real browser. What is asserted here is the
 * property that must hold when there is NOTHING to measure: it refuses, it names where it was
 * looking, and it leaves nothing behind. Reaching the network from the unit suite would make
 * these tests fail for weather.
 * ------------------------------------------------------------------ */

/** Listeners this process is holding open. The local http origin is one of these while it lives. */
const listeners = () => process.getActiveResourcesInfo().filter((r) => r === 'TCPSERVERWRAP').length;

test('with no browser at the endpoint it refuses, and says which endpoint it tried', async () => {
  /* Port 1 is not something a debuggable Chrome is on. A refusal is the only correct outcome —
     the alternative, a location assembled from anywhere else, is the defect this module removes. */
  await assert.rejects(
    () => detectFromBrowser({ endpoint: 'http://127.0.0.1:1', handle: 'nobody', timeoutMs: 2000 }),
    (e: unknown) => e instanceof Error && /127.0.0.1:1/.test(e.message),
    'it must reject, naming the endpoint, rather than resolve to a guess'
  );
});

test('a failed detection leaves no listener behind', async () => {
  /* The local http origin is started BEFORE the browser is attached, so the throw path above runs
     with a listener already open. If it is not closed in a finally it outlives the run, and the
     next detection inherits a process quietly accumulating sockets. */
  const before = listeners();
  await assert.rejects(() => detectFromBrowser({ endpoint: 'http://127.0.0.1:1', handle: 'nobody', timeoutMs: 2000 }));
  assert.equal(listeners(), before, 'the local origin must be closed on the throw path too');
});

/* ------------------------------------------------------------------ *
 * locationFromBody — the refusal, proven without a browser
 *
 * These exist because a mutation survived. Replacing the throw in this decision with a returned
 * "US / America/Los_Angeles" passed the whole suite: every test that reached the decision needed
 * a live Chrome to get there, so none did. The one promise this module makes — that it never
 * assumes a location — was the one thing not under test.
 * ------------------------------------------------------------------ */

const WHERE = 'acct @ http://127.0.0.1:9222';

test('a success body becomes a location, and via names the TRANSPORT not just the provider', () => {
  const loc = locationFromBody(JSON.stringify(SAN_JOSE), WHERE, AT);
  assert.equal(loc.timezone, 'America/Los_Angeles');
  assert.equal(loc.countryCode, 'US');
  assert.equal(loc.city, 'San Jose');
  assert.equal(loc.at, AT);
  assert.match(loc.via, /renderer fetch/i, 'how it was obtained — a wrong answer must be debuggable');
  assert.match(loc.via, /local http origin/i, 'the local origin is load-bearing, so it is recorded');
  assert.match(loc.via, /acct/, 'and which account it was measured for');
});

test('a refused record THROWS and never returns an assumed location', () => {
  /* The mutation this kills returns a plausible US record here. Asserting "it throws" is the
     whole point: any returned value at all, however sensible, is the failure. */
  const noZone = { ...SAN_JOSE };
  delete (noZone as Record<string, unknown>).timezone;
  for (const body of [JSON.stringify(noZone), JSON.stringify({ status: 'fail', message: 'reserved range' })]) {
    assert.throws(
      () => locationFromBody(body, WHERE, AT),
      (e: unknown) => e instanceof DetectionError,
      'a record that cannot be read must raise, not resolve'
    );
  }
});

test('the refusal names the field or the provider message, never a shrug', () => {
  const noZone = { ...SAN_JOSE };
  delete (noZone as Record<string, unknown>).timezone;
  assert.throws(() => locationFromBody(JSON.stringify(noZone), WHERE, AT), /timezone/i);
  assert.throws(() => locationFromBody(JSON.stringify({ status: 'fail', message: 'reserved range' }), WHERE, AT),
    /reserved range/);
});

test('the body the DEAD navigation route returns is refused, not read as a location', () => {
  /* Verbatim from the measurement that killed the top-level-navigation transport: Chrome upgrades
     the http URL to https, ip-api answers https with a valid 403, and this is the body. It is
     well-formed JSON and it is not a location — exactly the shape that would slip through a
     parser checking only that the bytes parse. */
  const ssl = '{"status":"fail","message":"SSL unavailable for this endpoint, order a key at https://members.ip-api.com/"}';
  assert.throws(() => locationFromBody(ssl, WHERE, AT),
    (e: unknown) => e instanceof DetectionError && /SSL unavailable/.test((e as Error).message));
});

test('a body that is not JSON at all is refused, and quoted back', () => {
  assert.throws(() => locationFromBody('<html><body>502 Bad Gateway</body></html>', WHERE, AT),
    (e: unknown) => e instanceof DetectionError && /was not JSON/.test((e as Error).message));
  assert.throws(() => locationFromBody('', WHERE, AT), /\(empty\)/);
});

/* ------------------------------------------------------------------ *
 * The transport, guarded at the source
 *
 * The two dead routes cannot be caught by a unit test: both are properties of which NETWORK PATH
 * the request takes, and that is only observable against a real browser behind a real proxy.
 * Measured, a direct navigation is upgraded to https and 403s, and context.request issues from
 * Node and silently bypasses the browser's upstream — returning a confident answer about the
 * WRONG MACHINE. Neither shows up as a failing assertion here; the second does not even fail.
 *
 * So the shape is pinned in the source instead. This is a guard against a future simplification,
 * not a test of behaviour, and it is labelled as such. Source-text assertions are established
 * practice in this suite (see dependencies, cli, tokens).
 * ------------------------------------------------------------------ */

/**
 * The two shapes that mean "this went through Playwright's APIRequestContext", which is DEAD
 * ROUTE 2 however it is spelled.
 *
 * Named and shared so the guard below and the test of the guard cannot drift apart — a guard
 * proven against one regex and applied with another proves nothing.
 *
 *   `call`  the request object is reached as a `.request` PROPERTY and then used. That holds for
 *           `page.context().request.get(...)`, for `context.request.get(...)` and for any alias,
 *           because the property name is part of Playwright's API and the variable name is not.
 *
 *           IT NAMES NOTHING AFTER THE PROPERTY. It used to require one of get/post/put/patch/
 *           delete/head/fetch, and a closed list of method names is the same narrowness that let
 *           the first three spellings through one level up: `playwright.request.newContext(...)`
 *           is a `.request` property access whose method is on nobody's verb list.
 *
 *           Widening it to "any method call on .request" was still too narrow, and this was
 *           caught reviewing the widening itself rather than by the suite. `const r = page.request;`
 *           followed later by `r.get(GEO_URL)` has no `.` after `request` at all, so a pattern
 *           requiring one missed it, exactly as the verb list missed `newContext`. Each fix had
 *           pinned one more character of a SHAPE when the thing being guarded is a NAME. So this
 *           now matches the bare property and stops there.
 *
 *   `reach` the precursor, for the form that takes the alias first and calls it later, or hands
 *           the request object on under a name with no `.request` left at the call site.
 *           `detectFromBrowser` gets its page from `attach()` and has never needed the
 *           BrowserContext, so reaching for one in this file is itself the signal.
 *
 *   `create` the standalone factory, which has NO `.request` and NO `.context()` anywhere near
 *           the call that fetches. `import { request } from 'playwright'` then
 *           `request.newContext()` hands back an APIRequestContext under any name the author
 *           likes, and `c.get(GEO_URL)` is then indistinguishable from an ordinary method call.
 *           `newContext(` is the chokepoint: every route to an APIRequestContext that is not a
 *           `.request` property goes through it, so it is the one token that cannot be spelled
 *           around. It also covers `browser.newContext()`, deliberately — detectFromBrowser works
 *           on an ATTACHED page and has no business creating a context of any kind, which is the
 *           same argument `reach` already makes for asking for one.
 */
const DEAD_ROUTE_2 = {
  call:   /\.\s*request\b/i,
  reach:  /\.\s*context\s*\(\s*\)/,
  create: /\bnewContext\s*\(/
};

test('detection still fetches from a LOCAL ORIGIN and neither of the two dead routes', () => {
  const src = readFileSync(join(process.cwd(), 'src/proxy/detect.ts'), 'utf8');
  /* CODE ONLY. The comments in that file NAME both dead routes in order to warn about them,
     so asserting against the raw text matches the warning and calls it the defect. A grep for
     a name is not a measurement of the behaviour. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.match(code, /page\.goto\(origin,/,
    'the tab must be pointed at the local http origin — that origin is the only reason the fetch is not mixed-content blocked');

  assert.doesNotMatch(code, /page\.goto\(\s*GEO_URL/,
    'DEAD ROUTE 1: a top-level navigation to the http geo URL is upgraded to https by Chrome and answered 403. Measured — do not restore it.');

  for (const [what, re] of Object.entries(DEAD_ROUTE_2)) {
    assert.doesNotMatch(code, re,
      `DEAD ROUTE 2 (${what}): an APIRequestContext issues from Node, does not inherit the `
      + 'browser upstream, and reports the HOST location as if it were the exit. Measured — it '
      + 'returns 200, which is what makes it dangerous.');
  }
});

/**
 * The guard's own coverage, which is not the same claim as the guard passing.
 *
 * WHY THIS TEST EXISTS. The assertion above used to be `/context\.request/`, and it caught one
 * spelling in three. `detectFromBrowser` works entirely on `session.page` and there is no variable
 * named `context` anywhere in detect.ts — so the only form the old regex could catch was the one
 * least likely to be written, and the two idiomatic forms restored the dead route in silence.
 *
 * Measured by putting each spelling back into src/proxy/detect.ts as live, type-correct code and
 * running this suite:
 *
 *   session.page.context().request.get(GEO_URL)          old guard PASSED — 17/17 green
 *   const context = page.context(); context.request.get  old guard fired
 *   const ctx = page.context(); ctx.request.get(...)     old guard PASSED — 17/17 green
 *
 * A guard is a claim about what it would catch, and that claim is testable without touching the
 * file it guards. The regexes are shared with the test above, so the thing proven here is the
 * thing applied there.
 *
 * IT NARROWED A SECOND TIME, one alias further out, and the same way: by pinning a shape rather
 * than the thing being guarded. `reach` required a literal `.context()` and `call` required one
 * of seven verb names, so a FOURTH spelling walked past both while the suite read 18/18 green:
 *
 *   const { request } = await import('playwright');
 *   const c = await request.newContext();
 *   await c.get(GEO_URL);
 *
 * There is no `.context()` in it and no `.request` at the call site — the factory is imported by
 * name and the context is held under one. Measured the same way as the first three: put back into
 * src/proxy/detect.ts as live, type-correct code, suite run, guard silent.
 *
 * So the guard now matches the CHOKEPOINT instead of the spelling. Every way of obtaining an
 * APIRequestContext is either a `.request` property or a `newContext(` call, and both are names
 * Playwright's API fixes rather than names an author chooses.
 */
test('the guard catches every spelling of the dead route, not just the unlikely one', () => {
  const caught = (text: string) => Object.values(DEAD_ROUTE_2).some((re) => re.test(text));

  assert.ok(caught('const r = await session.page.context().request.get(GEO_URL);'),
    'the idiomatic form: reached straight off the page, no intermediate variable at all');
  assert.ok(caught('const context = session.page.context();\nconst r = await context.request.get(GEO_URL);'),
    'the form the old regex caught — kept, because a fix must not trade one spelling for another');
  assert.ok(caught('const ctx = session.page.context();\nconst r = await ctx.request.get(GEO_URL);'),
    'the same thing under any other name — the name was never the property being guarded');

  /* THE FOURTH SPELLING, which passed the guard this test used to describe as complete. */
  assert.ok(caught("const { request } = await import('playwright');\n"
                   + 'const c = await request.newContext();\nawait c.get(GEO_URL);'),
    'the standalone factory: no .context(), and no .request at the call site');

  /* And the one the verb list let through, which is the same hole a level up: a `.request`
     property whose method simply was not on a list of seven. */
  assert.ok(caught('const c = await playwright.request.newContext();\nawait c.get(GEO_URL);'),
    'a .request property access is caught whatever method is called on it');

  /* THE FIFTH: the property is taken on one line and used on another, so there is no method
     call attached to it to match. Found by reviewing the fourth fix, not by the suite — which is
     the whole reason this guard is matched against a NAME and not against a shape. */
  assert.ok(caught('const r = session.page.request;\nconst res = await r.get(GEO_URL);'),
    'the property taken alone, used later — no method call attached to match against');
  assert.ok(caught("const r = session.page.request;\nconst res = await r['get'](GEO_URL);"),
    'and the same thing through bracket notation, which no dot-pattern would ever see');

  /* And it must not fire on what detect.ts actually does, or it would be unfalsifiable. */
  assert.ok(!caught('const res = await fetch(url, { signal: AbortSignal.timeout(ms) });'),
    'a renderer fetch is the CORRECT transport and must not be flagged');
  assert.ok(!caught('await session.page.goto(origin, { waitUntil: \'domcontentloaded\' });'),
    'pointing the tab at the local origin is the whole design and must not be flagged');

  /* The widened regexes must still be falsifiable. A guard that fires on everything would make
     the assertions above pass while proving nothing at all about what it discriminates. */
  assert.ok(!caught('const cdp = await context.newCDPSession(page);'),
    'a CDP session is not an APIRequestContext — newCDPSession must not be swept up by newContext');
  assert.ok(!caught('const res = await page.evaluate(() => fetch(url).then((r) => r.text()));'),
    'a renderer fetch inside evaluate is the CORRECT transport');
  assert.ok(!caught('const n = results.requests.length;'),
    'a word merely STARTING with request is not the property — the boundary has to hold');
});
