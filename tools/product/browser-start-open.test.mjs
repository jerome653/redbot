/**
 * The browser that was ALREADY OPEN follows the same order, minus the spawn.
 *
 * WHAT THIS PINS, and why it did not exist before. `launchChrome` answered an account whose
 * Chrome was already up and ours with
 *
 *     return { ok: true, handle, port, profileDir, alreadyRunning: true };
 *
 * before detection, persistence, alignment or the WebRTC fence appeared in the flow at all. The
 * whole order lived after that line. So an open browser was reported as a successful open while
 * nothing had measured it, and the HTTP handler forwarded that verdict unchanged.
 *
 * That gap pre-dates the detection work. Migration 0018 is what makes it bite: it sets every
 * `accounts.timezone` to NULL, `src/window.ts` refuses a NULL zone with `rule: 'bad-timezone'`,
 * and the ONLY production code that writes a zone back is the detect-then-persist path that sat
 * behind the early return. An account whose browser happened to be open could therefore never
 * become schedulable again, and the remedy — close Chrome and reopen it — appears nowhere in the
 * product.
 *
 * TWO POLICIES DIFFER FROM THE SPAWNED PATH, AND BOTH LIVE IN THE MODULE RATHER THAN IN ITS
 * CALLER, for the reason browser-start.mjs already gives about refuse-and-close: a policy with
 * two copies is a policy that drifts. `weSpawnedIt: false` carries both.
 *
 *   - IT IS NOT CLOSED ON A REFUSAL. "We spawned it, so we own closing it" is the justification
 *     for the spawned path, and it is exactly the sentence that stops applying here. Closing a
 *     window the operator opened, may be signed into, and may have unsent text in is a different
 *     act from closing one redbot put on about:blank a second ago. electron/main.mjs already
 *     holds this rule in as many words: "this process did not start it, so this process must not
 *     close it."
 *
 *     FAIL-CLOSED IS PRESERVED WHERE IT COUNTS, which is scheduling, and it is preserved by the
 *     DATA rather than by the window. `record` is only ever reached after a successful detection,
 *     so a browser that could not be measured writes no zone, `accounts.timezone` stays NULL, and
 *     window.ts refuses the account. The last test in this file asserts that rather than
 *     describing it — an unmeasured account must be unschedulable, and closing a window was never
 *     what made it so.
 *
 *   - IT IS NOT NAVIGATED. `openUrl` reaches `alignBrowser`, which calls `goto` on
 *     `context.pages()[0]` — the operator's own first tab. Sending that to the login page throws
 *     away whatever they were doing. The rule it would be imitating ("Reddit LAST, after it is
 *     covered") exists so that nothing arrives before it has been measured; a browser that is
 *     already open may already BE at Reddit, so re-navigating it buys no safety and costs the
 *     operator their tab.
 *
 * Run alone as:
 *   node --env-file=db/sqlite/.env.test --test tools/product/browser-start-open.test.mjs
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startAlignedBrowser } from './browser-start.mjs';

const ENDPOINT = 'http://127.0.0.1:9223';
const LOGIN = 'https://www.reddit.com/login';

/** The same measured fixture the spawned-path suite uses, so the two cannot drift apart. */
const MEASURED = {
  at: '2026-09-21T00:00:00.000Z',
  ip: '149.22.84.166',
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

/**
 * Dependencies that record what they were asked, so the ORDER and the ARGUMENTS are assertable.
 * `loginUrl` is deliberately SET on every harness in this file: the point of the navigation rule
 * is that an already-running browser is not navigated even when a login URL was available, so a
 * harness that omitted it could not tell the rule from an accident.
 */
function harness(over = {}) {
  const seq = [];
  const calls = { closed: 0, covered: [], refusal: [], recorded: [] };
  const deps = {
    waitForDebugPort: async () => { seq.push('wait'); return true; },
    detect: async () => { seq.push('detect'); return { ...MEASURED }; },
    record: async (h, d) => {
      seq.push('record');
      calls.recorded.push([h, d]);
      return { ok: true, timezone: d.timezone, locationId: 7, storedIn: ['database', 'seed-file'] };
    },
    refusal: (...a) => { seq.push('refusal'); calls.refusal.push(a); return null; },
    cover: async (o) => { seq.push('cover'); calls.covered.push(o); return { pagesAligned: 3 }; },
    close: async () => { seq.push('close'); calls.closed++; },
    loginUrl: LOGIN,
    ...over
  };
  return { deps, calls, seq };
}

/** An already-running start: everything the spawned path passes, plus the ownership flag. */
const startOpen = (deps, over = {}) => startAlignedBrowser(deps, {
  endpoint: ENDPOINT, account: { handle: 'probe' }, exit: null, proxied: false,
  weSpawnedIt: false, ...over
});

/** The spawned path, written out so the negative control below is not a paraphrase of it. */
const startSpawned = (deps, over = {}) => startAlignedBrowser(deps, {
  endpoint: ENDPOINT, account: { handle: 'probe' }, exit: null, proxied: false, ...over
});

describe('an open browser is measured too', () => {

  /* ---------------------------------------------------------------- *
   * 1. It is measured and persisted at all
   * ---------------------------------------------------------------- */

  test('an already-running browser is DETECTED and PERSISTED, not waved through', async () => {
    /* The assertion the early return made impossible. Everything below happened after the line
       that returned `alreadyRunning: true`, so on the unfixed code none of it ran. */
    const { deps, calls, seq } = harness();
    const r = await startOpen(deps);

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(seq.includes('detect'), 'the browser was ASKED where it is');
    assert.ok(seq.includes('record'), 'and the answer was written down before anything acted on it');

    assert.equal(calls.recorded.length, 1, 'exactly one measurement is persisted');
    const [handle, detection] = calls.recorded[0];
    assert.equal(handle, 'probe');
    assert.equal(detection.timezone, 'America/Los_Angeles', 'the measured zone, verbatim');
    assert.equal(detection.via, 'launch', 'the OCCASION — the closed domain shared with account_exit_ips');
    assert.match(detection.transport, /renderer fetch of ip-api\.com/, 'and the route it travelled');

    assert.equal(r.recorded.timezone, 'America/Los_Angeles');
    assert.equal(r.location.countryCode, 'US', 'the caller is handed the measurement, not a guess');
  });

  test('an already-running browser is COVERED and FENCED, like a spawned one', async () => {
    const { deps, calls } = harness();
    const r = await startOpen(deps);
    assert.equal(r.ok, true);
    assert.equal(calls.covered.length, 1, 'alignment ran — the fence is installed by cover()');
    assert.equal(calls.covered[0].timezone, 'America/Los_Angeles', 'covered from what was MEASURED');
    assert.equal(calls.covered[0].locale, 'en-US', 'locale built from the DETECTED country');
    assert.equal(r.pagesAligned, 3, 'and how many tabs it reached stays visible');
  });

  /* ---------------------------------------------------------------- *
   * 2. The order is the same, minus the spawn
   * ---------------------------------------------------------------- */

  test('the ORDER is the spawned order exactly, minus the spawn', async () => {
    /* Same invariant, same reason: setTimezoneOverride changes what the renderer reports, so a
       lookup taken after it reads back redbot's own assertion. That does not stop being true
       because the window was already open. */
    const { deps, seq } = harness();
    const r = await startOpen(deps);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(seq, ['wait', 'detect', 'record', 'refusal', 'cover'],
      'wait -> detect -> record -> check -> cover, identical to the spawned path');
    assert.ok(seq.indexOf('detect') < seq.indexOf('cover'),
      'stated on its own, because this is the whole invariant');
    assert.ok(seq.indexOf('record') < seq.indexOf('cover'),
      'the measurement is evidence BEFORE it is announced');
    assert.ok(!seq.includes('close'), 'and nothing was closed on the way through');
  });

  test('the open order and the spawned order are the SAME sequence', async () => {
    /* Asserted against each other rather than against a literal, so the two cannot be edited
       apart one at a time. */
    const open = harness();
    const spawned = harness();
    const a = await startOpen(open.deps);
    const b = await startSpawned(spawned.deps);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.deepEqual(open.seq, spawned.seq,
      'an open browser and a spawned one run one order — a second copy is how they drift');
  });

  /* ---------------------------------------------------------------- *
   * 3. It is not navigated
   * ---------------------------------------------------------------- */

  test('an already-running browser is NOT navigated, even though a login URL was available', async () => {
    /* `openUrl` reaches alignBrowser, which calls goto on context.pages()[0] — the operator's own
       first tab. The login URL is present on the deps; the rule is what suppresses it. */
    const { deps, calls } = harness();
    const r = await startOpen(deps);
    assert.equal(r.ok, true);
    assert.equal(calls.covered[0].openUrl, undefined,
      'the operator\'s tab is left where they put it');
  });

  test('a SPAWNED browser is still navigated — the rule is scoped, not a global retreat', async () => {
    const { deps, calls } = harness();
    const r = await startSpawned(deps);
    assert.equal(r.ok, true);
    assert.equal(calls.covered[0].openUrl, LOGIN,
      'a browser redbot opened on about:blank still gets sent to Reddit, last');
  });

  /* ---------------------------------------------------------------- *
   * 4. Detection failure: refuse, do not close
   * ---------------------------------------------------------------- */

  test('when detection fails on an open browser it is REFUSED but NOT closed', async () => {
    const { deps, calls, seq } = harness({
      detect: async () => { throw new Error('the browser could not reach http://ip-api.com/json/'); }
    });
    const r = await startOpen(deps);

    assert.equal(r.ok, false, 'a browser that could not be measured is not a successful open');
    assert.equal(r.closed, false, 'redbot did not open it, so redbot does not close it');
    assert.equal(calls.closed, 0, 'and close was not merely reported — it was never called');
    assert.ok(!seq.includes('close'));

    assert.equal(calls.covered.length, 0, 'nothing was covered on an unmeasured browser');
    assert.equal(calls.recorded.length, 0, 'and a failed detection writes no evidence');
    assert.equal(r.location, undefined, 'no fallback zone reached the caller by any route');
    assert.ok(!/Asia\/Manila|America\/Los_Angeles/.test(r.error),
      'and the sentence does not quote a zone it did not measure');
  });

  test('the refusal SAYS the window was left open, so the operator is not hunting a closed one', async () => {
    const { deps } = harness({
      detect: async () => { throw new Error('the browser could not reach http://ip-api.com/json/'); }
    });
    const r = await startOpen(deps);
    assert.equal(r.ok, false);
    assert.match(r.error, /left (it )?open|still open|did not close/i,
      'a refusal that closes nothing has to say so, or it reads like the spawned one');
  });

  test('a SPAWNED browser that cannot be measured is still closed — the control for the above', async () => {
    const { deps, calls } = harness({
      detect: async () => { throw new Error('the browser could not reach http://ip-api.com/json/'); }
    });
    const r = await startSpawned(deps);
    assert.equal(r.ok, false);
    assert.equal(r.closed, true, 'we spawned it, so we own closing it');
    assert.equal(calls.closed, 1, 'and it is closed exactly once');
  });

  test('every other refusal on the open path also leaves the window alone', async () => {
    /* The policy belongs to the path, not to one branch of it. A refusal that forgot would close
       the operator's browser over a check that has nothing to do with who opened it. */
    const noZone = harness({ detect: async () => ({ ...MEASURED, timezone: null }) });
    const rz = await startOpen(noZone.deps);
    assert.equal(rz.ok, false);
    assert.equal(noZone.calls.closed, 0, 'a detection with no zone closes nothing');

    const unrecordable = harness({ record: async () => ({ ok: false, error: 'no database' }) });
    const ru = await startOpen(unrecordable.deps);
    assert.equal(ru.ok, false);
    assert.equal(unrecordable.calls.closed, 0, 'a measurement that cannot be stored closes nothing');

    const refused = harness({ refusal: () => 'probe announces a zone that is not in its country.' });
    const rr = await startOpen(refused.deps);
    assert.equal(rr.ok, false);
    assert.equal(refused.calls.closed, 0, 'an alignment refusal closes nothing');

    const mismatch = harness();
    const rm = await startOpen(mismatch.deps, {
      exit: { proxied: true, ok: true, relayPort: 41000, proxy: { country: 'GB', region: 'London' } },
      proxied: true
    });
    assert.equal(rm.ok, false, 'measured US against a GB exit is still a refusal');
    assert.equal(mismatch.calls.closed, 0, 'and it still does not close the operator\'s window');
    assert.equal(mismatch.calls.covered.length, 0, 'nor does it cover it');
  });

  /* ---------------------------------------------------------------- *
   * 5. Unmeasured means UNSCHEDULABLE — the fail-closed property, asserted
   * ---------------------------------------------------------------- */

  describe('an account whose browser could not be measured is not schedulable', () => {
    let DATA;
    let accounts;
    let db;
    let win;

    before(async () => {
      DATA = mkdtempSync(join(tmpdir(), 'redbot-open-'));
      process.env.REDBOT_DATA = DATA;
      accounts = await import('../../dist/console-accounts.js');
      db = await import('../../dist/db.js');
      win = await import('../../dist/window.js');
      assert.equal(db.dbUnavailableReason(), null,
        'this test is about a real column, so it is meaningless without the database');
    });

    after(() => { rmSync(DATA, { recursive: true, force: true }); });

    test('a failed measurement leaves the zone NULL, and window.ts refuses the account', async () => {
      /**
       * THE REASON NOT CLOSING IS STILL FAIL-CLOSED.
       *
       * The spawned path closes the window and calls that the safety property. It is not — the
       * safety property is that nothing downstream treats an unmeasured account as measured, and
       * that is held by the COLUMN, not by the window. This drives the real writer and the real
       * scheduler gate to show the guarantee survives leaving the browser open.
       */
      const handle = 'open_probe_unmeas';
      await db.getPool().query('DELETE FROM accounts WHERE lower(handle) = lower($1)', [handle]);
      const made = await accounts.createConsoleAccount({
        handle, role: 'Support', speaks: '', subreddits: []
      });
      assert.equal(made.ok, true, JSON.stringify(made));

      const { deps, calls } = harness({
        detect: async () => { throw new Error('the browser could not reach http://ip-api.com/json/'); },
        record: (h, d) => accounts.recordAccountDetection(h, d)
      });
      const r = await startAlignedBrowser(deps, {
        endpoint: ENDPOINT, account: { handle }, exit: null, proxied: false, weSpawnedIt: false
      });
      assert.equal(r.ok, false);
      assert.equal(r.closed, false, 'the window stayed open');
      assert.equal(calls.closed, 0);

      const col = await db.getPool().query(
        'SELECT timezone FROM accounts WHERE lower(handle) = lower($1)', [handle]);
      assert.equal(col.rows[0].timezone, null,
        'nothing wrote a zone — 0018 cleared it and only a measurement may fill it');

      /* And the gate that actually stops work agrees, through the real rule rather than a proxy
         for it. This is the sentence an operator would see. */
      const verdict = win.checkWindow({
        account: { handle, timezone: col.rows[0].timezone ?? undefined },
        repliesToday: 0,
        now: new Date('2026-09-21T12:00:00.000Z')
      });
      assert.equal(verdict.allowed, false, 'an unmeasured account must not be scheduled');
      assert.equal(verdict.rule, 'bad-timezone', 'and it is refused by the rule 0018 relies on');
    });

    test('a SUCCESSFUL measurement on the open path makes that account schedulable again', async () => {
      /* The other half, and the reason this defect matters rather than being cosmetic: the open
         path is now a way OUT of the NULL that 0018 left every account in. Before the fix an
         account whose browser was up could never reach this state at all. */
      const handle = 'open_probe_ok';
      await db.getPool().query('DELETE FROM accounts WHERE lower(handle) = lower($1)', [handle]);
      await accounts.createConsoleAccount({ handle, role: 'Support', speaks: '', subreddits: [] });

      const { deps } = harness({ record: (h, d) => accounts.recordAccountDetection(h, d) });
      const r = await startAlignedBrowser(deps, {
        endpoint: ENDPOINT, account: { handle }, exit: null, proxied: false, weSpawnedIt: false
      });
      assert.equal(r.ok, true, JSON.stringify(r));

      const col = await db.getPool().query(
        'SELECT timezone FROM accounts WHERE lower(handle) = lower($1)', [handle]);
      assert.equal(col.rows[0].timezone, 'America/Los_Angeles',
        'the browser was asked, and the answer moved the column');

      const verdict = win.checkWindow({
        account: { handle, timezone: col.rows[0].timezone ?? undefined },
        repliesToday: 0,
        now: new Date('2026-09-21T19:00:00.000Z')
      });
      assert.notEqual(verdict.rule, 'bad-timezone',
        'an account that was unschedulable is schedulable again — without closing anybody\'s browser');
      assert.equal(verdict.allowed, true, verdict.detail);
    });
  });
});
