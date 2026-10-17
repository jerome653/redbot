/**
 * Read-only probe: report the signed-in account's karma and account age.
 *
 * Exists because the mockup and the status pages were about to state karma figures that
 * had never been measured. Reads the profile page and prints what is actually there.
 *
 *   redbot probe-karma            (the console's "Check it worked" button runs this)
 *   node dist/probe-karma.js      (still works — see the direct-invocation guard below)
 *
 * `REDBOT_ACCOUNT` / `REDBOT_CDP` select which browser profile is read.
 *
 *   redbot probe-karma --open     every account whose browser is running (the daily timer)
 *
 * WHY THIS IS A FUNCTION AND NOT A TOP-LEVEL SCRIPT.
 * It used to run on import: `const s = await attach()` at module scope. That made it
 * impossible to wire into src/cli.ts — importing it there would have attached a browser on
 * every single `redbot` invocation, including `doctor` and `--help`. So it stayed a
 * standalone script, and docs/12-FINAL-PHASE-ASSESSMENT.md logged "not wired into the CLI"
 * as deferred debt. Meanwhile tools/product/server.mjs shipped a button that spawns
 * `dist/cli.js probe-karma`, which answered "Unknown command: probe-karma" — step 3 of the
 * account wizard could never work. The work is the same either way; only the entry moved.
 */
import { attach, isBrowserUp, whoAmI } from './browser.js';
import { loadAccounts, type AccountRecord } from './config.js';
import { recordObservation } from './health.js';

/**
 * Measure and record. Returns a process exit code rather than calling `process.exit`, so a
 * caller inside the CLI can decide what to do — a command that kills the process from inside
 * a library function is a command that cannot be composed.
 */
