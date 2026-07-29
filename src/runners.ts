/**
 * Job runners — the bridge from a job row to the code that already does the work.
 *
 * Every runner here is a thin adapter. `read`, `search`, `opportunity`, `draft` and `certify`
 * call the exact command functions the CLI calls, so a job and a typed command produce the same
 * result through the same code path. Nothing about collection, scoring, drafting or
 * certification is reimplemented, and there is no second version of any rule to drift.
 *
 * The browser-driving runners (`vote`, `save`, `follow`, `post`, `reply-comment`) call
 * `reddit/actions.ts` and own two things the action functions deliberately do not: attaching to
 * the right browser, and the account-level rules that need to know about the *other* accounts.
 *
 * `publish` has no runner and must not get one. `scheduler.ts` refuses publish kinds before it
 * looks a runner up.
 */
import { attach, isBrowserUp, NoBrowserError } from './browser.js';
import { config, loadAccounts } from './config.js';
import { loadThreads } from './store.js';
import { record } from './log.js';
import { registerRunner } from './scheduler.js';
import { act } from './confirm.js';
import { read } from './commands/read.js';
import { search } from './commands/search.js';
import { opportunity } from './commands/opportunity.js';
import { draft } from './commands/draft.js';
import { certifyCmd } from './commands/certify.js';
import {
  votePost, setSaved, setFollowing, submitPost, replyToComment,
  type ActionResult, type VoteDirection
} from './reddit/actions.js';
import type { Job } from './jobs.js';

const arg = (job: Job, key: string): string => String(job.args?.[key] ?? '').trim();

/** A non-zero exit from a command is a failed job; the scheduler turns a throw into that. */
function assertExit(code: number, what: string): void {
  if (code !== 0) throw new Error(`${what} exited ${code}`);
}

/**
 * Run one browser action against this job's account.
 *
 * The session is opened and closed per job rather than held across the queue. A long-lived
 * attachment survives the account being switched underneath it, and then acts as the wrong
 * person — the failure mode the identity gate exists to catch at publish time, happening
 * silently somewhere with no gate.
 */
async function withPage(job: Job, fn: (page: import('playwright').Page) => Promise<ActionResult>): Promise<void> {
  if (!(await isBrowserUp())) throw new NoBrowserError(config.browser.cdpEndpoint);
  const session = await attach();
  try {
    /**
     * Every browser action goes through the confirmation contract — perform, confirm, audit,
     * record — and none of them reports success on the strength of having been attempted.
     *
     * Enforced here rather than inside each action so a capability added later inherits it by
     * default. On 2026-07-27 three separate actions returned success for something that had
     * not happened, and every one of them was individually plausible; the fix that holds is
     * structural, not another careful reading of each call site.
     *
     * The action functions do their own post-action read and report `confirmed`. This layer
     * decides what that is worth: `confirmed !== true` fails the job, which surfaces in the
     * queue as a failure with the reason rather than as a green row that quietly did nothing.
     */
    await act({
      action: `${job.kind}${job.args?.direction ? `:${String(job.args.direction)}` : ''}`,
      account: job.account,
      jobId: job.id,
      perform: () => fn(session.page),
      confirm: async (result) => {
        if (!result.ok) {
          return {
            confirmed: false,
            source: 'reloaded' as const,
            observed: result.error ?? 'the action failed without saying why',
            visibility: 'unknown' as const
          };
        }
        /**
         * `confirmed: undefined` means the action could not tell — which is NOT the same as
         * "it worked", and is treated as unconfirmed. That asymmetry is deliberate: the cost
         * of a false failure is a retry, the cost of a false success is believing redbot acted
         * when it did not.
         */
        return {
          confirmed: result.confirmed === true,
          source: 'reloaded' as const,
          observed: result.confirmed === true
            ? `${job.kind} still in effect when the page was read again`
            : `${job.kind} could not be confirmed from an independent read${result.error ? ` — ${result.error}` : ''}`,
          ...(result.permalink ? { permalink: result.permalink } : {}),
          // Only a third-party read can establish this, and nothing here does one.
          visibility: 'unknown' as const
        };
      }
    });

    await record('job.action', `${job.kind} for ${job.account}`, {
      account: job.account,
      jobId: job.id,
      kind: job.kind,
      confirmed: true
    });
  } finally {
    await session.close();
  }
}

/**
 * Refuse to vote on anything an account we control wrote.
 *
 * `accounts.json` states the rule — "two accounts never reply to each other, and never vote on
 * each other" — and until now it was a sentence in a config file that nothing enforced. Vote
 * rings are the single clearest way to lose every account at once, and the check is cheap: the
 * thread is already on record with its author.
 *
 * Fails closed on a thread we have no record of. A vote on an unknown target cannot be shown to
 * be safe, and the cost of skipping one vote is nothing.
 */
