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
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface SourcesFile {
  subreddits?: Array<{ name: string; enabled?: boolean }>;
  searches?: Array<{ query: string; enabled?: boolean }>;
}

function enabledSources(): { subs: string[]; queries: string[] } {
  const f = join(DATA, 'sources.json');
  if (!existsSync(f)) return { subs: [], queries: [] };
  try {
    const parsed = JSON.parse(readFileSync(f, 'utf8')) as SourcesFile;
    return {
      subs: (parsed.subreddits ?? []).filter((s) => s.enabled !== false).map((s) => s.name),
      queries: (parsed.searches ?? []).filter((s) => s.enabled !== false).map((s) => s.query)
    };
  } catch {
    return { subs: [], queries: [] };
  }
}

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
    repliesToday: account ? counters(account.handle).repliesToday : 0
  });

  if (!verdict.allowed) {
    say.warn(`Skipping this cycle — ${verdict.detail}`);
    record('auto.skip', verdict.detail, { rule: verdict.rule ?? null, account: account?.handle ?? null });
    return 0;
  }
  say.ok(verdict.detail);

  const { subs, queries } = enabledSources();
  if (!subs.length && !queries.length) {
    say.warn('Nothing switched on in data/sources.json — nothing to collect.');
    return 0;
  }

  const before = loadThreads().length;
  for (const s of subs) {
    say.step(`Reading r/${s}…`);
    await read(s);
  }
  for (const q of queries) {
    say.step(`Searching “${q}”…`);
    await search(q);
  }
  const collected = loadThreads().length - before;
  say.step(`Collected ${collected} new thread(s).`);

  say.step('Working out which are worth answering…');
  await opportunity();

  const draftsBefore = loadDrafts().length;
  say.step('Writing a reply for the best one…');
  await draft();
  const written = loadDrafts().length - draftsBefore;

  if (written > 0) {
    const newest = loadDrafts()[loadDrafts().length - 1];
    if (newest) {
      say.step(`Fact-checking ${newest.id}…`);
      await certifyCmd(newest.id);
    }
  } else {
    say.step('Nothing worth writing this cycle — that is a normal outcome.');
  }

  record('auto.cycle', `unattended cycle finished`, {
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
      record('auto.error', msg, { level: 'error' });
    }
    say.step(`Sleeping ${minutes} minutes…`);
    await sleep(minutes * 60_000);
  }
}
