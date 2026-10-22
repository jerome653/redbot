/**
 * `redbot observe [draftId] [--checkpoint immediate|1h|24h|7d]`
 *
 * Part F — what happened to a published reply.
 *
 * Two vectors, because they answer different questions:
 *
 *   signed in   — is the comment there for the account that wrote it?
 *   signed out  — is it there for everyone else?
 *
 * The second is the one that matters. ACCOUNT-WARMING records the failure mode: a comment
 * that posts successfully, stays visible while signed in, and is invisible to everyone else.
 * Checking your own profile does not detect it.
 *
 * **What this records and what it refuses to record.** It records what a browser rendered:
 * present / absent, a removal notice if one is shown, a score if one is shown, how many
 * replies sit under it. It does not record "shadowbanned", "filtered", "caught by automod"
 * or "the account is fine" — none of those are observable from outside, and inventing them
 * would turn an evidence file into a guess. The health state machine reacts to the
 * observation; nothing here interprets it.
 *
 * The signed-out read uses a separate incognito context on the same Chrome. If that context
 * cannot be created, or turns out to be signed in, the check is reported as UNAVAILABLE
 * rather than substituted with the signed-in result.
 */
import type { Browser, Page } from 'playwright';
import { attach, isBrowserUp, whoAmI, isBlocked, isRateLimited, NoBrowserError } from '../browser.js';
import { loadDrafts, loadThreads } from '../store.js';
import { appendInteraction, INTERACTION_SCHEMA_VERSION } from '../interactions.js';
import { currentAgeHours } from '../select.js';
import { recordObservation, loadObservations, type Checkpoint, type Observation } from '../health.js';
import { record, say, setAccount } from '../log.js';
import { config } from '../config.js';
import type { Draft } from '../types.js';

const CHECKPOINTS: Checkpoint[] = ['immediate', '1h', '24h', '7d'];

/** Nearest scheduled checkpoint for an elapsed time. The exact elapsed value is also stored. */
export function checkpointFor(elapsedMinutes: number): Checkpoint {
  if (elapsedMinutes < 30) return 'immediate';
  if (elapsedMinutes < 12 * 60) return '1h';
  if (elapsedMinutes < 4 * 24 * 60) return '24h';
  return '7d';
}

/**
 * The address to navigate to for a published draft, always absolute.
 *
 * `commentPermalink` is NOT always absolute. The 2026-09-28 06:43 publish was recorded after the
 * fact and stored Reddit's own relative form, `/r/Wordpress/comments/1wrudhq/comment/pcizrg8/`;
 * the absolute `publishedUrl` on the same row never got a turn, because a relative string is
 * non-null and wins a `??` chain. Playwright then refused it outright — measured 2026-09-28:
 * "page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL" — so that comment
 * could not be observed at all, while the two rows written by the normal path observed fine.
 *
 * A blank string is treated as absent for the same reason: `''` is non-null and would otherwise
 * shadow a usable value and resolve to the site root, which `lookFor` would then report as a
 * missing comment rather than a missing address.
 *
 * Same shape as reddit/post.ts:130 and reddit/scrape.ts:197, which already resolve Reddit's
 * relative hrefs against `config.redditBase`.
 */
export function observeUrl(draft: {
  commentPermalink?: string | null;
  publishedUrl?: string | null;
  permalink: string;
}): string {
  const candidates = [draft.commentPermalink, draft.publishedUrl, draft.permalink];
  const raw = (candidates.find((u) => typeof u === 'string' && u.trim() !== '') ?? draft.permalink).trim();
  return raw.startsWith('http') ? raw : config.redditBase + raw;
}

