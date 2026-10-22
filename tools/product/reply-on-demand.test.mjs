/**
 * A browser-driving action opens its account's Chrome on demand — driven through the server.
 *
 * Production, cardinal, 20-21 Oct: "No debuggable Chrome at http://127.0.0.1:9226", five times.
 * Boot opens only the loop account's browser and every other account's opened by hand, so a reply,
 * karma check, read or search as any of them died on a closed port. reply-browser.test.mjs covers
 * the decision; this covers runAction actually taking it, before it spawns anything.
 *
 * HOW, WITHOUT A BROWSER. The console child's Chrome is NODE ITSELF (REDBOT_CHROME =
 * process.execPath). launchChrome finds it, spawns it, node rejects `--remote-debugging-port` as a
 * bad option and exits, the port never answers, and launchChrome refuses after its bounded 30 s
 * wait — on every platform, with no window and no network. Hiding the real Chrome instead does
 * not work: Windows re-populates %ProgramFiles% in every child, and the first run of this file
 * that tried it opened two real browsers. Before this change the action skipped the open, spawned
 * the CLI and died on the port with the production error.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const HANDLE = 'OnDemand_Acct';
const OTHER = 'OnDemand_Other';
const DRAFT = 'ondemand_draft';
const THREAD = 'ddd0de000001';

const CHILD_ENV = { ...process.env, REDBOT_CHROME: process.execPath };

let child = null, PORT = 0, DATA = '', pool = null, childErr = '';

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

const post = async (path, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
};

async function clearRows() {
  const { getPool } = await import('../../dist/db.js');
  pool = getPool();
  await pool.query('DELETE FROM drafts WHERE id = $1', [DRAFT]);
  await pool.query('DELETE FROM threads WHERE id = $1', [THREAD]);
  await pool.query('DELETE FROM accounts WHERE lower(handle) IN ($1, $2)', [HANDLE.toLowerCase(), OTHER.toLowerCase()]);
}

before(async () => {
  await clearRows();
  PORT = await freePort();
  DATA = mkdtempSync(join(tmpdir(), 'redbot-ondemand-data-'));
  child = spawn(process.execPath, [join(HERE, 'server.mjs'), '--port', String(PORT)], {
    cwd: ROOT,
    env: { ...CHILD_ENV, REDBOT_DATA: DATA, REDBOT_UPDATE_REPO: 'redbot-tests/does-not-exist-9f3a' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => { childErr += d; });
  let banner = '';
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`console did not start in 20s: ${banner} ${childErr}`)), 20_000);
    child.stdout.on('data', (d) => { banner += String(d); if (banner.includes(`${PORT}`)) { clearTimeout(timer); res(); } });
    child.on('exit', (code) => { clearTimeout(timer); rej(new Error(`console exited ${code}: ${childErr}`)); });
  });
  for (const handle of [HANDLE, OTHER]) {
    const made = await post('/api/account/create', { handle });
    assert.equal(made.status, 200, `setup failed: ${JSON.stringify(made.body)}`);
  }
  // Two accounts, so nothing but the request or the draft can name one.
  await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();
}, { timeout: 60_000 });

after(async () => {
  try { child?.kill(); } catch { /* already gone */ }
  try { if (DATA) rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ }
  try { await clearRows(); } catch { /* best effort */ }
  try { const { closePool } = await import('../../dist/db.js'); await closePool(); } catch { /* ditto */ }
});

test('a karma check as an account whose Chrome is closed opens it first, and refuses in the opener\'s words', { timeout: 90_000 }, async () => {
  const r = await post('/api/run', { key: 'check-karma', account: HANDLE });
  assert.equal(r.body.ok, false, JSON.stringify(r.body));
  assert.match(String(r.body.error), /OnDemand_Acct's Chrome was not running and redbot could not open it/,
               `the open was not attempted before the spawn: ${JSON.stringify(r.body)}`);
  assert.match(String(r.body.error), /did not open its debugging port/, "in launchChrome's own words");
  assert.ok(!r.body.output, 'no child may have been spawned');

  /* The attempt is in the run log, which is where the operator reads what happened. */
  const hist = await (await fetch(`http://127.0.0.1:${PORT}/api/run/history?limit=1`)).json();
  const log = await (await fetch(
    `http://127.0.0.1:${PORT}/api/run/log?since=0&file=${encodeURIComponent(hist.runs[0].file)}`)).json();
  const text = log.lines.map((l) => l.text).join('\n');
  assert.match(text, /OnDemand_Acct's Chrome was not running — opening it on demand/, text);
  assert.equal(log.done, true, 'a refused open finishes its log');

  /* And the slot is free again — a failed open must not wedge every other button. */
  const rec = (await post('/api/run/reconcile', {})).body;
  assert.equal(rec.running, false, JSON.stringify(rec));
});

test('a reply whose open fails leaves no approval token behind, and ran as the draft\'s account', { timeout: 90_000 }, async () => {
  await pool.query(
    `INSERT INTO threads (id, permalink, title, subreddit, comment_count, collected_at, source)
     VALUES ($1,'/r/x/comments/ddd0de000001/t','t','x',0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'read')`, [THREAD]);
  await pool.query(
    `INSERT INTO drafts (id, thread_id, permalink, title, body, has_disclosure, created_at, model, status, account)
     VALUES ($1,$2,'/r/x/comments/ddd0de000001/t','t','body', false, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'test', 'pending', $3)`,
    [DRAFT, THREAD, HANDLE]);
  const tokenPath = join(DATA, 'approvals', `${DRAFT}.json`);

  /* The console has the OTHER account selected; the draft was written for HANDLE. */
  const r = await post('/api/publish', { draftId: DRAFT, confirm: 'SEND', reason: 'on-demand test', account: OTHER });
  assert.equal(r.body.ok, false, JSON.stringify(r.body));
  assert.match(String(r.body.error), /OnDemand_Acct's Chrome was not running/,
               'the browser opened must be the DRAFT account\'s, not the selected one');
  assert.ok(!r.body.output, 'no child may have been spawned');
  assert.equal(existsSync(tokenPath), false, 'a send that never started must not leave its approval token armed');
});
