/**
 * What has to be INSTALLED ON THE MACHINE before redbot can run.
 *
 * ---------------------------------------------------------------------------
 * DIFFERENT FROM src/requirements.ts, AND THE LINE BETWEEN THEM MATTERS.
 *
 * `requirements.ts` answers "is this install CONFIGURED?" — is there a database, a vault key, an
 * operator, an account, a browser on the port. Every one of those is something redbot creates or
 * the operator chooses, and almost all are fixable from inside the console.
 *
 * This module answers a question that comes BEFORE all of that: "is the software this depends on
 * even here?" None of it can be fixed from inside the console, because you cannot install Chrome
 * from a page Chrome is not running. Each answer is therefore a download link and a sentence, not
 * a button.
 *
 * Keeping them apart is what stops the Setup screen from lying in the confusing direction. Without
 * it, a machine with no Chrome installed reports "A signed-in Chrome — nothing is listening at
 * 127.0.0.1:9224", which reads as "start your browser" and sends somebody looking for a browser
 * that was never installed.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT CHECKED.
 *
 * PYTHON. redbot does not use Python — there is no interpreter call, no .py file, no binding, in
 * src/, tools/, db/ or package.json. A check for it would be a permanently green row for something
 * nothing depends on, or worse a red one telling an operator to install software that would change
 * nothing. Absence reported as absence is the rule this codebase runs on; inventing a dependency
 * breaks it in the other direction.
 *
 * A RUNNING CHROME. That is `requirements.ts`'s `browser` check and it is ADVISORY there for good
 * reason — a browser nobody has opened yet is not a broken install. This module only asks whether
 * chrome.exe exists on disk.
 *
 * PLAYWRIGHT'S BROWSER BINARIES. `playwright install` downloads ~400 MB that redbot never uses:
 * src/browser.ts attaches over CDP to a Chrome the operator started, and electron-builder.yml
 * excludes those binaries from the package on purpose. Only the LIBRARY has to resolve.
 * ---------------------------------------------------------------------------
 */
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { existsSync as fsExists, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Node floor, mirroring `engines.node` in package.json.
 *
 * A literal rather than a read of package.json, because this also has to answer inside the packaged
 * app where that file is in an asar — and `src/test/dependencies.test.ts` asserts the two agree, so
 * a bump in one that is not mirrored here fails the suite rather than drifting quietly.
 */
export const MIN_NODE = { major: 22, minor: 13 };

export interface Dependency {
  /** Stable id; the console keys rows on it. */
  id: string;
  label: string;
  /** False when nothing depends on it in this configuration — an optional row, never a blocker. */
  required: boolean;
  ok: boolean;
  /** What was found, or what is missing. A sentence, never a stack trace. */
  detail: string;
  /** Where it came from, when there is one — a path or a version. Shown in a dimmer style. */
  found: string | null;
  /** How a person gets it. `url` is rendered as a link; there is never a button. */
  fix: { hint: string; url: string | null };
}

const dep = (
  id: string, label: string, required: boolean, ok: boolean,
  detail: string, found: string | null, fix: Dependency['fix']
): Dependency => ({ id, label, required, ok, detail, found, fix });

/** `22.13.1` / `v22.13.1` → the two numbers that matter. */
export function parseNodeVersion(raw: string): { major: number; minor: number } | null {
  const m = /^v?(\d+)\.(\d+)/.exec(String(raw ?? '').trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

/** At or above the floor. Major wins, then minor. */
export function nodeVersionOk(raw: string, min = MIN_NODE): boolean {
  const v = parseNodeVersion(raw);
  if (!v) return false;
  if (v.major !== min.major) return v.major > min.major;
  return v.minor >= min.minor;
}

/**
 * Where Chrome installs itself on Windows.
 *
 * Three locations because there are genuinely three: the 64-bit and 32-bit machine-wide installs,
 * and the per-user install Chrome falls back to when somebody without admin rights installs it.
 * The per-user one is the one that gets missed, and it is common on managed laptops — exactly the
 * machines where an operator cannot install anything machine-wide.
 */
export function chromeCandidates(env: NodeJS.ProcessEnv): string[] {
  const rel = join('Google', 'Chrome', 'Application', 'chrome.exe');
  const roots = [
    env['ProgramFiles'], env['ProgramFiles(x86)'], env['LOCALAPPDATA']
  ].filter((x): x is string => typeof x === 'string' && x.length > 0);
  const out = roots.map((r) => join(r, rel));
  /* An explicit override wins and is listed first, so a portable or non-standard install is
     reachable without patching this list. */
  const override = env['REDBOT_CHROME'];
  return override ? [override, ...out] : out;
}

/** Find an executable on PATH without running it. `where` on Windows, `which` elsewhere. */
function defaultLookPath(platform: NodeJS.Platform) {
  return (bin: string): Promise<string | null> => new Promise((resolve) => {
    const finder = platform === 'win32' ? 'where' : 'which';
    /* execFile, NOT a shell: `bin` comes from REDBOT_CLAUDE_BIN, so putting it through a shell
       would make an environment variable into command execution. */
    execFile(finder, [bin], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const first = String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      resolve(first ?? null);
    });
  });
}

export interface DependencyOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  /** Which model path is configured — the Claude CLI is only required for `cli`. */
  provider?: 'cli' | 'api';
  exists?: (p: string) => boolean;
  /** Module resolution, so a test can simulate playwright being absent. */
  resolveModule?: (m: string) => string;
  lookPath?: (bin: string) => Promise<string | null>;
  /** Reads a package's version; injected so tests need no node_modules. */
  moduleVersion?: (m: string) => string | null;
}

/**
 * Every dependency, evaluated now.
 *
 * Everything it touches is injected so `src/test/dependencies.test.ts` can drive all of it —
 * missing Chrome, an old Node, no Claude CLI — on a machine where all of them are present.
 */
export async function checkDependencies(opts: DependencyOptions = {}): Promise<Dependency[]> {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const exists = opts.exists ?? fsExists;
  const provider = opts.provider ?? 'cli';
  const lookPath = opts.lookPath ?? defaultLookPath(platform);
  const require_ = createRequire(import.meta.url);
  const resolveModule = opts.resolveModule ?? ((m: string) => require_.resolve(m));
  const moduleVersion = opts.moduleVersion ?? ((m: string) => {
    try {
      const p = require_.resolve(`${m}/package.json`);
      return (JSON.parse(readFileSync(p, 'utf8')) as { version?: string }).version ?? null;
    } catch { return null; }
  });

  const out: Dependency[] = [];

  /* ---------- Node ----------
   *
   * In the desktop app this is Electron's bundled Node and is satisfied by construction — it is
   * reported anyway, because the same console runs from a terminal against a system Node where it
   * genuinely can be too old, and a row that is always green is still the row somebody checks. */
  const nodeVersion = opts.nodeVersion ?? process.versions.node;
  out.push(nodeVersionOk(nodeVersion)
    ? dep('node', 'Node runtime', true, true,
      `Node ${nodeVersion}`, null, { hint: '', url: null })
    : dep('node', 'Node runtime', true, false,
      `Node ${nodeVersion} is older than the ${MIN_NODE.major}.${MIN_NODE.minor} this build needs`,
      null,
      {
        hint: 'The installed desktop app carries its own Node and is unaffected; this only applies when running from a terminal.',
        url: 'https://nodejs.org/'
      }));

  /* ---------- Playwright ----------
   *
   * The LIBRARY, not the browsers. See the header for why the downloaded binaries are irrelevant. */
  let pwPath: string | null = null;
  try { pwPath = resolveModule('playwright'); } catch { pwPath = null; }
  if (!pwPath) {
    try { pwPath = resolveModule('playwright-core'); } catch { pwPath = null; }
  }
  const pwVersion = pwPath ? (moduleVersion('playwright') ?? moduleVersion('playwright-core')) : null;
  out.push(pwPath
    ? dep('playwright', 'Playwright', true, true,
      pwVersion ? `version ${pwVersion} — attaches to your Chrome over CDP` : 'available',
      null, { hint: '', url: null })
    : dep('playwright', 'Playwright', true, false,
      'the Playwright library could not be resolved, so redbot cannot attach to a browser at all',
      null,
      {
        hint: 'Ships inside the installed app. From a source checkout, run: npm install',
        url: null
      }));

  /* ---------- Google Chrome ----------
   *
   * Installed, not running. redbot never launches it (src/browser.ts explains why Playwright
   * launching a browser gets served a Reddit block page), but it cannot attach to one that was
   * never installed either. */
  if (platform === 'win32') {
    const found = chromeCandidates(env).find((p) => { try { return exists(p); } catch { return false; } }) ?? null;
    out.push(found
      ? dep('chrome', 'Google Chrome', true, true, 'installed', found, { hint: '', url: null })
      : dep('chrome', 'Google Chrome', true, false,
        'no chrome.exe was found in the usual places — redbot attaches to your own Chrome and cannot work without one',
        null,
        {
          hint: 'Install Chrome, then start it from the Accounts screen and sign in to Reddit once. Set REDBOT_CHROME if it lives somewhere unusual.',
          url: 'https://www.google.com/chrome/'
        }));
  } else {
    /* Windows is the only platform this packages for (src/ports.ts is win32-only). Saying so is
       better than running a Windows path check on a Mac and reporting a confident "missing". */
    out.push(dep('chrome', 'Google Chrome', true, true,
      `not checked on ${platform} — redbot packages for Windows only`, null, { hint: '', url: null }));
  }

  /* ---------- the Claude CLI ----------
   *
   * Required ONLY for the `cli` provider. On the API-key path there is no CLI in the picture at
   * all, and marking it required there would put a red row on a correctly configured install. */
  const cliBin = env['REDBOT_CLAUDE_BIN'] ?? 'claude';
  if (provider === 'cli') {
    const where = await lookPath(cliBin).catch(() => null);
    out.push(where
      ? dep('claude-cli', 'Claude CLI', true, true, `found as "${cliBin}"`, where, { hint: '', url: null })
      : dep('claude-cli', 'Claude CLI', true, false,
        `"${cliBin}" is not on PATH — model calls run through it, so they will fail`,
        null,
        {
          hint: 'Install the Claude CLI, then sign in once as your operator. Set REDBOT_CLAUDE_BIN if it is installed under another name.',
          url: 'https://docs.claude.com/en/docs/claude-code/overview'
        }));
  } else {
    out.push(dep('claude-cli', 'Claude CLI', false, true,
      'not needed — this install calls the model with an API key', null, { hint: '', url: null }));
  }

  return out;
}

/** The unmet REQUIRED dependencies. Non-empty means redbot cannot run, whatever else is configured. */
export const missingDependencies = (ds: Dependency[]): Dependency[] =>
  ds.filter((d) => d.required && !d.ok);
