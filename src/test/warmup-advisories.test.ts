/**
 * Production 2026-10-19 03:50 UTC: w_cb0696aba79f passed the warming rules and certified ESCALATE
 * (soft rules only), then was refused on three CONTRIBUTION-pipeline advisories:
 * quality:too-short, triage, not-a-question. A warmup comment has its own length floor, picks its
 * own thread, and answers ordinary posts by design, so those three are waived for an eligible
 * warmup body under REDDIT, and nothing else is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GateResult } from '../gates.js';
import { assessQuality } from '../quality.js';
import { unattendedPublishDecision, WARMUP_WAIVABLE_ADVISORIES } from '../autopublish.js';

const TS = '2026-10-19T03:49:34.000Z';
const PROD = "I'd check intake and handoff first, especially how you'd handle shipping damage and status updates, before trusting the margin.";
const adv = (...g: string[]): GateResult => ({
  allow: true, blocks: [], warnings: [], quality: assessQuality(PROD),
  advisories: g.map((gate) => ({ gate, reason: gate }))
});
/* The subreddit is read from the /r/<name>/ segment; the host is irrelevant to the decision. */
const base = {
  enabled: '1', certVerdict: 'ESCALATE', certAt: TS, karma: 1,
  latestCert: { verdict: 'ESCALATE', certifiedAt: TS as string | null, rules: ['overconfident-language', 'low-confidence-as-fact'] },
  permalink: 'https://example.test/r/Entrepreneur/comments/1x9cw20/rate_my_idea/'
};
function withBar<T>(bar: string, fn: () => T): T {
  const s = process.env.REDBOT_PUBLISH_MIN_VERDICT; process.env.REDBOT_PUBLISH_MIN_VERDICT = bar;
  try { return fn(); } finally { if (s === undefined) delete process.env.REDBOT_PUBLISH_MIN_VERDICT; else process.env.REDBOT_PUBLISH_MIN_VERDICT = s; }
}

test('the production warmup refusal publishes once the three contribution advisories are waived', () => {
  const d = withBar('REDDIT', () => unattendedPublishDecision({ ...base, warmupBody: PROD, gates: adv('quality:too-short', 'triage', 'not-a-question', 'certification') }));
  assert.equal(d.publish, true, d.why);
  assert.match(d.why, /warmup waived advisories: quality:too-short, triage, not-a-question/, 'the record names what was stepped over');
});

test('the same advisories still refuse a contribution draft', () => {
  const d = withBar('REDDIT', () => unattendedPublishDecision({ ...base, warmupBody: null, gates: adv('quality:too-short', 'triage', 'not-a-question') }));
  assert.equal(d.publish, false);
  assert.match(d.why, /quality:too-short, triage, not-a-question/);
});

test('every other advisory still refuses a warmup draft', () => {
  for (const g of ['duplicate', 'locked', 'archived', 'warming:spacing', 'window', 'health', 'stale-thread', 'quality:generic']) {
    const d = withBar('REDDIT', () => unattendedPublishDecision({ ...base, warmupBody: PROD, gates: adv('triage', g) }));
    assert.equal(d.publish, false, g);
    assert.ok(d.why.includes(g), `${g}: ${d.why}`);
  }
});

test('priority (the Opportunity Engine score floor) is waived for a warmup, as triage is', () => {
  const d = withBar('REDDIT', () => unattendedPublishDecision({ ...base, warmupBody: PROD, gates: adv('priority', 'triage') }));
  assert.equal(d.publish, true, d.why);
});

test('a warmup body that fails the warming rules gets no waiver', () => {
  const d = withBar('REDDIT', () => unattendedPublishDecision({ ...base, warmupBody: 'Too short.', gates: adv('triage') }));
  assert.equal(d.publish, false);
});

test('outside REDDIT nothing is waived', () => {
  const d = withBar('ESCALATE', () => unattendedPublishDecision({ ...base, warmupBody: PROD, gates: adv('triage') }));
  assert.equal(d.publish, false);
  assert.ok(d.why.includes('triage'), d.why);
});

test('the waivable set is exactly the four', () => {
  assert.deepEqual([...WARMUP_WAIVABLE_ADVISORIES].sort(), ['not-a-question', 'priority', 'quality:too-short', 'triage']);
});
