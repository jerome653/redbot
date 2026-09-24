/**
 * THE DEFECT THIS PINS.
 *
 * `tools/product/server.mjs:1594` held the Setup screen's provider choice in a module-level
 * `let`, initialised from `process.env.REDBOT_LLM` and mutated at `/api/llm/provider`. Nothing
 * ever wrote it down. The Electron app is launched by `launch-redbot.sh` -> `npm start`, which
 * exports no `REDBOT_LLM`, so every restart silently reset the choice to `cli`.
 *
 * Measured on this install 2026-09-24: the running app's `/proc/<pid>/environ` carried no
 * `REDBOT_LLM`, while `data/redbot.db` held three `draft failed ... empty completion` rows from
 * 2026-09-21 — an error only `completeViaApi` (src/llm.ts:292) and `completeViaDeepseek`
 * (src/llm.ts:381) can throw. Neither runs under `cli`. The provider that produced those rows no
 * longer existed anywhere by the time anyone looked.
 *
 * The choice belongs next to `syncUrl`, which src/push/state.ts:78-84 already persists for
 * exactly this reason: "a desktop app has no shell to export REDBOT_SYNC_URL in, so a value that
 * lived only in the environment could never be set by somebody who never opens a terminal."
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* DATA is read at import time, so the directory must exist before src/config.ts loads. */
const dir = mkdtempSync(join(tmpdir(), 'redbot-llm-provider-'));
process.env.REDBOT_DATA = dir;

const { readPushState, writePushState, pushStatePath } = await import('../push/state.js');

after(() => rmSync(dir, { recursive: true, force: true }));

test('a provider choice survives being written and read back', () => {
  writePushState({ ...readPushState(), llmProvider: 'deepseek' });
  assert.equal(readPushState().llmProvider, 'deepseek',
    'the choice must outlive the process that made it — that is the whole point');
});

test('each of the three providers round-trips', () => {
  for (const p of ['cli', 'api', 'deepseek'] as const) {
    writePushState({ ...readPushState(), llmProvider: p });
    assert.equal(readPushState().llmProvider, p);
  }
});

test('a state file with no provider reads as undefined, not as a guess', () => {
  writeFileSync(pushStatePath(), JSON.stringify({ cursors: {} }), 'utf8');
  assert.equal(readPushState().llmProvider, undefined,
    'absent is not the same as "cli" — the caller decides the default, and it must be able to see that nothing was stored');
});

test('a junk provider on disk is dropped rather than handed to a spawn', () => {
  /* The value reaches a child as `env.REDBOT_LLM` (server.mjs:1485). src/config.ts:362-364
     resolves an unrecognised value to 'cli', but a hand-edited or corrupted file must not get
     that far — the reader is the gate. */
  writeFileSync(pushStatePath(), JSON.stringify({ cursors: {}, llmProvider: 'gpt-9' }), 'utf8');
  assert.equal(readPushState().llmProvider, undefined,
    'an unrecognised provider is not a provider');
});

test('a non-string provider is dropped', () => {
  writeFileSync(pushStatePath(), JSON.stringify({ cursors: {}, llmProvider: 7 }), 'utf8');
  assert.equal(readPushState().llmProvider, undefined);
});

test('storing a provider does not disturb the push watermarks beside it', () => {
  writePushState({ cursors: { events: { id: 41 } }, syncUrl: 'https://example.com/hook' });
  writePushState({ ...readPushState(), llmProvider: 'api' });
  const after_ = readPushState();
  assert.deepEqual(after_.cursors, { events: { id: 41 } }, 'the cursor must be untouched');
  assert.equal(after_.syncUrl, 'https://example.com/hook', 'the sync URL must be untouched');
  assert.equal(after_.llmProvider, 'api');
});
