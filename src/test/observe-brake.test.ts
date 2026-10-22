/**
 * A removal recorded this turn stops this turn's publish — traced through the real health path.
 *
 * observe-due.test.ts stubs every seam. This file does not: a real (temporary) database, the real
 * recordObservation -> counters -> assess chain, and reply() itself with REDBOT_CDP pointed at a
 * closed port, so a run that gets as far as the browser says so instead of reaching Reddit.
 *
 * Two places stop a publish after a removal:
 *   1. the cycle's observe step reads health AFTER observing and ends the turn (removalBrake);
 *   2. an unattended reply() reads the draft account's health BEFORE the page opens — the same
 *      verdict the gates read after the page, asked early so a braked account does not open and
 *      dwell on a thread it may not answer.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Draft, Thread } from '../types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'redbot-observe-brake-'));
process.env.REDBOT_DB = join(dir, 'redbot.db');
process.env.REDBOT_DATA = dir;
process.env.REDBOT_CDP = 'http://127.0.0.1:1';
process.env.REDBOT_AUTO_PUBLISH = '1';
process.env.REDBOT_PUBLISH_MIN_VERDICT = 'REDDIT';
delete process.env.REDBOT_ACCOUNT;
const migrated = spawnSync(process.execPath, [join(ROOT, 'db', 'sqlite', 'migrate.mjs'), 'up'], { encoding: 'utf8' });
if (migrated.status !== 0) throw new Error(`migrate up failed:\n${migrated.stdout}\n${migrated.stderr}`);

const { reply } = await import('../commands/reply.js');
const { observeStep } = await import('../commands/auto.js');
const { health, recordObservation } = await import('../health.js');
const { saveDraft, saveThreads, loadHistory } = await import('../store.js');
const { insertCertification } = await import('../db/certifications.js');
const { upsertAccounts } = await import('../db/accounts.js');
const { getPool } = await import('../db.js');
await upsertAccounts(getPool(), [{ handle: 'stub_account', role: 'support', subreddits: ['wordpress'], dailyCeiling: 2 }], 'test-machine');

after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

const TS = '2026-10-18T01:00:00.000Z';
const NO_BROWSER = 'No debuggable Chrome';
const URL_ = 'https://www.reddit.com/r/Wordpress/comments/b40000000009/t/comment/cx1/';

/** A REJECT with soft rules only: it passes the early certification check (see reply-refuse-before-page). */
async function seed(id: string, threadId: string): Promise<void> {
  const permalink = `https://www.reddit.com/r/Wordpress/comments/${threadId}/t/`;
  const t: Thread = {
    id: threadId, permalink, title: 'a thread', subreddit: 'Wordpress', author: 'op', upvotes: 1, commentCount: 0,
    ageText: '1 hr. ago', ageMinutes: 60, body: 'A question.', comments: [], collectedAt: TS, source: 'read'
  };
  await saveThreads([t]);
  const d: Draft = {
    id, threadId: t.id, permalink, title: t.title,
    body: 'A reply.', hasDisclosure: false, lintIssues: [], createdAt: TS, model: 'stub-model',
    account: 'stub_account', status: 'pending',
    certification: { verdict: 'REJECT', at: TS, claims: 0, fatalContradictions: 0 }
  };
  await saveDraft(d);
  await insertCertification({
    draftId: id, threadId: d.threadId, verdict: 'REJECT', certifiedAt: TS, model: 'stub',
    reasons: ['overconfident-language', 'no-provenance'].map((rule) => ({ rule, detail: rule })),
    claims: [], contradictions: [], epistemic: [], invalidated: [],
    resolution: { resolved: false, detail: 'open', signals: [] }
  });
}

async function run(id: string): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try { return { code: await reply(id, { unattended: true }), out: lines.join('\n') }; } finally { Object.assign(console, saved); }
}

const refusedRows = async (id: string) =>
  (await loadHistory()).filter((h) => h.kind === 'publish.refused' && h.data?.draftId === id);

/* Order matters: the control runs before any removal is on record. */

test('control: with no removal on record, an unattended reply goes on to the browser', async () => {
  await seed('d_obr_before', 'b40000000001');
  const { code, out } = await run('d_obr_before');
  assert.equal(code, 1);
  assert.ok(out.includes(NO_BROWSER), `refused early with nothing on record:\n${out}`);
  assert.equal((await refusedRows('d_obr_before')).length, 0);
  assert.equal((await health('stub_account')).mayPublish, true);
});

test('a removal recorded during this turn\'s observe stops the turn, read through the real health verdict', async () => {
  const r = await observeStep('stub_account', {
    browserUp: async () => true,
    /* What observe() writes when Reddit shows the stub — src/commands/observe.ts, signed-out vector. */
    observeDue: async () => {
      await recordObservation({
        account: 'stub_account', kind: 'reply-marked-removed', vector: 'signed-out',
        permalink: URL_, checkpoint: '1h', value: 'Comment removed by moderator'
      });
      return { due: 1, observed: 1, stopped: null };
    },
    verdict: (h) => health(h),
    rec: async () => undefined,
    now: () => new Date()
  });
  assert.equal(r.stop, true);
  assert.match(r.why, /removal/);
});

test('and the same turn\'s unattended publish is refused on health before the page opens', async () => {
  await seed('d_obr_after', 'b40000000002');
  const { code, out } = await run('d_obr_after');
  assert.equal(code, 1);
  assert.ok(!out.includes(NO_BROWSER), `the run reached the browser check:\n${out}`);
  assert.match(out, /Not publishing unattended: account health is Cooldown/);
  const rows = await refusedRows('d_obr_after');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.data?.stage, 'unattended');
  assert.equal(rows[0]!.data?.before, 'page');
  assert.equal(rows[0]!.data?.gate, 'health');
  assert.equal(rows[0]!.account, 'stub_account');
});
