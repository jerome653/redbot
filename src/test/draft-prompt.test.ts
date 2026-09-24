/**
 * What `draftPrompt` must keep saying, and what it must now say.
 *
 * There were no tests on this function at all, which is why a rewrite of it was a rewrite of
 * the only instruction the model ever receives, with nothing holding the downstream contract
 * still. `src/commands/draft.ts:34-40` parses the answer into `RawDraft` — five keys — and
 * `extractJson` throws if the object is not there. A prompt edit that drops a key from the
 * OUTPUT block breaks drafting with a parse error and no test would have noticed.
 *
 * The brevity and neutrality rules are pinned here rather than left to prose because they are
 * the whole point of the 2026-09-24 rewrite: short, safe replies, and a decline on anything
 * contentious.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-draft-prompt-'));

const { draftPrompt } = await import('../prompts.js');

const thread = {
  id: 't1',
  permalink: 'https://www.reddit.com/r/Wordpress/comments/x/y/',
  title: 'Cache plugin keeps serving stale pages',
  subreddit: 'Wordpress',
  author: 'someone',
  upvotes: 4,
  comment_count: 2,
  body: 'Pages update in the editor but visitors still see the old version.',
  comments: [
    { body: 'Have you purged the cache?' },
    { body: 'Check if a CDN is in front of it.' }
  ]
} as unknown as Parameters<typeof draftPrompt>[0];

const build = () => draftPrompt(thread, 'the asker has not checked the CDN layer', 'name the check to run first');

test('every key src/commands/draft.ts parses is still demanded by the OUTPUT block', () => {
  /* RawDraft at src/commands/draft.ts:34-40. Drop one here and drafting dies at extractJson. */
  const p = build();
  for (const key of ['contribute', 'whyThread', 'whatNew', 'whyNotSilent', 'body']) {
    assert.ok(p.includes(`"${key}"`), `the prompt must still ask for "${key}" — draft.ts parses it`);
  }
});

test('the reply is asked to be short, with a stated ceiling', () => {
  /* "something that counts as a response is good — no over engineering" (Jerome, 2026-09-24).
     A ceiling the model can count beats an adjective it has to interpret. */
  const p = build();
  assert.match(p, /\b(sentence|sentences)\b/i, 'brevity must be expressed in sentences, not vibes');
  assert.match(p, /\b(four|4)\b[^.]{0,40}sentence/i, 'the ceiling must be a number the model can count to');
});

test('contentious threads are declined, not argued', () => {
  const p = build();
  assert.match(p, /contribute.{0,40}false/is, 'declining must remain an explicit, named outcome');
  assert.match(p, /\b(debat|contentious|opinion|taking a side|politic)/i,
    'the prompt must name the class of thread to decline');
});

test('a conditional may not rule a cause in or out', () => {
  /**
   * THE MEASURED CAUSE OF EVERY CERTIFICATION REJECTION SO FAR.
   *
   * Argus cert 4 (2026-09-24, draft d_bd08ae06610b_mufq6pev, the first on the rewritten prompt)
   * returned REJECT with all four claims failing identically: 4 overconfident-language, 4
   * low-confidence-as-fact, 4 fatal-contradiction. The sentence that did it:
   *
   *   "If it still points to the Jarallax/background hero, Optimole and the preload URL aren't
   *    your bottleneck — the render delay is Elementor/Jarallax initialization"
   *
   * Two absolutes drawn from one observation: a cause ruled OUT ("aren't your bottleneck") and
   * another ruled IN ("the render delay is"). Argus answered each with a counterexample — the
   * hero can be the LCP element while Optimole is still serving its background image, so the
   * observation narrows the field and settles nothing.
   *
   * The prompt already said "say what you would check and why, rather than guessing with
   * confidence". The model obeyed that and then wrote a confident CONDITIONAL, which the rule
   * did not name. So the rule has to name it.
   */
  const p = build();
  assert.match(p, /\bif\b[^.]{0,60}\bthen\b|conditional/i,
    'the prompt must talk about conditional sentences specifically, not just confidence in general');
  assert.match(p, /rule (it |a cause )?(in|out)|rules? out|rule anything (in|out)/i,
    'and must forbid ruling a cause in or out from one observation');
});

test('a guess must be marked, in the words, with a phrase the drafter can actually use', () => {
  /**
   * Argus rule `low-confidence-as-fact` (certify.ts:191): a claim that "carries low confidence
   * and is not marked as speculation".
   *
   * This asserted the literal word "speculation" appeared in the prompt, which was pinning
   * VOCABULARY rather than the rule — and it went red the moment the prompt said the same thing
   * in words a drafter would actually write. `speculation` is the EXTRACTOR's type name
   * (src/argus/prompts.ts:72); the drafting model never needs to know it, and telling it to
   * "mark speculation" produced sentences that were not marked at all. What has to be in the
   * prompt is a usable phrase, so that is what this checks.
   */
  const p = build();
  assert.match(p, /my guess is|I'd bet|I'm not sure, but|I've seen that happen/i,
    'the prompt must hand the drafter a concrete marker phrase, not the classifier\'s jargon');
});

