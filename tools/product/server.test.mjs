/**
 * Setting up the FIRST account, and the first source, on the product console.
 *
 * Both had the same defect and it is pinned twice below: the button that CREATES a config file
 * refused to run until that file already existed. `/api/sources/add` answered "sources.json is
 * missing." for the same reason step 1 answered "accounts.json is missing or malformed."
 *
 * The console's step 1 ("Set the account up") is the only thing in redbot that ever writes
 * data/accounts.json — `ensureData` just makes the folder, and `loadAccounts` (src/config.ts:71)
 * reads an absent file as "no accounts configured". So a fresh install reaches that button with
 * no such file, and the button used to answer "accounts.json is missing or malformed." It
 * demanded the very file it exists to create: nobody could set up their first account without
 * hand-writing JSON, which is exactly the terminal work this console removes.
 *
 * Absence is the empty state. A file that EXISTS but will not parse is a person's own config
 * and must never be silently overwritten — that case still fails closed, and is pinned here.
 *
 * Every test points the console at a throwaway REDBOT_DATA dir, so the real data/ is untouched.
 * Run alone as:  node --test tools/product/server.test.mjs
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/**
 * Every child runs against redbot_test, never the real database.
 *
 * `accounts` is the system of record now, so these tests WRITE rows. Without this they
 * would land in the operator's own `redbot` database — the same reason each child gets a
 * throwaway REDBOT_DATA rather than the real data/.
 */
/**
 * REDBOT_DB reaches the child through `process.env`, set by `--env-file=db/sqlite/.env.test`.
 *
 * This used to pin `POSTGRES_DB: 'redbot_test'` here, because the test database was a different
 * database on the same server. A SQLite test database is a different FILE, named once in
 * .env.test and inherited — and because src/db.ts anchors a relative REDBOT_DB to the repository
 * root rather than to cwd, a child spawned from anywhere resolves the same file.
 */
const CHILD_ENV = { ...process.env };

/** The handles this file creates. Removed before and after, so a re-run starts clean. */
const HANDLES = [
  'Striking_Mousse6841', 'Second_Account42', 'Fifth_Account77', 'Fresh_Clone_Acct',
  'PortClash_Acct', 'SoleAcct_Run', 'Ambiguous_AcctA', 'Ambiguous_AcctB', 'Noted_Acct', 'Edit_Me',
  'Remove_Me', 'Port_Acct', 'Port_Other'
];

let child = null;
let PORT = 0;
let DATA = '';
let CHROME_DATA = '';
let pool = null;

/**
 * Case-INSENSITIVE, deliberately.
 *
 * accounts has a case-sensitive text primary key, but `createConsoleAccount` refuses a
 * duplicate by comparing lower-cased. So a leftover `striking_mousse6841` from an interrupted
 * run is a different row than `Striking_Mousse6841` — and an exact-match DELETE walks straight
 * past it, while the console still answers "already set up". The suite then fails on a fresh
 * checkout for a reason that has nothing to do with the code under test.
 */
async function clearTestAccounts() {
  const { getPool } = await import('../../dist/db.js');
  pool = getPool();
  await pool.query(
    'DELETE FROM accounts WHERE lower(handle) IN (SELECT j.value FROM json_each($1) j)',
    [JSON.stringify(HANDLES.map((h) => h.toLowerCase()))]
  );
}

/** Ask the OS for a port, then hand it to the console — the console has no --port 0 story. */
const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

before(async () => {
  await clearTestAccounts();
  PORT = await freePort();
  // A directory that exists but holds no accounts.json — a fresh install, precisely.
  DATA = mkdtempSync(join(tmpdir(), 'redbot-product-console-'));

  /**
   * A stand-in for the machine's Chrome data folder.
   *
   * Pointed at a fixture rather than the real one because the suite must not depend on which
   * browser — or which profiles — the machine running it happens to have. `Profile 2` is left
   * OUT of the folder listing on purpose: Chrome's Local State outlives a deleted profile
   * folder, and the endpoint has to report that rather than offer a directory that is gone.
   */
  CHROME_DATA = mkdtempSync(join(tmpdir(), 'redbot-chrome-userdata-'));
  mkdirSync(join(CHROME_DATA, 'Default'), { recursive: true });
  mkdirSync(join(CHROME_DATA, 'Profile 1'), { recursive: true });
  writeFileSync(join(CHROME_DATA, 'Local State'), JSON.stringify({
    profile: {
      last_used: 'Profile 1',
      info_cache: {
        'Profile 1': { name: 'Second', user_name: 'second@example.com' },
        'Default': { name: 'First', user_name: 'first@example.com' },
        'Profile 2': { name: 'Deleted', user_name: null }
      }
    }
  }), 'utf8');

  child = spawn(process.execPath, [join(HERE, 'server.mjs'), '--port', String(PORT)],
                { cwd: ROOT,
                  env: { ...CHILD_ENV, REDBOT_DATA: DATA, REDBOT_CHROME_USER_DATA: CHROME_DATA },
                  stdio: ['ignore', 'pipe', 'pipe'] });
  let banner = '';
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`console did not start in 15s. stdout: ${banner}`)), 15_000);
    child.stdout.on('data', (d) => {
      banner += String(d);
      if (banner.includes(`${PORT}`)) { clearTimeout(timer); res(); }
    });
    child.on('error', (e) => { clearTimeout(timer); rej(e); });
    child.on('exit', (code) => { clearTimeout(timer); rej(new Error(`console exited ${code}`)); });
  });
});

after(async () => {
  try { child?.kill(); } catch { /* already gone */ }
  try { rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ }
  try { rmSync(CHROME_DATA, { recursive: true, force: true }); } catch { /* best effort */ }
  try { await clearTestAccounts(); } catch { /* best effort */ }
  try {
    await pool.query("DELETE FROM sources WHERE value IN ('ConsoleTestSub','console test query')");
  } catch { /* best effort */ }
  try { const { closePool } = await import('../../dist/db.js'); await closePool(); } catch { /* ditto */ }
});

/* ------------------------------------------------------------------ *
 * Run logs on disk — history that survives a restart, capped at 500
 * ------------------------------------------------------------------ */

