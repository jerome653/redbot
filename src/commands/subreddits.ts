/**
 * `redbot subreddits "<topic>"`        — find communities, and show what is there. Adds nothing.
 * `redbot subreddits --commit 1,4`     — add only the ones a person picked.
 * `redbot subreddits --commit all`     — add every candidate from the last preview.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS TWO STEPS, like `search`.
 *
 * A source decides what redbot reads for weeks. Committing whatever a query returned is how the
 * corpus filled with threads nobody chose (DEFECT-11 — three of seven pending drafts targeted
 * threads seven to eight YEARS old, because nothing between "the search returned it" and "it is
 * in the corpus" was a decision anyone made). The preview reads the listing only; nothing is
 * added until a person names it.
 *
 * WHAT THE NUMBERS ARE, AND WHAT THEY ARE NOT. Reddit's community search publishes WEEKLY
 * VISITORS and WEEKLY CONTRIBUTIONS. It does not publish the subscriber count here, and this
 * command does not invent one. The distinction is the whole value of the screen: a large
 * subreddit with almost no weekly contributions is a room where nobody is talking, and a
 * subscriber count would make it look like the opposite. Where Reddit shows no number, this
 * prints "not reported" rather than 0 — measured-as-zero and never-measured are different facts,
 * and collapsing them is the defect `sources.ts` documents for absent-vs-corrupt.
 *
 * The selectors were MEASURED against the live page on 2026-08-03, not guessed — see
 * `sel.communityResult` and `collectCommunities`.
 * ---------------------------------------------------------------------------
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { attach, isBrowserUp, isBlocked, NoBrowserError } from '../browser.js';
import { runCommunitySearch, collectCommunities, type CommunityCandidate } from '../reddit/scrape.js';
import { config, DATA, ensureData } from '../config.js';
import { addSource, enabledSources } from '../sources.js';
import { record, say } from '../log.js';

export const communityCandidatesPath = join(DATA, 'community-candidates.json');

interface Candidate extends CommunityCandidate {
  n: number;
  /** Already a source? Adding it again is a no-op, and the preview should say so first. */
  known: boolean;
}

interface CandidateFile {
  query: string;
  at: string;
  candidates: Candidate[];
}

/** "not reported" is not 0. See the header. */
const num = (v: number | null): string => (v === null ? 'not reported' : v.toLocaleString('en-US'));

/**
 * Pick parsing, deliberately the same contract as `search --commit`: 1-based, comma separated,
 * or the word `all`. Shared behaviour, separate code — `search`'s version is typed to its own
 * candidate shape, and coupling the two files to reuse eight lines would tie a change in one
 * command's preview format to the other's.
 */
export function parsePicks(
  spec: string, candidates: Candidate[]
): { picked: Candidate[]; error?: string } {
  const s = spec.trim().toLowerCase();
  if (!s) return { picked: [], error: 'Name which ones: --commit 1,4 or --commit all' };
  if (s === 'all') return { picked: candidates };

  const picked: Candidate[] = [];
  const missing: string[] = [];
  for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
    if (!/^\d+$/.test(part)) return { picked: [], error: `"${part}" is not a number from the preview.` };
    const found = candidates.find((c) => c.n === Number(part));
    if (found) { if (!picked.includes(found)) picked.push(found); }
    else missing.push(part);
  }
  if (missing.length) {
    return { picked: [], error: `The preview has no ${missing.length > 1 ? 'entries' : 'entry'} ${missing.join(', ')}.` };
  }
  return picked.length ? { picked } : { picked: [], error: 'no candidates were named' };
}

