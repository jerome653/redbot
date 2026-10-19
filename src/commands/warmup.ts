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
 * every other public statement stops at. `redbot auto` (src/commands/auto.ts warmupStep) calls
 * `warmupDraft` and hands the saved id to the same unattended publish path the contribution draft
 * takes, so pacing, gates, health and the publish bar decide — never this file.
 *
 * ## Why warming is not the contribution pipeline
 *
 * The contribution pipeline exists to add something nobody else has said, and it is heavy —
 * gap analysis, opportunity scoring, certification. Warming's job is the opposite: be ordinary.
 * A short, useful, unremarkable comment that makes the account read like a person who reads
 * this subreddit. Running the contribution pipeline for that would be both slower and wrong:
 * it optimises for novelty, and novelty is not what earns a new account its first karma.
 */
import { loadThreads, loadDrafts, saveDraft, loadHistory, loadAccountPersona } from '../store.js';
import { currentAgeHours } from '../select.js';
import { complete, extractJson } from '../llm.js';
import { warmupPrompt } from '../prompts.js';
import { bannedPhraseHits } from '../persona.js';
import { lintDraft } from '../disclosure.js';
import { config, selectedAccount } from '../config.js';
import { policy } from '../policy.js';
import { record, say } from '../log.js';
import {
  isWarmingTarget, checkWarmingPace, checkWarmingComment, WARMUP_DRAFT_PREFIX
} from '../warming.js';
import { KARMA_FLOOR_SUBS } from '../autopublish.js';
import { counters } from '../health.js';
import { assessQuality } from '../quality.js';
import type { Draft, Thread } from '../types.js';
import { NOTHING_TO_DO, FAILED } from '../exit-codes.js';

/** Model calls per warmup: the draft plus one rewrite after a warming-rule refusal. */
export const WARMUP_ATTEMPTS = 2;

/**
 * The warming rules plus the publish gate's `quality:generic` check, applied to the draft
 * before it is saved. Production 2026-10-19 06:15 UTC: w_68a2223c4c54 passed the warming rules,
 * spent a certification run, and was then refused at publish as generic (no overlapping terms
 * with its thread). Checking it here gets that refusal into the one rewrite instead.
 */
export function warmupDraftCheck(body: string, thread: Pick<Thread, 'title' | 'body' | 'comments'>): ReturnType<typeof checkWarmingComment> {
  const warm = checkWarmingComment(body);
  const generic = assessQuality(body, { thread }).issues.find((i) => i.code === 'generic');
  if (!generic) return warm;
  return { ...warm, ok: false, issues: [...warm.issues, { rule: 'generic', detail: `${generic.message}; name something specific from the post` }] };
}

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

/**
 * The threads worth a warming comment, youngest first.
 *
 * Under the karma floor the KARMA_FLOOR_SUBS (r/wordpress) are skipped: a karma-1 comment there is
 * filtered by the subreddit, and the unattended publish refuses it anyway (src/autopublish.ts
 * redditPlacement) — so drafting one spends a model call on a comment that cannot be seen.
 */
export function warmingCandidates(
  threads: Thread[], drafted: ReadonlySet<string>, now: number, karma: number | null
): Array<{ t: Thread; age: number | null; verdict: { ok: boolean; why: string } }> {
  const underFloor = !(typeof karma === 'number' && karma >= policy.cautionKarmaBelow.value);
  return threads
    .filter((t) => !drafted.has(t.id))
    .filter((t) => !(underFloor && KARMA_FLOOR_SUBS.has(t.subreddit.toLowerCase())))
    .map((t) => ({ t, age: currentAgeHours(t, now), verdict: isWarmingTarget({
      ageHours: currentAgeHours(t, now),
      commentCount: t.commentCount,
      subreddit: t.subreddit,
      title: t.title
    }) }))
    .filter((r) => r.verdict.ok)
    // youngest first: the whole point is being read before the thread is buried
    .sort((a, b) => (a.age ?? 1e9) - (b.age ?? 1e9));
}

/** What one warmup run did: the CLI's exit code, and the draft it saved (null when none). */
export interface WarmupResult { code: number; draftId: string | null; reason: string }

/** `redbot warmup`. The exit code is unchanged; the work is in warmupDraft. */
export async function warmup(opts?: { dry?: boolean }): Promise<number> {
  return (await warmupDraft(opts)).code;
}

