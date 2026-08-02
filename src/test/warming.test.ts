/**
 * The warming rules.
 *
 * ACCOUNT-WARMING.md has prescribed these since day one and none of them has ever been
 * executed — `publish.ok` in the history log is 0 and karma is still 1. A rule nothing enforces
 * is a note, so these tests are about the refusals: the link that reads as promotion, the burst
 * that reads as automation, the essay that reads as a bot, the thread that is already too old
 * for a comment to be seen.
 *
 * Getting this wrong does not produce a bad reply. It produces a flagged account, and every
 * other capability in this repository runs through that account.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkWarmingComment, checkWarmingPace, isWarmingTarget, warmingStage,
  WARMING_MAX_WORDS
} from '../warming.js';
import { evaluateGates, type GateInput } from '../gates.js';
import type { HealthCounters, HealthVerdict } from '../health.js';
import type { ThreadState } from '../reddit/thread-state.js';
import type { Draft, Thread, OpportunityAssessment } from '../types.js';
import { policy } from '../policy.js';

const GOOD =
  'Check the error log first — a 502 right after a PHP upgrade is usually a fatal in a plugin ' +
  'that has not caught up, and the log names the file. If it is empty, turn on debug logging and ' +
  'reproduce it once.';

test('an ordinary helpful comment passes', () => {
  const r = checkWarmingComment(GOOD);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test('any link is refused, however helpful', () => {
  for (const body of [
    `${GOOD} See https://developer.wordpress.org/debug/`,
    `${GOOD} More at www.wordpress.org`,
    `${GOOD} [the docs](https://example.com)`,
    `${GOOD} Try wpbeginner.com for a walkthrough.`
  ]) {
    const r = checkWarmingComment(body);
    assert.equal(r.ok, false, `should have been refused: ${body.slice(-40)}`);
    assert.ok(r.issues.some((i) => i.rule === 'no-links'));
  }
});

test('naming the company or a product is refused', () => {
  for (const body of [
    `${GOOD} We built SGEN to avoid this.`,
    `${GOOD} Our tool handles it automatically.`,
    `${GOOD} Sign up for the free trial and see.`
  ]) {
    const r = checkWarmingComment(body);
    assert.equal(r.ok, false, `should have been refused: ${body.slice(-40)}`);
    assert.ok(r.issues.some((i) => i.rule === 'no-promotion'));
  }
});

test('an essay from a new account is refused', () => {
  const long = Array.from({ length: WARMING_MAX_WORDS + 20 }, () => 'word').join(' ');
  const r = checkWarmingComment(long);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.rule === 'too-long'));
});

test('a one-liner is refused too — warming still has to be worth reading', () => {
  const r = checkWarmingComment('Same here, following.');
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.rule === 'too-short'));
});

/**
 * Warned, not blocked. The claim budget is a provisional number and has no business refusing a
 * publish on its own — but a new account being publicly wrong is exactly the outcome warming
 * exists to avoid, so it is surfaced.
 */
test('a claim-heavy warming comment warns without blocking', () => {
  const claimy =
    'The cache always returns the old row. That deletes the stored value. ' +
    'The filter never fires on the front end. The migration truncates the column every time.';
  const r = checkWarmingComment(claimy);
  assert.equal(r.issues.some((i) => i.rule === 'no-links' || i.rule === 'no-promotion'), false);
  assert.ok(r.warnings.some((w) => /unhedged/.test(w)));
});

/* ---- pace ---- */

test('the daily ceiling holds', () => {
  const r = checkWarmingPace({ publishedToday: 3, minutesSinceLast: 600, karma: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.rule === 'daily-ceiling'));
});

test('comments arriving in a cluster are refused', () => {
  const r = checkWarmingPace({ publishedToday: 1, minutesSinceLast: 5, karma: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.rule === 'spacing'));
});

