/**
 * The confirmation contract.
 *
 * These assertions exist because on 2026-07-27 three capabilities reported success for actions
 * that had not happened — a vote the server discarded, a post whose permalink was the subreddit
 * index, a follow that matched a hidden button. Each was individually plausible and each passed
 * a green suite. What they had in common is that they measured our own action rather than its
 * outcome.
 *
 * So the interesting tests here are the refusals: unconfirmed is not success, "could not tell"
 * is not success, and a failed confirmation is still written down.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-confirm-'));

const { act, recordConfirmation, UnconfirmedError } = await import('../confirm.js');
const { loadConfirmations } = await import('../confirm.js');

/**
 * Confirmations live in Postgres now, so this reads the table rather than the JSONL
 * file. Every assertion below is unchanged — what a confirmation records, and the
 * refusals, are the same properties; only where they are read from moved.
 */
const rows = async (): Promise<Array<Record<string, unknown>>> =>
  (await loadConfirmations()) as unknown as Array<Record<string, unknown>>;

test('a confirmed action returns its result and is recorded', async () => {
  const before = (await rows()).length;
  const { result, evidence } = await act({
    action: 'save',
    account: 'a',
    perform: async () => 'done',
    confirm: async () => ({
      confirmed: true, source: 'reloaded', observed: 'menu now offers "Remove from saved"'
    })
  });

  assert.equal(result, 'done');
  assert.equal(evidence.confirmed, true);
  const written = (await rows());
  assert.equal(written.length, before + 1);
  assert.equal(written.at(-1)!.action, 'save');
  assert.equal(written.at(-1)!.confirmed, true);
});

test('an unconfirmed action THROWS — it never reports success', async () => {
  await assert.rejects(
    act({
      action: 'vote:up',
      account: 'a',
      perform: async () => 'clicked',
      confirm: async () => ({
        confirmed: false,
        source: 'reloaded',
        observed: 'aria-pressed was false after a reload and the score was unmoved'
      })
    }),
    (e: unknown) => {
      assert.ok(e instanceof UnconfirmedError);
      assert.match((e as Error).message, /not confirmed/);
      assert.match((e as Error).message, /score was unmoved/);
      return true;
    }
  );
});

/**
 * The exact shape of the vote bug: the click succeeded, so `perform` resolved happily. Only the
 * confirmation stage knows the server threw the vote away.
 */
test('a successful perform with a failed confirm is a failure, and is still recorded', async () => {
  const before = (await rows()).length;
  await assert.rejects(act({
    action: 'vote:down',
    account: 'a',
    perform: async () => ({ clicked: true }),
    confirm: async () => ({ confirmed: false, source: 'reloaded', observed: 'gone after reload' })
  }));

  const written = (await rows());
  assert.equal(written.length, before + 1, 'a failed confirmation is evidence and must be kept');
  assert.equal(written.at(-1)!.confirmed, false);
  assert.equal(written.at(-1)!.observed, 'gone after reload');
});

test('an action that throws is recorded before the error propagates', async () => {
  const before = (await rows()).length;
  await assert.rejects(act({
    action: 'post',
    account: 'a',
    perform: async () => { throw new Error('composer never opened'); },
    confirm: async () => ({ confirmed: true, source: 'reloaded', observed: 'unreachable' })
  }), /composer never opened/);

  const written = (await rows());
  assert.equal(written.length, before + 1);
  assert.equal(written.at(-1)!.confirmed, false);
  assert.match(String(written.at(-1)!.error), /composer never opened/);
});

/**
 * Visibility is a separate question from confirmation, and the default matters.
 *
 * A comment can be present for its author and invisible to everyone else. Defaulting to
 * `unknown` means the log never claims public visibility that nobody checked — which is the
 * shadow-removal case ACCOUNT-WARMING.md warns about.
 */
test('visibility defaults to unknown, never to public', async () => {
  await act({
    action: 'post',
    account: 'a',
    perform: async () => 'ok',
    confirm: async () => ({ confirmed: true, source: 'second-page', observed: 'on the profile' })
  });
  assert.equal((await rows()).at(-1)!.visibility, 'unknown');

  await act({
    action: 'post',
    account: 'a',
    perform: async () => 'ok',
    confirm: async () => ({
      confirmed: true, source: 'third-party', observed: 'a second account can see it', visibility: 'public'
    })
  });
  assert.equal((await rows()).at(-1)!.visibility, 'public');
});

test('the evidence source is kept, so a weak confirmation is visible as weak', async () => {
  await act({
    action: 'follow',
    account: 'a',
    perform: async () => 'ok',
    // 'same-page' is the shape of the three bugs: read off the page we just acted on.
    confirm: async () => ({ confirmed: true, source: 'same-page', observed: 'button label flipped' })
  });
  assert.equal((await rows()).at(-1)!.source, 'same-page');
});

test('the log is append-only — a later confirmation never rewrites an earlier one', async () => {
  const before = (await rows()).length;
  await recordConfirmation({
    ts: new Date('2026-07-27T00:00:00Z').toISOString(),
    action: 'save', account: 'a', confirmed: true, source: 'reloaded',
    observed: 'first', ms: 1
  });
  await recordConfirmation({
    ts: new Date('2026-07-27T00:01:00Z').toISOString(),
    action: 'save', account: 'a', confirmed: false, source: 'reloaded',
    observed: 'second', ms: 1
  });
  const written = (await rows());
  assert.equal(written.length, before + 2);
  assert.equal(written.at(-2)!.observed, 'first');
  assert.equal(written.at(-1)!.observed, 'second');
});

process.on('exit', () => {
  try { rmSync(process.env.REDBOT_DATA!, { recursive: true, force: true }); } catch { /* ignore */ }
});
