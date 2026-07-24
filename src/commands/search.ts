/**
 * `redbot search "<query>"`          — look, and show what is there. Commits nothing.
 * `redbot search --commit 1,4,7`     — collect only the ones a person picked.
 * `redbot search --commit all`       — collect every candidate from the last preview.
 *
 * **Why this is two steps now.** Until 2026-07-24 a single `search` opened all fifteen
 * results and wrote all fifteen into `threads.json`. Two things followed from that, both
 * observed rather than theorised:
 *
 * - The corpus is the only production evidence redbot has, and a bulk commit puts whatever a
 *   query happened to return into it. Three of the seven drafts pending after Phase 2
 *   targeted threads seven to eight YEARS old (DEFECT-11), because nothing between "the
 *   search returned it" and "it is in the corpus" was a decision anyone made.
 * - Opening fifteen threads costs fifteen page loads against a measured ceiling of 9.5/min.
 *   Spending that on results a person would have rejected at a glance is the expensive half
 *   of the run.
 *
 * So the preview reads the listing only — no thread is opened — and applies the checks that
 * are already mechanical: the announcement-tag and question-shape test from `select.ts`, and
 * the vocabulary check from `competence.ts`. Those are proxies and are labelled as such. They
 * do not decide anything here; they annotate, so the person picking can see what the pipeline
 * would say and disagree with it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { attach, isBrowserUp, NoBrowserError } from '../browser.js';
import { runSearch, collectListings, collectThread } from '../reddit/scrape.js';
import { sel } from '../reddit/selectors.js';
import { config, DATA, ensureData } from '../config.js';
import { saveThreads } from '../store.js';
import { record, say } from '../log.js';
import { isQuestionShaped } from '../select.js';
import { assessCompetence } from '../competence.js';
import type { Thread } from '../types.js';

export const candidatesPath = join(DATA, 'search-candidates.json');

interface Candidate {
  n: number;
  url: string;
  title: string | null;
  /** What the mechanical checks say. Annotation only — the person picking decides. */
  notes: string[];
  /** True when nothing mechanical objected. Not a recommendation. */
  clean: boolean;
}

interface CandidateFile {
  query: string;
  previewedAt: string;
  candidates: Candidate[];
}

/* ------------------------------------------------------------------ *
 * Preview
 * ------------------------------------------------------------------ */

function annotate(title: string | null): { notes: string[]; clean: boolean } {
  const notes: string[] = [];
  if (!title) {
    // A candidate whose title the listing did not expose cannot be pre-judged. Saying so is
    // the honest output; guessing from the URL slug would read as a check that did not happen.
    return { notes: ['title not readable from the listing — nothing could be checked'], clean: false };
  }

  /**
   * Both checks normally read the title AND the body. A listing has no body, and saying so on
   * every note is the difference between "this thread fails the check" and "this thread fails
   * the check as far as a title can show". Measured while building this: the real help request
   * "WordPress plugin conflict is breaking my checkout after a host migration" is flagged,
   * because with no question mark and no explicit ask, a title alone carries no question. The
   * body would have settled it. That is exactly the case a person is here to overrule.
   */
  const shape = isQuestionShaped({ title, body: null });
  if (!shape.pass) notes.push(`shape (title only, body not read): ${shape.detail}`);

  const comp = assessCompetence(title);
  if (!comp.inScope) notes.push(`vocabulary (title only, body not read): ${comp.detail}`);

  return { notes, clean: notes.length === 0 };
}

async function preview(query: string, max: number): Promise<number> {
  say.head(`redbot search "${query}"`);
  if (!(await isBrowserUp())) {
    say.fail(new NoBrowserError(config.browser.cdpEndpoint).message);
    return 1;
  }

  const s = await attach();
  try {
    await runSearch(s.page, query);
    say.step(`Reading up to ${max} listing entries — no thread is opened…`);

    const listings = await collectListings(s.page, max, sel.searchScope);
    if (!listings.length) {
      say.warn('The search returned nothing that looks like a post link.');
      return 1;
    }

    const candidates: Candidate[] = listings.map((l, i) => {
      const { notes, clean } = annotate(l.title);
      return { n: i + 1, url: l.url, title: l.title, notes, clean };
    });

    ensureData();
    const file: CandidateFile = { query, previewedAt: new Date().toISOString(), candidates };
    writeFileSync(candidatesPath, JSON.stringify(file, null, 2), 'utf8');

    say.ok(`${candidates.length} candidate(s). Nothing has been collected yet.`);
    console.log();
    for (const c of candidates) {
      const mark = c.clean ? ' ' : '!';
      console.log(`  ${mark} ${String(c.n).padStart(2)}. ${c.title ?? '(title not readable)'}`);
      for (const note of c.notes) console.log(`        ${note}`);
    }
    console.log();

    const clean = candidates.filter((c) => c.clean).length;
    say.step(
      `${clean} of ${candidates.length} raised no mechanical objection. Those checks read the ` +
      `TITLE only and are proxies — a good thread with an unusual title is flagged, and a bad ` +
      `one with a tidy title is not. Read the list.`
    );
    say.step(`Collect what you want:  redbot search --commit ${candidates.filter((c) => c.clean).slice(0, 3).map((c) => c.n).join(',') || '1,2'}`);
    say.step(`Or everything:          redbot search --commit all`);

    record('search.preview', `"${query}": ${candidates.length} candidates, ${clean} unflagged`, {
      query, candidates: candidates.length, clean
    });
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    say.fail(msg);
    record('error', `search preview "${query}" failed: ${msg}`);
    return 1;
  } finally {
    await s.close();
  }
}