test('a finished run is written to disk and readable back', async () => {
  // In memory the log died with the process, so the output that diagnosed every defect found
  // in this console was gone the moment another action started.
  await fetch(`http://127.0.0.1:${PORT}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // `score` and not a browser action: these tests exercise the run LOG, and a fresh install
    // has no accounts, so anything marked `needsBrowser` is now refused before it can run.
    body: JSON.stringify({ key: 'score' })
  }).then((r) => r.json());

  const hist = await (await fetch(`http://127.0.0.1:${PORT}/api/run/history?limit=10`)).json();
  assert.equal(hist.keep, 500, 'the cap is reported so the UI can say what it keeps');
  assert.ok(hist.runs.length >= 1, 'the run just performed must be on disk');

  const newest = hist.runs[0];
  assert.match(newest.command, /^redbot /);
  assert.equal(newest.done, true, 'a run that exited normally is marked done');
  assert.equal(typeof newest.code, 'number');

  // And the file reads back into the same shape the live endpoint returns.
  const past = await (await fetch(
    `http://127.0.0.1:${PORT}/api/run/log?since=0&file=${encodeURIComponent(newest.file)}`)).json();
  assert.equal(past.done, true);
  assert.equal(past.running, false);
  assert.equal(past.command, newest.command);
  assert.equal(past.total, past.lines.length);
});

test('the log directory keeps at most 500 runs, newest first', async () => {
  /**
   * Verified against the directory rather than the API, because the cap is a promise about
   * disk: an endpoint that returns 500 while 900 files pile up is exactly the silent growth
   * this is meant to prevent.
   */
  const { readdirSync, writeFileSync: wf, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(DATA, 'run-logs');
  mkdirSync(dir, { recursive: true });

  // 520 synthetic runs, older than anything real (year 1990 sorts first).
  for (let i = 0; i < 520; i++) {
    const name = `1990-01-01T00-00-00-000Z__${String(i).padStart(6, '0')}.jsonl`;
    wf(join(dir, name),
       JSON.stringify({ t: 'h', id: i, key: 'synthetic', command: 'redbot synthetic', startedAt: '1990-01-01T00:00:00.000Z' }) + '\n' +
       JSON.stringify({ t: 'f', code: 0, lines: 0, dropped: 0 }) + '\n', 'utf8');
  }
  assert.ok(readdirSync(dir).filter((f) => f.endsWith('.jsonl')).length > 500, 'setup should exceed the cap');

  // Pruning happens when a run STARTS — so start one. Non-browser action, as above.
  await fetch(`http://127.0.0.1:${PORT}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'score' })
  }).then((r) => r.json());

  const after = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  assert.ok(after.length <= 500, `expected <= 500 log files, found ${after.length}`);

  // The ones kept must be the NEWEST — pruning the wrong end would delete today's evidence
  // and keep 1990's.
  assert.ok(after.some((f) => !f.startsWith('1990-')), 'the newest run must survive pruning');
});

test('a run killed mid-flight is reported as interrupted, not as complete', async () => {
  /**
   * The header is written when the run starts and the footer only when it exits, so a process
   * that dies leaves a headed, footerless file. Reporting that as `done` would make a truncated
   * log look like the whole story — the failure mode this log exists to prevent.
   */
  const { writeFileSync: wf, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(DATA, 'run-logs');
  mkdirSync(dir, { recursive: true });
  const name = '2099-01-01T00-00-00-000Z__999999.jsonl';
  wf(join(dir, name),
     JSON.stringify({ t: 'h', id: 999999, key: 'find-threads', command: 'redbot read x', startedAt: '2099-01-01T00:00:00.000Z' }) + '\n' +
     JSON.stringify({ t: 'l', at: 10, text: 'started work' }) + '\n', 'utf8');

  const hist = await (await fetch(`http://127.0.0.1:${PORT}/api/run/history?limit=5`)).json();
  const orphan = hist.runs.find((r) => r.file === name);
  assert.ok(orphan, 'the interrupted run should be listed');
  assert.equal(orphan.done, false, 'no footer means interrupted, and must be reported as such');
  assert.equal(orphan.code, null, 'an interrupted run has no exit code to report');
});

test('a run log filename outside the directory is refused', async () => {
  // The filename reaches a path join, so only a plain name shape is accepted.
  for (const bad of ['../../package.json', '..%2F..%2Fpackage.json', 'nope.txt']) {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/run/log?file=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 404, `${bad} must not resolve`);
  }
});

test('a source count matches threads Reddit stored under a different case', async () => {
  /**
   * Reddit canonicalises the name: a source added as "wordpress" comes back on every thread
   * as "Wordpress", and "crm" as "CRM". The console indexed the tally by exact key, so the
   * source row read "0 on file" while the table directly beneath it listed those very threads
   * — the collector reported as having done nothing, right above its own output.
   */
  const s = await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();
  assert.ok(s.collect.collectedByKey, 'the lower-cased index must be published');

  // Every key in the case-insensitive index is lower case, by construction.
  for (const k of Object.keys(s.collect.collectedByKey)) {
    assert.equal(k, k.toLowerCase(), `index key "${k}" is not lower-cased`);
  }

  // And it accounts for every collected thread, however Reddit cased the name.
  const expect = {};
  for (const [name, n] of Object.entries(s.collect.collected)) {
    const k = name.toLowerCase();
    expect[k] = (expect[k] || 0) + n;
  }
  assert.deepEqual(s.collect.collectedByKey, expect,
                   'the case-insensitive index must account for every collected thread');

  // The property that actually failed: a configured source finds its threads regardless of
  // the case Reddit stored them under.
  for (const sub of s.collect.subreddits) {
    const viaIndex = s.collect.collectedByKey[String(sub.name).toLowerCase()] ?? 0;
    const canonical = Object.entries(s.collect.collected)
      .filter(([n]) => n.toLowerCase() === String(sub.name).toLowerCase())
      .reduce((t, [, n]) => t + n, 0);
    assert.equal(viaIndex, canonical,
                 `source "${sub.name}" must see the threads stored under Reddit's casing`);
  }
});

/* ------------------------------------------------------------------ *
 * The live run log — output while a command is still running
 * ------------------------------------------------------------------ */

test('log lines are readable WHILE the action runs, not only after it finishes', async () => {
  /**
   * This IS the feature, so it is the assertion. `/api/run` resolves on child exit, so a test
   * that only inspected the final response would pass just as happily against the old
   * buffer-everything behaviour. Here the run is started and deliberately NOT awaited, and the
   * log is polled while the child is still alive: if lines only land at the end,
   * `sawWhileRunning` never becomes true.
   */
  /**
   * Sampled every 10ms, first poll before any sleep, and the whole observation is retried up
   * to three times.
   *
   * `score` is a NON-BROWSER action on purpose: a fresh install has no accounts, and anything
   * marked `needsBrowser` is now refused before it can run. It emits its lines about 40ms apart
   * across a window of roughly 200ms (measured 2026-07-29) — short enough that whether the
   * child's stdout reaches the parent progressively or in one flush at exit is decided by OS
   * pipe buffering, not by this server. A missed observation is therefore not a product defect,
   * and retrying the observation is what keeps the suite honest instead of merely green.
   *
   * The assertion itself is NOT relaxed: lines that only ever appear after `done` fail every
   * attempt, which is exactly the buffer-everything regression this test exists to catch.
   */
  let sawWhileRunning = false;
  let observedRunning = false;
  let final = null;

  for (let attempt = 0; attempt < 3 && !sawWhileRunning; attempt++) {
    const started = fetch(`http://127.0.0.1:${PORT}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'score' })
    }).then((r) => r.json());

    /**
     * `sawThisRun` exists because /api/run/log serves the LAST run until the next one starts.
     *
     * The POST above is deliberately not awaited, so the first poll can easily arrive before
     * the server has spawned anything — and what it reads then is the PREVIOUS run's log,
     * already `done` with lines in it. Breaking on that ended the attempt before this run had
     * begun, and `observedRunning` stayed false however many times it retried: the flake was
     * a stale read, not a slow server.
     *
     * So `done` only ends the attempt once this run has actually been seen running.
     */
    let sawThisRun = false;
    for (let i = 0; i < 2000; i++) {
      const log = await (await fetch(`http://127.0.0.1:${PORT}/api/run/log?since=0`)).json();
      if (log.running) { observedRunning = true; sawThisRun = true; }
      if (log.running && log.lines.length > 0) { sawWhileRunning = true; break; }
      if (sawThisRun && log.done && log.total > 0) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    // Awaited every attempt: the next run cannot start while this child holds the slot.
    final = await started;
  }

  assert.ok(observedRunning, 'never observed the run in flight — cannot judge liveness');
  assert.ok(sawWhileRunning, 'lines only appeared after the run finished — that is not live');
  assert.ok(final && final.command, 'the run must still return its normal result');
});

test('the log reports its command, per-line timing and completion honestly', async () => {
  const log = await (await fetch(`http://127.0.0.1:${PORT}/api/run/log?since=0`)).json();
  assert.equal(log.done, true, 'the previous run has finished by now');
  assert.equal(typeof log.code, 'number', 'a finished run reports its exit code');
  assert.match(log.command, /^redbot /, 'the log names the command that produced it');
  assert.ok(log.total > 0, 'the run produced output');
  for (const l of log.lines) {
    assert.equal(typeof l.at, 'number', 'each line carries ms-since-start for the viewer');
    assert.equal(typeof l.text, 'string');
    assert.ok(!l.text.includes(String.fromCharCode(27)),
              'ANSI colour must be stripped before it reaches HTML');
  }
});

test('since= returns only new lines, so polling stays cheap', async () => {
  const all = await (await fetch(`http://127.0.0.1:${PORT}/api/run/log?since=0`)).json();
  // However many lines this environment produced — the offset contract holds for any count.
  assert.ok(all.total >= 1, 'the run produced no output at all');

  const tail = await (await fetch(`http://127.0.0.1:${PORT}/api/run/log?since=${all.total - 1}`)).json();
  assert.equal(tail.lines.length, 1, 'since=total-1 must return exactly the last line');
  assert.deepEqual(tail.lines[0], all.lines[all.total - 1]);

  // The steady state of a poll once caught up: nothing new, no repetition of what it has.
  const caughtUp = await (await fetch(`http://127.0.0.1:${PORT}/api/run/log?since=${all.total}`)).json();
  assert.deepEqual(caughtUp.lines, [], 'a caught-up poller must receive no lines');
  assert.equal(caughtUp.total, all.total, 'total still reports the whole run');

  const past = await (await fetch(`http://127.0.0.1:${PORT}/api/run/log?since=99999`)).json();
  assert.deepEqual(past.lines, [], 'an offset past the end returns nothing, not an error');
});

/* ------------------------------------------------------------------ *
 * Sources — the same bootstrap trap the account wizard had
 * ------------------------------------------------------------------ */

const sourcePost = async (path, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/sources/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
};

test('the first source can be added when sources.json does not exist yet', async () => {
  // This returned 400 "sources.json is missing." — the endpoint demanded the file it creates,
  // so a fresh install could never switch on a single subreddit from the console.
  await pool.query("DELETE FROM sources WHERE value IN ('ConsoleTestSub','console test query')");
  const r = await sourcePost('add', { kind: 'subreddit', value: 'r/ConsoleTestSub', why: 'console test' });
  assert.equal(r.status, 200, `adding was refused: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.value, 'ConsoleTestSub', 'a pasted r/ prefix must be stripped');
  assert.equal(r.body.storedIn, 'database');

  const row = await pool.query('SELECT enabled FROM sources WHERE kind = $1 AND value = $2',
                               ['subreddit', 'ConsoleTestSub']);
  assert.equal(row.rows[0]?.enabled, true, 'the source must be a row in sources');
});

test('the collect panel renders on a fresh install instead of vanishing', async () => {
  const s = await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();
  // `collect` used to be null whenever sources.json was absent, so the whole "what do we
  // collect" screen simply did not render — no list, and no sign that the answer was "none yet".
  assert.ok(s.collect, 'the collect panel must exist');
  assert.equal(s.collect.from, 'database');
  assert.ok(s.collect.subreddits.some((x) => x.name === 'ConsoleTestSub'));
});

test('a source already on the list is refused, and a bad subreddit name with it', async () => {
  const dup = await sourcePost('add', { kind: 'subreddit', value: 'consoletestsub' });
  assert.equal(dup.status, 400);
  assert.match(dup.body.error, /already on the list/);

  const bad = await sourcePost('add', { kind: 'subreddit', value: 'not a sub!' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /2–21 characters/);
});

test('a source can be removed through the console', async () => {
  const r = await sourcePost('remove', { kind: 'subreddit', value: 'ConsoleTestSub' });
  assert.equal(r.status, 200, `removal was refused: ${JSON.stringify(r.body)}`);
  const row = await pool.query('SELECT 1 FROM sources WHERE value = $1', ['ConsoleTestSub']);
  assert.equal(row.rowCount, 0, 'the row must be gone from the record');

  const again = await sourcePost('remove', { kind: 'subreddit', value: 'ConsoleTestSub' });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /Not on the list/);
});

/** Is this handle in accounts? The record, not the seed file. */
async function inDatabase(handle) {
  const r = await pool.query('SELECT handle, debug_port, profile_dir FROM accounts WHERE handle = $1', [handle]);
  return r.rows[0] ?? null;
}

const accountsPath = () => join(DATA, 'accounts.json');

/**
 * Remove a handle from BOTH stores.
 *
 * Deleting only the row is not a clean slate: `knownAccounts()` merges the seed file with the
 * database, so an account still listed in accounts.json makes the next `create` refuse with
 * "already set up" — which is a test tripping over its own leftovers, not a defect. Written
 * once here so every test that re-uses a handle starts from the same nothing.
 */
async function forgetAccount(handle) {
  await pool.query('DELETE FROM accounts WHERE lower(handle) = $1', [handle.toLowerCase()]);
  if (!existsSync(accountsPath())) return;
  try {
    const seed = JSON.parse(readFileSync(accountsPath(), 'utf8'));
    if (!Array.isArray(seed.accounts)) return;
    seed.accounts = seed.accounts.filter(
      (a) => !(a && typeof a.handle === 'string' && a.handle.toLowerCase() === handle.toLowerCase()));
    writeFileSync(accountsPath(), JSON.stringify(seed, null, 2), 'utf8');
  } catch { /* a file this test did not write is not this test's to repair */ }
}

const create = async (body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/account/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
};

/* ------------------------------------------------------------------ *
 * First run — no accounts.json on disk at all
 * ------------------------------------------------------------------ */

test('the first account can be set up when accounts.json does not exist yet', async () => {
  assert.equal(existsSync(accountsPath()), false, 'precondition: a fresh install has no accounts.json');

  // The exact shape the wizard's form sends.
  const r = await create({
    handle: 'Striking_Mousse6841',
    role: 'support desk',
    speaks: 'error messages, plugins stuck up',
    subreddits: ['WordPress']
  });

  assert.equal(r.status, 200, `setup was refused: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.account.handle, 'Striking_Mousse6841');

  // The system of record is accounts — not the file. This is the assertion that would
  // have failed while the console wrote only JSON.
  assert.equal(r.body.storedIn, 'database');
  const row = await inDatabase('Striking_Mousse6841');
  assert.ok(row, 'the account must be a row in accounts');
  assert.equal(row.debug_port, r.body.account.debugPort);
  assert.equal(row.profile_dir, r.body.account.profileDir);

  // And the seed file mirrors it, so config.browser still resolves when the database is down.
  assert.equal(existsSync(accountsPath()), true, 'accounts.json must exist after step 1');
  const onDisk = JSON.parse(readFileSync(accountsPath(), 'utf8'));
  assert.ok(Array.isArray(onDisk.accounts), 'the file must carry an "accounts" array');
  assert.equal(onDisk.accounts.length, 1);
  assert.equal(onDisk.accounts[0].handle, 'Striking_Mousse6841');
  // Step 2 (open the browser) cannot work without these two, so step 1 must have chosen them.
  assert.ok(onDisk.accounts[0].debugPort > 0, 'an account needs its own debug port');
  assert.ok(onDisk.accounts[0].profileDir, 'an account needs its own browser folder');
});

test('the second account gets its own port and its own browser folder', async () => {
  const first = JSON.parse(readFileSync(accountsPath(), 'utf8')).accounts[0];
  const r = await create({ handle: 'Second_Account42', role: 'docs', subreddits: ['WordPress'] });
  assert.equal(r.status, 200, `second setup was refused: ${JSON.stringify(r.body)}`);
  // Two accounts sharing a port or a profile would drive the same Chrome — the thing
  // per-account ports exist to prevent.
  assert.notEqual(r.body.account.debugPort, first.debugPort);
  assert.notEqual(r.body.account.profileDir, first.profileDir);
  assert.equal(JSON.parse(readFileSync(accountsPath(), 'utf8')).accounts.length, 2);
});

test('an account already set up is not set up twice', async () => {
  const r = await create({ handle: 'striking_mousse6841' });   // same handle, different case
  assert.equal(r.status, 400);
  assert.match(r.body.error, /already set up/);
  assert.equal(JSON.parse(readFileSync(accountsPath(), 'utf8')).accounts.length, 2, 'no entry was appended');
});

test('a username that is not a Reddit username is refused before anything is written', async () => {
  const before = readFileSync(accountsPath(), 'utf8');
  const r = await create({ handle: 'no' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /3–20 characters/);
  assert.equal(readFileSync(accountsPath(), 'utf8'), before, 'the file must be untouched');
});

/* ------------------------------------------------------------------ *
 * A file that exists but is broken — fail closed, never clobber
 * ------------------------------------------------------------------ */

test('a corrupt accounts.json is refused and left exactly as the person wrote it', async () => {
  const corrupt = '{ "accounts": [ this is not JSON';
  writeFileSync(accountsPath(), corrupt, 'utf8');

  const r = await create({ handle: 'Third_Account99' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /accounts\.json/);
  // The whole point: absence bootstraps, corruption does NOT get overwritten with a fresh file.
  assert.equal(readFileSync(accountsPath(), 'utf8'), corrupt,
               'a config file that failed to parse must never be silently replaced');
});

test('accounts.json holding the wrong shape is refused, not overwritten', async () => {
  const wrongShape = JSON.stringify({ accounts: { handle: 'not-an-array' } }, null, 2);
  writeFileSync(accountsPath(), wrongShape, 'utf8');

  const r = await create({ handle: 'Fourth_Account11' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /accounts\.json/);
  assert.equal(readFileSync(accountsPath(), 'utf8'), wrongShape);
});

test('an entry with no handle does not crash the setup button', async () => {
  // Hand-written config is the normal way this file comes to exist, so a half-filled entry
  // must produce a refusal a person can act on, not an unhandled TypeError.
  writeFileSync(accountsPath(), JSON.stringify({ accounts: [{ role: 'no handle here' }] }, null, 2), 'utf8');
  const r = await create({ handle: 'Fifth_Account77' });
  assert.equal(r.status, 200, `a malformed neighbour blocked an unrelated setup: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.account.handle, 'Fifth_Account77');
});

test('opening a browser for an unknown account reports the reason, not an empty body', async () => {
  /**
   * Pins the missing `await`. launchChrome became async when it started reading the port from
   * accounts; the route still called it synchronously, so `r` was a Promise — `r.ok`
   * undefined, status 400, body `{}`. The real launch worked and the console showed a failure.
   *
   * An unknown handle is used deliberately: it exercises the same route and the same await,
   * and returns before spawning anything, so this test never opens a browser window.
   */
  const r = await fetch(`http://127.0.0.1:${PORT}/api/account/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle: 'NoSuchAccount_ZZ' })
  });
  const body = await r.json();
  assert.equal(r.status, 400);
  assert.equal(body.ok, false);
  // The regression signature: an un-awaited Promise serialises to `{}` — no keys at all.
  assert.ok(Object.keys(body).length > 0, 'an un-awaited Promise serialises to {} — it must not');
  assert.match(body.error, /is not set up/);
});

test('a browser action runs as the only configured account, even when the request omits it', async () => {
  /**
   * The collect button sent {key:'find-threads', subreddit} and no account, so the child fell
   * back to config.browser's default debug port — 9222, which on the machine this was found on
   * belonged to Lenovo Vantage's Edge. redbot drove THAT browser, found no subreddit feed, and
   * reported "Found 0 post links" as if Reddit had served nothing.
   *
   * Asserted through the spawned command rather than the browser: the child refuses on an
   * unknown handle, and the refusal names the handle it was given — which is exactly the
   * evidence that REDBOT_ACCOUNT reached it. Same technique as the operator console's test.
   */
  await pool.query("DELETE FROM accounts WHERE lower(handle) IN (SELECT j.value FROM json_each($1) j)",
                   [JSON.stringify(HANDLES.map((h) => h.toLowerCase()))]);
  const made = await create({ handle: 'SoleAcct_Run' });
  assert.equal(made.status, 200, `setup failed: ${JSON.stringify(made.body)}`);

  try {
    // No `account` in the body — the omission that caused the bug.
    const r = await fetch(`http://127.0.0.1:${PORT}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'check-karma' })
    });
    const body = await r.json();
    const text = String(body.output ?? body.error ?? '');

    // It must NOT have silently used the default endpoint. Either it ran as the sole account,
    // or it says why it could not — never "acted as nobody in particular".
    assert.ok(!/Unknown command/.test(text), `the action did not run at all: ${text}`);
    assert.ok(text.length > 0, 'the run produced no output at all');
  } finally {
    await pool.query("DELETE FROM accounts WHERE lower(handle) = 'soleacct_run'");
  }
});

/* ------------------------------------------------------------------ *
 * Setup — the install-time surface
 * ------------------------------------------------------------------ */

test('the machine’s Chrome profiles are listed from Chrome’s own record, Default first', async () => {
  const r = await (await fetch(`http://127.0.0.1:${PORT}/api/chrome/profiles`)).json();
  assert.equal(r.available, true, `profiles were not readable: ${r.reason}`);

  // Chrome shows Default first and then Profile N; the list a person recognises is that order,
  // not the arbitrary key order of the JSON object it came out of.
  assert.deepEqual(r.profiles.map((p) => p.directory), ['Default', 'Profile 1', 'Profile 2']);
  assert.equal(r.profiles[0].name, 'First');
  assert.equal(r.profiles[0].email, 'first@example.com');
  assert.equal(r.lastUsed, 'Profile 1');

  /* Local State outlives a deleted profile folder, so "listed" and "still there" are two
     different facts and the caller is told both. */
  const gone = r.profiles.find((p) => p.directory === 'Profile 2');
  assert.equal(gone.onDisk, false, 'a profile whose folder is gone must be reported as gone');
  assert.equal(r.profiles.find((p) => p.directory === 'Default').onDisk, true);

  /**
   * The flag that stops this list being mistaken for "reuse this login".
   *
   * Measured 2026-07-29 on Chrome 150: launching against the real User Data folder with
   * --profile-directory DOES open a CDP port, but that browser carries none of the profile's
   * cookies — the Chrome 136 restriction. An account pointed there reads Reddit signed out
   * while looking perfectly healthy.
   */
  assert.equal(r.usableForAutomation, false);
  assert.match(r.whyNotUsable, /remote debugging/i);
});

/* ------------------------------------------------------------------ *
 * The approval token is a capability, not a receipt
 * ------------------------------------------------------------------ */

test('a send that cannot start leaves no approval token behind', async () => {
  /**
   * THE BUG THIS PINS. `publish()` wrote data/approvals/<id>.json and THEN called runAction.
   * Every refusal runAction can give — the slot is busy, the account is ambiguous, the loop
   * holds that Chrome — therefore left a live single-use send authorisation on disk. For five
   * minutes (src/ask.ts APPROVAL_TTL_MS) any `redbot reply` for that draft would consume it
   * and post, with nobody typing SEND again.
   *
   * Driven through the AMBIGUOUS-ACCOUNT refusal on purpose: two accounts configured and none
   * named means `__reply` is refused before a child is ever spawned, so this test can never
   * publish to Reddit no matter what the code under it does.
   */
  const thread = await pool.query('SELECT id, permalink, title FROM threads LIMIT 1');
  if (!thread.rows.length) { assert.ok(true, 'no threads in the test database — nothing to draft against'); return; }
  const t = thread.rows[0];
  const draftId = 'tok_test_draft';

  await forgetAccount('Ambiguous_AcctA');
  await forgetAccount('Ambiguous_AcctB');
  await pool.query('DELETE FROM drafts WHERE id = $1', [draftId]);
  await pool.query(
    `INSERT INTO drafts (id, thread_id, permalink, title, body, has_disclosure, created_at, model)
     VALUES ($1,$2,$3,$4,$5,false,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'test')`,
    [draftId, t.id, t.permalink ?? '/r/x/comments/y/z', t.title ?? 'title', 'body']);

  const tokenPath = join(DATA, 'approvals', `${draftId}.json`);
  try {
    const a = await create({ handle: 'Ambiguous_AcctA' });
    const b = await create({ handle: 'Ambiguous_AcctB' });
    assert.equal(a.status, 200, `setup failed: ${JSON.stringify(a.body)}`);
    assert.equal(b.status, 200, `setup failed: ${JSON.stringify(b.body)}`);
    // The console re-reads accounts on every state poll; force one so `soleAccountHandle` is null.
    await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();

    const r = await fetch(`http://127.0.0.1:${PORT}/api/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId, confirm: 'SEND', reason: 'regression test' })
    });
    const body = await r.json();

    assert.equal(body.ok, false, 'an ambiguous account must refuse the send');
    assert.ok(!body.output, 'and no child may have been spawned');
    assert.equal(existsSync(tokenPath), false,
                 'a refused send must leave NO approval token — it authorises an unattended reply');
  } finally {
    try { if (existsSync(tokenPath)) rmSync(tokenPath, { force: true }); } catch { /* best effort */ }
    await pool.query('DELETE FROM drafts WHERE id = $1', [draftId]);
    await forgetAccount('Ambiguous_AcctA');
    await forgetAccount('Ambiguous_AcctB');
  }
});

/* ------------------------------------------------------------------ *
 * The loop and a button must not drive one Chrome
 * ------------------------------------------------------------------ */

test('a browser action is refused while the loop holds that account’s Chrome', async () => {
  /**
   * THE BUG THIS PINS. `running` guarded one button against another and `autoProc` guarded one
   * loop against another, and neither consulted the other — so starting the loop as an account
   * and then collecting as that same account put two processes on one CDP endpoint, both
   * opening pages and both writing threads.
   *
   * The loop is started and stopped inside a few milliseconds: the guard is synchronous, so
   * the assertion does not need the child to do anything, and the child is killed long before
   * a cycle could reach the model.
   */
  await forgetAccount('SoleAcct_Run');
  try {
    const made = await create({ handle: 'SoleAcct_Run' });
    assert.equal(made.status, 200, `setup failed: ${JSON.stringify(made.body)}`);
    await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();

    const started = await fetch(`http://127.0.0.1:${PORT}/api/auto/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'SoleAcct_Run', everyMinutes: 15 })
    }).then((x) => x.json());
    assert.equal(started.ok, true, `the loop did not start: ${JSON.stringify(started)}`);

    try {
      const clash = await fetch(`http://127.0.0.1:${PORT}/api/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'find-threads', subreddit: 'wordpress', account: 'SoleAcct_Run' })
      }).then((x) => x.json());
      assert.equal(clash.ok, false, 'collecting as the account the loop is driving must be refused');
      assert.match(clash.error, /unattended loop/i, 'and the refusal must say why');
      assert.ok(!clash.output, 'no child may have been spawned');

      /* A DIFFERENT account is two browsers and no conflict — the loop was deliberately kept
         out of the one-at-a-time lock so it could never block a person, and that still holds. */
      const other = await fetch(`http://127.0.0.1:${PORT}/api/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'score' })
      }).then((x) => x.json());
      assert.ok(!/unattended loop/i.test(String(other.error ?? '')),
                'an action that drives no browser must not be blocked by the loop');
    } finally {
      await fetch(`http://127.0.0.1:${PORT}/api/auto/stop`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
      });
    }
  } finally {
    await forgetAccount('SoleAcct_Run');
  }
});

/* ------------------------------------------------------------------ *
 * Editing an account
 * ------------------------------------------------------------------ */

test('an account’s description can be edited, in the record and the seed alike', async () => {
  await forgetAccount('Edit_Me');
  try {
    const made = await create({ handle: 'Edit_Me', role: 'Before', subreddits: ['WordPress'] });
    assert.equal(made.status, 200, `setup failed: ${JSON.stringify(made.body)}`);

    const r = await fetch(`http://127.0.0.1:${PORT}/api/account/update`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'Edit_Me', role: 'After', speaks: 'plugin conflicts',
        subreddits: ['Wordpress_Help', 'woocommerce'],
        timezone: 'Europe/London', quietHours: [1, 7], dailyCeiling: 4, note: 'edited'
      })
    });
    const body = await r.json();
    assert.equal(r.status, 200, `update was refused: ${JSON.stringify(body)}`);
    assert.equal(body.account.role, 'After');

    /* Both stores, because the CLI reads the seed file synchronously and the database is the
       record: an edit that lands in one is an account that behaves differently depending on
       which half of redbot is asking. */
    const row = await pool.query(
      'SELECT role, speaks, subreddits, timezone, quiet_start, quiet_end, daily_ceiling, note FROM accounts WHERE handle = $1',
      ['Edit_Me']);
    assert.equal(row.rows[0].role, 'After');
    assert.equal(row.rows[0].speaks, 'plugin conflicts');
    assert.deepEqual(row.rows[0].subreddits, ['Wordpress_Help', 'woocommerce']);
    assert.equal(row.rows[0].timezone, 'Europe/London');
    assert.equal(row.rows[0].quiet_start, 1);
    assert.equal(row.rows[0].daily_ceiling, 4);

    const seeded = JSON.parse(readFileSync(join(DATA, 'accounts.json'), 'utf8'));
    const mirrored = seeded.accounts.filter((a) => a.handle === 'Edit_Me');
    assert.equal(mirrored.length, 1, 'editing must REPLACE the seed entry, never append a second');
    assert.equal(mirrored[0].role, 'After');
  } finally {
    await forgetAccount('Edit_Me');
  }
});

test('editing cannot repoint an account at another Chrome, and says so', async () => {
  await forgetAccount('Edit_Me');
  try {
    const made = await create({ handle: 'Edit_Me' });
    assert.equal(made.status, 200, `setup failed: ${JSON.stringify(made.body)}`);
    const port = made.body.account.debugPort;
    const dir = made.body.account.profileDir;

    const r = await fetch(`http://127.0.0.1:${PORT}/api/account/update`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'Edit_Me', role: 'Changed', debugPort: 9999, profileDir: 'somewhere-else' })
    });
    const body = await r.json();
    assert.equal(r.status, 200);

    /**
     * The whole reason these two are excluded. A signed-in account moved to another port
     * attaches to whatever is there — or to nothing — and reads Reddit signed out while the
     * card still shows a configured account. Silent, not loud.
     */
    assert.equal(body.account.debugPort, port, 'the debug port must be carried over, not taken from the request');
    assert.equal(body.account.profileDir, dir, 'the profile folder must be carried over');
    assert.deepEqual(body.ignored.sort(), ['debugPort', 'profileDir'],
                     'a refused field must be named, not silently dropped');
    assert.equal(body.account.role, 'Changed', 'the editable fields must still have applied');

    const row = await pool.query('SELECT debug_port, profile_dir FROM accounts WHERE handle = $1', ['Edit_Me']);
    assert.equal(row.rows[0].debug_port, port, 'and the record must not have moved either');
    assert.equal(row.rows[0].profile_dir, dir);
  } finally {
    await forgetAccount('Edit_Me');
  }
});

