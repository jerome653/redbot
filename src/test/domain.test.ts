/**
 * The domain profile moved the WordPress vocabulary out of compiled source and into data
 * (2026-07-24). Two things have to hold, and only one of them is about the new feature.
 *
 * 1. **The built-in profile must be byte-equivalent to the tables it replaced.** The
 *    58-thread corpus is the only production evidence redbot has, and the benchmark derives
 *    from it. A pattern that silently changed during the move would invalidate the corpus
 *    without failing anything — the runs would still complete, just measuring something else.
 *    So the pre-move tables are frozen below, copied verbatim from `competence.ts` at commit
 *    07bd842, and asserted equal.
 *
 * 2. The rules must work for a profile that is not WordPress — otherwise the un-hardcoding
 *    is presentational, which is exactly what `accounts.json` was before REDBOT_ACCOUNT.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORDPRESS_PROFILE, compileProfile, validateProfile, DomainProfileError, domain
} from '../domain.js';
import { assessCompetenceWith } from '../competence.js';

/* ------------------------------------------------------------------ *
 * 1. Frozen pre-move tables — copied from competence.ts @ 07bd842
 * ------------------------------------------------------------------ */

const FROZEN_AREAS: Record<string, RegExp[]> = {
  wordpress: [
    /\bwordpress\b/i, /\bwp[-_](?:admin|config|content|cli|json)\b/i, /\bwp\b/i,
    /\bgutenberg\b/i, /\bpermalink/i, /\bshortcode/i, /\bwp[-_]?cron\b/i,
    /\bacf\b|advanced custom fields/i, /\byoast\b/i, /\bmultisite\b/i, /\bwoocommerce\b/i
  ],
  pluginsThemes: [
    /\bplugins?\b/i,
    /\bthemes?\b(?![- ](?:token|colou?r|switch))/i,
    /\bchild theme\b/i, /\bpage builder/i,
    /\belementor\b/i, /\bdivi\b/i, /\bbeaver builder\b/i, /\bbricks\b/i
  ],
  performance: [
    /\bcach(?:e|ing)\b/i, /\bttfb\b/i, /\bcore web vitals\b/i, /\bpage ?speed\b/i,
    /\bopcache\b/i, /\bredis\b/i, /\bmemcached\b/i, /\bcdn\b/i,
    /\bslow(?:ing|ness)?\b/i, /\bquery (?:time|performance|monitor)\b/i, /\bdatabase\b/i, /\bmysql\b/i
  ],
  hosting: [
    /\bhosting\b/i, /\bcpanel\b/i, /\bnginx\b/i, /\bapache\b/i, /\bphp[-_]fpm\b/i,
    /\bstaging\b/i, /\bmigrat(?:e|ion|ing)\b/i, /\bbackups?\b/i, /\bsftp?\b/i,
    /\bssl\b/i, /\bdns\b/i, /\bserver\b/i, /\b50[023]\b/i, /\bhtaccess\b/i
  ],
  security: [
    /\bmalware\b/i, /\bhacked\b/i, /\bbackdoor\b/i,
    /\bcompromised\b/i,
    /\bbrute[- ]force\b/i, /\bfirewall\b/i, /\bwordfence\b/i, /\bsucuri\b/i, /\bsql injection\b/i
  ],
  ecommerce: [
    /\bwoocommerce\b/i, /\bcheckout\b/i, /\bshopping cart\b/i,
    /\border (?:id|number|status|total|confirmation|email)\b/i,
    /\bproduct (?:page|catalogue|catalog|variations?|import|feed|grid)\b/i,
    /\bstripe\b/i, /\bpaypal\b/i
  ]
};

const FROZEN_OTHER_PLATFORMS = [
  /\bshopify\b/i, /\bliquid\b/i, /\bwix\b/i, /\bsquarespace\b/i, /\bwebflow\b/i,
  /\bdrupal\b/i, /\bjoomla\b/i, /\bghost\b/i, /\bnext\.?js\b/i, /\breact\b/i,
  /\bvue\b/i, /\bsvelte\b/i, /\bdjango\b/i, /\brails\b/i, /\blaravel\b/i
];

const FROZEN_MIN_AREAS = 2;

const built = compileProfile(WORDPRESS_PROFILE, 'built-in');

test('built-in profile declares the same areas, in the same order, as before the move', () => {
  assert.deepEqual(built.areas.map((a) => a.name), Object.keys(FROZEN_AREAS));
});

