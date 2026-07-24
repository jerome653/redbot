# redbot

**A human-in-the-loop technical contribution assistant.** Not a Reddit automation tool.

The distinction is the design, not the marketing. The automation — reading, ranking, gap
analysis, drafting, logging — exists to reduce the effort of contributing. **The human remains
accountable for the final public statement**, and every published word is attributable to a
person who read it and pressed a key.

That boundary gives future work a clear test: a feature belongs here if it improves the
**quality, safety, or efficiency of human-reviewed contributions**. A feature that removes
meaningful human judgement does not belong here, however much time it would save.

It reads threads, works out what a discussion is missing, drafts a reply, shows it to you, and
posts only what you approve. It never posts on its own, never votes, and never touches your
password.

### Why the boundary is load-bearing, with evidence

On 2026-07-23 the pipeline produced a draft that was fluent, specific, correctly hedged, free of
brand mentions, genuinely novel against the thread — and **wrong**. It claimed an oversized row
"inserts empty or truncated instead of throwing an error" during a SQL import. MySQL raises
`ERROR 1153` and aborts.

Every automated gate passed it. Each one measures a proxy for quality that can be read off text:
leakage, register, specificity, novelty, opportunity. **None of them measures whether a claim is
true**, and no text-level check can. A person who knew MySQL stopped it.

Full certification: [`reports/HRC-001-custom-css-updraft.md`](reports/HRC-001-custom-css-updraft.md).

**Interface mockup:** `design/redbot-ui-mockup.html` — open it in a browser.

---

## Why there are no phones in this

Appilot runs on real Android devices because mobile-device automation *is the product they
sell*. SGEN wants replies on Reddit, and **Reddit cannot tell whether a comment came from the
app or from a browser** — same account, same service, same visibility.

The proven alternative is a browser you already own. Measured on 2026-07-22: every attempt
where the software *launched* a browser was blocked by Reddit; attaching to a Chrome window
**you** opened works, and pulled 25 real threads on the first run.

An account here costs a folder on disk instead of a phone, a SIM and a proxy.

Full reasoning and the experiment log: `WHY-NO-ANDROID.md`.

---

## How it works

1. **You** open Reddit in a browser and sign in — once.
2. **redbot** reads a subreddit and collects the threads.
3. **redbot** scores each one: could SGEN genuinely help here?
4. **redbot** writes a draft reply to the best one.
5. **You** read it, edit it if you want, approve or reject.
6. **redbot** posts what you approved and records what happened.

Step 5 is the whole point. Nothing reaches Reddit without you saying yes.

---

## Setup — about ten minutes, once

### 1. Open the browser redbot will use

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
    --remote-debugging-port=9222 `
    --user-data-dir="D:\AI\Clients\SGEN\Projects\redbot\data\chrome-profile" `
    --no-first-run --no-default-browser-check
```

A Chrome window opens. **Go to reddit.com and sign in.** Leave it open — redbot works inside
it, in its own tab, and never touches your normal browser.

### 2. Sign in to Claude as yourself

redbot uses Claude to score threads and write drafts, and it uses *your* account — never
whoever happens to be signed in on the machine.

```powershell
$env:REDBOT_OPERATOR = "jerome"
$env:CLAUDE_CONFIG_DIR = "D:\AI\Clients\SGEN\Projects\redbot\data\operators\jerome\claude"
claude
```

Claude opens — type `/login`, sign in, close it. Stored for next time.

*(Prefer a paid API key instead? Set `REDBOT_LLM=api` and `ANTHROPIC_API_KEY` and skip this.
Use a fresh key — not the one found inside the Appilot APK, which should be revoked.)*

### 3. Build

```powershell
cd D:\AI\Clients\SGEN\Projects\redbot
npm install
npm run build
```

---

## Using it — the console

Most people should never touch the command line. Start the console and work from there:

```powershell
node tools/product/server.mjs --port 7902
```

Then open **http://localhost:7902**. Five screens, in the order the work happens:

| screen | what it is for |
|---|---|
| **Today** | what to do right now, per account — and the switch for the unattended loop |
| **Accounts** | who redbot posts as; add an account in four fields and three buttons |
| **Review** | their question beside our reply, with the fact-check **above** the reply |
| **Threads** | where to look, and everything found so far |
| **Results** | what happened after sending — empty until something is sent |

The console reads the same files the CLI writes, so the two are never out of step. It runs
redbot for you; it cannot invent a number the logs do not contain. `?` in the top bar explains
every screen, and opens itself the first time.

### The unattended loop

```powershell
node dist/cli.js auto --every 60        # or press Start on the Today screen
```

Collects, scores, drafts and fact-checks on a loop — and **stops there**. It will not act
during an account's quiet hours or past its daily ceiling, and it never publishes. Automating
the steps before the decision makes the decision easier; automating the decision removes the
only thing that has ever caught a fluent, well-evidenced, false reply.

## Using it — the command line

Chrome from step 1 must be open. Then:

```powershell
$env:REDBOT_OPERATOR = "jerome"      # whose Claude credentials pay for the model calls
$env:REDBOT_ACCOUNT  = "docs-architect"   # which Reddit account to act as

