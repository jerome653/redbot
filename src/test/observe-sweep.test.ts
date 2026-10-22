/**
 * The unattended observe sweep against a scripted Chrome (observeDue in src/commands/observe.ts).
 *
 * Pins three things the first review of #58 found unguarded:
 *   1. one comment whose page will not load must not starve the others — each is tried;
 *   2. a page that rendered no comment at all is unreadable, not "absent": health.ts counts a
 *      signed-in absence as a removal, so recording it would stop a healthy account;
 *   3. a Chrome signed in as another account records nothing.
 */
import { test, mock, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Draft, Thread } from '../types.js';

if (typeof mock.module !== 'function') {
  throw new Error('module mocks are off: run node with --experimental-test-module-mocks, as package.json "test" does');
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'redbot-observe-sweep-'));
process.env.REDBOT_DB = join(dir, 'redbot.db');
process.env.REDBOT_DATA = dir;
process.env.REDBOT_CDP = 'http://127.0.0.1:1';
delete process.env.REDBOT_ACCOUNT;
const migrated = spawnSync(process.execPath, [join(ROOT, 'db', 'sqlite', 'migrate.mjs'), 'up'], { encoding: 'utf8' });
if (migrated.status !== 0) throw new Error(`migrate up failed:\n${migrated.stdout}\n${migrated.stderr}`);

/* What the scripted Chrome does, per test. */
const chrome = { signedInAs: 'sweep_account', failing: new Set<string>(), visited: [] as string[] };
beforeEach(() => { chrome.signedInAs = 'sweep_account'; chrome.failing = new Set(); chrome.visited = []; });

const page = {
  goto: async (url: string) => {
    chrome.visited.push(url);
    if ([...chrome.failing].some((f) => url.includes(f))) throw new Error('page.goto: Timeout 45000ms exceeded');
    return null;
  },
  waitForTimeout: async () => undefined,
  /* No comment node rendered: the page is blank as far as the sweep can tell. */
  locator: () => ({ count: async () => 0 }),
  evaluate: async () => { throw new Error('lookFor must not run on a page that rendered nothing'); }
};
const mod = (p: string) => new URL(p, import.meta.url).href;
mock.module(mod('../browser.js'), {
  namedExports: {
    ...(await import('../browser.js')),
    isBrowserUp: async () => true,
    /* newContext throws, so the signed-out half is UNAVAILABLE — this file is about the signed-in half. */
    attach: async () => ({ page, browser: { newContext: async () => { throw new Error('no incognito'); } }, close: async () => undefined }),
    isRateLimited: async () => false,
    isBlocked: async () => false,
    whoAmI: async () => ({ loggedIn: true, username: chrome.signedInAs, via: 'mock' })
  }
});

const { observeDue } = await import('../commands/observe.js');
const { saveDraft, saveThreads } = await import('../store.js');
const { loadObservations } = await import('../health.js');
const { upsertAccounts } = await import('../db/accounts.js');
const { getPool } = await import('../db.js');
await upsertAccounts(getPool(), [{ handle: 'sweep_account', role: 'support', subreddits: ['wordpress'], dailyCeiling: 2 }], 'test-machine');

after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

const NOW = new Date('2026-10-22T06:00:00.000Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

async function published(id: string, hoursAgo: number): Promise<void> {
  const permalink = `https://www.reddit.com/r/Wordpress/comments/${id}/t/`;
  const t: Thread = {
    id, permalink, title: 't', subreddit: 'Wordpress', author: 'op', upvotes: 1, commentCount: 1,
    ageText: '1 hr. ago', ageMinutes: 60, body: 'A question.', comments: [], collectedAt: ago(hoursAgo), source: 'read'
  };
  await saveThreads([t]);
  const d: Draft = {
    id, threadId: id, permalink, title: 't', body: 'A published reply.', hasDisclosure: false, lintIssues: [],
    createdAt: ago(hoursAgo), decidedAt: ago(hoursAgo), model: 'stub', account: 'sweep_account', status: 'published',
    commentPermalink: `${permalink}comment/c_${id}/`, publishedUrl: `${permalink}comment/c_${id}/`
  } as Draft;
  await saveDraft(d);
}

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => undefined;
  try { return await fn(); } finally { Object.assign(console, saved); }
}

await published('a5ee00000001', 1);
await published('a5ee00000002', 2);
await published('a5ee00000003', 3);

test('a comment whose page will not load does not starve the others: every due one is tried', async () => {
  chrome.failing = new Set(['a5ee00000001']);   // the newest — tried first
  const r = await quietly(() => observeDue({ account: 'sweep_account', now: NOW }));
  assert.equal(r.due, 3);
  assert.equal(r.stopped, null);
  for (const id of ['a5ee00000001', 'a5ee00000002', 'a5ee00000003']) {
    assert.ok(chrome.visited.some((u) => u.includes(id)), `${id} was never visited: ${chrome.visited.join(', ')}`);
  }
});

test('a page that rendered no comment records nothing — it is unreadable, not a removal', async () => {
  const r = await quietly(() => observeDue({ account: 'sweep_account', now: NOW }));
  assert.equal(r.observed, 0);
  const absent = (await loadObservations()).filter((o) => o.kind === 'reply-absent-signed-in');
  assert.equal(absent.length, 0, 'a blank page must never be filed as an absent (removed) comment');
});

test('a Chrome signed in as another account records nothing and says why', async () => {
  chrome.signedInAs = 'someone_else';
  const before = (await loadObservations()).length;
  const r = await quietly(() => observeDue({ account: 'sweep_account', now: NOW }));
  assert.equal(r.stopped, 'wrong-account');
  assert.equal(r.observed, 0);
  assert.equal((await loadObservations()).length, before);
});
