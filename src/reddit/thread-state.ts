/**
 * Live thread state, read from the page immediately before publishing.
 *
 * Everything here answers a question that only the page can answer: is this thread still
 * open, has this account already replied, is Reddit showing us something we did not expect.
 *
 * **Verification status.** The lock/archive selectors below are derived from Reddit's current
 * markup and are NOT yet confirmed against a real locked or archived thread — no such thread
 * has been opened by redbot. They are therefore written to fail CLOSED: `probe()` returns
 * `unknown: true` when it cannot establish a fact, and the gate treats unknown as blocking.
 * When a locked thread is eventually observed, record it in certification/evidence/ and
 * downgrade the relevant unknown.
 */
import type { Page } from 'playwright';
import { sel } from './selectors.js';
import { firstVisible, firstUsable } from './scrape.js';

export interface ThreadState {
  locked: boolean;
  archived: boolean;
  /** A comment by `username` already exists on this page. */
  ownCommentPresent: boolean;
  /** The composer is reachable — the practical test of "can this account reply here". */
  composerPresent: boolean;
  /**
   * How the composer was found. `zero-box` means it is present, enabled and interactive but has
   * no layout box, which is Reddit's current shape for it — recorded rather than silently
   * absorbed, so a run that relied on the fallback says so in its own state.
   */
  composerVia?: 'visible' | 'zero-box';
  /** Facts the probe could not establish. Non-empty means the gate must refuse. */
  unknown: string[];
  /** Anything that does not look like a normal thread page. */
  anomalies: string[];
  /**
   * Post score and comment count as Reddit rendered them, at the moment of the probe.
   *
   * Added 2026-07-23 for the frozen interaction schema. The final probe runs immediately before
   * the submit click, so these are thread-state-at-publish — a fact that is unrecoverable once
   * the reply lands and the counts move.
   *
   * **Observation only. No gate reads these**, deliberately: the publish path is the least
   * exercised code in the project, and a new gating input there would be a new way to fail.
   * Null means Reddit did not expose the attribute, which is a normal outcome.
   */
  postScore: number | null;
  commentCount: number | null;
}

const LOCK_TEXT = /this (?:thread|post) (?:is|has been) (?:locked|archived)|comments? (?:are|is) locked|archived post/i;

export async function probeThreadState(page: Page, username: string | null): Promise<ThreadState> {
  const unknown: string[] = [];
  const anomalies: string[] = [];

  /* ---- the page is a thread page at all ---- */
  const title = await firstVisible(page, sel.postTitle);
  if (!title) {
    anomalies.push('no post title on the page — not a thread page, or it did not render');
  }

  const url = page.url();
  if (!/\/comments\//.test(url)) {
    anomalies.push(`URL is not a thread permalink: ${url}`);
  }

  /* ---- lock / archive ---- */
  let locked = false;
  let archived = false;
  const bodyText = await page.locator('body').innerText().catch(() => null);
  if (bodyText == null) {
    unknown.push('page text unreadable — cannot check for a lock or archive notice');
  } else {
    const notice = LOCK_TEXT.exec(bodyText);
    if (notice) {
      const hit = notice[0].toLowerCase();
      locked = /lock/.test(hit);
      archived = /archiv/.test(hit);
    }
  }

  // Reddit also marks the post element itself. Absence of the attribute is not proof of
  // absence of a lock, which is why the text check above runs regardless.
  let postScore: number | null = null;
  let commentCount: number | null = null;
  const postEl = page.locator('shreddit-post').first();
  if (await postEl.count().then((n) => n > 0).catch(() => false)) {
    const lockedAttr = await postEl.getAttribute('locked').catch(() => null);
    const archivedAttr = await postEl.getAttribute('archived').catch(() => null);
    if (lockedAttr !== null && lockedAttr !== 'false') locked = true;
    if (archivedAttr !== null && archivedAttr !== 'false') archived = true;

    // Observation only — never allowed to throw into the publish path.
    const num = async (attr: string): Promise<number | null> => {
      const v = await postEl.getAttribute(attr).catch(() => null);
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    postScore = await num('score');
    commentCount = (await num('comment-count')) ?? (await num('commentcount'));
  }

  /* ---- have we already replied here ---- */
  let ownCommentPresent = false;
  if (!username) {
    unknown.push('no confirmed username — cannot check whether this account already replied');
  } else {
    const authors = await page
      .locator('shreddit-comment')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('author')))
      .catch(() => null);

    if (authors == null) {
      unknown.push('comment authors unreadable — cannot rule out a duplicate reply');
    } else {
      ownCommentPresent = authors.some((a) => a && a.toLowerCase() === username.toLowerCase());
    }
  }

  /* ---- composer ---- */
  // `firstUsable`, not `firstVisible`: the composer on a current thread page is present, enabled
  // and holding its own contenteditable while measuring 0 × 0, because two custom-element
  // ancestors are laid out `display: inline`. A visibility test read that as "no composer" and
  // refused to publish on a thread anyone can comment on. See firstUsable for the measurement.
  // Genuinely hidden and disabled composers are still refused, so this stays fail-closed.
  const editor = await firstUsable(page, sel.commentEditor);
  const trigger = editor ? null : await firstUsable(page, sel.commentBoxTrigger);
  const found = editor ?? trigger;
  const composerPresent = Boolean(found);
  if (!composerPresent && !locked && !archived) {
    anomalies.push('no comment composer and no lock notice — unexpected state, refusing rather than guessing');
  }

  return {
    locked, archived, ownCommentPresent, composerPresent,
    ...(found ? { composerVia: found.via } : {}),
    unknown, anomalies, postScore, commentCount
  };
}
