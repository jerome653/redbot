/**
 * Request guards on the operator console.
 *
 * NOT picked up by `npm test`. That script is `tsc && node --test dist/test/*.test.js`, and this
 * server is plain .mjs with no compile step, so there is no dist/ copy of it to glob. Run it as:
 *
 *   node --test tools/operator/server.test.mjs
 *
 * No browser is opened and nothing under data/ is written. The tests that let a child start use
 * an account handle that is deliberately absent from data/accounts.json, which makes src/config.ts
 * throw while it is still resolving the CDP endpoint — before the CLI can reach a runner. That
 * refusal is not incidental: it is the evidence the account actually reached the child.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/** Passes the server's HANDLE_RE, will never be in accounts.json. */
const BOGUS = 'rb-operator-console-test';

/** The kinds the Jobs page offers. Pinned here so the form and the server cannot drift apart. */
const EXPECTED_KINDS = ['read', 'search', 'opportunity', 'draft', 'certify',
                        'vote', 'save', 'follow', 'post', 'reply-comment', 'publish'];

let child = null;
let PORT = 0;

/** Ask the OS for a port, then hand it to the console — the console has no --port 0 story. */
const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

before(async () => {
  PORT = await freePort();
  child = spawn(process.execPath, [join(HERE, 'server.mjs'), '--port', String(PORT)],
                { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let banner = '';
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`console did not start in 15s. stdout: ${banner}`)), 15_000);
    child.stdout.on('data', (d) => {
      banner += String(d);
      if (banner.includes(`127.0.0.1:${PORT}`)) { clearTimeout(timer); res(); }
    });
    child.on('error', (e) => { clearTimeout(timer); rej(e); });
    child.on('exit', (code) => { clearTimeout(timer); rej(new Error(`console exited ${code}`)); });
  });
});

after(() => { try { child?.kill(); } catch { /* already gone */ } });

const jobPost = async (body, headers = {}) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/job`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
};

/* ------------------------------------------------------------------ *
 * The job-kind allowlist
 * ------------------------------------------------------------------ */

test('a job kind outside the allowlist is refused, and refused before the CLI runs', async () => {
  // `reply` is a real JobKind that src/commands/job.ts accepts, and it matches the old
  // /^[a-z-]{1,20}$/ shape check exactly — which is how this endpoint used to reach past the
  // command allowlist that deliberately excludes it.
  const r = await jobPost({ op: 'add', kind: 'reply', account: BOGUS });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not a job kind this console may queue/);
  // Nothing was spawned: a response that had run the CLI would carry its command line and output.
  assert.equal(r.body.cli, undefined);
  assert.equal(r.body.out, undefined);
});

test('the queue allowlist is exactly the set the Jobs page offers', async () => {
  const r = await jobPost({ op: 'add', kind: 'not-a-kind', account: BOGUS });
  assert.equal(r.status, 400);
  const listed = r.body.error.split('One of: ')[1].split(', ');
  assert.deepEqual(listed, EXPECTED_KINDS);
  assert.ok(!listed.includes('reply'), 'reply must not be queueable from this console');
});

test('an unknown queue operation is refused', async () => {
  const r = await jobPost({ op: 'purge', account: BOGUS });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /unknown queue operation/);
});

test('a queue operation without a usable account handle is refused', async () => {
  const r = await jobPost({ op: 'add', kind: 'read', account: 'not a handle' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /which account/);
});

/* ------------------------------------------------------------------ *
 * The work pass — account, then lock
 * ------------------------------------------------------------------ */

test('a work pass is spawned as the account it was asked to run', async () => {
  const r = await jobPost({ op: 'work', account: BOGUS });
  // config.browser.cdpEndpoint — the Chrome the runners actually drive — is resolved from
  // REDBOT_ACCOUNT at module load, so a handle that is not in accounts.json makes the child
  // refuse before it can drive anything. Seeing that refusal IS the proof the variable reached
  // the child. Without it the child ran the pass against whatever browser this console's own
  // environment points at and reported "Nothing eligible this pass" with exit 0.
  const text = String(r.body.err ?? '') + String(r.body.out ?? '');
  assert.match(text, new RegExp(`REDBOT_ACCOUNT="${BOGUS}"`));
  assert.doesNotMatch(text, /Nothing eligible this pass/);
  assert.notEqual(r.body.code, 0);
});

test('a second work pass is refused while the first is in flight', async () => {
  // Both requests are dispatched before either can finish. Whichever the server reads first
  // spawns and claims the run slot in the same synchronous step, so the other must find it
  // taken — the losing request is a 409 whichever one wins the race.
  const [a, b] = await Promise.all([
    jobPost({ op: 'work', account: BOGUS }),
    jobPost({ op: 'work', account: BOGUS })
  ]);
  const statuses = [a.status, b.status].sort();
  // 400 is the pass that DID run and then failed closed on the unknown handle; 409 is the refusal.
  assert.deepEqual(statuses, [400, 409]);
  const refused = [a, b].find((x) => x.status === 409);
  assert.match(refused.body.error, /already running/);
  assert.equal(refused.body.out, undefined, 'the refused pass must not have spawned anything');
});

test('the run slot is free again once a pass has finished', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/status`);
  assert.deepEqual(await r.json(), { running: false });
});

