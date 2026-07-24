/**
 * `redbot regret [draftId]` — the two questions only a person can answer.
 *
 * Phase C, at publish time:
 *   "Would I still post this if automation were removed entirely?"
 *
 * Human Regret, 24 hours later:
 *   "Would you still be comfortable having your name attached to this reply today?"
 *
 * Both are asked of the operator, recorded verbatim, and counted. Neither is inferred, and
 * neither has a machine-generated default — an unanswered check stays unanswered, because a
 * missing answer is information and a guessed one is noise.
 *
 * The 24h question is the one that matters. Every automated check in this repo is a proxy for
 * "would a knowledgeable person stand behind this", and proxies are graded at the moment of
 * writing, when the reply has not yet met the thread. This one is graded after it has.
 *
 * Like `reply`, this refuses a non-interactive stdin. An operator judgement collected without
 * an operator is worse than no data, because it would be indistinguishable from real data in
 * the evidence log.
 */
import { loadDrafts } from '../store.js';
import {
  recordRegret, loadRegrets, REGRET_ANSWERS, STANDALONE_ANSWERS, ISSUE_CATEGORIES,
  type IssueCategory
} from '../review.js';
import { ask, choose } from '../ask.js';
import { record, say } from '../log.js';
import type { Draft } from '../types.js';

const HOURS = 3_600_000;

function publishedAt(d: Draft): number {
  return Date.parse(d.decidedAt ?? d.createdAt);
}

async function pickFrom<T extends string>(
  prompt: string,
  options: Record<T, string>
): Promise<T> {
  const keys = Object.keys(options) as T[];
  say.info(`\n  ${prompt}`);
  keys.forEach((k, i) => say.info(`    ${i + 1}. ${k} — ${options[k]}`));
  const nums = keys.map((_, i) => String(i + 1));
  // The safe answer is the LAST option in every list here, which is the most critical one
  // (no / would-delete / confidence). An unclear answer must never be recorded as approval.
  const idx = Number(await choose('  Answer', nums, nums[nums.length - 1]!)) - 1;
  return keys[idx] ?? keys[keys.length - 1]!;
}

export async function regret(draftIdArg?: string): Promise<number> {
  say.head('redbot regret');

  const published = loadDrafts().filter((d) => d.status === 'published');
  if (!published.length) {
    say.warn('Nothing has been published, so there is nothing to stand behind yet.');
    return 1;
  }

  const existing = loadRegrets();
  const has = (draftId: string, kind: 'standalone' | 'regret') =>
    existing.some((r) => r.draftId === draftId && r.kind === kind);

  const targets = draftIdArg ? published.filter((d) => d.id === draftIdArg) : published;
  if (!targets.length) {
    say.warn(`No published draft with id ${draftIdArg}.`);
    return 1;
  }

  let asked = 0;

  for (const d of targets) {
    const hours = (Date.now() - publishedAt(d)) / HOURS;
    const url = d.commentPermalink ?? d.publishedUrl ?? d.permalink;

    /* ---- Phase C ---- */
    if (!has(d.id, 'standalone')) {
      say.info('');
      say.step(`${d.title.slice(0, 70)}`);
      say.step(`${url}`);
      say.info('\n--- what was posted ---\n');
      say.info(d.body);
      say.info('\n-----------------------');

      const answer = await pickFrom(
        'Would you still post this if automation were removed entirely?',
        STANDALONE_ANSWERS
      );

      let category: IssueCategory | undefined;
      if (answer === 'no') {
        category = await pickFrom('What was wrong with it?', ISSUE_CATEGORIES);
      }
      const lessons = await ask('  What did you learn? (one line, Enter to skip): ');

      recordRegret({
        draftId: d.id, threadId: d.threadId, permalink: url,
        kind: 'standalone', answer,
        ...(category ? { category } : {}),
        lessons, hoursAfterPublish: Number(hours.toFixed(1)), operator: null
      });
      record('review', `standalone check for ${d.id}: ${answer}`, { draftId: d.id, answer, category });
      say.ok('Recorded.');
      asked++;
    }

    /* ---- Human Regret, 24h ---- */
    if (has(d.id, 'regret')) continue;

    if (hours < 24) {
      say.step(`${d.id} — regret check due in ${Math.ceil(24 - hours)}h (published ${hours.toFixed(1)}h ago)`);
      continue;
    }

    say.info('');
    say.step(`${d.title.slice(0, 70)}`);
    say.step(`${url}`);
    say.step(`Published ${hours.toFixed(0)}h ago. Go and read it in the thread as it stands now.`);
    say.info('\n--- what was posted ---\n');
    say.info(d.body);
    say.info('\n-----------------------');

    const answer = await pickFrom(
      'Would you still be comfortable having your name attached to this reply today?',
      REGRET_ANSWERS
    );

    let category: IssueCategory | undefined;
    if (answer !== 'unchanged') {
      category = await pickFrom('What would you change, and why?', ISSUE_CATEGORIES);
    }
    const lessons = await ask('  Lessons for the next reply (one line): ');

    recordRegret({
      draftId: d.id, threadId: d.threadId, permalink: url,
      kind: 'regret', answer,
      ...(category ? { category } : {}),
      lessons, hoursAfterPublish: Number(hours.toFixed(1)), operator: null
    });
    record('review', `regret check for ${d.id}: ${answer}`, { draftId: d.id, answer, category });
    say.ok('Recorded.');
    asked++;
  }

  if (!asked) say.step('Nothing due right now.');
  say.step('Evidence log: `redbot report` → reports/evidence-log.md');
  return 0;
}
