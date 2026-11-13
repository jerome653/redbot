/**
 * Slice: warming drafts must reuse a DISTINCTIVE token from the thread, not invent one.
 *
 * The publish-time `quality:generic` gate (src/quality.ts) is an INTERSECTION test, not a
 * specificity test: it counts reply tokens that ALSO appear in the thread, filtered to length
 * >= 4 and not in a ~127-word stopword set, and blocks when `technicalHits === 0 &&
 * specificityHits < 3` (src/quality.ts ~183). So:
 *   - a draft that invents a fresh precise detail NOT present in the post scores zero and is
 *     BLOCKED — only LITERAL REUSE of a distinctive token from the post clears the gate;
 *   - a single distinctive IDENTIFIER (filename, error string, version, dashed plugin name) is a
 *     "technical" token and clears the gate on its own;
 *   - the generic words `website`, `wordpress`, `problem` are stopwords, so "name a noun from the
 *     post" can still score zero on a sparse thread (the trap the prompt must warn about).
 *
 * `warmupPrompt` (src/prompts.ts) is reworded to instruct the model to quote/reuse such a token.
 * These tests pin the REAL gate behaviour the prompt relies on, and assert the prompt now carries
 * that instruction and the stopword caveat. assessQuality is the real module, not a mock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessQuality } from '../quality.js';
import { warmupPrompt } from '../prompts.js';
import type { Thread } from '../types.js';

/* A thread carrying distinctive identifiers (wp-cron.php, 6.4.2, serverpilot, nginx) AND the
   generic word "website" — so the stopword trap can be exercised against a real match. */
const THREAD: Pick<Thread, 'title' | 'body' | 'comments'> = {
  title: 'ServerPilot nginx returns 504 on /wp-cron.php after the 6.4.2 website update',
  body:
    'Ever since the 6.4.2 update my checkout page started throwing a 504 from nginx, and it ' +
    'only happens when wp-cron.php runs. ServerPilot shows the worker timing out. The rest of ' +
    'the website is fine and nothing is in the access log that I can see.',
  comments: [{ author: 'someone', body: 'Have you tried a different browser?', depth: 0 }]
};

const codes = (body: string) => assessQuality(body, { thread: THREAD }).issues.map((i) => i.code);

test('(a) a warming draft that reuses a distinctive identifier from the thread does NOT trip generic', () => {
  // Reuses wp-cron.php and 6.4.2 verbatim — both are "technical" tokens, so one alone clears it.
  const reuse =
    "I'd look at wp-cron.php first. Does the 504 happen on every request after the 6.4.2 " +
    'update, or only while that worker is running? That narrows where to read next.';
  const report = assessQuality(reuse, { thread: THREAD });
  assert.ok(!report.issues.some((i) => i.code === 'generic'),
    `reusing a distinctive token must clear generic, got: ${JSON.stringify(report.issues)}`);
  assert.ok(report.metrics.technicalHits >= 1,
    `a reused filename/version must register as a technical hit, got ${report.metrics.technicalHits}`);
});

test('(b) a draft that invents its specifics and reuses nothing from the thread DOES trip generic', () => {
  // Fresh, precise-sounding, but none of these >=4-char non-stopword tokens appear in the thread.
  const invented =
    "I'd start by clearing the opcache and bumping the memory limit, then watch the fastcgi " +
    'buffers under load. A stale bytecode cache usually explains a gateway stall like this.';
  assert.ok(codes(invented).includes('generic'),
    'inventing specifics the post never mentioned must still read as generic');
});

test('(b) naming only a GENERIC noun from the post (a stopword) still trips generic — the trap', () => {
  // Reuses "website" (present in the thread) but website/problem are stopwords, so they do not count.
  const stopwordOnly =
    'I think this is a pretty common website problem. I would start with the basics and then ' +
    'review your general setup carefully to narrow it down a little before changing anything.';
  assert.ok(codes(stopwordOnly).includes('generic'),
    'reusing only a generic stopword noun from the post must NOT clear the gate');
});

test('the warming prompt instructs literal reuse of a distinctive, non-generic token from the thread', () => {
  const p = warmupPrompt({
    id: 't', permalink: '/r/x/t', title: THREAD.title, subreddit: 'webdev',
    author: null, upvotes: null, commentCount: null, ageText: null, ageMinutes: null,
    body: THREAD.body, comments: THREAD.comments, collectedAt: '', source: 'read'
  });
  // It must tell the model to reuse/quote an exact term that already appears in the post...
  assert.ok(/\b(reuse|quote|copy)\b/i.test(p) && /\b(already|appears?|from the (post|thread))\b/i.test(p),
    'prompt must instruct reuse of a term already in the post');
  // ...and it must name the stopword caveat so "website"/"wordpress"/"problem" are not offered.
  assert.ok(/website/i.test(p) && /wordpress/i.test(p) && /problem/i.test(p),
    'prompt must warn off the generic stopwords website / wordpress / problem');
});
