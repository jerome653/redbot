# redbot — action registry (contract)

Every action implements:

    async execute(ctx, params) -> { ok, evidence, error }

`ctx` gives: page driver, selector pack, humanize policy, logger, run id, account id.
Actions never read config directly and never decide timing — the engine owns both.

`evidence` is whatever a human would need to believe the action happened: the resolved
selector, the text read, the URL after, a screenshot handle on failure.

## READ

| Action | Params | Verifies |
|---|---|---|
| `openFeed` | sort: hot\|new\|top | feed container present |
| `openSubreddit` | name, sort | subreddit header matches name |
| `search` | query, scope: all\|subreddit, sort | results container present, query echoed |
| `openPost` | ref (permalink or match spec) | post detail container, title matches |
| `readComments` | maxDepth, maxCount | returns comment tree, count > 0 or explicit empty |
| `scrollFeed` | direction, amount | scroll position changed |
| `loadMoreComments` | maxClicks | comment count increased or no more control |
| `openUserProfile` | handle | profile header matches handle |
| `readInbox` | unreadOnly | inbox container present |

## WRITE — all gated by rate ledger and approval queue

| Action | Params | Verifies |
|---|---|---|
| `submitPost` | subreddit, title, body, flair? | post appears, permalink captured |
| `submitComment` | postRef, body | comment appears under post, permalink captured |
| `replyToComment` | commentRef, body | reply appears nested under target |
| `editOwn` | ref, body | updated text visible |
| `deleteOwn` | ref | target no longer present |
| `sendMessage` | recipient, subject, body | sent confirmation |
| `replyToMessage` | messageRef, body | reply present in thread |

## CURATE

| Action | Params | Verifies |
|---|---|---|
| `join` / `leave` | subreddit | membership control state flipped |
| `save` / `unsave` | ref | saved state flipped |
| `follow` / `unfollow` | handle | follow state flipped |
| `hide` | ref | item removed from feed |
| `report` | ref, reason | report confirmation |

## SIGNAL — specified, executors not implemented (ADR-0007)

| Action | Params | Status |
|---|---|---|
| `upvote` | ref | spec only. Engine rejects any workflow referencing it unless `actions.voting.enabled === true` |
| `downvote` | ref | spec only, same gate |
| `clearVote` | ref | spec only, same gate |

## ACCOUNT

| Action | Params | Verifies |
|---|---|---|
| `login` | accountId | logged-in chrome present; session persisted |
| `sessionRestore` | accountId | restored session still authenticated |
| `checkHealth` | — | not shadowbanned, not suspended, karma readable |
| `readKarma` | — | numeric karma returned |
| `logout` | — | logged-out state |

## META

| Action | Params | Notes |
|---|---|---|
| `wait` | rangeMs | delay drawn from humanize policy, never a fixed sleep |
| `assert` | condition | fails the step with WRONG_SCREEN if false |
| `extract` | selector, into, as | writes a run variable |
| `screenshot` | label | evidence only |
| `abort` | reason | ends the run cleanly, logged |

## Reference resolution

A `ref` is either a permalink or a match spec — `{ title~: "...", author: "...", within: N }`.
Match specs exist because a workflow written yesterday cannot know today's permalink. The
resolver scrolls a bounded number of times looking for a match, then fails `NOT_FOUND`.
This is the same problem Appilot solved with `matchesAuthorityClause`; here it is one
utility with one test suite rather than logic spread across a 608-method class.
