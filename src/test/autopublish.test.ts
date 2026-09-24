/**
 * Every way an unattended run may and may not publish.
 *
 * This is the only place the decision lives (src/autopublish.ts), deliberately, so that it can
 * be enumerated without a browser, a Reddit session or a live thread. A rule that needs all
 * three to exercise is a rule that stops being exercised.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GateResult } from '../gates.js';
import { assessQuality } from '../quality.js';
import { unattendedPublishDecision } from '../autopublish.js';

/* Built from the real GateResult (src/gates.ts:34-48) rather than cast past it: a fixture that
   lies about the shape stops catching the day the shape changes. `quality` is only carried
   through by this decision — it never reads it — so a minimal valid report is honest here. */
const quality = assessQuality('A short reply that says something specific about caching.');
const gate = (over: Partial<GateResult>): GateResult =>
  ({ allow: true, blocks: [], advisories: [], warnings: [], quality, ...over });

const clean = gate({});
const withAdvisory = (g: string): GateResult => gate({ advisories: [{ gate: g, reason: 'because' }] });
const hardBlocked = gate({ allow: false, blocks: [{ gate: 'identity', reason: 'wrong account' }] });

/* CERTIFIED, not PASS. This file asserted 'PASS' throughout and passed, because the constant it
   compared against said 'PASS' too — neither was the real verdict domain. src/argus/types.ts:191
   defines it: 'CERTIFIED' | 'ESCALATE' | 'REJECT', persisted at src/types.ts:121. */
const ON = { enabled: '1', certVerdict: 'CERTIFIED', gates: clean };

test('the switch is off by default, and only "1" turns it on', () => {
  for (const enabled of [undefined, '', '0', 'false', 'true', 'yes', 'on', ' 1']) {
    const d = unattendedPublishDecision({ ...ON, enabled });
    assert.equal(d.publish, false, `REDBOT_AUTO_PUBLISH=${JSON.stringify(enabled)} must not publish`);
    assert.match(d.why, /off/);
  }
  assert.equal(unattendedPublishDecision(ON).publish, true, 'and exactly "1" does turn it on');
});

test('an uncertified draft never publishes', () => {
  for (const certVerdict of [null, undefined, '', '   ']) {
    const d = unattendedPublishDecision({ ...ON, certVerdict });
    assert.equal(d.publish, false);
    assert.match(d.why, /no certification verdict/);
  }
});

test('only CERTIFIED publishes — REJECT, ESCALATE and anything else do not', () => {
  /* ESCALATE is the one that matters and it must NOT publish. src/argus/certify.ts:7-9 defines it
     as the verdict for a draft that "needs a person who knows the subject" — precisely what an
     unattended loop has not got. It is also the verdict this pipeline actually reaches today
     (cert 6, 2026-09-24), so treating it as good enough is the difference between publishing
     nothing and publishing something nobody checked. */
  for (const certVerdict of ['REJECT', 'reject', 'ESCALATE', 'escalate', 'PASS', 'REVIEW', 'OK', 'pending']) {
    const d = unattendedPublishDecision({ ...ON, certVerdict });
    assert.equal(d.publish, false, `${certVerdict} must not publish`);
    assert.match(d.why, /only CERTIFIED/);
  }
});

test('CERTIFIED is matched case- and whitespace-insensitively, because the column is free text', () => {
  for (const certVerdict of ['CERTIFIED', 'certified', ' Certified ']) {
    assert.equal(unattendedPublishDecision({ ...ON, certVerdict }).publish, true, `${JSON.stringify(certVerdict)} should pass`);
  }
});

test('gates that were never run are a refusal, not a pass', () => {
  const d = unattendedPublishDecision({ ...ON, gates: null });
  assert.equal(d.publish, false);
  assert.match(d.why, /gates were not run/);
});

test('a hard gate refuses, and the message names it', () => {
  const d = unattendedPublishDecision({ ...ON, gates: hardBlocked });
  assert.equal(d.publish, false);
  assert.match(d.why, /hard gate refused: identity/);
});

test('AN ADVISORY REFUSES UNATTENDED, though a person could overrule it', () => {
  /**
   * The rule this whole module exists for. src/gates.ts makes advisories overrulable because
   * src/commands/reply.ts prints them immediately above a prompt — approving there is an
   * INFORMED override. A loop reads nothing, so "overrulable" would mean "silently ignored",
   * which deletes the safeguard rather than applying it.
   *
   * reply.ts already reasons this way for a console approval token: it "does not carry
   * permission for advisories nobody showed anyone", and it REFUSES "because there is no
   * terminal to prompt on". Here there is not even a browser.
   */
  for (const gate of ['duplicate', 'locked', 'archived', 'warming:age', 'window', 'health']) {
    const d = unattendedPublishDecision({ ...ON, gates: withAdvisory(gate) });
    assert.equal(d.publish, false, `advisory ${gate} must refuse unattended`);
    assert.match(d.why, /nobody can overrule unattended/);
    assert.match(d.why, new RegExp(gate.replace(':', ':')), 'and the gate must be named in the log line');
  }
});

test('the human path is unaffected — this function is only consulted unattended', () => {
  /* A guard against the obvious regression: someone "simplifying" by calling this from the
     interactive path too, which would stop a person being able to overrule anything. The
     function has no opinion about interactive runs; it is only ever reached with enabled='1'
     from a loop. Asserted as documentation of that contract. */
  assert.equal(unattendedPublishDecision({ enabled: undefined, certVerdict: 'CERTIFIED', gates: clean }).publish, false);
});

test('every refusal carries a reason, because it goes straight into the run log', () => {
  const cases: Parameters<typeof unattendedPublishDecision>[0][] = [
    { enabled: undefined, certVerdict: 'CERTIFIED', gates: clean },
    { enabled: '1', certVerdict: null, gates: clean },
    { enabled: '1', certVerdict: 'REJECT', gates: clean },
    { enabled: '1', certVerdict: 'ESCALATE', gates: clean },
    { enabled: '1', certVerdict: 'CERTIFIED', gates: null },
    { enabled: '1', certVerdict: 'CERTIFIED', gates: hardBlocked },
    { enabled: '1', certVerdict: 'CERTIFIED', gates: withAdvisory('duplicate') }
  ];
  for (const c of cases) {
    const d = unattendedPublishDecision(c);
    assert.equal(d.publish, false);
    assert.ok(d.why.trim().length > 10, `a refusal must say why: got ${JSON.stringify(d.why)}`);
  }
});

test('the one publishing case says why it was allowed, not just that it was', () => {
  const d = unattendedPublishDecision(ON);
  assert.equal(d.publish, true);
  assert.match(d.why, /CERTIFIED/);
  assert.match(d.why, /no hard block/);
  assert.match(d.why, /no advisory/);
});
