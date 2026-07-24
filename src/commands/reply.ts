/**
 * `redbot reply [draftId] [--quick]`
 *
 * The only path to Reddit. Shows a pending draft, asks a human to approve, edit or reject it,
 * and — only on approval, and only if every gate in src/gates.ts passes — publishes it.
 *
 * Order of operations, and why:
 *
 *   1. attach, open the thread, establish identity, probe live state
 *   2. run the gates BEFORE asking anyone — nobody should be asked to approve something that
 *      cannot be published
 *   3. read the thread properly (Part A: comments are read before replying, not after)
 *   4. show the draft, the craft warnings, and the checklist a machine cannot decide
 *   5. approve / edit / reject — 'r' is the safe answer (DEFECT-08)
 *   6. re-probe the page and re-run every gate against fresh state, because the thread may
 *      have been locked, answered, or replied-to during the review
 *   7. publish, and log the attempt before the network call and the result after
 *
 * An attempt with no result means the outcome is unknown: go look by hand, never re-run.
 */
import { loadDrafts, saveDraft, loadThreads, loadAssessments } from '../store.js';
import { attach, isBrowserUp, whoAmI, isBlocked, isRateLimited, NoBrowserError } from '../browser.js';
import { probeThreadState } from '../reddit/thread-state.js';
import { appendInteraction, INTERACTION_SCHEMA_VERSION } from '../interactions.js';
import { currentAgeHours } from '../select.js';
import { autoBackup } from '../backup.js';
import { publishComment } from '../reddit/post.js';
import { lintDraft, ensureDisclosure } from '../disclosure.js';
import { evaluateGates } from '../gates.js';
import { health } from '../health.js';
import { viewThread } from '../behavior.js';
import { makeRng, sessionSeed } from '../rand.js';
import { ask, choose, takeConsoleApproval } from '../ask.js';
import {
  recordReview, retentionRatio, REJECT_REASONS, EDIT_REASONS, APPROVE_REASONS, type Decision
} from '../review.js';
import { record, say, setAccount } from '../log.js';
import { config, DATA, selectedAccount } from '../config.js';
import { checkWindow } from '../window.js';
import { counters } from '../health.js';
import type { Draft } from '../types.js';

/**
 * Capture a structured reason for a decision.
 *
 * A fixed code makes the dataset countable; the free-text note keeps the detail a code loses.
 * The codes are numbered rather than typed as words so the prompt is one keystroke — a review
 * step that is tedious stops being done, and a dataset with gaps in it is worse than none.
 */
async function askReason(
  decision: Decision,
  reasons: Record<string, string>
): Promise<{ code: string; note: string }> {
  const codes = Object.keys(reasons);
  say.info(`\n  Why ${decision}?`);
  codes.forEach((c, i) => say.info(`    ${i + 1}. ${c} — ${reasons[c]}`));

  const options = codes.map((_, i) => String(i + 1));
  // The safe answer is the last code ('other' where one exists): it records the decision
  // without asserting a reason nobody chose.
  const pickedIndex = Number(await choose('  Reason', options, options[options.length - 1]!)) - 1;
  const code = codes[pickedIndex] ?? codes[codes.length - 1]!;

  const note = await ask('  Note (optional, Enter to skip): ');
  return { code, note };
}

