/**
 * Anthropic client — fetch only, no SDK, no deps.
 *
 * Key comes from process.env.ANTHROPIC_API_KEY and nowhere else. If it is absent the
 * caller gets a clear error rather than a silent fallback, because a scout that
 * quietly stops qualifying is worse than one that stops loudly.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';

const API = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

export class LlmError extends Error {
  constructor(message, { status, retryable } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status ?? null;
    this.retryable = Boolean(retryable);
  }
}

export function loadPrompt(name, vars = {}) {
  const raw = readFileSync(join(ROOT, 'prompts', `${name}.md`), 'utf8');
  return raw.replace(/\{\{(\w+)\}\}/g, (m, k) =>
    k in vars ? String(vars[k] ?? '') : m);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function complete({ prompt, model, apiKey, maxTokens = 1600, temperature = 0.4, maxRetries = 3, fetchImpl = fetch }) {
  if (!apiKey) {
    throw new LlmError('ANTHROPIC_API_KEY is not set. Export it; never put it in a file.');
  }
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetchImpl(API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': VERSION
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          messages: [{ role: 'user', content: prompt }]
        })
      });
    } catch (e) {
      lastErr = new LlmError(`network error: ${e.message}`, { retryable: true });
      await sleep(500 * attempt);
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      lastErr = new LlmError(`upstream ${res.status}`, { status: res.status, retryable: true });
      const wait = Number(res.headers.get('retry-after')) * 1000 || 800 * attempt;
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new LlmError(`request failed ${res.status}: ${body.slice(0, 300)}`, { status: res.status });
    }

    const json = await res.json();
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new LlmError('empty completion');
    return { text, usage: json.usage ?? null, model: json.model ?? model };
  }
  throw lastErr ?? new LlmError('exhausted retries');
}

/**
 * Pull the first JSON object out of a model response.
 * Models sometimes wrap JSON in a fence or add a sentence; this tolerates both
 * without tolerating actual malformed JSON.
 */
export function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  if (start < 0) throw new Error('no JSON object in response');
  let depth = 0, inStr = false, escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw new Error('unterminated JSON object in response');
}
