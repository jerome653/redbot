/**
 * `redbot probe-karma --open` — the daily timer measures whichever accounts' browsers are running.
 *
 * Every dependency is injected, so no browser, no Reddit and no database are touched. The cases
 * are the ones the unit's exit code has to get right: a closed browser is a skip, no open browser
 * at all is a failure, and one account's failure neither hides nor cancels the others.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountRecord } from '../config.js';

const { probeKarmaOpen } = await import('../probe-karma.js');

const acct = (handle: string, debugPort?: number): AccountRecord => ({ handle, debugPort });

function harness(accounts: AccountRecord[], up: number[], result: Record<string, number | Error> = {}) {
  const probed: string[] = [];
  const lines: string[] = [];
  const deps = {
    accounts: () => accounts,
    isUp: async (endpoint: string) => up.some((p) => endpoint === `http://127.0.0.1:${p}`),
    probe: async (endpoint: string) => {
      probed.push(endpoint);
      const r = result[endpoint];
      if (r instanceof Error) throw r;
      return r ?? 0;
    },
    log: (line: string) => { lines.push(line); }
  };
  return { deps, probed, lines };
}

test('measures only the accounts whose browser answers, and skips the rest without failing', async () => {
  const h = harness([acct('jordangrowth', 9227), acct('ryangrowth12', 9222), acct('noport')], [9227]);
  assert.equal(await probeKarmaOpen(h.deps), 0);
  assert.deepEqual(h.probed, ['http://127.0.0.1:9227']);
  assert.ok(h.lines.some((l) => l.startsWith('measuring 1 of 2: jordangrowth')), h.lines.join('\n'));
});

test('no browser running at all is a failure, and nothing is probed', async () => {
  const h = harness([acct('jordangrowth', 9227), acct('ryangrowth12', 9222)], []);
  assert.equal(await probeKarmaOpen(h.deps), 1);
  assert.deepEqual(h.probed, []);
  assert.ok(h.lines.some((l) => l.includes('nothing measured')), h.lines.join('\n'));
});

test('an account with no debug port is never probed, even when nothing else is configured', async () => {
  const h = harness([acct('noport'), acct('zero', 0)], [0]);
  assert.equal(await probeKarmaOpen(h.deps), 1);
  assert.deepEqual(h.probed, []);
});

test('one account failing fails the run but still measures the others', async () => {
  const h = harness([acct('a', 9223), acct('b', 9224), acct('c', 9225)], [9223, 9224, 9225],
    { 'http://127.0.0.1:9224': 1 });
  assert.equal(await probeKarmaOpen(h.deps), 1);
  assert.deepEqual(h.probed, ['http://127.0.0.1:9223', 'http://127.0.0.1:9224', 'http://127.0.0.1:9225']);
  assert.ok(h.lines.includes('not measured: b'), h.lines.join('\n'));
});

test('a probe that throws counts as not measured and does not abort the run', async () => {
  const h = harness([acct('a', 9223), acct('b', 9224)], [9223, 9224],
    { 'http://127.0.0.1:9223': new Error('No debuggable Chrome at http://127.0.0.1:9223') });
  assert.equal(await probeKarmaOpen(h.deps), 1);
  assert.deepEqual(h.probed, ['http://127.0.0.1:9223', 'http://127.0.0.1:9224']);
  assert.ok(h.lines.some((l) => l.includes('No debuggable Chrome')), h.lines.join('\n'));
  assert.ok(h.lines.includes('not measured: a'), h.lines.join('\n'));
});
