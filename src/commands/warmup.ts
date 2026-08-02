/**
 * `redbot warmup` — the account lifeline, actually wired.
 *
 * `src/warming.ts` held the stage-1 rules and nothing called them. The rules had tests, the
 * tests passed, and the module was reported as "enforced mechanically" — which was true of the
 * unit in isolation and false of the system. This is the caller that makes it true.
 *
 * ## Recovered from `main`, 2026-08-03
 *
 * This file existed only on `main` and was never merged into the desktop line. The 2026-07-31
 * audit read that as "desktop deletes it"; it did not — the desktop branch forked before the
 * commit and simply never received it, which is a different fact with a different consequence.
 * Nothing had deliberately dropped a working feature; the release line had just never seen it.
 *
 * What the desktop line DOES have is the enforcement half: `evaluateGates` refuses a comment
 * that breaks a warming rule. It had no way to WRITE one. Keeping only the half that says no
 * left every warming comment to be composed by hand, which is the work this command exists to
 * take on — and the accounts are new, so it is the work that actually matters right now.
 *
 * ## Why the awaits look newer than the rest of this file
 *
 * It was written when the store was synchronous JSON. `src/store.ts` moved the domain into the
 * database, so `loadHistory`, `loadDrafts`, `loadThreads` and `counters` all return promises
 * now. Five call sites gained `await` and `minutesSinceLastPublish` became async; nothing else
 * about the logic changed. Left unported it compiled into `Promise<HistoryEntry[]>.filter is not
 * a function` — the shape that would have shipped a command that could never run.
 *
 * ## What it does
 *
 *   1. picks threads that are worth commenting on   — `isWarmingTarget`
 *   2. checks the account is allowed to act now     — `checkWarmingPace`
 *   3. writes a short, ordinary, helpful comment    — `warmupPrompt`
 *   4. refuses it if it breaks a warming rule       — `checkWarmingComment`
 *   5. saves it as a draft owned by this account
 *
 * It does **not** publish. A warming comment is public content, so it stops at the same gate
 * every other public statement stops at.
 *
 * ## Why warming is not the contribution pipeline
 *
 * The contribution pipeline exists to add something nobody else has said, and it is heavy —
 * gap analysis, opportunity scoring, certification. Warming's job is the opposite: be ordinary.
 * A short, useful, unremarkable comment that makes the account read like a person who reads
 * this subreddit. Running the contribution pipeline for that would be both slower and wrong:
 * it optimises for novelty, and novelty is not what earns a new account its first karma.
 */
import { loadThreads, loadDrafts, saveDraft, loadHistory } from '../store.js';
import { currentAgeHours } from '../select.js';
import { complete, extractJson } from '../llm.js';
import { warmupPrompt } from '../prompts.js';
import { lintDraft } from '../disclosure.js';
import { config, selectedAccount } from '../config.js';
import { policy } from '../policy.js';
import { record, say } from '../log.js';
import {
  isWarmingTarget, checkWarmingPace, checkWarmingComment
} from '../warming.js';
import { counters } from '../health.js';
import type { Draft, Thread } from '../types.js';

interface RawWarm { comment?: unknown; why?: unknown; decline?: unknown }
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Minutes since this account last published anything, from the history log.
 *
 * Read from `publish.ok` rows rather than from drafts: a draft that was written and never sent
 * is not activity Reddit saw, and pacing is about what Reddit saw.
 */
async function minutesSinceLastPublish(account: string): Promise<number | null> {
  const rows = (await loadHistory())
    .filter((h) => h.kind === 'publish.ok' && (h.account ?? '') === account)
    .map((h) => Date.parse(h.ts))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a);
  const last = rows[0];
  return last === undefined ? null : (Date.now() - last) / 60_000;
}

