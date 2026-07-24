# redbot — workflow schema

A workflow is a JSON document. The engine interprets it. Authoring one is not a release.

    {
      "schemaVersion": 1,
      "id": "wf_answer_in_subreddit",
      "version": 3,
      "description": "Find answerable threads in one subreddit and draft replies",
      "requiresPack": { "site": "reddit", "minVersion": 4 },
      "params": [
        { "name": "subreddit", "type": "string", "required": true },
        { "name": "budgetMinutes", "type": "int", "default": 30 }
      ],
      "policy": {
        "humanize": "cautious",
        "account": "${account}",
        "maxWrites": 2
      },
      "steps": [
        { "id": "open",  "action": "openSubreddit",
          "params": { "name": "${subreddit}", "sort": "new" },
          "onFail": "recover_home" },

        { "id": "loop", "loop": {
            "while": { "and": ["budgetRemaining", { "lt": ["${writes}", 2] }] },
            "body": [
              { "id": "scroll", "action": "scrollFeed",
                "params": { "direction": "down", "amount": { "screens": [0.6, 1.4] } } },
              { "id": "read",   "action": "readComments", "params": { "maxCount": 20 } },
              { "id": "judge",  "action": "qualify",      "params": { "into": "verdict" } },
              { "id": "gate",   "when": { "eq": ["${verdict.worthy}", true] }, "steps": [
                  { "id": "draft", "action": "draft", "params": { "into": "reply" } },
                  { "id": "send",  "action": "submitComment",
                    "params": { "postRef": "${post.ref}", "body": "${reply}" } }
              ]}
            ]
        }},

        { "id": "done", "action": "abort", "params": { "reason": "budget reached" } }
      ],
      "recovery": {
        "recover_home": [
          { "action": "openFeed", "params": { "sort": "hot" } },
          { "action": "wait" }
        ]
      }
    }

## Expression language

Deliberately not Turing-complete. A workflow that arrives from outside must not be able to
compute arbitrarily.

Supported: literals · `${var}` references · `eq` `ne` `lt` `gt` `and` `or` `not` ·
`len` `lower` `trim` `contains` · `random(a,b)` `pick(list)` · `budgetRemaining`.

No loops except the declared `loop` block. No function definition. No property access
beyond one level of dotted path. No arithmetic beyond comparison.

## Validation, before a single action runs

1. Schema version known
2. All referenced actions exist in the registry
3. Any `upvote`/`downvote`/`clearVote` reference fails validation unless
   `actions.voting.enabled === true` (ADR-0007)
4. Required params present and typed
5. Required selector pack version available
6. `policy.maxWrites` present and within the account's remaining ledger allowance
7. All `onFail` targets exist in `recovery`

A workflow that fails validation never starts. There is no partial execution of an invalid
document.
