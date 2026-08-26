/**
 * `redbot post <subreddit> --title "..." [--body "..."]` — create a post.
 *
 * ---------------------------------------------------------------------------
 * THE SECOND WRITE PATH, AND THE MORE CONSEQUENTIAL ONE.
 *
 * A reply is one voice inside somebody else's thread. A post is a thing redbot puts at the top of
 * a subreddit under this account's name, where the whole room sees it and moderators judge it. So
 * this command is deliberately NOT lighter than `reply`:
 *
 *   - identity is established on the live page first, and a mismatch stops it. Publishing as the
 *     wrong account is the one failure a person cannot consent to on someone else's behalf;
 *   - account health and the warming rules are consulted and REPORTED. A new account posting a
 *     thread is the single loudest signal in ACCOUNT-WARMING.md, and it is surfaced in full
 *     before anyone is asked;
 *   - nothing is sent without a typed confirmation, exactly as `reply` requires;
 *   - the attempt is logged BEFORE the network call and the result after, so a
 *     submitted-with-no-result row means "unknown outcome — go look by hand", never
 *     "retry automatically". A retry on a post that landed is a duplicate somebody else has to
 *     moderate.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not draft for you. `draft` writes replies against a
 * gap a thread leaves open, which is a different job from deciding a subreddit needs a new
 * thread — and a model inventing reasons to start one is how an assistant becomes a spammer. The
 * title and body come from the person.
 *
 * It also stays in `PUBLISH_KINDS` (src/scheduler.ts), so the unattended loop will not run it.
 * ---------------------------------------------------------------------------
 */
import { attach, isBrowserUp, whoAmI, isBlocked, isRateLimited, NoBrowserError } from '../browser.js';
import { publishPost } from '../reddit/post.js';
import { lintDraft } from '../disclosure.js';
import { health } from '../health.js';
import { warmingStage, checkWarmingComment } from '../warming.js';
import { counters } from '../health.js';
import { config, selectedAccount } from '../config.js';
import { ask, takeConsoleApproval } from '../ask.js';
import { DATA } from '../config.js';
import { record, say } from '../log.js';

export interface PostOpts {
  title?: string | undefined;
  body?: string | undefined;
  /** Set by the console, which has already taken a typed SEND from a person. */
  approvalId?: string | undefined;
}

export async function post(subreddit: string | undefined, opts?: PostOpts): Promise<number> {
  say.head('redbot post');

  const sub = String(subreddit ?? '').replace(/^\/?r\//i, '').trim();
  const title = String(opts?.title ?? '').trim();
  const body = String(opts?.body ?? '').trim();

  if (!sub || !title) {
    say.fail('Usage: redbot post <subreddit> --title "<title>" [--body "<body>"]');
    say.step('A post needs a subreddit and a title. Both come from you — redbot does not invent them.');
    return 1;
  }

  const account = selectedAccount();
  if (!account) {
    say.fail('No account selected. Posting is per-account — set REDBOT_ACCOUNT.');
    return 1;
  }

  if (!(await isBrowserUp())) {
    say.fail(new NoBrowserError(config.browser.cdpEndpoint).message);
    return 1;
  }

  const s = await attach();
  try {
    /* ---------- 1. who are we, actually ---------- */
    /**
     * Identity is read on a REDDIT page, not the blank tab attach() opens.
     *
     * `whoAmI` reads Reddit's own `shreddit-app[user-logged-in]` flag from the DOM, so on
     * about:blank it can only answer "not signed in" — and this command checked it there, before
     * navigating anywhere, so it refused EVERY post on a signed-in account. `reply` never hit this
     * because it opens the thread first (reply.ts) and whoAmI runs on that page. Found in UAT
     * 2026-08-16 — the post said "Not signed in" while /api/me.json named the account. Navigate,
     * then ask; publishPost still does its own submit-page navigation afterwards.
     */
    await s.page.goto('https://www.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 })
      .catch(() => { /* a slow first paint is not a reason to refuse — whoAmI reports what it sees */ });
    const identity = await whoAmI(s.page);
    if (!identity?.loggedIn || !identity.username) {
      say.fail('Not signed in on the live page — refusing to post as an unknown account.');
      return 1;
    }
    if (identity.username.toLowerCase() !== account.handle.toLowerCase()) {
      say.fail(`The browser is signed in as ${identity.username}, but this run is acting as ${account.handle}.`);
      say.step('Refusing rather than posting under the wrong name.');
      return 1;
    }
    say.ok(`Signed in as ${identity.username}`);

    /* ---------- 2. what the rules say, reported in full ---------- */
    const c = await counters(account.handle, new Date(), undefined, account.timezone);
    const verdict = await health(account.handle);
    const stage = warmingStage({ karma: c.karma, accountAgeDays: c.accountAgeDays });

    say.step(`Account : ${account.handle} · karma ${c.karma ?? 'never measured'} · health ${verdict.state}`);
    for (const r of verdict.reasons) say.warn(`  ${r}`);

    if (stage.warming) {
      /**
       * NOT a refusal, and not silence either.
       *
       * `HARD_GATES` moved the publish decision to the person (2026-08-03), and this follows that
       * — but a warming account starting a THREAD is the loudest pattern in ACCOUNT-WARMING.md,
       * so it is stated plainly rather than folded into a list.
       */
      say.warn(`This account is still warming — ${stage.why}.`);
      say.warn('A new account starting a thread is the clearest "automated" signal there is.');
      say.warn('Comments first is the whole point of warming. Posting now is a decision, not a default.');
    }

    /* ---------- 3. the same content rules a reply gets ---------- */
    const lint = lintDraft(`${title}\n\n${body}`);
    for (const issue of lint.issues) say.fail(`  [linter] ${issue}`);
    if (stage.warming) {
      const w = checkWarmingComment(body || title);
      for (const i of w.issues) say.warn(`  [warming:${i.rule}] ${i.detail}`);
    }
    if (lint.issues.length) {
      say.fail('The safety linter objects to this post. Nothing was sent.');
      return 1;
    }

    /* ---------- 4. show it, then ask ---------- */
    say.info(`\n--- r/${sub} ---`);
    say.info(title);
    if (body) { say.info(''); say.info(body); }
    say.info('-------------\n');

    const preApproved = opts?.approvalId ? takeConsoleApproval(DATA, opts.approvalId) : null;
    if (preApproved) {
      say.ok('  Approved in the console — posting without asking again.');
    } else {
      const answer = await ask(`  Post this to r/${sub}? Type SEND to confirm: `);
      if (answer.trim() !== 'SEND') {
        say.step('Not sent. Nothing was posted and nothing was changed.');
        return 1;
      }
    }

    /* ---------- 5. send, logged either side ---------- */
    await record('publish.attempt', `posting to r/${sub}`, { subreddit: sub, title, body, kind: 'post' });
    say.step('Posting…');

    const result = await publishPost(s.page, sub, title, body);

    if (result.ok) {
      await record('publish.ok', `posted to r/${sub}`, {
        subreddit: sub, title, kind: 'post', permalink: result.postPermalink
      });
      say.ok(`Posted — ${result.postPermalink}`);
      return 0;
    }

    if (await isRateLimited(s.page)) say.warn('Reddit is rate-limiting this account.');
    if (await isBlocked(s.page)) say.warn('Reddit served a block page.');

    await record('publish.fail', `post to r/${sub} failed: ${result.error}`, {
      subreddit: sub, title, kind: 'post', error: result.error, url: result.url
    });
    say.fail(result.error ?? 'the post did not go through');
    return 1;
  } finally {
    await s.close();
  }
}
