/**
 * The first production auto-warmup (w_bc17a048a6d4, 2026-10-19 01:22 UTC) was REJECTed by Argus
 * with fatal-contradiction on a promised outcome. These pin the cheap local refusal of that shape,
 * the prompt rule that asks for its absence, and the one-rewrite budget.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWarmingComment, OUTCOME_CLAIM_PATTERNS } from '../warming.js';
import { warmupPrompt } from '../prompts.js';
import { WARMUP_ATTEMPTS } from '../commands/warmup.js';

const PRODUCTION_DRAFT =
  "Nice idea. I'd make automatic refresh the default and document what happens when the public " +
  "profile lookup is rate limited, so users aren't surprised by a stale graph.";

test('the production REJECT shape is refused locally as outcome-claim', () => {
  const v = checkWarmingComment(PRODUCTION_DRAFT);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => i.rule === 'outcome-claim'), JSON.stringify(v.issues));
});

test('a clarifying question with an "I\'d check X first" line passes the warming rules', () => {
  const v = checkWarmingComment(
    "I'd look at how often the graph actually refreshes first. Are you regenerating it on a schedule, or only when someone loads the README?"
  );
  assert.equal(v.ok, true, JSON.stringify(v.issues));
});

for (const [name, body] of [
  ['prevents', 'Turning on object caching prevents most of the slow admin page loads you are seeing here, in my experience at least.'],
  ['ensures', 'Running the cleanup weekly ensures the table never grows that large again, which is what I ended up doing myself.'],
  ['will fix', 'Clearing the transients will fix the repeated form entries you are getting, I had the exact same thing last year.'],
  ['is always better', 'A child theme is always better than editing the parent directly, I learned that one the hard way on my own site.']
] as const) {
  test(`outcome-claim catches "${name}"`, () => {
    assert.ok(checkWarmingComment(body).issues.some((i) => i.rule === 'outcome-claim'));
  });
}

test('"so" without a promised result is not an outcome claim', () => {
  const v = checkWarmingComment("So you're seeing it only on the block editor, not the classic one? What does the browser console show when the publish fails?");
  assert.ok(!v.issues.some((i) => i.rule === 'outcome-claim'), JSON.stringify(v.issues));
  assert.ok(OUTCOME_CLAIM_PATTERNS.length >= 4);
});

test('the warmup prompt forbids promised outcomes and leads with the clarifying question', () => {
  const p = warmupPrompt({ id: 't', subreddit: 'webdev', title: 'x', body: 'y', comments: [] } as unknown as Parameters<typeof warmupPrompt>[0]);
  assert.match(p, /Never promise an outcome or give a reason-why/);
  assert.match(p, /Best shape: the one specific clarifying question/);
});

test('one rewrite, never a third call', () => {
  assert.equal(WARMUP_ATTEMPTS, 2);
});
