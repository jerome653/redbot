import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWindow, inQuietRange, localHourFor } from '../window.js';
import type { AccountRecord } from '../config.js';

const acct = (over: Partial<AccountRecord> = {}): AccountRecord => ({
  handle: 'tester', timezone: 'Asia/Manila', quietHours: [0, 8], dailyCeiling: 2, ...over
});
/** 2026-07-24 04:00 UTC is 12:00 in Manila (UTC+8); 20:00 UTC is 04:00 next day. */
const AT_NOON_MANILA = new Date('2026-07-24T04:00:00Z');
const AT_4AM_MANILA = new Date('2026-07-24T20:00:00Z');

test('quiet range handles a normal span', () => {
  assert.equal(inQuietRange(3, 0, 8), true);
  assert.equal(inQuietRange(8, 0, 8), false, 'the end hour is excluded');
  assert.equal(inQuietRange(12, 0, 8), false);
});

test('quiet range wraps midnight', () => {
  assert.equal(inQuietRange(23, 22, 7), true);
  assert.equal(inQuietRange(3, 22, 7), true);
  assert.equal(inQuietRange(7, 22, 7), false);
  assert.equal(inQuietRange(12, 22, 7), false);
});

test('an empty range silences nothing', () => {
  assert.equal(inQuietRange(5, 5, 5), false);
});

test('an unknown timezone reads as null rather than server time', () => {
  assert.equal(localHourFor('Not/AZone', new Date()), null);
  assert.equal(localHourFor(undefined, new Date()), null);
});

test('allowed in working hours under the ceiling', () => {
  const v = checkWindow({ account: acct(), repliesToday: 0, now: AT_NOON_MANILA });
  assert.equal(v.allowed, true);
  assert.equal(v.localHour, 12);
});

test('refused during quiet hours', () => {
  const v = checkWindow({ account: acct(), repliesToday: 0, now: AT_4AM_MANILA });
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'quiet-hours');
  assert.equal(v.localHour, 4);
});

test('refused at the daily ceiling', () => {
  const v = checkWindow({ account: acct({ dailyCeiling: 1 }), repliesToday: 1, now: AT_NOON_MANILA });
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'daily-ceiling');
});

test('an account ceiling cannot exceed the global maximum', () => {
  const v = checkWindow({ account: acct({ dailyCeiling: 99 }), repliesToday: 3, now: AT_NOON_MANILA });
  assert.equal(v.allowed, false, 'the global cap of 3 still applies');
  assert.equal(v.rule, 'daily-ceiling');
});

test('fails closed with no account', () => {
  const v = checkWindow({ account: null, repliesToday: 0, now: AT_NOON_MANILA });
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'no-account');
});

test('fails closed on an unreadable timezone', () => {
  const v = checkWindow({ account: acct({ timezone: 'Nowhere/Nothing' }), repliesToday: 0, now: AT_NOON_MANILA });
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'bad-timezone');
});

test('fails closed on a malformed quiet range', () => {
  const v = checkWindow({ account: acct({ quietHours: [0, 44] as [number, number] }), repliesToday: 0, now: AT_NOON_MANILA });
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'bad-quiet-range');
});

test('an account with no quiet hours is judged on the ceiling alone', () => {
  const v = checkWindow({ account: acct({ quietHours: undefined }), repliesToday: 0, now: AT_4AM_MANILA });
  assert.equal(v.allowed, true, '4am is fine if nobody declared quiet hours');
});

