/**
 * What redbot needs in order to work, in one place.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS: THREE LISTS THAT DISAGREED.
 *
 * "Is this install ready?" had three different answers, and they contradicted each other:
 *
 *   - `setupStatus()` in tools/product/server.mjs checked FOUR conditions, and the console's badge
 *     counted them. Measured: it did not mention Chrome once.
 *   - `redbot doctor` checked sixteen, including the browser.
 *   - `src/gates.ts` checks per-draft preconditions at publish time.
 *
 * So the console could show a green Setup screen on a machine where redbot could not drive a
 * browser at all — and the browser is the entire product (src/browser.ts: "redbot does not launch
 * browsers"). On a live run of `doctor` the two actual failures were `llm operator` and
 * `debuggable chrome`; the console's four-item count covered the first and was blind to the second.
 *
 * This module is the single answer. `doctor` folds it in, and `/api/setup` serves it, so the CLI
 * and the console cannot disagree about whether the install is sound. It replaces nothing else in
 * doctor — the other checks are about EVIDENCE (staleness, backups, telemetry), not about whether
 * the thing can run.
 *
 * ---------------------------------------------------------------------------
 * BLOCKING vs ADVISORY, AND WHY THE SPLIT IS LOAD-BEARING.
 *
 * BLOCKING means redbot cannot function and the app should open on Setup. Every blocking item is
 * LOCAL, DURABLE, and FIXABLE FROM INSIDE THE CONSOLE — that is the definition, not a coincidence.
 *
 * ADVISORY means part of it cannot run: warn, never block.
 *
 * THE BROWSER MOVED FROM ADVISORY TO BLOCKING (2026-08-01), and the reason it was advisory is
 * worth keeping rather than deleting, because it was correct at the time:
 *
 *   "Every browser/session/network condition is advisory BY CONSTRUCTION, because they are
 *    transient. 'No debuggable Chrome' is unmet on a perfectly configured install where the
 *    operator simply has not opened their browser yet, and blocking on it would make the app
 *    unusable every morning — locking a person out of the only screen that could fix it."
 *
 * That argument rested on one thing: nothing opened the browser but a person. `electron/main.mjs`
 * now opens every account bound to this machine as part of boot, so the condition is normally met
 * before the window is even painted. What is left when it is NOT met is no longer "you have not
 * got round to it" — it is a real fault (Chrome missing, the port taken by another program, a
 * profile folder gone), and reads and publishes will refuse for as long as it lasts. Reporting
 * that as a warning understated it: the product's entire surface is a browser.
 *
 * The definition above still holds — it is LOCAL, it is DURABLE for as long as it is true, and it
 * is FIXABLE FROM INSIDE THE CONSOLE (Accounts → Open Chrome, which is where `fix.screen` points).
 *
 * `headed` stays ADVISORY on purpose. It is a property of a browser that is already attached and
 * can be restarted, not of the install — and a headless attach is reported as a FAIL by `doctor`,
 * which is the check that governs a run.
 * ---------------------------------------------------------------------------
 */
import { ping } from './db.js';
import { vaultUnavailableReason } from './vault.js';
import {
  loadAccounts, selectedAccount, config, NoAccountError, operatorRecord, anthropicKey,
  operatorSignedIn
} from './config.js';
import { isBrowserUp } from './browser.js';

export type Tier = 'blocking' | 'advisory';

export interface Requirement {
  /** Stable identifier — the console keys its rows on this, so it must not change casually. */
  id: string;
  /** What a person would call it. */
  label: string;
  tier: Tier;
  ok: boolean;
  /** Why it is or is not met, in words an operator can act on. Never a stack trace. */
  detail: string;
  /**
   * What resolves it, as a hint to the UI. `screen` names a console screen; null means it cannot
   * be fixed from inside the app (starting a browser, for instance).
   */
  fix: { screen: string | null; hint: string };
}

const met = (
  id: string, label: string, tier: Tier, detail: string,
  fix: Requirement['fix'] = { screen: null, hint: '' }
): Requirement => ({ id, label, tier, ok: true, detail, fix });

const unmet = (
  id: string, label: string, tier: Tier, detail: string, fix: Requirement['fix']
): Requirement => ({ id, label, tier, ok: false, detail, fix });

/**
 * Every requirement, evaluated now.
 *
 * DERIVED ON EVERY CALL, never cached and never remembered. That is the whole design: these go
 * stale constantly — a browser gets closed, a port gets taken by another program, a key gets
 * rotated, an account gets removed. A stored "setup complete" flag would let the app open onto a
 * broken install and say nothing, which is what the previous first-run signal did.
 */
