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

test('boolean flags are never in the value-flag set', () => {
  for (const boolFlag of ['quick', 'once', 'force', 'all', 'json', 'list', 'verify', 'override']) {
    assert.equal(VALUE_FLAGS.has(boolFlag), false, `${boolFlag} must not take a value`);
  }
});
