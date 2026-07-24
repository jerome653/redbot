/**
 * Paths and settings. No secrets in this file, ever — the Appilot APK shipped two live
 * API keys and that is the mistake this rule exists to prevent.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const DATA = join(ROOT, 'data');

export const paths = {
  data: DATA,
  session: join(DATA, 'session.json'),
  threads: join(DATA, 'threads.json'),
  analysis: join(DATA, 'analysis.json'),
  /** Phase 3: what each discussion already contains and what it is missing. */
  gaps: join(DATA, 'gaps.json'),
  /** Phase 3: contribute-or-skip, derived mechanically from the gaps. */
  assessments: join(DATA, 'assessments.json'),
  drafts: join(DATA, 'drafts.json'),
  history: join(DATA, 'history.jsonl')
};

export function ensureData(): void {
  mkdirSync(DATA, { recursive: true });
}

/* ------------------------------------------------------------------ *
 * Accounts
 *
 * `data/accounts.json` describes who redbot posts as. It is read here, and only here, so
 * that every command becomes account-aware through `config.browser` without any command
 * needing to know accounts exist.
 *
 * Selection is explicit: an account is used because REDBOT_ACCOUNT names it. There is no
 * "default account" and no first-entry fallback — silently acting as whoever happens to be
 * first in a config file is the same mistake as inheriting an ambient login.
 * ------------------------------------------------------------------ */
export interface AccountRecord {
  handle: string;
  role?: string;
  speaks?: string;
  knows?: string[];
  subreddits?: string[];
  timezone?: string;
  quietHours?: [number, number];
  dailyCeiling?: number;
  profileDir?: string;
  debugPort?: number;
  note?: string;
}

export function loadAccounts(): AccountRecord[] {
  const file = join(DATA, 'accounts.json');
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { accounts?: AccountRecord[] };
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch {
    throw new Error('data/accounts.json is not readable JSON. Fix or delete it.');
  }
}

/** The account named by REDBOT_ACCOUNT, or null. Throws if the name is not in the file. */
export function selectedAccount(): AccountRecord | null {
  const want = process.env.REDBOT_ACCOUNT;
  if (!want) return null;
  const found = loadAccounts().find((a) => a.handle.toLowerCase() === want.toLowerCase());
  if (!found) {
    const known = loadAccounts().map((a) => a.handle).join(', ') || '(none configured)';
    throw new Error(`REDBOT_ACCOUNT="${want}" is not in data/accounts.json. Known: ${known}`);
  }
  return found;
}

/**
 * The CDP endpoint redbot attaches to must be loopback. REDBOT_CDP can be set by the product
 * console from a request body, so an attacker who could reach that endpoint could otherwise
 * point redbot at a debugger they control and have every scraped thread fed to their own
 * process (evaluation H5). A non-loopback value is refused, not silently attached to.
 */
export function assertLoopbackCdp(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') return url;
  } catch { /* fall through to the throw */ }
  throw new Error(`REDBOT_CDP="${url}" is not a loopback address — refusing to attach to a non-local debugger.`);
}

function resolveEndpoint(): string {
  if (process.env.REDBOT_CDP) return assertLoopbackCdp(process.env.REDBOT_CDP);
  const a = selectedAccount();
  if (a?.debugPort) return `http://127.0.0.1:${a.debugPort}`;
  return 'http://127.0.0.1:9222';
}

function resolveProfileDir(): string {
  const a = selectedAccount();
  return join(DATA, a?.profileDir ?? 'chrome-profile');
}

