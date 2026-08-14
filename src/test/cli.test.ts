import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs, VALUE_FLAGS } from '../cli.js';

/**
 * The parser bug the evaluation called H8: a boolean flag before a positional (`--quick
 * d_target`) had its successor swallowed, because the parser could not tell a boolean flag
 * from a value flag and dropped the token after ANY `--flag`. For `reply` that meant the named
 * draft vanished and the latest pending draft was published instead — a human approving
 * specific text, sent to the wrong comment.
 */

test('a boolean flag before a positional keeps the positional', () => {
  const { flags, positional } = parseCliArgs(['--quick', 'd_target']);
  assert.deepEqual(positional, ['d_target']);
  assert.ok(flags.has('--quick'));
});

test('certify --override d_9 targets d_9, not the latest pending draft', () => {
  const { positional, flags } = parseCliArgs(['--override', 'd_9']);
  assert.equal(positional[0], 'd_9');
  assert.ok(flags.has('--override'));
});

test('a value flag in space form still consumes its value', () => {
  const { positional, flagValue } = parseCliArgs(['--kind', 'medium', 'r/WordPress']);
  assert.equal(flagValue('kind'), 'medium');
  assert.deepEqual(positional, ['r/WordPress'], 'the value must not also read as a positional');
});

test('an inline value flag does not swallow the following positional', () => {
  const { positional, flagValue } = parseCliArgs(['--kind=medium', 'r/WordPress']);
  assert.equal(flagValue('kind'), 'medium');
  assert.deepEqual(positional, ['r/WordPress']);
});

test('a positional before any flag is kept', () => {
  const { positional } = parseCliArgs(['d_1', '--quick']);
  assert.deepEqual(positional, ['d_1']);
});

/**
 * THE FORWARD CHECK, WHICH IS THE ONE THAT WAS MISSING.
 *
 * The test below pins that no BOOLEAN flag is in the set. Nothing pinned the other direction —
 * that every flag which READS a value is in it — and that is the asymmetry D-10 came through:
 * `--country US` on `redbot proxy vet` left "US" in `positional`, where the first positional is
 * an account HANDLE, and a handle is what triggers a bind. A parser that quietly re-purposes a
 * flag's value as a command's argument is a write-path bug wearing a typo's clothes.
 *
 * Four more had accumulated by the 2026-08-14 audit: --admin-token-file, --batch, --label and
 * --share-from. Listing them here would fix today and rot tomorrow, so this derives the set from
 * the source instead: every `flagValue('x')` call site must have 'x' in VALUE_FLAGS. Add a new
 * value flag and forget the set, and this fails naming it.
 */
test('every flag that reads a value is declared as one', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../cli.ts', import.meta.url).href.replace('/dist/', '/src/')), 'utf8');

  const read = [...src.matchAll(/flagValue\('([a-z-]+)'\)/g)].map((m) => m[1]!);
  assert.ok(read.length > 10, `expected to find the flagValue call sites, saw ${read.length}`);

  const undeclared = [...new Set(read)].filter((f) => !VALUE_FLAGS.has(f)).sort();
  assert.deepEqual(undeclared, [],
    `these read a value but are not in VALUE_FLAGS, so their values leak into positionals: ${undeclared.join(', ')}`);
});

test('boolean flags are never in the value-flag set', () => {
  for (const boolFlag of ['quick', 'once', 'force', 'all', 'json', 'list', 'verify', 'override']) {
    assert.equal(VALUE_FLAGS.has(boolFlag), false, `${boolFlag} must not take a value`);
  }
});
