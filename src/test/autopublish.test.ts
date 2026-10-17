/**
 * Every way an unattended run may and may not publish.
 *
 * This is the only place the decision lives (src/autopublish.ts), deliberately, so that it can
 * be enumerated without a browser, a Reddit session or a live thread. A rule that needs all
 * three to exercise is a rule that stops being exercised.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { GateResult } from '../gates.js';
import { assessQuality } from '../quality.js';
import { unattendedPublishDecision, publishBar } from '../autopublish.js';

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
    assert.equal(d.publish, false, `${certVerdict} must not publish at the default bar`);
    assert.match(d.why, /requires CERTIFIED/);
  }
});

test('the bar is a dial, and its default is the strict end', () => {
  /**
   * REDBOT_PUBLISH_MIN_VERDICT, added 2026-09-25. Jerome, after four straight REJECTs and zero
   * posts: "if the fact check stops it then make it less strict". The dial lives HERE rather than
   * in src/argus, so the fact-checker keeps recording what it actually found — the REJECT that
   * prompted this carried three counterexamples backed by official-implementation and
   * primary-documentation against three claims that were simply false.
   *
   * Unset must mean strict. A missing or misspelled value that quietly meant "publish anything"
   * is the one failure mode this cannot have.
   */
  const saved = process.env.REDBOT_PUBLISH_MIN_VERDICT;
  try {
    for (const bad of [undefined, '', '   ', 'certified?', 'LENIENT', 'yes', '1']) {
      if (bad === undefined) delete process.env.REDBOT_PUBLISH_MIN_VERDICT;
      else process.env.REDBOT_PUBLISH_MIN_VERDICT = bad;
      assert.equal(publishBar(), 'CERTIFIED', `${JSON.stringify(bad)} must fall back to CERTIFIED`);
      assert.equal(unattendedPublishDecision({ ...ON, certVerdict: 'REJECT' }).publish, false);
    }

    process.env.REDBOT_PUBLISH_MIN_VERDICT = 'ESCALATE';
    assert.equal(publishBar(), 'ESCALATE');
    assert.equal(unattendedPublishDecision({ ...ON, certVerdict: 'ESCALATE' }).publish, true,
      'ESCALATE bar admits ESCALATE');
    assert.equal(unattendedPublishDecision({ ...ON, certVerdict: 'CERTIFIED' }).publish, true,
      'and still admits CERTIFIED');
    assert.equal(unattendedPublishDecision({ ...ON, certVerdict: 'REJECT' }).publish, false,
      'but NOT a REJECT — that is the whole point of having two rungs');

    process.env.REDBOT_PUBLISH_MIN_VERDICT = 'any';
    assert.equal(publishBar(), 'ANY');
    const r = unattendedPublishDecision({ ...ON, certVerdict: 'REJECT' });
    assert.equal(r.publish, true, 'ANY admits a REJECT');
    assert.match(r.why, /CONTRADICTED/,
      'and must say so in the reason, because that string is what lands in the history row');
  } finally {
    if (saved === undefined) delete process.env.REDBOT_PUBLISH_MIN_VERDICT;
    else process.env.REDBOT_PUBLISH_MIN_VERDICT = saved;
  }
});

