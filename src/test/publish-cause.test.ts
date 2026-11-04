/**
 * A publish failure must name ONE measured cause, and a landing must be verified before
 * anything is called a failure. Driven by a fake page — no browser, no Reddit, no network.
 *
 * MEASURED on cardinal, live `history` rows of kind `publish.fail`:
 *
 *   2026-10-30T17:42:23Z nathandigital7      "comment composer not found — logged out, or thread locked?"
 *   2026-10-28T13:28:21Z kylegrowth          same message
 *   2026-10-26T20:59:47Z dylanwebspace       same message
 *   2026-10-29T03:47:42Z Big_Variation_8580  "submit button not found, or still disabled"
 *   2026-10-26T18:37:30Z evanwebtalk         "submitted but the comment was not found on the page afterwards"
 *
 * Three of those five ORed three different causes — signed out, thread locked, selector drift —
 * and an operator cannot act on an OR. The fifth is worse: the comment may well have landed, and
 * "failed" is the one reading that invites a re-submit, which cannot be taken back.
 *
 * The fake page is deliberately literal: an element answers selector STRINGS exactly, there is
 * no CSS engine. Each fixture therefore reads as the claim it encodes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-publish-cause-'));
// An inherited account would make config.ts resolve a profile that does not exist here.
delete process.env.REDBOT_ACCOUNT;

const { config } = await import('../config.js');
config.pacing.minActionMs = 0;
config.pacing.maxActionMs = 0;
config.pacing.typeCharMinMs = 0;
config.pacing.typeCharMaxMs = 0;

const { publishComment } = await import('../reddit/post.js');
const { explainBlockedPublish, explainMissingSubmit } = await import('../reddit/publish-state.js');

const PERMALINK = 'https://www.reddit.com/r/Wordpress/comments/1v7kvj2/a_thread/';
const BODY = 'Check the PHP error log first — a 502 from admin-ajax.php after a PHP 8.2 upgrade is usually a fatal in a plugin that has not caught up.';
const noWait = async (): Promise<void> => { /* the suite does not sleep; pacing is a live concern */ };

/* ------------------------------------------------------------------ *
 * The fake page
 * ------------------------------------------------------------------ */

interface El {
  /** Selector strings this element answers to, matched exactly. */
  sel: string[];
  id?: string;
  attrs?: Record<string, string>;
  text?: string;
  kids?: El[];
  hidden?: boolean;
  /** undefined means `isEditable` THROWS, as it does on anything that is not a form control. */
  editable?: boolean;
  disabled?: boolean;
  /**
   * The click lands and THEN throws — a submit that navigates the page out from under Playwright.
   * The click is recorded before the throw, because it really did happen.
   */
  throwsAfterDispatch?: boolean;
}

interface CommentNode { text: string; permalink: string | null; id: string | null }

const descendants = (el: El): El[] => (el.kids ?? []).flatMap((k) => [k, ...descendants(k)]);

class FakeLocator {
  constructor(private readonly page: FakePage, private readonly nodes: El[]) {}

