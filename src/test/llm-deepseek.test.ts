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
  body: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content, reasoning_content: reasoning ?? null } }] }
});

/**
 * The shape DeepSeek returns when the budget ran out BEFORE the answer began.
 *
 * MEASURED, not imagined — 2026-09-24, thread 77d6fe170b77, the one that failed in production
 * on 2026-09-21, at src/commands/draft.ts's own settings (deepseek-v4-pro, max_tokens 1600,
 * temperature 0.5):
 *
 *   max_tokens=1600  finish_reason=length  content=0ch     reasoning_tokens=1600
 *   max_tokens=4000  finish_reason=length  content=0ch     reasoning_tokens=4000
 *   max_tokens=8000  finish_reason=stop    content=1093ch  reasoning_tokens=3014
 *
 * `max_tokens` on this endpoint bounds REASONING PLUS ANSWER. On the Anthropic endpoint it
 * bounds the answer alone. Every maxTokens in this repository was sized for the second meaning.
 * `effort: 'low'` was tested at 1600 and 4000 and changed nothing — the budget is the lever.
 */
const truncated = (reasoningTokens = 1600) => ({
  status: 200,
  body: {
    choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '', reasoning_content: 'x'.repeat(40) } }],
    usage: { completion_tokens: reasoningTokens, completion_tokens_details: { reasoning_tokens: reasoningTokens } }
  }
});

test('a caller asking for less than a reasoning model needs is raised to the floor', async () => {
  /**
   * THE WASTE THIS REMOVES. Every maxTokens in this repository was sized for the Anthropic
   * endpoint, where max_tokens bounds the ANSWER. Here it bounds reasoning plus answer, so the
   * call sites ask for a fraction of what the model needs and the first attempts are spent
   * producing nothing:
   *
   *   src/gap.ts:96            1600   measured need ~9,905 completion tokens
   *   src/commands/draft.ts    1600   measured need ~3,255
   *   src/argus/extract.ts   3000/1400
   *   src/commands/warmup.ts    700
   *
   * Measured 2026-09-24 on thread 869b0d4176e9, deepseek-flash, prompt ~1,800 tokens:
   * max_tokens=16000 -> finish_reason=stop, reasoning_tokens=9053, completion_tokens=9905.
   * At 1600 the same call truncates, and the retry ladder burns 1600 then 4800 before its
   * third attempt has any chance — three calls billed, two of them guaranteed to produce
   * nothing.
   *
   * RAISING THE FLOOR IS FREE. `max_tokens` is a ceiling, not a reservation: the bill is the
   * tokens generated. A call that finishes in 800 costs 800 whether the ceiling was 1,600 or
   * 16,000. So the floor removes the wasted attempts and costs nothing on the calls that
   * already fit — which is why this is a floor and not a per-call-site retune.
   */
  const { calls, restore } = stubFetch([ok('fits fine')]);
  try {
    await complete({ prompt: 'p', model: 'm', maxTokens: 1600 });
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.ok(body.max_tokens >= 16000,
      `a 1600-token ask must be raised to the measured floor; got ${body.max_tokens}`);
  } finally { restore(); }
});

test('a caller asking for MORE than the floor keeps what it asked for', () => {
  /* The floor lifts, it never caps. A caller that has measured its own need — or a future one
     on a model that reasons harder — must not be quietly reduced to this constant. */
  return (async () => {
    const { calls, restore } = stubFetch([ok('fits fine')]);
    try {
      await complete({ prompt: 'p', model: 'm', maxTokens: 50_000 });
      assert.equal(JSON.parse(String(calls[0]!.init.body)).max_tokens, 50_000);
    } finally { restore(); }
  })();
});

test('a budget eaten by reasoning is RETRIED with a bigger one, not reported as an empty model', async () => {
  const { calls, restore } = stubFetch([truncated(1600), ok('the answer that fits')]);
  try {
    assert.equal(await complete({ prompt: 'p', model: 'm', maxTokens: 1600 }), 'the answer that fits');
    assert.equal(calls.length, 2, 'a truncation must be retried, not thrown on first sight');
    const first = JSON.parse(String(calls[0]!.init.body));
    const second = JSON.parse(String(calls[1]!.init.body));
    assert.equal(first.max_tokens, 16_000,
                 'the first attempt starts at the floor, not at the caller\'s Anthropic-shaped number');
    assert.ok(second.max_tokens > first.max_tokens,
              `the retry must raise the budget; got ${second.max_tokens} after ${first.max_tokens}`);
  } finally { restore(); }
});