test('editing refuses an unknown account and nonsense limits', async () => {
  const post = (b) => fetch(`http://127.0.0.1:${PORT}/api/account/update`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b)
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  const missing = await post({ handle: 'NoSuchAccount_ZZ', role: 'x' });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /is not set up/);

  await forgetAccount('Edit_Me');
  try {
    await create({ handle: 'Edit_Me' });
    const badQuiet = await post({ handle: 'Edit_Me', quietHours: [0, 44] });
    assert.equal(badQuiet.status, 400, 'an hour outside a day must be refused');
    const badCeiling = await post({ handle: 'Edit_Me', dailyCeiling: -3 });
    assert.equal(badCeiling.status, 400, 'a negative ceiling must be refused');
  } finally {
    await forgetAccount('Edit_Me');
  }
});

test('the Chrome profile a person picks is written onto the account, not dropped', async () => {
  /* The wizard sends the choice as the account's note. If that field were ignored the picker
     would look like it worked and record nothing — so the round trip is asserted, not assumed. */
  await pool.query('DELETE FROM accounts WHERE lower(handle) = $1', ['noted_acct']);
  try {
    const made = await create({ handle: 'Noted_Acct', note: 'Signed in on Chrome profile "Qt" — Profile 1' });
    assert.equal(made.status, 200, `setup failed: ${JSON.stringify(made.body)}`);

    const row = await pool.query('SELECT note FROM accounts WHERE handle = $1', ['Noted_Acct']);
    assert.match(row.rows[0].note, /Profile 1/, 'the picked profile must survive to the record');

    const seeded = JSON.parse(readFileSync(join(DATA, 'accounts.json'), 'utf8'));
    const mirrored = seeded.accounts.find((a) => a.handle === 'Noted_Acct');
    assert.match(mirrored.note, /Profile 1/, 'and the seed file must agree with the record');
  } finally {
    await pool.query('DELETE FROM accounts WHERE lower(handle) = $1', ['noted_acct']);
  }
});

