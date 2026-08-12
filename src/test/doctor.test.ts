import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  gitignoreActivePatterns, buildFreshness, secretProtection, REQUIRED_IGNORES, freshThreadCount
} from '../commands/doctor.js';
import { currentAgeHours } from '../select.js';

/**
 * The secret-protection check must look at ACTIVE ignore rules, not the whole file — the old
 * substring test was satisfied by the .gitignore's own comment header, so deleting the real
 * rule still "passed" (evaluation M6).
 */

/* Imported rather than re-declared: a local copy of the required list could drift from the one
   the check actually uses, and then this file would be asserting against its own opinion. */
const REQUIRED = REQUIRED_IGNORES;
const isMissing = (text: string) => {
  const active = gitignoreActivePatterns(text);
  return REQUIRED.filter((r) => !active.some((line) => line.includes(r)));
};

test('a pattern that appears only in a comment does NOT satisfy the check', () => {
  const commentOnly = [
    '# Verified with: git check-ignore -v data/chrome-profile/Default/Cookies',
    '# data/operators holds credentials',
    'node_modules/'
  ].join('\n');
  const missing = isMissing(commentOnly);
  assert.ok(missing.includes('data/chrome-profile'), 'a commented-out rule must read as missing');
  assert.ok(missing.includes('data/operators'));
});

test('active rules satisfy the check', () => {
  const real = [
    '# Browser profiles — never commit',
    'data/chrome-profile*/',
    'data/operators/',
    'data/*.json',
    'data/*.jsonl'
  ].join('\n');
  assert.deepEqual(isMissing(real), []);
});

test('gitignoreActivePatterns drops comments and blank lines', () => {
  assert.deepEqual(
    gitignoreActivePatterns('# a comment\n\n  data/*.json  \n# another\nnode_modules/\n'),
    ['data/*.json', 'node_modules/']
  );
});

/* ==================================================================== *
 * Packaged install vs development checkout
 *
 * Two checks here can only be answered inside a checkout, and each used to answer WRONGLY in a
 * packaged app — in opposite directions. Build freshness compared src/ mtimes against dist/;
 * with no src/ the mtime walk returns 0, so `stale = 0 > distNewest` was false and it reported
 * PASS while comparing against nothing. Secret protection read .gitignore and FAILED without
 * one, telling every installed copy that its session cookies were committable.
 *
 * Both now report N/A. These tests exist because N/A is the kind of state that silently rots
 * back into PASS the next time somebody simplifies a branch.
 * ==================================================================== */
describe('build freshness', () => {
  test('no dist/ at all is a FAIL — nothing has been built', () => {
    const r = buildFreshness(false, true, 0, 0);
    assert.equal(r.status, 'FAIL');
    assert.match(r.detail, /npm run build/);
  });

  test('a packaged build (dist, no src) is N/A — never a vacuous PASS', () => {
    const r = buildFreshness(true, false, 0, 1_000_000);
    assert.equal(r.status, 'N/A', 'a check that cannot run must not report success');
    assert.match(r.detail, /packaged build/);
  });

  test('a checkout with source newer than the build FAILS, and says by how much', () => {
    const r = buildFreshness(true, true, 5_000, 2_000);
    assert.equal(r.status, 'FAIL');
    assert.match(r.detail, /source is 3s newer/);
  });

  test('a checkout with a fresh build PASSES', () => {
    assert.equal(buildFreshness(true, true, 1_000, 9_000).status, 'PASS');
  });

  test('equal mtimes are NOT stale — a build is fresh at the instant it finishes', () => {
    assert.equal(buildFreshness(true, true, 7_000, 7_000).status, 'PASS');
  });
});

describe('secret protection', () => {
  test('no .gitignore and no repository is N/A — there is nothing to commit to', () => {
    const r = secretProtection(null, false);
    assert.equal(r.status, 'N/A', 'an installed copy must not be told its cookies are committable');
    assert.match(r.detail, /not a git checkout/);
  });

  test('no .gitignore INSIDE a checkout is still a FAIL — the guard was scoped, not deleted', () => {
    const r = secretProtection(null, true);
    assert.equal(r.status, 'FAIL');
    assert.match(r.detail, /no \.gitignore/);
  });

  test('a checkout whose .gitignore lacks a required rule FAILS and names it', () => {
    const r = secretProtection('node_modules/\ndist/\n', true);
    assert.equal(r.status, 'FAIL');
    for (const rule of REQUIRED_IGNORES) assert.ok(r.detail.includes(rule), `should name ${rule}`);
  });

  test('a complete .gitignore PASSES', () => {
    const text = ['data/chrome-profile*/', 'data/operators/', 'data/*.json', 'data/*.jsonl'].join('\n');
    const r = secretProtection(text, true);
    assert.equal(r.status, 'PASS');
    assert.match(r.detail, /all 4 required patterns present/);
  });

  test('a rule present only as a comment still FAILS, even in a checkout', () => {
    // The M6 regression, asserted through the real check rather than the helper alone.
    const r = secretProtection('# data/chrome-profile\n# data/operators\nnode_modules/\n', true);
    assert.equal(r.status, 'FAIL');
  });
});

/**
 * Corpus freshness measured the age a thread had AT COLLECTION and never aged it, so a thread
 * collected 11 days ago while it was 31h old still counted as "inside the 72h window" forever.
 * Measured 2026-08-12 on the live corpus: doctor said 35 of 35 fresh in the same session the
 * prefilter dropped 14 of those 35 as 257-298h old. Two gauges, one question, an order of
 * magnitude apart.
 *
 * The rule now delegates to currentAgeHours() — the function the prefilter already uses — so
 * the two cannot answer differently again.
 */
describe('corpus freshness ages a thread after it was collected', () => {
  const CEILING = 72;
  const NOW = Date.parse('2026-08-12T00:00:00.000Z');
  const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

  test('a thread young at collection but old now is NOT fresh', () => {
    const threads = [{ ageMinutes: 31.7 * 60, collectedAt: hoursAgo(256.8) }];
    assert.equal(freshThreadCount(threads, CEILING, NOW), 0);
  });

  test('a thread young at collection and collected just now IS fresh', () => {
    const threads = [{ ageMinutes: 4 * 60, collectedAt: hoursAgo(1) }];
    assert.equal(freshThreadCount(threads, CEILING, NOW), 1);
  });

  test('a thread whose age was never captured cannot be called fresh', () => {
    const threads = [{ ageMinutes: null, collectedAt: hoursAgo(1) }];
    assert.equal(freshThreadCount(threads, CEILING, NOW), 0);
  });

  test('it answers exactly what currentAgeHours answers, on the same input', () => {
    const threads = [
      { ageMinutes: 10 * 60, collectedAt: hoursAgo(1) },
      { ageMinutes: 10 * 60, collectedAt: hoursAgo(100) },
      { ageMinutes: 71 * 60, collectedAt: hoursAgo(0.5) },
      { ageMinutes: null, collectedAt: hoursAgo(1) }
    ];
    const byHand = threads.filter((t) => {
      const a = currentAgeHours(t, NOW);
      return a != null && a <= CEILING;
    }).length;
    assert.equal(freshThreadCount(threads, CEILING, NOW), byHand);
  });
});
