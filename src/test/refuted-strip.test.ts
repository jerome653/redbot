/**
 * The refuted-claim strip, as pure logic: which certifications qualify, which sentences go, and
 * every reason to keep the original REJECT instead. No database, no browser, no model.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planStrip, stripEligibility, sentenceSpans, stripRefutedEnabled, type StripBar } from '../refuted-strip.js';
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

  test('a quote whose inner quote marks differ from the body, or are dropped, is still found', () => {
    /* All three quote misses in the July log were this: the claim says 'not indexed' where the body
       says "not indexed", or drops the marks around "sticky sidebar". */
    const body = 'Check Security & Manual Actions first. A manual action won’t show up as anything other than ' +
      '"not indexed" in coverage. It is probably a "sticky sidebar" script. Then look at the redirects.';
    const p = planStrip({
      body,
      certs: [cert({
        reasons: [fatal('c1'), fatal('c2')],
        claims: [claim('c1', "A manual action won't show up as anything other than 'not indexed' in coverage"),
          claim('c2', 'probably a sticky sidebar script')]
      })],
      minSentences: 1, minKeepRatio: 0
    });
    assert.equal(p.ok, true, p.ok ? '' : p.why);
    if (p.ok) assert.equal(p.body, 'Check Security & Manual Actions first. Then look at the redirects.');
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

  test('a quote reaching into ONE of two disclosure lines refuses, though the other copy would survive', () => {
    /* The text check after deletion would pass here (a copy is left), so this pins the sentence guard. */
    const body = `${DISCLOSURE} Your import is failing on the packet size. Raise max_allowed_packet in my.cnf and ` +
      `restart the service. Then rerun the import from the shell.\n\n${DISCLOSURE}`;
    const p = planStrip({ body, protect: [DISCLOSURE], certs: [cert({ reasons: [fatal('c1')], claims: [claim('c1', 'work on SGEN. Your import is failing')] })] });
    assert.equal(p.ok, false, 'one copy of the disclosure is still a disclosure removed');
    if (!p.ok) assert.match(p.why, /disclosure/);
  });

  test('a disclosure line the clean-up would alter refuses: the last check compares the text itself', () => {
    /* No refuted sentence touches the line, so this pins the text check, not the sentence guard:
       trailing spaces on a line are trimmed by the clean-up, which changes the protected text. */
    const line = `${DISCLOSURE}  `;
    const p = planStrip({ body: `${BODY}\n\n${line}\nThanks for the details.`, protect: [line], certs: [cert({ reasons: [fatal('c2')], claims: [claim('c2', 'truncates an oversized row silently')] })] });
    assert.equal(p.ok, false);
    if (!p.ok) assert.match(p.why, /disclosure/);
  });

  test('a strip elsewhere keeps the disclosure line, and it does not count as a sentence of the reply', () => {
    const body = `${BODY}\n\n${DISCLOSURE}`;
    const ok = planStrip({ body, protect: [DISCLOSURE], certs: [cert({ reasons: [fatal('c2')], claims: [claim('c2', 'truncates an oversized row silently')] })] });
    assert.equal(ok.ok, true, ok.ok ? '' : ok.why);
    if (ok.ok) assert.ok(ok.body.endsWith(`\n\n${DISCLOSURE}`));

    const only = `MySQL truncates an oversized row silently, so raise max_allowed_packet.\n\n${DISCLOSURE}`;
    const thin = planStrip({ body: only, protect: [DISCLOSURE], certs: [cert({ reasons: [fatal('c2')], claims: [claim('c2', 'truncates an oversized row silently')] })] });
    assert.equal(thin.ok, false, 'a disclosure line alone is not a reply');
    if (!thin.ok) assert.match(thin.why, /only 0 sentence/);
  });

  test('one sentence left is still a reply (the floor is 1), and the length share still applies', () => {
    const two = 'Raise max_allowed_packet in my.cnf and restart. MySQL truncates an oversized row silently.';
    const one = planStrip({ body: two, certs: [cert({ reasons: [fatal('c2')], claims: [claim('c2', 'truncates an oversized row silently')] })] });
    assert.equal(one.ok, true, one.ok ? '' : one.why);
    if (one.ok) assert.equal(one.body, 'Raise max_allowed_packet in my.cnf and restart.');
  });

  test('too little left to be a reply refuses: no sentence at all, or under 40% of the original', () => {
    const none = planStrip({
      body: 'MySQL truncates an oversized row silently.',
      certs: [cert({ reasons: [fatal('c2')], claims: [claim('c2', 'truncates an oversized row silently')] })]
    });
    assert.equal(none.ok, false);
    if (!none.ok) assert.match(none.why, /only 0 sentence\(s\) would be left \(the floor is 1\)/);

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

  test('a quote found only inside a longer word is not found, so nothing is cut ("utf8" in "utf8mb4", "Caf" in "Caféine")', () => {
    /* Issue #30 item 2: refuting "set the charset to utf8" deleted a correct utf8mb4 sentence. */
    for (const [body, quote] of [
      ['Your tables need a wider character set for emoji. Set the charset to utf8mb4 on each table. ' +
        'Then convert the existing columns and rerun the import from the shell.', 'set the charset to utf8'],
      ['Call the new site Caféine and launch it this week. Then add the menu and the footer. ' +
        'Publish when the pages look right.', 'call the new site Caf']
    ] as const) {
      const p = planStrip({ body, certs: [cert({ reasons: [fatal('c1')], claims: [claim('c1', quote)] })] });
      assert.equal(p.ok, false, `"${quote}" is not a word of the body`);
      if (!p.ok) assert.match(p.why, /c1 not found/);
    }
  });

  test('a quote also sitting inside a longer word refuses: the check after deletion stays a substring check', () => {
    /* The exact sentence is located and only it is cut; the utf8mb4 sentence is kept, and the net
       after deletion still sees "set the charset to utf8" in it, so the original REJECT stands. */
    const body = 'Set the charset to utf8 in my.cnf first. Your tables need a wider set for emoji, so set the ' +
      'charset to utf8mb4 on each table. Then convert the existing columns one at a time. Rerun the import ' +
      'from the shell once that is done. Check the row counts against the source after.';
    const p = planStrip({ body, certs: [cert({ reasons: [fatal('c1')], claims: [claim('c1', 'set the charset to utf8')] })] });
    assert.equal(p.ok, false, 'the utf8mb4 sentence must not be deleted with it');
    if (!p.ok) assert.match(p.why, /still in the body/);
  });

  test('an apostrophe the fold drops still ends a word: "the server" is found in "the server’s"', () => {
    const body = 'Clear the cache from the dashboard first. Until a restart, the old opcache lives in the server’s ' +
      'memory. Then reload the page to check.';
    const p = planStrip({ body, certs: [cert({ reasons: [fatal('c1')], claims: [claim('c1', 'the old opcache lives in the server')] })] });
    assert.equal(p.ok, true, p.ok ? '' : p.why);
    if (p.ok) assert.equal(p.body, 'Clear the cache from the dashboard first. Then reload the page to check.');
  });

  test('a quote whose ellipsis leaves a piece too short to locate refuses, naming the claim', () => {
    /* Issue #30 item 1: "the row" was skipped, "silently, always" was cut, and "MySQL cuts the row." stayed. */
    const body = 'MySQL cuts the row. It happens silently, always, on every import. Raise max_allowed_packet in ' +
      'my.cnf and restart the service. Then rerun the import from the shell.';
    const p = planStrip({ body, certs: [cert({ reasons: [fatal('c1')], claims: [claim('c1', 'the row... silently, always')] })] });
    assert.equal(p.ok, false, p.ok ? `stripped around the short piece, leaving: ${p.body}` : '');
    if (!p.ok) assert.match(p.why, /claim c1 has a piece too short to locate \("the row"\)/);
  });

  test('a piece holding only punctuation or space is dropped, not refused', () => {
    const p = planStrip({ body: BODY, certs: [cert({ reasons: [fatal('c2')], claims: [claim('c2', '…truncates an oversized row... — ...')] })] });
    assert.equal(p.ok, true, p.ok ? '' : p.why);
    if (p.ok) assert.equal(p.body, 'Your import is failing on the packet size. Raise max_allowed_packet in my.cnf and ' +
      'restart the service. Then rerun the import from the shell.');
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

  test('inline code holding a full stop and a space stays whole', () => {
    const body = 'Then run `echo done. exit` in the shell. It returns at once.';
    assert.deepEqual(texts(body), ['Then run `echo done. exit` in the shell.', 'It returns at once.']);
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

  test('titles, numbered abbreviations and dotted initialisms do not end a sentence', () => {
    const body = 'Ask Dr. Smith first. He moved to the U.S. Navy base in 2019. The call is at 9 a.m. today, not ' +
      '10 p.m. tonight. Mr. Jones, Mrs. Lee and Ms. Park agree. The office shuts on Martin Luther King Jr. Day, ' +
      'says Sr. Maria Lopez. See Fig. 3 and vol. 2 for St. Louis, No. 5 first. Then stop.';
    assert.deepEqual(texts(body), [
      'Ask Dr. Smith first.',
      'He moved to the U.S. Navy base in 2019.',
      'The call is at 9 a.m. today, not 10 p.m. tonight.',
      'Mr. Jones, Mrs. Lee and Ms. Park agree.',
      'The office shuts on Martin Luther King Jr. Day, says Sr. Maria Lopez.',
      'See Fig. 3 and vol. 2 for St. Louis, No. 5 first.',
      'Then stop.'
    ]);
  });

  test('a full stop before a lowercase word is not an end (an inline "1. then"); before a capital it still is', () => {
    const body = 'Do it in order: 1. stop the service 2. edit my.cnf. Restart it after. No. You need a bigger ' +
      'packet. It took 40 ms. Then it failed.';
    assert.deepEqual(texts(body), [
      'Do it in order: 1. stop the service 2. edit my.cnf.',
      'Restart it after.',
      'No.',
      'You need a bigger packet.',
      'It took 40 ms.',
      'Then it failed.'
    ]);
  });

  test('a long run of boundaries that do not end a sentence is split in linear time', () => {
    /* Re-reading the sentence so far at every boundary took 8.6 s on this; the last word alone takes ms. */
    const body = 'a.b. '.repeat(20_000) + 'it fails. then it works. '.repeat(4_000);
    const t = performance.now();
    assert.equal(sentenceSpans(body).length, 1);
    assert.ok(performance.now() - t < 2000, `took ${Math.round(performance.now() - t)} ms`);
  });

  test('a refuted sentence holding "Dr." goes whole, leaving no "Ask Dr." behind', () => {
    const body = 'Ask Dr. Smith, who says MySQL truncates an oversized row silently. Raise max_allowed_packet in ' +
      'my.cnf and restart the service. Then rerun the import from the shell.';
    const p = planStrip({ body, certs: [cert({ reasons: [fatal('c1')], claims: [claim('c1', 'truncates an oversized row silently')] })] });
    assert.equal(p.ok, true, p.ok ? '' : p.why);
    if (p.ok) assert.equal(p.body, 'Raise max_allowed_packet in my.cnf and restart the service. Then rerun the import from the shell.');
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

/*
 * #30 item 4: `no-provenance` is soft here but a REJECT reason to Argus, so under a strict bar a
 * draft carrying it was stripped and certified again only to be refused again.
 */
describe('the bar in force', () => {
  const refutedOnly = claim('c2', 'truncates an oversized row silently');
  const kept = claim('c1', 'failing on the packet size');
  const opinion: Claim = { ...claim('c1', 'failing on the packet size'), type: 'opinion' };
  const soft = (rule: string, claimId: string): VerdictReason => ({ rule, claimId, detail: rule });
  const plan = (bar: StripBar | undefined, reasons: VerdictReason[], claims: Claim[] = [kept, refutedOnly]) =>
    planStrip({ body: BODY, certs: [cert({ reasons, claims })], ...(bar ? { bar } : {}) });

  test('under CERTIFIED any reason the strip leaves standing refuses, and names it', () => {
    for (const rule of ['no-provenance', 'low-confidence-as-fact', 'falsifiable-claim-weak-evidence', 'overconfident-language']) {
      const p = plan('CERTIFIED', [fatal('c2'), soft(rule, 'c1')]);
      assert.equal(p.ok, false, rule);
      if (!p.ok) assert.match(p.why, new RegExp(`CERTIFIED bar .*${rule} on claim c1`));
    }
  });

  test('under ESCALATE only what Argus files as a REJECT reason refuses', () => {
    for (const rule of ['no-provenance', 'overconfident-language']) {
      const p = plan('ESCALATE', [fatal('c2'), soft(rule, 'c1')]);
      assert.equal(p.ok, false, `${rule} on a falsifiable claim`);
    }
    for (const rule of ['low-confidence-as-fact', 'falsifiable-claim-weak-evidence']) {
      const p = plan('ESCALATE', [fatal('c2'), soft(rule, 'c1')]);
      assert.equal(p.ok, true, `${rule} only escalates: ${p.ok ? '' : p.why}`);
    }
    const o = plan('ESCALATE', [fatal('c2'), soft('overconfident-language', 'c1')], [opinion, refutedOnly]);
    assert.equal(o.ok, true, `overconfident-language on an opinion only escalates: ${o.ok ? '' : o.why}`);
  });

  test('under ESCALATE a dependency resting on a claim nobody refuted refuses', () => {
    const p = plan('ESCALATE', [fatal('c2'), dep('c1')]);
    assert.equal(p.ok, false);
    if (!p.ok) assert.match(p.why, /invalidated-dependency on claim c1/);
  });

  test('a reason on a claim the strip deletes goes with it', () => {
    const p = plan('CERTIFIED', [fatal('c2'), soft('no-provenance', 'c2')]);
    assert.equal(p.ok, true, p.ok ? '' : p.why);
  });

  test('REDDIT, ANY and an unset bar predict nothing', () => {
    for (const bar of ['REDDIT', 'ANY', undefined] as const) {
      const p = plan(bar, [fatal('c2'), soft('no-provenance', 'c1')]);
      assert.equal(p.ok, true, `${bar}: ${p.ok ? '' : p.why}`);
    }
  });
});
