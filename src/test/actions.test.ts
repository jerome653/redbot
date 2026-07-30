/**
 * Target selection and confirmation verdicts in `reddit/actions.ts`, driven by a fake page.
 *
 * Nothing imported `actions.ts` before this file — ~560 lines whose whole job is taking
 * irreversible public actions, with no test on any of it, on the reading that "it needs a
 * browser". Most of it does. The part that decides WHICH element to act on, and whether what
 * came back afterwards counts as confirmation, does not: it needs something that answers
 * `locator`, `url`, `goto`, `reload` and `waitForURL` the way a Page does, and that is all.
 *
 * The fake below is deliberately literal. An element answers a selector STRING, exactly; there
 * is no CSS engine here. That is what makes each fixture readable as the claim it encodes —
 * "the post unit contains no upvote button, a comment does" is the live measurement of
 * 2026-07-27 (`button[upvote]` matched 5 elements on a detail page: index 0 the post, 1-4
 * comments) reduced to the shape where picking the wrong one is silent.
 *
 * No browser is launched and nothing here touches Reddit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';

const DATA = mkdtempSync(join(tmpdir(), 'redbot-actions-'));
process.env.REDBOT_DATA = DATA;
// An inherited REDBOT_ACCOUNT would make `config.ts` resolve a profile for an account that does
// not exist in this scratch data dir, and throw at import.
delete process.env.REDBOT_ACCOUNT;

const { config } = await import('../config.js');
const { saveThreads, threadId } = await import('../store.js');
type Thread = import('../types.js').Thread;

/**
 * Pacing is the rate-limit envelope measured in phase 8 (3.2-7s between actions, 40-150ms per
 * typed character, after 900-2600ms produced HTTP 429). It protects live Reddit. Nothing in this
 * file reaches Reddit, so here it buys nothing and costs the suite minutes — a `submitPost` test
 * types every character of its title and body.
 */
config.pacing.minActionMs = 0;
config.pacing.maxActionMs = 0;
config.pacing.typeCharMinMs = 0;
config.pacing.typeCharMaxMs = 0;

const { votePost, setSaved, submitPost } = await import('../reddit/actions.js');
const { voteTargetIsOurs } = await import('../runners.js');
const { PUBLISH_KINDS } = await import('../scheduler.js');

/* ------------------------------------------------------------------ *
 * The fake page
 * ------------------------------------------------------------------ */

interface El {
  /** The selector strings this element answers to. Matched exactly — no CSS is implemented. */
  sel: string[];
  /** Reported when the element is clicked, so a test can name the element that was hit. */
  id?: string;
  attrs?: Record<string, string>;
  text?: string;
  kids?: El[];
  hidden?: boolean;
}

const descendants = (el: El): El[] => (el.kids ?? []).flatMap((k) => [k, ...descendants(k)]);

class FakeLocator {
  constructor(private readonly page: FakePage, private readonly nodes: El[]) {}

  locator(selector: string): FakeLocator {
    // Descendants only, like a real locator — a scope never matches itself.
    const found = this.nodes.flatMap((n) => descendants(n).filter((d) => d.sel.includes(selector)));
    return new FakeLocator(this.page, found);
  }

  first(): FakeLocator { return new FakeLocator(this.page, this.nodes.slice(0, 1)); }
  nth(i: number): FakeLocator { return new FakeLocator(this.page, this.nodes.slice(i, i + 1)); }
  async count(): Promise<number> { return this.nodes.length; }
  async isVisible(): Promise<boolean> { const n = this.nodes[0]; return !!n && !n.hidden; }

  async innerText(): Promise<string> {
    const n = this.nodes[0];
    if (!n) throw new Error('locator.innerText: element is not attached to the DOM');
    return n.text ?? '';
  }

  async getAttribute(name: string): Promise<string | null> {
    const n = this.nodes[0];
    if (!n) throw new Error('locator.getAttribute: element is not attached to the DOM');
    return n.attrs?.[name] ?? null;
  }

  async scrollIntoViewIfNeeded(): Promise<void> {
    if (!this.nodes[0]) throw new Error('locator.scrollIntoViewIfNeeded: no element');
  }

  /**
   * A click on nothing THROWS, as Playwright's does after its actionability timeout. A fake that
   * quietly no-opped would hide the exact failure these tests exist to catch: code reaching for
   * an element that is not the one it means.
   */
  async click(): Promise<void> {
    const n = this.nodes[0];
    if (!n || n.hidden) throw new Error('locator.click: Timeout 10000ms exceeded');
    this.page.clicked.push(n.id ?? n.sel[0] ?? '(unnamed)');
  }
}

