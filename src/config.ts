/**
 * Paths and settings. No secrets in this file, ever — the Appilot APK shipped two live
 * API keys and that is the mistake this rule exists to prevent.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');

/**
 * Where working state lives.
 *
 * `REDBOT_DATA` exists so a test can point the job store, the account directories and the logs
 * at a temporary directory. Without it, any test that creates a job writes into the real
 * `data/` — which is the operator's evidence, is append-only, and feeds health, metrics and the
 * evidence-campaign gate. A test suite that quietly injects rows into the record it is meant to
 * be checking is worse than no suite.
 *
 * Unset in normal operation, which is every non-test path.
 */
export const DATA = process.env.REDBOT_DATA
  ? join(process.env.REDBOT_DATA)
  : join(ROOT, 'data');

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
  history: join(DATA, 'history.jsonl'),
  /**
   * Generated reports.
   *
   * Under DATA, not under ROOT — and that move is the point. `src/reports.ts` and
   * `src/argus/reports.ts` each had their OWN `join(ROOT, 'reports')`, which put generated
   * output inside the program's own directory. That is read-only under Program Files and it is
   * REPLACED by an update, so on a packaged install those writes either fail or are silently
   * discarded on the next version.
   *
   * Declared here rather than in either module so there is one answer to "where do reports go".
   * Two constants for one directory is two things to move next time, and they diverge the moment
   * somebody moves only the one they were looking at.
   */
  reports: join(DATA, 'reports')
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

export const accountsPath = (): string => join(DATA, 'accounts.json');

/** The seed file, read straight off disk. The DB is preferred over this — see `loadAccounts`. */
export function loadAccountsFile(): AccountRecord[] {
  const file = accountsPath();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { accounts?: AccountRecord[] };
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch {
    throw new Error('data/accounts.json is not readable JSON. Fix or delete it.');
  }
}

/**
 * Accounts, from the database, cached for the synchronous readers.
 *
 * `accounts` is the system of record. But `loadAccounts()` has to stay SYNCHRONOUS:
 * it resolves `config.browser` (below), which every command reads, and Postgres is async.
 * So the CLI primes this cache once at startup (`primeAccounts`, called from cli.ts) and the
 * sync readers serve it from memory.
 *
 * Null means "not primed" — not "no accounts". The difference matters: an unprimed process
 * falls back to the seed file rather than reporting that nobody is configured.
 */
let accountCache: AccountRecord[] | null = null;

/**
 * Load accounts from Postgres into the cache. Safe to call more than once.
 *
 * Fails SOFT, deliberately. An unreachable database must not stop `redbot doctor` from
 * running or a browser command from resolving its port — those are exactly the commands you
 * reach for when something is broken. On failure the cache stays null and the seed file
 * answers instead, which is the behaviour every version before the database had.
 */
/**
 * The account this machine acts as, primed alongside the accounts themselves.
 *
 * Cached for the same reason `accountCache` is: `selectedAccount()` must stay SYNCHRONOUS because
 * `config.browser` resolves through it, and the database is async. Null means "not primed or none
 * recorded" — the difference does not matter to the readers, because both mean "the environment
 * variable is the only answer available".
 */
let selectedCache: string | null = null;

export async function primeAccounts(): Promise<void> {
  try {
    const [{ getPool }, accounts] = await Promise.all([
      import('./db.js'), import('./db/accounts.js')
    ]);
    const rows = await accounts.loadAccountsFromDb(getPool());
    // An empty table is not an answer, it is an un-imported install: leave the cache null so
    // the seed file still works on a machine where `redbot accounts import` has not been run.
    if (rows.length) accountCache = rows;

    /* The per-machine selection (0015). Primed here rather than read on demand so that
       `selectedAccount()` can answer without becoming async — see selectedCache above. */
    selectedCache = await accounts.selectedHandleForMachine(getPool());
  } catch {
    /* database unavailable — the seed file answers. Reported by `redbot doctor`, not here. */
  }
}

