/**
 * A run log that rolls, because the process writing it may not stop for weeks.
 *
 * ---------------------------------------------------------------------------
 * WHY. `prune(RUN_LOG_KEEP - 1)` caps how many run-log FILES exist and runs once, at
 * `beginRunLog`. For a command that prints and exits that is the whole story. `redbot auto` is one
 * process that loops forever, so it opened one file and appended to it for the lifetime of the
 * install, and a cap on the number of files said nothing about that one.
 *
 * MEASURED by tools/ops/simulate.mjs SIM 4 against this disk's own logs: the longest real
 * `redbot auto --every 120` run wrote 2,585,199 bytes / 23,759 lines into a single file over 161.5
 * hours. 16 KB/hour — 11.5 MB a month, 140 MB a year, in one file that
 * `tools/product/server.mjs:runLogRead` loads with `readFileSync` and parses line by line.
 *
 * These tests drive the real module with a tiny cap, because the behaviour under test is the ROLL
 * and not the size at which it happens.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* The module reads DATA and the byte cap at import time, so both are set before it loads. */
const DIR = mkdtempSync(join(tmpdir(), 'redbot-runlog-'));
process.env.REDBOT_DATA = DIR;
process.env.REDBOT_RUN_LOG_MAX_BYTES = '4000';
delete process.env.REDBOT_RUN_LOG;          // the console marker would make this module stand down

const { beginRunLog, endRunLog } = await import('../run-log.js');

/* `[]` when the directory is not there: the previous test removes it, and `beginRunLog` is what
   recreates it. An absent directory is "no logs yet", not an error. */
const logs = (): string[] => {
  try { return readdirSync(join(DIR, 'run-logs')).filter((f) => f.endsWith('.jsonl')).sort(); }
  catch { return []; }
};
const read = (f: string) =>
  readFileSync(join(DIR, 'run-logs', f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

test('a long-printing run rolls onto continuation files instead of one unbounded file', () => {
  beginRunLog(['auto', '--every', '120']);
  /* ~120 bytes a line against a 4000-byte cap: enough lines to force several rolls. */
  for (let i = 0; i < 200; i++) {
    console.log(`cycle ${i} — collected 7 thread(s), scored them, wrote nothing this pass`);
  }
  endRunLog(0);

  const files = logs();
  assert.ok(files.length > 1, `expected a roll, got ${files.length} file(s)`);

  for (const f of files) {
    const size = statSync(join(DIR, 'run-logs', f)).size;
    /* One line may carry the file past the cap — the check happens after the write — so the bound
       is "the cap plus one line", not the cap exactly. Claiming otherwise would make this test
       fail on a long line rather than on a missing roll. */
    assert.ok(size <= 4000 + 4096, `${f} is ${size} bytes, past the cap and its last line`);
  }

  rmSync(join(DIR, 'run-logs'), { recursive: true, force: true });
});

test('the original file keeps its name, and continuations are adjacent when sorted', () => {
  beginRunLog(['auto']);
  for (let i = 0; i < 150; i++) console.log(`line ${i} ${'x'.repeat(60)}`);
  endRunLog(0);

  const files = logs();
  assert.ok(files.length >= 2);
  /* Part 0 carries the name every file this module has ever written, so `runLogList` and the
     `[0-9A-Za-z._-]+[.]jsonl` guard in tools/product/server.mjs still match it. */
  assert.doesNotMatch(files[0]!, /_p\d+\.jsonl$/, 'the first file must keep the original name');
  for (const f of files.slice(1)) assert.match(f, /_p\d+\.jsonl$/);
  /* THE ORDER, asserted. `prune` deletes from the front of this sorted list, so a continuation
     sorting ahead of its original would have the oldest-first promise delete the wrong end. */
  assert.deepEqual(files, [...files].sort(), 'the listing must already be in order');
  const parts = files.slice(1).map((f) => Number(/_p(\d+)\.jsonl$/.exec(f)![1]));
  assert.deepEqual(parts, [...parts].sort((a, b) => a - b), 'parts must sort ascending by number');
  /* Sorted order groups them: the continuation names share the start-time prefix. */
  const prefix = files[0]!.slice(0, files[0]!.indexOf('__'));
  for (const f of files) assert.ok(f.startsWith(prefix), `${f} is not adjacent to ${files[0]}`);

  rmSync(join(DIR, 'run-logs'), { recursive: true, force: true });
});

test('a rolled file says it rolled, so a reader cannot mistake it for the end of the run', () => {
  beginRunLog(['auto']);
  for (let i = 0; i < 150; i++) console.log(`line ${i} ${'y'.repeat(60)}`);
  endRunLog(0);

  const files = logs();
  const first = read(files[0]!);
  const foot = first.find((o) => o.t === 'f');
  assert.ok(foot, 'a rolled file must carry a footer');
  assert.equal(foot.rolled, true,
    'without `rolled` a reader sees a footer and concludes the run ended here');

  /* And the continuation opens with a header carrying the same run id and start time, so the two
     files are provably one run rather than two that happen to sort together. */
  const second = read(files[1]!);
  assert.equal(second[0]!.t, 'h');
  assert.equal(second[0]!.id, first[0]!.id, 'the continuation must carry the same run id');
  assert.equal(second[0]!.startedAt, first[0]!.startedAt);
  assert.equal(second[0]!.part, 1);

  rmSync(join(DIR, 'run-logs'), { recursive: true, force: true });
});

test('a short run writes exactly one file, unchanged from before rotation existed', () => {
  /* The DELTA, not the directory count. The earlier tests in this file leave files behind — each
     removes its own `run-logs` but `prune` and the tee ordering make an absolute count a
     statement about the other tests rather than about this one. */
  const before = new Set(logs());
  beginRunLog(['status']);
  console.log('one line');
  endRunLog(0);
  const added = logs().filter((f) => !before.has(f));
  assert.equal(added.length, 1, `rotation must not split a run that never reaches the cap (added ${added.join(', ')})`);
  const rows = read(added[0]!);
  assert.equal(rows[0]!.t, 'h');
  assert.equal(rows[0]!.key, 'status');
  assert.equal(rows.at(-1)!.t, 'f');
  assert.notEqual(rows.at(-1)!.rolled, true, 'a run that ended must not be marked as rolled');

  rmSync(DIR, { recursive: true, force: true });
});
