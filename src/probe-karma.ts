/**
 * Read-only probe: report the signed-in account's karma and account age.
 *
 * Exists because the mockup and the status pages were about to state karma figures that
 * had never been measured. Reads the profile page and prints what is actually there.
 *
 * Run: node dist/probe-karma.js       (REDBOT_CDP selects the profile)
 */
import { attach, whoAmI } from './browser.js';
import { recordObservation } from './health.js';

const s = await attach();
try {
  // whoAmI reads the Reddit shell, so we have to be on Reddit before asking.
  await s.page.goto('https://www.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const me = await whoAmI(s.page);
  if (!me.username) {
    console.log('not signed in on this profile');
    process.exit(1);
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
    recordObservation({
      account: me.username, kind: 'karma', vector: 'signed-in',
      value: karma, note: 'measured by probe-karma from the profile page'
    });
    console.log(`recorded: karma ${karma} for ${me.username}`);
  } else {
    console.log('karma could not be parsed from the profile page — nothing recorded');
  }

  if (facts.cakeDay || facts.joined) {
    const raw = facts.cakeDay ?? facts.joined!;
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      recordObservation({
        account: me.username, kind: 'account-created', vector: 'signed-in',
        value: new Date(parsed).toISOString(), note: `parsed from "${raw}"`
      });
    }
  }
} finally {
  await s.close();
}
