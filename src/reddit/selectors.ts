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
  feedScope: ['shreddit-feed', 'div[data-testid="frontpage-feed"]', 'main']
} as const;

export type SelectorGroup = keyof typeof sel;