interface FakeSpec {
  url: string;
  tree: El[];
  /** What the page looks like after `reload()` — Reddit's answer to "is it still there?". */
  afterReload?: El[];
  /** What a navigation does to the URL, if one happens at all. */
  onWaitForURL?: (page: FakePage) => void;
}

class FakePage {
  readonly clicked: string[] = [];
  /** The timeout passed to each `waitForURL` call, in order. Empty = it never waited. */
  readonly waitedFor: Array<number | undefined> = [];
  typed = '';
  reloads = 0;
  private tree: El[];
  private currentUrl: string;

  readonly keyboard = {
    type: async (ch: string): Promise<void> => { this.typed += ch; },
    press: async (): Promise<void> => { /* Escape closes a menu; nothing to model */ }
  };

  constructor(private readonly spec: FakeSpec) {
    this.tree = spec.tree;
    this.currentUrl = spec.url;
  }

  url(): string { return this.currentUrl; }
  setUrl(u: string): void { this.currentUrl = u; }

  async goto(u: string): Promise<null> { this.currentUrl = u; return null; }

  async reload(): Promise<null> {
    this.reloads++;
    if (this.spec.afterReload) this.tree = this.spec.afterReload;
    return null;
  }

  locator(selector: string): FakeLocator {
    const root: El = { sel: [], kids: this.tree };
    return new FakeLocator(this, descendants(root).filter((d) => d.sel.includes(selector)));
  }

  /**
   * Resolves only when the predicate holds, and rejects otherwise — which is what Playwright
   * does, and is the whole point: a test can model "Reddit navigated away, slowly" and
   * "Reddit never navigated" as two different pages rather than as two different sleeps.
   */
  async waitForURL(pred: (u: URL) => boolean, opts?: { timeout?: number }): Promise<void> {
    this.waitedFor.push(opts?.timeout);
    this.spec.onWaitForURL?.(this);
    if (!pred(new URL(this.currentUrl))) {
      throw new Error(`page.waitForURL: Timeout ${opts?.timeout}ms exceeded`);
    }
  }

  asPage(): Page { return this as unknown as Page; }
}

const POST = 'https://www.reddit.com/r/Wordpress/comments/1v7kvj2/a_thread/';

/* ------------------------------------------------------------------ *
 * votePost — the scoped lookup is the safety property
 * ------------------------------------------------------------------ */

/**
 * The fixture is the measured hazard: the post unit has no vote control (not hydrated, or the
 * markup moved), the comments below it have four. An unscoped `.first()` upvotes a stranger's
 * comment under the operator's name, and there is no error anywhere to notice.
 */
const postWithoutVoteControl = (): El[] => [
  { sel: ['shreddit-post'], kids: [{ sel: ['h1', 'h1[slot="title"]'], text: 'a thread' }] },
  { sel: ['shreddit-comment'], kids: [{ id: 'comment-1-upvote', sel: ['button[upvote]'] }] },
  { sel: ['shreddit-comment'], kids: [{ id: 'comment-2-upvote', sel: ['button[upvote]'] }] }
];

test('votePost refuses when the post has no vote control, instead of taking a comment\'s', async () => {
  const page = new FakePage({ url: POST, tree: postWithoutVoteControl() });

  const r = await votePost(page.asPage(), POST, 'up');

  assert.equal(r.ok, false, 'absence refuses — module rule 2');
  assert.match(r.error ?? '', /upvote control inside the post/);
  assert.deepEqual(
    page.clicked, [],
    'a comment vote button must never be clicked because the post had none'
  );
});

/**
 * The confirmation read is the same hazard one step later, and worse: a fallback there lets a
 * click that landed on the wrong element be confirmed by re-reading that same wrong element.
 *
 * Here the post's own button IS clicked, and after the reload the post unit comes back without
 * it while a comment's button reads `aria-pressed="true"` — the state of that comment's own
 * vote, which says nothing about ours.
 */