export async function warmupDraft(opts?: { dry?: boolean }): Promise<WarmupResult> {
  say.head('redbot warmup');
  const done = (code: number, reason: string, draftId: string | null = null): WarmupResult => ({ code, draftId, reason });

  const account = selectedAccount();
  if (!account) {
    say.fail('No account selected. Warming is per-account — set REDBOT_ACCOUNT.');
    return done(FAILED, 'no account selected');
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
    /* And now the exit code agrees with that sentence, which it did not for the pace's whole life. */
    return done(NOTHING_TO_DO, `pace: ${pace.issues.map((i) => i.rule).join(', ')}`);
  }

  /* ---------- 2. which threads are worth a comment ---------- */
  const drafted = new Set((await loadDrafts()).map((d) => d.threadId));
  const candidates = warmingCandidates(await loadThreads(), drafted, Date.now(), c.karma);

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
    /* A corpus with nothing young enough is nothing to do, not a fault in warming. */
    return done(NOTHING_TO_DO, 'no thread inside the warming window');
  }

  const pick = candidates[0]!;
  const thread: Thread = pick.t;
  say.step(`Thread  : ${thread.title.slice(0, 66)}`);
  say.step(`          ${pick.verdict.why}`);

  /* ---------- 3. write something ordinary and useful ---------- */
  /**
   * The same persona the contribution path uses, for the same reason: warming is where an account
   * builds the voice it will later be recognised by, so drafting its first comments from the one
   * shared prompt is where a fleet-wide fingerprint is actually laid down. `account` is already
   * resolved above. Null leaves `warmupPrompt` byte-identical — see src/persona.ts.
   */
  const persona = await loadAccountPersona(account?.handle);
  say.step(
    persona
      ? `Voice   : ${persona.handle}${persona.register ? ` · ${persona.register}` : ''}`
        + `${persona.maxSentences !== null ? ` · max ${persona.maxSentences} sentence(s)` : ''}`
      : 'Voice   : none — no persona for this account'
  );
  /**
   * TWO ATTEMPTS. A first draft the warming rules refuse is rewritten once, with the refusal
   * quoted back, before the thread is given up: the cheap local check (outcome-claim above all,
   * measured 2026-10-19) is what keeps a doomed comment from costing a certification run, and a
   * second model call is cheaper than that run. Never a third.
   */
  let feedback = '';
  let body = '';
  let warm = checkWarmingComment('');
  for (let attempt = 1; attempt <= WARMUP_ATTEMPTS; attempt++) {
    say.step(`Writing with ${config.llm.draftModel}…${attempt > 1 ? ` (rewrite ${attempt}/${WARMUP_ATTEMPTS})` : ''}`);
    let raw: string;
    try {
      raw = await complete({
        prompt: warmupPrompt(thread, persona) + feedback,
        model: config.llm.draftModel,
        maxTokens: 700,
        temperature: 0.6
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      say.fail(msg);
      await record('error', `warmup draft failed for ${thread.id}: ${msg}`);
      return done(1, `model call failed: ${msg}`);
    }

    let parsed: RawWarm;
    try {
      parsed = extractJson<RawWarm>(raw);
    } catch {
      say.fail('The model did not return the required JSON. Nothing saved.');
      return done(1, 'model returned no JSON');
    }

    /**
     * Declining is a correct outcome and is recorded as one. A warming comment on a thread the
     * model has nothing useful to say about is worse than no comment — it is the filler that
     * makes an account look like a bot.
     */
    if (parsed.decline === true || !str(parsed.comment)) {
      say.ok('Declined — nothing genuinely useful to add here.');
      say.step(str(parsed.why) || '(no reason given)');
      await record('draft.declined', `warmup declined for ${thread.id}`, { threadId: thread.id, account: account.handle, warming: true });
      return done(0, 'declined — nothing useful to add');
    }

    body = str(parsed.comment);
    warm = warmupDraftCheck(body, thread);
    if (warm.ok || attempt === WARMUP_ATTEMPTS) break;
    for (const i of warm.issues) say.warn(`  [${i.rule}] ${i.detail} — rewriting`);
    feedback = `\n\nYOUR PREVIOUS DRAFT WAS REFUSED:\n"${body}"\n` +
      warm.issues.map((i) => `- ${i.rule}: ${i.detail}`).join('\n') +
      `\nWrite it again: one clarifying question, optionally after one "I'd check X first." line.`;
  }

  /* ---------- 4. the warming rules, actually applied ---------- */
  const lint = lintDraft(body);

  say.info('\n--- draft ---\n');
  say.info(body);
  say.info('\n-------------\n');
  for (const w of warm.warnings) say.warn(w);

  if (!warm.ok) {
    for (const i of warm.issues) say.fail(`  [${i.rule}] ${i.detail}`);
    say.step('Refused by the warming rules. Nothing was saved.');
    await record('gate.block', `warmup refused for ${thread.id}`, {
      threadId: thread.id, account: account.handle, rules: warm.issues.map((i) => i.rule), warming: true
    });
    return done(1, `warming rules: ${warm.issues.map((i) => i.rule).join(', ')}`);
  }
  /**
   * This account's own banned phrases, checked rather than requested.
   *
   * `personaBlock` states the list in the prompt; a prompt is a request and this is the fact —
   * the same split `checkWarmingComment` exists for. Its own refusal rather than a warming issue,
   * because a `WarmingIssue` is a statement about warming policy and this is a statement about
   * one account's voice; folding them together would make `warming.ts` depend on the persona
   * tables to answer a question that has nothing to do with karma.
   */
  const banned = bannedPhraseHits(body, persona);
  if (banned.length) {
    for (const phrase of banned) say.fail(`  [persona] ${account.handle} never writes "${phrase}"`);
    say.step('Refused by this account\'s own phrase list. Nothing was saved.');
    await record('gate.block', `warmup refused for ${thread.id}`, {
      threadId: thread.id, account: account.handle,
      rules: ['persona:banned-phrase'], phrases: banned, warming: true
    });
    return done(1, 'persona banned phrase');
  }
  if (!lint.ok) {
    for (const i of lint.issues) say.fail(`  [linter] ${i}`);
    say.step('Refused by the safety linter. Nothing was saved.');
    return done(1, `linter: ${lint.issues.join('; ')}`);
  }

  if (opts?.dry) {
    say.ok('Dry run — passed every warming rule. Not saved.');
    return done(0, 'dry run — not saved');
  }

  /* ---------- 5. save it, owned by this account ---------- */
  const saved: Draft = {
    id: `${WARMUP_DRAFT_PREFIX}${thread.id}_${Date.now().toString(36)}`,
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
  /* Awaited: it was not, and `redbot auto` reads the draft back the moment this returns. */
  await saveDraft(saved);

  say.ok(`Saved ${saved.id} — passed every stage-1 warming rule.`);
  say.step('Publishing is still a person: approve it in the console, or `redbot reply ' + saved.id + '`.');
  await record('draft', `warmup drafted for "${thread.title.slice(0, 50)}"`, {
    draftId: saved.id, threadId: thread.id, account: account.handle, warming: true
  });
  return done(0, 'saved', saved.id);
}
