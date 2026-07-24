import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitignoreActivePatterns } from '../commands/doctor.js';

/**
 * The secret-protection check must look at ACTIVE ignore rules, not the whole file — the old
 * substring test was satisfied by the .gitignore's own comment header, so deleting the real
 * rule still "passed" (evaluation M6).
 */

const REQUIRED = ['data/chrome-profile', 'data/operators', 'data/*.json', 'data/*.jsonl'];
const isMissing = (text: string) => {
  const active = gitignoreActivePatterns(text);
  return REQUIRED.filter((r) => !active.some((line) => line.includes(r)));
};

test('a pattern that appears only in a comment does NOT satisfy the check', () => {
  const commentOnly = [
    '# Verified with: git check-ignore -v data/chrome-profile/Default/Cookies',
    '# data/operators holds credentials',
    'node_modules/'
  ].join('\n');
  const missing = isMissing(commentOnly);
  assert.ok(missing.includes('data/chrome-profile'), 'a commented-out rule must read as missing');
  assert.ok(missing.includes('data/operators'));
});

test('active rules satisfy the check', () => {
  const real = [
    '# Browser profiles — never commit',
    'data/chrome-profile*/',
    'data/operators/',
    'data/*.json',
    'data/*.jsonl'
  ].join('\n');
  assert.deepEqual(isMissing(real), []);
});

test('gitignoreActivePatterns drops comments and blank lines', () => {
  assert.deepEqual(
    gitignoreActivePatterns('# a comment\n\n  data/*.json  \n# another\nnode_modules/\n'),
    ['data/*.json', 'node_modules/']
  );
});