test('votePost does not confirm the post vote from a comment button after the reload', async () => {
  const page = new FakePage({
    url: POST,
    tree: [
      {
        sel: ['shreddit-post'],
        kids: [{ id: 'post-upvote', sel: ['button[upvote]'], attrs: { 'aria-pressed': 'false' } }]
      },
      { sel: ['shreddit-comment'], kids: [{ id: 'comment-1-upvote', sel: ['button[upvote]'] }] }
    ],
    afterReload: [
      { sel: ['shreddit-post'], kids: [{ sel: ['h1'], text: 'a thread' }] },
      {
        sel: ['shreddit-comment'],
        kids: [{ id: 'comment-1-upvote', sel: ['button[upvote]'], attrs: { 'aria-pressed': 'true' } }]
      }
    ]
  });

  const r = await votePost(page.asPage(), POST, 'up');

  assert.deepEqual(page.clicked, ['post-upvote'], 'the post button is the one that gets clicked');
  assert.equal(page.reloads, 1, 'confirmation comes from a reload, never from the clicked node');
  assert.notEqual(r.confirmed, true, 'a comment\'s aria-pressed is not evidence about the post');
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /may or may not/);
  // "did not persist" is a specific claim about the SERVER discarding the vote. Nothing here
  // observed that, and saying it would send an operator looking for the wrong problem.
  assert.doesNotMatch(r.error ?? '', /did not persist|discarded/);
});

test('votePost leaves an already-upvoted post alone rather than removing the vote', async () => {
  const page = new FakePage({
    url: POST,
    tree: [{
      sel: ['shreddit-post'],
      kids: [{ id: 'post-upvote', sel: ['button[upvote]'], attrs: { 'aria-pressed': 'true' } }]
    }]
  });

  const r = await votePost(page.asPage(), POST, 'up');

  assert.equal(r.ok, true);
  assert.equal(r.confirmed, true);
  assert.deepEqual(page.clicked, [], 'clicking again would REMOVE the vote');
  assert.match(r.error ?? '', /already upvoted/);
});

/* ------------------------------------------------------------------ *
 * setSaved — the overflow menu has the same shape of hazard
 * ------------------------------------------------------------------ */

/**
 * `sel.overflowMenu` ends with a bare `button[aria-label*="more options" i]`, which every
 * comment on a detail page carries. Reaching for it page-wide opens a COMMENT's menu, and the
 * next thing this function does is click "Save" in whatever menu opened.
 *
 * On the old code this path also failed — but with `locator.click: Timeout`, which describes a
 * flaky selector rather than a refusal, and only after having reached for a comment's control.
 */
test('setSaved refuses when the post has no overflow menu, instead of opening a comment\'s', async () => {
  const page = new FakePage({
    url: POST,
    tree: [
      { sel: ['shreddit-post'], kids: [{ sel: ['h1'], text: 'a thread' }] },
      {
        sel: ['shreddit-comment'],
        kids: [{ id: 'comment-1-more', sel: ['button[aria-label*="more options" i]'] }]
      }
    ]
  });

  const r = await setSaved(page.asPage(), POST, true);

  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /overflow menu inside the post/);
  assert.deepEqual(page.clicked, [], 'a comment overflow menu must never be opened here');
});

/* ------------------------------------------------------------------ *
 * submitPost — an ambiguous landing is not a refusal
 * ------------------------------------------------------------------ */

const submitForm = (): El[] => [
  { id: 'title', sel: ['textarea[name="title"]'] },
  { id: 'body', sel: ['shreddit-composer div[contenteditable="true"]'] },
  { id: 'submit', sel: ['button[type="submit"]:has-text("Post")'] }
];

const SUBMIT = 'https://www.reddit.com/r/test/submit/?type=TEXT';

test('submitPost waits for the navigation with an explicit timeout rather than sleeping at it', async () => {
  const page = new FakePage({
    url: 'about:blank',
    tree: submitForm(),
    // The URL never moves. A refusal and an accept the page has not caught up with are
    // indistinguishable from here, which is the finding this branch has to report.
    onWaitForURL: () => { /* still on the form */ }
  });

  const r = await submitPost(page.asPage(), { subreddit: 'test', title: 'A title', body: 'A body' });

  assert.equal(page.waitedFor.length, 1, 'it must wait for the navigation, not sleep a flat 4s at it');
  assert.ok((page.waitedFor[0] ?? 0) > 0, 'waitForURL defaults to waiting forever — a timeout is required');
  assert.notEqual(r.ok, false, 'a timeout is ambiguity; asserting refusal invites a duplicate thread');
  assert.equal(r.confirmed, false, 'and it is never reported as confirmed');
  assert.match(r.error ?? '', /before submitting again/);
  assert.equal(page.typed, 'A titleA body', 'the form was actually filled in');
});

/**
 * The case the flat sleep got wrong: Reddit accepted the post and navigated a moment later than
 * 4000ms. The old code read the URL once, still saw `/submit`, and called it a refusal — and the
 * response to a refusal is to submit again, which is a duplicate public thread.
 */