node dist/cli.js login              # check you're signed in
node dist/cli.js read wordpress     # collect threads
node dist/cli.js opportunity        # score them (a few minutes)
node dist/cli.js draft              # write a reply to the best one
node dist/cli.js certify            # try to prove the reply wrong
node dist/cli.js reply              # read it, approve or reject, post
node dist/cli.js history            # what happened, and when
```

`REDBOT_ACCOUNT` names an entry in `data/accounts.json` and decides which browser and which
profile every command uses. An unknown name is an error, never a fallback to the first entry.

Search instead of browsing:

```powershell
node dist/cli.js search "elementor slow"
```

At the approval step you get three choices: **a** approve and post · **e** edit first ·
**r** reject and do nothing. `r` is the safe answer — an unclear response never resolves to
publishing (DEFECT-08).

### Approving from the console

`reply` also accepts an approval made in the console, so the send does not force you into a
terminal. The guarantee is unchanged, and deliberately narrow: the approval token names **one
draft**, expires after **five minutes**, is **consumed on read**, and anything malformed, stale
or mismatched is a refusal rather than an approval. Your decision is written to
`data/decisions.jsonl` *before* the send, so an approval survives even if the send fails.

The rule was never "must be a terminal". It was: an approval must fail closed and be
attributable to a person. A click, the word `SEND` typed out, and a reason satisfies that.

---

## Rules it enforces on itself

Checked in code, not politely requested. A draft that breaks one cannot post, even if you
approve it:

- **If the reply mentions SGEN, it must say you work there.** No exceptions.
- **No invented war stories.** It won't write "I hit this exact problem last year" — it
  hasn't had any problems, and pretending is how people get caught.
- **No fake typos** or forced casualness to seem human.
- **No "hope this helps!"** filler.
- **It won't offer you threads that can only be answered with a sales pitch** — r/WordPress
  rule 1 is "No promotions of products or services", so those are useless anyway.

There is no voting. redbot cannot upvote or downvote anything.

---

## Where things are kept

Plain files on your machine. Nothing goes anywhere except Reddit and Claude.

```
data/threads.json     threads it collected
data/analysis.json    scores and reasons
data/drafts.json      drafts and your decisions
data/history.jsonl    one line for everything that happened
```

Your Reddit login lives in the Chrome profile. Your Claude login lives in your operator
folder. redbot stores no passwords and no keys.

---

## If something goes wrong

**"No debuggable Chrome at…"** — the Chrome window from step 1 isn't open.

**"No Claude operator set"** — you skipped `$env:REDBOT_OPERATOR`.

**"Claude is not signed in for operator…"** — redo step 2.

**"Reddit served a block page"** — open reddit.com by hand in that Chrome window once, then
retry. Reddit checks unfamiliar browser profiles the first time.

**A reply failed to post** — open the thread and look before retrying. It may have gone
through. redbot never retries a post on its own, because that's how one comment becomes three.

---

## Honest limits

- One account. More would work the same way — another Chrome on another port — but that
  isn't built, and shouldn't be until this proves useful.
- Reddit changes its site sometimes, which can break reading. Everything it looks for lives
  in one file, `src/reddit/selectors.ts`, so it's a small fix.
- Scoring takes a few minutes because it asks Claude in batches.
- It reads and replies. It does not create posts, send messages, or vote.

---

## State of it

See `STATUS.md`. Short version: **reading and scoring real threads is proven working** — a
live run collected 25 threads from r/WordPress and found 10 worth answering. Drafting and
posting are built and unit-tested but haven't been run for real yet; that needs your Claude
login and a decision to post something.
