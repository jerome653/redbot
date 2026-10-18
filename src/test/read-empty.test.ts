/**
 * A source page with no post links is recorded, not only counted as "0 threads" (#33).
 *
 * r/Wordpress_Development read "Found 0 post links" in every cycle from 2026-10-17 and the only
 * trace was a `read` row with collected 0, the same row a quiet community writes.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getPool, closePool } from '../db.js';
import { noteEmptyRead } from '../commands/read.js';

const SUB = 'read_empty_test_sub';
const clear = () => getPool().query(`DELETE FROM history WHERE subreddit = $1`, [SUB]);
before(clear);
after(async () => { await clear(); await closePool(); });

const rows = async () => (await getPool().query<{ kind: string; summary: string; data: unknown }>(
  `SELECT kind, summary, data FROM history WHERE subreddit = $1 ORDER BY id`, [SUB]
)).rows.map((r) => ({ ...r, data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data }));

/** Runs `fn` with console.warn captured, so the terminal line can be asserted. */
const capturingWarn = async (fn: () => Promise<void>): Promise<string[]> => {
  const warned: string[] = [];
  const orig = console.warn;
  console.warn = (m: string) => { warned.push(String(m)); };
  try { await fn(); } finally { console.warn = orig; }
  return warned;
};

test('an empty read is recorded as a selector miss, with the page title', async () => {
  await clear();
  const warned = await capturingWarn(() =>
    noteEmptyRead({ title: async () => 'Reddit - The heart of the internet' }, SUB));

  const r = await rows();
  assert.equal(r.length, 1, 'exactly one row');
  assert.equal(r[0]!.kind, 'selector.miss');
  assert.equal(r[0]!.summary, `no post links found on r/${SUB}`);
  const data = r[0]!.data as Record<string, unknown>;
  assert.equal(data.title, 'Reddit - The heart of the internet');
  assert.equal(data.selectors, 'sel.feedScope');
  assert.ok(warned.some((m) => m.includes(`redbot sources off ${SUB}`)), `the warning names the way out: ${warned}`);
});

test('a page whose title cannot be read is still recorded', async () => {
  await clear();
  await capturingWarn(() =>
    noteEmptyRead({ title: async () => { throw new Error('Target page, context or browser has been closed'); } }, SUB));

  const r = await rows();
  assert.equal(r.length, 1);
  assert.equal((r[0]!.data as Record<string, unknown>).title, '');
});

test('read() records the miss right after counting, and only when it found no links', () => {
  const src = readFileSync(new URL('../../src/commands/read.ts', import.meta.url), 'utf8');
  assert.match(
    src,
    /say\.step\(`Found \$\{links\.length\} post links\.`\);\r?\n\s*if \(links\.length === 0\) await noteEmptyRead\(s\.page, name\);/
  );
});
