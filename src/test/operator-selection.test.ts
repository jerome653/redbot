/**
 * The operator choice survives, and the requirement check can see it.
 *
 * THE DEFECT THIS PINS. Picking an operator on the Setup screen wrote to a variable inside the
 * console server and nothing else. `checkRequirements()` reads `config.llm.operator`, which read
 * `process.env.REDBOT_OPERATOR` and was captured once at module load. So the two never met: the
 * picker showed "dan", runs were billed to dan, and the row directly above the picker said
 * "no Claude operator is selected". Measured on a packaged install before the fix — every button
 * returned ok=true and the requirement never moved.
 *
 * The second half is `ready`. Registering an operator creates the folder; signing in is a
 * separate act nobody can do from a web page. Reporting "ready" on the folder meant a Setup
 * screen could be entirely green while the first model call failed with "not logged in".
 *
 * REDBOT_DATA is the seam, exactly as in operators.test.ts: config.ts resolves DATA — and with it
 * operatorsPath and the selection file — once at module load, so it is set before the first
 * import and every write lands in a temp directory. These tests must never touch the real data/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-opsel-'));
const TMP = process.env.REDBOT_DATA;

// The operator's own shell must not decide what this file tests.
delete process.env.REDBOT_OPERATOR;
delete process.env.REDBOT_CLAUDE_CONFIG_DIR;
delete process.env.REDBOT_ACCOUNT;

const signedInDir = join(TMP, 'operators', 'signee', 'claude');
const registeredOnlyDir = join(TMP, 'operators', 'newbie', 'claude');
mkdirSync(signedInDir, { recursive: true });
mkdirSync(registeredOnlyDir, { recursive: true });
writeFileSync(join(signedInDir, '.credentials.json'), '{}');

writeFileSync(
  join(TMP, 'operators', 'operators.json'),
  JSON.stringify({
    signee: { configDir: signedInDir, declaredBy: 'signee' },
    newbie: { configDir: registeredOnlyDir, declaredBy: 'newbie' }
  }, null, 2)
);

const {
  config, storedOperatorSelection, setStoredOperatorSelection, operatorSignedIn,
  operatorSelectionPath, claudeConfigDir
} = await import('../config.js');

test('with nothing stored and no environment, no operator is selected', () => {
  assert.equal(storedOperatorSelection(), null);
  assert.equal(config.llm.operator, null);
});

test('a stored choice is what config.llm.operator answers — no restart, no env var', () => {
  setStoredOperatorSelection('signee');
  assert.equal(storedOperatorSelection(), 'signee');
  /* The heart of it: the SAME already-imported module object now reports the new choice. Before
     the fix `operator` was a value captured at import, so this read would still be null and the
     requirement check would keep insisting nobody was selected. */
  assert.equal(config.llm.operator, 'signee');
  assert.equal(claudeConfigDir(), signedInDir);
});

test('the choice is on disk, so it survives a restart', () => {
  assert.equal(existsSync(operatorSelectionPath), true);
  const onDisk = JSON.parse(readFileSync(operatorSelectionPath, 'utf8')) as { operator: string };
  assert.equal(onDisk.operator, 'signee');
});

test('REDBOT_OPERATOR still wins over the stored choice', () => {
  process.env.REDBOT_OPERATOR = 'newbie';
  assert.equal(config.llm.operator, 'newbie', 'the environment must keep its precedence');
  assert.equal(storedOperatorSelection(), 'signee', 'and must not overwrite what was stored');
  delete process.env.REDBOT_OPERATOR;
  assert.equal(config.llm.operator, 'signee', 'clearing the variable falls back to the choice');
});

test('clearing the choice returns to nobody selected', () => {
  setStoredOperatorSelection(null);
  assert.equal(storedOperatorSelection(), null);
  assert.equal(config.llm.operator, null);
  assert.equal(existsSync(operatorSelectionPath), false, 'the file is removed, not blanked');
  assert.throws(claudeConfigDir, /No Claude operator set/);
});

test('an unregistered name is refused — a billing identity is never invented', () => {
  assert.throws(() => setStoredOperatorSelection('nobody-by-that-name'), /not a registered operator/);
  assert.equal(storedOperatorSelection(), null, 'nothing was written');
});

test('a malformed name is refused before it can become a path segment', () => {
  for (const bad of ['../escape', 'a/b', 'has space', '..']) {
    assert.throws(() => setStoredOperatorSelection(bad), /Invalid operator name/, bad);
  }
  assert.equal(storedOperatorSelection(), null);
});

test('a corrupt selection file reads as nobody selected, and does not throw', () => {
  /* This is read from a getter sitting under thirteen call sites, including claudeConfigDir()
     inside completeViaCli. It has to degrade to "nobody selected" — which every caller already
     handles by refusing — rather than throw from the middle of an unrelated command. */
  mkdirSync(join(TMP, 'operators'), { recursive: true });
  writeFileSync(operatorSelectionPath, 'not json at all');
  assert.equal(storedOperatorSelection(), null);
  assert.equal(config.llm.operator, null);

  writeFileSync(operatorSelectionPath, JSON.stringify({ operator: '../escape' }));
  assert.equal(storedOperatorSelection(), null, 'a hand-edited bad name is re-validated on read');

  writeFileSync(operatorSelectionPath, JSON.stringify({ operator: 42 }));
  assert.equal(storedOperatorSelection(), null, 'a non-string is not a name');

  rmSync(operatorSelectionPath, { force: true });
});

test('signed in is credentials present, not the folder existing', () => {
  assert.equal(operatorSignedIn(signedInDir), true);
  assert.equal(operatorSignedIn(registeredOnlyDir), false,
    'REGRESSION: the folder exists because registering made it — that is not a login');
  assert.equal(operatorSignedIn(join(TMP, 'operators', 'absent', 'claude')), false);
});

process.on('exit', () => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});
