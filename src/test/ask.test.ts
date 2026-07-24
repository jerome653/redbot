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
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { choose, isInteractive, NoTerminalError, takeConsoleApproval, approvalsDir } from '../ask.js';

/* ---- console approval: the token the console writes and reply consumes (evaluation) ---- */

const writeToken = (dataDir: string, draftId: string, over: Record<string, unknown> = {}) => {
  const file = join(approvalsDir(dataDir), `${draftId}.json`);
  writeFileSync(file, JSON.stringify({
    draftId, decision: 'approved', note: 'looks right', at: new Date().toISOString(), ...over
  }), 'utf8');
  return file;
};

test('a fresh token is accepted once, then consumed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redbot-appr-'));
  writeToken(dir, 'd_1');
  const first = takeConsoleApproval(dir, 'd_1');
  assert.equal(first?.draftId, 'd_1');
  assert.equal(takeConsoleApproval(dir, 'd_1'), null, 'a consumed token cannot approve again');
});

test('a token older than five minutes is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redbot-appr-'));
  writeToken(dir, 'd_1', { at: new Date(Date.now() - 6 * 60_000).toISOString() });
  assert.equal(takeConsoleApproval(dir, 'd_1'), null);
});

test('a token whose draftId does not match is refused, and does not approve a different draft', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redbot-appr-'));
  writeToken(dir, 'd_1', { draftId: 'd_OTHER' });
  assert.equal(takeConsoleApproval(dir, 'd_1'), null);
});

test('the claimed token leaves nothing behind — no reusable file remains', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redbot-appr-'));
  const file = writeToken(dir, 'd_1');
  takeConsoleApproval(dir, 'd_1');
  assert.equal(existsSync(file), false, 'the original token file must be gone');
  const leftovers = readdirSync(approvalsDir(dir));
  assert.equal(leftovers.length, 0, `no claim/temp file may linger: ${leftovers.join(', ')}`);
});

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
