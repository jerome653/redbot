/**
 * A landed reply's history row names where it landed.
 *
 * MEASURED 2026-10-30 on cardinal, history since 2026-10-01: 60 `publish.ok` rows, 0 with a
 * subreddit, 0 with a permalink, 0 with a thread_url — while the 64 `publish.attempt` rows
 * before them all carried the thread permalink. The reply path passed only `data` keys to
 * record(), so the columns src/log.ts lifts (subreddit, threadUrl, permalink) stayed null.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { publishOkColumns } = await import('../outcomes.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the comment permalink, the thread and its subreddit are all named', () => {
  assert.deepEqual(
    publishOkColumns('/r/webdev/comments/abc123/some_title/', {
      url: 'https://example.invalid/r/webdev/comments/abc123/some_title/',
      commentPermalink: '/r/webdev/comments/abc123/some_title/c0ffee/'
    }),
    {
      subreddit: 'webdev',
      threadUrl: '/r/webdev/comments/abc123/some_title/',
      permalink: '/r/webdev/comments/abc123/some_title/c0ffee/'
    }
  );
});

test('with no comment permalink the page url stands in, and the subreddit keeps its case', () => {
  const c = publishOkColumns('/r/WordPress/comments/x1/t/', { url: '/r/WordPress/comments/x1/t/' });
  assert.equal(c.subreddit, 'WordPress');
  assert.equal(c.permalink, '/r/WordPress/comments/x1/t/');
});

test('a thread link that is not reddit-shaped files under null, never a guess', () => {
  const c = publishOkColumns('not-a-permalink', {});
  assert.equal(c.subreddit, null);
  assert.equal(c.permalink, null);
});

test('the reply path passes these columns on its publish.ok row', () => {
  const src = readFileSync(join(ROOT, 'src', 'commands', 'reply.ts'), 'utf8');
  const at = src.indexOf("record('publish.ok'");
  assert.ok(at > 0);
  assert.match(src.slice(at, at + 400), /\.\.\.publishOkColumns\(/);
});