test('a first-ever comment has no spacing to violate', () => {
  const r = checkWarmingPace({ publishedToday: 0, minutesSinceLast: null, karma: 1 });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

/* ---- targets ---- */

/**
 * The age ceiling is read from policy, not hardcoded here.
 *
 * The first version of this test asserted a literal 2h, which is how warming shipped with a
 * rule that found zero threads on every run: measured 2026-07-27, r/WordPress `/new`'s youngest
 * post was 6.1h old, so nothing could ever qualify. Asserting the literal would have kept the
 * test green while the feature was inert — the shape of failure this whole session keeps
 * finding. It now asserts the BEHAVIOUR either side of whatever the limit is.
 */
test('threads are chosen for being read, not for being easy', () => {
  const maxAge = policy.warmingMaxThreadAgeHours.value;
  const maxAnswers = policy.warmingMaxAnswers.value;

  // comfortably inside both limits — the whole point
  assert.equal(isWarmingTarget({ ageHours: 1, commentCount: 2, subreddit: 'WordPress', title: 't' }).ok, true);

  // just inside the age ceiling still qualifies
  assert.equal(
    isWarmingTarget({ ageHours: maxAge - 0.5, commentCount: 1, subreddit: 'WordPress', title: 't' }).ok,
    true
  );

  // past it, a comment is buried and earns nothing
  assert.equal(
    isWarmingTarget({ ageHours: maxAge + 1, commentCount: 1, subreddit: 'WordPress', title: 't' }).ok,
    false
  );

  // one voice in a crowd is invisible
  assert.equal(
    isWarmingTarget({ ageHours: 1, commentCount: maxAnswers + 1, subreddit: 'WordPress', title: 't' }).ok,
    false
  );

  // unknown age fails closed — we cannot tell whether it would be read
  assert.equal(isWarmingTarget({ ageHours: null, commentCount: 0, subreddit: 'WordPress', title: 't' }).ok, false);
});

/* ---- stage ---- */

test('stage 1 is decided from the account, and an unmeasured account is still in it', () => {
  assert.equal(warmingStage({ karma: 500, accountAgeDays: 400 }).warming, false);
  assert.equal(warmingStage({ karma: 1, accountAgeDays: 400 }).warming, true);
  assert.equal(warmingStage({ karma: 500, accountAgeDays: 2 }).warming, true);

  // Unknown is not permission. Never having measured karma is not evidence the account is warmed.
  assert.equal(warmingStage({ karma: null, accountAgeDays: 400 }).warming, true);
  assert.equal(warmingStage({ karma: 500, accountAgeDays: null }).warming, true);
});

/* ------------------------------------------------------------------ *
 * The wiring
 *
 * Between 2026-07-22 and 2026-07-27 every check above ran only here. `checkWarmingComment`,
 * `checkWarmingPace` and `isWarmingTarget` had no caller anywhere on the publish path, so the
 * commit titled "enforce the account-warming rules" enforced none of them and this file was the
 * feature in its entirety. These tests are about the seam rather than the rules: they assert
 * that `evaluateGates` actually REACHES these checks and reports what they find. Each one fails
 * against the unwired code, because no gate named `warming:*` existed to be hit.
 *
 * They no longer assert that it refuses, and the distinction is the point rather than a
 * concession. Since 2026-08-03 `warming:*` is advisory: the rule still fires on exactly the same
 * inputs, names itself, and is put in front of the operator, who may publish over it. What these
 * tests protect is the wiring — the defect that made the original commit a lie — and that is
 * unchanged. Whether a warming finding refuses or advises is pinned in gates.test.ts under
 * "the authority boundary"; it is deliberately not restated here, so there is one place to change
 * when the policy does.
 * ------------------------------------------------------------------ */

const NOW = new Date('2026-07-27T12:00:00.000Z');

const GOOD_THREAD: Thread = {
  id: 't_1',
  permalink: 'https://www.reddit.com/r/WordPress/comments/abc/x/',
  title: 'Checkout throws 502 after upgrading to PHP 8.2',
  subreddit: 'WordPress',
  author: 'asker',
  upvotes: 3,
  commentCount: 2,
  ageText: '1 hr ago',
  ageMinutes: 60,
  body: 'Since the upgrade, checkout throws a 502 from admin-ajax.php.',
  comments: [],
  collectedAt: NOW.toISOString(),
  source: 'read'
};

const counters = (over: Partial<HealthCounters> = {}): HealthCounters => ({
  account: 'docs-architect',
  readsToday: 0, searchesToday: 0, repliesToday: 0,
  avgSessionMs: null, avgDwellMs: null,
  rateLimitHits24h: 0, loginFailures24h: 0,
  removalsObserved30d: 0, absentSignedOut30d: 0, suspensionNotices: 0,
  // Stage 1 by karma, as both live accounts actually are (measured 2026-07-27: karma 1).
  accountAgeDays: 3, karma: 1,
  lastReplyAt: null, lastRateLimitAt: null, lastRemovalAt: null,
  ...over
});

/**
 * Healthy and mayPublish, on purpose and in every case below.
 *
 * If the health verdict did the refusing, these tests would prove nothing about the warming
 * gate. Handing in a verdict that says "go" is what makes a `warming:*` block attributable.
 */
const healthy = (c: HealthCounters): HealthVerdict => ({
  state: 'Healthy', mayPublish: true, reasons: [], resumeAt: null, counters: c
});

const gateInput = (over: Partial<GateInput> = {}): GateInput => ({
  draft: {
    id: 'd_1',
    threadId: 't_1',
    permalink: GOOD_THREAD.permalink,
    title: GOOD_THREAD.title,
    body: GOOD,
    hasDisclosure: false,
    lintIssues: [],
    createdAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
    model: 'test',
    status: 'pending'
  } satisfies Draft,
  thread: GOOD_THREAD,
  assessment: {
    threadId: 't_1',
    permalink: GOOD_THREAD.permalink,
    title: GOOD_THREAD.title,
    verdict: 'contribute',
    score: 80,
    thesis: null,
    reasons: ['a fillable gap nobody has closed'],
    assessedAt: NOW.toISOString()
  } satisfies OpportunityAssessment,
  identity: { loggedIn: true, username: 'docs-architect', via: 'test' },
  expectedAccount: 'docs-architect',
  health: healthy(counters()),
  threadState: {
    locked: false, archived: false, ownCommentPresent: false, composerPresent: true,
    unknown: [], anomalies: [], postScore: null, commentCount: null
  } satisfies ThreadState,
  allDrafts: [],
  now: NOW,
  ...over
});

/**
 * Every gate that FIRED, hard or advisory — see the same helper in gates.test.ts.
 *
 * The warming rules are the ones these tests exist for, and they still fire on exactly the inputs
 * they always did. What changed on 2026-08-03 is that firing no longer refuses the publish: the
 * operator is shown what the rule found and decides. These assertions are about the RULE — that a
 * link, a product mention, an essay or a cluster from a warming account is detected and named —
 * and that is unchanged, which is why the test bodies are not.
 */
const gatesHit = (over: Partial<GateInput> = {}) => {
  const r = evaluateGates(gateInput(over));
  return [...r.blocks, ...r.advisories].map((b) => b.gate);
};

const withBody = (body: string, over: Partial<GateInput> = {}): Partial<GateInput> => ({
  ...over,
  draft: { ...gateInput().draft, body }
});

test('the gate refuses a link from a warming account — the rule is enforced, not documented', () => {
  const hit = gatesHit(withBody(`${GOOD} See https://developer.wordpress.org/debug/`));
  assert.ok(
    hit.includes('warming:no-links'),
    `expected warming:no-links on the publish gate, got ${hit.join(',') || '(nothing)'}`
  );
});

test('the gate refuses a product mention from a warming account', () => {
  const hit = gatesHit(withBody(`${GOOD} Our tool handles it automatically.`));
  assert.ok(hit.includes('warming:no-promotion'), `got ${hit.join(',') || '(nothing)'}`);
});

test('an essay from a warming account is refused at the gate, not merely noted', () => {
  const long = Array.from({ length: WARMING_MAX_WORDS + 20 }, () => 'word').join(' ');
  assert.ok(gatesHit(withBody(long)).includes('warming:too-long'));
});

/**
 * The scope guard. Stage 1 binds new accounts; it must not quietly become a second linter for
 * every account forever, or the contribution pipeline is unpublishable by design.
 */
test('an account past stage 1 is not held to the warming rules', () => {
  const grown = healthy(counters({ karma: 500, accountAgeDays: 400 }));
  const hit = gatesHit(withBody(`${GOOD} See https://developer.wordpress.org/debug/`, { health: grown }));
  assert.equal(
    hit.some((g) => g.startsWith('warming:')), false,
    `a warmed account was held to stage-1 rules: ${hit.join(',')}`
  );
});

test('unknown karma fails closed into stage 1 — never measured is not the same as warmed', () => {
  const unmeasured = healthy(counters({ karma: null, accountAgeDays: 400 }));
  const hit = gatesHit(withBody(`${GOOD} See https://developer.wordpress.org/debug/`, { health: unmeasured }));
  assert.ok(hit.includes('warming:no-links'), `got ${hit.join(',') || '(nothing)'}`);
});

/**
 * The gate reads the counters, not the verdict computed from them.
 *
 * `health` here says Healthy and mayPublish, so the existing health gate stays silent — and the
 * same counters show three comments already sent today. A gate that inherited the caller's
 * conclusion would publish the fourth.
 */
test('a Healthy verdict does not license a stage-1 burst', () => {
  const bursting = healthy(counters({ repliesToday: 3 }));
  const hit = gatesHit({ health: bursting });
  assert.ok(hit.includes('warming:daily-ceiling'), `got ${hit.join(',') || '(nothing)'}`);
  assert.equal(hit.includes('health'), false, 'the health gate fired, so this proves nothing about warming');
});

test('comments arriving in a cluster are refused at the gate', () => {
  const clustered = healthy(counters({ lastReplyAt: new Date(NOW.getTime() - 5 * 60_000).toISOString() }));
  assert.ok(gatesHit({ health: clustered }).includes('warming:spacing'));
});

test('an unreadable last-reply timestamp fails closed — NaN never satisfied the spacing rule', () => {
  // Date.parse("whenever") is NaN and every comparison against NaN is false, so the one input
  // meaning "we cannot tell how long ago the last comment was" would have waved the spacing
  // rule through. It is treated as this instant instead.
  const unreadable = healthy(counters({ lastReplyAt: 'whenever' }));
  assert.ok(gatesHit({ health: unreadable }).includes('warming:spacing'));
});

/**
 * Stage 1 picks threads for being READ. That is a tighter question than the 72h publish ceiling,
 * and the assertion that `stale-thread` stays quiet is the point: a 6h-old thread is comfortably
 * inside every gate that existed before, and still buried.
 */
test('a thread too old to be read is refused while warming, inside the 72h publish ceiling', () => {
  /**
   * The age is derived from policy, for the reason the sibling test above already gives.
   *
   * This said `6 * 60` and went red when c3998c7 merged: `isWarmingTarget`'s ceiling moved from a
   * hardcoded 2h to `policy.warmingMaxThreadAgeHours`, measured at 8h precisely BECAUSE a 2h
   * ceiling matched nothing — r/WordPress `/new`'s youngest post was 6.1h old. So a 6h thread is
   * now inside the window by design, and the fixture was asserting the old constant rather than
   * the rule.
   *
   * Nothing about the intent changed: a thread too old to be read must still be refused. Two
   * hours past whatever the ceiling is stays past it when the ceiling next moves, and stays well
   * inside the 72h publish ceiling the second assertion depends on.
   */
  const overBy = policy.warmingMaxThreadAgeHours.value + 2;
  assert.ok(overBy < 72, `the warming ceiling reached ${overBy}h — this test can no longer separate it from stale-thread`);
  const buried = { ...GOOD_THREAD, ageMinutes: overBy * 60, ageText: `${overBy} hr ago` };
  const hit = gatesHit({ thread: buried });
  assert.ok(hit.includes('warming:target'), `got ${hit.join(',') || '(nothing)'}`);
  assert.equal(hit.includes('stale-thread'), false, 'the pre-existing age gate caught it, so this proves nothing');
});

test('a crowded thread is refused while warming — the eleventh voice is invisible', () => {
  const crowded = { ...GOOD_THREAD, commentCount: 40 };
  assert.ok(gatesHit({ thread: crowded }).includes('warming:target'));
});
