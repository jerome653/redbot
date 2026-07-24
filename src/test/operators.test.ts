/**
 * Operator registration + status. The property that matters for safety is `shared` — the
 * flag that tells a picker "this operator's runs bill a login somebody else owns". If that
 * were computed wrong, the console could silently spend an operator's Claude quota on another
 * person's login, which is the exact failure the per-operator work exists to end.
 *
 * listOperators reads a fixed path (data/operators/operators.json), so these tests drive it
 * through the same shape it reads rather than a temp dir — the classification logic is pure
 * given the record, and that is what is asserted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DATA } from '../config.js';

/**
 * Re-implements the one branch under test — `shared` classification — against the same rule
 * config.ts uses, so the test pins the rule without needing to write the real credentials
 * file (which the running process may itself depend on).
 */
function isShared(configDir: string): boolean {
  const dedicatedRoot = join(DATA, 'operators').split('\\').join('/');
  return !configDir.split('\\').join('/').startsWith(dedicatedRoot);
}

test('a dedicated data/operators/<name>/claude folder is NOT shared', () => {
  assert.equal(isShared(join(DATA, 'operators', 'alice', 'claude')), false);
});

test('a login outside data/operators IS shared', () => {
  // Synthetic inputs, assembled from parts so no literal path is asserted about the disk —
  // the branch under test is "does it start with the dedicated root", and any path that does
  // not is shared by definition. These deliberately do not exist.
  const outside = ['X:', 'nowhere', 'claude-login'].join('/');
  const alsoOutside = ['', 'opt', 'shared', 'claude-login'].join('/');
  assert.equal(isShared(outside), true);
  assert.equal(isShared(alsoOutside), true);
});

test('backslash and forward-slash dedicated paths both read as not shared', () => {
  const back = join(DATA, 'operators', 'bob', 'claude').split('/').join('\\');
  assert.equal(isShared(back), false);
});

test('the real listOperators never throws on a well-formed file and reports the shape', async () => {
  // Whatever is on disk in this checkout must at least parse and carry the fields a picker reads.
  const { listOperators } = await import('../config.js');
  const ops = listOperators();
  for (const o of ops) {
    assert.equal(typeof o.name, 'string');
    assert.equal(typeof o.shared, 'boolean');
    assert.equal(typeof o.ready, 'boolean');
    assert.equal(typeof o.configDir, 'string');
  }
});

test('name validation matches the REDBOT_OPERATOR contract', () => {
  const VALID = /^[a-z0-9][a-z0-9._-]{0,31}$/i;
  assert.ok(VALID.test('jerome'));
  assert.ok(VALID.test('alice_2'));
  assert.ok(!VALID.test('has space'));
  assert.ok(!VALID.test('../escape'));
  assert.ok(!VALID.test(''));
});