test('a missing Chrome data folder is reported as missing, not as zero profiles', async () => {
  /* Absent and empty are different answers — the same rule the rest of this console follows.
     Asserted through a second server so the main one keeps its fixture. */
  const port = await freePort();
  const kid = spawn(process.execPath, [join(HERE, 'server.mjs'), '--port', String(port)],
                    { cwd: ROOT,
                      env: { ...CHILD_ENV, REDBOT_DATA: DATA, REDBOT_CHROME_USER_DATA: join(DATA, 'no-such-chrome') },
                      stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let banner = '';
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`did not start: ${banner}`)), 15_000);
      kid.stdout.on('data', (d) => { banner += String(d); if (banner.includes(`${port}`)) { clearTimeout(timer); res(); } });
      kid.on('error', (e) => { clearTimeout(timer); rej(e); });
    });
    const r = await (await fetch(`http://127.0.0.1:${port}/api/chrome/profiles`)).json();
    assert.equal(r.available, false);
    assert.deepEqual(r.profiles, []);
    assert.ok(r.reason && r.reason.length > 0, 'an unavailable list must say why');
  } finally { kid.kill(); }
});

test('/api/setup reports each prerequisite separately, and never a secret value', async () => {
  const s = await (await fetch(`http://127.0.0.1:${PORT}/api/setup`)).json();

  // Absence reported as absence: three different "not ready" answers, three different fields.
  assert.ok(s.database && typeof s.database.ok === 'boolean', 'database status must be its own answer');
  assert.ok(s.vault && typeof s.vault.ok === 'boolean', 'vault status must be its own answer');
  assert.ok(Array.isArray(s.operators), 'operators must be a list, even when empty');
  assert.equal(s.apiKeyName, 'anthropic_api_key');
  assert.ok(s.provider === 'cli' || s.provider === 'api', `provider must be cli or api, got ${s.provider}`);

  /**
   * The whole point of the vault is that a stored secret does not come back out.
   * `src/commands/vault.ts` has no `get` for exactly this reason; an endpoint that
   * returned one would undo that decision from a different file.
   */
  for (const c of s.secrets) {
    assert.ok(!('value' in c), 'a credential summary must never carry a value');
    assert.ok(!('ciphertext' in c), 'not even the sealed bytes belong in an HTTP response');
    if (c.hint !== null) assert.ok(c.hint.length <= 4, 'the hint identifies a key, it does not reveal one');
  }
});