export async function probeKarma(endpoint?: string): Promise<number> {
  const s = await attach(endpoint);
  try {
    // whoAmI reads the Reddit shell, so we have to be on Reddit before asking.
    await s.page.goto('https://www.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const me = await whoAmI(s.page);
    if (!me.username) {
      /**
       * "Not signed in" and "signed in, but I could not read who" are different failures and
       * must not share a message. When Reddit dropped the header profile link, this printed
       * "not signed in on this profile" at an operator who was signed in perfectly well — so
       * the reported cause was the browser session, and the actual cause was a selector. The
       * console then added "is their browser open?" on top of an open browser.
       */
      console.log(me.loggedIn
        ? 'signed in, but the username could not be read from the page — cannot look up the profile'
        : 'not signed in on this profile');
      return 1;
    }

    await s.page.goto(`https://www.reddit.com/user/${me.username}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await s.page.waitForTimeout(2500);

    const facts = await s.page.evaluate(() => {
      const text = document.body.innerText;
      const grab = (re: RegExp) => {
        const m = re.exec(text);
        return m?.[1] ? m[1].trim() : null;
      };
      return {
        karma: grab(/([\d,.]+k?)\s*\n?\s*karma/i),
        postKarma: grab(/([\d,.]+k?)\s*\n?\s*post karma/i),
        commentKarma: grab(/([\d,.]+k?)\s*\n?\s*comment karma/i),
        cakeDay: grab(/cake day\s*\n?\s*(.+)/i),
        joined: grab(/(?:joined|redditor since)\s*\n?\s*(.+)/i),
      };
    });

    console.log(JSON.stringify({ username: me.username, ...facts }, null, 2));

    /**
     * PRODUCTION OBSERVATION 2026-07-23: this probe was run and reported karma 1, and the health
     * machine went on saying "karma has never been measured on this account". The measurement
     * was printed to a terminal and thrown away.
     *
     * A measurement that does not reach the log is not evidence. Recorded here, in the same
     * observation store the health machine reads, so the two cannot disagree again.
     */
    const karma = facts.karma != null ? Number(facts.karma.replace(/[, ]/g, '')) : null;
    if (karma != null && Number.isFinite(karma)) {
      await recordObservation({
        account: me.username, kind: 'karma', vector: 'signed-in',
        value: karma, note: 'measured by probe-karma from the profile page'
      });
      console.log(`recorded: karma ${karma} for ${me.username}`);
    } else {
      console.log('karma could not be parsed from the profile page — nothing recorded');
      // Nothing was measured, so nothing was recorded. Reporting success here is how a
      // status page ends up stating a karma figure that no run ever produced.
      return 1;
    }

    if (facts.cakeDay || facts.joined) {
      const raw = facts.cakeDay ?? facts.joined!;
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) {
        await recordObservation({
          account: me.username, kind: 'account-created', vector: 'signed-in',
          value: new Date(parsed).toISOString(), note: `parsed from "${raw}"`
        });
      }
    }
    return 0;
  } finally {
    await s.close();
  }
}

/**
 * `redbot probe-karma --open` — measure every account whose browser is running right now.
 *
 * WHY THE TIMER NEEDS THIS. redbot-karma.service pinned REDBOT_ACCOUNT=ryangrowth12, and since
 * f9bb63b boot opens only the loop account's Chrome (electron/main.mjs, REDBOT_BOOT_BROWSERS).
 * Measured 2026-10-17 04:00 PDT: "No debuggable Chrome at http://127.0.0.1:9222" — the probe asked
 * for a browser nothing starts any more, recorded nothing, and `SuccessExitStatus=0 1` reported
 * the run as a success. Pinning a different handle breaks again the day the loop moves.
 *
 * So the timer asks the machine instead of naming an account: every configured account with a
 * debug port whose browser answers is measured, through the same probeKarma a single account
 * uses. An account whose browser is closed is skipped, not failed — closing it was a choice.
 *
 * Exit 1 when no browser answers at all, or when any measured account fails: either way a data
 * point the operator expects is missing, and the unit has to say so.
 */
export interface OpenProbeDeps {
  accounts: () => AccountRecord[];
  isUp: (endpoint: string) => Promise<boolean>;
  probe: (endpoint: string) => Promise<number>;
  log: (line: string) => void;
}

const openProbeDeps: OpenProbeDeps = {
  accounts: loadAccounts,
  isUp: (endpoint) => isBrowserUp(endpoint),
  probe: (endpoint) => probeKarma(endpoint),
  log: (line) => console.log(line)
};

export async function probeKarmaOpen(deps: OpenProbeDeps = openProbeDeps): Promise<number> {
  const withPort = deps.accounts().filter((a) => typeof a.debugPort === 'number' && a.debugPort > 0);
  const open: Array<{ handle: string; endpoint: string }> = [];
  for (const a of withPort) {
    const endpoint = `http://127.0.0.1:${a.debugPort}`;
    if (await deps.isUp(endpoint)) open.push({ handle: a.handle, endpoint });
  }
  if (!open.length) {
    deps.log(`no account's browser is running (${withPort.length} with a debug port) — nothing measured`);
    return 1;
  }

  deps.log(`measuring ${open.length} of ${withPort.length}: ${open.map((o) => o.handle).join(', ')}`);
  const failed: string[] = [];
  for (const o of open) {
    deps.log(`— ${o.handle} (${o.endpoint})`);
    let code: number;
    try {
      code = await deps.probe(o.endpoint);
    } catch (e) {
      // One account's failure must not cost the others their measurement.
      deps.log(`  ${e instanceof Error ? e.message : String(e)}`);
      code = 1;
    }
    if (code !== 0) failed.push(o.handle);
  }
  if (failed.length) {
    deps.log(`not measured: ${failed.join(', ')}`);
    return 1;
  }
  return 0;
}

/**
 * `node dist/probe-karma.js` keeps working — the form every doc and runbook records. Guarded
 * exactly as src/cli.ts guards its own entry, so importing this module runs nothing.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  probeKarma()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    });
}
