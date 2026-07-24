/**
 * LLM access.
 *
 * Two providers, chosen by config.llm.provider:
 *
 *   'cli' (default) — shells out to the Claude Code CLI in print mode. Uses the operator's
 *                     existing Claude subscription. No API key, no per-token billing.
 *                     Measured 2026-07-22: ~28 s per call, which is why analyze batches.
 *   'api'           — Anthropic Messages API. Needs ANTHROPIC_API_KEY. Faster per call.
 *
 * Neither ever writes a credential to disk.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { config, anthropicKey, claudeConfigDir, operatorRecord } from './config.js';
import { say } from './log.js';

/** One announcement per process for a declared credential location. */
let announcedOperator = false;

export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'LlmError';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface CompleteOpts {
  prompt: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

/* ------------------------------------------------------------------ *
 * Provider: Claude Code CLI
 * ------------------------------------------------------------------ */
function completeViaCli(opts: CompleteOpts): Promise<string> {
  const { prompt, model, timeoutMs = config.llm.cliTimeoutMs } = opts;

  // Throws if no operator is set — redbot never borrows the machine's default login.
  const configDir = claudeConfigDir();
  mkdirSync(configDir, { recursive: true });

  // A declared credential location is announced once per process. The point of the
  // per-operator rule is that borrowing a login can never happen quietly.
  if (config.llm.operator && !announcedOperator) {
    const rec = operatorRecord(config.llm.operator);
    if (rec) {
      announcedOperator = true;
      say.warn(
        `Operator "${config.llm.operator}" is using a declared credential location:\n` +
        `    ${rec.configDir}\n` +
        (rec.note ? `    reason: ${rec.note}\n` : '') +
        (rec.declaredBy ? `    declared by ${rec.declaredBy}` +
          (rec.declaredAt ? ` on ${rec.declaredAt}` : '') + '\n' : '') +
        `    Remove the entry in data/operators/operators.json to undo this.`
      );
    }
  }

  /**
   * DEFECT-06 (2026-07-22, CRITICAL): `claude -p` runs as a full Claude Code agent in the
   * current working directory. Run from inside this repo it inherited CLAUDE.md, memory
   * pins, plan mode and hooks, and returned drafts containing agent meta-commentary and a
   * local Windows path — text that would otherwise have been posted to Reddit.
   *
   * Fix: execute in an empty scratch directory so there is no project context to inherit.
   */
  const scratch = pathJoin(tmpdir(), 'redbot-llm-scratch');
  mkdirSync(scratch, { recursive: true });

  return new Promise((resolve, reject) => {
    const child = spawn(
      config.llm.cliBin,
      [
        '-p',
        '--model', model,
        '--no-session-persistence',
        // DEFECT-06b: the operator's user settings may set defaultMode:"plan", which makes
        // `claude -p` write a plan file and return meta-commentary instead of the answer.
        // Force a non-plan mode so the completion is the completion.
        '--permission-mode', 'dontAsk'
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        cwd: scratch,
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
      }
    );

    let out = '';
    let err = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new LlmError(`claude CLI timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new LlmError(
        `cannot run "${config.llm.cliBin}": ${e.message}\n` +
        `Install Claude Code, or set REDBOT_LLM=api with ANTHROPIC_API_KEY.`
      ));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = out.trim();

      // DEFECT-09: the auth check used to sit after the exit-code branch, so a non-zero exit
      // skipped it and reported `claude CLI exited 1:` with nothing after the colon — the CLI
      // writes "Not logged in" to stdout, not stderr. Check both streams, and check first.
      const both = `${text}\n${err}`;
      if (/not logged in|please run \/login|invalid api key/i.test(both)) {
        reject(new LlmError(
          `Claude is not signed in for operator "${config.llm.operator ?? '(override)'}".

` +
          `Sign in once for this operator:
` +
          `  PowerShell:  $env:CLAUDE_CONFIG_DIR = "${configDir}"; claude
` +
          `  bash:        CLAUDE_CONFIG_DIR="${configDir}" claude

` +
          `then run /login inside it. redbot will not use this machine's default login.`
        ));
        return;
      }

      if (code !== 0) {
        // Report whichever stream actually said something, so the message is never empty.
        const detail = (err.trim() || text || '(no output on stdout or stderr)').slice(0, 400);
        reject(new LlmError(`claude CLI exited ${code}: ${detail}`));
        return;
      }

      if (!text) { reject(new LlmError('claude CLI returned nothing')); return; }

      resolve(text);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/* ------------------------------------------------------------------ *
 * Provider: Anthropic API
 * ------------------------------------------------------------------ */
async function completeViaApi(opts: CompleteOpts): Promise<string> {
  const key = anthropicKey();
  const { prompt, model, maxTokens = 1600, temperature = 0.4 } = opts;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.llm.maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(config.llm.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': config.llm.version
        },
        body: JSON.stringify({
          model, max_tokens: maxTokens, temperature,
          messages: [{ role: 'user', content: prompt }]
        })
      });
    } catch (e) {
      lastError = new LlmError(`network error: ${e instanceof Error ? e.message : String(e)}`);
      await sleep(600 * attempt);
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      lastError = new LlmError(`upstream ${res.status}`, res.status);
      const retryAfter = Number(res.headers.get('retry-after')) * 1000;
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 900 * attempt);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LlmError(`request failed ${res.status}: ${text.slice(0, 300)}`, res.status);
    }

    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const out = (json.content ?? [])
      .filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
    if (!out) throw new LlmError('empty completion');
    return out;
  }
  throw lastError ?? new LlmError('exhausted retries');
}

/* ------------------------------------------------------------------ */
export async function complete(opts: CompleteOpts): Promise<string> {
  return config.llm.provider === 'api' ? completeViaApi(opts) : completeViaCli(opts);
}

/** Pull the first JSON value (object or array) out of a possibly-fenced response. */
export function extractJson<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;

  const objStart = candidate.indexOf('{');
  const arrStart = candidate.indexOf('[');
  const useArray = arrStart >= 0 && (objStart < 0 || arrStart < objStart);
  const start = useArray ? arrStart : objStart;
  if (start < 0) throw new Error('no JSON value in model response');

  const open = useArray ? '[' : '{';
  const close = useArray ? ']' : '}';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1)) as T;
    }
  }
  throw new Error('unterminated JSON value in model response');
}