export async function warmup(opts?: { dry?: boolean }): Promise<number> {
  say.head('redbot warmup');

  const account = selectedAccount();
  if (!account) {
    say.fail('No account selected. Warming is per-account — set REDBOT_ACCOUNT.');
    return 1;
  }

  /* ---------- 1. may this account act at all right now? ---------- */
  const c = await counters(account.handle, new Date(), undefined, account.timezone);
  const pace = checkWarmingPace({
    publishedToday: c.repliesToday,
    minutesSinceLast: await minutesSinceLastPublish(account.handle),
    karma: c.karma
  });

  say.step(`Account : ${account.handle} · karma ${c.karma ?? 'never measured'} · ${c.repliesToday} published today`);
  for (const w of pace.warnings) say.warn(w);
  if (!pace.ok) {
    for (const i of pace.issues) say.fail(`  [${i.rule}] ${i.detail}`);
    say.step('Nothing was drafted. Warming is a marathon — this is the pace holding, not a failure.');
    return 1;
  }

  /* ---------- 2. which threads are worth a comment ---------- */
  const drafted = new Set((await loadDrafts()).map((d) => d.threadId));
  const now = Date.now();
  const candidates = (await loadThreads())
    .filter((t) => !drafted.has(t.id))
    .map((t) => ({ t, age: currentAgeHours(t, now), verdict: isWarmingTarget({
      ageHours: currentAgeHours(t, now),
      commentCount: t.commentCount,
      subreddit: t.subreddit,
      title: t.title
    }) }))
    .filter((r) => r.verdict.ok)
    // youngest first: the whole point is being read before the thread is buried
    .sort((a, b) => (a.age ?? 1e9) - (b.age ?? 1e9));

  say.step(`Targets : ${candidates.length} thread(s) inside the warming window`);
  if (!candidates.length) {
    /**
     * The numbers come from `policy`, because they used to be typed into this sentence.
     *
     * `isWarmingTarget` was hardcoded to 2h until c3998c7 moved it to
     * `policy.warmingMaxThreadAgeHours` — measured at 8h, because r/WordPress `/new`'s youngest
     * post was 6.1h old and a 2h ceiling matched nothing on any run. That commit fixed the RULE
     * and left this MESSAGE saying 2h, so the only place an operator reads the limit reported a
     * number the code had stopped enforcing. Someone acting on it would collect inside 2h to
     * satisfy a ceiling that is 8, and conclude warming is broken when it is working.
     *
     * A limit quoted in prose beside a limit held in code is two sources for one fact. There is
     * one now.
     */
    const maxAge = policy.warmingMaxThreadAgeHours.value;
    const maxAnswers = policy.warmingMaxAnswers.value;
    say.warn(`No thread is young enough with few enough answers. Collect again closer to the hour —`);
    say.warn(`warming needs threads under ${maxAge}h with at most ${maxAnswers} answers, and a batch collected hours ago has none left.`);
    return 1;
  }

  const pick = candidates[0]!;
  const thread: Thread = pick.t;
  say.step(`Thread  : ${thread.title.slice(0, 66)}`);
  say.step(`          ${pick.verdict.why}`);

  /* ---------- 3. write something ordinary and useful ---------- */
  say.step(`Writing with ${config.llm.draftModel}…`);
  let raw: string;
  try {
    raw = await complete({
      prompt: warmupPrompt(thread),
      model: config.llm.draftModel,
      maxTokens: 700,
      temperature: 0.6
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    say.fail(msg);
    record('error', `warmup draft failed for ${thread.id}: ${msg}`);
    return 1;
  }

  let parsed: RawWarm;
  try {
    parsed = extractJson<RawWarm>(raw);
  } catch {
    say.fail('The model did not return the required JSON. Nothing saved.');
    return 1;
  }

  /**
   * Declining is a correct outcome and is recorded as one. A warming comment on a thread the
   * model has nothing useful to say about is worse than no comment — it is the filler that
   * makes an account look like a bot.
   */
  if (parsed.decline === true || !str(parsed.comment)) {
    say.ok('Declined — nothing genuinely useful to add here.');
    say.step(str(parsed.why) || '(no reason given)');
    record('draft.declined', `warmup declined for ${thread.id}`, { threadId: thread.id, account: account.handle });
    return 0;
  }

  const body = str(parsed.comment);

  /* ---------- 4. the warming rules, actually applied ---------- */
  const warm = checkWarmingComment(body);
  const lint = lintDraft(body);

  say.info('\n--- draft ---\n');
  say.info(body);
  say.info('\n-------------\n');
  for (const w of warm.warnings) say.warn(w);

  if (!warm.ok) {
    for (const i of warm.issues) say.fail(`  [${i.rule}] ${i.detail}`);
    say.step('Refused by the warming rules. Nothing was saved.');
    record('gate.block', `warmup refused for ${thread.id}`, {
      threadId: thread.id, account: account.handle, rules: warm.issues.map((i) => i.rule)
    });
    return 1;
  }
  if (!lint.ok) {
    for (const i of lint.issues) say.fail(`  [linter] ${i}`);
    say.step('Refused by the safety linter. Nothing was saved.');
    return 1;
  }

  if (opts?.dry) {
    say.ok('Dry run — passed every warming rule. Not saved.');
    return 0;
  }

  /* ---------- 5. save it, owned by this account ---------- */
  const saved: Draft = {
    id: `w_${thread.id}_${Date.now().toString(36)}`,
    threadId: thread.id,
    permalink: thread.permalink,
    title: thread.title,
    body,
    hasDisclosure: lint.hasDisclosure,
    lintIssues: lint.issues,
    createdAt: new Date().toISOString(),
    model: config.llm.draftModel,
    account: account.handle,
    status: 'pending'
  };
  saveDraft(saved);

  say.ok(`Saved ${saved.id} — passed every stage-1 warming rule.`);
  say.step('Publishing is still a person: approve it in the console, or `redbot reply ' + saved.id + '`.');
  record('draft', `warmup drafted for "${thread.title.slice(0, 50)}"`, {
    draftId: saved.id, threadId: thread.id, account: account.handle, warming: true
  });
  return 0;
}
