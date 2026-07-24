import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuestionShaped, evaluateCandidate, currentAgeHours } from '../select.js';
import type { Thread, OpportunityAssessment } from '../types.js';

/**
 * DEFECT-12 regression. The real title that reached the top of the pilot ranking on
 * 2026-07-23, scored priority 72 / confidence 90 by triage, is the first case here.
 */
test('announcement-tagged titles are not questions, whatever the triage scored them', () => {
  const cases = [
    '[Guide] Complete cleanup and securing of WordPress after REST Batch API (wp2shell) attack',
    '[Tutorial] Speeding up WooCommerce checkout',
    '(PSA) Plugin X ships a backdoor in 4.2',
    '[Showcase] My first theme',
    '[Megathread] Weekly help requests'
  ];
  for (const title of cases) {
    const r = isQuestionShaped({ title, body: 'Here is how I did it. Step one, step two.' });
    assert.equal(r.pass, false, `treated as a question: ${title}`);
  }
});

test('a bracket tag is not enough on its own to reject — the tag has to be an announcement', () => {
  const r = isQuestionShaped({ title: '[WooCommerce] checkout 502s after upgrading, any idea?', body: '' });
  assert.equal(r.pass, true);
});

test('help requests without a question mark still pass', () => {
  const cases = [
    'Dying for a solution! Tried everything but contact form is not functioning',
    'Need help with design problems on my WordPress site!',
    "Can't get the cache to clear on a staging copy",
    'Sidebar widget throws a JSON error'
  ];
  for (const title of cases) {
    assert.equal(isQuestionShaped({ title, body: '' }).pass, true, `rejected a real ask: ${title}`);
  }
});

test('showcase and feedback posts are not technical questions — DEFECT-13', () => {
  const cases = [
    "Redesigning my AI company's site, would appreciate honest feedback",
    'Roast my new portfolio',
    'Rate my first WordPress theme',
    'Just launched my agency site after 6 months',
    'What do you think of my new checkout flow?'
  ];
  for (const title of cases) {
    assert.equal(isQuestionShaped({ title, body: '' }).pass, false, `treated as a question: ${title}`);
  }
});

test('a genuine question that happens to use the word feedback still passes', () => {
  assert.equal(
    isQuestionShaped({ title: 'Any feedback on why this contact form errors on submit?', body: '' }).pass,
    true
  );
});

test('a statement that asks nothing is rejected', () => {
  const r = isQuestionShaped({
    title: 'Finished migrating 40 sites to a new host this month',
    body: 'Went smoothly. Sharing the runbook I used.'
  });
  assert.equal(r.pass, false);
});

/* ------------------------------------------------------------------ */

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 't', permalink: 'https://example.invalid/t', title: 'Checkout 502s after PHP 8.2, any idea?',
  subreddit: 'wordpress', author: 'a', upvotes: 2, commentCount: 2,
  ageText: '3 hr ago', ageMinutes: 180,
  body: 'admin-ajax.php returns 502 since the upgrade.',
  comments: [{ author: 'b', body: 'try another browser', depth: 0 }],
  collectedAt: new Date().toISOString(), source: 'read', ...over
});

/**
 * The Opportunity Engine assessment. D-01 retired the Phase-1 `Opportunity` record this
 * fixture used to build; two of the criteria it fed (expertise match via `confidence`, and the
 * no-pitch check via `answerableWithoutPitch`) were model self-assessments and are gone.
 */
const opp = (over: Partial<OpportunityAssessment> = {}): OpportunityAssessment => ({
  threadId: 't', permalink: 'https://example.invalid/t', title: 'Checkout 502s after PHP 8.2, any idea?',
  verdict: 'contribute', score: 80, thesis: null,
  reasons: ['a fillable gap nobody has closed'], assessedAt: new Date().toISOString(),
  ...over
});

test('thread age is measured now, not at collection time', () => {
  // PRODUCTION OBSERVATION 2026-07-23, thread c14d9d8caa0e: stored ageMinutes said 17.8h
  // while the true age was 28.3h, because the corpus had sat for 10.6h. The 72h ceiling was
  // being enforced against the stored number.
  const collectedHoursAgo = 10.6;
  const t = {
    ageMinutes: 1065,
    collectedAt: new Date(Date.now() - collectedHoursAgo * 3_600_000).toISOString()
  };
  const age = currentAgeHours(t)!;
  assert.ok(age > 28 && age < 29, `expected ~28.4h, got ${age}`);
  assert.ok(age > t.ageMinutes / 60, 'must never report younger than the collection-time age');
});

test('a thread that aged past the ceiling while sitting in the corpus is caught', () => {
  const t = {
    ageMinutes: 70 * 60,                                              // 70h at collection
    collectedAt: new Date(Date.now() - 25 * 3_600_000).toISOString()  // sat for 25h
  };
  assert.ok(currentAgeHours(t)! > 72, 'a 95h-old thread must not read as 70h');
});

test('an unknown age stays unknown rather than becoming zero', () => {
  assert.equal(currentAgeHours({ ageMinutes: null, collectedAt: new Date().toISOString() }), null);
});

test('a fresh, specific, unanswered question in a pilot subreddit is eligible', () => {
  const c = evaluateCandidate(thread(), opp());
  assert.equal(c.eligible, true, `failed: ${JSON.stringify(c.criteria.filter((x) => !x.pass))}`);
});

test('a thread from years ago fails on recency — DEFECT-11', () => {
  // 62,975 hours is the real age of a wordpress_help thread that had a lint-clean draft
  // waiting against it on 2026-07-23.
  const c = evaluateCandidate(thread({ ageMinutes: 62_975 * 60 }), opp());
  const recency = c.criteria.find((x) => x.name === 'recent activity');
  assert.equal(recency?.pass, false);
  assert.equal(c.eligible, false);
});

test('a well-covered thread fails the settled-answer proxy, and says it is a proxy', () => {
  const c = evaluateCandidate(
    thread({ commentCount: 30, comments: [{ author: 'x', body: 'y'.repeat(900), depth: 0 }] }),
    opp()
  );
  const crit = c.criteria.find((x) => x.name === 'no existing high-quality answer');
  assert.equal(crit?.pass, false);
  assert.equal(crit?.proxy, true);
});

test('a subreddit outside the pilot set is not eligible', () => {
  const c = evaluateCandidate(thread({ subreddit: 'php' }), opp());
  assert.equal(c.criteria.find((x) => x.name === 'appropriate subreddit')?.pass, false);
});

test('every criterion carries a readable reason, so a rejection can be explained', () => {
  const c = evaluateCandidate(thread(), opp());
  for (const crit of c.criteria) {
    assert.ok(crit.detail.length > 10, `thin detail on ${crit.name}: ${crit.detail}`);
  }
});
