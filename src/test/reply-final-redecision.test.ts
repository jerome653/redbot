/**
 * The unattended decisions inside reply(), run rather than read (#30 item 7).
 *
 * src/test/autopublish.test.ts pins the TEXT of the final re-decision block in reply.ts, so a block
 * that never runs (wrapped in `if (Date.now() < 0)`, or commented out) still passes it. These tests
 * run reply() itself, from the draft to the submit. The page, the gates, the account's health, the
 * read and the submit are module mocks (`--experimental-test-module-mocks`, set in package.json
 * "test"), so nothing reaches Reddit. The database, the drafts, the history and both decisions are
 * the real ones.
 */
import { test, after, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Draft, Thread } from '../types.js';
import type { GateResult, GateBlock } from '../gates.js';

if (typeof mock.module !== 'function') {
  throw new Error('module mocks are off: run node with --experimental-test-module-mocks, as package.json "test" does');
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'redbot-reply-final-'));
process.env.REDBOT_DB = join(dir, 'redbot.db');
process.env.REDBOT_DATA = dir;
process.env.REDBOT_CDP = 'http://127.0.0.1:1';
process.env.REDBOT_AUTO_PUBLISH = '1';
process.env.REDBOT_PUBLISH_MIN_VERDICT = 'REDDIT';
delete process.env.REDBOT_ACCOUNT;
const migrated = spawnSync(process.execPath, [join(ROOT, 'db', 'sqlite', 'migrate.mjs'), 'up'], { encoding: 'utf8' });
if (migrated.status !== 0) throw new Error(`migrate up failed:\n${migrated.stdout}\n${migrated.stderr}`);

/* What each mocked read answers, per test. Index 0 is the first read, index 1 the re-read at the
   final check (step 6). */
const script: { gates: GateResult[]; karma: number[] } = { gates: [], karma: [] };
const calls = { gates: 0, health: 0, view: 0, publish: 0 };
beforeEach(() => { Object.assign(calls, { gates: 0, health: 0, view: 0, publish: 0 }); });

const gates = (advisories: GateBlock[] = []): GateResult => ({
  allow: true, blocks: [], advisories, warnings: [],
  quality: {
    ok: true, issues: [], humanChecklist: [],
    metrics: { words: 40, sentences: 3, specificityHits: 1, technicalHits: 1, hedges: 0 }
  } as unknown as GateResult['quality']
});

const mod = (p: string) => new URL(p, import.meta.url).href;
const page = { goto: async () => null };
mock.module(mod('../browser.js'), {
  namedExports: {
    ...(await import('../browser.js')),
    isBrowserUp: async () => true,
    attach: async () => ({ page, close: async () => undefined }),
    isRateLimited: async () => false,
    isBlocked: async () => false,
    whoAmI: async () => ({ loggedIn: true, username: 'stub_account', via: 'mock' })
  }
});
mock.module(mod('../gates.js'), {
  namedExports: { ...(await import('../gates.js')), evaluateGates: () => script.gates[Math.min(calls.gates++, 1)] }
});
mock.module(mod('../health.js'), {
  namedExports: {
    ...(await import('../health.js')),
    health: async () => ({
      state: 'Healthy', mayPublish: true, reasons: [], resumeAt: null,
      counters: { karma: script.karma[Math.min(calls.health++, 1)] }
    })
  }
});
mock.module(mod('../reddit/thread-state.js'), {
  namedExports: {
    ...(await import('../reddit/thread-state.js')),
    probeThreadState: async () => ({
      locked: false, archived: false, ownCommentPresent: false, composerPresent: true,
      unknown: [], anomalies: [], postScore: 1, commentCount: 0
    })
  }
});
mock.module(mod('../behavior.js'), {
  namedExports: {
    ...(await import('../behavior.js')),
    viewThread: async () => { calls.view++; return { dwellMs: 0, steps: 0, truncated: false }; }
  }
});
mock.module(mod('../reddit/post.js'), {
  namedExports: {
    ...(await import('../reddit/post.js')),
    publishComment: async () => {
      calls.publish++;
      return { ok: true, url: 'https://example.invalid/c/1', commentPermalink: 'https://example.invalid/c/1', commentId: 't1_stub' };
    }
  }
});
mock.module(mod('../backup.js'), {
  namedExports: { ...(await import('../backup.js')), autoBackup: () => ({ ok: true, detail: 'mocked' }) }
});

const { reply } = await import('../commands/reply.js');
const { saveDraft, saveThreads, loadDrafts, loadHistory } = await import('../store.js');
const { insertCertification } = await import('../db/certifications.js');
const { upsertAccounts } = await import('../db/accounts.js');
const { getPool, closePool } = await import('../db.js');
await upsertAccounts(getPool(), [{ handle: 'stub_account', role: 'support', subreddits: ['wordpress'], dailyCeiling: 2 }], 'test-machine');

