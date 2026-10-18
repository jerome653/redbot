/**
 * `redbot auto [--once] [--every <minutes>]`
 *
 * Runs the pipeline unattended, up to and including the fact-check, and then stops.
 *
 * The line it will not cross: **it never publishes.** Collecting, scoring, drafting and
 * fact-checking are reversible and private — nothing leaves the machine, and a bad draft
 * costs nothing but the tokens that made it. Publishing is neither of those things, and the
 * person deciding is the only instrument that has ever caught a fluent, well-evidenced,
 * false reply. Automating the steps before that decision makes the decision easier to make;
 * automating the decision removes the thing that works.
 *
 * Every cycle asks `checkWindow` first, so an account's quiet hours and daily ceiling are
 * respected by the one caller most likely to violate them — the one with nobody watching.
 */
import { loadDrafts, countThreads } from '../store.js';
import { selectedAccount, config, DATA } from '../config.js';
import { checkWindow } from '../window.js';
import { counters } from '../health.js';
import { hitCollectionWall } from '../collect-wall.js';
import { read } from './read.js';
import { search } from './search.js';
import { opportunity } from './opportunity.js';
import { draft } from './draft.js';
import { certifyCmd } from './certify.js';
import { reply } from './reply.js';
import { autoPublishEnabled } from '../autopublish.js';
import { stripRefutedEnabled } from '../refuted-strip.js';
import { recheckWithoutRefuted } from '../refuted-recheck.js';
import { record, say } from '../log.js';
import { dailyDatabaseBackup, type DailyDatabaseBackup } from '../backup.js';
/**
 * Sources come from sources through src/sources.ts, which is also where "the file is
 * absent" stopped meaning the same thing as "the file is corrupt".
 *
 * This file used to hold its own reader that caught every parse error and returned
 * `{subs: [], queries: []}`. A typo in sources.json therefore produced "Nothing switched on —
 * nothing to collect" on every cycle: an unattended loop that looked configured, ran forever,
 * and collected nothing. That reader is gone; a corrupt list now stops the cycle and says why.
 */
import { enabledSources, SourcesError } from '../sources.js';
import { pruneTrace } from '../db/logs.js';
import { getPool } from '../db.js';

/**
 * How many trace rows this install keeps.
 *
 * 200,000 is ~42 MB at the 212 bytes/row `dbstat` reports, and ~16 days of history at the
 * measured 698 rows/cycle and 12 cycles/day — long enough that `redbot doctor` and
 * `redbot insights` still have something to reason over, and bounded so the database does not
 * grow forever. Raise it deliberately; `tools/ops/simulate.mjs` SIM 2 prints what any value costs.
 */
