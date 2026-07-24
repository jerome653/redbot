import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGates, type GateInput } from '../gates.js';
import type { HealthVerdict, HealthCounters } from '../health.js';
import type { ThreadState } from '../reddit/thread-state.js';
import type { Draft, Thread, OpportunityAssessment } from '../types.js';

const BODY = `Check the PHP error log before anything else. A 502 from admin-ajax.php right after a PHP 8.2 upgrade is usually a fatal in a plugin that has not caught up with the functions removed in 8.0, and the log names the offending file on the first line.

If the log is empty, set WP_DEBUG_LOG to true in wp-config.php and reproduce the checkout once. You should get a stack trace pointing at the plugin.

Worth ruling out: on php-fpm a fatal surfaces as a gateway error rather than a PHP notice, which is why Query Monitor sees nothing.`;

const NOW = new Date('2026-07-23T18:00:00.000Z');

const draft = (over: Partial<Draft> = {}): Draft => ({
  id: 'd_1',
  threadId: 't_1',
  permalink: 'https://www.reddit.com/r/WordPress/comments/abc/x/',
  title: 'Checkout throws 502 after upgrading to PHP 8.2',
  body: BODY,
  hasDisclosure: false,
  lintIssues: [],
  createdAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
  model: 'test',
  status: 'pending',
  ...over
});

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 't_1',
  permalink: 'https://www.reddit.com/r/WordPress/comments/abc/x/',
  title: 'Checkout throws 502 after upgrading to PHP 8.2',
  subreddit: 'WordPress',
  author: 'asker',
  upvotes: 3,
  commentCount: 2,
  ageText: '2 hr ago',
  ageMinutes: 120,
  body: 'Since the upgrade, checkout throws a 502 from admin-ajax.php. Query Monitor shows nothing.',
  comments: [{ author: 'someone', body: 'Have you tried another browser?', depth: 0 }],
  collectedAt: NOW.toISOString(),
  source: 'read',
  ...over
});

/**
 * The Opportunity Engine assessment — the ONLY triage authority since D-01 retired the
 * Phase-1 path. The old fixture built an `Opportunity` carrying four model self-assessments
 * (worthwhile, score, confidence, answerableWithoutPitch); none of them exists any more.
 */
const assessment = (over: Partial<OpportunityAssessment> = {}): OpportunityAssessment => ({
  threadId: 't_1',
  permalink: 'https://www.reddit.com/r/WordPress/comments/abc/x/',
  title: 'Checkout throws 502 after upgrading to PHP 8.2',
  verdict: 'contribute',
  score: 80,
  thesis: null,
  reasons: ['a fillable gap nobody has closed'],
  assessedAt: NOW.toISOString(),
  ...over
});
const COUNTERS: HealthCounters = {
  account: 'docs-architect',
  readsToday: 0, searchesToday: 0, repliesToday: 0,
  avgSessionMs: null, avgDwellMs: null,
  rateLimitHits24h: 0, loginFailures24h: 0,
  removalsObserved30d: 0, absentSignedOut30d: 0, suspensionNotices: 0,
  accountAgeDays: 400, karma: 500,
  lastReplyAt: null, lastRateLimitAt: null, lastRemovalAt: null
};

const healthy: HealthVerdict = {
  state: 'Healthy', mayPublish: true, reasons: [], resumeAt: null, counters: COUNTERS
};

const state = (over: Partial<ThreadState> = {}): ThreadState => ({
  locked: false, archived: false, ownCommentPresent: false, composerPresent: true,
  unknown: [], anomalies: [],
  // Observation-only fields, added with the frozen interaction schema. Defaulted to null here
  // precisely because no gate may read them — if one ever does, these tests keep passing while
  // production sees a real number, and that divergence is the bug to catch.
  postScore: null, commentCount: null,
  ...over
});

const base = (over: Partial<GateInput> = {}): GateInput => ({
  draft: draft(),
  thread: thread(),
  assessment: assessment(),
  identity: { loggedIn: true, username: 'docs-architect', via: 'test' },
  expectedAccount: 'docs-architect',
  health: healthy,
  threadState: state(),
  allDrafts: [],
  now: NOW,
  ...over
});

const gatesHit = (over: Partial<GateInput> = {}) =>
  evaluateGates(base(over)).blocks.map((b) => b.gate);

test('a clean draft on a live thread with a healthy account is allowed', () => {
  const r = evaluateGates(base());
  assert.equal(r.allow, true, `blocked by ${JSON.stringify(r.blocks)}`);
});

test('an unprobed page is never published to', () => {
  assert.ok(gatesHit({ threadState: null }).includes('thread-state'));
});

test('locked and archived threads block', () => {
  assert.ok(gatesHit({ threadState: state({ locked: true }) }).includes('locked'));
  assert.ok(gatesHit({ threadState: state({ archived: true }) }).includes('archived'));
});

test('a second reply to the same thread blocks — from the page and from the drafts file', () => {
  assert.ok(gatesHit({ threadState: state({ ownCommentPresent: true }) }).includes('duplicate'));
  assert.ok(
    gatesHit({ allDrafts: [draft({ id: 'd_0', status: 'published' })] }).includes('duplicate')
  );
});

test('identity must be established, confirmed, and the account we expected', () => {
  assert.ok(gatesHit({ identity: null }).includes('identity'));
  assert.ok(gatesHit({ identity: { loggedIn: false, username: null, via: 'test' } }).includes('identity'));
  assert.ok(gatesHit({ identity: { loggedIn: true, username: null, via: 'test' } }).includes('identity'));
  assert.ok(
    gatesHit({ identity: { loggedIn: true, username: 'someone-else', via: 'test' } }).includes('identity')
  );
});

