/**
 * Does the draft-time check agree with the publish gate?
 *
 * The cross-check at the end is the point of this file. Each family firing on its own is easy to
 * assert and easy to keep passing while the two functions drift apart; what matters is that
 * anything `draftTimeBlocks` reports is something `evaluateGates` would also report, under the
 * same gate name. That is the property that stops this becoming a second, quietly different
 * opinion about the same draft — the exact failure that cost four cycles when `assessOpportunity`
 * and `isWarmingTarget` disagreed about thread age and then about answer count.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftTimeBlocks, BODY_WARMING_RULES } from '../draft-gate.js';
import { checkWarmingComment, WARMING_MIN_WORDS, WARMING_MAX_WORDS } from '../warming.js';
import { evaluateGates, type GateInput } from '../gates.js';
import type { HealthVerdict, HealthCounters } from '../health.js';
import type { ThreadState } from '../reddit/thread-state.js';
import type { Draft, Thread, OpportunityAssessment } from '../types.js';

const THREAD = {
  title: 'Checkout throws 502 after upgrading to PHP 8.2',
  body: 'Since the PHP 8.2 upgrade, admin-ajax.php returns 502 on checkout. wp-config.php is unchanged.',
  comments: [{ author: 'b', body: 'Have you looked at the error log? Query Monitor shows nothing.', depth: 0 }]
};

/* Reuses the thread's own strings, so the specificity rule is satisfied and each test below
   isolates the one family it names. */
const CLEAN = 'The PHP 8.2 upgrade is the thing to start from: a 502 from admin-ajax.php usually '
  + 'means a fatal, and the error log names the file. If it is empty, set WP_DEBUG_LOG in '
  + 'wp-config.php and reproduce the checkout once.';

test('a clean body produces no draft-time blocks', () => {
  const out = draftTimeBlocks({ body: CLEAN, thread: THREAD, warming: true });
  assert.deepEqual(out, [], `expected nothing, got ${JSON.stringify(out)}`);
});

test('the quality family fires, under the gate name gates.ts:137 composes', () => {
  /* Specific, and about nothing the thread mentions — 0 technical tokens in the intersection. */
  const invented = 'I would open httpd.conf and check the LoadModule line for a stale php7.4 reference.';
  const out = draftTimeBlocks({ body: invented, thread: THREAD, warming: false });
  assert.ok(out.some((b) => b.gate === 'quality:generic'), JSON.stringify(out));
});

test('the novelty family is replayed from the draft, not recomputed', () => {
  /* gates.ts:143 reads `draft.noveltyIssues`. Passing none must produce none, whatever the body. */
  assert.deepEqual(draftTimeBlocks({ body: CLEAN, thread: THREAD, warming: true, noveltyIssues: [] }), []);
  const out = draftTimeBlocks({ body: CLEAN, thread: THREAD, warming: true, noveltyIssues: ['says nothing new'] });
  assert.deepEqual(out, [{ gate: 'novelty', reason: 'says nothing new' }]);
});

test('the warming family is checked only while the account is warming', () => {
  const tooShort = 'Check the log.';
  assert.ok(draftTimeBlocks({ body: tooShort, thread: THREAD, warming: true })
    .some((b) => b.gate === 'warming:too-short'));
  assert.ok(!draftTimeBlocks({ body: tooShort, thread: THREAD, warming: false })
    .some((b) => b.gate.startsWith('warming:')),
    'gates.ts:290 skips the whole warming block when the account is not warming');
});

test('BODY_WARMING_RULES is the list checkWarmingComment can actually produce', () => {
  /**
   * Asserted against the function rather than trusted. A body that trips every blocking rule at
   * once: a link, a promotional term, and — since too-long and too-short are mutually exclusive —
   * the long one here and the short one separately below.
   */
  const long = ('word '.repeat(WARMING_MAX_WORDS + 5)).trim() + ' https://example.invalid/thing';
  const seen = new Set(checkWarmingComment(long).issues.map((i) => i.rule));
  const short = checkWarmingComment('too thin');
  for (const r of short.issues) seen.add(r.rule);

  for (const rule of seen) {
    assert.ok(BODY_WARMING_RULES.includes(rule),
      `checkWarmingComment can produce "${rule}" and BODY_WARMING_RULES does not list it`);
  }
  assert.ok(seen.has('too-long') && seen.has('too-short') && seen.has('no-links'),
    `the fixture must actually trip the rules it claims: ${JSON.stringify([...seen])}`);
  assert.ok(WARMING_MIN_WORDS < WARMING_MAX_WORDS);
});

