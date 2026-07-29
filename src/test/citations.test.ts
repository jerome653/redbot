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
import type { LoadedCorpus, CorpusConfig } from '../corpus.js';
import type { Claim, ResolutionVerdict } from '../argus/types.js';

/**
 * The loader tests at the bottom of this file write a `corpora.json` and reload. `DATA` — and
 * with it `corporaPath` — is fixed the moment `config.js` is first evaluated, so the redirect
 * has to be in place before any value import; hence the dynamic imports, the same shape
 * jobs.test.ts and confirm.test.ts already use. Without it those tests would write into the
 * operator's real `data/`, which is append-only evidence.
 */
process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-corpus-'));

const {
  terms, findSupport, findReference, corpora, resetCorpora, corporaPath, CorpusError,
  SUPPORT_MIN_TERMS, SUPPORT_MIN_COVERAGE, REFERENCE_MIN_SCORE
} = await import('../corpus.js');
const { checkCitations } = await import('../argus/citations.js');
const { certify } = await import('../argus/certify.js');

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

/** Point the loader at a `corpora.json` of our own, and put the built-in set back afterwards. */
function withCorporaConfig(file: unknown, body: () => void): void {
  writeFileSync(corporaPath, JSON.stringify(file));
  resetCorpora();
  try {
    body();
  } finally {
    rmSync(corporaPath, { force: true });
    resetCorpora();
  }
}

test('a corpus file with a bad jurisdiction regex is rejected at load', () => {
  // WAS: this wrote the file into a temp directory nothing read, then asserted that
  // `new RegExp('(', 'i')` throws — a fact about JavaScript, true whatever corpus.ts does.
  // Same intent, now aimed at the code that owns it: loadConfigs must REFUSE the file rather
  // than load a corpus carrying a pattern that cannot compile.
  withCorporaConfig({ corpora: [{ ...CFG, jurisdiction: ['('] }] }, () => {
    assert.throws(
      () => corpora(),
      (e: unknown) => e instanceof CorpusError && /corpus "test-kb" jurisdiction "\("/.test(e.message),
      'an uncompilable jurisdiction pattern must fail the load, not reach retrieval'
    );
  });
});

/**
 * Six cards, so the rarity weights are worth something: a term held by one card out of six
 * scores log(7/2) ≈ 1.25, and the three the probe subject shares clear REFERENCE_MIN_SCORE
 * with room to spare. None of this vocabulary appears in any corpus loaded before the reload,
 * which is the whole point of it.
 */
const PROBE_CARDS = [
  {
    id: 'probe-kestrel',
    question: 'What plumage does a kestrel show?',
    content: 'Falconry manuals describe the kestrel plumage band by band.'
  },
  { id: 'probe-anvil', question: 'Anvil bench height', content: 'Bench height for an anvil in a working forge.' },
  { id: 'probe-basalt', question: 'Basalt column formation', content: 'Columnar basalt forms as lava cools slowly.' },
  { id: 'probe-cinder', question: 'Cinder track upkeep', content: 'A cinder track needs rolling after heavy rain.' },
  { id: 'probe-dovetail', question: 'Dovetail joint angles', content: 'Dovetail joints hold a drawer together without glue.' },
  { id: 'probe-estuary', question: 'Estuary tidal range', content: 'Tidal range in an estuary varies with the moon.' }
];

test('reloading a corpus rebuilds the rarity weights, so retrieval still finds the new cards', () => {
  // Warm the caches against the built-in set first — that is the state a reload has to replace.
  const cardsFile = join(process.env.REDBOT_DATA!, 'probe-cards.json');
  findReference('max_allowed_packet truncation during a mysqldump restore');
  writeFileSync(cardsFile, JSON.stringify({ cards: PROBE_CARDS }));

  withCorporaConfig({
    corpora: [{
      id: 'probe',
      label: 'the reload probe corpus',
      path: cardsFile,
      cardsAt: 'cards',
      fields: { id: 'id', question: 'question', content: 'content' },
      require: {},
      jurisdiction: ['\\bkestrel\\b'],
      draftable: true
    }]
  }, () => {
    // The failure this pins is silent, which is what makes it worth a test: keeping the old
    // corpus's document frequencies across a reload gives every term only the NEW corpus holds
    // a weight of 0, so every card scores 0, falls under REFERENCE_MIN_SCORE, and retrieval
    // returns an empty list while reporting no error at all.
    const hits = findReference('Kestrel plumage identification for falconry');
    assert.ok(hits.length > 0, 'a reloaded corpus must be retrievable, not silently scored to zero');
    assert.equal(hits[0]!.cardId, 'probe-kestrel');
    assert.ok(hits[0]!.score >= REFERENCE_MIN_SCORE);
  });
});

process.on('exit', () => {
  try { rmSync(process.env.REDBOT_DATA!, { recursive: true, force: true }); } catch { /* ignore */ }
});
