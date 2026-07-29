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
import { recordObservation, type Checkpoint } from '../health.js';
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

export interface CommentSighting {
  present: boolean;
  /** Reddit's own notice, verbatim, when the comment is shown as removed or deleted. */
  removalNotice: string | null;
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
          present: false,
          removalNotice:
            /\[removed\]|\[deleted\]|comment (?:removed|deleted) by moderator|removed by reddit/i.exec(bodyText)?.[0] ?? null,
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
      const text = (hit as HTMLElement).innerText;

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
        present: true,
        removalNotice: /\[removed\]|\[deleted\]|removed by moderator/i.exec(text)?.[0] ?? null,
        score: scoreAttr != null && scoreAttr !== '' && Number.isFinite(Number(scoreAttr)) ? Number(scoreAttr) : null,
        childReplies: kids.length,
        via,
        replies
      };
    },
    { needle: probe, id: draft.commentId ?? null }
  ).catch(() => null);

  return found ?? {
    present: false,
    removalNotice: null,
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

  const s = await attach();
  const out = await openSignedOut(s.browser);
  const threads = await loadThreads();

  try {
    for (const draft of targets) {
      const threadRec = threads.find((t) => t.id === draft.threadId);
      const url = draft.commentPermalink ?? draft.publishedUrl ?? draft.permalink;
      const publishedAt = draft.decidedAt ?? draft.createdAt;
      const elapsedMinutes = Math.round((Date.now() - Date.parse(publishedAt)) / 60_000);
      const checkpoint = (forced as Checkpoint) ?? checkpointFor(elapsedMinutes);

      say.step(`${draft.id} — ${checkpoint} (${elapsedMinutes} min after publishing)`);
      say.step(`  ${url}`);

      /* ---- signed in ---- */
      await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if (await isRateLimited(s.page)) {
        await record('ratelimit', `429 during observe of ${draft.id}`);
        say.fail('  rate-limited — stopping so the account is not pushed further');
        return 1;
      }
      const blocked = await isBlocked(s.page);
      if (blocked) {
        await record('login.fail', `block page during observe of ${draft.id}`);
        say.fail('  Reddit served a block page — cannot observe right now');
        return 1;
      }

      const me = await whoAmI(s.page);
      setAccount(me.username);
      await s.page.waitForTimeout(2000);
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
          kind: /deleted/i.test(inView.removalNotice) ? 'reply-marked-deleted' : 'reply-marked-removed',
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
      if (!out) {
        say.warn('  signed out: UNAVAILABLE — no logged-out context could be opened on this Chrome.');
        say.warn('              Check by hand in a private window. Not recorded as an observation.');
      } else {
        await out.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await out.page.waitForTimeout(2000);
        const outView = await lookFor(out.page, draft);
        outSight = outView;

        say.step(`  signed out: ${outView.present ? 'visible' : 'NOT VISIBLE'}` +
          `${outView.removalNotice ? ` — notice: "${outView.removalNotice}"` : ''}`);

        await recordObservation({
          account: me.username,
          kind: outView.present ? 'reply-visible-signed-out' : 'reply-absent-signed-out',
          vector: 'signed-out',
          permalink: url,
          checkpoint,
          value: outView.present,
          note:
            `${outView.via}; elapsed ${elapsedMinutes} min. ` +
            `Records only what a logged-out browser rendered — not why.`
        });

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
    }

    say.ok(`Recorded. Next checkpoints: ${CHECKPOINTS.join(' → ')}. Observations in data/observations.jsonl`);
    return 0;
  } finally {
    if (out) await out.close();
    await s.close();
  }
}