async function preview(query: string): Promise<number> {
  say.head(`redbot subreddits "${query}"`);
  if (!(await isBrowserUp())) {
    say.fail(new NoBrowserError(config.browser.cdpEndpoint).message);
    return 1;
  }

  const s = await attach();
  try {
    await runCommunitySearch(s.page, query);

    if (await isBlocked(s.page)) {
      /* Reddit answers an unattended browser with a challenge page served as HTTP 200 — the same
         failure `browser.ts` refuses headless for. Measured 2026-08-03: the community search
         redirects through `js_challenge=1` and mounts a `reputation-recaptcha`. A signed-in
         browser a person opened passes it; nothing here tries to solve one. */
      say.fail('Reddit served a challenge page instead of results. Sign in to the browser redbot is attached to, open Reddit once by hand, then try again.');
      await record('error', `community search for "${query}" hit a challenge page`, { query });
      return 1;
    }

    const found = await collectCommunities(s.page);
    if (!found.length) {
      /**
       * THREE CAUSES, AND THIS CANNOT TELL THEM APART — so it names all three rather than
       * picking the flattering one.
       *
       * `isBlocked` above only matches Reddit's WORDED refusals ("whoa there", "are you a
       * robot"). Measured 2026-08-03: the community search also redirects through a silent
       * `js_challenge=1` and mounts a `reputation-recaptcha` — on a page that then rendered all
       * 20 results perfectly. So that element's presence is NOT evidence of a block, and keying
       * on it would cry wolf on every successful search. A challenge that does NOT resolve
       * therefore arrives here, as an empty result set, indistinguishable from a query that
       * genuinely matches nothing or a selector that has moved.
       *
       * Reporting "the markup has moved" alone would send someone to edit selectors that are
       * fine. Nothing here is guessed at the operator's expense.
       */
      say.warn('No communities came back. That is one of three things, and this cannot tell which:');
      say.step('  - the query genuinely matches no community — try a broader word');
      say.step('  - Reddit served a challenge this browser did not clear — open Reddit in it by hand, once');
      say.step('  - the search markup moved — `sel.communityResult` was measured 2026-08-03');
      await record('search.preview', `community search for "${query}" returned nothing`, { query, count: 0 });
      return 1;
    }

    const already = new Set((await enabledSources()).subs.map((x) => x.toLowerCase()));
    const candidates: Candidate[] = found.map((c, i) => ({
      ...c, n: i + 1, known: already.has(c.name.toLowerCase())
    }));

    ensureData();
    const file: CandidateFile = { query, at: new Date().toISOString(), candidates };
    writeFileSync(communityCandidatesPath, JSON.stringify(file, null, 2), 'utf8');

    say.step(`${candidates.length} communities. Nothing has been added.\n`);
    for (const c of candidates) {
      say.info(`  ${String(c.n).padStart(2)}. r/${c.name}${c.known ? '   [already a source]' : ''}`);
      say.step(`      ${num(c.weeklyVisitors)} weekly visitors · ${num(c.weeklyContributions)} weekly contributions`);
      if (c.description) say.step(`      ${c.description.slice(0, 150)}`);
    }

    const suggest = candidates.filter((c) => !c.known).slice(0, 3).map((c) => c.n).join(',') || '1';
    say.info('');
    say.step(`Add what you want:  redbot subreddits --commit ${suggest}`);
    say.step('Or everything:      redbot subreddits --commit all');
    await record('search.preview', `community search for "${query}" found ${candidates.length}`, {
      query, count: candidates.length, names: candidates.map((c) => c.name)
    });
    return 0;
  } finally {
    await s.close();
  }
}

async function commit(spec: string): Promise<number> {
  if (!existsSync(communityCandidatesPath)) {
    say.fail('No preview on record. Run `redbot subreddits "<topic>"` first — it shows what is there without adding anything.');
    return 1;
  }

  let file: CandidateFile;
  try {
    file = JSON.parse(readFileSync(communityCandidatesPath, 'utf8')) as CandidateFile;
  } catch (e) {
    say.fail(`data/community-candidates.json is unreadable (${(e as Error).message}). Re-run the search.`);
    return 1;
  }

  const { picked, error } = parsePicks(spec, file.candidates);
  if (error) { say.fail(error); return 1; }

  say.head(`redbot subreddits --commit — ${picked.length} of ${file.candidates.length} from "${file.query}"`);

  let added = 0;
  let failed = 0;
  for (const c of picked) {
    if (c.known) { say.step(`  r/${c.name} — already a source, left alone`); continue; }
    const why = `found by \`subreddits "${file.query}"\` on ${file.at.slice(0, 10)} — ` +
      `${num(c.weeklyVisitors)} weekly visitors, ${num(c.weeklyContributions)} weekly contributions`;
    const r = await addSource('subreddit', c.name, why);
    if (r.ok) { added++; say.ok(`  r/${c.name} added`); }
    else { failed++; say.fail(`  r/${c.name} — ${r.error}`); }
  }

  /**
   * NO history event here, deliberately.
   *
   * `HistoryKind` has no `sources.add` and the history table has no CHECK on kind, so widening the
   * union would have compiled and worked. It would also have been a second, worse copy of a record
   * that already exists: `addSource` stores `why` ON THE SOURCE — the query that found it, the date,
   * and both counts as they read at the time. That travels with the source for as long as it is
   * configured, where a history line ages out of the window the health state machine reads.
   *
   * `types.ts` is explicit that history exists to feed health and reliability metrics, and that
   * filling it with routine state changes drowns both. Adding a source is configuration, not
   * something an account did on Reddit.
   */
  if (failed) { say.warn(`${failed} could not be added.`); return 1; }
  say.ok(`${added} source(s) added. \`redbot read\` will collect from them on the next pass.`);
  return 0;
}

export async function subreddits(query: string | undefined, commitSpec?: string): Promise<number> {
  if (commitSpec !== undefined) return commit(commitSpec);
  if (!query) {
    say.fail('Usage: redbot subreddits "<topic>"   then   redbot subreddits --commit <1,4|all>');
    return 1;
  }
  return preview(query);
}