/* ------------------------------------------------------------------ *
 * The transport guards around the mutation endpoint
 * ------------------------------------------------------------------ */

test('a queue operation must be sent as JSON', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/job`, {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"op":"work"}'
  });
  assert.equal(r.status, 415);
});

test('a cross-origin queue operation is refused', async () => {
  const r = await jobPost({ op: 'work', account: BOGUS }, { origin: 'http://attacker.example' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /cross-origin/);
});

test('a cross-site request is refused whatever it asks for', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/status`, {
    headers: { 'sec-fetch-site': 'cross-site' }
  });
  assert.equal(r.status, 403);
});

test('the queue endpoint answers no verb but POST', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/job`, { method: 'PUT' });
  assert.equal(r.status, 405);
});

/* ------------------------------------------------------------------ *
 * The log viewer
 *
 * These six logs were data/*.jsonl files, and src/store.ts stopped writing them when the store
 * moved to Postgres. The viewer then answered "data/history.jsonl does not exist yet — nothing
 * has written to it" on a machine whose history table held rows: not a missing feature
 * but a false statement, and the one an operator checking "did anything run?" would believe.
 * ------------------------------------------------------------------ */

const MARKER = 'operator-console-log-viewer-probe';

test('a log is served from its table, not from a file nothing writes', async () => {
  const { appendHistory } = await import('../../dist/store.js');
  await appendHistory({
    ts: new Date().toISOString(), kind: 'auto.cycle', account: null,
    status: 'ok', summary: MARKER
  });

  const r = await (await fetch(`http://127.0.0.1:${PORT}/api/log?name=history`)).json();
  assert.equal(r.available, true, `the log read as absent: ${r.reason}`);
  assert.equal(r.source, 'database');
  assert.equal(r.path, 'history', 'the viewer must name the table it actually read');
  assert.ok(r.total > 0);
  // Lines stay JSON strings, the shape the log page renders.
  assert.ok(r.lines.some((l) => l.includes(MARKER)), 'the row just written must appear');
  assert.doesNotThrow(() => JSON.parse(r.lines[0]), 'each line must be parseable JSON');
});

test('an empty log names the table, never a file that does not exist', async () => {
  // observations is empty in the test database and no legacy file accompanies it.
  const r = await (await fetch(`http://127.0.0.1:${PORT}/api/log?name=observations`)).json();
  if (r.available) return;   // another file in the suite wrote one; the claim below is moot
  assert.equal(r.path, 'observations');
  // `observations`, not `redbot.observations`: SQLite has no schemas, so the qualification went
  // with the port. The claim being tested is unchanged — the reason names a TABLE, not a file.
  assert.match(r.reason, /observations is empty/);
  // The old wording pointed at a path that will never exist again.
  assert.doesNotMatch(r.reason, /\.jsonl/);
});

test('an unknown log is still refused', async () => {
  const r = await (await fetch(`http://127.0.0.1:${PORT}/api/log?name=not-a-log`)).json();
  assert.equal(r.available, false);
  assert.match(r.reason, /unknown log/);
});

test('the legacy-file tree root says where the live logs are when it is empty', async () => {
  const r = await (await fetch(`http://127.0.0.1:${PORT}/api/tree?root=logs`)).json();
  assert.equal(r.label, 'logs (legacy files)');
  if (!r.children.length) {
    assert.equal(r.available, false);
    assert.match(r.reason, /live logs are rows in redbot/);
  }
});

/* ------------------------------------------------------------------ *
 * What the console says about itself
 * ------------------------------------------------------------------ */

test('the console does not describe itself as read-only', async () => {
  // It queues jobs and runs scheduler passes. `readOnly: true` here was the claim the Settings
  // page rendered, and it was false from the moment the Jobs page existed.
  const s = await (await fetch(`http://127.0.0.1:${PORT}/api/settings`)).json();
  assert.equal(s.readOnly, false);
  assert.equal(s.canQueueJobs, true);
  assert.equal(s.canRunWorkPass, true);
  assert.equal(s.canPublish, false);
});

test('the command allowlist is published alongside the queue allowlist', async () => {
  const c = await (await fetch(`http://127.0.0.1:${PORT}/api/commands`)).json();
  assert.deepEqual(c.queue.kinds, EXPECTED_KINDS);
  assert.ok(c.queue.note.length > 0);
  assert.ok(!c.commands.some((x) => EXPECTED_KINDS.includes(x.key)),
            'no queueable kind may also be a runnable GET command');
});
