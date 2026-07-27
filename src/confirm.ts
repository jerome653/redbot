/**
 * Confirmation — the stage between doing something and believing it worked.
 *
 * ## Why this is its own module
 *
 * On 2026-07-27 three separate capabilities reported success for something that had not
 * happened, and all three failed the same way: **they measured our own action instead of its
 * outcome.**
 *
 *   - `votePost` re-read the button it had just clicked. Reddit's UI is optimistic, so
 *     `aria-pressed` said "voted" while the server had discarded the vote entirely.
 *   - `submitPost` checked only that the URL was no longer `/submit`. The browser had landed on
 *     the subreddit index, so it returned `ok: true` with a permalink that was not a post.
 *   - `setFollowing` matched a button by label and found the hidden one — Reddit renders both
 *     Follow and Unfollow and toggles visibility.
 *
 * Every one passed a green test suite. None was a selector bug. The shared cause is that
 * "we clicked" and "Reddit navigated" were being treated as evidence, and neither is.
 *
 * ## The contract
 *
 *     perform()  →  confirm()  →  audit()  →  record()
 *
 * **No action reports success until `confirm()` passes.** `confirm()` must read state that was
 * fetched AFTER the action — a reload, a different page, a second account — never the DOM the
 * action just touched. That single rule is what separates evidence from an echo.
 *
 * `audit()` writes what was observed, including when the observation was negative. `record()`
 * puts it in the append-only log so a later question about whether something actually happened
 * has an answer that does not depend on anyone's memory.
 *
 * ## What this cannot do
 *
 * Confirmation establishes that Reddit accepted an action and still shows it **to us**. It does
 * not establish that anyone else can see it. A comment can be present for its author and
 * invisible to everyone else — the shadow-removal case in `ACCOUNT-WARMING.md` — and only a
 * signed-out or second-account read settles that. `visibility` is carried separately for
 * exactly that reason, and defaults to `unknown` rather than to `true`.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from './config.js';

/**
 * How an observation was obtained. The distinction is the whole point of the module: a reading
 * taken from the page we just acted on is not the same class of fact as one taken after a
 * reload, and calling both "confirmed" is how today's three bugs survived.
 */
export type EvidenceSource =
  /** Re-read after a fresh navigation or reload — the state came from the server again. */
  | 'reloaded'
  /** Read from a different page entirely, e.g. the account's own submitted list. */
  | 'second-page'
  /** Read by a different account, or signed out. The only source that proves public visibility. */
  | 'third-party'
  /** Read off the page the action just touched. NOT sufficient on its own. */
  | 'same-page';

export type Visibility = 'public' | 'author-only' | 'unknown';

export interface Evidence {
  /** Did the action's effect survive an independent read? */
  confirmed: boolean;
  source: EvidenceSource;
  /** What was actually observed, in plain terms, for a human reading the log later. */
  observed: string;
  /** Permalink of the artefact the action produced, when it produced one. */
  permalink?: string;
  /**
   * Whether anyone other than the author can see it. `unknown` unless a third-party read
   * happened — never inferred from the fact that WE can see it.
   */
  visibility?: Visibility;
}

export interface ConfirmationRecord extends Evidence {
  ts: string;
  action: string;
  account: string;
  jobId?: string;
  /** Milliseconds from starting the action to finishing confirmation. */
  ms: number;
  error?: string;
}

export const confirmationsPath = (): string => {
  mkdirSync(DATA, { recursive: true });
  return join(DATA, 'confirmations.jsonl');
};

/** Append-only. A confirmation is an observation, and observations are never rewritten. */
export function recordConfirmation(rec: ConfirmationRecord): void {
  appendFileSync(confirmationsPath(), JSON.stringify(rec) + '\n', 'utf8');
}

export class UnconfirmedError extends Error {
  readonly evidence: Evidence;
  constructor(action: string, evidence: Evidence) {
    super(
      `${action} was not confirmed — ${evidence.observed} ` +
      `(source: ${evidence.source}). The action may have been accepted and discarded; ` +
      `treat it as not done until an independent read says otherwise.`
    );
    this.name = 'UnconfirmedError';
    this.evidence = evidence;
  }
}

export interface ActSpec<T> {
  /** Name that appears in the log — `vote:up`, `post`, `follow:user/x`. */
  action: string;
  account: string;
  jobId?: string;
  /** Do the thing. Its return value is passed to `confirm`. */
  perform: () => Promise<T>;
  /**
   * Establish whether it actually happened, from state fetched AFTER the action.
   *
   * Returning `source: 'same-page'` with `confirmed: true` is accepted but flagged in the
   * record, because it is the exact shape of the three bugs this module exists to prevent.
   */
  confirm: (result: T) => Promise<Evidence>;
}

/**
 * Run one action under the contract.
 *
 * Throws `UnconfirmedError` when confirmation fails, so a caller that does nothing special
 * cannot accidentally treat an unconfirmed action as a success — in the job layer that makes
 * the job fail, which is the correct outcome. The record is written either way: a failed
 * confirmation is evidence, and losing it would hide exactly the cases worth studying.
 */
export async function act<T>(spec: ActSpec<T>): Promise<{ result: T; evidence: Evidence }> {
  const started = Date.now();
  let result: T;

  try {
    result = await spec.perform();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    recordConfirmation({
      ts: new Date().toISOString(),
      action: spec.action,
      account: spec.account,
      ...(spec.jobId ? { jobId: spec.jobId } : {}),
      confirmed: false,
      source: 'same-page',
      observed: 'the action itself failed before anything could be confirmed',
      visibility: 'unknown',
      ms: Date.now() - started,
      error: msg
    });
    throw e;
  }

  const evidence = await spec.confirm(result);

  recordConfirmation({
    ts: new Date().toISOString(),
    action: spec.action,
    account: spec.account,
    ...(spec.jobId ? { jobId: spec.jobId } : {}),
    ...evidence,
    visibility: evidence.visibility ?? 'unknown',
    ms: Date.now() - started
  });

  if (!evidence.confirmed) throw new UnconfirmedError(spec.action, evidence);

  return { result, evidence };
}
