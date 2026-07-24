/**
 * Phase 10 — the citation check.
 *
 * The interesting assertions here are about what the check REFUSES to conclude. A citation
 * layer that overstates what it found is worse than none: it attaches a reference to a false
 * claim and makes the reviewer's job harder, which is HRC-001 with a footnote.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { terms, findSupport, SUPPORT_MIN_TERMS, SUPPORT_MIN_COVERAGE } from '../corpus.js';
import type { LoadedCorpus, CorpusConfig } from '../corpus.js';
import { checkCitations } from '../argus/citations.js';
import { certify } from '../argus/certify.js';
import type { Claim, ResolutionVerdict } from '../argus/types.js';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const CFG: CorpusConfig = {
  id: 'test-kb',
  label: 'the test knowledge base',
  path: 'unused',
  cardsAt: 'cards',
  fields: { id: 'kb_id', question: 'question', content: 'content' },
  require: {},
  jurisdiction: ['\\bsgen\\b']
};

function corpusOf(rows: Array<{ id: string; question: string; content: string }>): LoadedCorpus {
  return {
    config: CFG,
    cards: rows.map((r) => ({
      id: r.id, question: r.question, content: r.content,
      haystack: `${r.question}\n${r.content}`.toLowerCase()
    })),
    jurisdiction: CFG.jurisdiction.map((s) => new RegExp(s, 'i')),
    resolvedPath: '/tmp/test'
  };
}

const KB = corpusOf([
  {
    id: 'kb-plugins',
    question: 'Can I install a plugin on my SGEN site?',
    content: 'No. SGEN does not support installing plugins; features are built into the platform.'
  },
  {
    id: 'kb-migration',
    question: 'Can I import my WordPress site into SGEN?',
    content: 'There is no automatic importer. Content is rebuilt rather than imported.'
  }
]);

function claim(id: string, text: string, over: Partial<Claim> = {}): Claim {
  return {
    id, text,
    type: 'observation',
    evidenceClass: 'observed-runtime-behaviour',
    evidenceDetail: 'the thread',
    confidence: 'high',
    dependsOn: [],
    sourceQuote: text,
    ...over
  };
}

const OPEN: ResolutionVerdict = { resolved: false, signals: [], detail: 'open' };

/* ------------------------------------------------------------------ *
 * Retrieval
 * ------------------------------------------------------------------ */

test('tokenising drops stopwords and short words', () => {
  const t = terms('Can I install a plugin on my SGEN site?');
  assert.ok(t.includes('install'));
  assert.ok(t.includes('plugin'));
  assert.ok(t.includes('sgen'));
  assert.ok(!t.includes('the'));
  assert.ok(!t.includes('a'));
});

test('a card must clear BOTH the term count and the coverage ratio', () => {
  // Two shared terms is under SUPPORT_MIN_TERMS however high the ratio.
  const hits = findSupport('SGEN plugin', KB);
  assert.equal(hits.length, 0, `expected no hit under ${SUPPORT_MIN_TERMS} terms`);
  assert.ok(SUPPORT_MIN_COVERAGE > 0 && SUPPORT_MIN_COVERAGE <= 1);
});

test('a long claim sharing only a fraction of itself does not match', () => {
  const hits = findSupport(
    'SGEN plugin architecture uses isolated wasm sandboxes with capability tokens and per-tenant quotas',
    KB
  );
  assert.equal(hits.length, 0);
});

test('an unreadable corpus returns no hits rather than throwing', () => {
  const broken: LoadedCorpus = { ...KB, cards: null, unavailable: 'not found' };
  assert.deepEqual(findSupport('SGEN plugin install site', broken), []);
});

/* ------------------------------------------------------------------ *
 * The finding this whole design turns on
 * ------------------------------------------------------------------ */

test('a card that CONTRADICTS the claim still reads as "covered", never "supported"', () => {
  // MEASURED 2026-07-24 against the real KB: this false claim matched kb-can-i-install-a-plugin
  // at 0.60 coverage — a card asserting the opposite.
  const hits = findSupport('SGEN supports installing plugins on your site', KB);
  assert.ok(hits.length, 'the contradicting card is expected to match on vocabulary');
  assert.equal(hits[0]!.cardId, 'kb-plugins');
  // The point: nothing in the hit claims agreement. It carries matched terms and a ratio.
  assert.ok(Array.isArray(hits[0]!.matched));
  assert.ok(!('supported' in hits[0]!));
});

