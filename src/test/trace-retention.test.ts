/**
 * The retention rule on `trace`, and the bound on reading it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. `tools/ops/simulate.mjs` SIM 2 measured this install's own record: 66
 * unattended cycles wrote 46,084 trace rows — 698 per cycle at 212 bytes/row — and nothing in the
 * codebase ever deleted one. At the 120-minute loop interval that is ~3.1 million rows and ~672 MB
 * inside a year, with no cliff anywhere in the curve, which is exactly why it was never noticed.
 *
 * SIM 3 found the other half: `loadTrace()` passed no limit, so `src/db/logs.ts` `tail()` returned
 * `ORDER BY id` with no LIMIT — a whole-table load, in `redbot doctor` and `redbot insights`, the
 * two commands somebody runs when the install is already misbehaving.
 *
 * The simulations project; these tests assert. Both are needed: a projection cannot prove a DELETE
 * keeps the right rows, and a unit test cannot prove a rate matters.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool } from '../db.js';
import { pruneTrace, insertTrace, selectTrace, countLog } from '../db/logs.js';
import { TRACE_READ_MAX } from '../trace.js';

const RUN = 'retention-test-run';

async function clear(): Promise<void> {
  await getPool().query('DELETE FROM trace');
}

async function seed(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await insertTrace(getPool(), {
      ts: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      runId: RUN, stage: 'system', event: `e${i}`, level: 'info'
    });
  }
}

test('pruning keeps the NEWEST rows and deletes the rest', async () => {
  await clear();
  await seed(50);

  const { deleted, kept } = await pruneTrace(getPool(), 10);
  assert.equal(deleted, 40);
  assert.equal(kept, 10);
  assert.equal(await countLog(getPool(), 'trace'), 10);

  /* WHICH ten, not just how many. `selectTrace` with no limit returns oldest-first, so the first
     surviving event must be the 41st written — the newest ten are e40..e49. */
  const rows = await selectTrace(getPool());
  assert.equal(rows.length, 10);
  assert.equal(rows[0]!.event, 'e40', 'the oldest survivor is wrong — the wrong end was deleted');
  assert.equal(rows[9]!.event, 'e49', 'the newest row did not survive, which is the one that matters');

  await clear();
  await closePool();
});

test('pruning below the cap deletes nothing, and is idempotent', async () => {
  await clear();
  await seed(5);

  assert.deepEqual(await pruneTrace(getPool(), 10), { deleted: 0, kept: 5 },
    'a table smaller than the cap must not be touched');
  assert.deepEqual(await pruneTrace(getPool(), 5), { deleted: 0, kept: 5 },
    'exactly at the cap is not over it');

  const first = await pruneTrace(getPool(), 3);
  assert.equal(first.deleted, 2);
  const second = await pruneTrace(getPool(), 3);
  assert.equal(second.deleted, 0, 'running it twice must not delete a second batch');

  await clear();
  await closePool();
});

test('an empty table prunes to nothing without erroring', async () => {
  await clear();
  assert.deepEqual(await pruneTrace(getPool(), 100), { deleted: 0, kept: 0 });
  await closePool();
});

test('a keep of zero or less is REFUSED, never read as "keep nothing"', async () => {
  await clear();
  await seed(5);

  /* The failure mode this closes: `REDBOT_TRACE_KEEP=` or a typo gives `Number('') === 0`, and a
     prune that treated 0 as a cap would empty the table on the next cycle. `tail()` two functions
     away in the same file DOES treat 0 as "no bound", so the opposite reading is live in this
     codebase and worth refusing explicitly rather than by convention. */
  for (const bad of [0, -1, NaN, Infinity, undefined as unknown as number, 'ten' as unknown as number]) {
    await assert.rejects(
      () => pruneTrace(getPool(), bad),
      /positive integer/,
      `keep=${JSON.stringify(bad)} must be refused, not treated as a cap`
    );
  }
  assert.equal(await countLog(getPool(), 'trace'), 5, 'a refused prune must delete nothing');

  await clear();
  await closePool();
});

test('a fractional keep is floored rather than rejected or silently widened', async () => {
  await clear();
  await seed(10);
  const { kept } = await pruneTrace(getPool(), 3.9);
  assert.equal(kept, 3);
  await clear();
  await closePool();
});

test('loadTrace is bounded, and the bound is below what a year of cycles produces', async () => {
  /* The number, asserted. SIM 3 projects ~3.1M rows at a year; a read that materialises all of
     them is the hazard, and TRACE_READ_MAX is what stops it. Asserted as an upper bound rather
     than an exact value so the constant can be tuned without breaking this. */
  assert.ok(TRACE_READ_MAX > 0, 'an unbounded read is the defect');
  assert.ok(TRACE_READ_MAX <= 100_000,
    `TRACE_READ_MAX is ${TRACE_READ_MAX}; above 100k a read is a hazard rather than a query`);
});

test('a bounded read returns the NEWEST window, oldest-first within it', async () => {
  await clear();
  await seed(20);

  const page = await selectTrace(getPool(), { limit: 5 });
  assert.equal(page.length, 5);
  assert.equal(page[0]!.event, 'e15', 'a window must come off the new end');
  assert.equal(page[4]!.event, 'e19');

  /* And the TOTAL is still available, which is what lets `doctor` and `insights` report the real
     figure rather than the size of the window they read. Before this the two were the same number
     and the wording said "total". */
  assert.equal(await countLog(getPool(), 'trace'), 20);

  await clear();
  await closePool();
});
