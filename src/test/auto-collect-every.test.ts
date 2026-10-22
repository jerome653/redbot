/**
 * A rotation turn is warmup-first: `auto --once` collects only when the last collection is older
 * than REDBOT_COLLECT_EVERY_MINUTES. Collection is ~25 of a ~32-minute cycle (measured on cardinal,
 * 2026-10-22), and the corpus is shared by every account, so collecting on each of 13 accounts'
 * turns re-reads the same subreddits 13 times.
 *
 * UNSET MEANS ALWAYS COLLECT — the desktop single-account loop never sets it and must behave
 * exactly as before. Only the rotation spawn sets it (tools/product/server.mjs rotationStart).
 *
 * No database rows: the history is passed in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HistoryEntry } from '../types.js';
import { collectEveryMinutes, collectionDue, lastCollectionAt } from '../commands/auto.js';

const NOW = new Date('2026-10-22T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const row = (kind: string, ts: string, account: string | null = 'x'): HistoryEntry =>
  ({ ts, kind, detail: '', account } as unknown as HistoryEntry);

test('unset, empty, zero or junk means no gate: collect every cycle, as the single-account loop always has', () => {
  assert.equal(collectEveryMinutes({}), null);
  assert.equal(collectEveryMinutes({ REDBOT_COLLECT_EVERY_MINUTES: '' }), null);
  assert.equal(collectEveryMinutes({ REDBOT_COLLECT_EVERY_MINUTES: '0' }), null);
  assert.equal(collectEveryMinutes({ REDBOT_COLLECT_EVERY_MINUTES: 'often' }), null);
  assert.equal(collectEveryMinutes({ REDBOT_COLLECT_EVERY_MINUTES: '180' }), 180);
  assert.equal(collectionDue(ago(1), NOW, null).due, true);
});

test('a collection older than the interval is due; a recent one is skipped', () => {
  assert.equal(collectionDue(ago(181), NOW, 180).due, true);
  assert.equal(collectionDue(ago(180), NOW, 180).due, true);
  const skip = collectionDue(ago(30), NOW, 180);
  assert.equal(skip.due, false);
  assert.match(skip.why, /30 min ago/);
});

test('never collected is due', () => {
  assert.equal(collectionDue(null, NOW, 180).due, true);
});

test('the last collection is the newest read or search row, from any account (the corpus is shared)', () => {
  const h = [
    row('read', ago(400), 'a'),
    row('search', ago(50), 'b'),
    row('publish.ok', ago(5), 'c'),
    row('search.preview', ago(2), 'c'),
    row('draft', ago(1), null)
  ];
  assert.equal(lastCollectionAt(h), ago(50));
  assert.equal(lastCollectionAt([row('publish.ok', ago(5))]), null);
});