export async function voteTargetIsOurs(permalink: string): Promise<{ blocked: boolean; why?: string }> {
  const ours = new Set(loadAccounts().map((a) => a.handle.toLowerCase()));
  const thread = (await loadThreads()).find((t) => t.permalink === permalink);
  if (!thread) {
    return { blocked: true, why: `no thread on record for ${permalink} — cannot establish who wrote it` };
  }
  const author = (thread.author ?? '').toLowerCase();
  if (author && ours.has(author)) {
    return { blocked: true, why: `${thread.author} is one of our own accounts — voting on it is vote manipulation` };
  }
  return { blocked: false };
}

let registered = false;

/** Idempotent: the CLI and the workstation both call it, and both may run in one process. */
export function registerAllRunners(): void {
  if (registered) return;
  registered = true;

  /* ---- pipeline stages: the CLI's own implementations, unchanged ---- */

  registerRunner('read', async (job) => {
    const sub = arg(job, 'subreddit');
    if (!sub) throw new Error('a read job needs a subreddit');
    assertExit(await read(sub), `read r/${sub}`);
  });

  registerRunner('search', async (job) => {
    const q = arg(job, 'query');
    if (!q) throw new Error('a search job needs a query');
    // `commit` mirrors the search command's preview→commit split: a job that collects must say
    // so, because a preview and a collection are different events in the health metrics. The
    // signature is (query, limit, commitSpec) — the commit spec is the third argument, and
    // passing it as the second would silently turn a collection into a preview with a limit.
    const commit = arg(job, 'commit');
    assertExit(await search(q, undefined, commit || undefined), `search "${q}"`);
  });

  registerRunner('opportunity', async () => {
    assertExit(await opportunity(), 'opportunity');
  });

  registerRunner('draft', async (job) => {
    assertExit(await draft(arg(job, 'threadId') || undefined), 'draft');
  });

  registerRunner('certify', async (job) => {
    const id = arg(job, 'draftId');
    if (!id) throw new Error('a certify job needs a draftId');
    assertExit(await certifyCmd(id), `certify ${id}`);
  });

  /* ---- browser actions ---- */

  registerRunner('vote', async (job) => {
    const permalink = arg(job, 'permalink');
    const direction = arg(job, 'direction') as VoteDirection;
    if (!permalink) throw new Error('a vote job needs a permalink');
    if (direction !== 'up' && direction !== 'down') throw new Error('direction must be "up" or "down"');

    const guard = await voteTargetIsOurs(permalink);
    if (guard.blocked) throw new Error(`refused: ${guard.why}`);

    await withPage(job, (page) => votePost(page, permalink, direction));
  });

  registerRunner('save', async (job) => {
    const permalink = arg(job, 'permalink');
    if (!permalink) throw new Error('a save job needs a permalink');
    const saved = arg(job, 'saved') !== 'false';
    await withPage(job, (page) => setSaved(page, permalink, saved));
  });

  registerRunner('follow', async (job) => {
    const target = arg(job, 'target');
    if (!target) throw new Error('a follow job needs a target like user/name or r/name');
    const following = arg(job, 'following') !== 'false';
    await withPage(job, (page) => setFollowing(page, target, following));
  });

  registerRunner('reply-comment', async (job) => {
    const permalink = arg(job, 'permalink');
    const commentId = arg(job, 'commentId');
    const body = arg(job, 'body');
    if (!permalink || !commentId || !body) {
      throw new Error('a reply-comment job needs permalink, commentId and body');
    }
    await withPage(job, (page) => replyToComment(page, permalink, commentId, body));
  });

  /**
   * Submitting a post.
   *
   * A `post` job carries an already-written title and body, and it is created by an operator
   * action, never by the pipeline.
   *
   * `post` IS in PUBLISH_KINDS (`scheduler.ts`), added 2026-07-27 to close an unattended-publish
   * gap: a working runner plus a queue is a publish path whatever the kind is called, and a post
   * is a public statement rather than a reversible relationship change. So `runOne` drives a
   * `post` job to `waiting` before it ever looks this runner up — it runs only when a person
   * authorises that specific job. This comment previously claimed the opposite as current fact,
   * which is the more dangerous direction to be wrong in: it reads as "the scheduler may run
   * this".
   *
   * The workstation additionally only creates one from an explicit form submission by a person.
   * There is no path that generates post text and queues it in the same motion.
   */
  registerRunner('post', async (job) => {
    const subreddit = arg(job, 'subreddit');
    const title = arg(job, 'title');
    const body = arg(job, 'body');
    if (!subreddit || !title) throw new Error('a post job needs a subreddit and a title');
    await withPage(job, (page) => submitPost(page, { subreddit, title, body }));
  });
}
