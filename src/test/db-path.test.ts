/**
 * Do src/db.ts and db/sqlite/migrate.mjs agree about WHERE the database is?
 *
 * src/db.ts warns, in its own words, that "two readers of the same file is two chances to
 * disagree". The migration runner nevertheless carries its own copy of `dbFile()`, because it
 * has to be runnable before dist/ exists — "compile before you can create your schema" is a
 * worse dependency than a duplicated ten-line function.
 *
 * The answer to a necessary duplicate is not to pretend it is safe, it is to make a
 * disagreement fail loudly. If these two ever diverge, the runner migrates one file and the
 * application opens another, and the symptom is "the schema is missing" on a database that was
 * just migrated successfully. That is a genuinely baffling half-hour, so it gets a test.
 *
 * The runner is asked via its `where` subcommand rather than imported, which also covers the
 * path an operator actually uses.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbFile } from '../db.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(ROOT, 'db', 'sqlite', 'migrate.mjs');

/** What the runner thinks, under a given environment. */
function runnerSays(env: Record<string, string | undefined>): string {
  const r = spawnSync(process.execPath, [RUNNER, 'where'], {
    encoding: 'utf8',
    env: { ...process.env, REDBOT_DB: undefined, REDBOT_DATA: undefined, ...env }
  });
  assert.equal(r.status, 0, `runner failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** What src/db.ts thinks, under the same environment. */
function facadeSays(env: Record<string, string | undefined>): string {
  const saved = { REDBOT_DB: process.env.REDBOT_DB, REDBOT_DATA: process.env.REDBOT_DATA };
  try {
    delete process.env.REDBOT_DB;
    delete process.env.REDBOT_DATA;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return dbFile();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('the runner and the façade resolve the same database path', () => {
  const CASES: Array<[string, Record<string, string | undefined>]> = [
    ['no overrides — beside the rest of data/', {}],
    ['REDBOT_DATA relocates it', { REDBOT_DATA: resolve('C:/tmp/redbot-data-case') }],
    ['REDBOT_DB names it outright', { REDBOT_DB: resolve('C:/tmp/elsewhere/other.db') }],
    ['REDBOT_DB wins over REDBOT_DATA', {
      REDBOT_DATA: resolve('C:/tmp/ignored'), REDBOT_DB: resolve('C:/tmp/wins/w.db')
    }],
    ['a relative REDBOT_DB is resolved, not left relative', { REDBOT_DB: 'rel/some.db' }],
    ['a relative REDBOT_DATA is resolved', { REDBOT_DATA: 'rel-data' }]
  ];

  test('a relative path anchors to the REPO ROOT, not the current directory', () => {
    // The whole point: server.mjs spawns dist/cli.js, src/llm.ts runs the Claude CLI in a scratch
    // directory, and npm test spawns servers. If a relative REDBOT_DB resolved against cwd, each
    // of those would open a different file — and the symptom is "the schema is missing" on a
    // database that was just migrated successfully.
    assert.equal(facadeSays({ REDBOT_DB: 'data/test/redbot-test.db' }),
      join(ROOT, 'data', 'test', 'redbot-test.db'));
    assert.equal(facadeSays({ REDBOT_DATA: 'rel-data' }), join(ROOT, 'rel-data', 'redbot.db'));
  });

  test('REDBOT_DB beats REDBOT_DATA even when REDBOT_DATA is a real temp directory', () => {
    // tools/product/ui.test.mjs hands its child a throwaway REDBOT_DATA to get a fresh data/
    // directory while still expecting the shared test DATABASE. If REDBOT_DATA won, that child
    // would open an empty unmigrated file and every assertion would fail for the wrong reason.
    const p = facadeSays({ REDBOT_DATA: resolve('C:/tmp/throwaway'), REDBOT_DB: 'data/test/redbot-test.db' });
    assert.equal(p, join(ROOT, 'data', 'test', 'redbot-test.db'));
  });

  for (const [label, env] of CASES) {
    test(label, () => {
      const a = facadeSays(env);
      const b = runnerSays(env);
      assert.equal(a, b, `src/db.ts says ${a}\n  migrate.mjs says ${b}`);
    });
  }

  test('the default sits inside data/, which is gitignored in full', () => {
    const p = facadeSays({});
    assert.equal(p, join(ROOT, 'data', 'redbot.db'));
  });

  test('the path is always absolute, so a child process with a different cwd agrees', () => {
    // tools/product/server.mjs spawns dist/cli.js; src/llm.ts runs the Claude CLI in a scratch
    // directory. A relative database path would make those children open a different file.
    for (const [, env] of CASES) {
      const p = facadeSays(env);
      assert.equal(p, resolve(p), `${p} is not absolute`);
    }
  });
});
