/**
 * The refuted-claim strip, as pure logic: which certifications qualify, which sentences go, and
 * every reason to keep the original REJECT instead. No database, no browser, no model.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planStrip, stripEligibility, sentenceSpans, stripRefutedEnabled } from '../refuted-strip.js';
import type { Certification, Claim, VerdictReason } from '../argus/types.js';

const DISCLOSURE = 'Disclosure: I work on SGEN.';

function claim(id: string, sourceQuote: string, dependsOn: string[] = []): Claim {
  return {
    id, text: sourceQuote, type: 'implementation-detail', evidenceClass: 'reasoned-inference',
    evidenceDetail: '', confidence: 'medium', dependsOn, sourceQuote
  };
}

function cert(over: Partial<Certification> & { reasons: VerdictReason[]; claims: Claim[] }): Certification {
  return {
    draftId: 'd_x', threadId: 't_x', verdict: 'REJECT', contradictions: [], epistemic: [],
    invalidated: [], resolution: { resolved: false, signals: [], detail: '' },
    certifiedAt: '2026-10-18T00:00:00.000Z', model: 'stub', ...over
  };
}

const fatal = (claimId: string): VerdictReason => ({ rule: 'fatal-contradiction', claimId, detail: 'refuted' });
const dep = (claimId: string): VerdictReason => ({ rule: 'invalidated-dependency', claimId, detail: 'rests on it' });

const BODY = 'Your import is failing on the packet size. MySQL truncates an oversized row silently. ' +
  'Raise max_allowed_packet in my.cnf and restart the service. Then rerun the import from the shell.';

describe('deleting what was refuted', () => {
  test('the sentence holding a refuted quote is removed and nothing else is', () => {
    const p = planStrip({
      body: BODY,
      certs: [cert({ reasons: [fatal('c2')], claims: [claim('c1', 'failing on the packet size'), claim('c2', 'truncates an oversized row silently')] })]
    });
    assert.equal(p.ok, true, p.ok ? '' : p.why);
    if (!p.ok) return;
    assert.equal(p.removed, 1);
    assert.equal(p.body, 'Your import is failing on the packet size. Raise max_allowed_packet in my.cnf and ' +
      'restart the service. Then rerun the import from the shell.');
    assert.deepEqual(p.quotes, ['truncates an oversized row silently']);
  });

  test('claims resting on a refuted claim go with it, transitively', () => {
    const p = planStrip({
      body: BODY,
      certs: [cert({
        reasons: [fatal('c2'), dep('c3')],
        claims: [
          claim('c2', 'MySQL truncates an oversized row silently'),
          claim('c3', 'Raise max_allowed_packet in my.cnf', ['c2']),
          claim('c4', 'rerun the import from the shell', ['c3'])
        ],
        invalidated: [{ claimId: 'c3', becauseOf: 'c2' }]
      })],
      minSentences: 1, minKeepRatio: 0
    });
    assert.equal(p.ok, true, p.ok ? '' : p.why);
    if (!p.ok) return;
    assert.equal(p.removed, 3);
    assert.equal(p.body, 'Your import is failing on the packet size.');
  });

  test('a refuted quote that cannot be found in the body refuses the strip', () => {
    const p = planStrip({ body: BODY, certs: [cert({ reasons: [fatal('c2')], claims: [claim('c2', 'PostgreSQL drops the column')] })] });
    assert.equal(p.ok, false);
    if (!p.ok) assert.match(p.why, /not found/);
  });

  test('a dependent quote that cannot be found refuses the strip too', () => {
    const p = planStrip({
      body: BODY,
      certs: [cert({
        reasons: [fatal('c2'), dep('c3')],
        claims: [claim('c2', 'truncates an oversized row silently'), claim('c3', 'set innodb_log_file_size', ['c2'])]
      })]
    });
    assert.equal(p.ok, false);
    if (!p.ok) assert.match(p.why, /c3.*not found/);
  });

  test('a refuted claim restated elsewhere in other punctuation survives, so the strip is refused', () => {
    const body = 'Set max_allowed_packet to 64M in my.cnf. Your import keeps failing on one large row. ' +
      'That one row is the whole problem here. Again: set max-allowed-packet to 64 M before retrying.';
    const p = planStrip({ body, certs: [cert({ reasons: [fatal('c1')], claims: [claim('c1', 'Set max_allowed_packet to 64M')] })] });
    assert.equal(p.ok, false);
    if (!p.ok) assert.match(p.why, /still in the body/);
  });

  test('a quote inside the disclosure line refuses rather than remove the disclosure', () => {
    const body = `${BODY}\n\n${DISCLOSURE}`;
    const p = planStrip({ body, protect: [DISCLOSURE], certs: [cert({ reasons: [fatal('c9')], claims: [claim('c9', 'I work on SGEN')] })] });
    assert.equal(p.ok, false);
    if (!p.ok) assert.match(p.why, /disclosure/);
  });

  test('a strip elsewhere keeps the disclosure line, and it does not count as a sentence of the reply', () => {
    const body = `${BODY}\n\n${DISCLOSURE}`;
    const ok = planStrip({ body, protect: [DISCLOSURE], certs: [cert({ reasons: [fatal('c2')], claims: [claim('c2', 'truncates an oversized row silently')] })] });
    assert.equal(ok.ok, true, ok.ok ? '' : ok.why);
    if (ok.ok) assert.ok(ok.body.endsWith(`\n\n${DISCLOSURE}`));

    const two = `Raise max_allowed_packet in my.cnf. MySQL truncates an oversized row silently.\n\n${DISCLOSURE}`;
    const thin = planStrip({ body: two, protect: [DISCLOSURE], certs: [cert({ reasons: [fatal('c2')], claims: [claim('c2', 'truncates an oversized row silently')] })] });
    assert.equal(thin.ok, false, 'one reply sentence plus a disclosure line is not two sentences');
  });

  test('too little left to be a reply refuses: under 2 sentences, or under 40% of the original', () => {
    const two = 'Raise max_allowed_packet in my.cnf and restart. MySQL truncates an oversized row silently.';
    const one = planStrip({ body: two, certs: [cert({ reasons: [fatal('c2')], claims: [claim('c2', 'truncates an oversized row silently')] })] });
    assert.equal(one.ok, false);
    if (!one.ok) assert.match(one.why, /1 sentence/);

    const long = 'Check the log. Restart it. MySQL truncates an oversized row silently whenever the row is ' +
      'larger than the configured packet limit, and it reports nothing at all to the client while the import ' +
      'keeps running as though every single row had landed in the table.';
    const short = planStrip({ body: long, certs: [cert({ reasons: [fatal('c2')], claims: [claim('c2', 'truncates an oversized row silently')] })] });
    assert.equal(short.ok, false);
    if (!short.ok) assert.match(short.why, /40%/);
  });

  test('a bullet whose only sentence is removed disappears with its marker', () => {
    const body = 'Two things to check here, in order.\n\n- Look at the slow query log first.\n- MySQL truncates an oversized row silently.\n- Then raise the packet limit and retry.';
    const p = planStrip({ body, certs: [cert({ reasons: [fatal('c2')], claims: [claim('c2', 'truncates an oversized row silently')] })] });
    assert.equal(p.ok, true, p.ok ? '' : p.why);
    if (p.ok) assert.equal(p.body, 'Two things to check here, in order.\n\n- Look at the slow query log first.\n- Then raise the packet limit and retry.');
  });
});

describe('splitting into sentences', () => {
  const texts = (body: string) => sentenceSpans(body).map((s) => body.slice(s.start, s.end));

  test('URLs, version numbers, inline code and e.g. do not end a sentence', () => {
    const body = 'Update to 6.4.2 from https://wordpress.org/download/releases/6.4.2/ first. ' +
      'Run `wp core verify-checksums --version=6.4.2` after, e.g. on staging. Done.';
    assert.deepEqual(texts(body), [
      'Update to 6.4.2 from https://wordpress.org/download/releases/6.4.2/ first.',
      'Run `wp core verify-checksums --version=6.4.2` after, e.g. on staging.',
      'Done.'
    ]);
  });

  test('a fenced code block is one unit, never cut at its periods', () => {
    const body = 'Run this. It is safe.\n```\nwp db export. && wp db import x.sql. Done.\n```\nThen check.';
    assert.deepEqual(texts(body), ['Run this.', 'It is safe.', '```\nwp db export. && wp db import x.sql. Done.\n```', 'Then check.']);
  });

  test('a quote spanning two sentences removes both', () => {
    const body = 'Keep this one. Remove this. And this too. Keep the last. And another to keep.';
    const p = planStrip({ body, certs: [cert({ reasons: [fatal('c1')], claims: [claim('c1', 'Remove this. And this')] })], minKeepRatio: 0 });
    assert.equal(p.ok, true, p.ok ? '' : p.why);
    if (p.ok) assert.equal(p.body, 'Keep this one. Keep the last. And another to keep.');
  });
});

describe('what qualifies', () => {
  for (const rule of ['thread-resolved', 'contested-contradiction', 'unrefuted-falsifiable-claim', 'a-rule-nobody-has-heard-of']) {
    test(`a REJECT that also carries ${rule} is not stripped`, () => {
      const e = stripEligibility(cert({ reasons: [fatal('c2'), { rule, claimId: 'c1', detail: '' }], claims: [claim('c2', 'truncates an oversized row silently')] }));
      assert.equal(e.ok, false);
      if (!e.ok) assert.match(e.why, new RegExp(rule));
    });
  }

  test('soft rules alongside a fatal contradiction do not stop it', () => {
    const e = stripEligibility(cert({
      reasons: [fatal('c2'), ...['overconfident-language', 'low-confidence-as-fact', 'no-provenance', 'falsifiable-claim-weak-evidence']
        .map((rule) => ({ rule, claimId: 'c1', detail: '' }))],
      claims: [claim('c2', 'truncates an oversized row silently')]
    }));
    assert.equal(e.ok, true, e.ok ? '' : e.why);
  });

  test('CERTIFIED and ESCALATE are never touched', () => {
    for (const verdict of ['CERTIFIED', 'ESCALATE'] as const) {
      const p = planStrip({ body: BODY, certs: [cert({ verdict, reasons: [fatal('c2')], claims: [claim('c2', 'truncates an oversized row silently')] })] });
      assert.equal(p.ok, false, verdict);
    }
  });

  test('a REJECT with no fatal contradiction has nothing to strip', () => {
    const e = stripEligibility(cert({ reasons: [{ rule: 'no-provenance', claimId: 'c1', detail: '' }], claims: [claim('c1', 'x')] }));
    assert.equal(e.ok, false);
  });

  test('only the LATEST certification counts', () => {
    const reject = cert({ reasons: [fatal('c2')], claims: [claim('c2', 'truncates an oversized row silently')] });
    const certified = cert({ verdict: 'CERTIFIED', reasons: [{ rule: 'all-claims-supported', detail: '' }], claims: [] });
    assert.equal(planStrip({ body: BODY, certs: [reject, certified] }).ok, false);
    assert.equal(planStrip({ body: BODY, certs: [certified, reject] }).ok, true);
    assert.equal(planStrip({ body: BODY, certs: [] }).ok, false);
  });

  test('a draft that is itself the product of a strip is never stripped again', () => {
    const p = planStrip({ body: BODY, fromStrip: true, certs: [cert({ reasons: [fatal('c2')], claims: [claim('c2', 'truncates an oversized row silently')] })] });
    assert.equal(p.ok, false);
    if (!p.ok) assert.match(p.why, /already/);
  });

  test('REDBOT_STRIP_REFUTED=0 switches it off; anything else leaves it on', () => {
    assert.equal(stripRefutedEnabled({}), true);
    assert.equal(stripRefutedEnabled({ REDBOT_STRIP_REFUTED: '1' }), true);
    assert.equal(stripRefutedEnabled({ REDBOT_STRIP_REFUTED: '0' }), false);
  });
});