  locator(selector: string): FakeLocator {
    return new FakeLocator(this.page, this.nodes.flatMap((n) => descendants(n).filter((d) => d.sel.includes(selector))));
  }
  first(): FakeLocator { return new FakeLocator(this.page, this.nodes.slice(0, 1)); }
  async count(): Promise<number> { return this.nodes.length; }
  async isVisible(): Promise<boolean> { const n = this.nodes[0]; return !!n && !n.hidden; }
  async isEnabled(): Promise<boolean> { const n = this.nodes[0]; if (!n) throw new Error('isEnabled: no element'); return !n.disabled; }
  async isEditable(): Promise<boolean> {
    const n = this.nodes[0];
    if (!n || n.editable === undefined) throw new Error('isEditable: Element is not an <input>, <textarea> or [contenteditable]');
    return n.editable;
  }
  /** The computed-style probe in `firstUsable`: present and not hidden. */
  async evaluate(): Promise<boolean> { const n = this.nodes[0]; return !!n && !n.hidden; }
  async innerText(): Promise<string> {
    const n = this.nodes[0];
    if (!n) throw new Error('innerText: element is not attached to the DOM');
    return n.text ?? '';
  }
  async textContent(): Promise<string> { return this.innerText(); }
  async getAttribute(name: string): Promise<string | null> {
    const n = this.nodes[0];
    if (!n) throw new Error('getAttribute: element is not attached to the DOM');
    return n.attrs?.[name] ?? null;
  }
  async scrollIntoViewIfNeeded(): Promise<void> { if (!this.nodes[0]) throw new Error('no element'); }
  async click(): Promise<void> {
    const n = this.nodes[0];
    if (!n || n.hidden || n.disabled) throw new Error('locator.click: Timeout 10000ms exceeded');
    this.page.clicked.push(n.id ?? n.sel[0] ?? '(unnamed)');
    if (n.throwsAfterDispatch) {
      throw new Error('locator.click: Execution context was destroyed, most likely because of a navigation');
    }
  }
}

interface FakeSpec {
  tree: El[];
  bodyText?: string;
  /** Comment nodes the page reports before any fresh navigation. */
  comments?: CommentNode[];
  /** Comment nodes once the page has been navigated again — a late-rendering reply. */
  commentsAfterNavigation?: CommentNode[];
}

class FakePage {
  readonly clicked: string[] = [];
  readonly gotos: string[] = [];
  typed = '';
  private navigations = 0;

  readonly keyboard = { type: async (ch: string): Promise<void> => { this.typed += ch; } };

  constructor(private readonly spec: FakeSpec) {}

  url(): string { return PERMALINK; }
  async goto(u: string): Promise<null> { this.gotos.push(u); this.navigations++; return null; }

  locator(selector: string): FakeLocator {
    const body: El = { sel: ['body'], text: this.spec.bodyText ?? 'a normal thread page' };
    const root: El = { sel: [], kids: [body, ...this.spec.tree] };
    return new FakeLocator(this, descendants(root).filter((d) => d.sel.includes(selector)));
  }

  /** The comment-node read. The first navigation is the `goto` that opens the thread. */
  async evaluate(): Promise<CommentNode[]> {
    const late = this.spec.commentsAfterNavigation;
    if (late && this.navigations > 1) return late;
    return this.spec.comments ?? [];
  }

  asPage(): Page { return this as unknown as Page; }
}

/* Fixtures, each one a page shape that was actually hit in the rows above. */
const ourNode = (): CommentNode => ({
  text: `docs-architect · 1m\n\n${BODY}\n\nReply Share Report`,
  permalink: '/r/Wordpress/comments/1v7kvj2/a_thread/k9z1/',
  id: 't1_k9z1'
});
const postEl = (attrs: Record<string, string> = {}): El => ({
  sel: ['shreddit-post'], attrs, kids: [{ sel: ['h1', 'h1[slot="title"]'], text: 'a thread' }]
});
const signedIn = (): El => ({ sel: ['shreddit-app[user-logged-in="true"]'] });
const signedOut = (): El => ({ sel: ['shreddit-app[user-logged-in="false"]'] });
const composer = (): El => ({
  sel: ['shreddit-composer'],
  kids: [{ sel: ['shreddit-composer div[contenteditable="true"]', 'div[contenteditable="true"]'], editable: true }]
});
const submitEl = (over: Partial<El> = {}): El => ({ id: 'submit', sel: ['button[slot="submit-button"]'], ...over });

/* ------------------------------------------------------------------ *
 * 1. the three-way OR, told apart
 * ------------------------------------------------------------------ */

