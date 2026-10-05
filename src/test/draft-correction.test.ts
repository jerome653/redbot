/**
 * The rewrite instruction fed back when the craft gate would block a draft.
 *
 * Exercised here rather than through draft.ts because draft.ts needs a thread, a gap analysis, a
 * reference lookup and a live model to reach the line — the same argument src/autopublish.ts makes
 * for keeping its decision in a pure function.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftCorrection } from '../prompts.js';
import { assessQuality } from '../quality.js';

test('every failure is named, with its own message, not summarised', () => {
  const out = draftCorrection([
    { gate: 'cliche', reason: 'AI-register phrase: "hope this helps"' },
    { gate: 'too-long', reason: '612 words — past what anyone reads in a comment; cut it' }
  ]);
  assert.match(out, /cliche: AI-register phrase: "hope this helps"/);
  assert.match(out, /too-long: 612 words/);
  assert.match(out, /REWRITE REQUIRED/);
  assert.match(out, /same JSON shape/, 'the model must be told the contract has not changed');
});

test('it tells the model not to pad, because "fix it" invites length', () => {
  const out = draftCorrection([{ gate: 'cliche', reason: 'x' }]);
  assert.match(out, /do not\s+lengthen it/);
});

test('the quality:generic gate gets the mechanism, because trying harder cannot fix it', () => {
  /**
   * quality.ts:181 fires on `technicalHits === 0 && specificityHits < 3`, and technicalHits counts
   * technical tokens in the INTERSECTION — so a reply cannot raise it with new detail, only by
   * reusing the thread's own strings. An instruction that says "be more specific" is therefore
   * wrong advice for this failure, which is why this branch exists.
   */
  const out = draftCorrection([{ gate: 'quality:generic', reason: '2 overlapping terms, 0 technical' }]);
  assert.match(out, /appear in BOTH/);
  assert.match(out, /scores zero/);
  assert.match(out, /verbatim/);
});

test('a failure list without generic does not carry the generic mechanism', () => {
  const out = draftCorrection([{ gate: 'cliche', reason: 'x' }]);
  assert.doesNotMatch(out, /appear in BOTH/);
});

test('the advice it gives is the advice that actually clears the gate', () => {
  /* The instruction is only worth sending if following it changes the verdict. Asserted against
     the real rule, on the real shape of failure measured on 2026-09-28. */
  const thread = {
    title: "Can't get MAMP working with PHP 8+ on Windows. What is my best shot on getting MediaWiki rolling locally?",
    body: 'I have MAMP 6.8 installed and switched the version dropdown to PHP 8.3 but MediaWiki still reports PHP 7.4.',
    comments: [{ body: 'Check your php.ini path', author: 'a', depth: 0 }]
  };
  const invented = 'Before ruling out MAMP, I would open its httpd.conf and check the LoadModule line for a stale reference.';
  const reused = 'Since MAMP 6.8 still reports PHP 7.4 after you switched the dropdown to PHP 8.3, I would check which php.ini MediaWiki actually loads.';

  const blocked = (b: string) => assessQuality(b, { thread }).issues.some((i) => i.severity === 'block' && i.code === 'generic');
  assert.equal(blocked(invented), true, 'inventing specifics is what the gate rejects');
  assert.equal(blocked(reused), false, 'reusing the thread\'s own strings is what clears it');
});