/* Close the database first: on Windows an open file keeps rmSync from removing the folder (#30). */
after(async () => {
  await closePool();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

const TS = '2026-10-18T01:00:00.000Z';

/** A CERTIFIED draft on r/Wordpress, with the certification row the REDDIT bar reads. */
async function seed(id: string, threadId: string): Promise<void> {
  const permalink = `https://www.reddit.com/r/Wordpress/comments/${threadId}/t/`;
  const t: Thread = {
    id: threadId, permalink, title: 'a thread', subreddit: 'Wordpress', author: 'op', upvotes: 1, commentCount: 0,
    ageText: '1 hr. ago', ageMinutes: 60, body: 'A question.', comments: [], collectedAt: TS, source: 'read'
  };
  await saveThreads([t]);
  const d: Draft = {
    id, threadId, permalink, title: t.title,
    body: 'A reply.', hasDisclosure: false, lintIssues: [], createdAt: TS, model: 'stub-model',
    account: 'stub_account', status: 'pending',
    certification: { verdict: 'CERTIFIED', at: TS, claims: 0, fatalContradictions: 0 }
  };
  await saveDraft(d);
  await insertCertification({
    draftId: id, threadId, verdict: 'CERTIFIED', certifiedAt: TS, model: 'stub',
    reasons: [], claims: [], contradictions: [], epistemic: [], invalidated: [],
    resolution: { resolved: false, detail: 'open', signals: [] }
  });
}

/** reply(), unattended, with its output kept off the test log. */
async function run(id: string): Promise<number> {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => undefined;
  try { return await reply(id, { unattended: true }); } finally { Object.assign(console, saved); }
}

const rows = async (id: string, kind: string) =>
  (await loadHistory()).filter((h) => h.kind === kind && h.data?.draftId === id);
const status = async (id: string) => (await loadDrafts()).find((d) => d.id === id)?.status;

test('control: nothing changed by the final check, so the reply is submitted once', async () => {
  await seed('d_rfr_clean', 'c30000000001');
  script.gates = [gates(), gates()];
  script.karma = [50, 50];
  assert.equal(await run('d_rfr_clean'), 0);
  assert.deepEqual(calls, { gates: 2, health: 2, view: 1, publish: 1 });
  assert.equal(await status('d_rfr_clean'), 'published');
  assert.equal((await rows('d_rfr_clean', 'publish.refused')).length, 0);
  assert.equal((await rows('d_rfr_clean', 'publish.ok')).length, 1);
});

test('an advisory that appears during the read refuses at the final check, and nothing is submitted', async () => {
  await seed('d_rfr_locked', 'c30000000002');
  script.gates = [gates(), gates([{ gate: 'locked', reason: 'thread is locked' }])];
  script.karma = [50, 50];
  assert.equal(await run('d_rfr_locked'), 1);
  /* It passed the first decision and read the thread: the refusal is the final check's. */
  assert.deepEqual(calls, { gates: 2, health: 2, view: 1, publish: 0 });
  const refused = await rows('d_rfr_locked', 'publish.refused');
  assert.equal(refused.length, 1);
  assert.equal(refused[0]!.data?.stage, 'final');
  assert.equal(refused[0]!.data?.why, '1 advisory finding(s) nobody can overrule unattended: locked');
  assert.equal(await status('d_rfr_locked'), 'pending');
  assert.equal((await rows('d_rfr_locked', 'approve')).length, 0);
});

test('karma re-read below the floor at the final check refuses, and nothing is submitted', async () => {
  await seed('d_rfr_karma', 'c30000000003');
  script.gates = [gates(), gates()];
  script.karma = [50, 1];
  assert.equal(await run('d_rfr_karma'), 1);
  assert.deepEqual(calls, { gates: 2, health: 2, view: 1, publish: 0 });
  const refused = await rows('d_rfr_karma', 'publish.refused');
  assert.equal(refused.length, 1);
  assert.equal(refused[0]!.data?.stage, 'final');
  assert.equal(refused[0]!.data?.why, 'REDDIT bar: r/wordpress waits for karma 10 before posting unattended; the posting account has 1');
  assert.equal(await status('d_rfr_karma'), 'pending');
});

test('a hard gate that fails at the final check refuses before the re-decision, and nothing is submitted', async () => {
  await seed('d_rfr_hard', 'c30000000005');
  const hard: GateResult = { ...gates(), allow: false, blocks: [{ gate: 'identity', reason: 'signed in as someone else' }] };
  script.gates = [gates(), hard];
  script.karma = [50, 50];
  assert.equal(await run('d_rfr_hard'), 1);
  assert.deepEqual(calls, { gates: 2, health: 2, view: 1, publish: 0 });
  const blocked = await rows('d_rfr_hard', 'gate.block');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0]!.data?.stage, 'final');
  assert.deepEqual(blocked[0]!.data?.gates, ['identity']);
  assert.equal((await rows('d_rfr_hard', 'publish.refused')).length, 0);
  assert.equal(await status('d_rfr_hard'), 'pending');
});

test('the first decision refuses before the read, and the final check is never reached', async () => {
  await seed('d_rfr_first', 'c30000000004');
  script.gates = [gates(), gates()];
  script.karma = [1, 50];
  assert.equal(await run('d_rfr_first'), 1);
  assert.deepEqual(calls, { gates: 1, health: 1, view: 0, publish: 0 });
  const refused = await rows('d_rfr_first', 'publish.refused');
  assert.equal(refused.length, 1);
  assert.equal(refused[0]!.data?.stage, 'unattended');
  /* Not the certification-only check before the page (which marks itself `before: 'page'`). */
  assert.equal(refused[0]!.data?.before, undefined);
  assert.equal(refused[0]!.data?.why, 'REDDIT bar: r/wordpress waits for karma 10 before posting unattended; the posting account has 1');
  assert.equal(await status('d_rfr_first'), 'pending');
});
