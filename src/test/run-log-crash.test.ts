/**
 * A run that dies on an uncaught exception still closes its run log, with the error in it.
 *
 * Node writes a fatal exception straight to fd 2, so neither the stderr tee nor the footer in
 * src/cli.ts saw the two cardinal runs that died this way (2026-10-26T19-47-11, 2026-10-29T20-02-23).
 * The crash has to happen in a real child process: an uncaught exception in this one would end
 * the test runner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const runLogUrl = pathToFileURL(join(import.meta.dirname, '..', 'run-log.js')).href;

function crashChild(body: string): { status: number | null; rows: Array<Record<string, unknown>> } {
  const dir = mkdtempSync(join(tmpdir(), 'redbot-crash-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, REDBOT_DATA: dir };
    delete env.REDBOT_RUN_LOG;
    const script = `
      const { beginRunLog, captureCrashes } = await import(${JSON.stringify(runLogUrl)});
      beginRunLog(['read', 'r/CMS']);
      captureCrashes();
      console.log('redbot read r/CMS · new');
      ${body}
    `;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' });
    const files = readdirSync(join(dir, 'run-logs')).filter((f) => f.endsWith('.jsonl'));
    assert.equal(files.length, 1);
    const rows = readFileSync(join(dir, 'run-logs', files[0]!), 'utf8')
      .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);
    return { status: r.status, rows };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an uncaught exception writes the stack and a code-1 footer, and exits 1', () => {
  const { status, rows } = crashChild(`setTimeout(() => { throw new Error('CDP socket closed'); }, 5);`);
  assert.equal(status, 1);
  const last = rows.at(-1)!;
  assert.equal(last.t, 'f');
  assert.equal(last.code, 1);
  assert.ok(rows.some((r) => r.t === 'l' && String(r.text).includes('crashed (uncaughtException): Error: CDP socket closed')),
    JSON.stringify(rows));
});

test('an unhandled rejection is captured the same way', () => {
  const { status, rows } = crashChild(`Promise.reject(new Error('page closed'));`);
  assert.equal(status, 1);
  assert.equal(rows.at(-1)!.t, 'f');
  assert.ok(rows.some((r) => r.t === 'l' && String(r.text).includes('crashed (unhandledRejection): Error: page closed')),
    JSON.stringify(rows));
});
