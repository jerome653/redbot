# One computer, several accounts — what actually gets flagged

Honest answer, separating what Reddit **documents** from what is **inferred**.

---

## 1. What Reddit says it acts on

From their *Disrupting Communities* policy — **[verified 2026-07-22]**:

- **Vote manipulation** — "whether manual, programmatic, or otherwise", explicitly including
  "creating and employing multiple accounts, voting services, or any automation to manipulate
  vote counts"
- **Ban evasion**
- **Coordinated inauthentic behaviour** — an organised group or bots targeting specific posts,
  users, or domains
- They state detection **cross-references IP addresses, login patterns and voting timing**

Sanction ladder for vote manipulation: warning → 3-day → 7-day → permanent.

## 2. The risks, ranked by what actually gets accounts killed

| # | Signal | Real risk | What redbot does |
|---|---|---|---|
| 1 | **Automated voting** | **Highest.** Named in policy by name | **Not built.** Cannot upvote or downvote |
| 2 | **Accounts interacting** — replying to each other, appearing in the same thread, boosting each other | **Very high.** This is the textbook coordination signature | Enforced: accounts never share a thread and never reply to each other |
| 3 | **Ban evasion** — creating a replacement after a suspension | **Very high**, and it converts a small problem into a permanent one | Rule: if an account is suspended, **stop**. Do not create another |
| 4 | **Same link pushed from several accounts** | High | Disclosure required, and the pitch gate blocks threads that can only be answered with a product mention |
| 5 | **Timing correlation** — accounts acting in lockstep | Medium | Serial execution, staggered hours, per-account quiet hours |
| 6 | **Shared IP address** | **Low on its own** | Optional per-account IP, ~$0.30–6/month each |
| 7 | **Shared device fingerprint** | **Low, and counter-intuitive** — see §4 | Standard Chrome, deliberately unmodified |

**Items 1–3 are what actually ends accounts. Items 6–7 are what people worry about.**

## 3. What separate Chrome profiles do and don't give you

redbot runs one Chrome profile directory per account. That is not cosmetic — it is the layer
Reddit's own session tracking actually reads.

| Isolated by a separate profile | Not isolated |
|---|---|
| Cookies | IP address |
| Session tokens | Canvas / WebGL / font / audio fingerprint |
| localStorage, IndexedDB | Hardware, GPU, OS |
| Cache, service workers | Timezone and locale, unless set per profile |
| Browsing history | |

So: two accounts on one machine look like **two different browsers on one household
connection**. Which is exactly what they would look like if two colleagues shared an office.

## 4. The fingerprint point, which is backwards from the folklore

The instinct is to randomise each profile so accounts look unrelated. **That makes things
worse.**

A fingerprint links two accounts only if it is **rare**. Two accounts both presenting a
standard Chrome-on-Windows fingerprint are not linked by it — that is the most common browser
configuration on earth. Randomised canvas noise makes each profile *unique* and *inconsistent
between page loads*, which is itself a detectable spoofing signature.

redbot therefore aims to be **ordinary, not unique**, and does not touch the fingerprint.

## 5. The part that makes most of this moot

Every technique above — proxies, fingerprint separation, anti-detect browsers — exists to make
**connected accounts look unconnected**.

redbot's accounts are disclosed SGEN people. The connection is public by construction.

That changes the question. It is not *"will Reddit notice these accounts are related"* — they
are related, colleagues are related, that is fine and normal. It is *"does the behaviour look
like manipulation"*. And that is answered by conduct, not by infrastructure:

- no voting
- no cross-interaction between accounts
- no link spamming
- human pacing and volume
- disclosure when SGEN comes up

All of those are enforced in code and cost nothing.

## 6. Residual risk, stated plainly

Things that remain true even with everything above done right:

1. **Reddit sees signals we cannot.** No external party knows their full model. Anyone
   claiming a guarantee is guessing.
2. **New accounts are treated more harshly than aged ones.** An account with no history that
   starts posting confident technical replies is more suspicious than one with a real past.
   The account currently signed in — `u/canadacis` — has existing history, which is the better
   starting position.
3. **Subreddit moderators can ban for any reason**, including simply being a vendor.
   r/WordPress rule 1 is "No promotions of products or services".
4. **Volume is the thing that converts low risk into high risk.** Three thoughtful replies a
   day from one account is nothing. Thirty a day across five is a pattern.

## 7. What to do, in order

1. **One account.** At one account the entire flagging question is close to moot. Prove the
   replies are worth posting first.
2. **Two or three, only if step 1 works.** Separate profiles, staggered hours, different
   subreddits, no shared threads. Still no proxies needed.
3. **Separate IPs only if something suggests they are needed.** $0.30–6/IP/month; a decision
   to make on evidence, not on nerves.
4. **Never** replace a suspended account. Stop and reassess instead — that is the single
   action that turns a recoverable situation into a permanent one.

## 8. The one-line version

> Separate Chrome profiles handle what Reddit's session tracking actually reads. Shared IP and
> shared fingerprint are weak signals that only matter alongside behaviour we are not doing —
> voting, cross-boosting and link spam. The accounts are disclosed anyway, so there is no
> connection to hide; there is only conduct to keep clean.