test('an operator can be registered from the console, but signing in stays a terminal job', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/operator/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'console_made' })
  });
  const body = await r.json();
  assert.equal(r.status, 200, `create was refused: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true);
  /* The console can make the folder; it cannot type /login into an interactive Claude. So the
     command must come back, or the operator is registered and unusable with nothing said. */
  assert.match(body.signIn.powershell, /CLAUDE_CONFIG_DIR/);
  assert.match(body.signIn.bash, /CLAUDE_CONFIG_DIR/);
  assert.ok(existsSync(join(DATA, 'operators', 'console_made', 'claude')),
            'the login folder must actually exist afterwards');

  // It shows up as registered but NOT ready — the folder exists, a login does not.
  const ops = await (await fetch(`http://127.0.0.1:${PORT}/api/operators`)).json();
  assert.ok(ops.operators.some((o) => o.name === 'console_made'));

  const dup = await fetch(`http://127.0.0.1:${PORT}/api/operator/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'console_made' })
  });
  assert.equal(dup.status, 400, 'registering the same name twice must be refused');

  const bad = await fetch(`http://127.0.0.1:${PORT}/api/operator/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '../escape' })
  });
  assert.equal(bad.status, 400, 'a name that is a path must never reach the filesystem');
  assert.equal(existsSync(join(DATA, 'operators', '..', 'escape')), false);
});

test('the LLM path can be switched, and only to a value redbot understands', async () => {
  const set = async (provider) => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/llm/provider`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider })
    });
    return { status: r.status, body: await r.json() };
  };

  const api = await set('api');
  assert.equal(api.status, 200);
  assert.equal((await (await fetch(`http://127.0.0.1:${PORT}/api/setup`)).json()).provider, 'api');

  const junk = await set('gpt');
  assert.equal(junk.status, 400, 'an unknown provider must be refused, not stored');
  assert.equal((await (await fetch(`http://127.0.0.1:${PORT}/api/setup`)).json()).provider, 'api',
               'a refused value must not have changed anything');

  await set('cli');   // leave it as found
});

test('with two accounts a browser action is refused, not pointed at the default debug port', async () => {
  /**
   * The other half of the bug above, and the half the first fix missed.
   *
   * `soleAccountHandle` only resolves when EXACTLY ONE account exists. With two it is null,
   * REDBOT_ACCOUNT went unset, and src/config.ts `selectedAccount()` returns null rather than
   * throwing — so `resolveEndpoint()` fell through to its hardcoded 127.0.0.1:9222. On the
   * machine this was found on that port answered /json/version as "LenovoVantage/3.0.0.191".
   * The console's comment claimed this case "fails closed"; it did not. Now it does.
   *
   * Asserted on the REFUSAL rather than on the browser: the run must not start at all.
   */
  await pool.query('DELETE FROM accounts WHERE lower(handle) IN (SELECT j.value FROM json_each($1) j)',
                   [JSON.stringify(HANDLES.map((h) => h.toLowerCase()))]);
  const a = await create({ handle: 'Ambiguous_AcctA' });
  const b = await create({ handle: 'Ambiguous_AcctB' });
  assert.equal(a.status, 200, `setup failed: ${JSON.stringify(a.body)}`);
  assert.equal(b.status, 200, `setup failed: ${JSON.stringify(b.body)}`);

  try {
    // The console re-reads accounts on every state poll; force one so the server is current.
    await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();

    const r = await fetch(`http://127.0.0.1:${PORT}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'find-threads', subreddit: 'wordpress' })
    });
    const body = await r.json();

    assert.equal(body.ok, false, 'an ambiguous browser action must be refused');
    assert.ok(!body.output, 'the child must not have been spawned at all');
    assert.match(body.error, /which account/i, 'the refusal must say what is missing');
    // Naming the candidates is the difference between a dead end and a next step.
    assert.match(body.error, /Ambiguous_AcctA/, 'the refusal must name the configured accounts');
    assert.match(body.error, /Ambiguous_AcctB/, 'the refusal must name the configured accounts');

    // And the gate must be narrow: an action that never attaches a browser still runs.
    const ok = await fetch(`http://127.0.0.1:${PORT}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'score' })
    });
    const okBody = await ok.json();
    assert.ok(String(okBody.output ?? okBody.error ?? '').length > 0,
              'a non-browser action must not be caught by the account gate');
  } finally {
    await pool.query('DELETE FROM accounts WHERE lower(handle) IN (SELECT j.value FROM json_each($1) j)',
                     [JSON.stringify(['ambiguous_accta', 'ambiguous_acctb'])]);
  }
});

/* ------------------------------------------------------------------ *
 * Port allocation — LAST on purpose.
 *
 * This test creates an account, which writes accounts.json into the shared REDBOT_DATA
 * dir. Run earlier, it breaks the "a fresh install has no accounts.json" precondition of
 * the tests above. A test that mutates shared state belongs after the ones that assert a
 * pristine one.
 * ------------------------------------------------------------------ */

test('an account is never given a port another program already holds', async () => {
  // Reproduces the real failure: Lenovo Vantage's Edge WebView2 held 9222, the allocator
  // handed 9222 to the first account anyway, and redbot then attached to THAT browser and
  // reported "not signed in on this profile" for an account that was signed in fine.
  // Hold 9222 ourselves — UNLESS something on this machine already does, which is the exact
  // condition being reproduced. On the machine this bug was found on, Lenovo Vantage owns it,
  // and a test that insisted on binding it first would fail on the very box that has the bug.
  const squatter = createServer();
  const weBoundIt = await new Promise((res) => {
    squatter.once('error', () => res(false));            // EADDRINUSE — someone else has it
    squatter.once('listening', () => res(true));
    squatter.listen(9222, '127.0.0.1');
  });

  try {
    await pool.query("DELETE FROM accounts WHERE handle = 'PortClash_Acct'");
    const r = await create({ handle: 'PortClash_Acct' });
    assert.equal(r.status, 200, `setup was refused: ${JSON.stringify(r.body)}`);

    const given = r.body.account.debugPort;
    assert.notEqual(given, 9222, 'must not hand out the port the squatter holds');
    assert.ok(given > 9222 && given <= 9299, `expected a port past the squatter, got ${given}`);

    // And the port it DID hand out must actually be bindable — the property that matters.
    const probe = createServer();
    const bindable = await new Promise((res) => {
      probe.once('error', () => res(false));
      probe.once('listening', () => probe.close(() => res(true)));
      probe.listen(given, '127.0.0.1');
    });
    assert.equal(bindable, true, `port ${given} was handed out but is not free`);
  } finally {
    if (weBoundIt) await new Promise((res) => squatter.close(res));
    try { await pool.query("DELETE FROM accounts WHERE handle = 'PortClash_Acct'"); } catch {}
  }
});