/** Drop the cache so the next read re-resolves. For tests and for `accounts import`. */
export function forgetAccounts(): void {
  accountCache = null;
  selectedCache = null;
}

/**
 * The recorded selection, for callers that need it without the AccountRecord.
 *
 * Exported so the console can show what is currently selected without repeating the precedence
 * rule that `selectedAccount()` implements.
 */
export function selectedHandle(): string | null {
  return process.env.REDBOT_ACCOUNT ?? selectedCache;
}

/**
 * Who redbot may post as.
 *
 * The database wins when it has rows; `data/accounts.json` is the seed you import from and
 * the fallback when the database is not reachable. Two sources with a stated precedence,
 * rather than two sources that quietly disagree.
 */
export function loadAccounts(): AccountRecord[] {
  return accountCache ?? loadAccountsFile();
}

/**
 * Which account redbot acts as, or null when that is genuinely undecided.
 *
 * THREE SOURCES, IN THIS ORDER, and the order is the whole design:
 *
 *   1. `REDBOT_ACCOUNT` — an explicit, per-invocation override. It wins over everything, because a
 *      person typing it means it, and because the entire test suite depends on being able to say
 *      "run as this one" without touching stored state.
 *   2. The per-machine selection recorded in `account_machines.selected` (migration 0015), primed
 *      into `selectedCache` by `primeAccounts()`.
 *   3. The only configured account, when there is exactly one. Unambiguous by arithmetic: there is
 *      no other answer, so demanding a selection would be ceremony.
 *
 * Reading ONLY the environment variable is what made the desktop app unusable: there is no shell in
 * a window, so an install with two accounts could never say which one it was, `config.browser` threw
 * NoAccountError, and `src/cli.ts` refused every command.
 *
 * Null with several accounts and no selection is still a REFUSAL, deliberately. src/cli.ts explains
 * what the alternative cost: a work pass ran to completion as whoever happened to be first in the
 * list and reported "Nothing eligible this pass" with exit 0 — success-looking, and acting as the
 * wrong person.
 */
export function selectedAccount(): AccountRecord | null {
  const accounts = loadAccounts();
  const want = process.env.REDBOT_ACCOUNT ?? selectedCache;

  if (!want) {
    // Exactly one configured account needs no choosing. More than one does.
    return accounts.length === 1 ? accounts[0]! : null;
  }

  const found = accounts.find((a) => a.handle.toLowerCase() === want.toLowerCase());
  if (!found) {
    const known = accounts.map((a) => a.handle).join(', ') || '(none configured)';
    const from = process.env.REDBOT_ACCOUNT ? 'REDBOT_ACCOUNT' : 'the selected account for this machine';
    // Not "is not in data/accounts.json" any more — accounts is the record, and naming
    // only the file sent people to edit a seed the engine may not even be reading.
    throw new Error(
      `${from}="${want}" is not a configured account. Known: ${known}\n` +
      '  Accounts live in accounts; see `redbot accounts`.'
    );
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

/**
 * Raised when redbot cannot tell WHICH account's browser to drive.
 *
 * Typed so `doctor` can REPORT it rather than die of it — the same treatment
 * `OperatorAuthError` already gets.
 */
export class NoAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoAccountError';
  }
}

/**
 * The account whose Chrome this run drives, or null when nothing names one.
 *
 * `REDBOT_ACCOUNT` wins. Failing that, a SINGLE configured account is not a guess — it is the
 * only answer — and resolving it here means no call site can forget to. Two or more is
 * genuinely ambiguous and is refused below.
 */
function browserAccount(): AccountRecord | null {
  const named = selectedAccount();
  if (named) return named;
  const all = loadAccounts();
  return all.length === 1 ? all[0]! : null;
}