export async function checkRequirements(): Promise<Requirement[]> {
  const out: Requirement[] = [];

  /**
   * Refresh the synchronous caches before reading anything through them.
   *
   * `loadAccounts()` and `config.browser` are sync — they must be, because every command resolves
   * a browser through them — so they serve from a cache that `primeAccounts()` fills. The CLI fills
   * it at startup. The console SERVER does not, and after somebody changes the selection it is
   * stale in any process. Without this, `/api/setup` reported "no account is selected, so there is
   * no browser to check" on an install that had just selected one.
   *
   * Cheap relative to what follows: this function already makes an HTTP probe to the browser.
   */
  try {
    const { primeAccounts } = await import('./config.js');
    await primeAccounts();
  } catch { /* the database checks below report why, and in words an operator can act on */ }

  /* ---------- blocking: the database ---------- */
  const db = await ping();
  out.push(db.ok
    ? met('database', 'Database', 'blocking', db.detail)
    : unmet('database', 'Database', 'blocking', db.detail,
      { screen: 'setup', hint: 'redbot creates and migrates this itself on launch; the detail says what stopped it.' }));

  /* ---------- blocking: the vault ---------- */
  const vault = vaultUnavailableReason();
  out.push(vault === null
    ? met('vault', 'Secrets vault', 'blocking', 'a master key is available, so stored secrets can be opened')
    : unmet('vault', 'Secrets vault', 'blocking', vault.split('\n')[0]!,
      { screen: 'setup', hint: 'The desktop app stores this in the OS credential store on first launch.' }));

  /* ---------- blocking: a model to call ----------
   *
   * Two provider paths, and each has its own precondition. `anthropicKey()` is async because it
   * may open a sealed secret from the vault, and the operator name comes from REDBOT_OPERATOR —
   * `operatorRecord()` takes that name rather than discovering it. */
  let llm: Requirement;
  try {
    if (config.llm.provider === 'api') {
      // Resolves from ANTHROPIC_API_KEY or the vault; throws when neither can answer.
      const key = await anthropicKey().catch(() => '');
      llm = key
        ? met('llm', 'Model access', 'blocking', 'an Anthropic API key is available')
        : unmet('llm', 'Model access', 'blocking',
          'the provider is set to "api" but no API key is stored or set',
          { screen: 'setup', hint: 'Store a key on the Setup screen, or switch the provider to the Claude CLI.' });
    } else {
      /**
       * Three distinct failures, three distinct sentences — never collapsed into one.
       *
       * Registering an operator and SIGNING IN as one are separate acts, and the folder exists
       * after the first. Reporting "ready" on registration alone produced the worst possible
       * outcome: a Setup screen with every row green and a run that died at the first model
       * call. Absence reported as absence, the rule this whole module exists for.
       */
      const name = config.llm.operator;
      const rec = name ? operatorRecord(name) : null;
      if (!name) {
        llm = unmet('llm', 'Model access', 'blocking',
          'no Claude operator is selected — redbot will not use this machine\'s default Claude login',
          { screen: 'setup', hint: 'Create or select an operator on the Setup screen.' });
      } else if (!rec) {
        llm = unmet('llm', 'Model access', 'blocking',
          `operator "${name}" is not registered on this machine`,
          { screen: 'setup', hint: `Register "${name}" on the Setup screen, or select a different operator.` });
      } else if (!operatorSignedIn(rec.configDir)) {
        llm = unmet('llm', 'Model access', 'blocking',
          `operator "${name}" is registered but has never signed in to Claude`,
          {
            screen: 'setup',
            hint: 'Sign in once, in a terminal — redbot never sees the password: '
              + `$env:CLAUDE_CONFIG_DIR = "${rec.configDir}"; claude   then type /login inside it.`
          });
      } else {
        llm = met('llm', 'Model access', 'blocking', `Claude CLI as operator "${name}"`);
      }
    }
  } catch (e) {
    llm = unmet('llm', 'Model access', 'blocking',
      e instanceof Error ? e.message.split('\n')[0]! : String(e),
      { screen: 'setup', hint: 'Pick a model provider on the Setup screen.' });
  }
  out.push(llm);

  /* ---------- blocking: exactly one account, unambiguously ----------
   *
   * `src/cli.ts` already refuses to dispatch when this is wrong, and it is the check `doctor`
   * failed on with "REDBOT_ACCOUNT is not set and 2 accounts are configured". In a desktop app
   * there is no shell to export that variable in, so this is only satisfiable once the console can
   * express the choice — which is why the fix names a screen. */
  const accounts = loadAccounts();
  if (!accounts.length) {
    out.push(unmet('account', 'An account', 'blocking',
      'no Reddit account is configured — redbot does not act as anybody by default',
      { screen: 'accounts', hint: 'Add the account you post as on the Accounts screen.' }));
  } else {
    /**
     * The selection is read from the DATABASE here, not through `selectedAccount()`.
     *
     * `selectedAccount()` has to stay synchronous — `config.browser` resolves through it — so it
     * serves the choice from a cache that `primeAccounts()` fills at CLI startup. That cache is
     * wrong in two situations this check runs in: the console SERVER never calls `primeAccounts()`
     * at all, and immediately after somebody changes the selection the cache is stale by
     * definition. Measured: selecting an account through /api/account/select wrote the row
     * correctly and /api/setup went on reporting "none is selected".
     *
     * This function is already async, so it can simply ask. `REDBOT_ACCOUNT` still wins, because it
     * wins everywhere; a single configured account still needs no choosing.
     */
    let selected: string | null = process.env.REDBOT_ACCOUNT ?? null;
    let err: string | null = null;
    if (!selected) {
      try {
        const { getPool } = await import('./db.js');
        const { selectedHandleForMachine } = await import('./db/accounts.js');
        selected = await selectedHandleForMachine(getPool());
      } catch (e) {
        err = e instanceof Error ? e.message.split('\n')[0]! : String(e);
      }
    }
    if (!selected && !err && accounts.length === 1) selected = accounts[0]!.handle;

    /* A recorded handle that is no longer an account is a broken selection, not a valid one. */
    if (selected && !accounts.some((a) => a.handle.toLowerCase() === selected!.toLowerCase())) {
      err = `the selected account "${selected}" is no longer configured`;
      selected = null;
    }

    out.push(err === null && selected
      ? met('account', 'An account', 'blocking', `acting as ${selected}`)
      : unmet('account', 'An account', 'blocking',
        err ?? `${accounts.length} accounts are configured and none is selected, so redbot would not know who to act as`,
        { screen: 'accounts', hint: 'Choose which account this machine acts as.' }));
  }

  /* ---------- blocking: the browser ----------
   *
   * The product IS a browser (src/browser.ts), so an install without one cannot do the thing it
   * exists to do. Blocking rather than advisory since 2026-08-01 — see the header for the
   * argument this replaced and why the app opening the browsers on boot is what makes it fair. */
  let endpoint: string | null = null;
  let endpointError: string | null = null;
  try { endpoint = config.browser.cdpEndpoint; } catch (e) {
    endpointError = e instanceof NoAccountError
      ? 'no account is selected, so there is no browser to check'
      : (e instanceof Error ? e.message.split('\n')[0]! : String(e));
  }

  if (!endpoint) {
    out.push(unmet('browser', 'A signed-in Chrome', 'blocking', endpointError ?? 'unknown',
      { screen: 'accounts', hint: 'Set the account up on this machine first.' }));
  } else {
    const up = await isBrowserUp(endpoint);
    if (!up) {
      out.push(unmet('browser', 'A signed-in Chrome', 'blocking',
        `nothing is listening at ${endpoint} — reading and publishing will refuse until a Chrome is started`,
        { screen: 'accounts', hint: 'Start the account\'s Chrome from the Accounts screen, then sign in to Reddit once.' }));
    } else {
      out.push(met('browser', 'A signed-in Chrome', 'blocking', `reachable at ${endpoint}`));

      /* Headed, not headless. `doctor` calls this a FAIL and explains why at length: a headless
         browser answers CDP perfectly and Reddit serves it a block page as HTTP 200, so redbot
         appears to run while every action silently fails. It is advisory HERE only because it is a
         property of a browser the operator can restart, not of the install. */
      let ua: string | null = null;
      try {
        const r = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(2500) });
        if (r.ok) ua = ((await r.json()) as { 'User-Agent'?: string })['User-Agent'] ?? null;
      } catch { /* already reported as unreachable above */ }

      if (ua && /headless/i.test(ua)) {
        out.push(unmet('headed', 'A headed browser', 'advisory',
          'the attached browser is HEADLESS — Reddit answers it with a block page served as HTTP 200, ' +
          'so reads return nothing and every action fails silently',
          { screen: null, hint: 'Attach a headed Chrome. redbot cannot run on a display-less host.' }));
      } else if (ua) {
        out.push(met('headed', 'A headed browser', 'advisory', 'headed — Reddit serves browsers, not clients'));
      }
    }
  }

  /* ---------- advisory: somewhere to look ---------- */
  try {
    const { loadSources } = await import('./sources.js');
    const view = await loadSources();
    const enabled = view.sources.filter((s) => s.enabled !== false);
    out.push(enabled.length
      ? met('sources', 'Somewhere to look', 'advisory', `${enabled.length} source(s) enabled`)
      : unmet('sources', 'Somewhere to look', 'advisory',
        'no sources are switched on, so an unattended run would collect nothing',
        { screen: 'discovery', hint: 'Add a subreddit or a saved search on the Discovery screen.' }));
  } catch (e) {
    out.push(unmet('sources', 'Somewhere to look', 'advisory',
      e instanceof Error ? e.message.split('\n')[0]! : String(e),
      { screen: 'discovery', hint: 'Add a subreddit on the Discovery screen.' }));
  }

  return out;
}

/** The unmet blocking items — non-empty means the app should open on Setup. */
export const blockers = (rs: Requirement[]): Requirement[] =>
  rs.filter((r) => r.tier === 'blocking' && !r.ok);

/** The unmet advisory items — a banner, never a gate. */
export const advisories = (rs: Requirement[]): Requirement[] =>
  rs.filter((r) => r.tier === 'advisory' && !r.ok);
