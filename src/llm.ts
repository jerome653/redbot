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
import { mkdirSync, existsSync } from 'node:fs';
import { delimiter as pathDelimiter, isAbsolute } from 'node:path';
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
/**
 * A CLI that can be spawned WITHOUT a shell — the difference is a security boundary, not a tidy-up.
 *
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG. `spawn(..., { shell: true })` on Windows runs the command through `cmd.exe`,
 * and `claude` on this machine resolves to a BATCH FILE (a PATH shim at
 * `~/.local/shims/claude.cmd`). The prompt is delivered on stdin — and when a batch file exits
 * before draining its input, cmd.exe reads what is left in that pipe AS COMMANDS.
 *
 * That is not a theory. Recorded in this install's history on 2026-08-01, three gap analyses
 * failed together with:
 *
 *     claude CLI exited 1: 'n' is not recognized as an internal or external command
 *     Error: Input must be provided either through stdin or as a prompt argument when using -p
 *
 * Both halves of one cause: a line of PROMPT TEXT beginning with "n" was executed as a shell
 * command, and the CLI itself got nothing. Prompt text is model output about Reddit threads —
 * arbitrary text reaching a command interpreter. Node warns about the same class on every call:
 * "Passing args to a child process with shell option true can lead to security vulnerabilities,
 * as the arguments are not escaped, only concatenated."
 *
 * WHY IT LOOKS INTERMITTENT. It needs the batch layer to lose the race, so most runs are fine —
 * 11 of 14 analyses succeeded that day and a run today succeeded too. A defect that usually works
 * is not a smaller defect; it is a harder one to catch.
 *
 * THE FIX is to remove `cmd.exe` from the path entirely by spawning a real executable. Node
 * REFUSES to spawn `.cmd`/`.bat` without a shell (the CVE-2024-27980 mitigation), which is why
 * the shell was there — so the executable has to be found rather than assumed.
 *
 * BILLING IS PRESERVED, and that was checked before writing this. The shim exists to redirect
 * BARE launches to a specific account; its first three lines are `if defined CLAUDE_CONFIG_DIR
 * goto run`, and `:run` is `"%USERPROFILE%\.localin\claude.exe" %*`. Every call from here
 * sets CLAUDE_CONFIG_DIR (see the spawn env below), so for redbot the shim has always been a
 * pass-through to that exe. Spawning it directly runs the same binary with the same environment.
 *
 * Falls back to the old behaviour when no real executable can be found, because a working call
 * with a known flaw beats no call at all — and says so, once, rather than degrading silently.
 * ---------------------------------------------------------------------------
 */
let resolvedCli: { file: string; shell: boolean } | null = null;
let warnedShellFallback = false;

function resolveCli(bin: string): { file: string; shell: boolean } {
  if (resolvedCli) return resolvedCli;
  if (process.platform !== 'win32') return (resolvedCli = { file: bin, shell: false });

  /* An absolute path is taken at face value; only a bare name needs looking up. */
  const candidates: string[] = [];
  if (isAbsolute(bin)) candidates.push(bin);
  else {
    for (const dir of (process.env.PATH ?? '').split(pathDelimiter).filter(Boolean)) {
      /* `.exe` ONLY. A `.cmd` or `.bat` is the thing that needs cmd.exe, which is the bug. */
      candidates.push(pathJoin(dir, bin + '.exe'));
    }
  }
  for (const c of candidates) {
    if (c.toLowerCase().endsWith('.exe') && existsSync(c)) {
      return (resolvedCli = { file: c, shell: false });
    }
  }

  if (!warnedShellFallback) {
    warnedShellFallback = true;
    say.warn(
      `No "${bin}.exe" on PATH — falling back to a shell spawn. The prompt is piped to a batch ` +
      'file through cmd.exe, which has been observed executing prompt text as commands ' +
      '(2026-08-01). Install the CLI so a real executable is on PATH to close this.'
    );
  }
  return (resolvedCli = { file: bin, shell: true });
}

  const scratch = pathJoin(tmpdir(), 'redbot-llm-scratch');
  mkdirSync(scratch, { recursive: true });

  return new Promise((resolve, reject) => {
    const cli = resolveCli(config.llm.cliBin);
    const child = spawn(
      cli.file,
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
        /* False whenever a real executable was found — see resolveCli. Only a machine with no
           `claude.exe` on PATH still pays the cmd.exe cost, and it is warned about once. */
        shell: cli.shell,
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
  const key = await anthropicKey();
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

/**
 * True once we have warned that a determinism request cannot be honoured on the CLI provider.
 * One warning per process is enough; a per-call warning would bury the pipeline output.
 */
let warnedNonDeterministic = false;

/* ------------------------------------------------------------------ */
export async function complete(opts: CompleteOpts): Promise<string> {
  /**
   * The Claude Code CLI (`claude -p`) exposes no temperature control, so a caller asking for
   * `temperature: 0` — Argus does, to make a certification pass reproducible — silently gets the
   * CLI's own sampling instead. The value was dropped without a word (evaluation M4), so a run
   * that BELIEVED it was deterministic was not. We cannot make the subscription CLI
   * deterministic; we can refuse to imply it is. Say so once, and point at the provider that can.
   */
  if (
    config.llm.provider !== 'api' &&
    typeof opts.temperature === 'number' &&
    opts.temperature === 0 &&
    !warnedNonDeterministic
  ) {
    warnedNonDeterministic = true;
    say.warn(
      'A deterministic (temperature 0) pass was requested, but the Claude Code CLI provider ' +
      'has no temperature control — this pass is NOT reproducible. Use REDBOT_LLM=api with ' +
      'ANTHROPIC_API_KEY for a deterministic run.'
    );
  }
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