/* ------------------------------------------------------------------ *
 * Commit
 * ------------------------------------------------------------------ */

function parsePicks(spec: string, candidates: Candidate[]): { picked: Candidate[]; error?: string } {
  if (spec.trim().toLowerCase() === 'all') return { picked: candidates };

  const picked: Candidate[] = [];
  const seen = new Set<number>();
  for (const part of spec.split(',').map((p) => p.trim()).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    const nums = range
      ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i)
      : [Number(part)];
    for (const n of nums) {
      if (!Number.isInteger(n)) return { picked: [], error: `"${part}" is not a number, a range, or "all"` };
      const c = candidates.find((x) => x.n === n);
      if (!c) return { picked: [], error: `there is no candidate ${n} — the preview listed 1-${candidates.length}` };
      if (!seen.has(n)) { seen.add(n); picked.push(c); }
    }
  }
  return picked.length ? { picked } : { picked: [], error: 'no candidates were named' };
}

async function commit(spec: string): Promise<number> {
  if (!existsSync(candidatesPath)) {
    say.fail('No preview on record. Run `redbot search "<query>"` first — it shows what is there without collecting it.');
    return 1;
  }

  let file: CandidateFile;
  try {
    file = JSON.parse(readFileSync(candidatesPath, 'utf8')) as CandidateFile;
  } catch (e) {
    say.fail(`data/search-candidates.json is unreadable (${(e as Error).message}). Re-run the search.`);
    return 1;
  }

  const { picked, error } = parsePicks(spec, file.candidates);
  if (error) { say.fail(error); return 1; }

  say.head(`redbot search --commit — ${picked.length} of ${file.candidates.length} from "${file.query}"`);

  const flagged = picked.filter((c) => !c.clean);
  if (flagged.length) {
    // Not a block. The mechanical checks are proxies and a person is entitled to overrule
    // them — but the overrule should be visible in the log, not silent.
    say.warn(`${flagged.length} of these were flagged in the preview and you picked them anyway:`);
    for (const c of flagged) say.step(`  ${c.n}. ${c.title ?? '(no title)'} — ${c.notes.join('; ')}`);
  }

  if (!(await isBrowserUp())) {
    say.fail(new NoBrowserError(config.browser.cdpEndpoint).message);
    return 1;
  }

  const s = await attach();
  const threads: Thread[] = [];
  try {
    let skipped = 0;
    for (const [i, c] of picked.entries()) {
      try {
        const t = await collectThread(s.page, c.url, 'search', file.query);
        if (t) {
          threads.push(t);
          say.step(`  [${i + 1}/${picked.length}] ${t.title.slice(0, 70)}`);
        } else {
          skipped++;
          say.step(`  [${i + 1}/${picked.length}] skipped — no title found`);
        }
      } catch (e) {
        skipped++;
        say.step(`  [${i + 1}/${picked.length}] skipped — ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`);
      }
    }
    if (skipped) say.warn(`${skipped} thread(s) skipped and not counted.`);

    const added = saveThreads(threads);
    say.ok(`Collected ${threads.length} threads (${added} new). Next: redbot opportunity`);
    record('search', `"${file.query}": committed ${threads.length} of ${file.candidates.length}, ${added} new`, {
      query: file.query,
      previewed: file.candidates.length,
      picked: picked.length,
      collected: threads.length,
      added,
      overruled: flagged.length
    });
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    say.fail(msg);
    record('error', `search commit failed: ${msg}`);
    return 1;
  } finally {
    await s.close();
  }
}

/* ------------------------------------------------------------------ *
 * Entry
 * ------------------------------------------------------------------ */

export async function search(query: string | undefined, limit?: number, commitSpec?: string): Promise<number> {
  if (commitSpec !== undefined) return commit(commitSpec);
  if (!query) {
    say.fail('Usage: redbot search "<query>"   then   redbot search --commit <1,4,7|all>');
    return 1;
  }
  return preview(query, limit ?? config.limits.maxThreadsPerRead);
}

export { parsePicks as _parsePicks, annotate as _annotate };
