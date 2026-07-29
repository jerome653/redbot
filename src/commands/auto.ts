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
import { loadThreads, loadDrafts } from '../store.js';
import { selectedAccount, config, DATA } from '../config.js';
import { checkWindow } from '../window.js';
import { counters } from '../health.js';
import { read } from './read.js';
import { search } from './search.js';
import { opportunity } from './opportunity.js';
import { draft } from './draft.js';
import { certifyCmd } from './certify.js';
import { record, say } from '../log.js';
/**
 * Sources come from redbot.sources through src/sources.ts, which is also where "the file is
 * absent" stopped meaning the same thing as "the file is corrupt".
 *
 * This file used to hold its own reader that caught every parse error and returned
 * `{subs: [], queries: []}`. A typo in sources.json therefore produced "Nothing switched on —
 * nothing to collect" on every cycle: an unattended loop that looked configured, ran forever,
 * and collected nothing. That reader is gone; a corrupt list now stops the cycle and says why.
 */
import { enabledSources, SourcesError } from '../sources.js';

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

  const before = (await loadThreads()).length;
  for (const s of subs) {
    say.step(`Reading r/${s}…`);
    await read(s);
  }
  for (const q of queries) {
    say.step(`Searching “${q}”…`);
    await search(q);
  }
  const collected = (await loadThreads()).length - before;
  say.step(`Collected ${collected} new thread(s).`);

  say.step('Working out which are worth answering…');
  await opportunity();

  const draftsBefore = (await loadDrafts()).length;
  say.step('Writing a reply for the best one…');
  await draft();
  const written = (await loadDrafts()).length - draftsBefore;

  if (written > 0) {
    const newest = (await loadDrafts())[(await loadDrafts()).length - 1];
    if (newest) {
      say.step(`Fact-checking ${newest.id}…`);
      await certifyCmd(newest.id);
    }
  } else {
    say.step('Nothing worth writing this cycle — that is a normal outcome.');
  }

  await record('auto.cycle', `unattended cycle finished`, {
    account: account?.handle ?? null, collected, drafted: written
  });
  say.ok('Cycle finished. Nothing was published — that still needs you.');
  return 0;
}

export async function auto(opts?: { once?: boolean; everyMinutes?: number }): Promise<number> {
  say.head('redbot auto — unattended, up to the fact-check');
  say.warn('This never publishes. Approving a reply is still a person’s job.');

  if (opts?.once) return cycle();

  const minutes = Math.max(15, opts?.everyMinutes ?? 60);
  say.step(`Running every ${minutes} minutes. Ctrl+C to stop.`);
  // Deliberately sequential and unbounded: one cycle at a time, forever, until stopped.
  for (;;) {
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
