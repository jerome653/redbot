/**
 * Reddit selectors, in one place.
 *
 * Not a "selector pack" — no versioning, no hot-swap, no tiers. Just one module so that
 * when Reddit changes something there is exactly one file to edit. Each entry is a list
 * tried in order; the first that resolves wins.
 */
export const sel = {
  /** Post links in a feed or search result list. */
  postLink: [
    'a[slot="full-post-link"]',
    'shreddit-post a[slot="full-post-link"]',
    'a[data-testid="post-title"]',
    'a[data-click-id="body"]',
    'h3 a[href*="/comments/"]',
    'a[href*="/comments/"]'
  ],

  /** The post container in a feed. */
  postUnit: ['shreddit-post', 'article', 'div[data-testid="post-container"]'],

  /** On a post detail page. */
  postTitle: ['h1[slot="title"]', 'shreddit-post h1', 'h1'],
  postBody: [
    'div[slot="text-body"]',
    'shreddit-post div[slot="text-body"]',
    'div[data-post-click-location="text-body"]',
    'div[data-testid="post-content"]'
  ],

  /** Comment nodes on a post detail page. */
  commentNode: ['shreddit-comment', 'div[data-testid="comment"]', 'div[data-type="comment"]'],
  commentBody: ['div[slot="comment"]', 'div[data-testid="comment"] p', 'p'],

  /** Comment composer on a post detail page. */
  commentBoxTrigger: [
    'button[aria-label*="Add a comment" i]',
    'faceplate-tracker[noun="comment"] button',
    'div[data-testid="comment-submission-form-richtext"]',
    'shreddit-composer'
  ],
  commentEditor: [
    'shreddit-composer div[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea[name="comment"]'
  ],
  commentSubmit: [
    'button[slot="submit-button"]',
    'shreddit-composer button[type="submit"]',
    'button:has-text("Comment")',
    'button[aria-label="Comment"]'
  ],

  /** Search. */
  searchResult: ['shreddit-post', 'div[data-testid="search-post-unit"]', 'article'],

  /** Container that holds ONLY search results — everything outside it is feed noise. */
  searchScope: [
    'div[data-testid="search-results-container"]',
    'search-telemetry-tracker',
    'faceplate-tracker[source="search"]',
    'shreddit-search-results',
    'main'
  ],

  /** Container that holds ONLY the subreddit feed. */
  feedScope: ['shreddit-feed', 'div[data-testid="frontpage-feed"]', 'main'],

  /* ---------------------------------------------------------------- *
   * Write surfaces beyond the top-level comment box.
   *
   * ⚠ UNVERIFIED AGAINST LIVE REDDIT. Every group above was confirmed against real pages
   * during collection runs; the groups below were written from Reddit's published component
   * names and have never resolved against a live DOM, because doing so requires an attached
   * signed-in browser. They follow the established shape — ordered candidates, `firstVisible`
   * picks the first that resolves, absence is reported rather than assumed — so a wrong guess
   * surfaces as "control not found" and refuses, which is the correct failure. Confirm them on
   * the first live run before trusting any of it.
   * ---------------------------------------------------------------- */

  /**
   * Reply control on an individual comment — for replying to a person, not to the post.
   *
   * VERIFIED LIVE 2026-07-27 against r/Wordpress as docs-architect. The action row is
   * `shreddit-comment-action-row` and holds 7 buttons (Reply, Share, Upvote, Downvote, Award,
   * user actions, Share); **the Reply button carries no aria-label and no name attribute** —
   * it is identified by its text alone. The three aria/testid candidates that used to lead this
   * list all matched 0, so a page-level probe appeared to "work" only by falling through to the
   * text match, which on a full page hits the post composer rather than any comment. Scoped
   * inside one `shreddit-comment` the text match resolves to exactly 1, which is why
   * `replyToComment` scopes every lookup to the comment subtree.
   */
  commentReplyButton: [
    'shreddit-comment-action-row button:has-text("Reply")',
    'button:has-text("Reply")',
    // Kept as fallbacks for older or A/B'd markup. Neither matched on 2026-07-27.
    'shreddit-comment button[aria-label*="reply" i]',
    'button[data-testid="comment-reply-button"]'
  ],

  /** Vote controls. Scoped to a post or a comment by the caller. */
  upvoteButton: [
    'button[upvote]',
    'button[aria-label*="upvote" i]',
    'shreddit-post button[aria-label*="upvote" i]',
    'div[data-post-click-location="vote"] button:first-of-type'
  ],
  downvoteButton: [
    'button[downvote]',
    'button[aria-label*="downvote" i]',
    'shreddit-post button[aria-label*="downvote" i]',
    'div[data-post-click-location="vote"] button:last-of-type'
  ],

  /**
   * Overflow menu that holds Save / Unsave / Follow post.
   *
   * VERIFIED LIVE 2026-07-27. `shreddit-post-overflow-menu` is the host; its trigger is the
   * first `button` inside it. Scope it to the post — a detail page carries one per post AND one
   * per comment.
   */
  overflowMenu: [
    'shreddit-post-overflow-menu',
    'button[aria-label*="more options" i]',
    'button[aria-label*="Open overflow menu" i]'
  ],

  /**
   * Items inside the opened overflow menu.
   *
   * VERIFIED LIVE 2026-07-27: the six entries are `DIV[role="menuitem"]` — not `button`, not
   * `li`. All three previous candidates matched 0. Two traps found by measuring:
   *
   *   1. A page-level query is polluted. The comment composer's rich-text toolbar also exposes
   *      `[role="menuitem"]` (Insert row above, Align center, …), so an unscoped lookup for
   *      "Save" returned 5 matches on a page with one Save.
   *   2. **`:has-text()` is a case-insensitive SUBSTRING match, so "Save" also matches
   *      "Unsave".** Asking to save an already-saved post would have clicked Unsave. `:text-is`
   *      would solve it but returns 0 here because the item wraps its label in nested markup.
   *
   * So this group locates the item LIST, and `setSaved` picks the exact label in code. A
   * selector cannot express "exactly this word" reliably here; code can.
   */
  overflowMenuItem: [
    'shreddit-post-overflow-menu [role="menuitem"]',
    '[role="menuitem"]'
  ],

  /** Follow / unfollow on a profile or subreddit. */
  followButton: [
    'shreddit-join-button button',
    'button:has-text("Follow")',
    'button[aria-label*="Follow" i]'
  ],
  unfollowButton: [
    'button:has-text("Unfollow")',
    'button:has-text("Following")',
    'button[aria-label*="Unfollow" i]'
  ],

  /** Submit-a-post composer. */
  postTitleField: [
    'textarea[name="title"]',
    'textarea[placeholder*="Title" i]',
    'faceplate-textarea-input[name="title"] textarea',
    'input[name="title"]'
  ],
  postBodyField: [
    'shreddit-composer div[contenteditable="true"]',
    'div[name="body"] div[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea[name="text"]'
  ],
  postSubmitButton: [
    'button[type="submit"]:has-text("Post")',
    'button:has-text("Post")',
    'button[aria-label="Post"]',
    'button[slot="submit-button"]'
  ],
  /** Flair picker — some subreddits refuse a submission without one. */
  flairButton: [
    'button:has-text("Flair")',
    'button[aria-label*="flair" i]'
  ]
} as const;

export type SelectorGroup = keyof typeof sel;
