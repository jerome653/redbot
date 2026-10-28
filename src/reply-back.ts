/**
 * Reply-back — which replies to THIS account's published comments are still waiting for an answer.
 *
 * WHY THIS EXISTS. Measured on production 2026-10-28: of 38 observed published comments, 11 had a
 * reply (`reply-child-count` > 0 in `observations`) and not one was answered. The loop only ever
 * wrote top-level comments, so every conversation somebody started with us ended on their side —
 * and a back-and-forth is where comment karma actually builds (fleet karma rose about +4 that week).
 *
 * WHAT IT READS, AND WHY NOTHING NEW POLLS. The observe sweep (src/commands/observe.ts, run at the
 * top of every turn by auto.ts observeStep) already renders our comment's page and stores every
 * direct reply — author, text, thing id — on the `interactions` row. This file only decides, from
 * those rows, which replies are owed an answer. It is pure: the turn's step (part B) loads the rows
 * and hands them in, so every refusal below is testable without a browser.
 *
 * WHAT IT REFUSES, each for a reason that is not a preference:
 *   - another account's comments: the signed-in vector is whoever this Chrome is, and answering
 *     under B's comment as A puts two fleet accounts in one conversation;
 *   - a reply by us or by any fleet account: the fleet does not talk to itself in public;
 *   - a removed / deleted / authorless / empty reply: there is nobody left to answer;
 *   - a moderator- or admin-distinguished comment: a mod note is a ruling, not a conversation, and
 *     arguing with one is how a subreddit floor gets raised (src/removal-floor.ts);
 *   - a reply with no thing id: it cannot be targeted, and a guessed target answers the wrong person;
 *   - anything under our comment once it is removed or no longer visible signed in;
 *   - a reply already answered — by a comment from us or the fleet rendered beneath it (this also
 *     catches an answer typed by hand), or by a reply-back already ATTEMPTED in history. An attempt
 *     with no result is an unknown outcome, and the rule everywhere in this product is "go look by
 *     hand, never retry" (src/reddit/post.ts header);
 *   - a second reply-back on the same comment thread inside REPLY_BACK_PER_THREAD_MS.
 *
 * What this does NOT decide: whether the answer may be published. That is the same draft →
 * certification → publish bar → gates path every comment takes (src/commands/reply.ts); nothing
 * here can make a reply-back publishable, it can only make one a candidate.
 */
import type { Draft, HistoryEntry } from './types.js';
import type { InteractionRecord, ObservedReply } from './interactions.js';

/** At most one reply-back per comment thread per this window. Rolling, so no timezone decides it. */
export const REPLY_BACK_PER_THREAD_MS = 24 * 60 * 60_000;

export interface UnansweredReply {
  /** OUR published draft the reply sits under. */
  draftId: string;
  threadId: string;
  /** The thread's permalink — where part B opens the page. */
  permalink: string;
  ourCommentId: string | null;
  ourCommentPermalink: string | null;
  /** The reply we would answer: Reddit's thing id, its author and its own text. */
  parentThingId: string;
  author: string;
  body: string;
  renderedAge: string | null;
  /** When the observation that saw it was taken. */
  observedAt: string;
}

export interface UnansweredInput {
  account: string;
  /** Every fleet handle (accounts table), this account included. */
  fleet: string[];
  now: Date;
  drafts: Draft[];
  interactions: InteractionRecord[];
  history: HistoryEntry[];
}

/** The history contract part B writes on every reply-back `publish.*` row. */
export function isReplyBackEntry(e: HistoryEntry): { parentDraftId: string; parentThingId: string } | null {
  const d = e.data;
  if (!d || d.replyBack !== true) return null;
  const parentDraftId = typeof d.parentDraftId === 'string' ? d.parentDraftId : null;
  const parentThingId = typeof d.parentThingId === 'string' ? d.parentThingId : null;
  return parentDraftId && parentThingId ? { parentDraftId, parentThingId } : null;
}