export interface CommentSighting {
  present: boolean;
  /** Reddit's own notice, verbatim, when the comment is shown as removed or deleted. */
  removalNotice: string | null;
  /**
   * The `author` attribute Reddit renders on the node. `[deleted]` here alongside a removal
   * notice is the pair that distinguishes a removed comment from an intact one — measured
   * 2026-09-30 on t1_pcizrg8, t1_pcm3zpx and t1_pcup48f, all three signed-out:
   * `author="[deleted]"`, no `[slot="comment"]` child of their own, and the rendered text
   * "Comment removed by moderator".
   */
  author: string | null;
  /**
   * PRESENT BUT NOT THERE. Reddit leaves the `shreddit-comment` node in place after a removal
   * and replaces the body with its own notice, so `present` — which is true as soon as a node
   * with our thingid is found — cannot answer this file's own question at the top: "is it there
   * for everyone else?" This field answers it. `present && !removed` is the only combination
   * that means a reader saw the reply.
   */
  removed: boolean;
  score: number | null;
  childReplies: number | null;
  /** How the node was located, so a null result is debuggable. */
  via: string;
  /**
   * Every comment rendered beneath ours, with its text.
   *
   * EB-32/EB-33, frozen into the schema 2026-07-23 before the first publish. The count alone
   * cannot answer "was a correction posted beneath it?" — the strongest available signal that a
   * certification was wrong — and a deleted comment leaves the page, so this is the only durable
   * copy. `renderedAge` keeps Reddit's own relative timestamp so time-to-first-interaction is
   * recoverable without claiming a precision the page does not offer.
   */
  replies: Array<{
    thingId: string | null;
    author: string | null;
    body: string;
    renderedAge: string | null;
    timestamp: string | null;
    score: number | null;
    depth: number | null;
    distinguished: string | null;
  }>;
}

/**
 * Is this node a removal stub, and what did Reddit write on it?
 *
 * Pure, and exported, because the three readings it decides from come out of `page.evaluate` —
 * which runs in the browser and cannot call anything importable. Keeping the RULE here and the
 * READING there means one implementation that a unit test can drive.
 *
 * `text` must be the comment's OWN text with nested `shreddit-comment` subtrees stripped. Pass a
 * whole subtree and a child's `[deleted]` is attributed to the parent — measured 2026-09-30 on
 * t1_pcm3zpx, whose subtree carried its own removal stub plus a Wordpress-ModTeam reply.
 */
export function readRemoval(input: {
  ownText: string;
  author: string | null;
  hasOwnSlot: boolean;
}): { removalNotice: string | null; removed: boolean } {
  /* The explicit phrase wins over the bare marker. A moderator removal renders the author as
     `[deleted]`, so matching `[deleted]` first filed real removals as "deleted" — and
     src/health.ts:263 counts only `reply-marked-removed` toward the stop, so the kind decides
     whether three removals are seen as a pattern or as nothing. */
  const removalNotice =
    /comment (?:removed|deleted) by moderator|removed by moderator|removed by reddit|\[removed\]/i
      .exec(input.ownText)?.[0]
    ?? /\[deleted\]/i.exec(input.ownText)?.[0]
    ?? null;

  /* Either Reddit wrote a removal notice on our node, or the node lost its body entirely while
     rendering `[deleted]` as its author. In both cases a reader does not see the reply. */
  const removed = removalNotice !== null || (input.author === '[deleted]' && !input.hasOwnSlot);
  return { removalNotice, removed };
}

