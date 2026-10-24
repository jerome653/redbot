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
import { attach, isBrowserUp, whoAmI } from './browser.js';
import { recordObservation } from './health.js';

/**
 * WHERE THE NUMBER COMES FROM. PRODUCTION 20-22 Oct (cardinal): 8 of ~12 runs printed every field
 * null for jordangrowth and colegrowth — a fixed 2500 ms sleep then an innerText regex, so a late
 * render or a different layout failed silently. Primary source is now Reddit's own about.json,
 * fetched inside the signed-in page; the regex is the fallback and polls instead of sleeping.
 */
export interface KarmaFacts {
  karma: string | number | null;
  postKarma: string | number | null;
  commentKarma: string | number | null;
  cakeDay: string | null;
  joined: string | null;
}

const EMPTY_FACTS: KarmaFacts = { karma: null, postKarma: null, commentKarma: null, cakeDay: null, joined: null };

const KARMA_TEXT = /([\d,.]+k?)\s*\n?\s*karma/i;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseAboutJson(status: number, body: unknown): { facts: KarmaFacts } | { error: string } {
  if (status !== 200) return { error: `about.json: HTTP ${status}` };
  const data = (body && typeof body === 'object' ? (body as { data?: unknown }).data : null) as
    Record<string, unknown> | null | undefined;
  if (!data || typeof data !== 'object') return { error: 'about.json: response was not a user object' };
  const link = num(data.link_karma);
  const comment = num(data.comment_karma);
  const total = num(data.total_karma) ?? (link != null && comment != null ? link + comment : null);
  // A suspended or shadow-banned account answers 200 with no karma fields — that is not karma 0.
  if (total == null) return { error: 'about.json: no karma fields in the response' };
  const created = num(data.created_utc);
  return {
    facts: {
      karma: total,
      postKarma: link,
      commentKarma: comment,
      cakeDay: null,
      joined: created != null ? new Date(created * 1000).toISOString() : null
    }
  };
}

export function parseProfileText(text: string): KarmaFacts {
  const grab = (re: RegExp) => {
    const m = re.exec(text);
    return m?.[1] ? m[1].trim() : null;
  };
  return {
    karma: grab(KARMA_TEXT),
    postKarma: grab(/([\d,.]+k?)\s*\n?\s*post karma/i),
    commentKarma: grab(/([\d,.]+k?)\s*\n?\s*comment karma/i),
    cakeDay: grab(/cake day\s*\n?\s*(.+)/i),
    joined: grab(/(?:joined|redditor since)\s*\n?\s*(.+)/i),
  };
}

/** The value recordObservation takes, or null. "1,234" → 1234; "1.2k" is not a count → null. */
export function karmaNumber(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * The karma-breakdown observations to record beside the total. The total (kind 'karma') is
 * recorded separately and is what gates probe success; these are the comment- and post-karma
 * figures parsed from the same read, each stored only when it was actually present and numeric.
 * For warming the comment figure is the one that matters, so dropping it (as the probe used to)
 * discards the signal that says whether comments are earning karma even while the total is flat.
 */
export function extraKarmaObservations(
  facts: KarmaFacts
): Array<{ kind: 'comment-karma' | 'post-karma'; value: number }> {
  const out: Array<{ kind: 'comment-karma' | 'post-karma'; value: number }> = [];
  const comment = karmaNumber(facts.commentKarma);
  if (comment != null) out.push({ kind: 'comment-karma', value: comment });
  const post = karmaNumber(facts.postKarma);
  if (post != null) out.push({ kind: 'post-karma', value: post });
  return out;
}

/** Poll the page text until the karma text shows up, or the timeout passes; returns the last text. */
export async function waitForKarmaText(
  read: () => Promise<string>,
  opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const intervalMs = opts.intervalMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let waited = 0;
  let text = await read();
  while (!KARMA_TEXT.test(text) && waited + intervalMs <= timeoutMs) {
    await sleep(intervalMs);
    waited += intervalMs;
    text = await read();
  }
  return text;
}

export interface KarmaSources {
  fetchAbout: () => Promise<{ status: number; body: unknown }>;
  /** Navigates to the profile and returns its text once the karma text appears (or it gives up). */
  readProfileText: () => Promise<string>;
}

export type KarmaResult =
  | { ok: true; source: 'about.json' | 'profile-page'; facts: KarmaFacts; notes: string[] }
  | { ok: false; reasons: string[] };

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function collectKarma(src: KarmaSources): Promise<KarmaResult> {
  const reasons: string[] = [];
  try {
    const { status, body } = await src.fetchAbout();
    const r = parseAboutJson(status, body);
    if ('facts' in r) return { ok: true, source: 'about.json', facts: r.facts, notes: [] };
    reasons.push(r.error);
  } catch (e) {
    reasons.push(`about.json: ${why(e)}`);
  }
  try {
    const facts = parseProfileText(await src.readProfileText());
    if (karmaNumber(facts.karma) != null) return { ok: true, source: 'profile-page', facts, notes: reasons };
    reasons.push('profile page: no karma text matched after waiting');
  } catch (e) {
    reasons.push(`profile page: ${why(e)}`);
  }
  return { ok: false, reasons };
}

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

    const page = s.page;
    const name = me.username;
    const result = await collectKarma({
      // Same origin as the signed-in page, so the session cookie goes with it.
      fetchAbout: () => page.evaluate(async (u: string) => {
        const res = await fetch(`/user/${encodeURIComponent(u)}/about.json?raw_json=1`, {
          credentials: 'include', headers: { accept: 'application/json' }
        });
        let body: unknown = null;
        try { body = await res.json(); } catch { body = null; }
        return { status: res.status, body };
      }, name),
      readProfileText: async () => {
        await page.goto(`https://www.reddit.com/user/${name}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        });
        return waitForKarmaText(() => page.evaluate(() => document.body?.innerText ?? ''));
      }
    });

    if (!result.ok) {
      console.log(JSON.stringify({ username: me.username, ...EMPTY_FACTS }, null, 2));
      for (const r of result.reasons) console.log(`  ${r}`);
      console.log('karma could not be read from about.json or the profile page — nothing recorded');
      return 1;
    }
    const facts = result.facts;
    console.log(JSON.stringify({ username: me.username, ...facts }, null, 2));
    for (const n of result.notes) console.log(`  ${n}`);
    console.log(`source: ${result.source}`);

    /**
     * PRODUCTION OBSERVATION 2026-07-23: this probe was run and reported karma 1, and the health
     * machine went on saying "karma has never been measured on this account". The measurement
     * was printed to a terminal and thrown away.
     *
     * A measurement that does not reach the log is not evidence. Recorded here, in the same
     * observation store the health machine reads, so the two cannot disagree again.
     */
    const karma = karmaNumber(facts.karma);
    if (karma != null) {
      await recordObservation({
        account: me.username, kind: 'karma', vector: 'signed-in',
        value: karma, note: `measured by probe-karma from ${result.source === 'about.json' ? 'about.json' : 'the profile page'}`
      });
      console.log(`recorded: karma ${karma} for ${me.username}`);
      for (const extra of extraKarmaObservations(facts)) {
        await recordObservation({
          account: me.username, kind: extra.kind, vector: 'signed-in',
          value: extra.value,
          note: `measured by probe-karma from ${result.source === 'about.json' ? 'about.json' : 'the profile page'}`
        });
        console.log(`recorded: ${extra.kind} ${extra.value} for ${me.username}`);
      }
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
