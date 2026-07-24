/**
 * H8 regression. The bug that made this test necessary: `reply --quick d_target` published the
 * LATEST pending draft, not d_target, because the parser dropped any token following a `--flag`
 * — including boolean flags. For a tool where a human approves specific text, posting the wrong
 * draft is the worst failure there is. Every case below fixes one reading of that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionalArgs, VALUE_FLAGS } from '../args.js';

test('a boolean flag does NOT swallow the positional after it — the H8 case', () => {
  assert.deepEqual(positionalArgs(['--quick', 'd_target']), ['d_target']);
});

test('every known boolean flag leaves the following positional intact', () => {
  for (const f of ['--force', '--json', '--once', '--override', '--verify', '--all', '--list']) {
    assert.deepEqual(positionalArgs([f, 'd_x']), ['d_x'], `${f} swallowed the positional`);
  }
});

test('a value flag DOES consume its value, which is not a positional', () => {
  assert.deepEqual(positionalArgs(['read', '--kind', 'medium']), ['read']);
  assert.deepEqual(positionalArgs(['search', '--commit', '1,4,7']), ['search']);
});

test('a value flag followed by a real positional keeps both straight', () => {
  // `observe d_x --checkpoint 1h` — d_x is the target, 1h is the flag value.
  assert.deepEqual(positionalArgs(['d_x', '--checkpoint', '1h']), ['d_x']);
});

test('--flag=value form consumes nothing extra', () => {
  assert.deepEqual(positionalArgs(['--kind=medium', 'read']), ['read']);
  assert.deepEqual(positionalArgs(['reply', '--quick', 'd_x', '--kind=short']), ['reply', 'd_x']);
});

test('a value flag at the very end with no value consumes nothing that is not there', () => {
  assert.deepEqual(positionalArgs(['reply', 'd_x', '--kind']), ['reply', 'd_x']);
});

test('two value flags in a row do not consume each other', () => {
  // --commit expects a value but the next token is another flag, so it consumes nothing.
  assert.deepEqual(positionalArgs(['search', '--commit', '--kind', 'medium']), ['search']);
});

test('bare positionals pass through untouched', () => {
  assert.deepEqual(positionalArgs(['operators', 'add', 'bob']), ['operators', 'add', 'bob']);
});

test('the value-flag set matches the flags the CLI reads with a value', () => {
  // If a value flag is added to cli.ts but not here, the H8 class silently returns.
  assert.deepEqual([...VALUE_FLAGS].sort(), ['checkpoint', 'commit', 'every', 'kind', 'limit', 'sub']);
});