test('a signed-out page reports SIGNED OUT, not "logged out, or thread locked?"', async () => {
  const page = new FakePage({ tree: [signedOut(), postEl()] });

  const r = await publishComment(page.asPage(), PERMALINK, BODY, { sleep: noWait });

  assert.equal(r.ok, false);
  assert.equal(r.cause, 'signed-out');
  assert.match(r.error ?? '', /signed out/i);
  assert.doesNotMatch(r.error ?? '', /logged out, or thread locked/,
    'the three-way OR is the defect — one measured cause, never a list of maybes');
  assert.doesNotMatch(r.error ?? '', /locked|archived/i, 'a signed-out page says nothing about the lock state');
  assert.equal(page.typed, '', 'nothing is typed into a page that cannot accept a comment');
  assert.deepEqual(page.clicked, [], 'and nothing is clicked');
});

test('a locked thread reports LOCKED', async () => {
  const page = new FakePage({
    tree: [signedIn(), postEl({ locked: 'true' })],
    bodyText: 'a thread\nThis thread is locked. New comments cannot be posted.'
  });

  const r = await publishComment(page.asPage(), PERMALINK, BODY, { sleep: noWait });

  assert.equal(r.ok, false);
  assert.equal(r.cause, 'locked');
  assert.match(r.error ?? '', /locked/i);
  assert.doesNotMatch(r.error ?? '', /signed out|logged out/i, 'a locked thread is not a session problem');
  assert.equal(page.typed, '');
});

test('an archived thread reports ARCHIVED, which is a different cause from a lock', async () => {
  const page = new FakePage({
    tree: [signedIn(), postEl({ archived: 'true' })],
    bodyText: 'a thread\nThis is an archived post. Commenting is not available.'
  });

  const r = await publishComment(page.asPage(), PERMALINK, BODY, { sleep: noWait });

  assert.equal(r.cause, 'archived');
  assert.match(r.error ?? '', /archived/i);
});

test('signed in, not locked, and still no composer reports SELECTOR DRIFT — not a session guess', async () => {
  const page = new FakePage({ tree: [signedIn(), postEl()] });   // no composer host of any kind

  const r = await publishComment(page.asPage(), PERMALINK, BODY, { sleep: noWait });

  assert.equal(r.cause, 'composer-missing');
  assert.match(r.error ?? '', /selectors/i, 'the measured cause is that the markup moved');
  assert.doesNotMatch(r.error ?? '', /logged out, or thread locked/);
});

test('a page that answers nothing is DRIVEN to undetermined, not guessed signed-out', async () => {
  /* The unit test below hands `explainBlockedPublish` a pre-built state, so it never exercises
     `readSignedIn` — and `readSignedIn` returning `false` instead of `null` on a page with no
     marker either way survived the suite until this test drove the whole path. Reporting
     `signed-out` on an unreadable page sends an operator to re-authenticate a working session. */
  const page = new FakePage({ tree: [], bodyText: '' });

  const r = await publishComment(page.asPage(), PERMALINK, BODY, { sleep: noWait });

  assert.equal(r.cause, 'undetermined', 'an unreadable fact is admitted, never resolved by guessing');
  assert.match(r.error ?? '', /could not be determined/i);
  assert.equal(page.typed, '');
  assert.deepEqual(page.clicked, []);
});

test('when a fact cannot be read, the failure SAYS so instead of picking a cause', () => {
  const v = explainBlockedPublish({ signedIn: null, locked: null, archived: null, composerPresent: false });
  assert.equal(v?.cause, 'undetermined');
  assert.match(v?.message ?? '', /could not be determined/i);
  assert.match(v?.message ?? '', /signed-in state|lock state/i, 'it names which fact was unreadable');
});

test('a reachable composer is not a block at all', () => {
  assert.equal(explainBlockedPublish({ signedIn: true, locked: false, archived: false, composerPresent: true }), null);
});

/* ------------------------------------------------------------------ *
 * 2. present-but-disabled submit vs absent submit
 * ------------------------------------------------------------------ */

