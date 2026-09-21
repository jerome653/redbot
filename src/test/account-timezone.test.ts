import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * WHAT THIS PINS: `accounts.timezone` is a record of a measurement, and nothing types it.
 *
 * It used to be hand-typed configuration with a hardcoded fallback — an empty field became
 * 'Asia/Manila' — and it is what the browser ANNOUNCES, because src/proxy/align.ts drives
 * `Emulation.setTimezoneOverride` from it.
 *
 * NO HEADCOUNT HERE, for the reason 0018's header gives at length: it rotted twice inside that
 * header while the header was being written, and a file arguing "measure it, do not assume it"
 * must not itself carry an unmeasured claim. The property that does not turn on a count is the
 * one worth pinning — EVERY zone in both stores was typed or defaulted, not one of them had an
 * `account_locations` row behind it, and all of them named a zone on the far side of the world
 * from the exit the machine egresses through. That was true of one account and it is true of
 * however many exist the day you read this, because it is a statement about where the values
 * CAME FROM rather than about how many there are.
 *
 * Four rules, and each is asserted against the DATABASE and not only the returned object:
 *
 *   - creating an account without a timezone leaves the column NULL, never a guess;
 *   - creating one WITH a timezone leaves the column NULL too, and says so through `ignored`;
 *     the fallback's removal left a conditional spread behind that still accepted a typed value,
 *     so create wrote what update refused and only update was tested;
 *   - an update naming `timezone` is REFUSED and SAYS SO through `ignored`, rather than being
 *     silently dropped — a form that posts a field and gets a cheerful 200 has taught the person
 *     something false about what was saved;
 *   - a detection is the one thing that writes it, and it writes the evidence in the same breath.
 *
 * Runs against the shared test database (REDBOT_DB, set by npm test) with its own temporary DATA
 * directory for the seed file, and scopes every assertion to its own handles.
 */