const TRACE_KEEP = Number(process.env.REDBOT_TRACE_KEEP ?? 200_000);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One full pass. Returns 0 when the cycle completed or was legitimately skipped. */
async function cycle(): Promise<number> {
  const account = (() => {
    try { return selectedAccount(); } catch (e) {
      say.fail(e instanceof Error ? e.message : String(e));
      return null;
    }
  })();

  const verdict = checkWindow({
    account,
    repliesToday: account ? (await counters(account.handle)).repliesToday : 0
  });

  if (!verdict.allowed) {
    say.warn(`Skipping this cycle — ${verdict.detail}`);
    await record('auto.skip', verdict.detail, { rule: verdict.rule ?? null, account: account?.handle ?? null });
    return 0;
  }
  say.ok(verdict.detail);

  /**
   * A source list that cannot be read STOPS the cycle. It does not become an empty list.
   *
   * Returning 1 rather than 0 matters: the loop's caller treats a non-zero cycle as a real
   * failure, so a broken config surfaces instead of scrolling past as a routine "nothing to do".
   */
  let subs: string[], queries: string[], from: string;
  try {
    ({ subs, queries, from } = await enabledSources());
  } catch (e) {
    const detail = e instanceof SourcesError ? e.message : String(e);
    say.fail(`Refusing to run a cycle: the source list could not be read.\n  ${detail}`);
    // `auto.error`, not `auto.skip` — a skip is a legitimate decision not to run, and health
    // and reliability metrics read these. A broken config must not be counted as a quiet hour.
    await record('auto.error', 'source list unreadable — refused to run a cycle', { detail });
    return 1;
  }

  if (!subs.length && !queries.length) {
    // Naming WHERE the empty answer came from: "nothing configured" and "the database is
    // empty and the seed file is too" send a person to different places.
    say.warn(`Nothing switched on (source of truth: ${from}) — nothing to collect.`);
    say.step('Add one in the console, or: redbot sources import');
    return 0;
  }

  /* A COUNT, not a load. This was `(await loadThreads()).length`, and so was the matching line
     after collection: two full corpus loads per cycle, both thrown away, to produce one integer.
     At one year of collection that measured 2,044 ms and 366 MB of heap each against 1 ms for the
     count — see src/db/threads.ts `countThreadsInDb`. */
  const before = await countThreads();

  /**
   * STOP WHEN THE HOST IS REFUSING, rather than asking the remaining sources one at a time.
   *
   * These two loops discarded the exit code of `read()` and `search()`, both of which return 1 on
   * a 429 or a block page. Measured 2026-09-28: the first 429 landed at 00:56:06 and the cycle
   * then navigated into the wall 25 more times in 27 seconds — see src/collect-wall.ts for the
   * full trace and for why `collected: 0` reading as a quiet hour is the half that cost the posts.
   *
   * The sources are flattened into one list so the run of failures is counted ACROSS subreddits
   * and searches. It was counted nowhere before: collect-run.ts holds a retry budget WITHIN a
   * source, and nothing held one between them. Order is unchanged — subreddits, then searches.
   */
  const sources: Array<{ step: string; run: () => Promise<number> }> = [
    ...subs.map((s) => ({ step: `Reading r/${s}…`, run: () => read(s) })),
    /**
     * PREVIEW THEN COMMIT, per query. `search(q)` is preview-only (src/commands/search.ts:281
     * returns `preview(...)`), and nothing on this path ever committed. Measured 2026-09-28 across
     * the whole database: 177 `search.preview` rows, **0** `search` rows, and 0 of 586 threads
     * carry `source='search'`. Every search this system has ever run listed candidates and threw
     * them away.
     *
     * That matters because the queries are the most on-domain sources configured — "WordPress
     * plugins", "plugin conflicts", "multiple WordPress sites" — against a competence profile
     * anchored on `wordpress` (src/competence.ts), while the subreddits measured 11.8% in scope
     * overall.
     *
     * The commit has to happen HERE, between previews: `commit()` reads
     * data/search-candidates.json, which holds exactly one preview, and the next query overwrites
     * it. `'clean'` is the only spec an unattended caller may use — see parsePicks.
     */
    ...queries.map((q) => ({
      step: `Searching “${q}”…`,
      run: async () => {
        /* 'day', not the 'week' default (scrape.ts:246). The effective age ceiling at selection is
           min(maxThreadAgeHoursToPublish, warmingMaxThreadAgeHours) = 24h, so a week-wide search
           spends page loads collecting threads the very next stage refuses on age. */
        const previewed = await search(q, undefined, undefined, 'day');
        if (previewed !== 0) return previewed;
        return search(undefined, undefined, 'clean');
      }
    }))
  ];

  let failuresInARow = 0;
  let abandoned = 0;
  for (let i = 0; i < sources.length; i++) {
    const wall = hitCollectionWall(failuresInARow, i, sources.length);
    if (wall.abort) {
      abandoned = sources.length - i;
      say.warn(wall.why);
      /* `stage: 'read'` is load-bearing — src/health.ts counts only PUBLISH-stage 429s toward a
         cooldown, and a collection wall must not silence publishing on top of everything else. */
      await record('ratelimit', `collection abandoned after ${failuresInARow} failures in a row`, {
        status: 'blocked', stage: 'read', abandoned, attempted: i, configured: sources.length
      });
      break;
    }
    const src = sources[i]!;
    say.step(src.step);
    const code = await src.run();
    failuresInARow = code === 0 ? 0 : failuresInARow + 1;
  }

  const collected = (await countThreads()) - before;
  say.step(`Collected ${collected} new thread(s).`);
  /* A short collection has two causes that send a person to different places, and until now they
     wrote the same line. Say which one this was. */
  if (abandoned) {
    say.warn(`${abandoned} source(s) skipped — scoring what is already collected instead.`);
  }

  say.step('Working out which are worth answering…');
  await opportunity();

  const draftsBefore = (await loadDrafts()).length;
  say.step('Writing a reply for the best one…');
  await draft();
  const written = (await loadDrafts()).length - draftsBefore;

  if (written > 0) {
    const newest = (await loadDrafts())[(await loadDrafts()).length - 1];
    if (newest) await factCheckThenPublish(newest.id);
  } else {
    say.step('Nothing worth writing this cycle — that is a normal outcome.');
  }

  /**
   * RETENTION, ONCE PER CYCLE. This is the only loop in the product and therefore the only place
   * that knows a cycle just ended.
   *
   * MEASURED by tools/ops/simulate.mjs SIM 2: a cycle writes ~698 trace rows and nothing deleted
   * any of them, so the database grew without bound for as long as this loop ran — ~672 MB and
   * 3.1M rows after a year at this interval. There was no cliff, which is why it went unnoticed.
   *
   * NOT FATAL, and not allowed to fail the cycle. A cycle that collected, drafted and published
   * has done its job; losing a prune costs disk and nothing else, and the next cycle tries again.
   * The failure is RECORDED rather than swallowed, because a prune that has been failing silently
   * for weeks is indistinguishable from no prune at all.
   */
  try {
    const { deleted, kept } = await pruneTrace(getPool(), TRACE_KEEP);
    if (deleted > 0) say.step(`Trimmed ${deleted.toLocaleString()} old trace row(s); ${kept.toLocaleString()} kept.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    say.warn(`Trace retention failed: ${msg}`);
    await record('error', `trace retention failed: ${msg}`, { level: 'warn' });
  }

  await record('auto.cycle', `unattended cycle finished`, {
    account: account?.handle ?? null, collected, drafted: written
  });
  /* The message has to tell the truth about which install this is. It read "Nothing was
     published — that still needs you" unconditionally, which on an autonomous install would be
     a line asserting the opposite of what just happened. */
  say.ok(autoPublishEnabled()
    ? 'Cycle finished. Publishing is UNATTENDED on this install — see the publish.* history rows for what it decided.'
    : 'Cycle finished. Nothing was published — that still needs you.');
  return 0;
}

export interface FactCheckDeps {
  certify: (draftId: string) => Promise<number>;
  reply: (draftId: string, opts: { unattended: true }) => Promise<number>;
  publish: () => boolean;
}

/** The cycle's last step for the draft it just wrote. The seams exist so a test can stub the model. */
export async function factCheckThenPublish(
  draftId: string,
  deps: FactCheckDeps = { certify: (id) => certifyCmd(id), reply, publish: autoPublishEnabled }
): Promise<void> {
  say.step(`Fact-checking ${draftId}…`);
  await deps.certify(draftId);

  /**
   * AND, WHEN THIS INSTALL HAS BEEN SWITCHED TO IT, PUBLISH.
   *
   * The header of this file says the line it will not cross is publishing, and that stays
   * true of every install that has not set REDBOT_AUTO_PUBLISH=1. On one that has, the
   * decision moves from a person at a prompt to the rule in src/autopublish.ts — which asks
   * for MORE than the prompt did: a CERTIFIED verdict (ESCALATE is explicitly "needs a person
   * who knows the subject"), no hard gate, and no advisory at all.
   *
   * The draft is re-read rather than reused: certifyCmd has just written the verdict onto it.
   *
   * `reply()` is left to do its own refusing. It re-runs the gates against the live page
   * immediately before submitting (reply.ts, the second `evaluateGates`), and that check is
   * the one that catches a thread locked or answered in the minutes since certification —
   * facts no rule here could have known.
   */
  if (!deps.publish()) return;

  /**
   * FIX-AND-RECHECK (Jerome, 2026-10-18). A REJECT whose only hard findings are claims proven false
   * (and claims resting on them) has those sentences deleted and is certified ONCE more; the publish
   * decision then runs on the new draft. Deletion, never a model rewrite — see src/refuted-strip.ts.
   * Each strip costs one more certification (12-19 model calls); REDBOT_STRIP_REFUTED=0 turns it off.
   */
  const target = stripRefutedEnabled() ? await recheckWithoutRefuted(draftId, deps.certify) : draftId;
  const fresh = (await loadDrafts()).find((d) => d.id === target);
  const verdict = fresh?.certification?.verdict ?? null;
  say.step(`Unattended publish check for ${target} (certification: ${verdict ?? 'none'})…`);
  await deps.reply(target, { unattended: true });
}

/**
 * Once a day, ahead of the cycle, the database is copied (src/backup.ts, dailyDatabaseBackup).
 *
 * Ahead of checkWindow on purpose: a backup touches no browser and no Reddit, so quiet hours are
 * the right time for it rather than a reason to skip it. A copy that was made is said in the run
 * log, and the verified file is its record. A failure is recorded as `error` and the cycle still
 * runs — a missing copy must not also cost the day's work. `error` is outside stall-watch's
 * WORK_KINDS and END_KINDS, so the row neither opens nor closes a cycle.
 */
export async function backupBeforeCycle(
  run: () => Promise<DailyDatabaseBackup> = () => dailyDatabaseBackup(getPool()),
  rec: typeof record = record
): Promise<DailyDatabaseBackup | null> {
  let r: DailyDatabaseBackup;
  try {
    r = await run();
  } catch (e) {
    r = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  try {
    if (r.skipped) return r;
    if (r.ok) {
      say.step(`Database backed up: ${r.detail}`);
    } else {
      say.warn(`Database backup failed: ${r.detail}`);
      await rec('error', `database backup failed: ${r.detail}`, { backup: 'database', level: 'warn' });
    }
  } catch {
    /* The history row is the record of the backup, not the backup; failing to write it must not
       stop the loop. */
  }
  return r;
}

export async function auto(opts?: { once?: boolean; everyMinutes?: number }): Promise<number> {
  say.head('redbot auto — unattended, up to the fact-check');
  /* Say which install this is, loudly, on the first line of every run. An autonomous install that
     opened with "this never publishes" would be the single most misleading line in the product. */
  if (autoPublishEnabled()) {
    say.warn('UNATTENDED PUBLISHING IS ON (REDBOT_AUTO_PUBLISH=1). This will post to Reddit ' +
             'without asking, on a CERTIFIED verdict with no gate finding of any kind.');
  } else {
    say.warn('This never publishes. Approving a reply is still a person’s job.');
  }

  if (opts?.once) return cycle();

  const minutes = Math.max(15, opts?.everyMinutes ?? 60);
  say.step(`Running every ${minutes} minutes. Ctrl+C to stop.`);
  // Deliberately sequential and unbounded: one cycle at a time, forever, until stopped.
  for (;;) {
    await backupBeforeCycle();
    try {
      await cycle();
    } catch (e) {
      // A failed cycle must not kill the loop — the next one may well succeed.
      const msg = e instanceof Error ? e.message : String(e);
      say.fail(`Cycle failed: ${msg}`);
      await record('auto.error', msg, { level: 'error' });
    }
    say.step(`Sleeping ${minutes} minutes…`);
    await sleep(minutes * 60_000);
  }
}
