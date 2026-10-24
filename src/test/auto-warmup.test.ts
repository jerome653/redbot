/**
 * Auto-warmup: the unattended loop grows karma by itself.
 *
 * Measured 2026-10-18 on cardinal: jordangrowth at karma 1, the only CERTIFIED draft in days refused
 * by the r/wordpress karma floor, publish count 0 — so karma could never grow. `redbot warmup` existed
 * and nothing called it. These tests pin the wiring: the cycle runs a warmup step while the account is
 * warming, never once it is warmed, never with REDBOT_AUTO_WARMUP=0, skips the karma-floor subreddits
 * for warmup targets, and hands the saved draft to the SAME publish path the contribution draft uses.
 *
 * No database rows: every seam is stubbed, so the shared test DB's DB-wide counts are untouched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Thread } from '../types.js';
import type { GateResult } from '../gates.js';
import { assessQuality } from '../quality.js';
import { warmupStep, autoWarmupEnabled, type WarmupStepDeps } from '../commands/auto.js';
import { warmingCandidates } from '../commands/warmup.js';
import { unattendedPublishDecision, certificationOnlyRefusal } from '../autopublish.js';
import { isWarmupDraftId } from '../warming.js';

/* ---- the step ----------------------------------------------------------------------------- */

function deps(over: Partial<WarmupStepDeps> = {}) {
  const calls = { warmup: 0, publish: [] as string[] };
  const d: WarmupStepDeps = {
    enabled: () => true,
    stage: async () => ({ warming: true, why: 'karma 1 is below 10' }),
    warmup: async () => { calls.warmup++; return { code: 0, draftId: 'w_t1_abc', reason: 'saved' }; },
    publish: async (id) => { calls.publish.push(id); },
    rec: async () => undefined,
    ...over
  };
  return { d, calls };
}

test('warming account: the step drafts a warmup and sends it down the publish path', async () => {
  const { d, calls } = deps();
  const out = await warmupStep(d);
  assert.equal(calls.warmup, 1);
  assert.deepEqual(calls.publish, ['w_t1_abc'], 'the saved draft id goes to factCheckThenPublish');
  assert.equal(out.draftId, 'w_t1_abc');
  assert.equal(out.ran, true);
});

test('warmed account: no warmup, nothing published', async () => {
  const { d, calls } = deps({ stage: async () => ({ warming: false, why: 'karma 40 and age 90d clear both' }) });
  const out = await warmupStep(d);
  assert.equal(calls.warmup, 0);
  assert.deepEqual(calls.publish, []);
  assert.equal(out.ran, false);
  assert.match(out.why, /clear/);
});

test('no account selected: no warmup', async () => {
  const { d, calls } = deps({ stage: async () => null });
  assert.equal((await warmupStep(d)).ran, false);
  assert.equal(calls.warmup, 0);
});

test('kill switch: REDBOT_AUTO_WARMUP=0 stops the step; default and any other value leave it ON', async () => {
  const saved = process.env.REDBOT_AUTO_WARMUP;
  try {
    delete process.env.REDBOT_AUTO_WARMUP;
    assert.equal(autoWarmupEnabled(), true, 'default ON');
    for (const v of ['1', '', 'yes']) { process.env.REDBOT_AUTO_WARMUP = v; assert.equal(autoWarmupEnabled(), true, v); }
    process.env.REDBOT_AUTO_WARMUP = '0';
    assert.equal(autoWarmupEnabled(), false);
  } finally {
    if (saved === undefined) delete process.env.REDBOT_AUTO_WARMUP; else process.env.REDBOT_AUTO_WARMUP = saved;
  }
  const { d, calls } = deps({ enabled: () => false });
  const out = await warmupStep(d);
  assert.equal(out.ran, false);
  assert.match(out.why, /REDBOT_AUTO_WARMUP/);
  assert.equal(calls.warmup, 0);
});

test('no draft saved (pace, no target, declined): nothing is published', async () => {
  const { d, calls } = deps({ warmup: async () => ({ code: 3, draftId: null, reason: 'pace holding' }) });
  const out = await warmupStep(d);
  assert.equal(out.ran, true);
  assert.equal(out.draftId, null);
  assert.deepEqual(calls.publish, []);
});

test('a warmup that throws does not fail the cycle', async () => {
  const { d, calls } = deps({ warmup: async () => { throw new Error('model down'); } });
  const out = await warmupStep(d);
  assert.equal(out.draftId, null);
  assert.match(out.why, /model down/);
  assert.deepEqual(calls.publish, []);
});