async function lookFor(page: Page, draft: Draft): Promise<CommentSighting> {
  const probe = draft.body.slice(0, 60);

  const found = await page.evaluate(
    ({ needle, id }: { needle: string; id: string | null }) => {
      const nodes = Array.from(document.querySelectorAll('shreddit-comment'));
      let hit: Element | undefined;
      let via = '';

      if (id) {
        hit = nodes.find(
          (n) => n.getAttribute('thingid') === id || n.getAttribute('thing-id') === id || n.id === id
        );
        if (hit) via = 'comment id attribute';
      }
      if (!hit) {
        hit = nodes.find((n) => (n as HTMLElement).innerText.includes(needle));
        if (hit) via = 'first 60 characters of the body';
      }
      if (!hit) {
        const bodyText = document.body.innerText;
        return {
          /* `as const` so the two branches form a DISCRIMINATED union: with a widened
             `boolean` the narrowing below cannot tell a found node from a missing one. */
          present: false as const,
          removalNotice:
            /\[removed\]|\[deleted\]|comment (?:removed|deleted) by moderator|removed by reddit/i.exec(bodyText)?.[0] ?? null,
          author: null as string | null,
          /* Not-found is not a removal. The notice above was matched against the WHOLE page, so it
             may belong to any other comment on it; `removed` is only ever set from our own node. */
          removed: false,
          score: null as number | null,
          childReplies: null as number | null,
          via: `not found among ${nodes.length} rendered comment nodes`,
          replies: [] as Array<{
            thingId: string | null; author: string | null; body: string;
            renderedAge: string | null; timestamp: string | null;
            score: number | null; depth: number | null; distinguished: string | null;
          }>
        };
      }

      const numAttr = (el: Element, ...names: string[]): number | null => {
        for (const n of names) {
          const v = el.getAttribute(n);
          if (v != null && v !== '' && Number.isFinite(Number(v))) return Number(v);
        }
        return null;
      };
      const idOf = (el: Element): string | null =>
        el.getAttribute('thingid') ?? el.getAttribute('thing-id') ?? el.id ?? null;

      const scoreAttr = hit.getAttribute('score');
      const thingId = idOf(hit);
      const kids = thingId
        ? nodes.filter((n) => (n.getAttribute('parentid') ?? n.getAttribute('parent-id')) === thingId)
        : [];

      /**
       * OUR OWN TEXT, NOT OUR SUBTREE'S.
       *
       * `shreddit-comment` NESTS — a reply is a DOM descendant of the comment it answers, and
       * `querySelectorAll` returns both. So `hit.innerText` contains every nested reply's text,
       * and a `[deleted]` child was attributed to the parent. Measured 2026-09-30 on t1_pcm3zpx:
       * `hit.innerText` carried its own removal stub AND a Wordpress-ModTeam reply, and the
       * `[slot="comment"]` lookup returned the TEXT OF A CHILD because the parent had no slot of
       * its own left.
       *
       * Strip the nested comments from a clone and read what remains. `textContent` rather than
       * `innerText` because a detached clone has no layout, so `innerText` would return ''.
       */
      const clone = hit.cloneNode(true) as Element;
      for (const nested of Array.from(clone.querySelectorAll('shreddit-comment'))) nested.remove();
      const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim();

      /**
       * The classification is NOT done here. `page.evaluate` runs its argument in the browser, so
       * nothing it calls can be imported — a rule written inside this function could only be
       * tested by driving a real page. It returns the three raw readings instead and
       * `readRemoval()` below decides, in Node, where a unit test can reach it.
       */
      const author = hit.getAttribute('author');
      /* Our own body slot, not a nested reply's: `closest` walks back up to the owning comment. */
      const hasOwnSlot = Array.from(hit.querySelectorAll('[slot="comment"]'))
        .some((el) => el.closest('shreddit-comment') === hit);

      // Every comment beneath ours, verbatim. Read defensively: an attribute Reddit does not
      // render becomes null, never a guess and never an omitted key.
      const replies = kids.map((n) => {
        const timeEl = n.querySelector('time');
        return {
          thingId: idOf(n),
          author: n.getAttribute('author'),
          body: (n as HTMLElement).innerText,
          renderedAge: timeEl ? (timeEl as HTMLElement).innerText.trim() || null : null,
          timestamp: timeEl ? timeEl.getAttribute('datetime') : null,
          score: numAttr(n, 'score'),
          depth: numAttr(n, 'depth'),
          distinguished: n.getAttribute('distinguished')
        };
      });

      return {
        present: true as const,
        ownText: text,
        author,
        hasOwnSlot,
        score: scoreAttr != null && scoreAttr !== '' && Number.isFinite(Number(scoreAttr)) ? Number(scoreAttr) : null,
        childReplies: kids.length,
        via,
        replies
      };
    },
    { needle: probe, id: draft.commentId ?? null }
  ).catch(() => null);

  if (found && found.present) {
    const { removalNotice, removed } = readRemoval(found);
    const { ownText: _ownText, hasOwnSlot: _hasOwnSlot, ...rest } = found;
    return { ...rest, removalNotice, removed };
  }
  if (found) return found;

  return found ?? {
    present: false,
    removalNotice: null,
    author: null,
    removed: false,
    score: null,
    childReplies: null,
    via: 'page could not be read',
    replies: []
  };
}

