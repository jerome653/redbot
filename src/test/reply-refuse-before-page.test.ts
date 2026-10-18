/**
 * An unattended reply that the certification will refuse is refused BEFORE the page opens.
 *
 * Measured on cardinal (WO-2026-10-18-9877, issue #33 item 2): all 20 `publish.refused` rows ever
 * written came straight after a full pre-reply read, 3,075 s of an account dwelling 60-360 s on a
 * thread it was never going to answer. 14 of them were certification refusals, and nothing those
 * read needs the page. A real (temporary) database, and REDBOT_CDP pointed at a closed port, so a
 * run that gets as far as the browser says so instead of reaching Reddit.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Draft, Thread } from '../types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'redbot-refuse-before-page-'));
process.env.REDBOT_DB = join(dir, 'redbot.db');
process.env.REDBOT_DATA = dir;
process.env.REDBOT_CDP = 'http://127.0.0.1:1';
process.env.REDBOT_AUTO_PUBLISH = '1';
process.env.REDBOT_PUBLISH_MIN_VERDICT = 'REDDIT';
delete process.env.REDBOT_ACCOUNT;
const migrated = spawnSync(process.execPath, [join(ROOT, 'db', 'sqlite', 'migrate.mjs'), 'up'], { encoding: 'utf8' });
if (migrated.status !== 0) throw new Error(`migrate up failed:\n${migrated.stdout}\n${migrated.stderr}`);

const { reply } = await import('../commands/reply.js');
const { saveDraft, saveThreads, loadHistory } = await import('../store.js');
const { insertCertification } = await import('../db/certifications.js');
const { upsertAccounts } = await import('../db/accounts.js');
const { getPool } = await import('../db.js');
await upsertAccounts(getPool(), [{ handle: 'stub_account', role: 'support', subreddits: ['wordpress'], dailyCeiling: 2 }], 'test-machine');

after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

const TS = '2026-10-18T01:00:00.000Z';
const NO_BROWSER = 'No debuggable Chrome';
/* Written out, not computed from src/autopublish.ts, so a reworded early copy cannot agree with itself. */
const FATAL_WHY = 'REDDIT bar: certification REJECT carries blocking rule(s): fatal-contradiction';

/** A REJECT draft on r/Wordpress, with its certification row carrying `rules`. */
async function seed(id: string, threadId: string, rules: string[]): Promise<void> {
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
    certification: { verdict: 'REJECT', at: TS, claims: 0, fatalContradictions: rules.filter((r) => r === 'fatal-contradiction').length }
  };
  await saveDraft(d);
  await insertCertification({
    draftId: id, threadId: d.threadId, verdict: 'REJECT', certifiedAt: TS, model: 'stub',
    reasons: rules.map((rule) => ({ rule, detail: rule })), claims: [], contradictions: [], epistemic: [], invalidated: [],
    resolution: { resolved: false, detail: 'open', signals: [] }
  });
}

/** reply(), with everything it printed. */
async function run(id: string, opts?: { unattended?: boolean }): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try { return { code: await reply(id, opts), out: lines.join('\n') }; } finally { Object.assign(console, saved); }
}

const refusedRows = async (id: string) =>
  (await loadHistory()).filter((h) => h.kind === 'publish.refused' && h.data?.draftId === id);

test('unattended: a REJECT carrying a blocking rule is refused before the browser is even asked', async () => {
  await seed('d_rbp_fatal', 'b30000000001', ['fatal-contradiction', 'fatal-contradiction']);
  const { code, out } = await run('d_rbp_fatal', { unattended: true });
  assert.equal(code, 1);
  assert.ok(!out.includes(NO_BROWSER), `the run reached the browser check:\n${out}`);
  assert.ok(out.includes(`Not publishing unattended: ${FATAL_WHY}`), out);
  const rows = await refusedRows('d_rbp_fatal');
  assert.equal(rows.length, 1, 'exactly one publish.refused row');
  assert.deepEqual(rows[0]!.data, { draftId: 'd_rbp_fatal', why: FATAL_WHY, stage: 'unattended', before: 'page' });
  assert.equal(rows[0]!.account, 'stub_account', 'stamped with the draft account, since nothing has signed in yet');
});

test('a person-driven reply of the same draft is never refused early: they may still overrule a REJECT', async () => {
  const before = (await refusedRows('d_rbp_fatal')).length;
  const { code, out } = await run('d_rbp_fatal');
  assert.equal(code, 1);
  assert.ok(out.includes(NO_BROWSER), `it must go on to the browser like any other reply:\n${out}`);
  assert.equal((await refusedRows('d_rbp_fatal')).length, before, 'no publish.refused row for a person-driven run');
});

test('unattended: soft rules only on r/Wordpress at unmeasured karma pass the early check', async () => {
  /* The karma floor is the decision's, after the page; the early check judges certification only. */
  await seed('d_rbp_soft', 'b30000000002', ['overconfident-language', 'no-provenance']);
  const { code, out } = await run('d_rbp_soft', { unattended: true });
  assert.equal(code, 1);
  assert.ok(out.includes(NO_BROWSER), `the early check refused what only the page-side decision may:\n${out}`);
  assert.equal((await refusedRows('d_rbp_soft')).length, 0);
});

test('reply.ts: the early check precedes the browser, and the certification row is read once', () => {
  const src = readFileSync(new URL('../../src/commands/reply.ts', import.meta.url), 'utf8');
  const early = src.indexOf('certificationOnlyRefusal(');
  assert.ok(early > 0 && early < src.indexOf('isBrowserUp('), 'certificationOnlyRefusal( must come before isBrowserUp(');
  assert.equal(src.split('latestCertification(').length - 1, 1, 'one read, reused by the decision after the page');
});