function resolveEndpoint(): string {
  if (process.env.REDBOT_CDP) return assertLoopbackCdp(process.env.REDBOT_CDP);

  const a = browserAccount();
  if (a?.debugPort) return `http://127.0.0.1:${a.debugPort}`;

  /**
   * This used to end `return 'http://127.0.0.1:9222'`.
   *
   * That is not a neutral default. 9222 is Chrome's conventional debug port, so on a real
   * machine something usually answers it — on the machine this was found on, Lenovo Vantage's
   * Edge WebView2 held it (`/json/version` → "LenovoVantage/3.0.0.191", measured 2026-07-29).
   * redbot attached to THAT browser, opened its tabs, scraped no subreddit feed and reported
   * "Found 0 post links" as though Reddit had served nothing. Driving the wrong browser
   * silently is worse than refusing, so an unresolved account is an error that names the
   * handles instead of a port that happens to answer.
   */
  if (a) {
    throw new NoAccountError(
      `Account "${a.handle}" has no debug port on record, so redbot cannot tell which Chrome to drive.\n` +
      '  See `redbot accounts` — the port is assigned when the account is set up.'
    );
  }

  const known = loadAccounts().map((x) => x.handle);
  throw new NoAccountError(
    (known.length
      ? `Which account? REDBOT_ACCOUNT is not set and ${known.length} accounts are configured: ${known.join(', ')}.`
      : 'No accounts are configured, so there is no Reddit browser to drive.') +
    '\n\n  PowerShell:  $env:REDBOT_ACCOUNT = "<handle>"\n' +
    '  bash:        export REDBOT_ACCOUNT=<handle>\n\n' +
    (known.length
      ? 'redbot will not guess which account to act as.'
      : 'Add one with `redbot accounts`, or on the Accounts screen of the console.')
  );
}

