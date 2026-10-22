/**
 * A reply is sent AS THE DRAFT'S ACCOUNT, from a browser that is actually open.
 *
 * Production, cardinal, 20-21 Oct. Two failures, four and five times over:
 *
 *   1. "X [identity] this draft was written for ryangrowth12, but the browser is signed in as
 *      Big_Variation_8580". The console sent as whichever account the UI had selected, while the
 *      draft carries its own. The identity gate (src/gates.ts) caught it every time — which is a
 *      refusal the operator could do nothing about except go and select the other account first.
 *
 *   2. "No debuggable Chrome at http://127.0.0.1:9226". Boot opens only the loop account's Chrome;
 *      every other account's browser opens "on demand (Accounts -> Open Chrome)", i.e. by hand.
 *      A reply, karma check, read or search as any other account died on a closed port.
 *
 * Both decisions live in ./reply-browser.mjs with their dependencies passed in, so they are
 * driven here without a database, a browser or a server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replyAccount, ensureBrowser } from './reply-browser.mjs';

/* ---------------- 1. which account a reply runs as ---------------- */

test('a draft with an account is sent as that account, even when the console selected another', () => {
  const r = replyAccount({ draft: { id: 'd1', account: 'ryangrowth12' }, requested: 'Big_Variation_8580', sole: null });
  assert.equal(r.account, 'ryangrowth12', 'never send as someone the draft was not written for');
  assert.equal(r.overrode, 'Big_Variation_8580', 'the override is reported, not silent');
  assert.match(r.note, /ryangrowth12/);
  assert.match(r.note, /Big_Variation_8580/);
});

test('a draft with an account needs no selection at all', () => {
  const r = replyAccount({ draft: { id: 'd1', account: 'ryangrowth12' }, requested: '', sole: null });
  assert.equal(r.account, 'ryangrowth12');
  assert.equal(r.overrode, null);
  assert.equal(r.note, null);
});

test('the same account requested is not an override', () => {
  const r = replyAccount({ draft: { account: 'ryangrowth12' }, requested: 'ryangrowth12', sole: 'x' });
  assert.equal(r.account, 'ryangrowth12');
  assert.equal(r.overrode, null);
});

test('a draft with NO account keeps the old behaviour: the request, then the sole account', () => {
  assert.equal(replyAccount({ draft: { id: 'd' }, requested: 'Picked', sole: 'Only' }).account, 'Picked');
  assert.equal(replyAccount({ draft: { id: 'd', account: '' }, requested: undefined, sole: 'Only' }).account, 'Only');
  assert.equal(replyAccount({ draft: null, requested: undefined, sole: null }).account, null);
});

/* ---------------- 2. opening the account's Chrome on demand ---------------- */

function fakes({ state = 'free', opened = { ok: true } } = {}) {
  const calls = { status: [], open: [], log: [] };
  return {
    calls,
    deps: {
      status: async (h) => { calls.status.push(h); return state; },
      open: async (h) => { calls.open.push(h); return opened; },
      log: (line) => { calls.log.push(line); }
    }
  };
}

test('a closed port is opened before the action runs, and the run log says so', async () => {
  const { deps, calls } = fakes({ state: 'free' });
  const r = await ensureBrowser('ryangrowth12', deps);
  assert.equal(r.ok, true);
  assert.equal(r.opened, true);
  assert.deepEqual(calls.open, ['ryangrowth12'], 'the DRAFT account is the one opened');
  assert.ok(calls.log.some((l) => /opened ryangrowth12's Chrome on demand/.test(l)), calls.log.join('\n'));
});

test('a browser that is already running is not opened again', async () => {
  const { deps, calls } = fakes({ state: 'running' });
  const r = await ensureBrowser('A', deps);
  assert.deepEqual(r, { ok: true, opened: false });
  assert.deepEqual(calls.open, []);
});

test('a failed open is a refusal carrying the opener\'s own words', async () => {
  const { deps, calls } = fakes({ state: 'free', opened: { ok: false, error: 'Chrome could not be found in the usual place.' } });
  const r = await ensureBrowser('A', deps);
  assert.equal(r.ok, false);
  assert.match(r.error, /Chrome could not be found/);
  assert.match(r.error, /\bA\b/, 'names whose browser it was');
  assert.deepEqual(calls.open, ['A']);
});

test('an opener that throws is a refusal, not a crash', async () => {
  const r = await ensureBrowser('A', {
    status: async () => 'free',
    open: async () => { throw new Error('spawn EACCES'); },
    log: () => {}
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /spawn EACCES/);
});

test('a port somebody else holds, or one that cannot be read, is left to the run as before', async () => {
  for (const state of ['foreign', 'unknown']) {
    const { deps, calls } = fakes({ state });
    const r = await ensureBrowser('A', deps);
    assert.deepEqual(r, { ok: true, opened: false }, state);
    assert.deepEqual(calls.open, [], `${state}: opening a browser onto a held port is launchChrome's call, not this one's`);
  }
  /* A status read that throws is unknown — the run proceeds exactly as it did before this existed. */
  const r = await ensureBrowser('A', { status: async () => { throw new Error('no db'); }, open: async () => assert.fail('must not open'), log: () => {} });
  assert.deepEqual(r, { ok: true, opened: false });
});
