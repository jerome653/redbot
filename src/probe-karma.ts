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
 * WHY THIS IS A FUNCTION AND NOT A TOP-LEVEL SCRIPT.
 * It used to run on import: `const s = await attach()` at module scope. That made it
 * impossible to wire into src/cli.ts — importing it there would have attached a browser on
 * every single `redbot` invocation, including `doctor` and `--help`. So it stayed a
 * standalone script, and docs/12-FINAL-PHASE-ASSESSMENT.md logged "not wired into the CLI"
 * as deferred debt. Meanwhile tools/product/server.mjs shipped a button that spawns
 * `dist/cli.js probe-karma`, which answered "Unknown command: probe-karma" — step 3 of the
 * account wizard could never work. The work is the same either way; only the entry moved.
 */
import { attach, whoAmI } from './browser.js';
import { recordObservation } from './health.js';

/**
 * Measure and record. Returns a process exit code rather than calling `process.exit`, so a
 * caller inside the CLI can decide what to do — a command that kills the process from inside
 * a library function is a command that cannot be composed.
 */
export async function probeKarma(): Promise<number> {
  const s = await attach();
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