/* ---------------- the cross-check ---------------- */

const counters: HealthCounters = {
  repliesToday: 0, karma: 1, accountAgeDays: 2, lastReplyAt: null,
  rateLimits24h: 0, lastRateLimitAt: null, readRateLimits24h: 0, lastReadRateLimitAt: null,
  loginFails24h: 0, lastLoginFailAt: null, publishFails24h: 0
} as unknown as HealthCounters;

const health: HealthVerdict = { state: 'Healthy', mayPublish: true, reasons: [], counters } as unknown as HealthVerdict;

const gateInput = (body: string, noveltyIssues: string[] = []): GateInput => ({
  draft: {
    id: 'd_1', threadId: 't_1',
    permalink: 'https://www.reddit.com/r/WordPress/comments/abc/x/',
    title: THREAD.title, body, hasDisclosure: false, lintIssues: [], noveltyIssues,
    createdAt: new Date().toISOString(), model: 'test', status: 'pending'
  } as unknown as Draft,
  thread: {
    id: 't_1', permalink: 'https://www.reddit.com/r/WordPress/comments/abc/x/',
    title: THREAD.title, subreddit: 'WordPress', author: 'a', upvotes: 4, commentCount: 1,
    ageText: '2 hr ago', ageMinutes: 120, body: THREAD.body, comments: THREAD.comments,
    collectedAt: new Date().toISOString(), source: 'read'
  } as unknown as Thread,
  assessment: { verdict: 'contribute', score: 70, reasons: [] } as unknown as OpportunityAssessment,
  identity: { loggedIn: true, username: 'ryangrowth12', via: 'test' },
  expectedAccount: 'ryangrowth12',
  health,
  threadState: {
    locked: false, archived: false, alreadyCommented: false, composerReachable: true,
    unknown: [], anomalies: []
  } as unknown as ThreadState,
  allDrafts: [],
  now: new Date()
});

test('EVERY draft-time block is a gate evaluateGates also reports, by the same name', () => {
  const bodies: Array<[string, string[]]> = [
    [CLEAN, []],
    ['I would open httpd.conf and check the LoadModule line for a stale php7.4 reference.', []],
    ['Check the log.', []],
    [CLEAN, ['says nothing the thread has not already said']],
    [('word '.repeat(WARMING_MAX_WORDS + 5)).trim(), []]
  ];

  for (const [body, novelty] of bodies) {
    const r = evaluateGates(gateInput(body, novelty));
    const gateNames = new Set([...r.blocks, ...r.advisories].map((b) => b.gate));
    const mine = draftTimeBlocks({ body, thread: THREAD, warming: true, noveltyIssues: novelty });

    for (const b of mine) {
      assert.ok(gateNames.has(b.gate),
        `draftTimeBlocks reported "${b.gate}" but evaluateGates did not `
        + `(it reported ${JSON.stringify([...gateNames])}) for body: ${body.slice(0, 60)}`);
    }
  }
});

test('and it catches the four families the gate derives from the draft', () => {
  /* The other direction, bounded to the families this function owns: whatever evaluateGates finds
     in linter / quality / novelty / body-warming must have been findable at draft time. */
  const owned = (g: string) =>
    g === 'linter' || g === 'novelty' || g.startsWith('quality:')
    || BODY_WARMING_RULES.some((r) => g === `warming:${r}`);

  for (const body of [
    'I would open httpd.conf and check the LoadModule line for a stale php7.4 reference.',
    'Check the log.',
    ('word '.repeat(WARMING_MAX_WORDS + 5)).trim()
  ]) {
    const r = evaluateGates(gateInput(body));
    const theirs = [...r.blocks, ...r.advisories].map((b) => b.gate).filter(owned);
    const mine = new Set(draftTimeBlocks({ body, thread: THREAD, warming: true }).map((b) => b.gate));
    for (const g of theirs) {
      assert.ok(mine.has(g),
        `evaluateGates found "${g}" and draftTimeBlocks missed it for body: ${body.slice(0, 60)}`);
    }
  }
});