test('lowering the bar does NOT stop other advisories refusing', () => {
  /* The `certification` advisory is dropped from the advisory check because it restates the
     verdict already judged (gates.ts:384-390 pushes it, and `certification` is not in HARD_GATES).
     Every other advisory is a live fact about the thread that nothing has judged, and must still
     refuse even at the loosest bar — otherwise "less strict about facts" silently became "post
     into locked and archived threads too". */
  const saved = process.env.REDBOT_PUBLISH_MIN_VERDICT;
  process.env.REDBOT_PUBLISH_MIN_VERDICT = 'ANY';
  try {
    for (const g of ['duplicate', 'locked', 'archived', 'warming:age', 'window', 'health']) {
      const d = unattendedPublishDecision({ ...ON, certVerdict: 'REJECT', gates: withAdvisory(g) });
      assert.equal(d.publish, false, `advisory ${g} must still refuse at the ANY bar`);
      assert.match(d.why, /nobody can overrule unattended/);
    }
    /* …while the certification advisory alone no longer blocks, or the dial could never move. */
    const ok = unattendedPublishDecision({ ...ON, certVerdict: 'REJECT', gates: withAdvisory('certification') });
    assert.equal(ok.publish, true, 'the certification advisory must not be counted twice');
  } finally {
    if (saved === undefined) delete process.env.REDBOT_PUBLISH_MIN_VERDICT;
    else process.env.REDBOT_PUBLISH_MIN_VERDICT = saved;
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
  assert.match(d.why, /no other advisory/);
  assert.match(d.why, /clears the CERTIFIED bar/,
    'the reason must name the bar in force — that string is the audit record of which one let it through');
});

/* ---- REDBOT_PUBLISH_MIN_VERDICT=REDDIT (Jerome, 2026-10-18) ---------------------------------
   0 of 34 certifications ever CERTIFIED. His call: tone and evidence rules warn; a claim proven
   false and an already-solved thread still block; r/Wordpress waits for karma 10. */
const TS = '2026-10-18T01:00:00.000Z';
const R = {
  enabled: '1', certVerdict: 'REJECT', gates: clean, certAt: TS,
  latestCert: { verdict: 'REJECT', certifiedAt: TS as string | null, rules: ['overconfident-language', 'no-provenance', 'overconfident-language'] },
  permalink: 'https://www.reddit.com/r/webdev/comments/1abc/some_title/',
  karma: 1
};
type RIn = Parameters<typeof unattendedPublishDecision>[0];
function underBar<T>(bar: string, fn: () => T): T {
  const saved = process.env.REDBOT_PUBLISH_MIN_VERDICT;
  process.env.REDBOT_PUBLISH_MIN_VERDICT = bar;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.REDBOT_PUBLISH_MIN_VERDICT;
    else process.env.REDBOT_PUBLISH_MIN_VERDICT = saved;
  }
}
const reddit = (over: Partial<RIn>) => underBar('REDDIT', () => unattendedPublishDecision({ ...R, ...over }));
const withRules = (verdict: string, rules: string[] | null): Partial<RIn> =>
  ({ certVerdict: verdict, latestCert: { verdict, certifiedAt: TS, rules } });

test('REDDIT: CERTIFIED passes, and its all-claims-supported rule is not judged as a rule', () => {
  assert.equal(underBar('reddit', publishBar), 'REDDIT', 'the bar reads in any casing');
  const d = reddit(withRules('CERTIFIED', ['all-claims-supported']));
  assert.equal(d.publish, true, d.why);
  assert.match(d.why, /clears the REDDIT bar/);
});

test('REDDIT: ESCALATE or REJECT on soft rules only passes, and the why names what was waived', () => {
  for (const v of ['REJECT', 'ESCALATE']) {
    const d = reddit(withRules(v, ['falsifiable-claim-weak-evidence', 'low-confidence-as-fact']));
    assert.equal(d.publish, true, `${v}: ${d.why}`);
    assert.match(d.why, /waived: falsifiable-claim-weak-evidence, low-confidence-as-fact/);
  }
  assert.match(reddit({}).why, /waived: overconfident-language, no-provenance(?!, overconfident)/, 'deduplicated');
});

test('REDDIT: a hard or unknown rule refuses, alone or beside soft ones', () => {
  const hard = ['fatal-contradiction', 'thread-resolved', 'contested-contradiction', 'invalidated-dependency',
    'unrefuted-falsifiable-claim', 'no-claims', 'graph-cycle', 'a-rule-nobody-wrote', 'Overconfident-Language'];
  for (const v of ['REJECT', 'ESCALATE']) {
    for (const rule of hard) {
      for (const rules of [[rule], ['overconfident-language', rule]]) {
        const d = reddit(withRules(v, rules));
        assert.equal(d.publish, false, `${v} ${rules.join('+')} must refuse`);
        assert.match(d.why, new RegExp(`blocking rule\\(s\\): ${rule}`));
      }
    }
  }
});

test('REDDIT: no rules on record is not "only soft rules" — empty and null refuse', () => {
  for (const rules of [[], null]) {
    const d = reddit(withRules('REJECT', rules));
    assert.equal(d.publish, false);
    assert.match(d.why, /no rules on record/);
  }
});

