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

/**
 * Every gate that FIRED, hard or advisory.
 *
 * This used to read `.blocks` alone, back when firing and refusing were the same event. They are
 * not any more: `HARD_GATES` in src/gates.ts keeps `identity` as a refusal and hands the rest to
 * the person typing SEND, so a gate that finds something now lands in `advisories` instead.
 *
 * The tests below are unchanged and still mean what their names say — each one asserts that the
 * gate DETECTS its condition and names itself, which is the property that would actually regress
 * if someone broke it. What they never asserted, even before, is who gets to overrule it; that is
 * pinned explicitly in "the authority boundary" at the end of this file, so the split cannot be
 * widened by accident without a test going red.
 */
const gatesHit = (over: Partial<GateInput> = {}) => {
  const r = evaluateGates(base(over));
  return [...r.blocks, ...r.advisories].map((b) => b.gate);
};

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
  const r = evaluateGates(base({
    assessment: assessment({ verdict: 'skip', score: 20, reasons: ['the thread is already answered'] })
  }));
  /* Advisory since 2026-08-03, but it must still SAY which engine skipped it — an advisory that
     drops its provenance is worse than the block it replaced, because it is overruled blind. */
  const gates = [...r.blocks, ...r.advisories];
  assert.ok(gates.some((b) => b.gate === 'triage' && /Opportunity Engine/.test(b.reason)));
});

test('no assessment blocks — there is no second authority to fall back to', () => {
  assert.ok(gatesHit({ assessment: undefined }).includes('triage'));
});

test('the opportunity floor holds', () => {
  assert.ok(gatesHit({ assessment: assessment({ score: 20 }) }).includes('priority'));
});

test('a draft written for another account is not sent from this one', () => {
  // The browser is docs-architect and that matches expectedAccount, so the existing identity
  // check is satisfied — this is the case only the draft-level check can see.
  const foreign = draft({ account: 'jrum_sgen' });
  assert.ok(gatesHit({ draft: foreign }).includes('identity'));

  const own = draft({ account: 'docs-architect' });
  assert.equal(evaluateGates(base({ draft: own })).allow, true);

  // Drafts written before the field existed carry no account and must not be blocked by it.
  assert.equal(evaluateGates(base({ draft: draft() })).allow, true);
});

test('an old thread is not worth a reply', () => {
  assert.ok(gatesHit({ thread: thread({ ageMinutes: 96 * 60 }) }).includes('stale-thread'));
});

/**
 * Thread age is judged against the `now` handed in, never the wall clock.
 *
 * Until 2026-07-27 `currentAgeHours` read `Date.now()` and `evaluateGates` did not pass its own
 * `now` down, so this whole suite expired: the fixture thread was collected 2026-07-23T18:00Z
 * and every "is allowed" assertion here went red once real time passed the 72h ceiling
 * (`thread is 77h old`). The gates file documents itself as pure; this pins that claim so the
 * suite cannot rot into red again on a calendar boundary.
 */