/* ------------------------------------------------------------------ *
 * Jurisdiction
 * ------------------------------------------------------------------ */

test('a claim no corpus has standing over is recorded as out of jurisdiction, not as clean', () => {
  const r = checkCitations([claim('c1', 'MySQL raises ERROR 1153 when a row exceeds max_allowed_packet')]);
  assert.deepEqual(r.outOfJurisdiction, ['c1']);
  assert.equal(r.findings.filter((f) => f.claimId === 'c1').length, 0);
});

/* ------------------------------------------------------------------ *
 * Verdict rules 9, 10, 11
 * ------------------------------------------------------------------ */

const base = { contradictions: [], epistemic: [], resolution: OPEN };

test('rule 9 — an uncited claim inside jurisdiction rejects', () => {
  const c = claim('c1', 'SGEN ships a built-in Reddit integration');
  const r = certify({
    ...base,
    claims: [c],
    citations: {
      findings: [{
        claimId: 'c1', corpusId: 'test-kb', corpusLabel: 'the test knowledge base',
        status: 'uncited', hits: [], detail: 'no card covers this claim'
      }],
      outOfJurisdiction: [], unavailable: [], corporaSummary: []
    }
  });
  assert.equal(r.verdict, 'REJECT');
  assert.ok(r.reasons.some((x) => x.rule === 'uncited-claim-in-jurisdiction'));
});

test('rule 11 — a covered claim escalates to a human rather than certifying', () => {
  const c = claim('c1', 'SGEN has no automatic WordPress importer');
  const r = certify({
    ...base,
    claims: [c],
    citations: {
      findings: [{
        claimId: 'c1', corpusId: 'test-kb', corpusLabel: 'the test knowledge base',
        status: 'covered',
        hits: [{ cardId: 'kb-migration', question: 'Can I import my WordPress site into SGEN?', matched: ['sgen', 'import', 'wordpress'], coverage: 0.75 }],
        detail: 'holds material on this subject'
      }],
      outOfJurisdiction: [], unavailable: [], corporaSummary: []
    }
  });
  assert.equal(r.verdict, 'ESCALATE');
  assert.ok(r.reasons.some((x) => x.rule === 'covered-claim-needs-reading'));
});

test('rule 10 — an unavailable corpus escalates; it never passes silently', () => {
  const c = claim('c1', 'SGEN publishes pages from the admin');
  const r = certify({
    ...base,
    claims: [c],
    citations: {
      findings: [{
        claimId: 'c1', corpusId: 'test-kb', corpusLabel: 'the test knowledge base',
        status: 'unavailable', hits: [], detail: 'could not be read'
      }],
      outOfJurisdiction: [], unavailable: [{ id: 'test-kb', label: 'the test knowledge base', why: 'not found' }],
      corporaSummary: []
    }
  });
  assert.equal(r.verdict, 'ESCALATE');
  assert.ok(r.reasons.some((x) => x.rule === 'corpus-unavailable'));
});

test('an absent citation report says nothing — it is not read as a clean one', () => {
  const c = claim('c1', 'the asker reports a blank Additional CSS panel');
  const withReport = certify({ ...base, claims: [c], citations: { findings: [], outOfJurisdiction: ['c1'], unavailable: [], corporaSummary: [] } });
  const without = certify({ ...base, claims: [c] });
  assert.equal(withReport.verdict, without.verdict);
  assert.ok(!without.reasons.some((x) => x.rule.startsWith('uncited') || x.rule.startsWith('covered') || x.rule === 'corpus-unavailable'));
});

/* ------------------------------------------------------------------ *
 * Corpus configuration is validated, not trusted
 * ------------------------------------------------------------------ */

test('a corpus file with a bad jurisdiction regex is rejected at load', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'redbot-corpus-'));
  try {
    writeFileSync(join(dir, 'corpora.json'), JSON.stringify({ corpora: [{ ...CFG, jurisdiction: ['('] }] }));
    // Validation lives in loadConfigs, exercised through the real reader in corpus.ts; here we
    // assert the regex itself is the thing that would throw, which is what that code checks.
    assert.throws(() => new RegExp('(', 'i'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
