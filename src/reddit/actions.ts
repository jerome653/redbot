/**
 * Write actions beyond the top-level comment: replying to a comment, submitting a post,
 * voting, saving and following.
 *
 * `post.ts` stays what it was — the comment publish path, unchanged, with its own confirmation
 * and its own history rows. This module is the rest of the operator's hands, and every function
 * here follows the same three rules it established:
 *
 *   1. **Confirm from the page, never from the click.** A control that was clicked is not an
 *      action that happened. Where Reddit exposes state (`aria-pressed`, a label that flips
 *      from Save to Unsave) it is read back; where it does not, the result says so rather than
 *      reporting success it cannot see.
 *   2. **Absence refuses.** A control that cannot be found returns `ok: false` with the reason.
 *      No fallbacks that "probably" hit the right element.
 *   3. **The caller logs.** These take a page and return a result; history and job state are
 *      the caller's business, so the same function is usable from a job runner, the CLI, or a
 *      test without any of them inheriting the others' side effects.
 *
 * ⚠ The selectors these depend on are marked UNVERIFIED in `selectors.ts` — written from
 * Reddit's component names, never resolved against a live signed-in DOM. The failure mode is
 * "control not found → refuse", which is safe, but the first live run should confirm each one.
 */
import type { Page, Locator } from 'playwright';
import { sel } from './selectors.js';
import { firstVisible } from './scrape.js';
import { pause, sleep, typingDelay } from '../pacing.js';

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** What the page showed afterwards, when it showed anything. Absent = could not confirm. */
  confirmed?: boolean;
  url?: string;
  /** For submissions: the permalink of what was created, when Reddit exposes it. */
  permalink?: string;
}

async function typeHuman(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(typingDelay());
  }
}