export async function reply(draftIdArg?: string, opts?: { quick?: boolean }): Promise<number> {
  say.head('redbot reply');

  const drafts = loadDrafts();
  const pending = drafts.filter((d) => d.status === 'pending');

  const target: Draft | undefined = draftIdArg
    ? drafts.find((d) => d.id === draftIdArg)
    : pending[pending.length - 1];

  if (!target) {
    say.warn(draftIdArg ? `No draft with id ${draftIdArg}.` : 'No pending drafts. Run `redbot draft`.');
    return 1;
  }
  if (target.status !== 'pending') {
    say.warn(`Draft ${target.id} is already "${target.status}".`);
    return 1;
  }

  const thread = loadThreads().find((t) => t.id === target.threadId);
  const assessment = loadAssessments().find((a) => a.threadId === target.threadId);

  if (!(await isBrowserUp())) {
    say.fail(new NoBrowserError(config.browser.cdpEndpoint).message);
    return 1;
  }

  const rng = makeRng(sessionSeed());
  const s = await attach();

  try {
    /* ---------- 1. identity and live state ---------- */
    say.step('Opening the thread…');
    await s.page.goto(target.permalink, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    if (await isRateLimited(s.page)) {
      record('ratelimit', `429 while opening ${target.permalink}`, { permalink: target.permalink });
      say.fail('Reddit is rate-limiting this browser right now. Stopping — nothing was posted.');
      return 1;
    }
    if (await isBlocked(s.page)) {
      record('login.fail', `block page while opening ${target.permalink}`, { permalink: target.permalink });
      say.fail('Reddit served a block page. Stopping — nothing was posted.');
      return 1;
    }

    const identity = await whoAmI(s.page);
    setAccount(identity.username);
    say.step(`Account: ${identity.username ?? '(unknown)'} — ${identity.via}`);

    const state = await probeThreadState(s.page, identity.username);
    const verdict = health(identity.username);
    say.step(`Health : ${verdict.state}${verdict.resumeAt ? ` (resumes ${verdict.resumeAt})` : ''}`);

    /**
     * The account we INTEND to act as (REDBOT_ACCOUNT), which is not the same fact as whoever
     * the browser happens to be signed in as. The identity gate compares the two — but it was
     * fed `identity.username` as the expected value, so it compared the browser against itself
     * and could never fire (evaluation, "wrong-account tautology"). config validated
     * REDBOT_ACCOUNT at load, so this does not throw here.
     */
    const intended = selectedAccount();
    const expectedAccount = intended?.handle ?? identity.username;

    /**
     * Quiet hours and the per-account daily ceiling, enforced on THIS path for the first time.
     * `checkWindow` previously had one caller — `auto` — so an interactive publish ignored both
     * (evaluation H7). Skipped when no account is selected (single-profile): there is no
     * configured window to enforce, and the global daily cap still runs via `health`.
     */
    const windowVerdict = intended
      ? checkWindow({
          account: intended,
          repliesToday: counters(intended.handle, new Date(), undefined, intended.timezone).repliesToday
        })
      : null;
    if (windowVerdict) say.step(`Window : ${windowVerdict.detail}`);

    /* ---------- 2. gates, before anyone is asked ---------- */
    const pre = evaluateGates({
      draft: target,
      thread,
      assessment,
      identity,
      expectedAccount,
      window: windowVerdict,
      health: verdict,
      threadState: state,
      allDrafts: drafts
    });

    if (!pre.allow) {
      say.fail('Refusing to publish. Gates that failed:');
      for (const b of pre.blocks) say.fail(`  [${b.gate}] ${b.reason}`);
      record('gate.block', `publish blocked for ${target.id}`, {
        draftId: target.id,
        gates: pre.blocks.map((b) => b.gate),
        blocks: pre.blocks
      });
      say.step('Nothing was posted and nothing was changed.');
      return 1;
    }

    /* ---------- 3. read the thread ---------- */
    if (thread && !opts?.quick) {
      say.step('Reading the thread and its comments before replying…');
      const view = await viewThread(s.page, thread, rng, { thorough: true });
      say.step(`  dwelt ${Math.round(view.dwellMs / 1000)}s over ${view.steps} scroll steps`);
      record('session.view', `read ${thread.id} before replying`, {
        threadId: thread.id, dwellMs: view.dwellMs, steps: view.steps, thorough: true, seed: rng.seed
      });
    } else if (opts?.quick) {
      say.warn('--quick: skipped the pre-reply read. Recorded, so the metrics do not overstate behaviour.');
      record('session.view', `SKIPPED pre-reply read for ${target.threadId} (--quick)`, {
        threadId: target.threadId, skipped: true
      });
    }

    /* ---------- 4. show it ---------- */
    say.step(`Thread : ${target.title}`);
    say.step(`Link   : ${target.permalink}`);
    say.info('\n--- draft ---\n');
    say.info(target.body);
    say.info('\n-------------\n');

    const m = pre.quality.metrics;
    say.step(
      `Craft  : ${m.words} words · ${m.sentences} sentences · specificity ${m.specificityHits} ` +
      `(${m.technicalHits} technical) · ${m.hedges} hedge(s)`
    );
    for (const w of pre.warnings) say.warn(w);

    if (target.contribution) {
      say.info('\n  The case this draft makes for itself:');
      say.info(`    why this thread : ${target.contribution.whyThread}`);
      say.info(`    what is new     : ${target.contribution.whatNew}`);
      say.info(`    why not silent  : ${target.contribution.whyNotSilent}`);
    }

    say.info('\n  The machine cannot decide these — you can:');
    for (const q of pre.quality.humanChecklist) say.info(`    - ${q}`);
    say.info('');

    /* ---------- 5. the human ---------- */
    const bodyBefore = target.body;
    const snapshot = {
      draftId: target.id,
      threadId: target.threadId,
      permalink: target.permalink,
      operator: identity.username,
      quality: pre.quality.metrics,
      gates: { allowed: pre.allow, blocked: pre.blocks.map((b) => b.gate) },
      ...(target.contribution ? { contribution: target.contribution } : {})
    };

    /**
     * The review clock. Everything the operator reads is already on screen; the next thing
     * that happens is them deciding.
     *
     * Priority 2 asks for time-to-review and nothing recorded it. Both readings are taken
     * because they answer different questions: `reviewSeconds` is how long the judgement took,
     * `totalSeconds` is how long the whole task took including typing an edit. A 20-second
     * judgement followed by a four-minute rewrite is a very different signal from a
     * four-minute judgement.
     */
    const shownAt = Date.now();
    const secondsSince = (from: number): number => Math.round((Date.now() - from) / 1000);

    /**
     * A person may have already decided, in the console. That token names this draft, is
     * minutes old at most, and is consumed on read — see takeConsoleApproval. If there is
     * no valid one, nothing changes and the interactive prompt runs exactly as before.
     */
    const preApproved = takeConsoleApproval(DATA, target.id);
    if (preApproved) {
      say.ok('  Approved in the console — publishing without asking again.');
      if (preApproved.note) say.step(`  Reason given: ${preApproved.note}`);
    }

    // 'r' is the safe answer: an unclear response must never resolve to publishing.
    const decision = preApproved ? 'a' : await choose('  Publish this reply?', ['a', 'e', 'r'], 'r');
    const reviewSeconds = secondsSince(shownAt);

    if (decision === 'r') {
      target.status = 'rejected';
      target.decidedAt = new Date().toISOString();
      saveDraft(target);

      const { code, note } = await askReason('rejected', REJECT_REASONS);
      recordReview({
        ...snapshot, decision: 'rejected', reasonCode: code, note,
        reviewSeconds, totalSeconds: secondsSince(shownAt)
      });

      say.ok('Rejected. Nothing was posted, and the reason is on the record.');
      record('reject', `rejected draft ${target.id}`, { draftId: target.id, reasonCode: code });
      record('review', `review recorded for ${target.id}`, { draftId: target.id, decision: 'rejected', reasonCode: code });
      return 0;
    }

    if (decision === 'e') {
      say.step('Paste the edited reply. Finish with a single line containing only: END');
      const lines: string[] = [];
      for (;;) {
        const line = await ask('');
        if (line.trim() === 'END') break;
        lines.push(line);
      }
      const edited = ensureDisclosure(lines.join('\n').trim());
      if (!edited) {
        say.fail('Empty edit. Aborting, nothing posted.');
        return 1;
      }
      target.body = edited;
      const relint = lintDraft(edited);
      target.lintIssues = relint.issues;
      target.hasDisclosure = relint.hasDisclosure;
      saveDraft(target);
      say.ok('Draft updated.');

      const { code, note } = await askReason('edited', EDIT_REASONS);
      recordReview({
        ...snapshot,
        decision: 'edited',
        reasonCode: code,
        note,
        reviewSeconds,
        totalSeconds: secondsSince(shownAt),
        edit: {
          charsBefore: bodyBefore.length,
          charsAfter: edited.length,
          retained: Number(retentionRatio(bodyBefore, edited).toFixed(3)),
          // `target.body` has already been overwritten above. These two are the only surviving
          // record of what the model actually generated versus what a person was willing to post.
          before: bodyBefore,
          after: edited
        }
      });
      record('review', `review recorded for ${target.id}`, { draftId: target.id, decision: 'edited', reasonCode: code });
    } else {
      /**
       * Approval reason. A console approval has ALREADY been made by a person and carries its
       * own note; asking again here calls `choose`/`ask`, which throw NoTerminalError on the
       * console's non-interactive stdin — so the whole publish died after the single-use token
       * had already been consumed, and nothing was ever posted (evaluation H1). Use the token's
       * note on that path; only prompt when a human is actually at the terminal.
       */
      const { code, note } = preApproved
        ? { code: preApproved.reasonCode ?? 'console', note: preApproved.note ?? '' }
        : await askReason('approved', APPROVE_REASONS);
      recordReview({
        ...snapshot, decision: 'approved', reasonCode: code, note,
        reviewSeconds, totalSeconds: secondsSince(shownAt)
      });
      record('review', `review recorded for ${target.id}`, { draftId: target.id, decision: 'approved', reasonCode: code });
    }

    /* ---------- 6. re-probe and re-gate against fresh state ---------- */
    say.step('Re-checking the thread before submitting…');
    await s.page.goto(target.permalink, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const identity2 = await whoAmI(s.page);
    const state2 = await probeThreadState(s.page, identity2.username);
    const verdict2 = health(identity2.username);

    const final = evaluateGates({
      draft: target,
      thread,
      assessment,
      identity: identity2,
      expectedAccount,
      window: windowVerdict,
      health: verdict2,
      threadState: state2,
      allDrafts: loadDrafts()
    });

    if (!final.allow) {
      say.fail('State changed during review — refusing to publish:');
      for (const b of final.blocks) say.fail(`  [${b.gate}] ${b.reason}`);
      record('gate.block', `publish blocked at final check for ${target.id}`, {
        draftId: target.id,
        gates: final.blocks.map((b) => b.gate),
        blocks: final.blocks,
        stage: 'final'
      });
      return 1;
    }

    /* ---------- 7. publish ---------- */
    target.status = 'approved';
    target.decidedAt = new Date().toISOString();
    saveDraft(target);
    record('approve', `approved draft ${target.id}`, { draftId: target.id });

    say.step('Publishing…');
    record('publish.attempt', `submitting to ${target.permalink}`, {
      draftId: target.id, permalink: target.permalink, body: target.body
    });

    const result = await publishComment(s.page, target.permalink, target.body);

    if (result.ok) {
      target.status = 'published';
      if (result.url) target.publishedUrl = result.url;
      if (result.commentPermalink) target.commentPermalink = result.commentPermalink;
      if (result.commentId) target.commentId = result.commentId;
      saveDraft(target);
      say.ok(`Published. ${result.commentPermalink ?? result.url ?? ''}`);
      if (!result.commentPermalink) {
        say.warn('Reddit did not expose a comment permalink on the node — checkpoints will match on text instead.');
      }
      record('publish.ok', `published ${target.id}`, {
        draftId: target.id, url: result.url, commentPermalink: result.commentPermalink, commentId: result.commentId
      });

      /**
       * The publish row of the immutable interaction record.
       *
       * `state2` was probed immediately before the submit click, so its score and comment count
       * are thread-state-at-publish — unrecoverable the moment the reply lands and the counts
       * move. Written AFTER the publish succeeded and wrapped, because a logging failure must
       * never turn a published reply into a reported failure.
       */
      try {
        appendInteraction({
          schemaVersion: INTERACTION_SCHEMA_VERSION,
          ts: new Date().toISOString(),
          kind: 'publish',
          draftId: target.id,
          threadId: target.threadId,
          permalink: target.permalink,
          commentPermalink: result.commentPermalink ?? null,
          commentId: result.commentId ?? null,
          account: identity.username,
          checkpoint: null,
          elapsedMinutes: 0,
          vector: 'publish',
          thread: {
            locked: state2.locked,
            archived: state2.archived,
            postScore: state2.postScore,
            commentCount: state2.commentCount,
            ageHours: thread ? currentAgeHours(thread) : null
          },
          self: null,          // our comment has not been re-read yet; the immediate checkpoint does that
          replies: [],
          note: 'thread state as probed immediately before the submit click'
        });
      } catch (e) {
        say.warn(`interaction record not written: ${e instanceof Error ? e.message : String(e)}`);
      }

      /**
       * EB-28 / D-04. A published reply is the least recreatable evidence this project will
       * ever hold — it exists once, on Reddit, and the local record of it exists in one
       * directory. Snapshot immediately. Never fatal.
       */
      const backup = autoBackup();
      if (!backup.ok) say.warn(`evidence backup skipped — ${backup.detail}`);
      say.step('Next: `redbot observe` now, then at 1h, 24h and 7d.');
      return 0;
    }

    target.status = 'failed';
    saveDraft(target);
    say.fail(`Publish failed: ${result.error}`);
    say.warn('If you are unsure whether it landed, open the thread and check by hand before retrying.');
    record('publish.fail', `failed ${target.id}: ${result.error}`, {
      draftId: target.id, error: result.error
    });
    return 1;
  } finally {
    await s.close();
  }
}
