import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRepetition, openerOf, shapeOf } from '../repetition.js';
import { draftTimeBlocks } from '../draft-gate.js';
import { assessQuality } from '../quality.js';
import { policy } from '../policy.js';

/* ---------------------------------------------------------------------------
 * The six bodies this install actually published, verbatim from the drafts table.
 * Four of these (the r/Wordpress ones) were removed by moderators, one with the public
 * reply "Please don't post AI-generated comments."
 * ------------------------------------------------------------------------- */

const ELEMENTOR =            // t1_pcizrg8, r/Wordpress, REMOVED
  "Worth checking separately from the outer Flexbox Container: does the Image Carousel widget have " +
  "its own slide height or aspect-ratio setting under Content, apart from the Image Resolution " +
  "option you've set to Full? My guess is that's a common spot for a carousel to constrain the " +
  "image, independent of the Container Min Height you've already pushed to 850px+. If so, " +
  "object-position: top in Custom CSS is worth trying, or swapping to a plain Image widget instead " +
  "of Image Carousel for a static, non-rotating banner like this one.";

const KADENCE =              // t1_pcm3zpx, r/Wordpress, REMOVED
  "Since you're already on Kadence, it might be worth checking its free starter templates before " +
  "switching themes entirely — a few of those lean modern/minimal. But it'd help to know what " +
  "specifically caught your eye on that blog: the layout, the color palette, the typography, or a " +
  "particular feature? That's the detail that would actually narrow down which theme is close, " +
  "rather than just guessing from 'modern.'";

const ANALYTICS =            // t1_pco7ssf, r/Wordpress, REMOVED
  "Before deciding between the 'mostly noise' and the enumeration theory, I'd pull the raw server " +
  "logs (access.log or whatever your host provides) for a chunk of those /page/2/, /page/3/ " +
  "requests and look at the User-Agent strings and whether the page numbers climb sequentially or " +
  "jump around. Analytics won't show you the User-Agent, but the logs will, and that's the one " +
  "thing nobody's checked yet.";

const HOSTING =              // t1_pctlrpd, r/webhosting, still visible
  "Before moving a domain and mailbox over, I'd check if 365i publishes any uptime/status history " +
  "and how they handle support tickets pre-sale — a slow or vague response to a basic question " +
  "is usually a preview of what support looks like after you're a customer. I'd also ask them " +
  "directly about backup and restore for mailboxes, since that matters more than price if anything " +
  "goes wrong.";

const CFP =                  // t1_pcup48f, r/Wordpress, REMOVED
  "Before picking between Forminator/Fluent Forms alone vs. adding an event plugin: do you need a " +
  "hard cap on the number of accepted applicants, or is the harder part reviewers marking each " +
  "submission accepted/rejected and applicants seeing that status? Those are different problems " +
  "— the first is closer to what event plugins handle, the second is closer to a review/workflow " +
  "plugin — and knowing which one is actually blocking you narrows the search a lot.";

const UNSERIOUS =            // t1_pcvqay2, r/webhosting, still visible
  "Before picking from the options above, it's worth pinning down which of your two scenarios this " +
  "actually is: a 'still image' you set once and forget, or a site you'll want to change 'when I " +
  "want to without much trouble' going forward. A one-time static page and something you'll keep " +
  "editing point toward different picks out of what's already been suggested here.";

/* In the order they were published. */
const PUBLISHED = [ELEMENTOR, KADENCE, ANALYTICS, HOSTING, CFP, UNSERIOUS];

/* ---- the opener key, and why it is two words ---- */

test('the two-word opener collapses the real repetition that a trigram misses', () => {
  /* Measured: the first THREE content words of these four are all distinct, so a trigram rule
     catches nothing. The first two collapse the two "picking" comments onto one key. */
  assert.equal(openerOf(ANALYTICS), 'before deciding');
  assert.equal(openerOf(HOSTING), 'before moving');
  assert.equal(openerOf(CFP), 'before picking');
  assert.equal(openerOf(UNSERIOUS), 'before picking');
  assert.equal(openerOf(CFP), openerOf(UNSERIOUS));
});

test('stop-words do not occupy an opener slot', () => {
  assert.equal(openerOf('The quick check I would run first'), 'quick check');
  /* 'just' and 'so' are both opener stop-words, so the first two CONTENT words are 'you know'. */
  assert.equal(openerOf('Just so you know, the plugin'), 'you know');
});

test('an empty or wordless body yields no opener and cannot match one', () => {
  assert.equal(openerOf(''), '');
  assert.equal(assessRepetition('', [ANALYTICS]).ok, true);
  assert.equal(assessRepetition('!!! ???', [ANALYTICS]).ok, true);
});

/* ---- what it would have caught ---- */

test('the sixth comment is blocked: the fifth opened the same way', () => {
  /* UNSERIOUS was published 2h36m after CFP. Both open "Before picking". */
  const r = assessRepetition(UNSERIOUS, [CFP, HOSTING, ANALYTICS, KADENCE, ELEMENTOR]);
  assert.equal(r.ok, false);
  assert.equal(r.issues[0]!.rule, 'repeated-opener');
  assert.match(r.issues[0]!.detail, /before picking/);
});