export const config = {
  redditBase: 'https://www.reddit.com',

  /*
   * `expertise` MOVED to the domain profile (`src/domain.ts`, overridable by
   * `data/domain.json`) on 2026-07-24.
   *
   * It lived here as six hardcoded strings while `competence.ts` held a second, separate
   * hardcoded table of the vocabulary for those same areas. Two tables that must agree, kept
   * in agreement by hand, is a defect waiting to happen — and the competence check exists
   * only because the model over-claims against the expertise list, so a drift between them is
   * invisible until a reply goes out about somebody else's stack.
   *
   * Read `domain.expertise`. It is not re-exported here on purpose: `domain.ts` imports DATA
   * from this file, so a back-import would make the cycle real.
   */

  /**
   * Brand policy. redbot writes replies that help; it does not advertise.
   * `org` is only used to RECOGNISE and BLOCK self-promotion in a draft — it is never
   * inserted into one. Leave it set and the linter will reject any draft that names it.
   */
  brand: {
    org: 'SGEN',
    /** never let a generated reply name the org at all */
    forbidMention: true,
    /** if a human deliberately adds it during review, this line must accompany it */
    disclosureLine: 'Disclosure: I work on SGEN.'
  },

  /**
   * The one sanctioned AI-provenance disclosure. The linter blocks arbitrary "as an AI" /
   * "generated with Claude" text by design, but that left an operator unable to comply where a
   * subreddit REQUIRES an AI label (evaluation M5). This exact line is exempt from the
   * assistant-voice checks — an opt-in a person adds during review, not something the model is
   * allowed to invent — so labeling is possible without disabling a gate.
   */
  aiDisclosureLine: 'Disclosure: this reply was drafted with AI assistance and reviewed by a person before posting.',

  /**
   * 'cli' shells out to Claude Code (uses the operator's existing subscription, no key).
   * 'api' uses the Anthropic API and needs ANTHROPIC_API_KEY.
   * Override with REDBOT_LLM=api
   */
  llm: {
    provider: (process.env.REDBOT_LLM === 'api' ? 'api' : 'cli') as 'cli' | 'api',
    cliBin: process.env.REDBOT_CLAUDE_BIN ?? 'claude',
    cliTimeoutMs: 180_000,

    /**
     * Claude auth is PER OPERATOR, always.
     *
     * redbot never inherits the machine's ambient Claude login, so it cannot quietly run
     * as — or bill — whoever happens to be signed in on the box. Each operator points at
     * their own config directory and logs in there once.
     *
     *   REDBOT_OPERATOR=<name>            -> data/operators/<name>/claude
     *   REDBOT_CLAUDE_CONFIG_DIR=<path>   -> explicit override
     *
     * With neither set, the CLI provider refuses to run.
     */
    operator: process.env.REDBOT_OPERATOR ?? null,
    claudeConfigDirOverride: process.env.REDBOT_CLAUDE_CONFIG_DIR ?? null,

    apiUrl: 'https://api.anthropic.com/v1/messages',
    version: '2023-06-01',
    analyzeModel: 'claude-haiku-4-5-20251001',
    draftModel: 'claude-sonnet-5',
    /** threads scored per CLI call — a call costs ~28 s, so batching is what makes this usable */
    analyzeBatchSize: 8,
    maxRetries: 3
  },

  /**
   * Pacing.
   *
   * DEFECT-02 (2026-07-22): the previous values (900-2600 ms) produced HTTP 429 after
   * roughly 75 page loads in a few minutes. Recovery took under 5 minutes, but the run
   * died mid-collection. These values are the corrected envelope; see
   * qa/evidence/phase8-*.log for the measurements behind them.
   */
  pacing: {
    minActionMs: 3200,
    maxActionMs: 7000,
    typeCharMinMs: 40,
    typeCharMaxMs: 150,
    /** extra pause after every N thread fetches, to break up sustained bursts */
    burstEvery: 8,
    burstPauseMs: 20_000
  },

  /** Hard stops that keep a run inside the measured envelope. */
  budget: {
    maxThreadsPerRun: 15,
    /** on HTTP 429 / block page: wait this long, then retry once */
    rateLimitBackoffMs: 300_000,
    maxRateLimitRetries: 1
  },

  /**
   * redbot ATTACHES to a Chrome the operator runs; it never launches one.
   * Measured: Playwright-launched browsers get a Reddit block page.
   * See certification/evidence/2026-07-22-reddit-access.md
   *
   * WHICH Chrome depends on which account is selected. Every command reads these two
   * fields, so resolving them here is what makes the whole CLI account-aware — before
   * this, `data/accounts.json` was written by the console and read by nothing, and a
   * second account was presentational.
   *
   *   REDBOT_ACCOUNT=<handle>   -> that account's port and profile from accounts.json
   *   REDBOT_CDP=<url>          -> explicit override, still wins
   *   neither                   -> the original single-profile behaviour, unchanged
   */
  browser: {
    cdpEndpoint: resolveEndpoint(),
    profileDir: resolveProfileDir()
  },

  limits: {
    maxThreadsPerRead: 15,
    maxCommentsPerThread: 30
  }
};