test('a submit control that is PRESENT but disabled is distinguished from an absent one', async () => {
  const disabled = new FakePage({ tree: [signedIn(), postEl(), composer(), submitEl({ disabled: true })] });
  const absent = new FakePage({ tree: [signedIn(), postEl(), composer()] });

  const a = await publishComment(disabled.asPage(), PERMALINK, BODY, { sleep: noWait });
  const b = await publishComment(absent.asPage(), PERMALINK, BODY, { sleep: noWait });

  assert.equal(a.cause, 'submit-disabled');
  assert.match(a.error ?? '', /present .*disabled|disabled/i);
  assert.equal(b.cause, 'submit-missing');
  assert.match(b.error ?? '', /not on the page|absent|no .*button/i);
  assert.notEqual(a.cause, b.cause, 'one message for both is the defect being fixed');
  assert.deepEqual(disabled.clicked.filter((c) => c === 'submit'), [], 'a disabled control is never clicked');
});

test('the two submit verdicts are the pure classifier, so neither can drift into the other', () => {
  assert.equal(explainMissingSubmit(true).cause, 'submit-disabled');
  assert.equal(explainMissingSubmit(false).cause, 'submit-missing');
});

/* ------------------------------------------------------------------ *
 * 3. a landing is verified before anything is called a failure
 * ------------------------------------------------------------------ */

test('a comment that appears only after a reload is CONFIRMED published, not reported failed', async () => {
  const page = new FakePage({
    tree: [signedIn(), postEl(), composer(), submitEl()],
    comments: [],                             // nothing on the page the submit touched
    commentsAfterNavigation: [ourNode()]      // it renders once the page is fetched again
  });

  const r = await publishComment(page.asPage(), PERMALINK, BODY, { sleep: noWait });

  assert.equal(r.ok, true, 'the comment is there — the old same-page-only check called this a failure');
  assert.equal(r.evidence?.source, 'reloaded', 'the confirmations vocabulary: a server re-read, not same-page');
  assert.equal(r.evidence?.confirmed, true);
  assert.equal(r.commentPermalink, 'https://www.reddit.com/r/Wordpress/comments/1v7kvj2/a_thread/k9z1/');
  assert.ok(page.gotos.length >= 2, 'the fresh navigation is what makes it a `reloaded` confirmation');
  assert.equal(page.clicked.filter((c) => c === 'submit').length, 1, 'confirming must never re-submit');
});

test('a comment found on the page it was posted to is confirmed same-page, which is not proof of more', async () => {
  const page = new FakePage({ tree: [signedIn(), postEl(), composer(), submitEl()], comments: [ourNode()] });

  const r = await publishComment(page.asPage(), PERMALINK, BODY, { sleep: noWait });

  assert.equal(r.ok, true);
  assert.equal(r.evidence?.source, 'same-page');
});

test('a comment that cannot be found anywhere is UNRESOLVED with its permalink, and is never re-sent', async () => {
  const page = new FakePage({ tree: [signedIn(), postEl(), composer(), submitEl()], comments: [] });

  const r = await publishComment(page.asPage(), PERMALINK, BODY, { sleep: noWait });

  assert.equal(r.ok, false);
  assert.equal(r.outcome, 'unresolved', 'not "failed" — it may have landed');
  assert.equal(r.cause, 'unconfirmed');
  assert.equal(r.permalink, PERMALINK, 'a person has to be able to go and look');
  assert.match(r.error ?? '', /UNRESOLVED/);
  assert.match(r.error ?? '', /reddit\.com\/r\/Wordpress\/comments\/1v7kvj2/, 'the permalink is in the message itself');
  assert.match(r.error ?? '', /not re-?submit|never re-?submit/i);
  assert.equal(r.evidence?.confirmed, false);
  assert.equal(page.clicked.filter((c) => c === 'submit').length, 1,
    'ONE submit click on the unresolved path — a blind re-submit is the worst outcome available here');
});

