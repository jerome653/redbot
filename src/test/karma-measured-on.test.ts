/**
 * WHICH ACCOUNTS ALREADY HAVE TODAY'S KARMA — the query a retried karma run leans on.
 *
 * MEASURED 2026-11-03 13:30 PST: `redbot-karma.service` refused to race a rotation tick,
 * exited 1, went red, and because the timer had no retry the day kept karma for 4 of 13
 * accounts against 13 of 13 on 1 and 2 November. The retry slots that fix that are only safe
 * if a run whose figures are already recorded opens no browser, and this is the read that
 * tells it so. A wrong day boundary here means either 13 pointless Chrome launches or a day
 * silently skipped, so both edges of the UTC day are asserted.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(ROOT, 'db', 'sqlite', 'migrate.mjs');

const dir = mkdtempSync(join(tmpdir(), 'redbot-karmaday-'));
process.env.REDBOT_DB = join(dir, 'redbot.db');
const migrated = spawnSync(process.execPath, [RUNNER, 'up'], { encoding: 'utf8' });
if (migrated.status !== 0) throw new Error(`migrate up failed:
${migrated.stdout}
${migrated.stderr}`);

const { getPool, closePool } = await import('../db.js');
const { insertObservation, karmaMeasuredOn } = await import('../db/logs.js');

after(async () => { await closePool(); rmSync(dir, { recursive: true, force: true }); });

const karma = (account: string, ts: string) =>
  insertObservation(getPool(), { ts, account, kind: 'karma', vector: 'signed-in', value: 3 });

test('an account measured today is named; one measured yesterday is not', async () => {
  await karma('alexdigital10', '2026-11-03T05:17:32.954Z');
  await karma('kylegrowth', '2026-11-02T23:59:59.999Z');
  const on = await karmaMeasuredOn(getPool(), '2026-11-03');
  assert.ok(on.has('alexdigital10'));
  assert.ok(!on.has('kylegrowth'), 'yesterday 23:59:59.999Z is not today');
});

test('both edges of the UTC day are inside it', async () => {
  await karma('edgeOpen', '2026-11-05T00:00:00.000Z');
  await karma('edgeShut', '2026-11-05T23:59:59.999Z');
  await karma('nextDay', '2026-11-06T00:00:00.000Z');
  const on = await karmaMeasuredOn(getPool(), '2026-11-05');
  assert.ok(on.has('edgeOpen'), 'midnight exactly is the first instant of the day');
  assert.ok(on.has('edgeShut'));
  assert.ok(!on.has('nextDay'), 'the next midnight belongs to the next day');
});

test('a day with no karma is an empty set, not a throw', async () => {
  const on = await karmaMeasuredOn(getPool(), '2026-01-01');
  assert.equal(on.size, 0);
});

test('a non-karma observation does not count as a measurement', async () => {
  await insertObservation(getPool(), {
    ts: '2026-11-07T04:00:00.000Z', account: 'onlyAComment', kind: 'comment-karma',
    vector: 'signed-in', value: 1
  });
  const on = await karmaMeasuredOn(getPool(), '2026-11-07');
  assert.ok(!on.has('onlyAComment'), 'comment-karma is a different row and a different question');
});

test('a malformed day is refused rather than quietly matching nothing', async () => {
  await assert.rejects(() => karmaMeasuredOn(getPool(), '3 Nov'), /not a UTC day/);
  await assert.rejects(() => karmaMeasuredOn(getPool(), '2026-11-03T00:00:00Z'), /not a UTC day/);
});