test('the fifth comment is blocked on the opening word alone', () => {
  /* Measured: its opener phrase ("before picking") was new and its sentence count (3) differed
     from the two before it (2 each), so neither the phrase nor the shape rule fires — while a
     reader was looking at a fourth consecutive 'Before'. */
  const r = assessRepetition(CFP, [HOSTING, ANALYTICS, KADENCE, ELEMENTOR]);
  assert.equal(r.ok, false);
  assert.equal(r.issues[0]!.rule, 'repeated-opening-word');
  assert.match(r.issues[0]!.detail, /3rd in a row/);
});

test('the fourth comment is blocked on shape, not phrasing', () => {
  /* HOSTING ("Before moving") vs ANALYTICS ("Before deciding") — different phrase, same move:
     same opening word, both 2 sentences, both closing on a statement. */
  const r = assessRepetition(HOSTING, [ANALYTICS, KADENCE, ELEMENTOR]);
  assert.equal(r.ok, false);
  assert.equal(r.issues[0]!.rule, 'repeated-shape');
  assert.equal(shapeOf(HOSTING).sentences, shapeOf(ANALYTICS).sentences);
  assert.equal(shapeOf(HOSTING).endsWithQuestion, shapeOf(ANALYTICS).endsWithQuestion);
});

test('the first comment of an account is never a repeat of anything', () => {
  assert.equal(assessRepetition(ELEMENTOR, []).ok, true);
});

test('across the real run, the gate fires from the fourth comment onward', () => {
  const fired: number[] = [];
  for (let i = 0; i < PUBLISHED.length; i++) {
    const previous = PUBLISHED.slice(0, i).reverse();      // most recent first
    if (!assessRepetition(PUBLISHED[i]!, previous).ok) fired.push(i + 1);
  }
  /* 1 Elementor "worth checking" and 2 Kadence "since you're" are genuinely distinct openings.
     3 Analytics introduces "before"; 4, 5 and 6 repeat it. Three of six refused. */
  assert.deepEqual(fired, [4, 5, 6]);
});

/* ---- it must not fire on ordinary English ---- */

test('two comments that merely share one feature are not a repeat', () => {
  const a = 'Check the error log first. It usually names the file.';
  /* Same opening word is not enough on its own: different sentence count breaks the shape rule. */
  const b = 'Check whether the plugin is active, then clear the cache, then reload once more.';
  assert.equal(assessRepetition(b, [a]).ok, true);
});

test('a different opening word with the same length is not a repeat', () => {
  const a = 'Check the error log first. It usually names the file.';
  const b = 'Compare the staging output to live. The difference is usually one setting.';
  assert.equal(assessRepetition(b, [a]).ok, true);
});

/* ---- the window ---- */

test('only the configured window of recent comments is compared', () => {
  const window = policy.repetitionWindow.value;
  const filler = Array.from({ length: window }, (_, i) => `Filler sentence number ${i}. A second one here.`);
  /* CFP sits one past the window, so UNSERIOUS's matching opener is out of reach. */
  const r = assessRepetition(UNSERIOUS, [...filler, CFP]);
  assert.equal(r.ok, true);
  /* Bring it inside the window and it fires. */
  assert.equal(assessRepetition(UNSERIOUS, [CFP, ...filler]).ok, false);
});

test('the window is a declared limit carrying its reason, not a bare number', () => {
  assert.equal(policy.repetitionWindow.provenance, 'declared');
  assert.match(policy.repetitionWindow.why, /\S/);
});

/* ---- the gate wiring, and the hole it closes ---- */

test('the craft gate alone passes every one of the six; repetition is what refuses them', () => {
  /* The measured fact this module exists for: assessQuality found ZERO issues on all six.
     Called without a thread, so only the body-derived checks run — the same subset
     draftTimeBlocks can evaluate before a thread-local gate is consulted. */
  for (const body of PUBLISHED) {
    assert.equal(assessQuality(body).ok, true, 'craft gate unexpectedly blocked a published body');
  }
  const blocks = draftTimeBlocks({
    body: UNSERIOUS, warming: false, previousBodies: [CFP]
  });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.gate, 'repetition:repeated-opener');
});

test('an absent history skips the check, and an empty history is a fact that also skips it', () => {
  assert.equal(draftTimeBlocks({ body: UNSERIOUS, warming: false }).length, 0);
  assert.equal(draftTimeBlocks({ body: UNSERIOUS, warming: false, previousBodies: [] }).length, 0);
});

/* ---- uniform-rhythm reachability ---- */

test('uniform-rhythm can now fire at three sentences, which is what the drafter produces', () => {
  /* Three sentences of 9, 9 and 9 words: spread 0. Under the old `>= 4` floor this was
     unreachable for every draft src/prompts.ts:240 is capable of producing. */
  const flat = 'I would check the plugin cache before anything else. '
    + 'I would also clear the object cache after that. '
    + 'I would then reload the page twice in sequence.';
  const r = assessQuality(flat);
  assert.equal(r.metrics.sentences, 3);
  assert.ok(r.issues.some((i) => i.code === 'uniform-rhythm'), 'uniform-rhythm did not fire at 3 sentences');
});

test('uniform-rhythm still abstains at two sentences, where a spread is not yet a rhythm', () => {
  const two = 'I would check the plugin cache first here. I would then clear the object cache.';
  const r = assessQuality(two);
  assert.equal(r.metrics.sentences, 2);
  assert.ok(!r.issues.some((i) => i.code === 'uniform-rhythm'));
});