test('an assessment satisfies the triage gate — the only thing that does', () => {
  // PRODUCTION OBSERVATION 2026-07-23: draft d_c9bd9366f6b9_mrwiupf2 was blocked by
  // `[triage] no analysis on record` despite scoring 80/100 in the Opportunity Engine (E-17).
  // The first repair taught the gate to accept either record; D-01 removed the other one.
  const r = evaluateGates(base({ assessment: assessment({ score: 80 }) }));
  assert.equal(r.allow, true, `blocked by ${JSON.stringify(r.blocks)}`);
});

test('a skip verdict blocks, and says which engine said so', () => {
  const gates = evaluateGates(base({
    assessment: assessment({ verdict: 'skip', score: 20, reasons: ['the thread is already answered'] })
  })).blocks;
  assert.ok(gates.some((b) => b.gate === 'triage' && /Opportunity Engine/.test(b.reason)));
});

test('no assessment blocks — there is no second authority to fall back to', () => {
  assert.ok(gatesHit({ assessment: undefined }).includes('triage'));
});

test('the opportunity floor holds', () => {
  assert.ok(gatesHit({ assessment: assessment({ score: 20 }) }).includes('priority'));
});

test('an old thread is not worth a reply', () => {
  assert.ok(gatesHit({ thread: thread({ ageMinutes: 96 * 60 }) }).includes('stale-thread'));
});

test('a draft written yesterday is re-drafted, not posted', () => {
  const old = draft({ createdAt: new Date(NOW.getTime() - 30 * 3_600_000).toISOString() });
  assert.ok(gatesHit({ draft: old }).includes('stale-draft'));
});

test('anything the probe could not establish blocks — unknown is not permission', () => {
  assert.ok(
    gatesHit({ threadState: state({ unknown: ['comment authors unreadable'] }) }).includes('unknown-state')
  );
  assert.ok(
    gatesHit({ threadState: state({ anomalies: ['no post title'] }) }).includes('unexpected-ui')
  );
  assert.ok(
    gatesHit({ threadState: state({ composerPresent: false }) }).includes('no-composer')
  );
});

test('account health in Cooldown or Stop blocks publishing', () => {
  for (const s of ['Cooldown', 'Stop'] as const) {
    const blocked: HealthVerdict = {
      state: s, mayPublish: false, reasons: [`${s} for a reason`], resumeAt: null, counters: COUNTERS
    };
    assert.ok(gatesHit({ health: blocked }).includes('health'), `${s} did not block`);
  }
});

test('Caution allows publishing but surfaces every reason as a warning', () => {
  const caution: HealthVerdict = {
    state: 'Caution', mayPublish: true, reasons: ['karma 1 is below 10'], resumeAt: null, counters: COUNTERS
  };
  const r = evaluateGates(base({ health: caution }));
  assert.equal(r.allow, true);
  assert.ok(r.warnings.some((w) => /karma 1/.test(w)));
});

test('the safety linter and the craft gate both feed the decision', () => {
  const brand = draft({ body: BODY.replace('Check the PHP error log', 'SGEN would check the PHP error log') });
  assert.ok(gatesHit({ draft: brand }).includes('linter'));

  const generic = draft({
    body:
      'Start with the basics and work outward. Most of these turn out to be a caching layer ' +
      'holding an old response, so clear it and retest before touching configuration. ' +
      'If little changes, disable your extensions and add them back one at a time.'
  });
  assert.ok(gatesHit({ draft: generic }).some((g) => g.startsWith('quality:')));
});

test('every block names its gate and gives a reason', () => {
  const r = evaluateGates(base({ threadState: state({ locked: true }), identity: null }));
  assert.ok(r.blocks.length >= 2);
  for (const b of r.blocks) {
    assert.ok(b.gate.length > 0);
    assert.ok(b.reason.length > 10, `reason too thin: ${b.reason}`);
  }
});

/* ---- H6: the Argus verdict gates the post (2026-07-24) ---- */

test('a REJECT certification blocks publishing', () => {
  assert.ok(gatesHit({ certification: { verdict: 'REJECT', at: NOW.toISOString() } }).includes('certification'));
});

test('no certification on record blocks publishing — certify first', () => {
  assert.ok(gatesHit({ certification: null }).includes('uncertified'));
});

test('ESCALATE proceeds to the human, does not hard-block', () => {
  // ESCALATE means a person must resolve it — and the person is at the approval prompt.
  assert.ok(!gatesHit({ certification: { verdict: 'ESCALATE', at: NOW.toISOString() } }).includes('certification'));
});

test('CERTIFIED proceeds', () => {
  assert.ok(!gatesHit({ certification: { verdict: 'CERTIFIED', at: NOW.toISOString() } }).includes('certification'));
});

test('an omitted certification leaves the gate inert (back-compat)', () => {
  assert.ok(!gatesHit({}).some((g) => g === 'certification' || g === 'uncertified'));
});

/* ---- H7: the posting window is enforced on the path that posts (2026-07-24) ---- */

test('a closed window (quiet hours / ceiling) blocks publishing', () => {
  assert.ok(gatesHit({
    window: { allowed: false, rule: 'quiet-hours', detail: 'docs-architect: quiet hours' }
  }).includes('window'));
});

test('an open window does not block', () => {
  assert.ok(!gatesHit({
    window: { allowed: true, detail: 'docs-architect: clear to act' }
  }).includes('window'));
});

test('an omitted window leaves the gate inert (back-compat)', () => {
  assert.ok(!gatesHit({}).includes('window'));
});
