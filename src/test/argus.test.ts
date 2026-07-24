import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectResolution } from '../argus/resolution.js';
import { certaintyOf, supportedCertainty, findEpistemicIssues } from '../argus/epistemic.js';
import { validateGraph, propagateFailure, terminalClaims } from '../argus/graph.js';
import { certify } from '../argus/certify.js';
import type { Claim, Contradiction, ResolutionVerdict } from '../argus/types.js';
import type { Thread } from '../types.js';

const OPEN: ResolutionVerdict = { resolved: false, signals: [], detail: 'no resolution signal found' };

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 't', permalink: 'https://example.invalid/t', title: 'something broke',
  subreddit: 'wordpress', author: 'asker', upvotes: 1, commentCount: 2,
  ageText: '2 hr ago', ageMinutes: 120, body: 'my thing is broken, any ideas?',
  comments: [], collectedAt: new Date().toISOString(), source: 'read', ...over
});

const claim = (over: Partial<Claim> = {}): Claim => ({
  id: 'c1', text: 'a claim', type: 'inference',
  evidenceClass: 'reasoned-inference', evidenceDetail: 'worked out from the symptom',
  confidence: 'medium', dependsOn: [], sourceQuote: 'a claim', ...over
});

/* ================================================================== *
 * Phase 7 — resolution detection
 * ================================================================== */

test('HRC-001: the real thread that slipped through is detected as resolved', () => {
  // Verbatim from data/threads.json, thread f11d8de68709 — the thread that produced a draft,
  // passed 20 gates, and was rejected by human certification.
  const t = thread({
    author: 'sdhdaa',
    title: 'Custom CSS missing after Updraft restore',
    body:
      'I messed something up so I restored an Updraft backup, but the whole site\'s colours, widths, radiuses etc are completely messed up\n\n' +
      'I checked Site Settings Custom CSS and all the CSS I had is completely blank\n\n' +
      'Additional CSS is fine\n\n' +
      'Any way I can get that Custom CSS back? I have the Updraft backup\n\n' +
      'UPDATE:\n\n' +
      'I downloaded the Updraft database file and extracted it. It was very big so I gave it to Claude and it found all the CSS.',
    comments: [
      { author: 'eshaanfaysal', body: 'In UpdraftPlus > Existing Backups, download just the Database portion.', depth: 0 },
      { author: 'sdhdaa', body: 'Yes this worked', depth: 1 },
      { author: 'sdhdaa', body: 'Thanks this is what I did', depth: 1 }
    ]
  });

  const r = detectResolution(t);
  assert.equal(r.resolved, true, 'the thread the pipeline drafted into must read as resolved');
  assert.ok(r.signals.some((s) => /UPDATE/i.test(s.matched)), 'the UPDATE marker must be found');
  assert.ok(r.signals.some((s) => s.byOriginalPoster && /worked/i.test(s.matched)),
    "the OP's own 'this worked' must be found");
});

test('bare politeness is not resolution', () => {
  const t = thread({
    author: 'asker',
    comments: [
      { author: 'asker', body: 'Thanks!', depth: 1 },
      { author: 'asker', body: "Thanks, I'll try that later", depth: 1 },
      { author: 'asker', body: 'will test this tomorrow', depth: 1 }
    ]
  });
  assert.equal(detectResolution(t).resolved, false);
});

test('a bystander saying it worked is not the asker declaring resolution', () => {
  const t = thread({
    author: 'asker',
    comments: [{ author: 'someone-else', body: 'this worked for me too', depth: 0 }]
  });
  const r = detectResolution(t);
  assert.equal(r.resolved, false, 'only the asker can declare their own problem solved');
  assert.equal(r.signals.length, 1, 'the signal is still recorded, just not authoritative');
  assert.equal(r.signals[0]!.byOriginalPoster, false);
});

test('SOLVED / EDIT markers in the body are caught', () => {
  for (const body of ['SOLVED: it was the cache', 'EDIT: found it, was a plugin conflict', 'UPDATE - fixed now']) {
    assert.equal(detectResolution(thread({ body })).resolved, true, `missed: ${body}`);
  }
});

test('an open thread stays open', () => {
  const t = thread({
    body: 'Checkout throws a 502 after upgrading. Any ideas what to check?',
    comments: [{ author: 'x', body: 'have you looked at the error log?', depth: 0 }]
  });
  assert.equal(detectResolution(t).resolved, false);
});

