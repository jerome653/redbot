/**
 * A 402 from DeepSeek is remembered across processes, so the calls after it do not each
 * hit the endpoint to be told the same thing.
 *
 * MEASURED 2026-10-29 on cardinal: 100 `kind='error'` history rows between 16:03:25Z and
 * 20:50:37Z, every one "DeepSeek refused the call: insufficient balance … (HTTP 402)". Each
 * tick is its own `dist/cli.js` process, so an in-memory flag would not have stopped one of
 * them — the latch lives in the data directory.
 *
 * NOTHING HERE MAKES A REAL CALL. `globalThis.fetch` is stubbed throughout.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-latch-'));
process.env.REDBOT_LLM = 'deepseek';
process.env.DEEPSEEK_API_KEY = 'sk-test-not-a-real-key';
delete process.env.REDBOT_OPERATOR;

const { complete, balanceLatch, clearBalanceLatch, BALANCE_LATCH_MS } = await import('../llm.js');
const { paths } = await import('../config.js');

const realFetch = globalThis.fetch;
function stubFetch(statuses: number[]) {
  let calls = 0;
  globalThis.fetch = (async () => {
    const status = statuses[Math.min(calls++, statuses.length - 1)]!;
    const body = status === 200
      ? { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }] }
      : {};
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { count: () => calls, restore: () => { globalThis.fetch = realFetch; } };
}

test('a 402 writes the latch, and the next call is refused without touching the network', async () => {
  clearBalanceLatch();
  const f = stubFetch([402]);
  try {
    await assert.rejects(complete({ prompt: 'p', model: 'm' }), /HTTP 402/);
    assert.equal(f.count(), 1);
    assert.ok(balanceLatch(), 'the 402 must be remembered');

    await assert.rejects(
      complete({ prompt: 'p', model: 'm' }),
      (e: Error & { status?: number }) => /Not run: LLM balance/.test(e.message) && e.status === 402
    );
    assert.equal(f.count(), 1, 'a latched call must not reach fetch');
  } finally { f.restore(); clearBalanceLatch(); }
});

test('the latch is on disk, so a second process sees it', async () => {
  clearBalanceLatch();
  const f = stubFetch([402]);
  try {
    await assert.rejects(complete({ prompt: 'p', model: 'm' }), /HTTP 402/);
    assert.ok(existsSync(join(paths.data, 'llm-balance-402.json')));
  } finally { f.restore(); clearBalanceLatch(); }
});

test('an expired latch lets one call through, and a success clears it', async () => {
  writeFileSync(
    join(paths.data, 'llm-balance-402.json'),
    JSON.stringify({ at: new Date(Date.now() - BALANCE_LATCH_MS - 1000).toISOString(), provider: 'deepseek' })
  );
  assert.equal(balanceLatch(), null, 'an expired latch is not active');
  const f = stubFetch([200]);
  try {
    assert.equal(await complete({ prompt: 'p', model: 'm' }), 'ok');
    assert.equal(f.count(), 1);
    assert.ok(!existsSync(join(paths.data, 'llm-balance-402.json')), 'a success removes the latch file');
  } finally { f.restore(); clearBalanceLatch(); }
});

test('an unreadable latch file fails open — it never bricks generation', async () => {
  writeFileSync(join(paths.data, 'llm-balance-402.json'), '{not json');
  assert.equal(balanceLatch(), null);
  const f = stubFetch([200]);
  try {
    assert.equal(await complete({ prompt: 'p', model: 'm' }), 'ok');
  } finally { f.restore(); clearBalanceLatch(); }
});
