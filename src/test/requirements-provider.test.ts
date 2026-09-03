/**
 * The Model-access requirement asks about the provider it is TOLD about.
 *
 * THE DEFECT THIS PINS, found by driving the real console on Linux rather than by reading code.
 *
 * `checkRequirements()` read `config.llm.provider`, which resolves `REDBOT_LLM` once at module
 * load. For `redbot doctor` that is correct — the environment is that process's choice. For the
 * console SERVER it is not: the server is long-lived, the Setup screen's picker writes to
 * `selectedProvider`, and that is forwarded to spawned children as `env.REDBOT_LLM`. The server's
 * own variable stays unset, so the check kept answering for `cli`.
 *
 * What that looked like on screen, measured on cardinal: pick "a DeepSeek API key", store a key
 * through the form, watch it land in the vault — and the banner still read "Setup is not
 * finished. 3 things must be settled before redbot can run: Model access, ..." with the detail
 * "no Claude operator is selected". Every unit test passed throughout, because every unit test
 * ran in a process where the environment WAS the provider.
 *
 * REDBOT_DATA points at a temp directory before the first import, the same seam
 * operator-selection.test.ts uses, so nothing here touches the real data/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-reqprov-'));
const TMP = process.env.REDBOT_DATA;

/* No operator, and no ambient provider: the state a console server actually runs in. */
delete process.env.REDBOT_OPERATOR;
delete process.env.REDBOT_CLAUDE_CONFIG_DIR;
delete process.env.REDBOT_LLM;
delete process.env.ANTHROPIC_API_KEY;
process.env.DEEPSEEK_API_KEY = 'sk-requirement-proof-not-real';

const { checkRequirements } = await import('../requirements.js');
const { config } = await import('../config.js');

const llmOf = (reqs: Array<{ id: string; ok: boolean; detail: string }>) => {
  const r = reqs.find((x) => x.id === 'llm');
  assert.ok(r, 'there must always be a Model access requirement');
  return r!;
};

test('precondition: the module-load provider is cli, exactly as a console server sees it', () => {
  assert.equal(config.llm.provider, 'cli',
    'REDBOT_LLM is unset here on purpose — this is the environment the defect lived in');
});

test('told "deepseek", it asks for a DeepSeek key and not a Claude operator', async () => {
  const llm = llmOf(await checkRequirements({ provider: 'deepseek' }));

  assert.equal(llm.ok, true, `Model access should be met with a key present: ${llm.detail}`);
  assert.doesNotMatch(llm.detail, /Claude operator/,
    'REGRESSION: the key path was told to go and select a Claude login it will never use');
  assert.match(llm.detail, /DeepSeek/);
});

test('told nothing, it still answers for the module-load provider', async () => {
  /* `redbot doctor` depends on this: there, the environment IS the choice, and passing no
     argument must keep the old behaviour exactly. */
  const llm = llmOf(await checkRequirements());
  assert.equal(llm.ok, false);
  assert.match(llm.detail, /no Claude operator is selected/);
});

test('told "deepseek" with no key anywhere, it says THAT rather than inventing an operator problem', async () => {
  const saved = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const llm = llmOf(await checkRequirements({ provider: 'deepseek' }));
    assert.equal(llm.ok, false);
    assert.match(llm.detail, /no API key is stored or set/);
    assert.doesNotMatch(llm.detail, /Claude operator/);
  } finally {
    process.env.DEEPSEEK_API_KEY = saved;
  }
});

test('the same is true of the Anthropic key path', async () => {
  /* The defect was never DeepSeek-specific — `api` had it too, and would have shown the same
     "select a Claude operator" on an install with a perfectly good Anthropic key. */
  process.env.ANTHROPIC_API_KEY = 'sk-ant-requirement-proof-not-real';
  try {
    const llm = llmOf(await checkRequirements({ provider: 'api' }));
    assert.equal(llm.ok, true, llm.detail);
    assert.doesNotMatch(llm.detail, /Claude operator/);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

process.on('exit', () => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});
