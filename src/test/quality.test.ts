import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessQuality } from '../quality.js';
import type { Thread } from '../types.js';

const THREAD: Pick<Thread, 'title' | 'body' | 'comments'> = {
  title: 'Checkout throws 502 after upgrading to PHP 8.2',
  body:
    'Since the upgrade, checkout throws a 502 from admin-ajax.php. ' +
    'Query Monitor shows nothing and the site is otherwise fine.',
  comments: [{ author: 'someone', body: 'Have you tried a different browser?', depth: 0 }]
};

const GOOD = `Check the PHP error log before anything else. A 502 from admin-ajax.php right after a PHP 8.2 upgrade is usually a fatal in a plugin that has not caught up with the functions removed in 8.0, and the log names the offending file on the first line.

If the log is empty, set WP_DEBUG_LOG to true in wp-config.php and reproduce the checkout once. You should get a stack trace pointing at the plugin.

Worth ruling out: on php-fpm a fatal surfaces as a gateway error rather than a PHP notice, which is why Query Monitor sees nothing.`;

const codes = (body: string, ctx = {}) => assessQuality(body, ctx).issues.map((i) => i.code);

test('a specific, hedged, thread-aware reply passes', () => {
  const r = assessQuality(GOOD, { thread: THREAD });
  assert.equal(r.ok, true, `blocked by: ${JSON.stringify(r.issues)}`);
  assert.ok(r.metrics.technicalHits >= 1, 'should have matched a technical token from the thread');
  assert.ok(r.metrics.hedges >= 1);
});

test('AI-register phrases block', () => {
  for (const phrase of [
    'You can leverage the caching layer here to fix admin-ajax.php timeouts on checkout.',
    'It is worth noting that admin-ajax.php on checkout will 502 under PHP 8.2 upgrades.',
    'Great question. The admin-ajax.php 502 on checkout comes from the PHP 8.2 upgrade.'
  ]) {
    assert.ok(codes(phrase, { thread: THREAD }).includes('cliche'), `not flagged: ${phrase}`);
  }
});

test('a generic answer that could fit any thread is blocked', () => {
  const generic =
    'Start with the basics and work outward. Most of these turn out to be a caching layer ' +
    'holding an old response, so clear it and retest before touching configuration. ' +
    'If little changes, disable your extensions and add them back one at a time.';
  assert.ok(codes(generic, { thread: THREAD }).includes('generic'));
});

/*
 * REMOVED 2026-07-23 (D-01): two tests covering the `false-certainty` gate.
 *
 * That gate fired when Phase-1 triage confidence was under 70 and the reply hedged nothing.
 * Its only input was the model's confidence in its own reading of a title — the field DEFECT-12
 * returned as 90 for a post the same rubric scores 5. The path is retired, so the gate and its
 * tests are gone rather than kept green against a fixture no production code can produce.
 *
 * The failure they aimed at is covered by Argus Phase 8 (`src/argus/epistemic.ts`), which
 * compares each claim's language against the certainty its provenance supports.
 */

test('length is bounded at both ends', () => {
  const tiny = codes('Check the log.', { thread: THREAD });
  assert.ok(tiny.includes('too-short'));

  const bloated = `${GOOD} ${'The plugin log will show the fatal error on the first line. '.repeat(40)}`;
  assert.ok(codes(bloated, { thread: THREAD }).includes('too-long'));
});

test('document formatting is flagged — a comment has no headings', () => {
  const doc = `## Diagnosis\n\n${GOOD}`;
  const r = assessQuality(doc, { thread: THREAD });
  assert.ok(r.issues.some((i) => i.code === 'document-formatting'));
  assert.equal(r.ok, true, 'formatting is a warning, not a block');
});

test('uniform sentence length is flagged as the flattest machine tell', () => {
  const flat = [
    'The error log holds the answer here.',
    'The plugin list matters a great deal.',
    'The cache layer hides the real fault.',
    'The admin-ajax.php route returns a 502.'
  ].join(' ');
  assert.ok(codes(flat, { thread: THREAD }).includes('uniform-rhythm'));
});

test('padding is warned about, not blocked', () => {
  const padded = GOOD.replace('Check the PHP error log', 'In order to diagnose this, check the PHP error log');
  const r = assessQuality(padded, { thread: THREAD });
  assert.ok(r.issues.some((i) => i.code === 'padding' && i.severity === 'warn'));
  assert.equal(r.ok, true);
});

test('the human checklist is returned, and names what the machine cannot judge', () => {
  const r = assessQuality(GOOD, { thread: THREAD });
  assert.ok(r.humanChecklist.length >= 3);
  assert.ok(r.humanChecklist.some((q) => /technically correct/i.test(q)));
  assert.ok(r.humanChecklist.some((q) => /own account/i.test(q)));
});