test('a submit click that THROWS after dispatch is UNRESOLVED, never "nothing was submitted"', async () => {
  /**
   * MEASURED BY THE VERIFIER on 2026-11-04: `submitted = true` sat after `await submit.click()`,
   * so a click that threw with the click already dispatched — Playwright's "Execution context was
   * destroyed, most likely because of a navigation", which is what a submit that navigates looks
   * like — came back `outcome: 'failed'`, and src/commands/reply.ts then printed "Nothing was
   * submitted … send again" for a comment that may be on Reddit.
   */
  const page = new FakePage({
    tree: [signedIn(), postEl(), composer(), submitEl({ throwsAfterDispatch: true })]
  });

  const r = await publishComment(page.asPage(), PERMALINK, BODY, { sleep: noWait });

  assert.equal(r.ok, false);
  assert.equal(page.clicked.filter((c) => c === 'submit').length, 1, 'the click was dispatched');
  assert.equal(r.outcome, 'unresolved',
    'a click that threw after dispatch may have landed — reporting it as failed invites a double post');
  assert.equal(r.cause, 'unconfirmed');
  assert.match(r.error ?? '', /not re-?submit|never re-?submit/i);
  assert.match(r.error ?? '', /reddit\.com\/r\/Wordpress\/comments\/1v7kvj2/,
    'with the thread to go and look at');
  assert.equal(r.evidence?.confirmed, false,
    'and with evidence, or src/commands/reply.ts writes no confirmation row for it at all');
});

test('a signed-IN page that also carries a login link is not reported as signed out', async () => {
  /* The one wrong-direction read still reachable: a signed-in page whose footer has a login link.
     The signed-in markers are tried first for exactly this reason, and reporting `signed-out` here
     would send an operator to re-authenticate a session that was never broken. */
  const page = new FakePage({
    tree: [
      signedIn(),
      { sel: ['a[href*="/login/"]'] },
      postEl(),
      composer(),
      submitEl()
    ],
    comments: [ourNode()]
  });

  const r = await publishComment(page.asPage(), PERMALINK, BODY, { sleep: noWait });

  assert.notEqual(r.cause, 'signed-out', 'a signed-in marker outranks a login link on the same page');
  assert.equal(r.ok, true);
});