/* ================================================================== *
 * Phase 8 — epistemic calibration
 * ================================================================== */

test('HRC-001: the false sentence reads as asserted, not hedged', () => {
  const quote = 'the row inserts empty or truncated instead of throwing an error';
  assert.equal(certaintyOf(quote), 'asserted');
});

test('hedges and explicit uncertainty are recognised', () => {
  assert.equal(certaintyOf('this is usually a plugin conflict'), 'hedged');
  assert.equal(certaintyOf('one possibility is a plugin conflict'), 'explicitly-uncertain');
  assert.equal(certaintyOf("I can't tell from here without the log"), 'explicitly-uncertain');
});

test('a bare declarative counts as an assertion', () => {
  assert.equal(certaintyOf('wp_options stores it as a serialized array'), 'asserted');
});

test('non-authoritative provenance cannot carry high confidence', () => {
  assert.equal(supportedCertainty(claim({ evidenceClass: 'reasoned-inference', confidence: 'high' })), 'medium');
  assert.equal(supportedCertainty(claim({ evidenceClass: 'unsupported', confidence: 'high' })), 'unknown');
  assert.equal(supportedCertainty(claim({ evidenceClass: 'primary-documentation', confidence: 'high' })), 'high');
});

test('asserting an unsupported claim is an epistemic failure', () => {
  const issues = findEpistemicIssues([
    claim({ id: 'c1', evidenceClass: 'unsupported', confidence: 'unknown',
            sourceQuote: 'the row inserts empty instead of throwing an error' })
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.languageCertainty, 'asserted');
  assert.equal(issues[0]!.supportedCertainty, 'unknown');
});

test('hedged language over weak evidence is fine — only the unsafe direction is reported', () => {
  const issues = findEpistemicIssues([
    claim({ evidenceClass: 'reasoned-inference', confidence: 'low',
            sourceQuote: 'this might be a truncation issue, worth checking the log' })
  ]);
  assert.equal(issues.length, 0);
});

/* ================================================================== *
 * Phase 6 — dependency graph
 * ================================================================== */

test('HRC-001 shape: when the foundation fails, everything above it falls', () => {
  // A: truncation happens silently  ← false
  // B: Custom CSS is one big row
  // C: that explains the blank field   (depends A, B)
  // D: raise max_allowed_packet        (depends C)
  const claims = [
    claim({ id: 'A' }), claim({ id: 'B' }),
    claim({ id: 'C', dependsOn: ['A', 'B'] }),
    claim({ id: 'D', dependsOn: ['C'] })
  ];
  const dead = propagateFailure(claims, new Set(['A']));
  const ids = dead.map((d) => d.claimId).sort();
  assert.deepEqual(ids, ['C', 'D'], 'C and D must fall with A');
  assert.equal(dead.find((d) => d.claimId === 'D')!.becauseOf, 'A', 'the root cause must be named');
});

test('a claim that failed on its own merits is not also reported as invalidated', () => {
  const claims = [claim({ id: 'A' }), claim({ id: 'B', dependsOn: ['A'] })];
  const dead = propagateFailure(claims, new Set(['A', 'B']));
  assert.equal(dead.length, 0);
});

test('circular reasoning is caught', () => {
  const issues = validateGraph([
    claim({ id: 'A', dependsOn: ['B'] }),
    claim({ id: 'B', dependsOn: ['A'] })
  ]);
  assert.ok(issues.some((i) => i.kind === 'cycle'));
});

test('a dependency on a claim that was never extracted is caught', () => {
  const issues = validateGraph([claim({ id: 'A', dependsOn: ['ghost'] })]);
  assert.ok(issues.some((i) => i.kind === 'missing-dependency'));
});

test('terminal claims are the reply\'s actual conclusions', () => {
  const claims = [claim({ id: 'A' }), claim({ id: 'B', dependsOn: ['A'] })];
  assert.deepEqual(terminalClaims(claims).map((c) => c.id), ['B']);
});

/* ================================================================== *
 * Phase 12 — verdict
 * ================================================================== */

const base = { contradictions: [] as Contradiction[], epistemic: [], resolution: OPEN };

test('a resolved thread is rejected before anything else is considered', () => {
  const r = certify({
    ...base,
    claims: [claim({ evidenceClass: 'primary-documentation', confidence: 'high' })],
    resolution: { resolved: true, signals: [], detail: 'the asker declared this resolved' }
  });
  assert.equal(r.verdict, 'REJECT');
  assert.ok(r.reasons.some((x) => x.rule === 'thread-resolved'));
});

test('an explicit human override continues past a resolved thread', () => {
  const r = certify({
    ...base,
    claims: [claim({ type: 'observation', evidenceClass: 'observed-runtime-behaviour', confidence: 'high' })],
    resolution: { resolved: true, signals: [], detail: 'resolved' },
    humanOverride: true
  });
  assert.notEqual(r.verdict, 'REJECT');
});

test('a fatal contradiction rejects', () => {
  const r = certify({
    ...base,
    claims: [claim({ id: 'c1' })],
    contradictions: [{
      claimId: 'c1', kind: 'contradictory-documentation',
      statement: 'MySQL raises ERROR 1153 and aborts the import',
      evidenceClass: 'primary-documentation', evidenceDetail: 'MySQL manual',
      fatal: true
    }]
  });
  assert.equal(r.verdict, 'REJECT');
  assert.ok(r.reasons.some((x) => x.rule === 'fatal-contradiction'));
});

test('a factual claim with no provenance rejects', () => {
  const r = certify({ ...base, claims: [claim({ type: 'inference', evidenceClass: 'unsupported' })] });
  assert.equal(r.verdict, 'REJECT');
  assert.ok(r.reasons.some((x) => x.rule === 'no-provenance'));
});

test('an opinion is allowed to be unsupported', () => {
  const r = certify({ ...base, claims: [claim({ type: 'opinion', evidenceClass: 'unsupported', confidence: 'unknown' })] });
  assert.notEqual(r.verdict, 'REJECT');
});

test('HRC-001 rule: a falsifiable claim on reasoned inference escalates', () => {
  // "reasoning about how software behaves is not evidence of how it behaves"
  const r = certify({
    ...base,
    claims: [claim({ type: 'implementation-detail', evidenceClass: 'reasoned-inference', confidence: 'medium' })]
  });
  assert.equal(r.verdict, 'ESCALATE');
  assert.ok(r.reasons.some((x) => x.rule === 'falsifiable-claim-weak-evidence'));
});

test('the same claim with primary documentation certifies — once it has been attacked', () => {
  // Rule 8 makes the refutation mandatory: primary documentation is self-declared like any
  // other provenance, so a falsifiable claim still has to survive an actual attack.
  const c = claim({ id: 'c1', type: 'implementation-detail', evidenceClass: 'primary-documentation', confidence: 'high' });
  const r = certify({ ...base, claims: [c], refutationRan: new Set(['c1']) });
  assert.equal(r.verdict, 'CERTIFIED');
});

test('overconfident language about software behaviour rejects', () => {
  const c = claim({ id: 'c1', type: 'protocol-behaviour', evidenceClass: 'unsupported', confidence: 'unknown',
                    sourceQuote: 'the row inserts empty instead of throwing an error' });
  const r = certify({ ...base, claims: [c], epistemic: findEpistemicIssues([c]) });
  assert.equal(r.verdict, 'REJECT');
  assert.ok(r.reasons.some((x) => x.rule === 'overconfident-language'));
});

test('nothing to certify is a rejection, not a pass', () => {
  const r = certify({ ...base, claims: [] });
  assert.equal(r.verdict, 'REJECT');
  assert.ok(r.reasons.some((x) => x.rule === 'no-claims'));
});

test('downstream claims are rejected when their foundation is unsupported', () => {
  const r = certify({
    ...base,
    claims: [
      claim({ id: 'A', type: 'protocol-behaviour', evidenceClass: 'unsupported' }),
      claim({ id: 'B', type: 'recommendation', evidenceClass: 'primary-documentation', confidence: 'high', dependsOn: ['A'] })
    ]
  });
  assert.equal(r.verdict, 'REJECT');
  assert.ok(r.reasons.some((x) => x.rule === 'invalidated-dependency' && x.claimId === 'B'),
    'a well-evidenced recommendation resting on a false premise must still fail');
});

test('there is no fourth outcome', () => {
  for (const r of [
    certify({ ...base, claims: [] }),
    certify({ ...base, claims: [claim({ type: 'implementation-detail', evidenceClass: 'community-knowledge' })] }),
    certify({ ...base, claims: [claim({ type: 'observation', evidenceClass: 'observed-runtime-behaviour', confidence: 'high' })] })
  ]) {
    assert.ok(['CERTIFIED', 'ESCALATE', 'REJECT'].includes(r.verdict));
  }
});

test('Rule 8: a falsifiable claim that was never attacked cannot certify', () => {
  // OBSERVED 2026-07-23: the model declared `official-implementation` for the false
  // max_allowed_packet claim, so Rule 4 could not fire, and the refutation that would have
  // caught it timed out. A claim judged only on self-declared provenance marks its own homework.
  const c = claim({ id: 'c8', type: 'protocol-behaviour', evidenceClass: 'official-implementation', confidence: 'high' });
  const r = certify({ ...base, claims: [c], refutationRan: new Set<string>() });
  assert.equal(r.verdict, 'ESCALATE');
  assert.ok(r.reasons.some((x) => x.rule === 'unrefuted-falsifiable-claim'));
});

test('Rule 8: the same claim certifies once refutation has actually run and found nothing', () => {
  const c = claim({ id: 'c8', type: 'protocol-behaviour', evidenceClass: 'official-implementation', confidence: 'high' });
  const r = certify({ ...base, claims: [c], refutationRan: new Set(['c8']) });
  assert.equal(r.verdict, 'CERTIFIED');
});

/* ---- evaluation M6: a model-flagged-fatal contradiction must not outrank the evidence ---- */

test('M6: a fatal contradiction on weaker evidence than the claim escalates, it does not reject', () => {
  // The claim rests on primary documentation; the "fatal" contradiction rests on nothing the
  // model could classify (unknown). Taking the model's `fatal:true` verbatim would let its
  // say-so override primary documentation — the exact inversion Argus exists to prevent.
  const c = claim({ id: 'c1', type: 'protocol-behaviour', evidenceClass: 'primary-documentation', confidence: 'high' });
  const r = certify({
    ...base,
    claims: [c],
    contradictions: [{
      claimId: 'c1', kind: 'counterexample', statement: 'I think it might do something else',
      evidenceClass: 'unknown', evidenceDetail: '(none)', fatal: true
    }]
  });
  assert.equal(r.verdict, 'ESCALATE', 'weaker-evidence fatal must de-escalate to a human');
  assert.ok(r.reasons.some((x) => x.rule === 'contested-contradiction'));
  assert.ok(!r.reasons.some((x) => x.rule === 'fatal-contradiction'), 'it must not read as a hard reject');
});

test('M6: HRC-001 still rejects — an authoritative contradiction outranks a reasoned-inference claim', () => {
  // Regression guard: the fix must not spare the case Rule 2 was built for. ERROR 1153 is
  // primary/authoritative and outranks the reasoned-inference truncation claim it kills.
  const c = claim({ id: 'c1', type: 'implementation-detail', evidenceClass: 'reasoned-inference', confidence: 'high' });
  const r = certify({
    ...base,
    claims: [c],
    contradictions: [{
      claimId: 'c1', kind: 'contradictory-documentation',
      statement: 'MySQL raises ERROR 1153 and aborts the import',
      evidenceClass: 'primary-documentation', evidenceDetail: 'MySQL manual', fatal: true
    }]
  });
  assert.equal(r.verdict, 'REJECT');
  assert.ok(r.reasons.some((x) => x.rule === 'fatal-contradiction'));
});

test('epistemic exemption: a flatly-worded opinion is not an overconfidence issue', () => {
  // Rules 3 and 6 already exempt opinion; the epistemic pass did not, so an asserted opinion on
  // absent evidence was escalated as if it claimed a fact (evaluation, epistemic opinion exemption).
  const opinion = claim({
    id: 'c1', type: 'opinion', evidenceClass: 'unsupported', confidence: 'unknown',
    sourceQuote: 'nginx is always the right choice and Apache never is'
  });
  assert.equal(findEpistemicIssues([opinion]).length, 0);

  // A falsifiable claim with the same wording IS still flagged — the exemption is narrow.
  const factual = claim({
    id: 'c2', type: 'protocol-behaviour', evidenceClass: 'unsupported', confidence: 'unknown',
    sourceQuote: 'the connection always drops instead of retrying'
  });
  assert.ok(findEpistemicIssues([factual]).length >= 1);
});
