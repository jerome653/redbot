/**
 * DEFECT-08 regression — the approval gate must fail closed.
 *
 * The original `choose()` returned `options[0]` for any unrecognised answer. `reply` calls it
 * with ['a','e','r'], so 'a' (approve, and publish) was the fallback for a blank line, a typo,
 * or a stray newline. These tests pin the two properties that stop that recurring:
 *
 *   1. the safe answer is an explicit argument, and must be one of the options;
 *   2. a non-interactive stdin refuses loudly rather than resolving to anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choose, isInteractive, NoTerminalError } from '../ask.js';

test('choose() rejects a safe answer that is not one of the options', async () => {
  await assert.rejects(
    () => choose('q', ['a', 'e', 'r'], 'x'),
    /safe answer "x" is not one of a\/e\/r/,
  );
});

test('choose() refuses when stdin is not a terminal', async () => {
  // The test runner pipes stdin, so this is the real non-interactive path.
  assert.equal(isInteractive(), false, 'test stdin is expected to be non-interactive');
  await assert.rejects(() => choose('  Publish this reply?', ['a', 'e', 'r'], 'r'), NoTerminalError);
});

test('a non-interactive run never resolves to approve', async () => {
  let result: string | null = null;
  try {
    result = await choose('  Publish this reply?', ['a', 'e', 'r'], 'r');
  } catch {
    // refusing is the correct outcome
  }
  assert.notEqual(result, 'a', 'publish must never be the outcome without a human keystroke');
});

test('the publish gate declares reject as its safe answer', async () => {
  // Guards against someone re-adding a positional default at the call site.
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../../src/commands/reply.ts', import.meta.url), 'utf8'),
  );
  assert.match(
    src,
    /choose\(\s*'\s*Publish this reply\?'\s*,\s*\['a',\s*'e',\s*'r'\]\s*,\s*'r'\s*\)/,
    "reply must pass 'r' as the safe answer to choose()",
  );
});