test('REDDIT: the latest certification row must exist and agree with the draft row', () => {
  for (const latestCert of [null, undefined]) {
    assert.equal(reddit({ latestCert }).publish, false);
    assert.match(reddit({ latestCert }).why, /no certification row/);
  }
  const mismatch = reddit({ certVerdict: 'REJECT', latestCert: { ...R.latestCert, verdict: 'ESCALATE' } });
  assert.equal(mismatch.publish, false);
  assert.match(mismatch.why, /draft row says REJECT, the latest certification says ESCALATE/);
  for (const certifiedAt of ['2026-10-18T01:00:00.001Z', 'not a date', null]) {
    const d = reddit({ latestCert: { ...R.latestCert, certifiedAt } });
    assert.equal(d.publish, false, `certifiedAt ${certifiedAt}`);
    assert.match(d.why, /certified at/);
  }
  for (const verdict of ['PASS', 'REVIEW', '', 'pending']) {
    assert.match(reddit({ latestCert: { ...R.latestCert, verdict } }).why, /which is not a verdict/, `cert verdict ${JSON.stringify(verdict)}`);
  }
  assert.equal(reddit({ certVerdict: 'PASS', latestCert: { ...R.latestCert, verdict: 'PASS' } }).publish, false);
});

test('REDDIT: r/Wordpress waits for karma 10 from the posting account, any casing', () => {
  for (const sub of ['Wordpress', 'WordPress', 'wordpress', 'WORDPRESS']) {
    const permalink = `https://www.reddit.com/r/${sub}/comments/1abc/t/`;
    for (const karma of [1, 9, null, undefined, Number.NaN]) {
      const d = reddit({ permalink, karma });
      assert.equal(d.publish, false, `r/${sub} karma ${karma}`);
      assert.match(d.why, /r\/wordpress/);
    }
    assert.equal(reddit({ permalink, karma: 10 }).publish, true, `r/${sub} at karma 10`);
  }
});

test('REDDIT: other subs post at karma 1; an unreadable subreddit refuses', () => {
  assert.equal(reddit({ karma: 1 }).publish, true);
  for (const permalink of [null, undefined, '', 'https://www.reddit.com/r/unknown/comments/1/t/',
    'https://www.reddit.com/user/someone/', 'not a url']) {
    const d = reddit({ permalink });
    assert.equal(d.publish, false, `permalink ${permalink}`);
    assert.match(d.why, /subreddit/);
  }
});

test('REDDIT: every non-certification advisory and hard gate still refuses', () => {
  assert.equal(reddit({ gates: withAdvisory('locked') }).publish, false);
  assert.equal(reddit({ gates: hardBlocked }).publish, false);
  assert.equal(reddit({ gates: withAdvisory('certification') }).publish, true);
});

test('the other bars ignore every REDDIT input — they behave exactly as before', () => {
  const lax = { latestCert: null, permalink: 'https://www.reddit.com/r/Wordpress/comments/1/t/', karma: 1 };
  assert.equal(underBar('ANY', () => unattendedPublishDecision({ ...R, ...lax })).publish, true);
  assert.equal(underBar('ESCALATE', () => unattendedPublishDecision({ ...R, ...lax, certVerdict: 'ESCALATE' })).publish, true);
  assert.equal(underBar('CERTIFIED', () => unattendedPublishDecision({ ...R, ...lax, certVerdict: 'CERTIFIED' })).publish, true);
});

test('the decision runs AGAIN on the final gates, so a last-second advisory stops an unattended post', () => {
  /* reply.ts re-gates against a freshly probed page just before the submit click. The first
     decision was taken on `pre`; an advisory that appears only in `final` must refuse too. */
  assert.equal(reddit({}).publish, true, 'allowed on the first gates');
  assert.equal(reddit({ gates: withAdvisory('duplicate') }).publish, false, 'refused on the final gates');
  const src = readFileSync(new URL('../../src/commands/reply.ts', import.meta.url), 'utf8');
  const tail = src.slice(src.indexOf('const final = evaluateGates('));
  const again = tail.search(/unattendedPublishDecision\(\{\s*\.\.\.autoInput,\s*gates: final/);
  const refused = tail.indexOf("record('publish.refused'");
  assert.ok(again > 0, 'reply.ts must call unattendedPublishDecision with the final gates');
  assert.ok(again < refused && refused < tail.indexOf('publishComment('),
    'and record publish.refused before publishComment is reached');
});