test('the cycle calls the warmup step, after the contribution draft, not instead of it', () => {
  const src = readFileSync(new URL('../../src/commands/auto.ts', import.meta.url), 'utf8');
  /* The cycle's drafting half moved into `work()` when the observe step was put in front of it. */
  const body = src.slice(src.indexOf('async function work('), src.indexOf('export interface FactCheckDeps'));
  const draftAt = body.indexOf('await draft()');
  const warmAt = body.indexOf('await warmupStep(');
  assert.ok(draftAt > 0, 'the contribution draft is still written');
  assert.ok(warmAt > draftAt, 'the warmup step runs in the cycle, after the contribution draft');
  const defaults = src.slice(src.indexOf('export async function warmupStep'));
  assert.match(defaults, /publish: \(id\) => factCheckThenPublish\(id\)/, 'the SAME publish path as the contribution draft');
});

/* ---- target selection: the karma floor ---------------------------------------------------- */

const NOW = Date.parse('2026-10-19T00:00:00.000Z');
const thread = (id: string, sub: string, ageMinutes = 60, commentCount = 1): Thread => ({
  id, permalink: `https://www.reddit.com/r/${sub}/comments/${id}/x/`, title: `t ${id}`, subreddit: sub,
  author: 'op', upvotes: 1, commentCount, ageText: null, ageMinutes, body: null, comments: [],
  collectedAt: new Date(NOW).toISOString(), source: 'read'
});

test('under the floor, r/wordpress (any casing) is skipped for warmup targets', () => {
  const ts = [thread('a', 'WordPress', 10), thread('b', 'wordpress', 20), thread('c', 'webdev', 90)];
  const picked = warmingCandidates(ts, new Set(), NOW, 1).map((r) => r.t.id);
  assert.deepEqual(picked, ['c']);
  assert.deepEqual(warmingCandidates(ts, new Set(), NOW, null).map((r) => r.t.id), ['c'], 'unmeasured karma is under the floor');
});

test('at or over the floor, r/wordpress is a target again; youngest first; drafted threads excluded', () => {
  const ts = [thread('a', 'WordPress', 30), thread('b', 'webdev', 10), thread('c', 'webdev', 5)];
  assert.deepEqual(warmingCandidates(ts, new Set(['c']), NOW, 10).map((r) => r.t.id), ['b', 'a']);
});

test('the warming window still applies: old or crowded threads are not targets', () => {
  const ts = [thread('old', 'webdev', 60 * 72), thread('crowd', 'webdev', 10, 500), thread('ok', 'webdev', 10)];
  assert.deepEqual(warmingCandidates(ts, new Set(), NOW, 1).map((r) => r.t.id), ['ok']);
});

/* ---- the publish decision for a warmup draft ---------------------------------------------- */

const quality = assessQuality('A short reply that says something specific about caching.');
const clean: GateResult = { allow: true, blocks: [], advisories: [], warnings: [], quality };
const TS = '2026-10-19T01:00:00.000Z';
const GOOD = 'I had the same thing happen after a host migration. Clearing the object cache and re-saving permalinks fixed it for me, worth trying first.';
const noClaims = {
  enabled: '1', certVerdict: 'REJECT', gates: clean, certAt: TS,
  latestCert: { verdict: 'REJECT', certifiedAt: TS as string | null, rules: ['no-claims'] },
  permalink: 'https://www.reddit.com/r/webdev/comments/1abc/some_title/', karma: 1
};
function underBar<T>(bar: string, fn: () => T): T {
  const saved = process.env.REDBOT_PUBLISH_MIN_VERDICT;
  process.env.REDBOT_PUBLISH_MIN_VERDICT = bar;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.REDBOT_PUBLISH_MIN_VERDICT; else process.env.REDBOT_PUBLISH_MIN_VERDICT = saved;
  }
}

test('warmup draft ids are recognised by their prefix, and only those', () => {
  assert.equal(isWarmupDraftId('w_abc123_lk9'), true);
  for (const id of ['d_abc', 'abc', 'xw_abc', '', 'W_abc']) assert.equal(isWarmupDraftId(id), false, id);
});

test('REDDIT: a warmup draft with no falsifiable claims, passing the warming rules, is eligible', () => {
  const d = underBar('REDDIT', () => unattendedPublishDecision({ ...noClaims, warmupBody: GOOD }));
  assert.equal(d.publish, true, d.why);
  assert.match(d.why, /waived: no-claims/);
  assert.equal('refuse' in underBar('REDDIT', () => certificationOnlyRefusal({ ...noClaims, warmupBody: GOOD })), false,
    'the early (before-page) refusal agrees');
});