/* ------------------------------------------------------------------ *
 * Which Chrome profile the account is signed into, and removing an account
 *
 * The dropdown existed long before the field did. `index.html` posted the pick and the server
 * dropped it: the only trace was the sentence the wizard also wrote into `note`. So the edit
 * panel had nothing to pre-select, changing the answer meant rewriting prose (and clobbering
 * whatever note the person had written), and no query could say which account owned a login.
 * 0013 gives it a column. These pin the things that were impossible before.
 * ------------------------------------------------------------------ */

test('removing an account takes it out of both stores and keeps the sign-in folder', async () => {
  await forgetAccount('Remove_Me');
  try {
    const made = await create({ handle: 'Remove_Me' });
    assert.equal(made.status, 200, `setup failed: ${JSON.stringify(made.body)}`);
    const dir = made.body.account.profileDir;

    const r = await fetch(`http://127.0.0.1:${PORT}/api/account/remove`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'Remove_Me' })
    });
    const body = await r.json();
    assert.equal(r.status, 200, `remove was refused: ${JSON.stringify(body)}`);
    assert.deepEqual(body.removedFrom.sort(), ['database', 'seed-file'],
                     'an account left in either store comes back on the next read');

    const row = await pool.query('SELECT handle FROM accounts WHERE lower(handle) = $1', ['remove_me']);
    assert.equal(row.rowCount, 0, 'the record must be gone');
    const seeded = JSON.parse(readFileSync(accountsPath(), 'utf8'));
    assert.equal(seeded.accounts.some((a) => a.handle === 'Remove_Me'), false, 'and the seed file too');

    /* The folder is the ONLY copy of that Reddit session — redbot stores no password and could
       not sign back in. Removing a config row must not be the thing that loses an account. */
    assert.equal(body.profileDirKept, dir, 'the removal must name the folder it left behind');
  } finally {
    await forgetAccount('Remove_Me');
  }
});

test('removing an account that has history refuses until it is confirmed', async () => {
  await forgetAccount('Remove_Me');
  try {
    await create({ handle: 'Remove_Me' });
    /* jobs.account is ON DELETE CASCADE (0008_jobs.up.sql:27): the database deletes
       these with the account. A one-click button that silently destroys a run history is the
       kind of thing nobody notices until the week it matters. */
    await pool.query("INSERT INTO jobs (id, account, kind) VALUES ($1, $2, 'search')",
                     ['job-remove-test-1', 'Remove_Me']);

    const asked = await fetch(`http://127.0.0.1:${PORT}/api/account/remove`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'Remove_Me' })
    });
    const askedBody = await asked.json();
    assert.equal(asked.status, 409, 'a well-formed request stopped by the state of the world is not a 400');
    assert.equal(askedBody.needsConfirm, true);
    assert.equal(askedBody.dependents.jobs, 1, 'the warning must be a real count, not a maybe');
    assert.match(askedBody.error, /1 job record/);

    const still = await pool.query('SELECT handle FROM accounts WHERE lower(handle) = $1', ['remove_me']);
    assert.equal(still.rowCount, 1, 'refusing must write NOTHING — not the row, not the file');
    const seededStill = JSON.parse(readFileSync(accountsPath(), 'utf8'));
    assert.equal(seededStill.accounts.some((a) => a.handle === 'Remove_Me'), true);

    const done = await fetch(`http://127.0.0.1:${PORT}/api/account/remove`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'Remove_Me', confirm: true })
    });
    assert.equal(done.status, 200, `confirmed removal was refused: ${JSON.stringify(await done.json())}`);
    assert.equal((await pool.query('SELECT handle FROM accounts WHERE lower(handle) = $1', ['remove_me'])).rowCount, 0);
    assert.equal((await pool.query('SELECT id FROM jobs WHERE id = $1', ['job-remove-test-1'])).rowCount, 0,
                 'and the cascade the warning described must be exactly what happened');
  } finally {
    await pool.query('DELETE FROM jobs WHERE id = $1', ['job-remove-test-1']);
    await forgetAccount('Remove_Me');
  }
});

test('removing an account nobody set up is refused rather than reported as done', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/account/remove`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle: 'Never_Existed_Acct' })
  });
  const body = await r.json();
  assert.equal(r.status, 400);
  assert.match(body.error, /not set up/);
  assert.notEqual(body.needsConfirm, true, 'there is nothing to confirm about an account that does not exist');
});

/* ------------------------------------------------------------------ *
 * What is actually on an account's debugging port
 *
 * The check this replaces was `fetch('/json/version').ok`, and on the development machine it
 * reported healthy for a browser that was not ours: port 9222 there is held by Lenovo
 * Vantage's Edge WebView2, which speaks CDP perfectly. redbot attached to it, asked who was
 * signed in, and reported a signed-out account whose real Chrome was signed in fine.
 *
 * So these pin OWNERSHIP, not reachability. The fixture is a plain listener carrying a
 * --user-data-dir on its command line, because that flag is the only thing ports.ts reads to
 * decide whose browser it is — see tools/product/port-fixture.mjs.
 * ------------------------------------------------------------------ */


/** Poll a condition that lives in THIS process — a port going quiet is not a page event. */
async function until(fn, label, ms = 10_000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms}ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 60));
  }
}

/** Start a fake browser on `port` claiming `dir`, and resolve once it is actually listening. */
async function holdPort(port, dir) {
  const kid = spawn(process.execPath, [join(HERE, 'port-fixture.mjs'), String(port), `--user-data-dir=${dir}`],
                    { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`fixture did not listen on ${port} in 10s`)), 10_000);
    kid.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(timer); res(); } });
    kid.on('error', (e) => { clearTimeout(timer); rej(e); });
    kid.on('exit', (c) => { clearTimeout(timer); rej(new Error(`fixture exited ${c}`)); });
  });
  return kid;
}

const ports = () => fetch(`http://127.0.0.1:${PORT}/api/ports`).then((r) => r.json());
const portFor = async (handle) => (await ports()).ports.find((p) => p.handle === handle);

test('a port nobody is listening on reads as not running', async () => {
  await forgetAccount('Port_Acct');
  try {
    const made = await create({ handle: 'Port_Acct' });
    assert.equal(made.status, 200, `setup failed: ${JSON.stringify(made.body)}`);

    const s = await portFor('Port_Acct');
    assert.equal(s.state, 'free', 'a quiet port is not running, and not an error either');
    assert.equal(s.ours, false);
    assert.equal(s.port, made.body.account.debugPort, 'the card must report the port on record');
    assert.match(s.detail, /not running/i);
  } finally { await forgetAccount('Port_Acct'); }
});

test('a browser holding the port with this account’s own folder reads as running', async () => {
  await forgetAccount('Port_Acct');
  let kid = null;
  try {
    const made = await create({ handle: 'Port_Acct' });
    const { debugPort, profileDir } = made.body.account;
    kid = await holdPort(debugPort, join(DATA, profileDir));

    const s = await portFor('Port_Acct');
    assert.equal(s.state, 'running', 'the user-data-dir is what makes a browser this account’s');
    assert.equal(s.ours, true, 'and only this state may be driven or stopped');
    assert.equal(s.pid, kid.pid, 'the owning process must be identified, not merely detected');
  } finally {
    try { kid?.kill(); } catch { /* already gone */ }
    await forgetAccount('Port_Acct');
  }
});

test('a stranger on the port is reported as a stranger, not as a healthy browser', async () => {
  await forgetAccount('Port_Acct');
  let kid = null;
  try {
    const made = await create({ handle: 'Port_Acct' });
    const { debugPort } = made.body.account;
    /* Someone else's profile on our port — the Lenovo Vantage shape, reproduced. */
    kid = await holdPort(debugPort, join(DATA, 'somebody-elses-profile'));

    const s = await portFor('Port_Acct');
    assert.equal(s.state, 'foreign', 'answering on the right port is not evidence of ownership');
    assert.equal(s.ours, false);
    assert.match(s.detail, /not this account's browser|not a browser redbot started/i,
                 'and it must say so in words a person can act on');

    /* The false green this replaced: /api/pulse called any answering port a healthy browser. */
    const pulse = await (await fetch(`http://127.0.0.1:${PORT}/api/pulse`)).json();
    const mine = pulse.browsers.find((b) => b.handle === 'Port_Acct');
    assert.equal(mine.browserUp, false, 'a squatter must never count as this account’s browser');
    assert.ok(pulse.problems.some((p) => /Port_Acct/.test(p) && /held by something else/i.test(p)),
              'and health must report it as a problem rather than pass');
  } finally {
    try { kid?.kill(); } catch { /* already gone */ }
    await forgetAccount('Port_Acct');
  }
});

test('stopping refuses to kill a process it cannot prove is ours', async () => {
  await forgetAccount('Port_Acct');
  let kid = null;
  try {
    const made = await create({ handle: 'Port_Acct' });
    kid = await holdPort(made.body.account.debugPort, join(DATA, 'somebody-elses-profile'));

    const r = await fetch(`http://127.0.0.1:${PORT}/api/account/stop`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'Port_Acct' })
    });
    const body = await r.json();
    assert.equal(r.status, 400, 'a stop button wired to a port number would close whatever is there');
    assert.match(body.error, /Refusing to stop it/);

    assert.equal(kid.exitCode, null, 'and the stranger must still be running');
  } finally {
    try { kid?.kill(); } catch { /* already gone */ }
    await forgetAccount('Port_Acct');
  }
});

