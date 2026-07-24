import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentTextMatches } from '../reddit/post.js';

/**
 * H2: the publish confirmation must recognise our own comment once it renders. The old check
 * used Playwright's `text="<60-char prefix>"`, a STRICT full-text-node match, so a real comment
 * node — which holds the whole body plus an appended disclosure line plus chrome — never matched
 * and every genuine success was recorded as a failure. Matching is now a normalized substring.
 */

const BODY = 'Check the PHP error log first — a 502 from admin-ajax.php after a PHP 8.2 upgrade is usually a fatal in a plugin that has not caught up.';

test('a comment node that contains the body (plus a disclosure line and chrome) matches', () => {
  const rendered = `docs-architect · 2m\n\n${BODY}\n\nDisclosure: this reply was drafted with AI assistance and reviewed by a person before posting.\n\nReply  Share  Report`;
  assert.equal(commentTextMatches(rendered, BODY), true);
});

test('strict equality — the OLD behaviour — would have missed exactly that node', () => {
  const rendered = `docs-architect · 2m\n\n${BODY}\n\nReply`;
  const oldExact = rendered === BODY.slice(0, 60);   // what `text="..."` demanded
  assert.equal(oldExact, false, 'the old strict match could never succeed on a real node');
  assert.equal(commentTextMatches(rendered, BODY), true, 'the new substring match succeeds');
});

test('whitespace differences (wrapping, collapsed newlines) do not defeat the match', () => {
  const rewrapped = `${BODY.replace(/ /g, '\n')}`;   // Reddit re-wraps the text
  assert.equal(commentTextMatches(rewrapped, BODY), true);
});

test('a different comment does not falsely match', () => {
  assert.equal(commentTextMatches('some unrelated reply about caching plugins', BODY), false);
});

test('an empty body never matches — nothing to confirm', () => {
  assert.equal(commentTextMatches('anything at all', ''), false);
});