test('REDDIT: no-claims stays a refusal for a contribution draft', () => {
  for (const warmupBody of [undefined, null]) {
    const d = underBar('REDDIT', () => unattendedPublishDecision({ ...noClaims, warmupBody }));
    assert.equal(d.publish, false);
    assert.match(d.why, /blocking rule\(s\): no-claims/);
  }
});

test('REDDIT: a warmup draft that breaks a warming rule or the linter is NOT waived', () => {
  for (const body of [
    'Try https://example.com — it fixed my cache issue after a migration, clear it and re-save permalinks.',
    'Too short to help.',
    'Check out my plugin, it fixed my cache issue after a host migration for me and a lot of others.'
  ]) {
    const d = underBar('REDDIT', () => unattendedPublishDecision({ ...noClaims, warmupBody: body }));
    assert.equal(d.publish, false, body);
  }
});

test('REDDIT: a warmup draft with a hard rule beside no-claims still refuses', () => {
  const d = underBar('REDDIT', () => unattendedPublishDecision({
    ...noClaims, warmupBody: GOOD, latestCert: { verdict: 'REJECT', certifiedAt: TS, rules: ['no-claims', 'thread-resolved'] }
  }));
  assert.equal(d.publish, false);
  assert.match(d.why, /thread-resolved/);
});

test('REDDIT: a warmup draft still obeys the floor, the gates and every advisory', () => {
  const wp = underBar('REDDIT', () => unattendedPublishDecision({
    ...noClaims, warmupBody: GOOD, permalink: 'https://www.reddit.com/r/WordPress/comments/1/x/'
  }));
  assert.equal(wp.publish, false);
  assert.match(wp.why, /karma 10/);
  const adv = underBar('REDDIT', () => unattendedPublishDecision({
    ...noClaims, warmupBody: GOOD, gates: { ...clean, advisories: [{ gate: 'warming:spacing', reason: 'too soon' }] }
  }));
  assert.equal(adv.publish, false);
  assert.match(adv.why, /warming:spacing/);
});

test('CERTIFIED and ESCALATE bars are unchanged: a no-claims REJECT does not publish, warmup or not', () => {
  for (const bar of ['CERTIFIED', 'ESCALATE']) {
    const d = underBar(bar, () => unattendedPublishDecision({ ...noClaims, warmupBody: GOOD }));
    assert.equal(d.publish, false, bar);
  }
});

/* ---- reply.ts: the audit trail and the plumbing ------------------------------------------- */

test('reply.ts tags every publish.* row with warming for a warmup draft, and feeds both decisions its body', () => {
  const src = readFileSync(new URL('../../src/commands/reply.ts', import.meta.url), 'utf8');
  const rows = [...src.matchAll(/record\('publish\.[a-z]+',[\s\S]*?\}\);/g)].map((m) => m[0]);
  assert.ok(rows.length >= 6, `expected every publish.* row, found ${rows.length}`);
  for (const r of rows) assert.match(r, /\.\.\.warmTag/, r.slice(0, 80));
  assert.match(src, /const warmTag = warmup \? \{ warming: true \} : \{\};/);
  assert.match(src, /latestCert,\s+warmupBody\s+\}\);/, 'the early (before-page) refusal sees the warmup body');
  assert.match(src, /karma: verdict\.counters\.karma,\s+flooredSubs,\s+warmupBody\s+\};/, 'the full decision (and the final re-check) sees it');
});

test("REDDIT: a subreddit floored from observed removals refuses for any account, like the static seed", () => {
  const into = (over = {}) => ({ ...noClaims, warmupBody: GOOD, karma: 1, permalink: "/r/webhosting/comments/1/x/", ...over });
  /* r/webhosting is NOT in KARMA_FLOOR_SUBS, so at karma 1 a warmup there publishes unattended... */
  assert.equal(underBar("REDDIT", () => unattendedPublishDecision(into())).publish, true);
  /* ...until it is handed in as a removal-derived floored sub, when it behaves exactly like r/wordpress. */
  const floored = underBar("REDDIT", () => unattendedPublishDecision(into({ flooredSubs: new Set(["webhosting"]) })));
  assert.equal(floored.publish, false);
  assert.match(floored.why, /karma 10/);
});