test('a truncation that survives every retry says WHY, and does not call the model empty', async () => {
  /**
   * THE DEFECT THIS PINS. `empty completion` was thrown for two unrelated failures: a model
   * that genuinely returned nothing, and a budget that ran out before the answer started. The
   * second is fixable by the operator and the first is not, and the message said neither.
   * Three of these reached data/redbot.db on 2026-09-21 as
   * `draft failed for 77d6fe170b77: empty completion`, and named no cause at all.
   */
  const { restore } = stubFetch([truncated(1600)]);
  try {
    await assert.rejects(complete({ prompt: 'p', model: 'm', maxTokens: 1600 }), (e: Error) => {
      assert.match(e.message, /reasoning/i, 'the message must name what consumed the budget');
      assert.match(e.message, /length/, "the message must carry DeepSeek's own finish_reason");
      assert.ok(!/^empty completion$/.test(e.message),
                'a truncation is not an empty completion — that conflation is the defect');
      return true;
    });
  } finally { restore(); }
});

test('a genuinely empty answer that was NOT truncated is still an empty completion', async () => {
  /* The other half of the split: finish_reason 'stop' with no content is the model returning
     nothing, and raising the budget would not help. It must keep its own distinct message. */
  const { restore } = stubFetch([ok('')]);
  try {
    await assert.rejects(complete({ prompt: 'p', model: 'm' }), /empty completion/);
  } finally { restore(); }
});

test('the model ids resolve to DeepSeek ids, not Claude ids', () => {
  /**
   * The defect this pins: `config.llm.analyzeModel` was the constant
   * 'claude-haiku-4-5-20251001'. Posted to /chat/completions that is a 400 on every call, and
   * src/argus/pipeline.ts would have recorded a Claude model name against a DeepSeek run.
   */
  assert.equal(config.llm.provider, 'deepseek');
  /**
   * `deepseek-flash`, and the missing `v4-` is the point.
   *
   * This asserted 'deepseek-v4-flash' — an id DeepSeek does not serve, so the assertion passed
   * while the product asked for a model that does not exist. A constant checked against itself
   * proves the constant has not changed, never that it is right. Measured against the vendor's
   * `GET /models` 2026-09-24: the only ids are `deepseek-flash` and `deepseek-v4-pro`.
   */
  assert.equal(config.llm.analyzeModel, 'deepseek-flash');
  assert.equal(config.llm.draftModel, 'deepseek-v4-pro');
  assert.ok(!config.llm.analyzeModel.startsWith('claude-'));
  /* The sibling carries `v4`, this one does not. Pinned so a tidying pass cannot "regularise"
     them into a matching pair and reintroduce the id that was never real. */
  assert.ok(!config.llm.analyzeModel.includes('v4'),
            'deepseek-flash is DeepSeek-V4.1-Flash and carries no version in its id');
});

test('the request is the documented DeepSeek call', async () => {
  const { calls, restore } = stubFetch([ok('hello')]);
  try {
    const out = await complete({ prompt: 'ping', model: 'deepseek-flash', maxTokens: 99, temperature: 0.2 });
    assert.equal(out, 'hello');

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'https://api.deepseek.com/chat/completions');

    const h = calls[0]!.init.headers as Record<string, string>;
    assert.equal(h.authorization, 'Bearer sk-test-not-a-real-key',
      'DeepSeek authenticates with a bearer token — x-api-key is the Anthropic header and is a 401 here');
    assert.equal(h['anthropic-version'], undefined, 'the Anthropic version header must not be sent to DeepSeek');

    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.model, 'deepseek-flash');
    /* 99 was what the caller asked for; 16,000 is what goes on the wire. On this endpoint
       max_tokens bounds reasoning AND answer, and a reasoning model handed 99 spends all 99
       thinking and returns nothing — measured. The floor lifts every ask to something the model
       can actually finish inside, and costs nothing when it finishes early because max_tokens is
       a ceiling, not a reservation. */
    assert.equal(body.max_tokens, 16_000);
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