test('stopping ends the account’s own browser, and the port goes quiet', async () => {
  await forgetAccount('Port_Acct');
  let kid = null;
  try {
    const made = await create({ handle: 'Port_Acct' });
    const { debugPort, profileDir } = made.body.account;
    kid = await holdPort(debugPort, join(DATA, profileDir));
    assert.equal((await portFor('Port_Acct')).state, 'running', 'precondition: it must be running first');

    const r = await fetch(`http://127.0.0.1:${PORT}/api/account/stop`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'Port_Acct' })
    });
    const body = await r.json();
    assert.equal(r.status, 200, `stop was refused: ${JSON.stringify(body)}`);
    assert.equal(body.pid, kid.pid);

    // The claim is "stopped", so the proof is the port, not the exit code of a helper.
    await until(async () => (await portFor('Port_Acct')).state === 'free',
                'the port to go quiet after stopping');
  } finally {
    try { kid?.kill(); } catch { /* already gone */ }
    await forgetAccount('Port_Acct');
  }
});

/* ------------------------------------------------------------------ *
 * Changing the port — the one field /api/account/update still refuses
 * ------------------------------------------------------------------ */

test('a port already in use on this machine is refused, with a free one offered instead', async () => {
  await forgetAccount('Port_Acct');
  let squatter = null;
  try {
    await create({ handle: 'Port_Acct' });
    /* A real listener, so the check has to be a BIND test. A connect test would call this
       port free the moment the holder stopped answering, and hand out a port Chrome cannot
       take — which is the whole failure the allocator exists to prevent. */
    const busy = 9331;
    squatter = await holdPort(busy, join(DATA, 'unrelated'));

    const r = await fetch(`http://127.0.0.1:${PORT}/api/account/port`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'Port_Acct', port: busy })
    });
    const body = await r.json();
    assert.equal(r.status, 400);
    assert.match(body.error, /already in use/i);
    assert.equal(typeof body.suggestion, 'number', 'a refusal must offer a port that would work');
    assert.notEqual(body.suggestion, busy);
  } finally {
    try { squatter?.kill(); } catch { /* already gone */ }
    await forgetAccount('Port_Acct');
  }
});

test('a port another account already owns is refused, and names that account', async () => {
  await forgetAccount('Port_Acct');
  await forgetAccount('Port_Other');
  try {
    await create({ handle: 'Port_Acct' });
    const other = await create({ handle: 'Port_Other' });

    const r = await fetch(`http://127.0.0.1:${PORT}/api/account/port`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'Port_Acct', port: other.body.account.debugPort })
    });
    const body = await r.json();
    assert.equal(r.status, 400);
    assert.match(body.error, /Port_Other/, 'taken is only useful when it says by whom');
    /* Two accounts on one port is two Reddit identities taking turns in one browser. */
    assert.match(body.error, /two identities in one browser/i);
  } finally {
    await forgetAccount('Port_Acct');
    await forgetAccount('Port_Other');
  }
});

test('the port cannot be moved while that account’s browser is running', async () => {
  await forgetAccount('Port_Acct');
  let kid = null;
  try {
    const made = await create({ handle: 'Port_Acct' });
    const { debugPort, profileDir } = made.body.account;
    kid = await holdPort(debugPort, join(DATA, profileDir));

    const r = await fetch(`http://127.0.0.1:${PORT}/api/account/port`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'Port_Acct', auto: true })
    });
    const body = await r.json();
    assert.equal(r.status, 400, 'moving the record mid-flight leaves it pointing at a dead port');
    assert.match(body.error, /Stop it first/i);

    const row = await pool.query('SELECT debug_port FROM accounts WHERE handle = $1', ['Port_Acct']);
    assert.equal(row.rows[0].debug_port, debugPort, 'and nothing may have moved');
  } finally {
    try { kid?.kill(); } catch { /* already gone */ }
    await forgetAccount('Port_Acct');
  }
});

test('a port change lands in the record and the seed file alike', async () => {
  await forgetAccount('Port_Acct');
  try {
    const made = await create({ handle: 'Port_Acct' });
    const was = made.body.account.debugPort;

    const r = await fetch(`http://127.0.0.1:${PORT}/api/account/port`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'Port_Acct', auto: true })
    });
    const body = await r.json();
    assert.equal(r.status, 200, `the move was refused: ${JSON.stringify(body)}`);
    assert.notEqual(body.port, was, 'auto must actually move it');
    assert.equal(typeof body.port, 'number');

    const row = await pool.query('SELECT debug_port FROM accounts WHERE handle = $1', ['Port_Acct']);
    assert.equal(row.rows[0].debug_port, body.port, 'the record is what the CLI attaches by');
    const seeded = JSON.parse(readFileSync(accountsPath(), 'utf8'));
    assert.equal(seeded.accounts.find((a) => a.handle === 'Port_Acct').debugPort, body.port,
                 'and the seed file answers when the database is down');

    /* The port it moved TO must be one nothing holds — the point of the whole exercise. */
    assert.equal((await portFor('Port_Acct')).state, 'free');
  } finally { await forgetAccount('Port_Acct'); }
});