test('thread age is measured against the injected now, not the wall clock', () => {
  const collected = thread();   // ageMinutes 120, collectedAt NOW

  // an hour after collection the thread is 3h old — nowhere near the ceiling
  const fresh = evaluateGates(base({ thread: collected, now: new Date(NOW.getTime() + 3_600_000) }));
  assert.equal(fresh.allow, true, `blocked by ${JSON.stringify(fresh.blocks)}`);

  // a hundred hours after collection the same thread is past it, from the same inputs
  const stale = evaluateGates(base({ thread: collected, now: new Date(NOW.getTime() + 100 * 3_600_000) }));
  assert.ok([...stale.blocks, ...stale.advisories].map((b) => b.gate).includes('stale-thread'));
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

test('every finding names its gate and gives a reason, hard or advisory', () => {
  /* Both lists, deliberately: an advisory is the only thing the operator gets before overruling
     it, so a thin reason there costs more than a thin reason on a refusal ever did. */
  const r = evaluateGates(base({ threadState: state({ locked: true }), identity: null }));
  const findings = [...r.blocks, ...r.advisories];
  assert.ok(findings.length >= 2);
  for (const b of findings) {
    assert.ok(b.gate.length > 0);
    assert.ok(b.reason.length > 10, `reason too thin: ${b.reason}`);
  }
});

/* ---- evaluation fixes: the publish path must fail closed on every unestablished fact ---- */

test('L1: a draft whose createdAt cannot be parsed fails closed, it does not skip the gate', () => {
  // Number.isFinite(Date.parse("not-a-date")) is false. The old guard skipped stale-draft in
  // exactly that case — "we cannot tell how old this is" waved the draft through. Now it blocks.
  assert.ok(gatesHit({ draft: draft({ createdAt: 'not-a-date' }) }).includes('stale-draft'));
});

test('L2: a missing thread record blocks, it does not silently drop the thread-derived gates', () => {
  const gates = gatesHit({ thread: undefined });
  assert.ok(gates.includes('no-thread'), `expected no-thread, got ${gates.join(',')}`);
});

test('L3: a prior APPROVED draft for the same thread is a duplicate, not only a published one', () => {
  assert.ok(gatesHit({ allDrafts: [draft({ id: 'd_0', status: 'approved' })] }).includes('duplicate'));
});

test('H6: an Argus REJECT on the draft is a hard publish block', () => {
  const rejected = draft({
    certification: { verdict: 'REJECT', at: NOW.toISOString(), claims: 5, fatalContradictions: 1 }
  });
  assert.ok(gatesHit({ draft: rejected }).includes('certification'));
});

test('H6: CERTIFIED publishes clean; ESCALATE and un-certified warn but do not block', () => {
  const certified = draft({
    certification: { verdict: 'CERTIFIED', at: NOW.toISOString(), claims: 5, fatalContradictions: 0 }
  });
  assert.equal(evaluateGates(base({ draft: certified })).allow, true);

  const escalated = draft({
    certification: { verdict: 'ESCALATE', at: NOW.toISOString(), claims: 5, fatalContradictions: 0 }
  });
  const esc = evaluateGates(base({ draft: escalated }));
  assert.equal(esc.allow, true);
  assert.ok(esc.warnings.some((w) => /escalated/i.test(w)));

  // base()'s default draft carries no certification: allowed, but warned.
  const none = evaluateGates(base());
  assert.equal(none.allow, true);
  assert.ok(none.warnings.some((w) => /not been fact-checked/i.test(w)));
});

test('H7: a refusing account window blocks the interactive publish path', () => {
  const refused = { allowed: false as const, rule: 'quiet-hours' as const, detail: 'docs-architect: quiet hours — it is 3:00 where this account lives.' };
  assert.ok(gatesHit({ window: refused }).includes('window'));
  // an allowing window does not block
  const allowed = { allowed: true as const, detail: 'clear to act' };
  assert.equal(evaluateGates(base({ window: allowed })).allow, true);
});

/* ------------------------------------------------------------------ *
 * The authority boundary
 *
 * Which gates REFUSE and which merely ADVISE is a policy, and a policy that lives only in a
 * `HARD_GATES` set is one edit away from being widened by somebody who thinks they are fixing a
 * flaky test. Every case below states the whole boundary, so widening it goes red here first.
 *
 * The change these pin: until 2026-08-03 every gate refused. `docs/07-MODULE-MATURITY.md` records
 * the cost — Argus returned REJECT 19 times out of 19, CERTIFIED and ESCALATE never fired once,
 * and the corpus contains 0 published comments. The findings were never the problem; the lock was.
 * ------------------------------------------------------------------ */

test('identity is the only gate that still refuses', () => {
  /* Not because overriding it would be worst, but because it is the only finding a person cannot
     consent to: if redbot cannot say who it is on the page, nobody knows which account is being
     approved for, and "two accounts never in one thread" becomes unenforceable by anyone. */
  const r = evaluateGates(base({ identity: null }));
  assert.equal(r.allow, false, 'an unestablished identity must still refuse');
  assert.deepEqual(r.blocks.map((b) => b.gate), ['identity']);
});

test('every other gate advises, and publishing stays the operator\'s call', () => {
  const cases: Array<[string, Partial<GateInput>]> = [
    ['thread-state', { threadState: null }],
    ['locked',       { threadState: state({ locked: true }) }],
    ['archived',     { threadState: state({ archived: true }) }],
    ['duplicate',    { threadState: state({ ownCommentPresent: true }) }],
    ['no-composer',  { threadState: state({ composerPresent: false }) }]
  ];
  for (const [gate, over] of cases) {
    const r = evaluateGates(base(over));
    assert.equal(r.allow, true, `[${gate}] still refuses — it must advise instead`);
    assert.ok(r.advisories.some((b) => b.gate === gate), `[${gate}] stopped being reported at all`);
    assert.equal(r.blocks.length, 0, `[${gate}] leaked into the hard blocks`);
  }
});

test('an Argus REJECT is reported in full and does not refuse', () => {
  /* "Keep the review, drop the lock." The verdict, its date and its contradiction count must all
     survive — an advisory that says less than the block it replaced is a downgrade, not a policy. */
  const rejected = draft({
    certification: { verdict: 'REJECT', at: '2026-08-01T00:00:00.000Z', fatalContradictions: 3 }
  } as Partial<Draft>);
  const r = evaluateGates(base({ draft: rejected }));
  assert.equal(r.allow, true, 'a REJECT must no longer refuse');
  const cert = r.advisories.find((b) => b.gate === 'certification');
  assert.ok(cert, 'the REJECT vanished instead of being surfaced');
  assert.match(cert.reason, /rejected/i);
  assert.match(cert.reason, /3 fatal/, 'the contradiction count was dropped from the advisory');
});

test('a finding never appears in both blocks and advisories', () => {
  /* Two copies of one reason is how a count on a screen ends up double-reporting a single gate. */
  const r = evaluateGates(base({ identity: null, threadState: state({ locked: true }) }));
  const hard = new Set(r.blocks.map((b) => b.gate));
  assert.ok(!r.advisories.some((b) => hard.has(b.gate)), 'a gate was reported twice');
  assert.equal(r.allow, false, 'a hard gate alongside advisories must still refuse');
});

test('a clean draft produces neither blocks nor advisories', () => {
  const r = evaluateGates(base());
  assert.equal(r.allow, true);
  assert.deepEqual(r.blocks, []);
  assert.deepEqual(r.advisories, [], 'a clean draft must not accumulate advisory noise');
});