export class OperatorAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperatorAuthError';
  }
}

/**
 * An operator may declare, on disk, that their credentials live somewhere other than the
 * default per-operator folder — including this machine's own Claude login.
 *
 * The rule this respects is "never *silently* inherit whoever happens to be signed in".
 * A named entry in `data/operators/operators.json` is not silent: it is explicit, readable,
 * reviewable in a diff, and reported at every use. Shape:
 *
 *   { "jerome": { "configDir": "C:/Users/.../.claude",
 *                 "declaredBy": "jerome", "declaredAt": "2026-07-22",
 *                 "note": "why this operator uses a shared login" } }
 *
 * The file is gitignored along with the rest of `data/`, so no path leaves the machine.
 */
export interface OperatorRecord {
  configDir: string;
  declaredBy?: string;
  declaredAt?: string;
  note?: string;
}

export function operatorRecord(name: string): OperatorRecord | null {
  const file = join(DATA, 'operators', 'operators.json');
  if (!existsSync(file)) return null;
  try {
    const all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, OperatorRecord>;
    const rec = all[name];
    return rec?.configDir ? rec : null;
  } catch {
    throw new OperatorAuthError(
      `data/operators/operators.json is not readable JSON. Fix or delete it.`
    );
  }
}

/**
 * Where this operator's Claude credentials live. Never falls back to the ambient
 * CLAUDE_CONFIG_DIR or to ~/.claude — an unset operator is an error, not a default.
 */
export function claudeConfigDir(): string {
  if (config.llm.claudeConfigDirOverride) return config.llm.claudeConfigDirOverride;

  if (config.llm.operator) {
    const rec = operatorRecord(config.llm.operator);
    if (rec) return rec.configDir;
  }

  if (!config.llm.operator) {
    throw new OperatorAuthError(
      'No Claude operator set — redbot will not use this machine\'s default Claude login.\n\n' +
      '  PowerShell:  $env:REDBOT_OPERATOR = "yourname"\n' +
      '  bash:        export REDBOT_OPERATOR=yourname\n\n' +
      'Then sign in once as that operator (opens Claude, run /login inside it):\n' +
      `  PowerShell:  $env:CLAUDE_CONFIG_DIR = "${join(DATA, 'operators', '<yourname>', 'claude')}"; claude\n` +
      `  bash:        CLAUDE_CONFIG_DIR="${join(DATA, 'operators', '<yourname>', 'claude')}" claude\n\n` +
      'Or use the API instead:  REDBOT_LLM=api with ANTHROPIC_API_KEY.'
    );
  }

  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/i.test(config.llm.operator)) {
    throw new OperatorAuthError(
      `Invalid REDBOT_OPERATOR "${config.llm.operator}" — letters, digits, dot, dash, underscore only.`
    );
  }

  return join(DATA, 'operators', config.llm.operator, 'claude');
}

export function anthropicKey(): string {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set.\n' +
      '  PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."\n' +
      '  bash:        export ANTHROPIC_API_KEY=sk-ant-...'
    );
  }
  return k;
}
