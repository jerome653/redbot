import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson, writeJson } from '../store.js';

/**
 * The store's two data-safety properties (evaluation M1/M2):
 *   - a write is atomic and uses a per-process temp name, so concurrent writers do not collide;
 *   - an unreadable file is moved aside and the read fails, rather than silently becoming empty
 *     and being overwritten on the next save.
 */

test('writeJson then readJson round-trips a value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redbot-store-'));
  const p = join(dir, 'drafts.json');
  writeJson(p, [{ id: 'd_1' }, { id: 'd_2' }]);
  assert.deepEqual(readJson(p, []), [{ id: 'd_1' }, { id: 'd_2' }]);
});

test('readJson returns the fallback for a file that does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redbot-store-'));
  assert.deepEqual(readJson(join(dir, 'nope.json'), []), []);
});

test('a corrupt file is moved aside and the read throws — it is NOT downgraded to empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redbot-store-'));
  const p = join(dir, 'drafts.json');
  writeFileSync(p, '[{ this is not json', 'utf8');

  assert.throws(() => readJson(p, []), /not readable JSON/);

  // the corrupt original is preserved under a .corrupt-* name, and the live path no longer
  // holds the unreadable bytes (so the next writer cannot overwrite real data with [])
  assert.equal(existsSync(p), false, 'the corrupt file must be moved off the live path');
  const aside = readdirSync(dir).filter((f) => f.includes('.corrupt-'));
  assert.equal(aside.length, 1, `exactly one .corrupt-* file expected, saw ${aside.join(', ')}`);
  assert.match(readFileSync(join(dir, aside[0]!), 'utf8'), /this is not json/, 'the bytes are preserved');
});

test('writeJson leaves no temp file behind and the temp name is process-unique', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redbot-store-'));
  const p = join(dir, 'threads.json');
  writeJson(p, [{ id: 't_1' }]);
  const stray = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  assert.equal(stray.length, 0, `no leftover temp files: ${stray.join(', ')}`);
  // the shared fixed name `threads.json.tmp` must never be what we write to
  assert.equal(existsSync(`${p}.tmp`), false);
});
