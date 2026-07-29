/**
 * Operator registration + status. The property that matters for safety is `shared` — the
 * flag that tells a picker "this operator's runs bill a login somebody else owns". If that
 * were computed wrong, the console could silently spend an operator's Claude quota on another
 * person's login, which is the exact failure the per-operator work exists to end.
 *
 * Every assertion below runs the SHIPPED code. The previous version of this file asserted
 * against a local `isShared` and a local copy of the name regex, both hand-copied out of
 * config.ts — so production never executed and the two copies were free to drift. Measured
 * 2026-07-27: with `shared` forced to false and the name check disabled in config.ts, all five
 * of the old tests still passed. A suite that cannot fail is not a suite.
 *
 * REDBOT_DATA is the seam. config.ts resolves DATA — and with it `operatorsPath` — once, at
 * module load, so the variable is set before the first import and the fixture is written into a
 * temp directory. These tests must never read, or write, the operator's real data/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-operators-'));
const TMP = process.env.REDBOT_DATA;

// Whatever the operator exported in their own shell must not decide what this file tests:
// REDBOT_CLAUDE_CONFIG_DIR short-circuits claudeConfigDir ahead of the name check, and a
// REDBOT_ACCOUNT naming an account absent from the fixture makes config.ts throw on import.
delete process.env.REDBOT_OPERATOR;
delete process.env.REDBOT_CLAUDE_CONFIG_DIR;
delete process.env.REDBOT_ACCOUNT;

// The same dedicated folder spelled both ways, because `join` gives backslashes on Windows and
// forward slashes elsewhere — pinning the normalisation needs both spellings on both platforms.
const dedicatedForward = join(TMP, 'operators', 'alice', 'claude').split('\\').join('/');
const dedicatedBack = join(TMP, 'operators', 'bob', 'claude').split('/').join('\\');
const sharedInsideData = join(TMP, 'shared-login', 'claude');
// Assembled from parts so no literal path is asserted about the disk. These deliberately do not exist.
const foreignRoot = ['X:', 'nowhere', 'claude-login'].join('/');
const ambientPosix = ['', 'opt', 'shared', 'claude-login'].join('/');

mkdirSync(join(TMP, 'operators', 'alice', 'claude'), { recursive: true });
mkdirSync(sharedInsideData, { recursive: true });
// bob's folder is deliberately absent: `ready` must report the disk, not the declaration.

writeFileSync(
  join(TMP, 'operators', 'operators.json'),
  JSON.stringify({
    alice: { configDir: dedicatedForward, declaredBy: 'alice', note: 'dedicated login' },
    bob: { configDir: dedicatedBack },
    carol: { configDir: sharedInsideData, declaredBy: 'carol', note: 'the team login' },
    erin: { configDir: foreignRoot },
    frank: { configDir: ambientPosix },
    dave: { declaredBy: 'dave' }
  }, null, 2)
);

const { listOperators } = await import('../config.js');

function op(name: string) {
  const found = listOperators().find((o) => o.name === name);
  if (!found) throw new Error(`${name} is missing from listOperators()`);
  return found;
}

test('a dedicated data/operators/<name>/claude folder is NOT shared', () => {
  assert.equal(op('alice').shared, false);
});

test('a login outside data/operators IS shared', () => {
  // Three shapes of "somebody else's login": a sibling folder inside data/, a foreign drive, and
  // the ambient POSIX path. None of them sits under data/operators, so none is dedicated.
  assert.equal(op('carol').shared, true, 'a sibling of data/operators is still shared');
  assert.equal(op('erin').shared, true);
  assert.equal(op('frank').shared, true);
});

test('backslash and forward-slash dedicated paths both read as not shared', () => {
  assert.equal(op('alice').shared, false, 'forward-slash spelling');
  assert.equal(op('bob').shared, false, 'backslash spelling');
});

test('listOperators reports the shape a picker reads', () => {
  // Was: "never throws on a well-formed file", run against whatever this checkout happened to
  // hold — which asserted nothing at all when data/operators/operators.json was absent, the
  // usual case, and could never check a VALUE. Same intent, the picker's fields are present and
  // typed, now over a fixture whose right answers are known.
  const ops = listOperators();
  for (const o of ops) {
    assert.equal(typeof o.name, 'string');
    assert.equal(typeof o.shared, 'boolean');
    assert.equal(typeof o.ready, 'boolean');
    assert.equal(typeof o.configDir, 'string');
  }
  assert.deepEqual(ops.map((o) => o.name).sort(), ['alice', 'bob', 'carol', 'erin', 'frank']);
  // An entry with no configDir is dropped rather than surfaced with an empty one: a picker
  // offering a credential-less operator would run against whatever login the box happens to hold.
  assert.equal(ops.some((o) => o.name === 'dave'), false, 'an entry with no configDir is not an operator');

  assert.equal(op('alice').ready, true, 'the credential folder exists');
  assert.equal(op('bob').ready, false, 'declared, but nobody has logged in there yet');
  assert.equal(op('carol').ready, true);
  assert.equal(op('alice').declaredBy, 'alice');
  assert.equal(op('alice').note, 'dedicated login');
  assert.equal(op('bob').declaredBy, undefined, 'a field the file omits stays absent');
});

/**
 * REDBOT_OPERATOR becomes a path segment under data/operators/, so its name check is a
 * containment boundary and not cosmetics: without it "../escape" resolves the credential
 * directory one level ABOVE the operators root. config.ts reads the variable once, at module
 * load, so each name needs its own module instance — the `?reload=` query is what makes Node
 * treat the specifier as distinct and evaluate config.ts again against the env just set.
 */
let reloads = 0;
async function configFor(operator: string): Promise<typeof import('../config.js')> {
  process.env.REDBOT_OPERATOR = operator;
  return (await import(`../config.js?reload=${++reloads}`)) as typeof import('../config.js');
}

test('an accepted operator name resolves inside data/operators', async () => {
  for (const name of ['jerome', 'alice_2']) {
    const { claudeConfigDir } = await configFor(name);
    assert.equal(claudeConfigDir(), join(TMP, 'operators', name, 'claude'), name);
  }
});

test('a rejected operator name never yields a credential directory', async () => {
  for (const name of ['has space', '../escape', 'a/b', '..']) {
    const { claudeConfigDir } = await configFor(name);
    assert.throws(claudeConfigDir, /Invalid REDBOT_OPERATOR/, `accepted ${JSON.stringify(name)}`);
  }
});

test('an empty REDBOT_OPERATOR is refused, not read as a default', async () => {
  // The old test asserted its local regex rejected "". Production refuses it by a different
  // branch: an empty variable is falsy, so claudeConfigDir reads it as UNSET and answers with
  // the setup instructions. Same guarantee — "" never resolves a config dir — now proved
  // against the shipped code rather than a copy of one line of it.
  const { claudeConfigDir } = await configFor('');
  assert.throws(claudeConfigDir, /No Claude operator set/);
});

process.on('exit', () => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});
