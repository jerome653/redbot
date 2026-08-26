/**
 * A run started from a terminal appears in the console's history.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST EXISTS.
 *
 * `data/run-logs/` had exactly one writer: this console. Anything typed at a prompt ran, printed
 * and vanished, so the two ledgers the product keeps — the database's `history` table and the
 * run-log files — disagreed by construction. Measured on 2026-08-26 against the RedBot installed
 * on Clark's machine: five executions on 08-18, between 05:58:57 and 06:27:02 and including two
 * `opportunity` scores, are recorded in the database and mentioned in no run log at all.
 *
 * The test drives the REAL cli against a throwaway REDBOT_DATA and then asks the REAL console,
 * over HTTP, what it has in its history. Asserting the file's shape instead would only prove that
 * two files agree with a third opinion of what the shape is — and the shape is not the point. The
 * point is that the console's reader can see the run.
 * ---------------------------------------------------------------------------
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CLI = join(ROOT, 'dist', 'cli.js');

const DATA = mkdtempSync(join(tmpdir(), 'redbot-ledger-'));
let PORT = 0;
let child = null;

/** A port nothing is listening on, taken the way the other console tests take one. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function get(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return { status: res.status, body: await res.json() };
}

/** Run the real CLI exactly as a person at a prompt would. */
function cli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, REDBOT_DATA: DATA, REDBOT_DB: join(DATA, 'redbot.db'), ...env }
  });
}

before(async () => {
  PORT = await freePort();
  child = spawn(process.execPath, [join(HERE, 'server.mjs'), '--port', String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, REDBOT_DATA: DATA, REDBOT_DB: join(DATA, 'redbot.db') }
  });
  for (let i = 0; i < 100; i++) {
    try { await get('/api/run/history'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('the console did not come up');
});

after(() => {
  try { child?.kill(); } catch { /* already gone */ }
  try { rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('a terminal run is in the console history, with its command and its exit code', async () => {
  /* `help` touches no browser and no network, and it is a real invocation of the real binary. */
  const run = cli(['help']);
  assert.equal(run.status, 0, `the CLI itself must succeed — stderr: ${run.stderr}`);
  assert.match(run.stdout, /redbot/i, 'and it must still print to the terminal, unchanged');

  const { body } = await get('/api/run/history');
  const mine = body.runs.filter((r) => r.command === 'redbot help');
  assert.equal(mine.length, 1, `exactly one terminal run expected — saw ${JSON.stringify(body.runs)}`);

  const [only] = mine;
  assert.equal(only.done, true, 'a finished run must have its footer, or the console reads it as killed');
  assert.equal(only.code, 0, 'the exit code is the whole reason the record is worth keeping');
  assert.ok(only.lines > 0, 'the output the run printed is in the log');
  assert.ok(only.startedAt, 'and it is placed in time');
});

test('a failing terminal run is recorded with its non-zero code, not lost', async () => {
  const run = cli(['no-such-command']);
  assert.equal(run.status, 1);

  const { body } = await get('/api/run/history');
  const mine = body.runs.filter((r) => r.command === 'redbot no-such-command');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].code, 1, 'the run that failed is exactly the one you want the log for');
  assert.equal(mine[0].done, true);
});

test('the console\'s own runs are not logged twice', async () => {
  /* The console spawns this same binary and writes the log itself. Without the marker, every
     console action would appear once from each writer. */
  const before = readdirSync(join(DATA, 'run-logs')).length;
  const run = cli(['help'], { REDBOT_RUN_LOG: 'console' });
  assert.equal(run.status, 0);
  assert.equal(
    readdirSync(join(DATA, 'run-logs')).length, before,
    'a run the console is already logging must not write a second file'
  );
  assert.match(run.stdout, /redbot/i, 'and the output is untouched by any of this');
});

test('the file the CLI writes is the format the console writes', async () => {
  /* Not a substitute for the HTTP assertions above — this one names WHICH field would have
     broken, when the reader can no longer see a run. */
  const dir = join(DATA, 'run-logs');
  assert.ok(existsSync(dir));
  const file = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().pop();
  const rows = readFileSync(join(dir, file), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

  assert.equal(rows[0].t, 'h', 'a header first');
  for (const key of ['id', 'key', 'command', 'startedAt']) {
    assert.ok(rows[0][key] !== undefined, `the header carries ${key}, which runLogList reads`);
  }
  assert.equal(rows[0].via, 'cli', 'and says where it came from, which the console ignores');
  assert.equal(rows[rows.length - 1].t, 'f', 'a footer last');
  assert.equal(typeof rows[rows.length - 1].code, 'number');
  assert.ok(rows.some((r) => r.t === 'l' && typeof r.at === 'number' && typeof r.text === 'string'),
    'and the lines in between are stamped the way the viewer renders them');
});
