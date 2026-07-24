import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessCompetence } from '../competence.js';

/**
 * Every case here is a real string from the 2026-07-23 corpus. The four false positives were
 * found by running the filter over 14 analyzed threads and printing what each pattern matched,
 * rather than by imagining what might go wrong.
 */

test('a WordPress support thread is in scope', () => {
  const r = assessCompetence(
    'High database activity and caching plugin. WP Super Cache is thrashing the database on this WordPress site.'
  );
  assert.equal(r.inScope, true);
  assert.ok(r.areas.length >= 2);
});

test('"theme tokens" is CSS vocabulary, not a WordPress theme', () => {
  const r = assessCompetence(
    'You can only set it to solid colors via theme tokens on the <header> tags. Safari does its own thing.'
  );
  assert.equal(r.inScope, false, 'a CSS thread read as in-scope on the word "theme"');
});

test('"the best compromise" is ordinary English, not a security incident', () => {
  const r = assessCompetence('Rolled it back aha. I think this is the best compromise for now.');
  assert.ok(!r.areas.includes('security'));
});

test('"rendering order" is not an e-commerce order', () => {
  const r = assessCompetence(
    'It depends on component composition and/or the rendering order. This is some kind of CSS-in-JS framework.'
  );
  assert.ok(!r.areas.includes('ecommerce'));
});

test('one shared word is a coincidence, not a subject', () => {
  const r = assessCompetence(
    'Class names change every build. It is done for encapsulation and cache-busting purposes.'
  );
  assert.equal(r.inScope, false);
  assert.ok(/coincidence/.test(r.detail));
});

test('a thread about another platform entirely is out of scope, and names it', () => {
  const r = assessCompetence(
    'What tool did your team adopt that actually stuck? We are a React and Laravel shop.'
  );
  assert.equal(r.inScope, false);
  assert.ok(r.otherPlatforms.length > 0);
  assert.ok(/react|laravel/i.test(r.detail));
});

test('a thread with no declared vocabulary at all is out of scope', () => {
  const r = assessCompetence(
    'A webhook retry from a third party broke our dedup logic and made duplicate records.'
  );
  assert.equal(r.inScope, false);
  assert.equal(r.areas.length, 0);
});

test('naming another platform does not disqualify a genuine WordPress thread', () => {
  // Migrating off Wix onto WordPress is squarely ours, and it will mention Wix throughout.
  const r = assessCompetence(
    'Migrating a 70+ page Wix site to WordPress. Need to move the blog posts, set up hosting, ' +
    'pick a theme and keep the plugins minimal.'
  );
  assert.equal(r.inScope, true);
  assert.ok(r.otherPlatforms.includes('wix'));
});

test('e-commerce vocabulary counts in its compound forms', () => {
  assert.ok(assessCompetence('WooCommerce checkout is slow on this server').areas.includes('ecommerce'));
  assert.ok(assessCompetence('the order number is missing from the confirmation email on our WordPress store').areas.includes('ecommerce'));
});
