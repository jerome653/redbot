/**
 * Standing and jurisdiction — the two ways a corpus can quietly become a REJECT machine.
 *
 * Argus Rule 9 turns a `uncited` finding into a REJECT. That is sound only while "uncited"
 * means *we hold the reference material for this subject and it does not say this*. It stops
 * being sound the moment a corpus claims jurisdiction over ground it holds no card on, because
 * then "uncited" only means "we happen not to have that card" — and every claim on that subject
 * is rejected on the strength of an absence.
 *
 * That is not hypothetical. Replaying `wordpress-primary` over all 216 logged claims on
 * 2026-07-27 produced 16 `uncited` findings; read by hand, about eleven of them were **true**
 * claims that simply cleared no card at the coverage bar. The corpus therefore ships with
 * `rules: false`, and these tests hold both halves of that arrangement in place.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_CORPORA, corpora, claimsJurisdiction, retrievalCorpora, draftingCorpora,
  findReference, terms, REFERENCE_MIN_SCORE
} from '../corpus.js';

/**
 * A jurisdiction pattern that matches no card is a rule with nothing behind it. Checked against
 * the real card files rather than a fixture: the failure this guards against is a corpus and
 * its declared scope drifting apart on disk, which a fixture cannot see.
 */
test('every adjudicating corpus holds at least one card per jurisdiction pattern', () => {
  for (const c of corpora()) {
    if (c.config.rules === false) continue;      // no standing, so nothing to justify
    if (!c.cards) continue;                      // unavailable is Rule 10's problem, not this one
    for (const src of c.config.jurisdiction) {
      const re = new RegExp(src, 'i');
      const covering = c.cards.filter((card) => re.test(card.haystack));
      assert.ok(
        covering.length > 0,
        `corpus "${c.config.id}" claims jurisdiction over ${JSON.stringify(src)} but holds no ` +
        `card matching it — every claim on that subject would be REJECTed for being uncited`
      );
    }
  }
});

test('a retrieval-only corpus can never reject, escalate or certify anything', () => {
  const wp = corpora().find((c) => c.config.id === 'wordpress-primary');
  assert.ok(wp, 'the wordpress-primary corpus should be registered');
  assert.equal(wp.config.rules, false);

  // its subjects are real — these strings genuinely sit inside its declared jurisdiction …
  const inScope = [
    'Exceeding max_allowed_packet triggers the truncation condition',
    'wp_mail() can fail without returning error details',
    'Additional CSS is stored in wp_options'
  ];
  for (const text of inScope) {
    assert.ok(
      wp.jurisdiction.some((re) => re.test(text)),
      `"${text}" should be inside wordpress-primary's declared jurisdiction`
    );
    // … and yet nobody with standing rules on them
    assert.deepEqual(
      claimsJurisdiction(text).map((c) => c.config.id).filter((id) => id === 'wordpress-primary'),
      [],
      'a corpus with rules:false must not appear as an adjudicator'
    );
  }
});

test('the SGEN knowledge base keeps its standing', () => {
  // The one claim class where inventing an answer is unretractable: a fabricated product
  // capability asserted publicly. That check is the reason Rules 9/10/11 exist at all.
  const ruling = claimsJurisdiction('SGEN supports installing WordPress plugins').map((c) => c.config.id);
  assert.ok(ruling.includes('sgen-kb'));
});

test('a corpus without standing is still readable, because drafting needs it', () => {
  const ids = retrievalCorpora().map((c) => c.config.id);
  assert.ok(ids.includes('wordpress-primary'), 'retrieval must see the primary-docs corpus');
  assert.ok(ids.includes('sgen-kb'));
});

test('primary-documentation cards carry a source and survive the require filter', () => {
  const wp = corpora().find((c) => c.config.id === 'wordpress-primary');
  assert.ok(wp?.cards && wp.cards.length > 0, 'wordpress-primary should load cards from disk');
  for (const card of wp.cards) {
    assert.ok(card.id.length > 0);
    // Quoted primary material is long; a one-line card is a paraphrase, and a paraphrase of a
    // source is model-adjacent content wearing the source's authority.
    assert.ok(
      card.content.length > 120,
      `card ${card.id} is too short to be a quoted source`
    );
    assert.ok(terms(card.question).length > 0);
  }
});

test('the built-in set defaults to having standing, so opting out is deliberate', () => {
  const sgen = BUILT_IN_CORPORA.find((c) => c.id === 'sgen-kb');
  assert.equal(sgen?.rules, undefined, 'absent means standing — only opting out is explicit');
});

/* ------------------------------------------------------------------ *
 * Retrieval into drafting
 * ------------------------------------------------------------------ */

test('a public reply is never drafted from the SGEN knowledge base', () => {
  // Not a style preference. The KB's WordPress coverage is 17 cards all saying "SGEN does not
  // do that", so retrieving from it while answering a WordPress question surfaces product
  // cards and steers the reply toward the product — the signal forbidMention exists to stop.
  assert.ok(!draftingCorpora().some((c) => c.config.id === 'sgen-kb'));
  assert.ok(draftingCorpora().some((c) => c.config.id === 'wordpress-primary'));

  const hits = findReference('How do I get SGEN to install a WordPress plugin on my site?');
  assert.ok(!hits.some((h) => h.corpusId === 'sgen-kb'), 'no SGEN card may reach a draft');
});

test('retrieval needs an anchor — shared English is not a subject match', () => {
  // The measured regression: ranking by shared-term count returned four cards for this, and
  // rarity-weighting still returned three, on words like "able", "allow", "want".
  assert.deepEqual(
    findReference('Podcast Plugin Recommendation — looking for something able to handle large files'),
    []
  );
  assert.deepEqual(findReference('Overwhelmed with photo gallery options - Modula or ???'), []);
  assert.deepEqual(findReference(''), []);
});

test('retrieval fires on the subject it was built for, and names why', () => {
  const hits = findReference('Custom CSS missing after Updraft restore — my Additional CSS is gone from the database');
  assert.ok(hits.length > 0, 'a thread squarely inside the jurisdiction must retrieve');
  assert.equal(hits[0]!.corpusId, 'wordpress-primary');
  assert.equal(hits[0]!.cardId, 'wp-primary-custom-css-storage');
  // the reason is reported, not just the result — a reviewer can see what matched
  assert.ok(hits[0]!.distinctive.length > 0);
  assert.ok(hits[0]!.score >= REFERENCE_MIN_SCORE);
});

test('retrieval is deterministic — same subject, same cards, same order', () => {
  const subject = 'wp_mail returns true but no email arrives, and max_allowed_packet is unset';
  const a = findReference(subject);
  const b = findReference(subject);
  assert.deepEqual(a.map((h) => h.cardId), b.map((h) => h.cardId));
  assert.ok(a.length > 0);
});