/**
 * A logged-out view of the same Chrome. Returns null when one cannot be established —
 * an unavailable check is reported as unavailable.
 */
async function openSignedOut(browser: Browser): Promise<{ page: Page; close: () => Promise<void> } | null> {
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(config.redditBase, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const me = await whoAmI(page);
    if (me.loggedIn) {
      await ctx.close().catch(() => {});
      return null;
    }
    return { page, close: async () => { await ctx.close().catch(() => {}); } };
  } catch {
    return null;
  }
}

export async function observe(draftIdArg?: string, opts?: { checkpoint?: string }): Promise<number> {
  say.head('redbot observe');

  const forced = opts?.checkpoint;
  if (forced && !CHECKPOINTS.includes(forced as Checkpoint)) {
    say.fail(`--checkpoint must be one of ${CHECKPOINTS.join(', ')}`);
    return 1;
  }

  const published = (await loadDrafts()).filter((d) => d.status === 'published');
  const targets = draftIdArg ? published.filter((d) => d.id === draftIdArg) : published;

  if (!targets.length) {
    say.warn(
      draftIdArg
        ? `No published draft with id ${draftIdArg}.`
        : 'Nothing has been published yet, so there is nothing to observe.'
    );
    return 1;
  }

  if (!(await isBrowserUp())) {
    say.fail(new NoBrowserError(config.browser.cdpEndpoint).message);
    return 1;
  }

  const r = await observeTargets(targets, { forced: forced as Checkpoint | undefined });
  return r.stopped === 'ratelimit' || r.stopped === 'blocked' ? 1 : 0;
}

/* ------------------------------------------------------------------ */

/** Observations older than this are not re-checked unattended: the last checkpoint is 7d. */
export const OBSERVE_WINDOW_MS = 8 * 24 * 60 * 60_000;
/** At most this many comments per unattended turn, so observing never crowds out the turn. */
export const OBSERVE_CAP = 3;

export interface DueObservation { draft: Draft; checkpoint: Checkpoint; elapsedMinutes: number; url: string }

/**
 * Which of ONE account's published comments are due a look right now.
 *
 * ONE account, because the signed-in vector reads whatever Chrome is attached and `observe()` files
 * the result under whoever that Chrome is signed in as — so account A's browser observing B's
 * comment records B's removal against A, and B goes on posting. Due means: published by this
 * account, inside the 8-day window, and the checkpoint it has reached (checkpointFor) has no
 * observation recorded yet for its permalink. Newest first — the newest comment is the one a
 * moderator is most likely to be looking at — and capped.
 */
export function dueForObservation(
  drafts: Draft[],
  observations: Array<Pick<Observation, 'permalink' | 'checkpoint'>>,
  opts: { account: string; now: Date; cap?: number }
): DueObservation[] {
  const who = opts.account.toLowerCase();
  const seen = new Set(observations.map((o) => `${o.permalink ?? ''}\n${o.checkpoint ?? ''}`));
  const out: Array<DueObservation & { at: number }> = [];
  for (const draft of drafts) {
    if (draft.status !== 'published' || (draft.account ?? '').toLowerCase() !== who) continue;
    const at = Date.parse(draft.decidedAt ?? draft.createdAt);
    const age = opts.now.getTime() - at;
    if (!Number.isFinite(at) || age < 0 || age > OBSERVE_WINDOW_MS) continue;
    const elapsedMinutes = Math.round(age / 60_000);
    const checkpoint = checkpointFor(elapsedMinutes);
    const url = observeUrl(draft);
    if (seen.has(`${url}\n${checkpoint}`)) continue;
    out.push({ draft, checkpoint, elapsedMinutes, url, at });
  }
  return out
    .sort((a, b) => b.at - a.at)
    .slice(0, opts.cap ?? OBSERVE_CAP)
    .map(({ at: _at, ...due }) => due);
}