function resolveProfileDir(): string {
  // Same resolver as the endpoint: a run must not read one account's port and another's profile.
  const a = browserAccount();
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

    /**
     * Resolved FRESH ON EVERY READ, in this order:
     *
     *   1. REDBOT_OPERATOR      — a shell, a test, or a spawned child that named one
     *   2. the stored choice    — whoever picked an operator on the console's Setup screen
     *
     * A getter, not a value, and that is the whole point. The console SERVER is long-lived, so a
     * value captured at module load cannot see a choice made two minutes later — which is exactly
     * how `/api/setup` came to report "no Claude operator is selected" while the picker on screen
     * showed one selected. Same reasoning as `primeAccounts()` refreshing the account cache
     * before anything reads through it.
     *
     * The environment still WINS, so every test and every `REDBOT_OPERATOR=x redbot …` behaves
     * exactly as it did before this became durable.
     */
    get operator(): string | null {
      return process.env.REDBOT_OPERATOR ?? storedOperatorSelection();
    },
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
  /**
   * A getter, not two fixed values.
   *
   * These used to be computed once when this module was imported, which was fine while
   * accounts came only from a file that was already on disk. Now `primeAccounts()` loads them
   * from Postgres and cannot finish before this module is evaluated — so resolving eagerly
   * would freeze in whatever answer was available before the database had been consulted.
   *
   * Every reader says `config.browser.cdpEndpoint` at call time, so re-resolving per access
   * is invisible to them and costs a map lookup.
   *
   * PER-PROPERTY getters, not one object built from two calls. `resolveEndpoint()` can now
   * refuse when it cannot tell which account to drive, and this used to resolve BOTH fields on
   * every access — so `new NoBrowserError(...)`, which reads only `profileDir` to print the
   * chrome command, threw while building the very message meant to explain the failure. A
   * diagnostic that dies of the condition it is diagnosing is worse than none.
   */
  get browser(): { cdpEndpoint: string; profileDir: string } {
    return {
      get cdpEndpoint() { return resolveEndpoint(); },
      get profileDir() { return resolveProfileDir(); }
    };
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

export const operatorsPath = join(DATA, 'operators', 'operators.json');

/**
 * Which operator this machine acts as, when the environment does not say.
 *
 * A sibling file rather than a field inside `operators.json`, because that file is a REGISTRY of
 * who exists — written by someone with filesystem access — and a per-machine preference is a
 * different kind of fact with a different lifetime. Mixing them would mean a selection could be
 * lost by hand-editing the registry, and a registry entry could be clobbered by a click.
 *
 * A file rather than a database row, unlike the account selection (migration 0015): every reader
 * of `config.llm.operator` is SYNCHRONOUS — `claudeConfigDir()` is called from inside
 * `completeViaCli` — and the database façade is async. `DATA` is already per-machine, so a file
 * under it carries the same "this machine" scope the `account_machines` row does.
 */
export const operatorSelectionPath = join(DATA, 'operators', 'selected.json');

/** letters, digits, dot, dash, underscore — the shape every operator name is held to. */
const OPERATOR_NAME = /^[a-z0-9][a-z0-9._-]{0,31}$/i;

/**
 * The stored operator choice, or null.
 *
 * FAILS CLOSED AND SILENT, deliberately: this is read from a getter that sits under thirteen
 * call sites including `claudeConfigDir()`. A malformed file must degrade to "nobody selected" —
 * which every caller already handles, and which refuses to run rather than guessing — instead of
 * throwing from the middle of an unrelated command. The name is re-validated on read because the
 * file is on disk and a hand-edit is not a code path anyone controls.
 */
export function storedOperatorSelection(): string | null {
  try {
    if (!existsSync(operatorSelectionPath)) return null;
    const raw = JSON.parse(readFileSync(operatorSelectionPath, 'utf8')) as { operator?: unknown };
    const name = typeof raw?.operator === 'string' ? raw.operator : null;
    return name && OPERATOR_NAME.test(name) ? name : null;
  } catch {
    return null;
  }
}

/**
 * Remember (or forget, with null) which operator this machine acts as.
 *
 * Validates before writing, so a bad name cannot reach the file and then be silently ignored on
 * read — the two halves would disagree and the screen would show a choice that does nothing.
 * Refuses a name that is not in the registry for the same reason `/api/operator/select` does:
 * a billing identity is never invented, only chosen from ones already declared.
 */
export function setStoredOperatorSelection(name: string | null): void {
  if (name === null) {
    if (existsSync(operatorSelectionPath)) rmSync(operatorSelectionPath, { force: true });
    return;
  }
  if (!OPERATOR_NAME.test(name)) {
    throw new OperatorAuthError(
      `Invalid operator name "${name}" — letters, digits, dot, dash, underscore only.`
    );
  }
  if (!operatorRecord(name)) {
    throw new OperatorAuthError(
      `"${name}" is not a registered operator. Add one first: redbot operators add ${name}`
    );
  }
  mkdirSync(dirname(operatorSelectionPath), { recursive: true });
  writeFileSync(operatorSelectionPath, JSON.stringify({ operator: name }, null, 2) + '\n', 'utf8');
}

/**
 * Has this operator actually signed in, or do they just have an empty folder?
 *
 * MEASURED, not assumed: a signed-in folder on this machine holds `.credentials.json` alongside
 * `.claude.json`, `sessions/` and the rest; a folder created by `operators add` and never signed
 * into is completely empty. The credentials file is the only one of those that means "a login
 * happened here".
 *
 * This distinction is the difference between a Setup screen that says `ready` and a run that
 * fails at the first model call — `redbot operators` has always CLAIMED to report it ("own
 * folder, NOT signed in yet") but tested `existsSync(configDir)`, which `operators add` makes
 * true before anyone signs in, so that branch could never fire for a dedicated operator.
 *
 * Never reads the file. Presence is the whole signal; the contents are a credential.
 */
export function operatorSignedIn(configDir: string): boolean {
  return existsSync(join(configDir, '.credentials.json'));
}

/** A registered operator, with enough status to pick one without reading credentials. */
export interface OperatorInfo {
  name: string;
  /** Where their Claude credentials live. Local-only — never sent to the browser. */
  configDir: string;
  /**
   * True when configDir is NOT a dedicated `data/operators/<name>/claude` folder — i.e. it
   * points at a shared login (this machine's own `~/.claude`). Not wrong, but it means model
   * calls for this operator bill whoever owns that login, so it is always surfaced.
   */
  shared: boolean;
  /**
   * True when a login has actually HAPPENED in that folder — not merely that the folder exists.
   * `operators add` and the console's "Register operator" both create the folder before anyone
   * signs in, so folder-existence reported every brand-new operator as ready.
   */
  ready: boolean;
  declaredBy?: string;
  note?: string;
}

/**
 * Every operator declared in `operators.json`, with credential status. Read by the CLI
 * (`redbot operators`) and, via a path-stripped projection, by the console picker.
 *
 * The console must never invent a billing identity from a web request, so a picker offers
 * ONLY the names this function returns — a list only someone with filesystem access could
 * have written. That is the same trust model the account picker already uses.
 */
export function listOperators(): OperatorInfo[] {
  if (!existsSync(operatorsPath)) return [];
  let all: Record<string, OperatorRecord>;
  try {
    all = JSON.parse(readFileSync(operatorsPath, 'utf8')) as Record<string, OperatorRecord>;
  } catch {
    throw new OperatorAuthError('data/operators/operators.json is not readable JSON. Fix or delete it.');
  }
  const dedicatedRoot = join(DATA, 'operators');
  return Object.entries(all)
    .filter(([, rec]) => rec && typeof rec.configDir === 'string' && rec.configDir)
    .map(([name, rec]) => {
      // A dedicated folder lives under data/operators/<name>/; anything else is a shared login.
      const shared = !rec.configDir.split('\\').join('/').startsWith(dedicatedRoot.split('\\').join('/'));
      return {
        name,
        configDir: rec.configDir,
        shared,
        ready: operatorSignedIn(rec.configDir),
        ...(rec.declaredBy ? { declaredBy: rec.declaredBy } : {}),
        ...(rec.note ? { note: rec.note } : {})
      };
    });
}

export function operatorRecord(name: string): OperatorRecord | null {
  const file = operatorsPath;
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
      '  Pick one on the console\'s Setup screen, which remembers the choice, or name one here:\n' +
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
      `Invalid operator name "${config.llm.operator}" — letters, digits, dot, dash, underscore ` +
      `only. It came from ${process.env.REDBOT_OPERATOR ? 'REDBOT_OPERATOR' : operatorSelectionPath}.`
    );
  }

  return join(DATA, 'operators', config.llm.operator, 'claude');
}

