/**
 * `redbot session [--kind short|medium] [--sub <name>]`
 *
 * Part A's driver: one browsing session, shaped by the behaviour engine.
 *
 * It reads. It never writes. A session may end having found something worth replying to, in
 * which case it says so and stops — the reply is a separate command, run by a person, with
 * every gate in front of it.
 *
 * The plan is fixed before anything is read, including whether this session is even allowed
 * to end in a reply. That ordering is the point: the decision cannot be talked into existence
 * by a thread that looks too good to pass up.
 */
import { attach, isBrowserUp, whoAmI, isBlocked, isRateLimited, NoBrowserError } from '../browser.js';
import { openSubreddit, collectPermalinks, collectThread } from '../reddit/scrape.js';
import { sel } from '../reddit/selectors.js';
import { planSession, viewThread, nextMove, humanPause, type SessionKind, type NavState } from '../behavior.js';
import { makeRng, sessionSeed, pick } from '../rand.js';
import { health } from '../health.js';
import { saveThreads } from '../store.js';
import { config } from '../config.js';
import { record, say, setAccount } from '../log.js';
import type { Thread } from '../types.js';

export async function session(opts?: { kind?: string; sub?: string }): Promise<number> {
  const kind: SessionKind = opts?.kind === 'medium' ? 'medium' : opts?.kind === 'short' ? 'short' : 'short';
  const subreddit = (opts?.sub ?? 'wordpress').replace(/^\/?r\//i, '');

  const rng = makeRng(sessionSeed());
  const plan = planSession(kind, rng);

  say.head(`redbot session — ${plan.kind}`);
  say.step(`Budget : ${Math.round(plan.budgetMs / 60_000)} min · up to ${plan.maxThreadsToOpen} threads`);
  say.step(`Replying allowed this session: ${plan.mayReply ? 'yes' : 'no (decided before reading)'}`);
  say.step(`Seed   : ${plan.seed}   (REDBOT_SEED=${plan.seed} replays these timings)`);

  if (!(await isBrowserUp())) {
    say.fail(new NoBrowserError(config.browser.cdpEndpoint).message);
    return 1;
  }

  const s = await attach();
  const started = Date.now();
  const collected: Thread[] = [];
  let opened = 0;
  let abandoned = 0;
  let completed = true;

  await record('session.start', `${plan.kind} session on r/${subreddit}`, {
    kind: plan.kind, seed: plan.seed, budgetMs: plan.budgetMs,
    maxThreads: plan.maxThreadsToOpen, mayReply: plan.mayReply, subreddit
  });

  try {
    const me = await (async () => {
      await s.page.goto(config.redditBase, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      return whoAmI(s.page);
    })();
    setAccount(me.username);
    say.step(`Account: ${me.username ?? '(signed out)'}`);

    const verdict = await health(me.username);
    say.step(`Health : ${verdict.state}`);
    for (const r of verdict.reasons.slice(0, 3)) say.step(`         ${r}`);

    await openSubreddit(s.page, subreddit);
    if (await isRateLimited(s.page)) {
      await record('ratelimit', `429 opening r/${subreddit}`);
      say.fail('Rate-limited on arrival. Ending the session rather than pushing.');
      return 1;
    }
    if (await isBlocked(s.page)) {
      await record('login.fail', `block page opening r/${subreddit}`);
      say.fail('Reddit served a block page. Ending the session.');
      return 1;
    }

    const links = await collectPermalinks(s.page, plan.maxThreadsToOpen * 2, sel.feedScope);
    if (!links.length) {
      await record('selector.miss', `no post links found on r/${subreddit}`, { selectors: 'sel.postLink' });
      say.fail('No post links found — Reddit markup may have changed. Recorded as a selector miss.');
      return 1;
    }
    say.step(`Feed   : ${links.length} posts visible`);

    const unseen = [...links];

    for (;;) {
      const state: NavState = {
        elapsedMs: Date.now() - started,
        budgetMs: plan.budgetMs,
        threadsOpened: opened,
        maxThreads: plan.maxThreadsToOpen,
        hasCandidate: collected.length > 0
      };
      const move = nextMove(rng, state);

      if (move === 'end-session') break;

      if (move === 'idle') {
        say.step('  … idle');
        await humanPause(rng, 9000);
        continue;
      }

      if (move === 'back-to-feed') {
        say.step('  ← back to the feed');
        await openSubreddit(s.page, subreddit);
        await humanPause(rng);
        continue;
      }

      // 'open-thread' and 'open-another-first' both open something; the second exists so the
      // session does not always go straight from "found a good one" to acting on it.
      if (!unseen.length) break;
      const link = pick(rng, unseen);
      unseen.splice(unseen.indexOf(link), 1);

      let thread: Thread | null = null;
      try {
        thread = await collectThread(s.page, link, 'read');
      } catch (e) {
        await record('error', `thread fetch failed: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
      }
      opened++;

      if (!thread) {
        say.step(`  [${opened}] skipped — nothing readable at that link`);
        continue;
      }

      const view = await viewThread(s.page, thread, rng);
      if (view.abandoned) abandoned++;

      say.step(
        `  [${opened}] ${thread.title.slice(0, 60)} — ${Math.round(view.dwellMs / 1000)}s` +
        `${view.idled ? ', idled' : ''}${view.abandoned ? ', left early' : ''}`
      );

      await record('session.view', `viewed ${thread.id}`, {
        threadId: thread.id, dwellMs: view.dwellMs, steps: view.steps,
        idled: view.idled, abandoned: view.abandoned
      });

      if (!view.abandoned) collected.push(thread);
      await humanPause(rng);
    }

    const added = await saveThreads(collected);
    const elapsed = Date.now() - started;

    say.ok(
      `Session over — ${Math.round(elapsed / 60_000)} min, ${opened} threads opened, ` +
      `${abandoned} left early, ${collected.length} kept (${added} new)`
    );

    if (plan.mayReply && collected.length) {
      say.step('This session was allowed to end in a reply. Next: `redbot analyze`, then `redbot select`.');
    } else if (!plan.mayReply) {
      say.step('This session was read-only by plan. Nothing further to do.');
    }

    return 0;
  } catch (e) {
    completed = false;
    const msg = e instanceof Error ? e.message : String(e);
    say.fail(msg);
    await record('error', `session failed: ${msg}`);
    return 1;
  } finally {
    await record('session.end', `session ended after ${Math.round((Date.now() - started) / 1000)}s`, {
      completed, opened, abandoned, kept: collected.length, seed: plan.seed
    });
    await s.close();
  }
}