export interface ObserveDueResult {
  due: number;
  observed: number;
  /** Why the sweep ended early. `ratelimit` and `blocked` mean Reddit is pushing back: stop the turn. */
  stopped: 'ratelimit' | 'blocked' | 'wrong-account' | null;
}

/**
 * The unattended observe: one account, only what is due, capped. The caller has checked the
 * browser is up. The CLI `redbot observe [id]` is unchanged and still observes everything.
 */
export async function observeDue(opts: { account: string; now?: Date; cap?: number }): Promise<ObserveDueResult> {
  const due = dueForObservation(await loadDrafts(), await loadObservations(), {
    account: opts.account, now: opts.now ?? new Date(), cap: opts.cap
  });
  if (!due.length) return { due: 0, observed: 0, stopped: null };
  say.step(`Observing ${due.length} published comment(s) for ${opts.account} before this turn…`);
  const r = await observeTargets(due.map((d) => d.draft), { expectAccount: opts.account, now: opts.now });
  /* A skipped comment (unreadable page, a load that threw, the wrong account) records no
     observation, so a sweep that skips everything would look exactly like one with nothing due.
     Say it in history: a run of these rows is the sign the brake has gone blind again. */
  if (r.observed < due.length) {
    await record('error', `observe for ${opts.account}: ${r.observed} of ${due.length} due comment(s) observed`, {
      level: 'warn', account: opts.account, due: due.length, observed: r.observed, stopped: r.stopped, observe: 'short'
    }).catch(() => undefined);
  }
  return { due: due.length, ...r };
}

