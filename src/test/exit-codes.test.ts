/**
 * "There was nothing to do" is not "it failed", and every command must say so with the same number.
 *
 * On 2026-08-14 an operator pressed Collect and was shown a red failure reading "No threads
 * collected." Nothing had broken: `opportunity` had exited NOTHING_TO_DO, the console judged runs
 * by "exited zero", and a collect that had worked was reported as a failure. That was fixed at the
 * console — and the audit that followed found the same shape in a dozen more commands, three of
 * them behind console buttons: `draft` with nothing assessed, `certify` with nothing pending,
 * `select` with nothing ranked. Each returned 1, the code that means the command could not do its
 * job, for the state where the job simply was not there to do.
 *
 * A command that names something you asked for and cannot find still FAILS — `certify <id>` on an
 * id that does not exist is an error, and the tests below pin that difference, because collapsing
 * it would be the opposite defect.
 *
 * These call the commands directly against an empty install. Every case here is an early return
 * that happens before any browser, model or network call.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-exitcodes-'));

const { NOTHING_TO_DO, FAILED } = await import('../exit-codes.js');
const { getPool, closePool } = await import('../db.js');
const { draft } = await import('../commands/draft.js');
const { certifyCmd } = await import('../commands/certify.js');
const { reply } = await import('../commands/reply.js');
const { regret } = await import('../commands/regret.js');
const { selectCmd } = await import('../commands/status.js');
const { opportunity } = await import('../commands/opportunity.js');

/** An install with nothing in it — the state every case below is about. */
async function emptyEverything(): Promise<void> {
  const db = getPool();
  for (const t of ['drafts', 'opportunity_assessments', 'gaps', 'threads']) {
    await db.query(`DELETE FROM ${t}`);
  }
}

before(emptyEverything);
after(async () => { await closePool(); });

test('the codes are distinct, and nothing-to-do is not failure', () => {
  assert.notEqual(NOTHING_TO_DO, FAILED);
  assert.notEqual(NOTHING_TO_DO, 0, 'it must stay non-zero — nothing downstream ran');
});

test('nothing to score is nothing to do', async () => {
  assert.equal(await opportunity(), NOTHING_TO_DO);
});

test('nothing assessed is nothing to draft, and nothing to rank', async () => {
  assert.equal(await draft(), NOTHING_TO_DO, '`redbot draft` with no assessments is not a failure');
  assert.equal(await selectCmd(), NOTHING_TO_DO, '`redbot select` with nothing ranked is not a failure');
});

test('nothing pending is nothing to certify, and nothing to reply to', async () => {
  assert.equal(await certifyCmd(), NOTHING_TO_DO);
  assert.equal(await reply(), NOTHING_TO_DO);
});

test('nothing published is nothing to regret', async () => {
  assert.equal(await regret(), NOTHING_TO_DO);
});

/**
 * The other half, and the reason this is not a blanket replacement: asking for something by name
 * and not finding it IS a failure. If these ever return NOTHING_TO_DO, a typo in an id becomes a
 * silent no-op that reads as "there was nothing to do" — which is how you conclude the corpus is
 * empty when in fact you misspelled one draft.
 */
test('naming something that does not exist still fails', async () => {
  assert.equal(await certifyCmd('d_no_such_draft'), FAILED);
  assert.equal(await reply('d_no_such_draft'), FAILED);
});

/**
 * `regret` is deliberately the exception, and the ordering is the reason.
 *
 * It asks "has anything been published at all?" BEFORE it looks for the id you named — so on an
 * install that has never published, `regret <anything>` answers "nothing has been published",
 * which is both true and more useful than "no draft with that id". The named-lookup failure below
 * it is reachable only once something HAS been published, which is the only state where naming a
 * missing one is a mistake rather than a category error.
 */
test('regret answers the bigger truth first: nothing published at all', async () => {
  assert.equal(await regret('d_no_such_draft'), NOTHING_TO_DO);
});
