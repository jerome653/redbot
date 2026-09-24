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