async function observeTargets(
  targets: Draft[],
  opts: { forced?: Checkpoint; expectAccount?: string; now?: Date }
): Promise<Omit<ObserveDueResult, 'due'>> {
  const forced = opts.forced;
  let observed = 0;
  const s = await attach();
  const out = await openSignedOut(s.browser);
  const threads = await loadThreads();

  /* Unattended only: a page that rendered no comment at all is unreadable, not "absent". Reddit
     leaves a node behind after a removal, so zero nodes means the page did not load — and
     health.ts counts a signed-in absence as a removal, so recording it would stop the account. */
  const unattended = Boolean(opts.expectAccount);
  const rendered = async (page: Page) => (await page.locator('shreddit-comment').count().catch(() => 0)) > 0;

  try {
    for (const draft of targets) {
     try {
      const threadRec = threads.find((t) => t.id === draft.threadId);
      const url = observeUrl(draft);
      const publishedAt = draft.decidedAt ?? draft.createdAt;
      const elapsedMinutes = Math.round(((opts.now?.getTime() ?? Date.now()) - Date.parse(publishedAt)) / 60_000);
      const checkpoint = forced ?? checkpointFor(elapsedMinutes);

      say.step(`${draft.id} — ${checkpoint} (${elapsedMinutes} min after publishing)`);
      say.step(`  ${url}`);

      /* ---- signed in ---- */
      await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if (await isRateLimited(s.page)) {
        await record('ratelimit', `429 during observe of ${draft.id}`);
        say.fail('  rate-limited — stopping so the account is not pushed further');
        return { observed, stopped: 'ratelimit' };
      }
      const blocked = await isBlocked(s.page);
      if (blocked) {
        await record('login.fail', `block page during observe of ${draft.id}`);
        say.fail('  Reddit served a block page — cannot observe right now');
        return { observed, stopped: 'blocked' };
      }

      const me = await whoAmI(s.page);
      /* Never file one account's comment under another: the signed-in vector is whoever this Chrome is. */
      if (opts.expectAccount && (me.username ?? '').toLowerCase() !== opts.expectAccount.toLowerCase()) {
        say.warn(`  this Chrome is signed in as ${me.username ?? '(nobody)'}, not ${opts.expectAccount} — nothing recorded`);
        return { observed, stopped: 'wrong-account' };
      }
      setAccount(me.username);
      await s.page.waitForTimeout(2000);
      if (unattended && !(await rendered(s.page))) {
        say.warn(`  ${draft.id}: the page rendered no comments — unreadable, nothing recorded`);
        continue;
      }
      const inView = await lookFor(s.page, draft);

      say.step(`  signed in : ${inView.present ? 'visible' : 'NOT VISIBLE'}` +
        `${inView.removalNotice ? ` — notice: "${inView.removalNotice}"` : ''}` +
        `${inView.score != null ? ` — score ${inView.score}` : ''}` +
        `${inView.childReplies != null ? ` — ${inView.childReplies} repl${inView.childReplies === 1 ? 'y' : 'ies'}` : ''}`);

      await recordObservation({
        account: me.username,
        kind: inView.present ? 'reply-visible-signed-in' : 'reply-absent-signed-in',
        vector: 'signed-in',
        permalink: url,
        checkpoint,
        value: inView.present,
        note: `${inView.via}; elapsed ${elapsedMinutes} min`
      });

      if (inView.removalNotice) {
        await recordObservation({
          account: me.username,
          /* `removed` wins over `deleted`: a moderator removal renders the author as `[deleted]`,
             and keying off that marker filed real removals under the wrong kind — which matters,
             because src/health.ts:263 counts only `reply-marked-removed` toward the stop. */
          kind: /removed/i.test(inView.removalNotice) ? 'reply-marked-removed' : 'reply-marked-deleted',
          vector: 'signed-in',
          permalink: url,
          checkpoint,
          value: inView.removalNotice,
          note: 'Reddit rendered this notice verbatim; it does not say who removed it or why'
        });
      }
      if (inView.score != null) {
        await recordObservation({
          account: me.username, kind: 'reply-vote-count', vector: 'signed-in',
          permalink: url, checkpoint, value: inView.score
        });
      }
      if (inView.childReplies != null) {
        await recordObservation({
          account: me.username, kind: 'reply-child-count', vector: 'signed-in',
          permalink: url, checkpoint, value: inView.childReplies
        });
      }

      /* ---- signed out ---- */
      let outSight: CommentSighting | null = null;
      if (out && unattended) {
        await out.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await out.page.waitForTimeout(2000);
      }
      if (out && unattended && !(await rendered(out.page))) {
        say.warn('  signed out: the page rendered no comments — unreadable, not recorded.');
      } else if (!out) {
        say.warn('  signed out: UNAVAILABLE — no logged-out context could be opened on this Chrome.');
        say.warn('              Check by hand in a private window. Not recorded as an observation.');
      } else {
        if (!unattended) {
          await out.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
          await out.page.waitForTimeout(2000);
        }
        const outView = await lookFor(out.page, draft);
        outSight = outView;

        say.step(`  signed out: ${outView.removed ? 'REMOVED' : outView.present ? 'visible' : 'NOT VISIBLE'}` +
          `${outView.removalNotice ? ` — notice: "${outView.removalNotice}"` : ''}` +
          `${outView.author ? ` — author rendered as "${outView.author}"` : ''}`);

        /**
         * A REMOVAL IS RECORDED AS ABSENT, AND THE NOTICE IS RECORDED AT ALL.
         *
         * Both halves were defects. `present` is true the moment a node with our thingid is
         * found, and Reddit leaves that node behind after a removal — so three moderator-removed
         * comments were stored as `reply-visible-signed-out = true` on 2026-09-30, and the
         * removal notice this function had already computed was printed to the terminal and
         * never written to the database. The record therefore said six live comments while four
         * were gone, and `removalsObserved30d` (src/health.ts:263) counted zero of them.
         *
         * `reply-absent-signed-out` is the honest kind: the schema has no "stub" kind, and the
         * question this vector answers — "is it there for everyone else?" — is answered no. The
         * note says the node was present so the two cases stay distinguishable in the record.
         */
        const publiclyVisible = outView.present && !outView.removed;
        await recordObservation({
          account: me.username,
          kind: publiclyVisible ? 'reply-visible-signed-out' : 'reply-absent-signed-out',
          vector: 'signed-out',
          permalink: url,
          checkpoint,
          value: publiclyVisible,
          note:
            `${outView.via}; elapsed ${elapsedMinutes} min. ` +
            (outView.removed
              ? `The node was PRESENT but carried Reddit's removal text${outView.author ? ` and rendered its author as "${outView.author}"` : ''} — a reader does not see the reply. `
              : '') +
            `Records only what a logged-out browser rendered — not why.`
        });

        if (outView.removalNotice) {
          await recordObservation({
            account: me.username,
            kind: /removed/i.test(outView.removalNotice) ? 'reply-marked-removed' : 'reply-marked-deleted',
            vector: 'signed-out',
            permalink: url,
            checkpoint,
            value: outView.removalNotice,
            note: 'Reddit rendered this notice verbatim to a logged-out browser; it does not say who removed it or why'
          });
        }

        if (inView.present && !outView.present) {
          say.warn('  visible signed in, not visible signed out. That is the observation; it does not');
          say.warn('  establish a cause. Do not post again from this account until a person has looked.');
        }
      }

      await record('observe', `checkpoint ${checkpoint} for ${draft.id}`, {
        draftId: draft.id,
        checkpoint,
        elapsedMinutes,
        signedIn: inView.present,
        signedOut: out ? undefined : 'unavailable'
      });

      /**
       * The immutable rows. One per vector, because "visible signed in, invisible signed out"
       * is two observations and collapsing them destroys the only signal that detects silent
       * filtering. Wrapped: a logging failure must never abort a checkpoint sweep.
       */
      try {
        const author = (threadRec?.author ?? '').toLowerCase();
        const row = async (vector: 'signed-in' | 'signed-out', sight: CommentSighting, note: string) =>
          appendInteraction({
            schemaVersion: INTERACTION_SCHEMA_VERSION,
            ts: new Date().toISOString(),
            kind: 'checkpoint',
            draftId: draft.id,
            threadId: draft.threadId,
            permalink: draft.permalink,
            commentPermalink: draft.commentPermalink ?? null,
            commentId: draft.commentId ?? null,
            account: me.username,
            checkpoint,
            elapsedMinutes,
            vector,
            thread: {
              locked: null, archived: null, postScore: null, commentCount: null,
              ageHours: threadRec ? currentAgeHours(threadRec) : null
            },
            self: {
              present: sight.present,
              score: sight.score,
              removalNotice: sight.removalNotice,
              directReplyCount: sight.childReplies,
              via: sight.via
            },
            replies: sight.replies.map((r) => ({
              thingId: r.thingId,
              author: r.author,
              byOriginalPoster: Boolean(author) && (r.author ?? '').toLowerCase() === author,
              byUs: Boolean(me.username) && (r.author ?? '').toLowerCase() === me.username!.toLowerCase(),
              body: r.body,
              renderedAge: r.renderedAge,
              timestamp: r.timestamp,
              score: r.score,
              depth: r.depth,
              distinguished: r.distinguished,
              humanLabel: null      // never machine-filled; see interactions.ts
            })),
            note
          });

        await row('signed-in', inView, `${inView.via}; elapsed ${elapsedMinutes} min`);
        if (out && outSight) {
          await row('signed-out', outSight, `${outSight.via}; logged-out context; elapsed ${elapsedMinutes} min`);
        }
      } catch (e) {
        say.warn(`interaction rows not written: ${e instanceof Error ? e.message : String(e)}`);
      }
      observed++;
     } catch (e) {
      /* One comment that will not load must not starve the others: in the unattended sweep it is
         logged and the next due comment is observed. The CLI keeps failing loudly. */
      if (!unattended) throw e;
      say.warn(`  ${draft.id}: could not be observed (${e instanceof Error ? e.message : String(e)}) — next one`);
     }
    }

    say.ok(`Recorded. Next checkpoints: ${CHECKPOINTS.join(' → ')}. Observations in data/observations.jsonl`);
    return { observed, stopped: null };
  } finally {
    if (out) await out.close();
    await s.close();
  }
}