/** First matching control inside a scope, or null. Mirrors `firstVisible` for sub-trees. */
async function within(scope: Locator, candidates: readonly string[]): Promise<Locator | null> {
  for (const c of candidates) {
    const found = scope.locator(c).first();
    try {
      if (await found.isVisible({ timeout: 800 })) return found;
    } catch { /* not present in this scope */ }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Replying to a comment
 * ------------------------------------------------------------------ */

/**
 * Reply to one comment rather than to the post.
 *
 * `publishComment` always writes a top-level reply, because it opens the page composer. Answering
 * a specific person needs the composer that belongs to their comment, so the comment is located
 * first and every control is scoped inside it. A reply that lands in the wrong place is not a
 * cosmetic error — it answers someone who did not ask.
 */
export async function replyToComment(
  page: Page,
  permalink: string,
  commentId: string,
  body: string
): Promise<ActionResult> {
  try {
    await page.goto(permalink, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await pause();

    const comment = page
      .locator(`${sel.commentNode[0]}[thingid="${commentId}"], ${sel.commentNode[0]}[id="${commentId}"]`)
      .first();
    if (!(await comment.isVisible({ timeout: 3000 }).catch(() => false))) {
      return { ok: false, error: `comment ${commentId} is not on the page — deleted, collapsed, or on another page of comments` };
    }

    const replyBtn = await within(comment, sel.commentReplyButton);
    if (!replyBtn) return { ok: false, error: 'no reply control on that comment — thread locked, or archived' };
    await replyBtn.click();
    await pause();

    // The composer opens inside the comment's own subtree; taking a page-level editor here is
    // how a reply ends up attached to the post instead of the person.
    const editor = await within(comment, sel.commentEditor);
    if (!editor) return { ok: false, error: 'the reply composer did not open on that comment' };

    await editor.click();
    await sleep(400);
    await typeHuman(page, body);
    await pause();

    const submit = await within(comment, sel.commentSubmit);
    if (!submit) return { ok: false, error: 'no submit control in the reply composer' };
    await submit.click();
    await sleep(3500);

    const landed = await comment.innerText()
      .then((t) => t.replace(/\s+/g, ' ').includes(body.replace(/\s+/g, ' ').slice(0, 60)))
      .catch(() => false);

    return { ok: true, url: page.url(), confirmed: landed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------------ *
 * Submitting a post
 * ------------------------------------------------------------------ */

export interface SubmitPostInput {
  subreddit: string;
  title: string;
  body: string;
}

/**
 * Submit a text post to a subreddit.
 *
 * Deliberately does not handle flair. Subreddits that require it will refuse the submission,
 * and that refusal is reported as-is — guessing a flair is choosing how a post is categorised
 * in a community, which is an editorial decision and not one to make from a selector list.
 */
export async function submitPost(page: Page, input: SubmitPostInput): Promise<ActionResult> {
  try {
    const url = `https://www.reddit.com/r/${input.subreddit}/submit/?type=TEXT`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await pause();

    const title = await firstVisible(page, sel.postTitleField);
    if (!title) {
      return { ok: false, error: 'the submit form did not load — signed out, or this subreddit does not accept text posts' };
    }
    await title.click();
    await typeHuman(page, input.title);
    await pause();

    const bodyField = await firstVisible(page, sel.postBodyField);
    if (!bodyField) return { ok: false, error: 'no body field on the submit form' };
    await bodyField.click();
    await sleep(400);
    await typeHuman(page, input.body);
    await pause();

    const submit = await firstVisible(page, sel.postSubmitButton);
    if (!submit) return { ok: false, error: 'no submit control on the form' };

    const before = page.url();
    await submit.click();

    /**
     * Wait for the navigation; do not sleep at it.
     *
     * Until 2026-07-27 this slept a flat 4000ms and then read `page.url()` once, and anything
     * still on `/submit` was reported as a definitive refusal. A submission Reddit ACCEPTED but
     * navigated away from more slowly than that reads exactly the same from here — and the only
     * sensible response to "refused" is to submit again, which publishes a duplicate public
     * thread. A race is the one thing this function must not turn into a verdict.
     *
     * The explicit timeout is load-bearing: `waitForURL`'s default is 0, which means wait for
     * ever, and a genuinely refused submission never navigates.
     */
    let leftTheForm = true;
    try {
      await page.waitForURL((u) => !u.pathname.includes('/submit'), {
        timeout: 30_000,
        waitUntil: 'domcontentloaded'
      });
    } catch {
      leftTheForm = false;
    }

    const after = page.url();

    /**
     * Still on the form after that wait is AMBIGUOUS, and is reported as ambiguous.
     *
     * A missing required flair, a karma or account-age minimum and an automod rule all land
     * here — and so does a post that went through while Reddit took longer than 30s to move.
     * The URL cannot tell them apart, so this says so and leaves the judgement to a person,
     * exactly as the non-permalink landing below already does. `confirmed: false` is what makes
     * it safe: the confirmation contract in `runners.ts` fails the job on anything that is not
     * confirmed, so nothing downstream can read this as a success.
     */
    if (!leftTheForm) {
      return {
        ok: true,
        url: after,
        confirmed: false,
        error:
          `still on the submit form 30s after posting — either the subreddit refused it (flair ` +
          `required, karma or age minimum, or automod) or it was accepted and the page has not ` +
          `moved. Check the account's profile before submitting again: a resubmit of a post that ` +
          `was actually accepted creates a duplicate public thread.`
      };
    }

    /**
     * A created post lands on its own permalink, which always contains `/comments/`.
     *
     * MEASURED 2026-07-27: the first real submission left the browser on `/r/test/` — the
     * subreddit index, not the post — and the old check passed because the URL was merely no
     * longer `/submit`. It reported `ok: true` with `permalink: https://www.reddit.com/r/test/`,
     * which is not a post. The thread HAD been created (found on the account's profile at
     * `/r/test/comments/1v7kvj2/…`), so the action worked and the confirmation lied about what
     * it produced — the same weak-confirmation family as reading a vote button we just clicked.
     *
     * Landing somewhere else is therefore reported as unconfirmed, with the URL we actually got.
     * A caller that needs the permalink can read it off the account's submitted list.
     */
    if (!/\/comments\/[a-z0-9]+/i.test(after)) {
      return {
        ok: true,
        url: after,
        confirmed: false,
        error:
          `submitted, but the browser landed on ${after} rather than a post permalink — the ` +
          `thread may exist; confirm on the account's profile before assuming either way`
      };
    }

    return { ok: true, url: after, permalink: after, confirmed: after !== before };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------------ *
 * Voting
 * ------------------------------------------------------------------ */

export type VoteDirection = 'up' | 'down';

/**
 * Vote on a post.
 *
 * Reddit's vote buttons are toggles and expose `aria-pressed`, so the state is read before and
 * after. Voting when the target is already in that state would silently REMOVE the vote — the
 * opposite of what was asked — so an already-voted target is reported as already voted and left
 * alone.
 *
 * Caller obligations this function cannot enforce on its own: never vote on another configured
 * account's content (`accounts.json`), and never vote as part of an automated pass. Both are
 * enforced by the job layer, which knows what the other accounts are; this function only knows
 * about a page.
 */
export async function votePost(
  page: Page,
  permalink: string,
  direction: VoteDirection
): Promise<ActionResult> {
  try {
    await page.goto(permalink, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await pause();

    /**
     * Scope to the post before looking for a vote button.
     *
     * MEASURED LIVE 2026-07-27: on a post detail page `button[upvote]` matches **5** elements —
     * index 0 belongs to `shreddit-post`, indices 1-4 to `shreddit-comment-action-row`. An
     * unscoped `.first()` is therefore one DOM reordering away from upvoting a random comment
     * instead of the post, which is a wrong public action with no error to notice.
     *
     * The first live attempt also failed outright: `locator.click: Timeout 30000ms exceeded —
     * waiting for element to be visible, enabled and stable`, on an element that was visible
     * and enabled. Scoping plus an explicit scroll fixed it, verified by aria-pressed going
     * false → true on r/Wordpress as docs-architect.
     *
     * There is deliberately no page-level fallback. `?? firstVisible(page, candidates)` used to
     * follow this lookup and handed back precisely the comment button the scoping exists to
     * avoid, on exactly the occasions the scoping was needed — it reinstated the hazard the
     * comment above describes, and it read as safety. Rule 2 of this module's header applies
     * with no exception: absence refuses.
     */
    const postScope = page.locator(sel.postUnit[0]).first();
    const candidates = direction === 'up' ? sel.upvoteButton : sel.downvoteButton;
    const button = await within(postScope, candidates);
    if (!button) {
      return {
        ok: false,
        error:
          `no ${direction}vote control inside the post unit — signed out, the post is archived, ` +
          `or ${sel.postUnit[0]} did not render. Refusing rather than taking the first ` +
          `${direction}vote button on the page, which on a detail page belongs to a comment.`
      };
    }

    // Reddit renders the action bar below the fold on a long post; the actionability check
    // fails on an element the viewport has never reached.
    await button.scrollIntoViewIfNeeded().catch(() => { /* already in view */ });
    await sleep(600);

    const pressedBefore = await button.getAttribute('aria-pressed').catch(() => null);
    if (pressedBefore === 'true') {
      return {
        ok: true,
        confirmed: true,
        url: page.url(),
        error: `already ${direction}voted — clicking again would remove the vote, so nothing was done`
      };
    }

    await button.click();
    await sleep(1500);

    /**
     * Confirm by RELOADING, not by re-reading the button we just clicked.
     *
     * MEASURED 2026-07-27, and this is the whole reason the check changed. A downvote as
     * docs-architect (karma 1) sets `aria-pressed="true"` on the node immediately — and a
     * reload shows `false` with the score unmoved at 3. Reddit's UI is optimistic: it renders
     * the vote locally and the server discards it, silently, with no error anywhere.
     *
     * Reading the same node 1.2s after the click therefore measured our own click, not the
     * outcome, and the runner recorded `confirmed: true` for a vote that never existed. That
     * is the shadow-removal failure this project already documents for comments, one action
     * across. Persistence can only be established by asking the server again.
     *
     * The read-back is scoped, and has no fallback either — for a sharper reason than the click
     * does. A page-level fallback here reads a COMMENT's `aria-pressed`, so a click that landed
     * on the wrong element is confirmed by re-reading that same wrong element: a confirmation
     * that agrees with itself whatever happened.
     */
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
    await sleep(2500);

    const after = await within(page.locator(sel.postUnit[0]).first(), candidates);
    if (!after) {
      // Reported as unread, not as discarded: "the vote did not persist" is a specific claim
      // about what the server did with it, and nothing here observed that.
      return {
        ok: false,
        url: page.url(),
        error:
          `the ${direction}vote was clicked, but after the reload no ${direction}vote control ` +
          `could be found inside the post unit, so the outcome was never read — the vote may or ` +
          `may not have registered. Check the post before voting again.`
      };
    }
    const pressedAfter = await after.getAttribute('aria-pressed').catch(() => null);
    const persisted = pressedAfter === 'true';

    return {
      ok: persisted,
      url: page.url(),
      ...(pressedAfter === null ? {} : { confirmed: persisted }),
      ...(persisted ? {} : {
        error:
          `the ${direction}vote did not persist — it appeared in the page and was gone after a ` +
          `reload. Reddit accepted the click and discarded the vote, which a new or ` +
          `low-karma account should expect. Nothing is wrong with the selector.`
      })
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------------ *
 * Save / unsave
 * ------------------------------------------------------------------ */

export async function setSaved(page: Page, permalink: string, saved: boolean): Promise<ActionResult> {
  try {
    await page.goto(permalink, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await pause();

    /**
     * Scoped to the post: a detail page has one overflow menu per post AND one per comment.
     *
     * No page-level fallback, for a reason specific to this selector group — `sel.overflowMenu`
     * ends with a bare `button[aria-label*="more options" i]`, which every comment carries. A
     * fallback here does not degrade to "the wrong post", it opens a COMMENT's menu, and the
     * next thing this function does is click Save in whatever menu opened. Absence refuses.
     */
    const postScope = page.locator(sel.postUnit[0]).first();
    const menu = await within(postScope, sel.overflowMenu);
    if (!menu) {
      return {
        ok: false,
        error:
          `no overflow menu inside the post unit — signed out, or ${sel.postUnit[0]} did not ` +
          `render. Refusing rather than opening the first "more options" menu on the page, ` +
          `which belongs to a comment.`
      };
    }

    await menu.scrollIntoViewIfNeeded().catch(() => { /* already in view */ });
    await sleep(400);
    // The host element is not itself clickable; its trigger is the button inside it.
    const trigger = menu.locator('button').first();
    await trigger.click({ timeout: 10_000 });
    await pause();

    /**
     * Pick the item by its exact label, in code.
     *
     * The menu shows exactly one of Save / Unsave, so the label that is present also reports
     * the current state. Matching is done here rather than in a selector because `:has-text`
     * is a substring test — "Save" matches "Unsave" — and `:text-is` fails on these items,
     * which wrap their label in nested markup. Both were measured live on 2026-07-27.
     */
    /**
     * MEASURED LIVE 2026-07-27: the un-save label is **"Remove from saved"**, not "Unsave".
     * Verified by saving a post through this code path and re-reading the menu, which went from
     * ["Follow post","Award this post","Save","Hide","Report"] to
     * ["Follow post","Award this post","Remove from saved","Hide","Report"].
     * "Unsave" is kept as an accepted alternative for older or A/B'd markup.
     */
    const SAVE_LABELS = ['save'];
    const UNSAVE_LABELS = ['remove from saved', 'unsave'];
    const wanted = saved ? SAVE_LABELS : UNSAVE_LABELS;
    const items = page.locator(sel.overflowMenuItem[0]!);
    const n = await items.count();
    let target: Locator | null = null;
    const labels: string[] = [];

    for (let i = 0; i < n; i++) {
      const item = items.nth(i);
      const text = (await item.innerText().catch(() => ''))
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (text) labels.push(text);
      if (wanted.includes(text)) { target = item; break; }
    }

    if (!target) {
      // Not a failure: the opposite label being present is how Reddit reports the current state.
      const opposite = saved ? UNSAVE_LABELS : SAVE_LABELS;
      const alreadyThere = labels.some((l) => opposite.includes(l));
      await page.keyboard.press('Escape').catch(() => { /* menu may already be closed */ });
      return {
        ok: alreadyThere,
        confirmed: alreadyThere,
        ...(alreadyThere
          ? { error: `already ${saved ? 'saved' : 'not saved'} — the menu offers "${opposite}"` }
          : { error: `no "${wanted}" item in the overflow menu (saw: ${labels.join(', ') || 'nothing'})` })
      };
    }

    await target.click({ timeout: 10_000 });
    await sleep(1500);

    /**
     * Confirm from a reload, not from the click.
     *
     * Until 2026-07-27 this returned `ok: true` here and stopped. Clicking "Save" is not
     * evidence that anything was saved — it is the same assumption that let a discarded vote
     * and a non-existent post both report success. The menu is the state: it offers exactly one
     * of Save / Remove from saved, so re-opening it after a reload says what Reddit actually
     * believes.
     */
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
    await sleep(2000);

    // Scoped for the same reason as the first lookup, and with the same refusal: reading a
    // comment's menu back would "confirm" the save from a menu that was never touched.
    const menu2 = await within(page.locator(sel.postUnit[0]).first(), sel.overflowMenu);
    if (!menu2) {
      return {
        ok: true,
        confirmed: false,
        url: page.url(),
        error: "could not re-open the post's own overflow menu to confirm"
      };
    }
    await menu2.scrollIntoViewIfNeeded().catch(() => { /* already in view */ });
    await menu2.locator('button').first().click({ timeout: 10_000 }).catch(() => { /* stays closed */ });
    await sleep(1200);

    const after = page.locator(sel.overflowMenuItem[0]!);
    const afterN = await after.count();
    const afterLabels: string[] = [];
    for (let i = 0; i < afterN; i++) {
      const t = (await after.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim().toLowerCase();
      if (t) afterLabels.push(t);
    }
    await page.keyboard.press('Escape').catch(() => { /* menu may already be closed */ });

    // Saved means the menu now offers the UNSAVE label, and vice versa.
    const expected = saved ? UNSAVE_LABELS : SAVE_LABELS;
    const flipped = afterLabels.some((l) => expected.includes(l));

    return {
      ok: true,
      confirmed: flipped,
      url: page.url(),
      ...(flipped ? {} : { error: `after a reload the menu still offers ${JSON.stringify(afterLabels)}` })
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------------ *
 * Follow / unfollow
 * ------------------------------------------------------------------ */

/**
 * Follow or unfollow a user or a subreddit.
 *
 * `target` is a path fragment — `user/somebody` or `r/WordPress` — because the control is the
 * same component on both surfaces and the only difference is which page it sits on.
 */
export async function setFollowing(
  page: Page,
  target: string,
  following: boolean
): Promise<ActionResult> {
  if (!/^(?:user|r)\/[A-Za-z0-9_-]{1,40}$/.test(target)) {
    return { ok: false, error: `"${target}" is not a user/<name> or r/<name> path` };
  }
  try {
    await page.goto(`https://www.reddit.com/${target}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await pause();

    const [kind, name] = target.split('/') as ['user' | 'r', string];

    /**
     * A subreddit is addressed by attribute, never by position.
     *
     * MEASURED 2026-07-27: r/Wordpress renders 12 `shreddit-join-button` hosts, 11 of which
     * belong to the sidebar's related-communities list. Taking the first would have joined
     * r/webdev. The host carries the community name, so the right control can be named
     * outright — and if the attribute lookup finds nothing, this refuses rather than falling
     * back to a positional guess.
     */
    const labels = { join: ['join'], leave: ['joined', 'leave'], follow: ['follow'], unfollow: ['unfollow'] };
    const wanted = kind === 'r'
      ? (following ? labels.join : labels.leave)
      : (following ? labels.follow : labels.unfollow);

    /**
     * The community name lives on the `name` attribute — MEASURED 2026-07-27. The host also
     * carries `subreddit-id` (`t5_2qhjq` for r/Wordpress) and `subscribe-label` /
     * `unsubscribe-label`, but `name` is the one that reads as the community. An earlier guess
     * at a `subreddit` attribute matched nothing, and the job failed closed with "no join
     * control" — the correct failure for a selector that finds nothing. It refused rather than
     * joining one of the eleven sidebar communities.
     */
    const host = kind === 'r'
      ? page.locator(`${sel.joinButtonHost[0]}[name="${name}" i]`).first()
      : null;

    if (host && (await host.count().catch(() => 0)) === 0) {
      return { ok: false, error: `no join control for r/${name} on that page — renamed, private, or banned?` };
    }

    /**
     * Exact label, in code. `:has-text("Follow")` is a substring test and returns the
     * **Unfollow** button on a profile that has both — measured on user/spez, where the page
     * carries "Follow", "Unfollow" AND "Join" at once.
     */
    const buttons = (host ?? page).locator('button');
    const n = await buttons.count();
    let target_btn: Locator | null = null;
    const seen: string[] = [];

    /**
     * The control must be VISIBLE, not merely present.
     *
     * MEASURED 2026-07-27 on a user profile: Reddit renders both buttons and toggles which one
     * is shown. `Unfollow` sits in the DOM at index 21 with a zero-size box, and the live
     * `Follow` is index 22 at y=132. Matching on label alone finds the hidden one and the click
     * then times out against an element nobody can see — so the visible control is the only one
     * that reports the current state, and the only one that can be clicked.
     */
    for (let i = 0; i < n; i++) {
      const b = buttons.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      const text = (await b.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().toLowerCase();
      if (text) seen.push(text);
      if (wanted.includes(text)) { target_btn = b; break; }
    }

    if (!target_btn) {
      // The opposite label being present is how Reddit reports the current state.
      const opposite = kind === 'r'
        ? (following ? labels.leave : labels.join)
        : (following ? labels.unfollow : labels.follow);
      const already = seen.some((s) => opposite.includes(s));
      return {
        ok: already,
        confirmed: already,
        error: already
          ? `already ${following ? 'joined/following' : 'not joined/following'} — the control offers "${opposite[0]}"`
          : `no "${wanted[0]}" control on ${target} (saw: ${seen.slice(0, 6).join(', ') || 'nothing'})`
      };
    }

    await target_btn.scrollIntoViewIfNeeded().catch(() => { /* already in view */ });
    await sleep(400);
    await target_btn.click({ timeout: 10_000 });
    await sleep(1800);

    /**
     * Confirm from a reload. The visible control is the state — Reddit renders both buttons and
     * toggles which one is shown — so after the action the OPPOSITE label should be the visible
     * one. Reading it without a reload would only tell us the button we clicked re-rendered.
     */
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
    await sleep(2200);

    const after = (host ?? page).locator('button');
    const afterN = await after.count();
    const opposite = kind === 'r'
      ? (following ? labels.leave : labels.join)
      : (following ? labels.unfollow : labels.follow);

    let flipped = false;
    const afterLabels: string[] = [];
    for (let i = 0; i < afterN; i++) {
      const b = after.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      const t = (await b.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().toLowerCase();
      if (!t) continue;
      afterLabels.push(t);
      if (opposite.includes(t)) { flipped = true; break; }
    }

    return {
      ok: true,
      confirmed: flipped,
      url: page.url(),
      ...(flipped ? {} : { error: `after a reload the visible control still reads ${JSON.stringify(afterLabels.slice(0, 4))}` })
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