test('the reply is asked for observations and next steps, not for inferences', () => {
  /**
   * MEASURED, claim by claim. Argus cert 5 (2026-09-24, draft d_bd08ae06610b_mufslaet) typed
   * every claim and then attacked them. Exactly the inferences fell:
   *
   *   ✗ c1  inference       "Switching the page builder would not diagnose this issue."
   *   ✓ c2  observation     "The LCP breakdown ... identifies the Jarallax image as the LCP element."
   *   ✓ c3  observation     "The hero is currently a plain img element."
   *   ✓ c4  recommendation  "First check what Lighthouse reports as the LCP element now."
   *   ✗ c5  inference       "Checking ... would help distinguish between a hero JS/CSS render
   *                          delay and an image/preload request problem."
   *
   * c4 and c5 are one idea split in two: the STEP survived and the REASON for it did not. An
   * `alternative-explanation` counterexample is always available against an ungrounded claim
   * about what something would prove, and src/argus/certify.ts:322-323 exempts `opinion` and
   * `speculation` from the SUPPORT requirement but never from CONTRADICTION — so hedging cannot
   * rescue an inference the way it rescues an unsupported claim.
   *
   * The reply therefore gives the step and stops. That is also a perfectly ordinary Reddit
   * comment; "I'd check X first" needs no theory attached to be worth reading.
   */
  const p = build();
  assert.match(p, /\bobservation|what the thread (already )?shows|already in the thread/i,
    'the prompt must name observations as a safe kind of sentence');
  assert.match(p, /\bnext step\b|what you would do next|what to check/i,
    'and next steps as the other');
  assert.match(p, /\binference\b|what it would (prove|mean|show)|would prove/i,
    'and must name the kind that gets contradicted');
});

test('a mechanism may only appear as an explicitly uncertain guess', () => {
  /**
   * THE LAST FOUR REASONS ON CERT 6 (ESCALATE, the first non-REJECT). Two conditionals smuggled
   * a mechanism back in:
   *
   *   c6 "If the old hero background/parallax image is still rendered behind the new <img>,
   *       it CAN CAUSE Lighthouse to report the Jarallax image as LCP."
   *
   * Argus: "carries low confidence and is not marked as speculation" (certify.ts:191).
   *
   * src/argus/certify.ts:185 fires that rule only when the claim's type is NOT `opinion` or
   * `speculation`, and :323 exempts those same two types from the support requirement. So the
   * fix is not to delete the mechanism — it is to make the extractor TYPE it as speculation,
   * and src/argus/prompts.ts:72 defines that as "an explicitly uncertain guess". The extractor
   * reads the sentence, not the author's intent: the uncertainty has to be in the words.
   */
  const p = build();
  assert.match(p, /explicitly|in the words|say it is a guess/i,
    'the prompt must require the uncertainty to be visible in the sentence itself');
  assert.match(p, /\bcauses?\b|\bcan cause\b|mechanism|because/i,
    'and must name the mechanism phrasing that gets typed as fact');
});

test('the safety rules that predate the rewrite survive it', () => {
  /* These were not Jerome's brevity ask and must not be lost to it. Each one is a failure that
     already happened once: a promoted product, an invented anecdote, a confident wrong fact. */
  const p = build();
  assert.match(p, /never mention any company, product, brand or service you are affiliated with/i);
  assert.match(p, /never invent a personal experience/i);
  assert.match(p, /no emoji/i);
  assert.match(p, /do not state a checkable fact you cannot ground/i);
});

test('the thread itself reaches the model', () => {
  const p = build();
  assert.ok(p.includes('Cache plugin keeps serving stale pages'), 'the title must be interpolated');
  assert.ok(p.includes('r/Wordpress'), 'the subreddit must be interpolated');
  assert.ok(p.includes('Have you purged the cache?'), 'existing comments must be interpolated');
  assert.ok(p.includes('the asker has not checked the CDN layer'), 'the selection reason must be interpolated');
});

test('no brief is issued that the parser cannot read back', () => {
  /* The OUTPUT block must ask for ONE json object and forbid a fence, because extractJson
     scans for the first brace and a ```json fence puts prose in front of it. */
  const p = build();
  assert.match(p, /ONLY this JSON object/i);
  assert.match(p, /no fence/i);
});
