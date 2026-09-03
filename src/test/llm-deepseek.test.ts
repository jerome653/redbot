/**
 * The DeepSeek provider, on the wire.
 *
 * WHY THIS FILE EXISTS AT ALL. Adding a third provider to `complete()` is not a config change —
 * it is a second wire format. Anthropic answers with `content[]` blocks; DeepSeek answers with
 * `choices[].message` (OpenAI shape, per https://api-docs.deepseek.com, read 2026-09-03). A
 * transport that posts correctly and reads the wrong field returns an empty string on every call
 * while every HTTP status says 200, and the first symptom is `extractJson` throwing "no JSON
 * value in model response" three layers away in analyze. So the shape is pinned here, not
 * inferred at the call site.
 *
 * NOTHING HERE MAKES A REAL CALL. `globalThis.fetch` is replaced for the duration; DeepSeek is a
 * metered vendor and a test suite that spends money is a test suite nobody runs. Every assertion
 * is about the request redbot BUILDS and the answer it EXTRACTS.
 *
 * REDBOT_LLM and DEEPSEEK_API_KEY are set before the first import because src/config.ts resolves
 * `provider` once at module load and `deepseekKey()` reads the environment before the vault —
 * which keeps this file off the database entirely.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-deepseek-'));
process.env.REDBOT_LLM = 'deepseek';
process.env.DEEPSEEK_API_KEY = 'sk-test-not-a-real-key';
delete process.env.REDBOT_OPERATOR;

const { complete } = await import('../llm.js');
const { config } = await import('../config.js');

/** One recorded request, plus the canned answer the stub gave back. */
interface Call { url: string; init: RequestInit }

const realFetch = globalThis.fetch;

/**
 * Install a stub that answers with `replies` in order, recording every request.
 *
 * Returns the recording array and a restore function. A reply is either a Response or a status
 * number, so a retry test reads as `[429, 200]` rather than four lines of Response construction.
 */
function stubFetch(replies: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  let i = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = replies[Math.min(i++, replies.length - 1)]!;
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) }
    });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

/** The shape DeepSeek actually returns for a completed non-streaming call. */
const ok = (content: string | null, reasoning?: string) => ({
  status: 200,
  body: { choices: [{ message: { role: 'assistant', content, reasoning_content: reasoning ?? null } }] }
});

test('the model ids resolve to DeepSeek ids, not Claude ids', () => {
  /**
   * The defect this pins: `config.llm.analyzeModel` was the constant
   * 'claude-haiku-4-5-20251001'. Posted to /chat/completions that is a 400 on every call, and
   * src/argus/pipeline.ts would have recorded a Claude model name against a DeepSeek run.
   */
  assert.equal(config.llm.provider, 'deepseek');
  assert.equal(config.llm.analyzeModel, 'deepseek-v4-flash');
  assert.equal(config.llm.draftModel, 'deepseek-v4-pro');
  assert.ok(!config.llm.analyzeModel.startsWith('claude-'));
});

test('the request is the documented DeepSeek call', async () => {
  const { calls, restore } = stubFetch([ok('hello')]);
  try {
    const out = await complete({ prompt: 'ping', model: 'deepseek-v4-flash', maxTokens: 99, temperature: 0.2 });
    assert.equal(out, 'hello');

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'https://api.deepseek.com/chat/completions');

    const h = calls[0]!.init.headers as Record<string, string>;
    assert.equal(h.authorization, 'Bearer sk-test-not-a-real-key',
      'DeepSeek authenticates with a bearer token — x-api-key is the Anthropic header and is a 401 here');
    assert.equal(h['anthropic-version'], undefined, 'the Anthropic version header must not be sent to DeepSeek');

    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.model, 'deepseek-v4-flash');
    assert.equal(body.max_tokens, 99);
    assert.equal(body.temperature, 0.2);
    assert.equal(body.stream, false, 'a streamed answer would not parse as one JSON body');
    assert.deepEqual(body.messages, [{ role: 'user', content: 'ping' }]);
  } finally { restore(); }
});

test('the answer is read from choices[0].message.content', async () => {
  const { restore } = stubFetch([ok('the actual answer')]);
  try {
    assert.equal(await complete({ prompt: 'p', model: 'm' }), 'the actual answer');
  } finally { restore(); }
});

test('an Anthropic-shaped body yields nothing rather than a wrong answer', async () => {
  /**
   * Guards the copy-paste failure: `content: [{type:'text', text:'…'}]` is what the Anthropic
   * transport reads. If this ever starts returning that text, the two transports have been
   * merged and DeepSeek is being parsed by the wrong reader.
   */
  const { restore } = stubFetch([{ status: 200, body: { content: [{ type: 'text', text: 'anthropic shape' }] } }]);
  try {
    await assert.rejects(complete({ prompt: 'p', model: 'm' }), /empty completion/);
  } finally { restore(); }
});

test('reasoning_content is never part of the answer', async () => {
  /**
   * DeepSeek returns chain-of-thought in its own field. Concatenating it would put prose — with
   * braces in it — in front of the JSON that every analyze and gap caller parses, and
   * `extractJson` matches on the first brace it finds.
   */
  const { restore } = stubFetch([ok('{"score":80}', 'Let me think. {this is not the answer}')]);
  try {
    const out = await complete({ prompt: 'p', model: 'm' });
    assert.equal(out, '{"score":80}');
    assert.ok(!out.includes('Let me think'));
  } finally { restore(); }
});

test('402 insufficient balance is terminal, and says so', async () => {
  /**
   * A documented DeepSeek status with no Anthropic equivalent. Retrying cannot add funds, so a
   * retry loop here would be three requests and a 3-second wait to reach the same refusal — and
   * the operator would read "exhausted retries" instead of "the account is empty".
   */
  const { calls, restore } = stubFetch([{ status: 402 }]);
  try {
    await assert.rejects(
      complete({ prompt: 'p', model: 'm' }),
      (e: Error) => /insufficient balance/i.test(e.message) && /402/.test(e.message)
    );
    assert.equal(calls.length, 1, '402 must not be retried');
  } finally { restore(); }
});

test('401 names the key, and is not retried', async () => {
  const { calls, restore } = stubFetch([{ status: 401 }]);
  try {
    await assert.rejects(complete({ prompt: 'p', model: 'm' }), /rejected the API key/);
    assert.equal(calls.length, 1);
  } finally { restore(); }
});

test('429 is retried, and the retry can succeed', async () => {
  const { calls, restore } = stubFetch([
    { status: 429, headers: { 'retry-after': '0' } },
    ok('second time')
  ]);
  try {
    assert.equal(await complete({ prompt: 'p', model: 'm' }), 'second time');
    assert.equal(calls.length, 2);
  } finally { restore(); }
});

test('a null content field is an empty completion, not the string "null"', async () => {
  const { restore } = stubFetch([ok(null)]);
  try {
    await assert.rejects(complete({ prompt: 'p', model: 'm' }), /empty completion/);
  } finally { restore(); }
});

test('a 400 is thrown on the first answer with the body attached', async () => {
  const { calls, restore } = stubFetch([{ status: 400, body: { error: { message: 'bad model' } } }]);
  try {
    await assert.rejects(complete({ prompt: 'p', model: 'm' }), /request failed 400.*bad model/s);
    assert.equal(calls.length, 1);
  } finally { restore(); }
});
