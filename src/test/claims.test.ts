/**
 * The claim budget.
 *
 * The assertions worth having here are the ones that pin down what this check is NOT. It
 * counts stated certainty, not truth, and the difference is the whole reason HRC-001 got as
 * far as it did — so there is a test below that holds the honest limit in place rather than
 * letting a later reader assume the budget protects against false claims.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessClaims } from '../claims.js';
import { assessQuality } from '../quality.js';
import { policy } from '../policy.js';

test('a flat behavioural assertion is counted as unhedged', () => {
  const r = assessClaims('The import throws an error and closes the connection.');
  assert.equal(r.behavioural.length, 1);
  assert.equal(r.unhedged.length, 1);
});

test('the same claim written as a check is not counted', () => {
  const r = assessClaims("I'd check whether the import throws an error before assuming a wipe.");
  assert.equal(r.behavioural.length, 1);
  assert.equal(r.unhedged.length, 0);
});

/**
 * REGRESSION. The first version of the behavioural pattern matched "is stored" but not "are
 * stored", so this sentence — taken verbatim from the HRC-001 draft, and one of the claims
 * Argus ruled on — was not seen as an assertion at all.
 */
test('plural and negated storage assertions are detected', () => {
  for (const s of [
    "Custom CSS and Additional CSS aren't stored the same way.",
    'Custom CSS and Additional CSS are stored in different places.',
    'Additional CSS is stored as a dedicated entry.'
  ]) {
    assert.equal(assessClaims(s).behavioural.length, 1, `not detected: ${s}`);
  }
});

test('code blocks are demonstrations, not claims', () => {
  const body = 'Try this:\n\n```\nwp option get custom_css\n```\n\nIt returns the row if one exists.';
  const r = assessClaims(body);
  // the prose sentence counts; nothing inside the fence does — and BOTH halves are asserted,
  // because `every` over an empty array is true: the exclusion check alone passed just as
  // happily on a scanner that found nothing at all.
  assert.ok(r.behavioural.every((s) => !s.text.includes('wp option get')), 'the fenced command is not a claim');
  assert.equal(r.behavioural.length, 1, 'the prose around the fence is still an assertion');
  assert.match(r.behavioural[0]!.text, /^It returns the row/);
});

/**
 * The limit, stated as a test so nobody has to infer it from the absence of one.
 *
 * HRC-001's central claim was false AND hedged: "Big single-row values like that are the ones
 * most likely to get silently truncated during a SQL import". MySQL raises
 * ER_NET_PACKET_TOO_LARGE and closes the connection. A certainty budget scores this sentence
 * as careful writing, because it is careful writing — it is just wrong, and no count of
 * hedges can see that.
 */
test('a hedged false claim passes the budget — this is not a truth check', () => {
  const hrc001 =
    'Big single-row values like that are the ones most likely to get silently truncated ' +
    'during a SQL import if it hits a size limit.';
  const r = assessClaims(hrc001);
  assert.equal(r.unhedged.length, 0);
  assert.equal(r.overBudget, false);
});

test('the budget comes from policy, so `redbot policy` can print it', () => {
  assert.equal(assessClaims('').budget, policy.unhedgedClaimBudget.value);
  assert.equal(policy.unhedgedClaimBudget.provenance, 'provisional');
});

test('going over the budget warns and never blocks', () => {
  // Six flat assertions, well past a budget of four.
  const body =
    'The plugin overwrites the option on save. ' +
    'That deletes the stored value. ' +
    'The cache always returns the old row. ' +
    'This will break the checkout page. ' +
    'The filter never fires on the front end. ' +
    'The migration truncates the column. ' +
    'You can see the same thing in the logs, and the values are stored in one row.';

  const r = assessClaims(body);
  assert.ok(r.unhedged.length > r.budget, `expected over budget, got ${r.unhedged.length}`);
  assert.equal(r.overBudget, true);

  const q = assessQuality(body, {});
  const issue = q.issues.find((i) => i.code === 'claim-budget');
  assert.ok(issue, 'the craft gate should surface the claim budget');
  assert.equal(issue.severity, 'warn', 'the claim budget must never block a publish');
});