/**
 * The Anthropic API key: the environment first, then the vault.
 *
 * The environment still wins, deliberately. It is the bootstrap path — CI, a one-off shell,
 * and the session in which someone first stores the key — and a vault that could not be
 * loaded without already having the thing it stores would be unusable on day one.
 *
 * Async because the vault is a database read. Its one caller (`completeViaApi`, src/llm.ts)
 * was already async, so nothing sync became async to make this work.
 *
 * The key is returned, never logged: the value goes straight into the x-api-key header.
 */
export async function anthropicKey(): Promise<string> {
  const fromEnv = process.env.ANTHROPIC_API_KEY;
  if (fromEnv) return fromEnv;

  // Imported here rather than at module top: credentials.ts pulls in the pg pool, and config.ts
  // is imported by every command including the ones that never touch a database or an LLM.
  // A static import would make `redbot doctor` open a connection pool to answer a question
  // about the filesystem.
  const { anthropicKeyFromVault, vaultUnavailableReason } = await import('./credentials.js');
  try {
    const stored = await anthropicKeyFromVault(config.llm.operator);
    if (stored) return stored;
  } catch (e) {
    // A vault that is present but unopenable is a real failure and must not be reported as
    // "no key set" — that would send an operator off to re-export a key they already stored.
    throw new Error(
      `ANTHROPIC_API_KEY is not in the environment, and the vault could not be read:\n  ${
        e instanceof Error ? e.message : String(e)}`
    );
  }

  const vaultNote = vaultUnavailableReason()
    ? '\nThe vault is not available either: ' + vaultUnavailableReason()
    : '\nOr store it once in the vault:  redbot vault set anthropic_api_key';
  throw new Error(
    'ANTHROPIC_API_KEY is not set.\n' +
    '  PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."\n' +
    '  bash:        export ANTHROPIC_API_KEY=sk-ant-...' +
    vaultNote
  );
}