test('no publish path re-submits: the submit click appears exactly once in the source', () => {
  const src = readFileSync(join(ROOT, 'src', 'reddit', 'post.ts'), 'utf8');
  const clicks = src.slice(src.indexOf('export async function publishComment'), src.indexOf('export const redditBase'))
    .match(/submit\.click\(/g) ?? [];
  assert.equal(clicks.length, 1, 'one click, one attempt, whatever the verification finds');
  assert.doesNotMatch(src, /re-?submit\(/, 'there is no re-submit helper to call');
});

const { replyToComment } = await import('../reddit/actions.js');

const COMMENT_ID = 't1_m3asured';
/** The one selector string actions.ts builds for the parent comment, matched exactly. */
const commentNode = (kids: El[] = []): El => ({
  sel: [`shreddit-comment[thingid="${COMMENT_ID}"], shreddit-comment[id="${COMMENT_ID}"]`],
  kids
});

test('a reply-back on a page that answers NOTHING is undetermined, not a selector-drift verdict', async () => {
  /**
   * MEASURED BY THE VERIFIER on 2026-11-04: this call site passed `composerPresent: true` into
   * `explainBlockedPublish`, which returns null on that flag BEFORE it reaches its unreadable-fact
   * branch. `undetermined` was therefore unreachable here, and a page that answered nothing was
   * told "signed in, unlocked and unarchived - the selectors have drifted": three facts never read
   * and a dev sent to hunt a drift. The page-level path calls the same page `undetermined`.
   */
  const page = new FakePage({ tree: [commentNode()], bodyText: '' });

  const r = await replyToComment(page.asPage(), PERMALINK, COMMENT_ID, BODY);

  assert.equal(r.ok, false);
  assert.equal(r.cause, 'undetermined',
    'an unreadable page is an admitted unknown — a wrong cause sends the operator somewhere else');
  assert.doesNotMatch(r.error ?? '', /signed in, unlocked and unarchived/,
    'and it must not assert facts it never read');
  assert.equal(page.typed, '', 'nothing was typed');
});

test('a reply-back on a LOCKED thread reports locked, and the cause survives the hop', async () => {
  /* The cause actions.ts measures has to reach the caller; discarding it and letting
     src/commands/reply.ts fall back to `undetermined` reads as "we did not measure it". */
  const page = new FakePage({
    tree: [signedIn(), postEl({ locked: 'true' }), commentNode()],
    bodyText: 'a thread\nThis thread is locked. New comments cannot be posted.'
  });

  const r = await replyToComment(page.asPage(), PERMALINK, COMMENT_ID, BODY);

  assert.equal(r.cause, 'locked', 'the measured cause, not undetermined');
  assert.match(r.error ?? '', /locked/i);
  assert.equal(page.typed, '');
});

test('a reply-back on a signed-OUT page reports signed-out', async () => {
  const page = new FakePage({ tree: [signedOut(), postEl(), commentNode()] });

  const r = await replyToComment(page.asPage(), PERMALINK, COMMENT_ID, BODY);

  assert.equal(r.cause, 'signed-out');
  assert.equal(page.typed, '');
});

test('the reply-back path names a cause too, instead of "thread locked, or archived"', () => {
  /* The page composer stopped ORing causes; src/reddit/actions.ts was still doing it, and
     src/commands/reply.ts printed it verbatim under cause `undetermined`, so a reply-back refusal
     still handed the operator the diagnosis to do. */
  const src = readFileSync(join(ROOT, 'src', 'reddit', 'actions.ts'), 'utf8');
  assert.doesNotMatch(src, /thread locked, or archived/,
    'one measured cause, read off the page, never two facts with different remedies');
  assert.match(src, /explainBlockedPublish\(/, 'the same probe the page composer uses');

  const reply = readFileSync(join(ROOT, 'src', 'commands', 'reply.ts'), 'utf8');
  assert.match(reply, /r\.cause \?\? 'undetermined'/,
    'and the cause it measured survives the hop into the publish result');
});

/* ------------------------------------------------------------------ *
 * 4. the history contract the console reads
 * ------------------------------------------------------------------ */

test('the reply command still writes publish.ok / publish.fail, and now carries the cause', () => {
  const src = readFileSync(join(ROOT, 'src', 'commands', 'reply.ts'), 'utf8');
  assert.match(src, /record\('publish\.ok'/, 'the console counts publish.ok rows');
  assert.match(src, /record\('publish\.fail'/, 'and publish.fail rows');
  const fail = src.slice(src.indexOf("record('publish.fail'"));
  assert.match(fail.slice(0, 400), /cause/, 'the failure row names the measured cause');
  assert.match(fail.slice(0, 400), /outcome/, 'and whether the outcome was unresolved rather than failed');
});

test('a confirmed landing is written to the confirmations table, not to a parallel record', () => {
  const src = readFileSync(join(ROOT, 'src', 'commands', 'reply.ts'), 'utf8');
  assert.match(src, /recordConfirmation\(/, 'the existing confirmations table is the record');
  assert.match(src, /result\.evidence/, 'with the evidence the publish path measured');

  /* AND THE NEGATIVE ONE. An unresolved landing is the case worth studying, so the failure branch
     writes its row too; deleting that call survived the suite until this assertion existed. */
  const fail = src.slice(src.indexOf("target.status = 'failed'"), src.indexOf("record('publish.fail'"));
  assert.match(fail, /writeConfirmation\(\)/,
    'the failure branch records its confirmation before the publish.fail row');
});