/* ------------------------------------------------------------------ *
 * The timezone check must not be reachable only through quiet hours
 *
 * THE HOLE. `if (quiet)` wrapped the whole block, and the bad-timezone refusal lived inside it.
 * An account with no quiet hours therefore skipped the zone check entirely, reached the tail of
 * checkWindow, and `...(hour === null ? {} : { localHour: hour })` dropped the null on the floor
 * — so an account whose zone could not be read was returned `allowed: true` with no localHour and
 * nothing anywhere saying why.
 *
 * It is reachable from data, not just in theory: src/config.ts declares `quietHours?` optional,
 * and src/db/accounts.ts only sets it when BOTH quiet_start and quiet_end are non-null, so any
 * row with either column NULL produces a record with no quietHours at all.
 *
 * Nothing has been let through YET only because of how the rows happen to be populated, not
 * because the code refuses. Measured 2026-09-21, against a copy taken with its -wal and -shm and
 * checkpointed before reading: every accounts row then carried both quiet_start and quiet_end, so
 * no record reached checkWindow without quietHours. That is a fact about one day's data, dated
 * deliberately rather than stated as a count — the reachability argument above rests on the
 * SCHEMA allowing NULL, which no amount of currently-populated rows can retire.
 *
 * 0018 makes NULL timezones the normal state, which is precisely when a latent fail-open becomes
 * a live one.
 * ------------------------------------------------------------------ */

test('an account with NO timezone and NO quiet hours is REFUSED, not waved through', () => {
  /* The fail-open, stated as the thing it actually is: nobody declared quiet hours, nobody has
     measured a location, and the account must not be scheduled. Asserting the RULE and not just
     `allowed` — a refusal for the wrong reason would be a different bug wearing this one's face. */
  const v = checkWindow({
    account: acct({ timezone: undefined, quietHours: undefined }),
    repliesToday: 0,
    now: AT_NOON_MANILA
  });
  assert.equal(v.allowed, false, 'an unmeasured location is not a licence to act');
  assert.equal(v.rule, 'bad-timezone');
  assert.match(v.detail, /unset/, 'it must say the zone is missing rather than name a fake one');
});

test('an account with an UNREADABLE timezone and no quiet hours is refused too', () => {
  /* The same hole reached through a different door: a zone that is present but not a zone. This
     one would also have returned allowed:true, because localHourFor returns null for both. */
  const v = checkWindow({
    account: acct({ timezone: 'Nowhere/Nothing', quietHours: undefined }),
    repliesToday: 0,
    now: AT_NOON_MANILA
  });
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'bad-timezone');
});

test('THE NEGATIVE CONTROL: a readable zone with no quiet hours still behaves exactly as before', () => {
  /* Proves the fix refuses the unreadable case rather than simply refusing everything. 4am is
     inside nobody's quiet hours here because none are declared, so this must still be allowed —
     and it must still report the local hour, which is the evidence the zone was genuinely read. */
  const v = checkWindow({
    account: acct({ timezone: 'Asia/Manila', quietHours: undefined }),
    repliesToday: 0,
    now: AT_4AM_MANILA
  });
  assert.equal(v.allowed, true, '4am is fine if nobody declared quiet hours');
  assert.equal(v.localHour, 4, 'the zone was read, and the verdict says so');
  assert.equal(v.rule, undefined, 'an allowed verdict names no rule');
});

test('a missing timezone is refused even when quiet hours ARE declared', () => {
  /* The path that already worked. Pinned so the fix cannot accidentally move the refusal OUT of
     the quiet-hours branch while moving it in everywhere else. */
  const v = checkWindow({
    account: acct({ timezone: undefined }),
    repliesToday: 0,
    now: AT_NOON_MANILA
  });
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'bad-timezone');
});

test('the ceiling still outranks nothing — a bad zone is refused BEFORE the count is consulted', () => {
  /* Order matters for the message a person sees. An account that is both over its ceiling and
     unmeasured should say the zone is unreadable, because that is the fault to fix; "you have
     used your replies" would send them to the wrong place entirely. */
  const v = checkWindow({
    account: acct({ timezone: undefined, quietHours: undefined, dailyCeiling: 1 }),
    repliesToday: 5,
    now: AT_NOON_MANILA
  });
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'bad-timezone', 'the unreadable zone is the fault worth naming');
});
