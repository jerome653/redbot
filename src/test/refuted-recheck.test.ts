/**
 * Fix-and-recheck inside the unattended cycle, end to end on a real (temporary) database, with the
 * model stubbed out: certify is a function that writes a certification row, reply records the id
 * it was handed. Nothing here can reach a model or a browser.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Certification, Claim, VerdictReason } from '../argus/types.js';
import type { Draft, Thread } from '../types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'redbot-refuted-recheck-'));
process.env.REDBOT_DB = join(dir, 'redbot.db');
process.env.REDBOT_DATA = dir;
delete process.env.REDBOT_ACCOUNT;
delete process.env.REDBOT_STRIP_REFUTED;
const migrated = spawnSync(process.execPath, [join(ROOT, 'db', 'sqlite', 'migrate.mjs'), 'up'], { encoding: 'utf8' });
if (migrated.status !== 0) throw new Error(`migrate up failed:\n${migrated.stdout}\n${migrated.stderr}`);

const { factCheckThenPublish } = await import('../commands/auto.js');
const { saveDraft, saveThreads, loadDrafts, loadHistory } = await import('../store.js');
const { insertCertification } = await import('../db/certifications.js');
const { draftTimeBlocks } = await import('../draft-gate.js');
const { upsertAccounts } = await import('../db/accounts.js');
const { getPool, closePool } = await import('../db.js');
await upsertAccounts(getPool(), [{ handle: 'stub_account', role: 'support', subreddits: ['mysql'], dailyCeiling: 2 }], 'test-machine');

/* Close the database first: on Windows an open file keeps rmSync from removing the folder (#30). */
after(async () => {
  await closePool();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

const S1 = 'Your import stops because one BLOB row is larger than max_allowed_packet on the server.';
const S2 = 'MySQL truncates an oversized row silently and keeps going.';
const S3 = 'Raise max_allowed_packet to 256M in the mysqld section of my.cnf and restart the service.';
const S4 = 'After that the import will finish in a few minutes.';
const S5 = 'If it still stops, your mysqldump file has a table whose BLOB column is bigger than 256M.';
const BODY = [S1, S2, S3, S4, S5].join(' ');

function thread(id: string): Thread {
  return {
    id, permalink: `https://www.reddit.com/r/mysql/comments/${id}/import_fails/`,
    title: 'mysqldump import fails on large BLOB rows, max_allowed_packet error', subreddit: 'mysql',
    author: 'op', upvotes: 2, commentCount: 0, ageText: '1 hr. ago', ageMinutes: 60,
    body: 'Importing a mysqldump file stops on a table with BLOB rows. The error mentions max_allowed_packet.',
    comments: [], collectedAt: new Date().toISOString(), source: 'read'
  };
}

function original(threadId: string): Draft {
  return {
    id: `d_${threadId}_orig`, threadId, permalink: thread(threadId).permalink, title: thread(threadId).title,
    body: BODY, hasDisclosure: false, lintIssues: [], createdAt: '2026-10-18T00:00:00.000Z',
    model: 'stub-model', account: 'stub_account', status: 'pending'
  };
}

const claim = (id: string, sourceQuote: string, dependsOn: string[] = []): Claim => ({
  id, text: sourceQuote, type: 'implementation-detail', evidenceClass: 'reasoned-inference',
  evidenceDetail: '', confidence: 'medium', dependsOn, sourceQuote
});

/** A stub certify: writes the verdict `plan` chooses for this draft, exactly as certifyCmd persists one. */
function stubCertify(plan: (d: Draft) => { reasons: VerdictReason[]; claims: Claim[]; invalidated?: Certification['invalidated'] }) {
  const calls: string[] = [];
  const certify = async (id: string): Promise<number> => {
    calls.push(id);
    const d = (await loadDrafts()).find((x) => x.id === id)!;
    const p = plan(d);
    const verdict = p.reasons.some((r) => r.rule === 'all-claims-supported') ? 'CERTIFIED' : 'REJECT';
    const fatal = p.reasons.filter((r) => r.rule === 'fatal-contradiction');
    await insertCertification({
      draftId: id, threadId: d.threadId, verdict, reasons: p.reasons, claims: p.claims,
      contradictions: fatal.map((r) => ({ claimId: r.claimId!, kind: 'counterexample', statement: 'no', evidenceClass: 'primary-documentation', evidenceDetail: '', fatal: true })),
      epistemic: [], invalidated: p.invalidated ?? [], resolution: { resolved: false, signals: [], detail: 'open' },
      certifiedAt: new Date().toISOString(), model: 'stub'
    });
    d.certification = { verdict, at: new Date().toISOString(), claims: p.claims.length, fatalContradictions: fatal.length };
    await saveDraft(d);
    return verdict === 'REJECT' ? 1 : 0;
  };
  return { calls, certify };
}

const CERTIFIED = { reasons: [{ rule: 'all-claims-supported', detail: '' }], claims: [claim('c1', 'one BLOB row')] };
/** S2 proven false; S4 rests on it. */
const REFUTED = {
  reasons: [{ rule: 'fatal-contradiction', claimId: 'c2', detail: '' }, { rule: 'invalidated-dependency', claimId: 'c4', detail: '' }],
  claims: [claim('c1', 'one BLOB row is larger than max_allowed_packet'), claim('c2', 'truncates an oversized row silently'),
    claim('c4', 'the import will finish in a few minutes', ['c2'])],
  invalidated: [{ claimId: 'c4', becauseOf: 'c2' }]
};

function stubReply() {
  const got: string[] = [];
  return { got, reply: async (id: string) => { got.push(id); return 0; } };
}

describe('the cycle, after a REJECT that a deletion can fix', () => {
  test('the fixture itself passes every draft-time check, so a refusal below would be the strip’s own', () => {
    assert.deepEqual(draftTimeBlocks({ body: [S1, S3, S5].join(' '), thread: thread('a000000000ff'), warming: true }), []);
  });

  test('one strip, one re-certification, the old draft rejected, and reply gets the NEW id', async () => {
    await saveThreads([thread('a00000000001')]);
    await saveDraft(original('a00000000001'));
    const { calls, certify } = stubCertify((d) => (d.id.endsWith('_orig') ? REFUTED : CERTIFIED));
    const { got, reply } = stubReply();

    await factCheckThenPublish('d_a00000000001_orig', { certify, reply, publish: () => true });

    const drafts = (await loadDrafts()).filter((d) => d.threadId === 'a00000000001');
    const fresh = drafts.find((d) => d.id !== 'd_a00000000001_orig');
    assert.ok(fresh, 'a new draft row exists');
    assert.deepEqual(calls, ['d_a00000000001_orig', fresh.id], 'certified twice in all: the original, then the new draft ONCE');
    assert.deepEqual(got, [fresh.id], 'reply is handed the new id, not the original');
    assert.equal(drafts.find((d) => d.id === 'd_a00000000001_orig')!.status, 'rejected');
    assert.equal(fresh.body, [S1, S3, S5].join(' '));
    assert.equal(fresh.status, 'pending');
    assert.equal(fresh.certification?.verdict, 'CERTIFIED');
    assert.deepEqual([fresh.threadId, fresh.permalink, fresh.account], ['a00000000001', thread('a00000000001').permalink, 'stub_account']);

    const link = (await loadHistory()).find((h) => h.kind === 'draft.rewrite' && h.data?.to === fresh.id);
    assert.deepEqual(link?.data, {
      stage: 'refuted', from: 'd_a00000000001_orig', to: fresh.id, removed: 2,
      quotes: ['truncates an oversized row silently', 'the import will finish in a few minutes']
    });
  });

  test('a draft produced by a strip is never stripped again, even when its own REJECT would allow it', async () => {
    const stripped = (await loadDrafts()).find((d) => d.threadId === 'a00000000001' && d.status === 'pending')!;
    const before = (await loadDrafts()).length;
    const { calls, certify } = stubCertify(() => ({
      reasons: [{ rule: 'fatal-contradiction', claimId: 'c5', detail: '' }],
      claims: [claim('c5', 'whose BLOB column is bigger than 256M')]
    }));
    const { got, reply } = stubReply();

    await factCheckThenPublish(stripped.id, { certify, reply, publish: () => true });

    assert.deepEqual(calls, [stripped.id], 'certified once, never a second time');
    assert.deepEqual(got, [stripped.id]);
    assert.equal((await loadDrafts()).length, before, 'no new draft');
    const refusal = (await loadHistory()).find((h) => h.kind === 'draft.rewrite' && h.data?.from === stripped.id);
    assert.match(String(refusal?.data?.refused), /already the product of a strip/);
  });

  test('the original, once rejected by a strip, is never stripped a second time', async () => {
    const before = (await loadDrafts()).length;
    const { calls, certify } = stubCertify(() => REFUTED);
    const { got, reply } = stubReply();

    await factCheckThenPublish('d_a00000000001_orig', { certify, reply, publish: () => true });

    assert.deepEqual(calls, ['d_a00000000001_orig']);
    assert.deepEqual(got, ['d_a00000000001_orig'], 'reply is left to refuse a draft that is no longer pending');
    assert.equal((await loadDrafts()).length, before, 'no second shorter draft');
    const refusals = (await loadHistory()).filter((h) => h.kind === 'draft.rewrite' && h.data?.from === 'd_a00000000001_orig' && h.data?.refused);
    assert.match(String(refusals.at(-1)?.data?.refused), /already rejected/);
  });

  test('a REJECT carrying a rule a deletion cannot answer keeps the original and records why', async () => {
    await saveThreads([thread('a00000000003')]);
    await saveDraft(original('a00000000003'));
    const { calls, certify } = stubCertify(() => ({
      ...REFUTED, reasons: [...REFUTED.reasons, { rule: 'contested-contradiction', claimId: 'c1', detail: '' }]
    }));
    const { got, reply } = stubReply();

    await factCheckThenPublish('d_a00000000003_orig', { certify, reply, publish: () => true });

    assert.deepEqual(calls, ['d_a00000000003_orig']);
    assert.deepEqual(got, ['d_a00000000003_orig']);
    assert.equal((await loadDrafts()).find((d) => d.id === 'd_a00000000003_orig')!.status, 'pending');
    const refusal = (await loadHistory()).find((h) => h.kind === 'draft.rewrite' && h.data?.from === 'd_a00000000003_orig');
    assert.match(String(refusal?.data?.refused), /contested-contradiction/);
  });

  test('a shorter body that a fresh draft would be blocked for is refused, and the original kept', async () => {
    await saveThreads([thread('a00000000005')]);
    const short = 'Raise max_allowed_packet in my.cnf now. MySQL truncates an oversized row silently. ' +
      'Restart mysqld after the edit. Then rerun the mysqldump import.';
    await saveDraft({ ...original('a00000000005'), body: short });
    const { calls, certify } = stubCertify(() => ({
      reasons: [{ rule: 'fatal-contradiction', claimId: 'c2', detail: '' }], claims: [claim('c2', 'truncates an oversized row silently')]
    }));
    const { got, reply } = stubReply();

    await factCheckThenPublish('d_a00000000005_orig', { certify, reply, publish: () => true });

    assert.deepEqual(calls, ['d_a00000000005_orig']);
    assert.deepEqual(got, ['d_a00000000005_orig']);
    const refusal = (await loadHistory()).find((h) => h.kind === 'draft.rewrite' && h.data?.from === 'd_a00000000005_orig');
    assert.match(String(refusal?.data?.refused), /blocked by .*quality:too-short/);
  });

  test('REDBOT_STRIP_REFUTED=0: nothing changes — one certification, the original id to reply', async () => {
    await saveThreads([thread('a00000000002')]);
    await saveDraft(original('a00000000002'));
    const { calls, certify } = stubCertify(() => REFUTED);
    const { got, reply } = stubReply();
    process.env.REDBOT_STRIP_REFUTED = '0';
    try {
      await factCheckThenPublish('d_a00000000002_orig', { certify, reply, publish: () => true });
    } finally { delete process.env.REDBOT_STRIP_REFUTED; }

    assert.deepEqual(calls, ['d_a00000000002_orig']);
    assert.deepEqual(got, ['d_a00000000002_orig']);
    const drafts = (await loadDrafts()).filter((d) => d.threadId === 'a00000000002');
    assert.deepEqual(drafts.map((d) => [d.id, d.status]), [['d_a00000000002_orig', 'pending']]);
  });

  test('a CERTIFIED draft goes to reply as is: no new draft, and no strip record at all', async () => {
    await saveThreads([thread('a00000000006')]);
    await saveDraft(original('a00000000006'));
    const { calls, certify } = stubCertify(() => CERTIFIED);
    const { got, reply } = stubReply();

    await factCheckThenPublish('d_a00000000006_orig', { certify, reply, publish: () => true });

    assert.deepEqual(calls, ['d_a00000000006_orig']);
    assert.deepEqual(got, ['d_a00000000006_orig']);
    assert.equal((await loadDrafts()).filter((d) => d.threadId === 'a00000000006').length, 1);
    const rows = (await loadHistory()).filter((h) => h.kind === 'draft.rewrite' && h.data?.from === 'd_a00000000006_orig');
    assert.deepEqual(rows, [], 'nothing was refused, because there was nothing to strip');
  });

  test('when the link row cannot be written, nothing else is: no new draft, the original pending, no reply', async () => {
    await saveThreads([thread('a00000000007')]);
    await saveDraft(original('a00000000007'));
    const db = getPool();
    await db.query(`CREATE TRIGGER refuse_strip_link BEFORE INSERT ON history
      WHEN NEW.kind = 'draft.rewrite' AND json_extract(NEW.data, '$.to') IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'link row refused by the test'); END`);
    const { calls, certify } = stubCertify((d) => (d.id.endsWith('_orig') ? REFUTED : CERTIFIED));
    const { got, reply } = stubReply();
    try {
      await assert.rejects(factCheckThenPublish('d_a00000000007_orig', { certify, reply, publish: () => true }), /link row refused/);
    } finally { await db.query('DROP TRIGGER refuse_strip_link'); }

    const drafts = (await loadDrafts()).filter((d) => d.threadId === 'a00000000007');
    assert.deepEqual(drafts.map((d) => [d.id, d.status]), [['d_a00000000007_orig', 'pending']], 'the link is written before any draft');
    assert.deepEqual(calls, ['d_a00000000007_orig']);
    assert.deepEqual(got, []);
  });

  test('the production disclosure line is protected: a refuted quote inside it keeps the original', async () => {
    const { config } = await import('../config.js');
    await saveThreads([thread('a00000000008')]);
    await saveDraft({ ...original('a00000000008'), body: `${BODY}\n\n${config.aiDisclosureLine}` });
    const quote = config.aiDisclosureLine.split(' ').slice(-5).join(' ').replace(/\.$/, '');
    const { calls, certify } = stubCertify((d) => (d.id.endsWith('_orig')
      ? { reasons: [{ rule: 'fatal-contradiction', claimId: 'c9', detail: '' }], claims: [claim('c9', quote)] }
      : CERTIFIED));
    const { got, reply } = stubReply();

    await factCheckThenPublish('d_a00000000008_orig', { certify, reply, publish: () => true });

    assert.equal((await loadDrafts()).filter((d) => d.threadId === 'a00000000008').length, 1, 'no new draft');
    assert.deepEqual(calls, ['d_a00000000008_orig']);
    assert.deepEqual(got, ['d_a00000000008_orig']);
    const refusal = (await loadHistory()).find((h) => h.kind === 'draft.rewrite' && h.data?.from === 'd_a00000000008_orig');
    assert.match(String(refusal?.data?.refused), /disclosure/);
  });

  test('an error while preparing the strip keeps the original, records it, and reply gets the original id', async () => {
    await saveThreads([thread('a00000000009')]);
    await saveDraft(original('a00000000009'));
    const db = getPool();
    const { calls, certify: inner } = stubCertify(() => REFUTED);
    const certify = async (id: string) => {
      const n = await inner(id);
      await db.query('ALTER TABLE gap_analyses RENAME TO gap_analyses_away');
      return n;
    };
    const { got, reply } = stubReply();
    try {
      await factCheckThenPublish('d_a00000000009_orig', { certify, reply, publish: () => true });
    } finally { await db.query('ALTER TABLE gap_analyses_away RENAME TO gap_analyses'); }

    assert.deepEqual(calls, ['d_a00000000009_orig']);
    assert.deepEqual(got, ['d_a00000000009_orig']);
    assert.equal((await loadDrafts()).filter((d) => d.threadId === 'a00000000009').length, 1);
    const refusal = (await loadHistory()).find((h) => h.kind === 'draft.rewrite' && h.data?.from === 'd_a00000000009_orig');
    assert.match(String(refusal?.data?.refused), /gap_analyses/);
  });

  test('an install that does not publish unattended never strips', async () => {
    await saveThreads([thread('a00000000004')]);
    await saveDraft(original('a00000000004'));
    const { calls, certify } = stubCertify(() => REFUTED);
    const { got, reply } = stubReply();

    await factCheckThenPublish('d_a00000000004_orig', { certify, reply, publish: () => false });

    assert.deepEqual(calls, ['d_a00000000004_orig']);
    assert.deepEqual(got, []);
    assert.equal((await loadDrafts()).filter((d) => d.threadId === 'a00000000004').length, 1);
  });
});