test('a nonsense port is refused before anything is written', async () => {
  await forgetAccount('Port_Acct');
  try {
    const made = await create({ handle: 'Port_Acct' });
    for (const bad of [80, 0, -1, 70000, 'nine thousand']) {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/account/port`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'Port_Acct', port: bad })
      });
      assert.equal(r.status, 400, `${JSON.stringify(bad)} must be refused`);
    }
    const row = await pool.query('SELECT debug_port FROM accounts WHERE handle = $1', ['Port_Acct']);
    assert.equal(row.rows[0].debug_port, made.body.account.debugPort, 'and the port must not have moved');
  } finally { await forgetAccount('Port_Acct'); }
});


/* ------------------------------------------------------------------ *
 * /api/state reads a page — and still reports the whole record
 *
 * THE RISK THIS PINS. Scoping the reads is the easy half; the trap is that every figure on
 * every screen used to be `array.length` over those same fully-loaded tables. Narrow the read
 * without moving the figures and the console shows a page while its own headers describe
 * twenty-five rows as though they were everything — "1 reply sent" with forty published, "3
 * waiting" with three hundred queued. A confidently wrong number is worse than a slow screen.
 *
 * So this seeds far more than a page and asserts BOTH halves at once: the lists are bounded,
 * and every count still matches the whole table.
 * ------------------------------------------------------------------ */

const SCOPE_TAG = 'scopetest';
const SCOPE_ACCT = 'Scope_Acct';
const SEED_DRAFTS = 60;
const SEED_PUBLISHED = 17;
const SEED_OBS = 23;

async function seedScopeFixture() {
  await pool.query("INSERT INTO accounts (handle, role) VALUES ($1,'seeded') ON CONFLICT DO NOTHING", [SCOPE_ACCT]);
  for (let i = 0; i < SEED_DRAFTS; i++) {
    const tid = `eeee${String(i).padStart(8, '0')}`.slice(0, 12);
    await pool.query(
      `INSERT INTO threads (id, permalink, title, subreddit, comment_count, collected_at, source)
       VALUES ($1,$2,$3,$4,3, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'read')`,
      [tid, `/r/${SCOPE_TAG}/${i}`, `${SCOPE_TAG} thread ${i}`, i % 2 ? 'ScopeSubOne' : 'ScopeSubTwo']
    );
    await pool.query(
      `INSERT INTO drafts (id, thread_id, permalink, title, body, has_disclosure, created_at, model, status, account)
       VALUES ($1,$2,$3,$4,'body', false, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'test-model', 'pending', $5)`,
      [`${SCOPE_TAG}-d${i}`, tid, `/r/${SCOPE_TAG}/${i}`, `${SCOPE_TAG} draft ${i}`, SCOPE_ACCT]
    );
  }
  /* One draft certified TWICE — the stability evidence, which must survive scoping. */
  for (let k = 0; k < 2; k++) {
    await pool.query(
      `INSERT INTO certifications (draft_id, thread_id, verdict, certified_at, model, resolution_resolved, resolution_detail)
       VALUES ($1,$2,'CERTIFIED', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'test-model', false, 'seeded')`,
      [`${SCOPE_TAG}-d0`, `eeee${'0'.repeat(8)}`.slice(0, 12)]
    );
  }
  for (let i = 0; i < SEED_PUBLISHED; i++) {
    await pool.query(
      `INSERT INTO history (ts, kind, account, summary) VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'publish.ok', $1, $2)`,
      [SCOPE_ACCT, `${SCOPE_TAG} published ${i}`]
    );
  }
  for (let i = 0; i < SEED_OBS; i++) {
    await pool.query(
      `INSERT INTO observations (ts, account, kind, vector, value)
       VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), $1, 'karma', 'signed-in', $2)`,
      [SCOPE_ACCT, JSON.stringify(100 + i)]
    );
  }
}

async function clearScopeFixture() {
  await pool.query(`DELETE FROM certifications WHERE draft_id LIKE '${SCOPE_TAG}%'`);
  await pool.query(`DELETE FROM drafts WHERE id LIKE '${SCOPE_TAG}%'`);
  await pool.query(`DELETE FROM threads WHERE title LIKE '${SCOPE_TAG}%'`);
  await pool.query(`DELETE FROM history WHERE account = $1`, [SCOPE_ACCT]);
  await pool.query(`DELETE FROM observations WHERE account = $1`, [SCOPE_ACCT]);
  await pool.query(`DELETE FROM accounts WHERE handle = $1`, [SCOPE_ACCT]);
}

test('/api/state sends one page of review but counts the whole queue', async () => {
  await clearScopeFixture();
  await seedScopeFixture();
  try {
    const s = await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();

    /* Bounded: 60 drafts seeded, one page sent. */
    assert.ok(s.review.length <= 25, `review must be one page, got ${s.review.length}`);
    assert.ok(s.review.length > 0, 'and it must not be empty');

    /* Whole-record: the queue is what a person acts on. */
    assert.ok(s.reviewTotal >= SEED_DRAFTS, `reviewTotal must count every draft, got ${s.reviewTotal}`);
    assert.ok(s.reviewPending >= SEED_DRAFTS, `reviewPending must count the queue, got ${s.reviewPending}`);
    assert.ok(s.reviewTotal > s.review.length, 'precondition: more drafts than one page');
    assert.equal(s.pulse.waitingOnYou, s.reviewPending, 'the badge and the header must agree');
  } finally { await clearScopeFixture(); }
});

test('the figures still describe the whole record once the reads are scoped', async () => {
  await clearScopeFixture();
  await seedScopeFixture();
  try {
    const s = await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();

    /* published: 17 seeded, and none of those history rows are on the page of drafts. */
    assert.ok(s.pulse.published >= SEED_PUBLISHED,
              `published must count every reply, got ${s.pulse.published}`);
    assert.equal(s.outcomes.published, s.pulse.published, 'one figure, reported the same everywhere');

    /* Per account — these were two filters over two fully-loaded logs, once per card. */
    const acct = s.accounts.find((a) => a.handle === SCOPE_ACCT);
    assert.ok(acct, 'the seeded account must appear');
    assert.equal(acct.published, SEED_PUBLISHED, 'per-account replies must be counted, not filtered');
    assert.equal(acct.observations, SEED_OBS, 'and so must its measurements');
    assert.equal(acct.karma, 100 + SEED_OBS - 1, 'the latest karma reading must be the latest one');

    /* Collected-per-subreddit: the case the original comment warns about — a source reading
       "0 on file" directly above the threads it collected. Paging reintroduced that risk. */
    const byKey = s.collect.collectedByKey || {};
    /* Subreddits only this test uses. Counting r/WordPress would count every other test
       file's seeded threads too — reset-test-db.mjs warns about exactly this: files share the
       database within a run, so a global count is a flaky assertion. */
    assert.equal(byKey.scopesubone, SEED_DRAFTS / 2, 'half the seeded threads are r/ScopeSubOne');
    assert.equal(byKey.scopesubtwo, SEED_DRAFTS / 2);

    /* Argus is the console's answer to "can this be trusted" — it must never be page-derived. */
    assert.ok(s.argus.runs >= 2, `argus must count every certification, got ${s.argus.runs}`);
    assert.equal(s.argus.draftsCheckedTwice, 1, 'the draft certified twice must be found');
    assert.deepEqual(s.argus.claimSpread, [[0, 0]], 'and its claim counts reported as a spread');
  } finally { await clearScopeFixture(); }
});

test('a fresh install with nothing in it still answers', async () => {
  /* The scoped path resolves draft ids first and passes them down; an empty list must short
     -circuit rather than becoming `= ANY('{}')` scans, and must not throw on the way. */
  await clearScopeFixture();
  const s = await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();
  assert.ok(Array.isArray(s.review), 'review must still be a list');
  assert.equal(typeof s.reviewTotal, 'number');
  assert.ok(Array.isArray(s.accounts));
  assert.equal(typeof s.pulse.published, 'number');
});


/* ------------------------------------------------------------------ *
 * KEEP THIS BLOCK LAST. The fresh-clone test below kills the shared console child to
 * spawn its own, so every test after it hits ECONNREFUSED.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * No data/ directory at all — the genuinely fresh clone
 * ------------------------------------------------------------------ */

test('the first account can be set up when the data directory itself does not exist', async () => {
  // Restart the console pointed at a path that has never been created.
  try { child?.kill(); } catch { /* already gone */ }
  const gone = join(mkdtempSync(join(tmpdir(), 'redbot-fresh-')), 'data');
  assert.equal(existsSync(gone), false, 'precondition: the data dir must not exist');

  const port = await freePort();
  const fresh = spawn(process.execPath, [join(HERE, 'server.mjs'), '--port', String(port)],
                      { cwd: ROOT, env: { ...process.env, REDBOT_DATA: gone }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('console did not start in 15s')), 15_000);
      fresh.stdout.on('data', (d) => { if (String(d).includes(`${port}`)) { clearTimeout(timer); res(); } });
      fresh.on('error', (e) => { clearTimeout(timer); rej(e); });
    });
    const r = await fetch(`http://127.0.0.1:${port}/api/account/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'Fresh_Clone_Acct' })
    });
    const body = await r.json();
    assert.equal(r.status, 200, `setup was refused on a fresh clone: ${JSON.stringify(body)}`);
    assert.equal(existsSync(join(gone, 'accounts.json')), true, 'the data dir must have been created');
  } finally {
    try { fresh.kill(); } catch { /* already gone */ }
    try { rmSync(dirname(gone), { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/* ------------------------------------------------------------------ *
 * What the console says about itself
 * ------------------------------------------------------------------ */

/**
 * The header of server.mjs claimed "It reads. It never writes, never executes, never
 * publishes. There is no command surface at all — not an allow-list, no exec path exists in
 * this file." Every clause was false in that same file: it imports writeFileSync and spawn,
 * enforces a PUBLIC_ACTIONS allow-list, and serves /api/publish. The operator console carried
 * the identical claim on /api/settings until `readOnly: false` replaced it — see
 * tools/operator/server.test.mjs, 'the console does not describe itself as read-only'.
 *
 * A comment that overstates a security boundary invites the next reader to skip a guard, so
 * the wording is pinned here rather than left to review.
 */
test('the product console header does not claim to be read-only', () => {
  const src = readFileSync(join(HERE, 'server.mjs'), 'utf8');
  const header = src.slice(0, src.indexOf('*/') + 2);

  for (const lie of [
    'product console (read-only)',
    'It never writes',
    'never executes',
    'no exec path exists in this file'
  ]) {
    assert.ok(!header.includes(lie), `the header still claims: "${lie}"`);
  }

  // And it must still say what it DOES do, so the fix cannot be undone by deletion alone.
  assert.match(header, /NOT read-only/);
  assert.match(header, /It reads AND WRITES/);
  assert.match(header, /It EXECUTES, behind a fixed allow-list/);
  assert.match(header, /It PUBLISHES/);
});

/**
 * The same false claim had a SECOND copy in the startup banner, and it outlived the first fix
 * because the test above only read the header. The banner is the worse of the two: an operator
 * reads it on every launch and may size their caution to it. Pinned against the real stdout of
 * a real server, not against the source, so a template that stops interpolating is caught too.
 */
test('the startup banner does not claim to be read-only', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [join(HERE, 'server.mjs'), '--port', String(port)],
                      { cwd: ROOT, env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  try {
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`no banner in 15s; got: ${out}`)), 15_000);
      child.stdout.on('data', (d) => {
        out += String(d);
        if (out.includes('Ctrl+C to stop')) { clearTimeout(timer); res(); }
      });
      child.on('error', (e) => { clearTimeout(timer); rej(e); });
    });
  } finally {
    try { child.kill(); } catch { /* already gone */ }
  }

  assert.ok(!/read-only/.test(out), `the banner still says read-only: ${out}`);
  assert.ok(!/no command surface/.test(out), `the banner still denies its command surface: ${out}`);
  assert.ok(!/Publishing needs a person at a terminal/.test(out),
            `the banner still sends people to a terminal to publish: ${out}`);

  // It must state the surface it actually has, with a real count rather than an uninterpolated
  // template, and the boundary that is actually doing the work.
  assert.match(out, /Runs \d+ allow-listed actions and can publish a draft on a typed SEND\./);
  assert.match(out, /Bound to 127\.0\.0\.1 and refuses cross-origin requests/);
});

/**
 * The header names symbols rather than line numbers, on purpose — the claim it replaced rotted
 * because same-file `:line` citations shift under every edit above them. Symbols only rot when
 * renamed or deleted, which is what this pins: every one the header names must still exist, and
 * the header must not reacquire the `:NNN` habit for its own internals.
 */
test('every symbol the header names still exists in the file', () => {
  const src = readFileSync(join(HERE, 'server.mjs'), 'utf8');
  const header = src.slice(0, src.indexOf('*/') + 2);
  const body = src.slice(header.length);

  const named = [
    [/^import \{[^}]*\bwriteFileSync\b[^}]*\} from 'node:fs'/m, 'writeFileSync is imported'],
    [/^import \{[^}]*\bappendFileSync\b/m,                     'appendFileSync is imported'],
    [/^import \{ spawn \} from 'node:child_process'/m,          'spawn is imported'],
    [/^const PUBLIC_ACTIONS =/m,                                'PUBLIC_ACTIONS is declared'],
    [/if \(!PUBLIC_ACTIONS\.includes\(body\.key\)\)/,            'the allow-list is enforced'],
    [/url\.pathname === '\/api\/actions'/,                       '/api/actions is served'],
    [/spawn\(process\.execPath, \[join\(ROOT, 'dist', 'cli\.js'\)/, 'dist/cli.js is spawned'],
    [/'auto', '--every'/,                                        'the auto loop is spawned'],
    [/spawn\('taskkill'/,                                        'taskkill is spawned'],
    [/url\.pathname === '\/api\/publish'/,                        '/api/publish is served'],
    [/^async function publish\(body\)/m,                          'publish() is defined'],
    [/confirm !== 'SEND'/,                                       'SEND is required verbatim'],
    [/takeConsoleApproval/,                                      'the approval token is named'],
    [/^function originIsLocal\(o\)/m,                             'originIsLocal is defined'],
    [/if \(!originIsLocal\(req\.headers\.origin\)\)/,             'originIsLocal is enforced'],
    [/^server\.listen\(PORT, '127\.0\.0\.1'/m,                    'the server binds loopback only'],
    [/url\.pathname === '\/api\/operators'/,                      '/api/operators is served']
  ];

  for (const [pattern, what] of named) {
    assert.match(body, pattern, `the header claims ${what}, but nothing in the file matches`);
  }

  // The header must not go back to citing its own line numbers.
  assert.ok(!/`:\d+`/.test(header),
    'the header cites a same-file line number again — those rot on the next edit above them');
});