/* Same markers observe.ts readRemoval() treats as a removal, applied to the reply's own text. */
const GONE = /^\s*(?:\[removed\]|\[deleted\])\s*$|comment (?:removed|deleted) by moderator|removed by reddit/i;

function answerable(r: ObservedReply, fleet: Set<string>): r is ObservedReply & { thingId: string; author: string } {
  if (!r.thingId || !r.author || r.byUs) return false;
  const author = r.author.toLowerCase();
  if (author === '[deleted]' || fleet.has(author)) return false;
  if (!r.body.trim() || GONE.test(r.body)) return false;
  if (r.distinguished) return false;
  /* `childAuthors` absent = a row written before the field existed: unknown, not "answered".
     Part B re-reads the live page before submitting, which catches the rest. */
  if ((r.childAuthors ?? []).some((a) => fleet.has(a.toLowerCase()))) return false;
  return true;
}

/**
 * The work list, newest observation first, AT MOST ONE reply per comment thread — one turn answers
 * one person in one conversation, and the per-thread daily limit would refuse a second anyway.
 */
export function unansweredReplies(input: UnansweredInput): UnansweredReply[] {
  const who = input.account.toLowerCase();
  const fleet = new Set([...input.fleet, input.account].map((h) => h.toLowerCase()));

  /* Answered (or attempted) parents, and when each of our comment threads was last answered on. */
  const answered = new Set<string>();
  const lastBackAt = new Map<string, number>();
  for (const e of input.history) {
    if (e.kind !== 'publish.ok' && e.kind !== 'publish.attempt') continue;
    const back = isReplyBackEntry(e);
    if (!back) continue;
    answered.add(back.parentThingId);
    const at = Date.parse(e.ts);
    if (Number.isFinite(at) && at > (lastBackAt.get(back.parentDraftId) ?? -Infinity)) lastBackAt.set(back.parentDraftId, at);
  }

  /* The LATEST signed-in look at each comment. Signed-in because that is the vector that renders
     what this account would be answering; a reply gone since then is gone. */
  const latest = new Map<string, InteractionRecord>();
  for (const r of input.interactions) {
    if (r.kind !== 'checkpoint' || r.vector !== 'signed-in') continue;
    const prev = latest.get(r.draftId);
    if (!prev || Date.parse(r.ts) > Date.parse(prev.ts)) latest.set(r.draftId, r);
  }

  const out: UnansweredReply[] = [];
  for (const draft of input.drafts) {
    if (draft.status !== 'published' || (draft.account ?? '').toLowerCase() !== who) continue;
    const seen = latest.get(draft.id);
    if (!seen?.self?.present || seen.self.removalNotice) continue;
    const last = lastBackAt.get(draft.id);
    if (last !== undefined && input.now.getTime() - last < REPLY_BACK_PER_THREAD_MS) continue;

    const r = seen.replies.find((x) => answerable(x, fleet) && !answered.has(x.thingId!));
    if (!r || !r.thingId || !r.author) continue;
    out.push({
      draftId: draft.id,
      threadId: draft.threadId,
      permalink: draft.permalink,
      ourCommentId: draft.commentId ?? seen.commentId ?? null,
      ourCommentPermalink: draft.commentPermalink ?? seen.commentPermalink ?? null,
      parentThingId: r.thingId,
      author: r.author,
      body: r.body.trim(),
      renderedAge: r.renderedAge,
      observedAt: seen.ts
    });
  }
  return out.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
}

/**
 * The same list from the live stores, for the turn. Loads are the ones observe and health already
 * use; the fleet is the accounts table, so an account added later is excluded the moment it exists.
 */
export async function loadUnansweredReplies(account: string, now: Date = new Date()): Promise<UnansweredReply[]> {
  const [{ loadDrafts, loadHistory }, { loadInteractions }, { loadAccounts }] = await Promise.all([
    import('./store.js'), import('./interactions.js'), import('./config.js')
  ]);
  const [drafts, interactions, history] = await Promise.all([loadDrafts(), loadInteractions(), loadHistory()]);
  return unansweredReplies({ account, fleet: loadAccounts().map((a) => a.handle), now, drafts, interactions, history });
}