describe('a timezone is measured, not typed', () => {
  let DATA: string;
  let mod: typeof import('../console-accounts.js');
  let db: typeof import('../db.js');
  let win: typeof import('../window.js');
  let locs: typeof import('../db/locations.js');

  const zoneOf = async (handle: string): Promise<string | null> => {
    const r = await db.getPool().query<{ timezone: string | null }>(
      'SELECT timezone FROM accounts WHERE lower(handle) = lower($1)', [handle]
    );
    assert.equal(r.rows.length, 1, `${handle} should be exactly one row`);
    return r.rows[0]!.timezone;
  };

  const seedEntry = (handle: string): Record<string, unknown> | undefined => {
    const p = join(DATA, 'accounts.json');
    if (!existsSync(p)) return undefined;
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as { accounts: Record<string, unknown>[] };
    return parsed.accounts.find((a) => String(a.handle).toLowerCase() === handle.toLowerCase());
  };

  before(async () => {
    DATA = mkdtempSync(join(tmpdir(), 'redbot-tz-'));
    process.env.REDBOT_DATA = DATA;
    /* REDBOT_DB is left exactly as npm test set it: this file needs the DATABASE, because the
       whole claim is about a column, and a seed-file-only run could not see it. */
    mod = await import('../console-accounts.js');
    db = await import('../db.js');
    win = await import('../window.js');
    locs = await import('../db/locations.js');
    assert.equal(db.dbUnavailableReason(), null, 'this file is meaningless without the database');
  });

  after(() => { rmSync(DATA, { recursive: true, force: true }); });

  /* ---------------------------------------------------------------- *
   * Create
   * ---------------------------------------------------------------- */

  test('creating an account with NO timezone leaves the column NULL, not Asia/Manila', async () => {
    const made = await mod.createConsoleAccount({
      handle: 'tz-probe-one', role: 'Support', speaks: '', subreddits: []
    });
    assert.equal(made.ok, true, JSON.stringify(made));
    assert.equal(made.storedIn, 'database', 'the assertion below is about a column, so it must have been written');

    /* The column. This is the load-bearing one — the record could lie, the row cannot. */
    assert.equal(await zoneOf('tz-probe-one'), null,
      'an account nobody has measured must have NO zone; a guessed one is announced to Reddit');

    /* And the returned record says the same thing rather than carrying a default home. */
    assert.equal(made.account!.timezone, undefined, 'absent is how this codebase spells "no zone"');
    assert.notEqual(made.account!.timezone, 'Asia/Manila');

    /* The seed file is the synchronous fallback src/config.ts reads, so a default hiding there
       would be announced by any unprimed process even with the column clear. */
    const seeded = seedEntry('tz-probe-one');
    assert.ok(seeded, 'the account must be mirrored into the seed file');
    assert.equal(seeded.timezone, undefined, 'and the mirror must not invent a zone either');
    assert.ok(!JSON.stringify(seeded).includes('Manila'), 'no Manila anywhere in the written entry');

    /* Nothing was named, so nothing is reported. Without this the `ignored` assertion in the next
       test would pass against a field that simply always says 'timezone'. */
    assert.equal(made.ignored, undefined, 'a create that named no refused key reports none');
  });

  test('creating an account with a posted timezone leaves the column NULL and SAYS it was refused', async () => {
    /**
     * THE DOOR THE FALLBACK LEFT OPEN.
     *
     * Removing the hardcoded 'Asia/Manila' replaced it with a conditional spread, so a caller
     * that TYPED a zone still got one written — the same un-provenanced value the default used to
     * mint, now supplied by hand. `update` refused the key from the day it was locked and `create`
     * did not, so the two halves of one rule disagreed and only one of them was tested.
     *
     * THE COLUMN IS THE ASSERTION. A returned record that merely omits the key would satisfy a
     * weaker test while the row carried a zone, and the row is what src/proxy/align.ts announces.
     */
    const made = await mod.createConsoleAccount({
      handle: 'tz-probe-two', role: 'Support', speaks: '', subreddits: [],
      timezone: 'Asia/Manila'
    });
    assert.equal(made.ok, true, JSON.stringify(made));
    assert.equal(made.storedIn, 'database', 'the assertion below is about a column, so it must have been written');

    assert.equal(await zoneOf('tz-probe-two'), null,
      'a typed zone must not reach the column — nothing has measured this account');
    assert.equal(made.account!.timezone, undefined, 'absent is how this codebase spells "no zone"');

    /* SAID SO, not silently dropped — the same report `update` has always made. A create that
       swallowed the key would leave every screen truthfully showing no zone while the person who
       typed one believed it had been saved. */
    assert.ok(made.ignored, 'a refused key must be reported');
    assert.ok(made.ignored.includes('timezone'),
      `timezone must be named in ignored: ${JSON.stringify(made.ignored)}`);

    /* The seed file is the synchronous fallback src/config.ts reads, so a zone hiding there would
       be announced by any unprimed process even with the column clear. */
    const seeded = seedEntry('tz-probe-two');
    assert.ok(seeded, 'the account is still created — one key is refused, not the whole form');
    assert.equal(seeded.timezone, undefined, 'the mirror must not carry a typed zone either');
    assert.ok(!JSON.stringify(seeded).includes('Manila'), 'no Manila anywhere in the written entry');
  });

  test('a blank or non-string timezone is treated as absent, never coerced into a value', async () => {
    /* `String(body.timezone)` would have turned each of these into a stored string — three spaces,
       'null', '42', '[object Object]' — every one of them a zone Intl cannot read, on a column
       whose whole job is to be readable. */
    const bads: unknown[] = ['   ', null, 42, {}];
    for (let i = 0; i < bads.length; i++) {
      const handle = `tz-blank-${i}`;
      const made = await mod.createConsoleAccount({
        handle, role: 'Support', speaks: '', subreddits: [], timezone: bads[i]
      });
      assert.equal(made.ok, true, JSON.stringify(made));
      assert.equal(await zoneOf(handle), null, `${JSON.stringify(bads[i])} must not become a stored zone`);
      /* NAMED IS NAMED. The refusal keys off the key being present, not off the value being
         plausible — exactly as `update` has always done — so there is one rule and not a second
         one that quietly tolerates the spellings a validator happens to dislike. */
      assert.ok(made.ignored?.includes('timezone'),
        `${JSON.stringify(bads[i])} still NAMES the key, so the refusal must be reported`);
    }
  });

  /* ---------------------------------------------------------------- *
   * Update
   * ---------------------------------------------------------------- */

  test('an update naming timezone is REFUSED, reported in `ignored`, and changes nothing', async () => {
    await mod.createConsoleAccount({ handle: 'tz-probe-edit', role: 'Support', speaks: '', subreddits: [] });

    /**
     * THE ZONE IS ESTABLISHED BY A DETECTION, because that is now the only thing that may
     * establish one. This precondition used to be a create carrying a typed zone; once create
     * refuses the key too, that spelling would have left the column NULL and the assertion below
     * would have passed against an untouched null rather than a PRESERVED MEASUREMENT — a fixture
     * quietly going vacuous while its test went on reporting green.
     */
    const seeded = await mod.recordAccountDetection('tz-probe-edit', {
      ip: '203.0.113.166', timezone: 'America/New_York', countryCode: 'US', via: 'launch'
    });
    assert.equal(seeded.ok, true, JSON.stringify(seeded));
    assert.equal(await zoneOf('tz-probe-edit'), 'America/New_York', 'precondition');

    const r = await mod.updateConsoleAccount({
      handle: 'tz-probe-edit', role: 'Reviewer', timezone: 'Asia/Manila'
    });
    assert.equal(r.ok, true, JSON.stringify(r));

    /* SAID SO, not silently dropped. The existing mechanism for refused keys is `ignored`, and a
       refusal nobody is told about is the same defect as a form that posts debugPort and gets a
       cheerful 200 back. */
    assert.ok(r.ignored, 'a refused key must be reported');
    assert.ok(r.ignored.includes('timezone'), `timezone must be named in ignored: ${JSON.stringify(r.ignored)}`);

    /* And the refusal has to be real, not just narrated. */
    assert.equal(await zoneOf('tz-probe-edit'), 'America/New_York',
      'the stored zone must be untouched by an edit that named it');
    assert.equal(r.account!.timezone, 'America/New_York');

    /* The rest of the edit still went through — this refuses one key, it does not refuse the form. */
    assert.equal(r.account!.role, 'Reviewer');
  });

  test('an update that does not name timezone carries the measured one across untouched', async () => {
    const before = await zoneOf('tz-probe-edit');
    const r = await mod.updateConsoleAccount({ handle: 'tz-probe-edit', note: 'a new note' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.ignored, undefined, 'nothing was refused, so nothing is reported');
    assert.equal(await zoneOf('tz-probe-edit'), before,
      'editing a note must not erase a detection');
  });

  test('timezone is no longer one of the fields the console may offer', () => {
    assert.ok(!mod.EDITABLE_ACCOUNT_FIELDS.includes('timezone'),
      'it is a measurement, so it must not appear in the editable set');
    /* The neighbours are still there — this removed one field, it did not empty the list. */
    for (const k of ['role', 'speaks', 'knows', 'subreddits', 'quietHours', 'dailyCeiling', 'note']) {
      assert.ok(mod.EDITABLE_ACCOUNT_FIELDS.includes(k), `${k} must still be editable`);
    }
  });

  /* ---------------------------------------------------------------- *
   * The write-back
   * ---------------------------------------------------------------- */

  test('a detection writes the evidence AND the column, with every field intact', async () => {
    await mod.createConsoleAccount({ handle: 'tz-probe-detect', role: 'Support', speaks: '', subreddits: [] });
    assert.equal(await zoneOf('tz-probe-detect'), null, 'precondition: unmeasured');

    const r = await mod.recordAccountDetection('tz-probe-detect', {
      ip: '203.0.113.166',
      timezone: 'America/Los_Angeles',
      countryCode: 'US',
      regionName: 'California',
      city: 'San Jose',
      offsetSeconds: -25200,
      proxy: false,
      hosting: true,
      via: 'launch'
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.timezone, 'America/Los_Angeles');
    assert.ok(r.locationId! > 0, 'the evidence row must be identified');
    assert.deepEqual(r.storedIn, ['database', 'seed-file'], 'both stores move, and it says which');

    /* The column now carries the measurement. */
    assert.equal(await zoneOf('tz-probe-detect'), 'America/Los_Angeles');

    /* The evidence is readable and complete — every column round-trips, including the two flags
       whose null/false distinction is the thing that must not collapse. */
    const got = await locs.latestAccountLocation(db.getPool(), 'tz-probe-detect');
    assert.ok(got, 'the detection must be retrievable');
    assert.equal(got.ip, '203.0.113.166');
    assert.equal(got.countryCode, 'US');
    assert.equal(got.regionName, 'California');
    assert.equal(got.city, 'San Jose');
    assert.equal(got.timezone, 'America/Los_Angeles');
    assert.equal(got.offsetSeconds, -25200);
    assert.equal(got.proxy, false, 'false is not null');
    assert.equal(got.hosting, true);
    assert.equal(got.via, 'launch');
    /* A Date, not a string: src/db.ts converts any column carrying the timestamp CHECK marker.
       Asserted rather than assumed, because a stringly-typed reader would have compiled fine. */
    assert.ok(got.at instanceof Date, 'a timestamp column crosses the facade as a Date');
    assert.ok(Date.now() - got.at.getTime() < 60_000,
      'the row stamps itself from the database clock, not from whatever the caller believes');

    /* The seed file moved too. 0018 clears the COLUMN and cannot reach a JSON file, so a
       write-back that skipped this would leave the synchronous fallback still saying Manila. */
    assert.equal(seedEntry('tz-probe-detect')!.timezone, 'America/Los_Angeles');
  });

  test('a provider that said nothing is stored as nothing — null is not false', async () => {
    await mod.createConsoleAccount({ handle: 'tz-probe-quiet', role: 'Support', speaks: '', subreddits: [] });
    const r = await mod.recordAccountDetection('tz-probe-quiet', {
      ip: '8.8.8.8', timezone: 'America/New_York', via: 'vet'
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    const got = await locs.latestAccountLocation(db.getPool(), 'tz-probe-quiet');
    assert.equal(got!.proxy, null, 'silence must not be recorded as a clean bill of health');
    assert.equal(got!.hosting, null);
    assert.equal(got!.countryCode, null);
  });

  test('a detection with no timezone is refused, and writes nothing at all', async () => {
    await mod.createConsoleAccount({ handle: 'tz-probe-fail', role: 'Support', speaks: '', subreddits: [] });
    const r = await mod.recordAccountDetection('tz-probe-fail', {
      ip: '1.1.1.1', timezone: '', via: 'run'
    });
    assert.equal(r.ok, false, 'a record with no zone is a FAILED detection');
    assert.match(r.error!, /timezone/i);
    assert.equal(await zoneOf('tz-probe-fail'), null, 'a failed detection must not touch the column');
    assert.equal(await locs.latestAccountLocation(db.getPool(), 'tz-probe-fail'), null,
      'and must not leave a row behind');
  });

  test('a detection for an account that does not exist is refused, not invented', async () => {
    const r = await mod.recordAccountDetection('tz-nobody-here', {
      ip: '1.1.1.1', timezone: 'America/Denver', via: 'doctor'
    });
    assert.equal(r.ok, false);
    assert.match(r.error!, /not a configured account/i);
  });

  test('successive detections accumulate rather than overwrite — the ledger is append-only', async () => {
    await mod.recordAccountDetection('tz-probe-quiet', {
      ip: '9.9.9.9', timezone: 'America/Chicago', via: 'run'
    });
    const rows = await db.getPool().query<{ n: number }>(
      'SELECT count(*) AS n FROM account_locations WHERE lower(handle) = lower($1)', ['tz-probe-quiet']
    );
    assert.equal(Number(rows.rows[0]!.n), 2, 'an exit that moved must stay visible after the fact');
    const got = await locs.latestAccountLocation(db.getPool(), 'tz-probe-quiet');
    assert.equal(got!.timezone, 'America/Chicago', 'and the latest is the one that answers');
    assert.equal(await zoneOf('tz-probe-quiet'), 'America/Chicago', 'the column follows the latest');
  });

  /* ---------------------------------------------------------------- *
   * The round trip the two halves exist for
   * ---------------------------------------------------------------- */

  test('unmeasured is unschedulable, and a detection is what makes it schedulable', async () => {
    /* R3 and R6 meeting: clearing the zone is only safe because window.ts refuses a NULL one, and
       refusing a NULL one is only workable because a detection can supply it. Asserted end to end
       so neither half can be quietly reverted without this failing. */
    await mod.createConsoleAccount({ handle: 'tz-round-trip', role: 'Support', speaks: '', subreddits: [] });

    const unmeasured = (await mod.knownAccounts())
      .find((a) => a.handle.toLowerCase() === 'tz-round-trip');
    assert.ok(unmeasured);
    const before = win.checkWindow({ account: unmeasured, repliesToday: 0, now: new Date('2026-07-24T04:00:00Z') });
    assert.equal(before.allowed, false, 'an account nobody has located must not be scheduled');
    assert.equal(before.rule, 'bad-timezone');

    await mod.recordAccountDetection('tz-round-trip', {
      ip: '203.0.113.166', timezone: 'America/Los_Angeles', countryCode: 'US', via: 'launch'
    });

    const measured = (await mod.knownAccounts())
      .find((a) => a.handle.toLowerCase() === 'tz-round-trip');
    assert.equal(measured!.timezone, 'America/Los_Angeles');
    const after = win.checkWindow({ account: measured!, repliesToday: 0, now: new Date('2026-07-24T20:00:00Z') });
    assert.equal(after.allowed, true, 'once measured, the ordinary rules apply again');
    assert.equal(after.localHour, 13, '20:00 UTC is 13:00 in Los Angeles (UTC-7 in July)');
  });
});
