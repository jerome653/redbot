/**
 * The one-click "Add account" flow — the orchestration only, every side effect injected.
 *
 * Nothing here opens a browser, touches the database or reaches Reddit: create / persona / open /
 * signedInAs / checkKarma are stubs that record their calls, and the clock is a counter that the
 * stubbed `sleep` advances. What is under test is the ORDER, the RESUME and the WORDS a person
 * reads when it stops.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAddAccountFlows, STEP_KEYS, karmaFromOutput } from './add-account-flow.mjs';

function harness(over = {}) {
  let t = 0;
  const calls = [];
  const known = new Set(over.known || []);
  const deps = {
    exists: async (h) => known.has(h.toLowerCase()),
    create: async (input) => {
      calls.push(['create', input.handle]);
      known.add(input.handle.toLowerCase());
      return { ok: true, account: { handle: input.handle, debugPort: 9300, profileDir: 'chrome-profile-x' } };
    },
    persona: async (h) => { calls.push(['persona', h]); return { ok: true, note: 'voice plain/3' }; },
    open: async (h) => { calls.push(['open', h]); return { ok: true }; },
    signedInAs: async (h) => { calls.push(['signedInAs', h]); return { loggedIn: true, username: h }; },
    checkKarma: async (h) => { calls.push(['checkKarma', h]); return { ok: true, karma: 42 }; },
    sleep: async (ms) => { t += ms; },
    now: () => t,
    ...over.deps
  };
  const flows = createAddAccountFlows(deps, { pollMs: 5000, timeoutMs: 10 * 60 * 1000, ...over.opts });
  return { flows, calls, deps, clock: () => t };
}

const stateOf = (s, key) => s.steps.find((x) => x.key === key).state;

test('the steps are create, persona, open, sign-in, karma — in that order', () => {
  assert.deepEqual(STEP_KEYS, ['create', 'persona', 'open', 'signin', 'karma']);
});

test('happy path: one call runs every step and finishes "Added — handle, karma N"', async () => {
  const h = harness();
  const { state, finished } = h.flows.start({ handle: 'wp_fixer' });
  assert.equal(state.status, 'running');
  const end = await finished;
  assert.equal(end.status, 'done');
  assert.equal(end.karma, 42);
  assert.equal(end.message, 'Added — wp_fixer, karma 42');
  for (const k of STEP_KEYS) assert.equal(stateOf(end, k), 'done', k);
  assert.deepEqual(h.calls.map((c) => c[0]),
    ['create', 'persona', 'open', 'signedInAs', 'checkKarma']);
  assert.equal(h.flows.get('WP_FIXER').status, 'done', 'looked up case-insensitively');
});

test('a "u/" prefix is stripped — the operator types the name the way Reddit shows it', async () => {
  const h = harness();
  const end = await h.flows.start({ handle: ' u/wp_fixer ' }).finished;
  assert.equal(end.handle, 'wp_fixer');
  assert.equal(end.status, 'done');
});

test('waits for the sign-in: polls every pollMs until the browser names the account', async () => {
  let n = 0;
  const h = harness({ deps: {
    signedInAs: async () => (++n < 4 ? { loggedIn: false, username: null } : { loggedIn: true, username: 'Wp_Fixer' })
  } });
  const end = await h.flows.start({ handle: 'wp_fixer' }).finished;
  assert.equal(end.status, 'done');
  assert.equal(n, 4);
  assert.equal(h.clock(), 3 * 5000, 'slept three polls between four reads');
});

test('resume after a failure does not recreate the account and does not reopen a done step', async () => {
  let karmaFails = true;
  const h = harness({ deps: {
    checkKarma: async () => (karmaFails ? { ok: false, error: '"collect" is still running' } : { ok: true, karma: 7 })
  } });
  const first = await h.flows.start({ handle: 'wp_fixer' }).finished;
  assert.equal(first.status, 'failed');
  assert.equal(first.failedStep, 'karma');
  assert.match(first.error, /"collect" is still running/);
  assert.equal(stateOf(first, 'karma'), 'failed');

  karmaFails = false;
  const again = await h.flows.start({ handle: 'wp_fixer' }).finished;
  assert.equal(again.status, 'done');
  assert.equal(again.karma, 7);
  assert.equal(h.calls.filter((c) => c[0] === 'create').length, 1, 'created once, never twice');
  assert.equal(h.calls.filter((c) => c[0] === 'open').length, 1, 'browser opened once');
});

test('an account that already exists (server restarted mid-flow) is not created again', async () => {
  const h = harness({ known: ['wp_fixer'] });
  const end = await h.flows.start({ handle: 'wp_fixer' }).finished;
  assert.equal(end.status, 'done');
  assert.equal(h.calls.filter((c) => c[0] === 'create').length, 0);
  assert.match(end.steps.find((s) => s.key === 'create').detail, /already set up/);
});

test('a failed create stops the flow with the create error, and nothing after it runs', async () => {
  const h = harness({ deps: { create: async () => ({ ok: false, error: 'A Reddit username is 3–20 characters' }) } });
  const end = await h.flows.start({ handle: 'x' }).finished;
  assert.equal(end.status, 'failed');
  assert.equal(end.failedStep, 'create');
  assert.match(end.error, /3–20 characters/);
  assert.equal(stateOf(end, 'open'), 'pending');
});

test('timeout waiting for sign-in reports clearly, and Try again resumes at the sign-in step', async () => {
  let signed = false;
  const h = harness({ deps: {
    signedInAs: async () => (signed ? { loggedIn: true, username: 'wp_fixer' } : { loggedIn: false, username: null })
  } });
  const end = await h.flows.start({ handle: 'wp_fixer' }).finished;
  assert.equal(end.status, 'failed');
  assert.equal(end.failedStep, 'signin');
  assert.match(end.error, /No sign-in as wp_fixer after 10 minutes/);
  assert.ok(h.clock() >= 10 * 60 * 1000, 'it waited the whole window');

  signed = true;
  const again = await h.flows.start({ handle: 'wp_fixer' }).finished;
  assert.equal(again.status, 'done');
  assert.equal(h.calls.filter((c) => c[0] === 'create').length, 1);
  assert.equal(h.calls.filter((c) => c[0] === 'open').length, 1, 'the open window is reused, not reopened');
});

test('wrong account signed in reports both names and does not run the karma check', async () => {
  const h = harness({ deps: { signedInAs: async () => ({ loggedIn: true, username: 'someone_else' }) } });
  const end = await h.flows.start({ handle: 'wp_fixer' }).finished;
  assert.equal(end.status, 'failed');
  assert.equal(end.failedStep, 'signin');
  assert.match(end.error, /signed in as someone_else, not wp_fixer/);
  assert.equal(h.calls.filter((c) => c[0] === 'checkKarma').length, 0);
});

test('a browser that cannot be read three times running is reported, not waited out', async () => {
  const h = harness({ deps: { signedInAs: async () => { throw new Error('No debuggable Chrome at http://127.0.0.1:9300'); } } });
  const end = await h.flows.start({ handle: 'wp_fixer' }).finished;
  assert.equal(end.status, 'failed');
  assert.equal(end.failedStep, 'signin');
  assert.match(end.error, /No debuggable Chrome at http:\/\/127\.0\.0\.1:9300/);
  assert.match(end.error, /still open/);
  assert.ok(h.clock() < 60 * 1000, 'gave up in seconds, not after ten minutes');
});

test('a persona that cannot be assigned is a warning, not a stop', async () => {
  const h = harness({ deps: { persona: async () => ({ ok: false, error: 'no free voice' }) } });
  const end = await h.flows.start({ handle: 'wp_fixer' }).finished;
  assert.equal(end.status, 'done');
  const p = end.steps.find((s) => s.key === 'persona');
  assert.equal(p.state, 'warn');
  assert.match(p.detail, /no free voice/);
});

test('pressing the button twice while it runs does not start a second flow', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ deps: { open: async (hh) => { await gate; return { ok: true }; } } });
  const a = h.flows.start({ handle: 'wp_fixer' });
  const b = h.flows.start({ handle: 'wp_fixer' });
  assert.equal(b.finished, a.finished, 'the same run is handed back');
  release();
  await a.finished;
  assert.equal(h.calls.filter((c) => c[0] === 'create').length, 1);
});

test('a thrown dependency becomes the failed step\'s reason, never an unhandled rejection', async () => {
  const h = harness({ deps: { open: async () => { throw new Error('Chrome could not be found'); } } });
  const end = await h.flows.start({ handle: 'wp_fixer' }).finished;
  assert.equal(end.status, 'failed');
  assert.equal(end.failedStep, 'open');
  assert.match(end.error, /Chrome could not be found/);
});

test('karma that is ok but unreadable says so instead of printing "karma null"', async () => {
  const h = harness({ deps: { checkKarma: async () => ({ ok: true, karma: null }) } });
  const end = await h.flows.start({ handle: 'wp_fixer' }).finished;
  assert.equal(end.status, 'done');
  assert.equal(end.message, 'Added — wp_fixer (karma not read yet)');
});

test('all() lists every flow so a reopened dialog can pick one up; no request body leaks out', async () => {
  const h = harness({ deps: { signedInAs: async () => ({ loggedIn: false, username: null }) }, opts: { timeoutMs: 10000 } });
  const r = h.flows.start({ handle: 'wp_fixer', role: 'Support desk' });
  assert.equal(r.state.input, undefined, 'start() hands back a public view');
  await r.finished;
  const all = h.flows.all();
  assert.equal(all.length, 1);
  assert.equal(all[0].handle, 'wp_fixer');
  assert.equal(all[0].status, 'failed');
  assert.equal(all[0].input, undefined);
  assert.equal((await r.finished).input, undefined);
});

test('karmaFromOutput reads the probe\'s own "recorded:" line, then its JSON, else null', () => {
  assert.equal(karmaFromOutput('{\n  "username": "a",\n  "karma": "1,204"\n}\nrecorded: karma 1204 for a'), 1204);
  assert.equal(karmaFromOutput('{ "karma": "15" }'), 15);
  assert.equal(karmaFromOutput('{ "karma": 3 }'), 3);
  assert.equal(karmaFromOutput('karma could not be parsed from the profile page'), null);
  assert.equal(karmaFromOutput(undefined), null);
});

test('adding an account that already finished runs again without creating it twice', async () => {
  const h = harness();
  await h.flows.start({ handle: 'wp_fixer' }).finished;
  const again = await h.flows.start({ handle: 'wp_fixer' }).finished;
  assert.equal(again.status, 'done');
  assert.equal(h.calls.filter((c) => c[0] === 'create').length, 1);
  assert.equal(h.calls.filter((c) => c[0] === 'checkKarma').length, 2, 'karma measured fresh');
});

test('a persona step that THROWS (a database refusal) is still a warning, not a stop', async () => {
  const h = harness({ deps: { persona: async () => { throw new Error('CHECK constraint failed'); } } });
  const end = await h.flows.start({ handle: 'wp_fixer' }).finished;
  assert.equal(end.status, 'done');
  const p = end.steps.find((s) => s.key === 'persona');
  assert.equal(p.state, 'warn');
  assert.match(p.detail, /CHECK constraint failed/);
});