test('every area pattern is unchanged, source for source', () => {
  for (const { name, patterns } of built.areas) {
    const frozen = FROZEN_AREAS[name];
    assert.ok(frozen, `area ${name} is not in the frozen table`);
    assert.equal(patterns.length, frozen.length, `area ${name} changed pattern count`);
    for (const [i, re] of patterns.entries()) {
      assert.equal(re.source, frozen[i]!.source, `area ${name} pattern ${i} changed`);
      assert.equal(re.flags, 'i', `area ${name} pattern ${i} lost the case-insensitive flag`);
    }
  }
});

test('competing-platform list is unchanged, source for source', () => {
  assert.equal(built.otherPlatforms.length, FROZEN_OTHER_PLATFORMS.length);
  for (const [i, re] of built.otherPlatforms.entries()) {
    assert.equal(re.source, FROZEN_OTHER_PLATFORMS[i]!.source, `platform pattern ${i} changed`);
  }
});

test('minAreas and the anchor are unchanged', () => {
  assert.equal(built.minAreas, FROZEN_MIN_AREAS);
  assert.equal(built.anchorArea, 'wordpress');
});

test('the active profile is the built-in one unless a person wrote data/domain.json', () => {
  // Guards against a stray file changing what the corpus measures without anyone noticing.
  assert.ok(['built-in', 'data/domain.json'].includes(domain.source));
  if (domain.source === 'built-in') assert.equal(domain.name, 'wordpress');
});

/* ------------------------------------------------------------------ *
 * 2. The rules are not WordPress-specific
 * ------------------------------------------------------------------ */

const SHOPIFY: ReturnType<typeof compileProfile> = compileProfile({
  name: 'shopify',
  expertise: ['Shopify themes and Liquid', 'checkout and payments'],
  areas: {
    shopify: ['\\bshopify\\b', '\\bliquid\\b', '\\bshopify ?plus\\b'],
    checkout: ['\\bcheckout\\b', '\\bstripe\\b', '\\bpaypal\\b'],
    performance: ['\\bcach(?:e|ing)\\b', '\\bcdn\\b']
  },
  anchorArea: 'shopify',
  otherPlatforms: ['\\bwordpress\\b', '\\bwoocommerce\\b'],
  minAreas: 2
}, 'data/domain.json');

test('a non-WordPress profile scopes threads by its own vocabulary', () => {
  const r = assessCompetenceWith('Our Shopify checkout is slow — is the CDN caching Liquid?', SHOPIFY);
  assert.ok(r.inScope, r.detail);
  assert.deepEqual(r.areas.sort(), ['checkout', 'performance', 'shopify']);
});

test('a non-WordPress profile treats WordPress as the competing platform', () => {
  const r = assessCompetenceWith('WooCommerce checkout is slow behind the CDN', SHOPIFY);
  assert.equal(r.inScope, false);
  assert.match(r.detail, /no shopify anchor/);
});

test('anchorArea null means the anchor rule does not fire', () => {
  const noAnchor = compileProfile({
    name: 'generic',
    expertise: ['deployment'],
    areas: { a: ['\\balpha\\b'], b: ['\\bbeta\\b'] },
    anchorArea: null,
    otherPlatforms: ['\\bshopify\\b'],
    minAreas: 2
  }, 'data/domain.json');
  const r = assessCompetenceWith('alpha and beta on shopify', noAnchor);
  assert.ok(r.inScope, r.detail);
});

/* ------------------------------------------------------------------ *
 * 3. A malformed profile is an error, never a silent fallback
 * ------------------------------------------------------------------ */

const BASE = {
  name: 'x', expertise: ['y'], areas: { a: ['\\ba\\b'] },
  anchorArea: null, otherPlatforms: [], minAreas: 1
};

test('validation rejects a bad regex rather than dropping the pattern', () => {
  assert.throws(
    () => validateProfile({ ...BASE, areas: { a: ['\\ba\\b', '('] } }, 'test'),
    DomainProfileError
  );
});

test('validation rejects an anchorArea that is not a declared area', () => {
  assert.throws(() => validateProfile({ ...BASE, anchorArea: 'nope' }, 'test'), DomainProfileError);
});

test('validation rejects an empty expertise list', () => {
  assert.throws(() => validateProfile({ ...BASE, expertise: [] }, 'test'), DomainProfileError);
});

test('validation rejects minAreas below 1', () => {
  assert.throws(() => validateProfile({ ...BASE, minAreas: 0 }, 'test'), DomainProfileError);
});

test('validation accepts the built-in profile', () => {
  assert.doesNotThrow(() => validateProfile(WORDPRESS_PROFILE, 'built-in'));
});
