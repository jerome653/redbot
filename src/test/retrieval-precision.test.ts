/**
 * The distinctive-anchor floor on retrieval.
 *
 * MEASURED 2026-11-09 on the 30-day REJECT set: of 64 threads `findReference` grounded, 38
 * shared no domain term with the chosen card — a "My interactive Three.js portfolio" thread
 * grounding to `wp-primary-elementor-requirements` on *while, run, work, wordpress*; "How else
 * can I fix my website?" grounding to the traffic-drop card on *search, console, change, page*.
 * The jurisdiction gate opens a corpus and the rarity floor clears two mid-frequency words, but
 * neither can tell a distinctive domain term from generic English, and a true-but-irrelevant
 * fact in an off-topic reply is the karma harm the project exists to avoid (DEFECT-15).
 *
 * These tests pin the fix: a ground must share at least one DISTINCTIVE anchor — the corpus's
 * own jurisdiction vocabulary, derived at load — with the thread. They use a self-contained
 * fixture corpus so the assertion does not drift with the live card files or the REJECT log.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-precision-'));

const { findReference, deriveAnchorSet, corporaPath, resetCorpora } = await import('../corpus.js');

function withCorporaConfig(file: unknown, body: () => void): void {
  writeFileSync(corporaPath, JSON.stringify(file));
  resetCorpora();
  try { body(); } finally { rmSync(corporaPath, { force: true }); resetCorpora(); }
}

/**
 * One fixture corpus. Its jurisdiction has a STRONG branch (`widgetron`, a distinctive product
 * token) and a WEAK branch (`payment processor`, two generic words that open the gate but name
 * nothing distinctive). Only `widgetron` survives as an anchor.
 */
const FIXTURE = {
  corpora: [{
    id: 'gadget',
    label: 'the fixture gadget corpus',
    path: join(process.env.REDBOT_DATA!, 'gadget.json'),
    cardsAt: 'cards',
    fields: { id: 'id', question: 'question', content: 'content' },
    require: {},
    jurisdiction: ['\\bwidgetron\\b', 'payment processor'],
    draftable: true
  }]
};
const GADGET_CARDS = {
  cards: [
    {
      id: 'gadget-generic',
      question: 'Checkout performance during a sale',
      content: 'A payment processor question often involves resolving slowness, clearing caches, '
        + 'rebuilding indexes and flushing buffers during a busy sale.'
    },
    {
      id: 'gadget-widgetron',
      question: 'The widgetron module',
      content: 'The widgetron module crashes when the widgetron pipeline update is misconfigured.'
    }
  ]
};

function writeCards(): void {
  writeFileSync(join(process.env.REDBOT_DATA!, 'gadget.json'), JSON.stringify(GADGET_CARDS));
}

test('deriveAnchorSet keeps distinctive tokens and drops generic co-signals', () => {
  // The strong branch survives; both words of the weak branch are generic and are dropped.
  const anchors = deriveAnchorSet(['\\bwidgetron\\b', 'payment processor']);
  assert.ok(anchors.has('widgetron'), 'a distinctive product token is an anchor');
  assert.ok(!anchors.has('payment'), 'a generic gate-opener word is not an anchor');
  assert.ok(!anchors.has('processor'), 'a generic gate-opener word is not an anchor');

  // Compound jurisdiction terms survive terms() whole, so they stay single-token anchors; the
  // generic English in the same patterns is dropped.
  const seo = deriveAnchorSet(['search console|\\bgsc\\b', '\\bcanonical', 'robots\\.txt']);
  assert.ok(seo.has('gsc') && seo.has('canonical') && seo.has('robots.txt'));
  assert.ok(!seo.has('search') && !seo.has('console'), 'the weak "search console" words are not anchors');
});

test('a weak jurisdiction branch plus generic overlap does NOT ground', () => {
  writeCards();
  withCorporaConfig(FIXTURE, () => {
    // Opens the corpus on the weak `payment processor` branch and shares SIX generic words with
    // the generic card (resolving, slowness, clearing, caches, rebuilding, indexes, flushing,
    // buffers, sale) — enough to clear the ≥2-term rarity floor — but not one distinctive term.
    const subject = 'payment processor setup — resolving slowness, clearing caches, rebuilding '
      + 'indexes, flushing buffers during a sale';
    const hits = findReference(subject);
    assert.deepEqual(hits, [], 'a generic-only overlap must not ground (the DEFECT-15 leak)');
  });
});

test('a shared distinctive anchor still grounds — the floor does not block real matches', () => {
  writeCards();
  withCorporaConfig(FIXTURE, () => {
    const hits = findReference('widgetron module crashes after a pipeline update');
    assert.ok(hits.length > 0, 'a thread sharing the distinctive anchor must still retrieve');
    assert.equal(hits[0]!.cardId, 'gadget-widgetron');
    assert.ok(hits[0]!.matched.includes('widgetron'), 'the ground names the distinctive term it shares');
  });
});

process.on('exit', () => {
  try { rmSync(process.env.REDBOT_DATA!, { recursive: true, force: true }); } catch { /* ignore */ }
});
