/**
 * The half a proxy cannot do — the rules, without a browser.
 *
 * `alignBrowser` needs a real Chrome and is proven by a run; everything it DECIDES is pure and is
 * decided here. The load-bearing one is the refusal: a browser announcing one part of the world
 * from an address in another is a stronger signal than not proxying at all, so a timezone that
 * does not match the exit must stop the launch rather than warn about it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { timezoneMatchesCountry, alignmentRefusal, usZoneForCity, webrtcFence, AlignmentError } =
  await import('../proxy/align.js');

/* ------------------------------------------------------------------ *
 * Country <-> timezone, from the runtime's own IANA data
 * ------------------------------------------------------------------ */

test('a US timezone matches a US exit', () => {
  assert.equal(timezoneMatchesCountry('America/New_York', 'US'), 'yes');
  assert.equal(timezoneMatchesCountry('America/Los_Angeles', 'US'), 'yes');
  assert.equal(timezoneMatchesCountry('America/Chicago', 'us'), 'yes', 'the country is compared case-insensitively');
});

test('the timezone this repo ships by default does NOT match a US exit', () => {
  /* The state both existing accounts are in: Asia/Manila. This is the case the refusal exists
     for, and it is the default, so it must be the loudest test in the file. */
  assert.equal(timezoneMatchesCountry('Asia/Manila', 'US'), 'no');
});

test('a missing or malformed input is unknown, never a confident answer', () => {
  assert.equal(timezoneMatchesCountry(null, 'US'), 'unknown');
  assert.equal(timezoneMatchesCountry('America/New_York', null), 'unknown');
  assert.equal(timezoneMatchesCountry('America/New_York', 'USA'), 'unknown', 'a country code is two letters');
  assert.equal(timezoneMatchesCountry('America/New_York', 'ZZ'), 'unknown', 'a country the runtime does not know');
});

/* ------------------------------------------------------------------ *
 * City -> US IANA zone, the suggestion the exit form copies into the account timezone
 * ------------------------------------------------------------------ */

test('the US cities Webshare actually returned resolve to the right zone', () => {
  /* The three cities in the live /proxy/list/ pull this feature was built against, so the mapping
     is pinned to real data rather than a plausible-looking table. */
  assert.equal(usZoneForCity('Seattle'), 'America/Los_Angeles');
  assert.equal(usZoneForCity('Los Angeles'), 'America/Los_Angeles');
  assert.equal(usZoneForCity('Piscataway'), 'America/New_York');
});

test('a zone the suggestion produces is one a US exit accepts — the two must agree', () => {
  /* The whole point is that the copied timezone then passes alignment. If usZoneForCity ever
     suggested a zone timezoneMatchesCountry rejects, the operator would copy a value that fails
     the launch check — so this asserts the round-trip, not just the lookup. */
  for (const city of ['Seattle', 'Los Angeles', 'Piscataway', 'Chicago', 'Denver', 'Phoenix', 'Honolulu']) {
    const zone = usZoneForCity(city);
    assert.ok(zone, `${city} should resolve`);
    assert.equal(timezoneMatchesCountry(zone, 'US'), 'yes', `${city} -> ${zone} must match a US exit`);
  }
});

test('Phoenix is Arizona time, not Denver — the no-DST zone is distinct', () => {
  assert.equal(usZoneForCity('Phoenix'), 'America/Phoenix');
});

test('an unknown or ambiguous city returns null, never a guessed default', () => {
  assert.equal(usZoneForCity('Nowheresville'), null, 'unknown city');
  assert.equal(usZoneForCity(''), null);
  assert.equal(usZoneForCity(null), null);
  assert.equal(usZoneForCity(undefined), null);
  /* Ambiguous across zones — deliberately omitted so it falls to null rather than a coin-flip. */
  assert.equal(usZoneForCity('Portland'), null, 'Portland OR (Pacific) vs Portland ME (Eastern)');
  assert.equal(usZoneForCity('Arlington'), null, 'Arlington VA (Eastern) vs Arlington TX (Central)');
});

test('city matching is case- and whitespace-insensitive and ignores a trailing state', () => {
  assert.equal(usZoneForCity('  los   ANGELES '), 'America/Los_Angeles');
  assert.equal(usZoneForCity('Seattle, WA'), 'America/Los_Angeles');
});

/* ------------------------------------------------------------------ *
 * What the launch path does with that
 * ------------------------------------------------------------------ */

test('a matching timezone raises no refusal', () => {
  assert.equal(alignmentRefusal('Acct', 'America/New_York', 'US', 'New York'), null);
});

test('a contradicting timezone refuses, and names both sides plus the fix', () => {
  const r = alignmentRefusal('Striking_Mousse6841', 'Asia/Manila', 'US', 'New York');
  assert.ok(r, 'Asia/Manila behind a US exit must not be allowed to launch');
  assert.match(r, /Asia\/Manila/, 'it must say what the timezone is');
  assert.match(r, /New York, US/, 'and where the exit actually is');
  assert.match(r, /Accounts screen/, 'and where to change it');
});

test('a timezone that cannot be checked is refused too — unverified is not verified', () => {
  const r = alignmentRefusal('Acct', undefined, 'US', 'New York');
  assert.ok(r);
  assert.match(r, /could not confirm/i);
});

/* ------------------------------------------------------------------ *
 * The fence itself
 * ------------------------------------------------------------------ */

test('the fence leaves the constructor in place and makes it throw', () => {
  /* Run the init script against a stand-in `window`, the way a document would. A `delete` would
     be trivially detectable AND rarer than a working WebRTC — so "still there, refuses" is the
     shape, and this asserts it rather than trusting the comment. */
  const win: Record<string, unknown> = { RTCPeerConnection: function Real() { /* the real one */ } };
  const g = globalThis as unknown as { window?: unknown; DOMException?: unknown };
  const hadWindow = 'window' in g;
  const priorWindow = g.window;
  const priorDom = g.DOMException;
  class FakeDomException extends Error {
    constructor(message: string, public readonly code: string) { super(message); this.name = code; }
  }
  g.window = win;
  if (typeof priorDom !== 'function') g.DOMException = FakeDomException;

  try {
    webrtcFence();
    assert.equal(typeof win.RTCPeerConnection, 'function',
                 'the name must survive — a browser with no WebRTC at all is itself a signal');
    assert.throws(() => { new (win.RTCPeerConnection as new () => unknown)(); },
                  /not available/i, 'constructing one must be refused');
  } finally {
    if (hadWindow) g.window = priorWindow; else delete g.window;
    if (typeof priorDom !== 'function') delete g.DOMException;
  }
});

test('AlignmentError is its own type, so a caller can tell it from a network fault', () => {
  assert.ok(new AlignmentError('x') instanceof Error);
  assert.equal(new AlignmentError('x').name, 'AlignmentError');
});