test('submitPost reports a slow but successful navigation as the success it is', async () => {
  const permalink = 'https://www.reddit.com/r/test/comments/1v7kvj2/a_title/';
  const page = new FakePage({
    url: 'about:blank',
    tree: submitForm(),
    onWaitForURL: (p) => p.setUrl(permalink)
  });

  const r = await submitPost(page.asPage(), { subreddit: 'test', title: 'A title', body: 'A body' });

  assert.equal(r.ok, true);
  assert.equal(r.permalink, permalink);
  assert.equal(r.confirmed, true);
});

/**
 * Locks the branch that was already honest, so the fix to its neighbour cannot quietly change
 * it: landing somewhere that is not a permalink is `ok` but UNCONFIRMED.
 */
test('submitPost still reports a non-permalink landing as unconfirmed', async () => {
  const page = new FakePage({
    url: 'about:blank',
    tree: submitForm(),
    // MEASURED 2026-07-27: a real submission left the browser on /r/test/, the subreddit index.
    onWaitForURL: (p) => p.setUrl('https://www.reddit.com/r/test/')
  });

  const r = await submitPost(page.asPage(), { subreddit: 'test', title: 'A title', body: 'A body' });

  assert.equal(r.ok, true);
  assert.equal(r.confirmed, false);
  assert.equal(r.permalink, undefined, 'the subreddit index is not a permalink');
  assert.match(r.error ?? '', /confirm/);
});

test('submitPost refuses a form that did not load, without typing anything into the page', async () => {
  const page = new FakePage({ url: 'about:blank', tree: [] });

  const r = await submitPost(page.asPage(), { subreddit: 'test', title: 'A title', body: 'A body' });

  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /submit form did not load/);
  assert.equal(page.typed, '');
  assert.equal(page.waitedFor.length, 0);
});

/* ------------------------------------------------------------------ *
 * runners.ts — the decisions that need no browser
 * ------------------------------------------------------------------ */

/**
 * Pins the comment above the `post` runner to the constant it describes. The comment used to
 * assert the opposite — that `post` was NOT in PUBLISH_KINDS — which is the more dangerous
 * direction to be wrong in, because it reads as "this runner may be scheduled".
 *
 * The runtime guarantee (the scheduler never invokes the runner) is pinned separately in
 * jobs.test.ts; this is the documentation half of the same property.
 */
test('the post runner sits behind PUBLISH_KINDS, exactly as its comment says', () => {
  assert.ok(PUBLISH_KINDS.includes('post'));
  assert.ok(PUBLISH_KINDS.includes('reply-comment'));
});

/** A complete Thread — every field the store round-trips, so the fixture is not a partial. */
function thread(id: string, permalink: string, author: string): Thread {
  return {
    id, permalink, author,
    title: 'fixture', subreddit: 'x',
    upvotes: null, commentCount: null, ageText: null, ageMinutes: null,
    body: null, comments: [],
    collectedAt: new Date().toISOString(), source: 'read'
  };
}

test('a vote target with no thread on record is refused — the guard fails closed', async () => {
  const r = await voteTargetIsOurs('https://www.reddit.com/r/x/comments/unknown/nope/');
  assert.equal(r.blocked, true);
  assert.match(r.why ?? '', /cannot establish who wrote it/);
});

test('a vote on our own account\'s thread is refused as vote manipulation', async () => {
  const ours = 'https://www.reddit.com/r/x/comments/ours/hi/';
  const theirs = 'https://www.reddit.com/r/x/comments/theirs/hi/';

  // accounts.json is still a file — it is configuration a person writes, not domain state.
  writeFileSync(
    join(DATA, 'accounts.json'),
    JSON.stringify({ accounts: [{ handle: 'docs-architect', cdpPort: 9222, profileDir: 'p' }] })
  );

  // Threads live in Postgres now, so the fixture is a real row rather than a JSON file.
  // The ids go through threadId() because threads constrains id to 12 hex chars —
  // the same shape the engine has always generated.
  await saveThreads([
    thread(threadId(ours), ours, 'Docs-Architect'),
    thread(threadId(theirs), theirs, 'somebody-else')
  ]);

  const mine = await voteTargetIsOurs(ours);
  assert.equal(mine.blocked, true);
  assert.match(mine.why ?? '', /vote manipulation/);

  assert.equal((await voteTargetIsOurs(theirs)).blocked, false);
});

process.on('exit', () => {
  try { rmSync(DATA, { recursive: true, force: true }); } catch { /* the temp dir is disposable */ }
});
